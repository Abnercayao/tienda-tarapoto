//// Config
// @incluir comun
// @incluir comun-pedidos
return [{ json: pdConfig($input.all().map(function (i) { return i.json; })) }];

//// Interpretar
// @incluir validar.js
// @incluir comun
// @incluir comun-pedidos
// Comandos de pedidos y de usuarios (WF4 -> WF16). Rol RECALCULADO desde AUTORIZADOS (revocar = efecto inmediato).
//   Todos:           /envios, /pedidos y /pedido <num> (marketing: sin datos de contacto del cliente)
//   admin y dueño:   /preparando, /enviar, /recojo, /entregado, /cancelar_pedido (botón), /desconocidos, /autorizar, /desautorizar (botón)
// Botones (WF2 los manda como comando "boton_pedidos"): ped:can:<num>:<vence> · usr:aut:<id>:<d|m>:<vence> · usr:des:<id>:<vence> · ped:no · usr:no
const cfg = $('Config').first().json;
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
const ahora = Date.now();
const chat = Number(t.chat_id) || 0;
const yo = Number(t.from_id) || 0;
const rol = rolDe(cfg, yo) || '';
const c = String(t.comando || '').toLowerCase();
const args = (Array.isArray(t.args) ? t.args : []).map(function (a) { return String(a).trim(); }).filter(Boolean);
const R = function (texto, extra) { return [{ json: { ruta: 'responder', mensajes: [enviar(chat, texto, extra)] } }]; };
const uso = function (forma, ejemplo) { return R('Uso: ' + h(forma) + '\nSiguiente paso: escribe, por ejemplo, ' + h(ejemplo) + '.'); };
const sinPermiso = function () { return R('Tu rol (' + h(rol || 'sin rol') + ') puede ver pedidos, pero no cambiarlos ni gestionar usuarios.\nSiguiente paso: pídeselo al dueño o al admin.'); };
const gestiona = puede(rol, 'pedidos');
const detallado = gestiona;
const nombreDe = function (id) {
  const a = (cfg.AUTORIZADOS || []).find(function (x) { return x.id === id; });
  const d = (cfg.DESCONOCIDOS || []).slice().reverse().find(function (x) { return x && Number(x.id) === id; });
  return textoSeguro((a && a.nombre) || (d && d.nombre) || '', 40);
};
const ROL_TXT = { admin: 'admin', dueno: 'dueño', marketing: 'marketing' };
if (!rol) return R('No estás autorizado.\nSiguiente paso: pide acceso al dueño o al admin.');

// ---------- botones ----------
if (c === 'boton_pedidos') {
  const cb = t.callback || {};
  const d = String(cb.data || '');
  const quitar = quitarTeclado(chat, cb.message_id);
  const p = d.split(':');
  const resp = function (texto) { return [{ json: { ruta: 'responder', mensajes: [quitar, enviar(chat, texto)] } }]; };
  if (d === 'ped:no' || d === 'usr:no') return resp('Listo, no cambié nada.\nSiguiente paso: nada.');
  if (p[0] === 'ped' && p[1] === 'can' && /^\d{6}$/.test(p[2] || '')) {
    if (!gestiona) return resp('Tu rol ya no puede cancelar pedidos.\nSiguiente paso: pídeselo al dueño.');
    if (!pdVigente(p[3], ahora)) return resp('Ese botón venció (vale 10 minutos).\nSiguiente paso: vuelve a escribir /cancelar_pedido PB-' + p[2] + '.');
    return [{ json: { ruta: 'cambiar', numero: 'PB-' + p[2], nuevo: 'cancelado', mensajes_previos: [quitar], nota: 'Pedido cancelado por la tienda' } }];
  }
  if (p[0] === 'usr' && (p[1] === 'aut' || p[1] === 'des') && /^[1-9]\d{0,14}$/.test(p[2] || '')) {
    if (!puede(rol, 'usuarios')) return resp('Tu rol ya no puede gestionar usuarios.\nSiguiente paso: pídeselo al admin.');
    const venc = p[1] === 'aut' ? p[4] : p[3];
    if (!pdVigente(venc, ahora)) return resp('Ese botón venció (vale 10 minutos).\nSiguiente paso: vuelve a escribir el comando.');
    const rolNuevo = p[1] === 'aut' ? (p[3] === 'd' ? 'dueno' : p[3] === 'm' ? 'marketing' : '') : '';
    if (p[1] === 'aut' && !rolNuevo) return resp('Botón inválido.\nSiguiente paso: vuelve a escribir /autorizar.');
    return [{ json: { ruta: 'usuarios', accion: p[1] === 'aut' ? 'autorizar' : 'desautorizar', id: Number(p[2]), rol_nuevo: rolNuevo, mensajes_previos: [quitar] } }];
  }
  return resp('Ese botón ya no sirve.\nSiguiente paso: vuelve a escribir el comando.');
}

// ---------- consultas ----------
if (c === 'envios') {
  const site = await pdSite(this, cfg, $getWorkflowStaticData('global'));
  if (!site || !site.envios) return R('No pude leer las opciones de envío de la web publicada.\nSiguiente paso: inténtalo en unos minutos.');
  const E = site.envios;
  const L = ['<b>Envíos a todo el Perú</b> (lo mismo que ven Vale y la web)'];
  (E.opciones || []).filter(function (o) { return o && o.activa === true; }).forEach(function (o) {
    L.push('• <b>' + h(o.nombre) + '</b>: ' + (Math.round(Number(o.costo_desde) * 100) === 0 ? 'gratis' : 'desde ' + h(pdSoles(o.costo_desde))) + ' · ' + h(o.tiempo_promedio) + (o.entrega === 'agencia' ? ' · recojo en agencia con DNI' : ' · a domicilio'));
  });
  if (typeof E.gratis_desde === 'number') L.push('Envío gratis desde ' + h(pdSoles(E.gratis_desde)) + ' de compra.');
  if (E.despacho) L.push(h(E.despacho));
  if (E.nota) L.push('<i>' + h(E.nota) + '</i>');
  L.push('Siguiente paso: para cambiar costos o tiempos, edita site.json (envios) con Abner.');
  return R(L.join('\n'));
}
if (c === 'pedidos') return [{ json: { ruta: 'lista', detallado: detallado } }];
const num = pdNumero(args[0]);
if (c === 'pedido') {
  if (!num) return uso('/pedido PB-000101', '/pedido PB-000101');
  return [{ json: { ruta: 'pedido', numero: num, detallado: detallado, confirmar_cancelar: false } }];
}
// ---------- cambios de estado (admin y dueño) ----------
const CAMBIO = { preparando: 'preparando', recojo: 'listo_recojo', entregado: 'entregado', enviar: 'enviado', cancelar_pedido: 'cancelado' };
if (CAMBIO[c]) {
  if (!gestiona) return sinPermiso();
  if (!num) return uso('/' + c + ' PB-000101' + (c === 'enviar' ? ' shalom|olva|bus|local <código>' : ''), '/' + c + ' PB-000101' + (c === 'enviar' ? ' shalom 12345678-ABCD' : ''));
  if (c === 'cancelar_pedido') return [{ json: { ruta: 'pedido', numero: num, detallado: true, confirmar_cancelar: true } }];
  if (c === 'enviar') {
    const ag = String(args[1] || '').toLowerCase();
    const codigo = args.slice(2).join(' ');
    if (OPCIONES_ENVIO.indexOf(ag) < 0) return uso('/enviar PB-000101 shalom 12345678-ABCD · olva 26-0123456 · bus Movil Bus:0012345 · local', '/enviar ' + num + ' shalom 12345678-ABCD');
    return [{ json: { ruta: 'cambiar', numero: num, nuevo: 'enviado', agencia: ag, codigo: codigo } }];
  }
  return [{ json: { ruta: 'cambiar', numero: num, nuevo: CAMBIO[c] } }];
}
// ---------- usuarios (admin y dueño; nunca admin) ----------
if (c === 'desconocidos') {
  if (!puede(rol, 'usuarios')) return sinPermiso();
  const l = (cfg.DESCONOCIDOS || []).slice(-10).reverse();
  return R(l.length
    ? 'Escribieron al bot sin estar autorizados (más reciente primero):\n' + l.map(function (d) { return '• <code>' + h(String(d.id)) + '</code> · ' + h(textoSeguro(d.nombre || '', 40) || 'sin nombre') + ' · ' + h(String(d.fecha || '').slice(0, 16).replace('T', ' ')); }).join('\n') +
      '\nSiguiente paso: /autorizar &lt;id&gt; dueno (o marketing) y confirma con el botón.'
    : 'Nadie escribió sin estar autorizado.\nSiguiente paso: pide a la persona que escriba /start al bot y vuelve a usar /desconocidos.');
}
if (c === 'autorizar' || c === 'desautorizar') {
  if (!puede(rol, 'usuarios')) return sinPermiso();
  const id = /^[1-9]\d{0,14}$/.test(args[0] || '') ? Number(args[0]) : 0;
  if (!id) return uso(c === 'autorizar' ? '/autorizar <id> dueno|marketing (el id sale en /desconocidos)' : '/desautorizar <id>', c === 'autorizar' ? '/autorizar 123456789 marketing' : '/desautorizar 123456789');
  if (id === yo) return R('No puedes cambiar tu propio acceso.\nSiguiente paso: pídeselo a otro dueño o al admin.');
  const actual = (cfg.AUTORIZADOS || []).find(function (a) { return a.id === id; });
  if (actual && actual.rol === 'admin') return R('Esa persona es admin: el rol admin no se cambia ni se quita por el bot.\nSiguiente paso: si hace falta, edita AUTORIZADOS en pb_config y ejecuta WF0.');
  const nombre = nombreDe(id);
  const etiqueta = '<code>' + h(String(id)) + '</code>' + (nombre ? ' (' + h(nombre) + ')' : '');
  if (c === 'autorizar') {
    const r0 = sinTildesPd(String(args[1] || '').toLowerCase());
    const rolNuevo = ({ dueno: 'dueno', duena: 'dueno', owner: 'dueno', marketing: 'marketing', mkt: 'marketing' })[r0] || r0;
    if (rolNuevo === 'admin') return R('El rol admin no se asigna por el bot.\nSiguiente paso: usa dueno o marketing.');
    if (!puedeAsignarRol(rol, rolNuevo)) return uso('/autorizar <id> dueno|marketing', '/autorizar ' + id + ' marketing');
    if (actual && actual.rol === rolNuevo) return R(etiqueta + ' ya es ' + h(ROL_TXT[rolNuevo]) + '.\nSiguiente paso: nada.');
    return R('¿Dar acceso a ' + etiqueta + ' como <b>' + h(ROL_TXT[rolNuevo]) + '</b>?' + (actual ? ' Hoy es ' + h(ROL_TXT[actual.rol]) + '.' : '') +
      (rolNuevo === 'dueno' ? ' Podrá publicar cambios, ver datos de clientes y gestionar pedidos y usuarios.' : ' Podrá cambiar productos y contenido, sin datos de clientes.') +
      '\nSiguiente paso: toca Confirmar (vale 10 minutos).',
    botones([[{ text: 'Confirmar', callback_data: 'usr:aut:' + id + ':' + (rolNuevo === 'dueno' ? 'd' : 'm') + ':' + pdCaduca(ahora) }, { text: 'Cancelar', callback_data: 'usr:no' }]]));
  }
  if (!actual) return R(etiqueta + ' no está autorizado.\nSiguiente paso: revisa el id con /desconocidos.');
  if (!puedeAsignarRol(rol, actual.rol)) return R('No puedes quitar el acceso a un ' + h(ROL_TXT[actual.rol]) + '.\nSiguiente paso: pídeselo al admin.');
  return R('¿Quitar el acceso de ' + etiqueta + ' (' + h(ROL_TXT[actual.rol]) + ')? Dejará de poder usar el bot al instante.\nSiguiente paso: toca Confirmar (vale 10 minutos).',
    botones([[{ text: 'Confirmar', callback_data: 'usr:des:' + id + ':' + pdCaduca(ahora) }, { text: 'Cancelar', callback_data: 'usr:no' }]]));
}
return R('No conozco ese comando.\nSiguiente paso: escribe /ayuda para ver la lista.');
function sinTildesPd(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }

//// Responder
// Mensajes ya armados por Interpretar.
return $input.first().json.mensajes.map(function (m) { return { json: m }; });

//// Lista
// @incluir comun
// @incluir comun-pedidos
// /pedidos: abiertos (por pagar, pagados, en preparación), más recientes primero (máx. 15).
const q = $('Interpretar').first().json;
const e = $('Entrada').first().json || {};
const chat = Number((e.trabajo || e).chat_id) || 0;
const filas = $input.all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined && /^PB-\d{6}$/.test(String(j.numero || '')); })
  .sort(function (a, b) { return String(b.numero).localeCompare(String(a.numero)); });
if (!filas.length) return [{ json: enviar(chat, 'No hay pedidos abiertos (por pagar, pagados o en preparación).\nSiguiente paso: nada; te aviso cuando entre uno.') }];
const orden = { pagado: 0, preparando: 1, pendiente_pago: 2 };
const L = ['<b>Pedidos abiertos</b> (' + filas.length + ')'];
filas.sort(function (a, b) { return (orden[a.estado] - orden[b.estado]) || String(b.numero).localeCompare(String(a.numero)); }).slice(0, 15).forEach(function (f) {
  L.push('• <b>' + h(f.numero) + '</b> · ' + h(pdEstadoTexto(f.estado)) + ' · ' + h(pdSoles(f.total)) + ' · ' + h(PD_ENVIO_CORTO[f.opcion_envio] || f.opcion_envio) + ' → ' + h(f.departamento) + ' · ' + h(String(f.fecha || '').slice(5, 16).replace('T', ' ')));
});
if (filas.length > 15) L.push('… y ' + (filas.length - 15) + ' más.');
L.push('Siguiente paso: /pedido ' + filas[0].numero + ' para ver el detalle' + (q.detallado ? ' y avanzar su estado.' : '.'));
return [{ json: enviar(chat, L.join('\n')) }];

//// Revisar pedido
// @incluir validar.js
// @incluir comun-pedidos
// /pedido y /cancelar_pedido: si sigue "pendiente de pago" con Mercado Pago real, se reconsulta el pago (WF14, payments/search) por si
// el aviso no llegó (túnel reiniciado).
const q = $('Interpretar').first().json;
const fila = $input.all().map(function (i) { return i.json; }).find(function (j) { return j && j.id !== undefined && j.numero === q.numero; });
const p = fila ? pedidoDesdeFila(fila) : null;
const reconsultar = !!(p && p.estado === 'pendiente_pago' && p.pago && p.pago.preference_id && !pdEsSimulado(p));
return [{ json: { numero: q.numero, pedido: p, reconsultar: reconsultar } }];

//// Detalle
// @incluir validar.js
// @incluir comun
// @incluir comun-pedidos
const q = $('Interpretar').first().json;
const cfg = $('Config').first().json;
const e = $('Entrada').first().json || {};
const chat = Number((e.trabajo || e).chat_id) || 0;
const rp = $('Revisar pedido').first().json;
let p = rp.pedido;
let nota = '';
if ($('WF14 reconsultar').isExecuted) {
  const s = $('WF14 reconsultar').first().json || {};
  if (s.pedido && s.pedido.numero === q.numero) p = s.pedido;
  nota = s.cambio ? '\n<i>Actualizado con Mercado Pago ahora mismo.</i>' : s.ok ? '' : '\n<i>Mercado Pago aún no registra un pago para este pedido.</i>';
}
if (!p) return [{ json: enviar(chat, 'No encontré el pedido ' + h(q.numero) + '.\nSiguiente paso: revisa el número con /pedidos.') }];
const site = await pdSite(this, cfg, $getWorkflowStaticData('global'));
if (q.confirmar_cancelar) {
  if ((TRANSICIONES_PEDIDO[p.estado] || []).indexOf('cancelado') < 0) return [{ json: enviar(chat, h(p.numero) + ' está ' + h(pdEstadoTexto(p.estado).toLowerCase()) + ' y ya no se puede cancelar.\nSiguiente paso: nada.') }];
  return [{ json: enviar(chat, '¿Cancelar este pedido?\n' + pdTextoPedido(p, site, true) + (p.pago.estado === 'aprobado' ? '\n<b>Está pagado</b>: después tendrás que devolver el dinero desde Mercado Pago.' : '') +
    '\nSiguiente paso: toca Confirmar (vale 10 minutos).',
  botones([[{ text: 'Sí, cancelar', callback_data: 'ped:can:' + p.numero.replace(/\D/g, '') + ':' + pdCaduca(Date.now()) }, { text: 'No', callback_data: 'ped:no' }]])) }];
}
return [{ json: enviar(chat, pdTextoPedido(p, site, q.detallado) + nota + '\nSiguiente paso: ' + h(q.detallado ? pdSiguientePaso(p) : 'nada; los cambios de estado los hace el dueño.')) }];

//// Transición
// @incluir validar.js
// @incluir comun
// @incluir comun-pedidos
// transicionPedido de validar.js (transiciones permitidas, código de seguimiento por agencia y URL de rastreo).
const q = $('Interpretar').first().json;
const cfg = $('Config').first().json;
const e = $('Entrada').first().json || {};
const chat = Number((e.trabajo || e).chat_id) || 0;
const fila = $input.all().map(function (i) { return i.json; }).find(function (j) { return j && j.id !== undefined && j.numero === q.numero; });
const p = fila ? pedidoDesdeFila(fila) : null;
const fin = function (texto) { return [{ json: { guardar: false, mensajes: (q.mensajes_previos || []).concat([enviar(chat, texto)]) } }]; };
if (!p) return fin('No encontré el pedido ' + h(q.numero) + '.\nSiguiente paso: revisa el número con /pedidos.');
const site = await pdSite(this, cfg, $getWorkflowStaticData('global'));
const datos = {};
if (q.nuevo === 'enviado') { datos.agencia = q.agencia; datos.codigo = q.codigo; }
if (q.nota) datos.nota = q.nota;
const r = transicionPedido(p, q.nuevo, datos, site);
if (!r.ok) return fin('No cambié ' + h(p.numero) + ': ' + h(pdErroresPublicos(r.errores).join(' ')) + '\nSiguiente paso: ' + h(pdSiguientePaso(p)));
if (!r.cambio) return fin(h(p.numero) + ' ya estaba en "' + h(pdEstadoTexto(q.nuevo)) + '".\nSiguiente paso: nada.');
return [{ json: { guardar: true, numero: p.numero, actualizado_previo: String(fila.actualizado || ''), fila: filaPedido(r.pedido), pedido: r.pedido, avisos: r.avisos } }];

//// Avisos cambio
// @incluir comun
// @incluir comun-pedidos
const q = $('Interpretar').first().json;
const tr = $('Transición').first().json;
const e = $('Entrada').first().json || {};
const chat = Number((e.trabajo || e).chat_id) || 0;
if (!tr.guardar) return tr.mensajes.map(function (m) { return { json: m }; });
const ok = $input.all().some(function (i) { return i.json && i.json.id !== undefined && i.json.numero === tr.numero; });
const previos = (q.mensajes_previos || []).map(function (m) { return { json: m }; });
if (!ok) return previos.concat([{ json: enviar(chat, 'Otra persona cambió ' + h(tr.numero) + ' al mismo tiempo; no guardé tu cambio.\nSiguiente paso: revisa con /pedido ' + h(tr.numero) + ' y vuelve a intentarlo.') }]);
const p = tr.pedido;
const reembolso = (tr.avisos || []).some(function (a) { return /^\[reembolso\]/.test(a); });
const seg = p.seguimiento && p.estado === 'enviado' ? ' (' + h(PD_ENVIO_CORTO[p.seguimiento.agencia] || p.seguimiento.agencia) + (p.seguimiento.codigo ? ' · ' + h(p.seguimiento.codigo) : '') + ')' : '';
const texto = 'Listo: <b>' + h(p.numero) + '</b> → ' + h(pdEstadoTexto(p.estado)) + seg + '. El cliente lo ve en "Seguimiento de pedido" de la web y en el chat con Vale.' +
  (reembolso ? '\n<b>Estaba pagado</b>: devuelve el dinero desde Mercado Pago.' : '') +
  (p.seguimiento && p.seguimiento.agencia === 'shalom' && p.estado === 'enviado' ? '\nRecuerda: la clave de 4 dígitos de Shalom se le envía al cliente por privado (nunca va en la web).' : '') +
  '\nSiguiente paso: ' + h(pdSiguientePaso(p));
return previos.concat([{ json: enviar(chat, texto) }]);

//// Cambiar autorizados
// @incluir validar.js
// @incluir comun
// @incluir comun-pedidos
// Botón confirmado: AUTORIZADOS (JSON de pb_config, tal como está, con sus filas de ejemplo id 0) + o - una persona.
// Se vuelven a revisar las reglas con el rol ACTUAL de quien tocó el botón (puedeAsignarRol; nunca admin; nunca uno mismo).
const q = $('Interpretar').first().json;
const cfg = $('Config').first().json;
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
const chat = Number(t.chat_id) || 0;
const yo = Number(t.from_id) || 0;
const rol = rolDe(cfg, yo) || '';
const fila = $input.all().map(function (i) { return i.json; }).find(function (j) { return j && j.clave === 'AUTORIZADOS'; });
const fin = function (texto) { return [{ json: { guardar: false, mensajes: (q.mensajes_previos || []).concat([enviar(chat, texto)]) } }]; };
if (!fila) return fin('No encontré AUTORIZADOS en pb_config.\nSiguiente paso: ejecuta WF0 Setup.');
const previo = String(fila.valor === null || fila.valor === undefined ? '' : fila.valor);
let lista;
try { lista = JSON.parse(previo); } catch (x) { lista = null; }
if (!Array.isArray(lista)) return fin('AUTORIZADOS de pb_config no es una lista JSON válida; no lo toqué.\nSiguiente paso: corrígelo a mano y ejecuta WF0.');
const actual = lista.find(function (a) { return a && Number(a.id) === q.id; });
if (q.id === yo) return fin('No puedes cambiar tu propio acceso.\nSiguiente paso: nada.');
if (actual && actual.rol === 'admin') return fin('Esa persona es admin: no se cambia por el bot.\nSiguiente paso: nada.');
let nuevo, texto;
const nombreD = ((cfg.DESCONOCIDOS || []).slice().reverse().find(function (d) { return d && Number(d.id) === q.id; }) || {}).nombre || '';
if (q.accion === 'autorizar') {
  if (!puedeAsignarRol(rol, q.rol_nuevo)) return fin('Tu rol no puede asignar ese rol.\nSiguiente paso: pídeselo al admin.');
  if (actual) { nuevo = lista.map(function (a) { return a === actual ? Object.assign({}, a, { rol: q.rol_nuevo }) : a; }); }
  else nuevo = lista.concat([{ id: q.id, rol: q.rol_nuevo, nombre: textoSeguro(nombreD || 'Autorizado por bot', 60) }]);
  texto = 'autorizar';
} else {
  if (!actual) return fin('<code>' + h(String(q.id)) + '</code> ya no estaba autorizado.\nSiguiente paso: nada.');
  if (!puedeAsignarRol(rol, actual.rol)) return fin('Tu rol no puede quitar ese acceso.\nSiguiente paso: pídeselo al admin.');
  nuevo = lista.filter(function (a) { return !(a && Number(a.id) === q.id); });
  texto = 'desautorizar';
}
return [{ json: { guardar: true, previo: previo, nuevo: JSON.stringify(nuevo), accion: texto, id: q.id, rol_nuevo: q.rol_nuevo, nombre: textoSeguro((actual && actual.nombre) || nombreD || '', 40) } }];

//// Avisos usuarios
// @incluir comun
// @incluir comun-pedidos
// Guardado: confirma a quien lo pidió y publica (o borra) el menú de comandos de esa persona; al nuevo le da la bienvenida.
const q = $('Interpretar').first().json;
const ca = $('Cambiar autorizados').first().json;
const e = $('Entrada').first().json || {};
const chat = Number((e.trabajo || e).chat_id) || 0;
if (!ca.guardar) return ca.mensajes.map(function (m) { return { json: m }; });
const ok = $input.all().some(function (i) { return i.json && i.json.id !== undefined && i.json.clave === 'AUTORIZADOS'; });
const out = (q.mensajes_previos || []).slice();
const etiqueta = '<code>' + h(String(ca.id)) + '</code>' + (ca.nombre ? ' (' + h(ca.nombre) + ')' : '');
if (!ok) out.push(enviar(chat, 'AUTORIZADOS cambió mientras confirmabas; no guardé nada.\nSiguiente paso: vuelve a escribir el comando.'));
else if (ca.accion === 'autorizar') {
  const rolTxt = ca.rol_nuevo === 'dueno' ? 'dueño' : 'marketing';
  out.push({ metodo: 'setMyCommands', cuerpo: { commands: comandosDeRol(ca.rol_nuevo), scope: { type: 'chat', chat_id: ca.id } } });
  out.push(enviar(ca.id, 'Hola' + (ca.nombre ? ' ' + h(ca.nombre) : '') + ', ya tienes acceso al bot de Palmera Brava como <b>' + rolTxt + '</b>.\nSiguiente paso: escribe /ayuda para ver lo que puedes hacer.'));
  out.push(enviar(chat, 'Listo: ' + etiqueta + ' ahora es <b>' + rolTxt + '</b> (efecto inmediato) y ya ve su menú de comandos.\nSiguiente paso: pídele que escriba /ayuda.'));
} else {
  out.push({ metodo: 'deleteMyCommands', cuerpo: { scope: { type: 'chat', chat_id: ca.id } } });
  out.push(enviar(chat, 'Listo: ' + etiqueta + ' ya no tiene acceso al bot (efecto inmediato).\nSiguiente paso: nada.'));
}
return out.map(function (m) { return { json: m }; });

//// Salida
// Para WF4: el trabajo terminó (las respuestas de Telegram no cuentan como fallo).
return [{ json: { ok: true } }];
