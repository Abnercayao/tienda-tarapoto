//// Config
// @incluir comun
return [{ json: armarConfig($input.all().map(function (i) { return i.json; })) }];

//// Interpretar
// @incluir validar.js
// @incluir comun
// @incluir negocio
// Comando -> ruta. Permiso con el rol ACTUAL (puede() de validar.js; marketing no usa borrar/whatsapp/limpiar_muestras/deshacer/pausa/reanudar).
// Toda escritura se arma como operación y va a WF3 (borrador + botón Publicar). Consultas y /pausa, /reanudar, /cancelar no crean borrador.
const cfg = $('Config').first().json;
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
const ALIAS = { help: 'ayuda', comandos: 'ayuda', inicio: 'start' };
const c = ALIAS[String(t.comando || '').toLowerCase()] || String(t.comando || '').toLowerCase();
const args = (Array.isArray(t.args) ? t.args : []).map(function (a) { return String(a).trim(); }).filter(Boolean);
const rol = String(t.rol || '');
const chat = Number(t.chat_id) || 0;
const R = function (texto) { return [{ json: { ruta: 'responder', mensajes: [enviar(chat, texto)] } }]; };
const W3 = function (op) {
  return [{ json: Object.assign({}, t, { ruta: 'borrador', trabajo: t, modo: 'operacion', tipo_entidad: op.entidad === 'articulo' ? 'articulo' : 'producto', operacion: op, draft_id: '' }) }];
};
const uso = function (forma, ejemplo) { return R('Uso: ' + h(forma) + '\nSiguiente paso: escribe, por ejemplo, ' + h(ejemplo) + '.'); };
const ACCION = {
  start: 'consulta', ayuda: 'consulta', lista: 'consulta', ver: 'consulta', estado: 'consulta', historial: 'consulta',
  precio: 'actualizar', frescura: 'actualizar', stock: 'stock', ocultar: 'desactivar', mostrar: 'reactivar', foto: 'agregar_imagen', articulo: 'articulo',
  articulo_ocultar: 'articulo', imagen: 'imagen', cancelar: 'publicar', borrar: 'borrar', whatsapp: 'whatsapp',
  limpiar_muestras: 'limpiar_muestras', deshacer: 'deshacer', pausa: 'pausa', reanudar: 'reanudar', ids: 'ids',
  // v3 (WF16): ver pedidos y envíos = todos (marketing sin datos de contacto); cambios de estado y usuarios = admin y dueño.
  envios: 'consulta', pedidos: 'consulta', pedido: 'consulta', boton_pedidos: 'consulta',
  preparando: 'pedidos', enviar: 'pedidos', recojo: 'pedidos', entregado: 'pedidos', cancelar_pedido: 'pedidos',
  desconocidos: 'usuarios', autorizar: 'usuarios', desautorizar: 'usuarios'
};
const WF16 = ['envios', 'pedidos', 'pedido', 'boton_pedidos', 'preparando', 'enviar', 'recojo', 'entregado', 'cancelar_pedido', 'desconocidos', 'autorizar', 'desautorizar'];
if (!ACCION[c]) return R('No conozco ese comando.\nSiguiente paso: escribe /ayuda para ver la lista.');
const acc = ACCION[c];
if (!(acc === 'ids' ? rol === 'admin' : puede(rol, acc))) return R('Tu rol (' + h(rol || 'sin rol') + ') no puede usar /' + c + '.\nSiguiente paso: pídeselo al dueño o al admin.');
const reP = /^prd-\d{4,6}$/;
const reA = /^art-\d{4,6}$/;
const id0 = (args[0] || '').toLowerCase();
if (c === 'start' || c === 'ayuda') return R(nbAyuda(rol, t.nombre, c === 'start'));
if (WF16.indexOf(c) >= 0) return [{ json: Object.assign({}, t, { ruta: 'pedidos', trabajo: t, comando: c }) }];
if (c === 'ids') {
  const l = (cfg.DESCONOCIDOS || []).slice(-10).reverse();
  return R(l.length
    ? 'Escribieron sin estar autorizados (más reciente primero):\n' + l.map(function (d) { return h(String(d.id)) + ' · ' + h(textoSeguro(d.nombre || '', 40)) + ' · ' + h(String(d.fecha || '').slice(0, 16)); }).join('\n') +
      '\nSiguiente paso: copia el id a AUTORIZADOS (Data Table pb_config) y vuelve a ejecutar WF0 Setup.'
    : 'Nadie escribió sin estar autorizado.\nSiguiente paso: pide a la persona que escriba /start al bot y vuelve a usar /ids.');
}
if (c === 'lista') return [{ json: { ruta: 'consulta', cmd: 'lista', filtro: quitarTildes(args.join(' ')).toLowerCase() } }];
if (c === 'ver') {
  if (!reP.test(id0) && !reA.test(id0)) return uso('/ver prd-0001 o /ver art-0001', '/ver prd-0001');
  return [{ json: { ruta: 'consulta', cmd: 'ver', id: id0 } }];
}
if (c === 'estado') return [{ json: { ruta: 'estado', owner_id: Number(t.from_id) || -1 } }];
if (c === 'historial') return [{ json: { ruta: 'historial', modo: 'historial', trabajo: t, chat_id: chat, enviar: true } }];
if (c === 'deshacer') return [{ json: { ruta: 'deshacer', modo: 'historial', trabajo: t, chat_id: chat, enviar: false } }];
if (c === 'pausa' || c === 'reanudar') return [{ json: { ruta: 'pausa', valor: c === 'pausa' ? '1' : '0' } }];
if (c === 'cancelar') return [{ json: { ruta: 'cancelar', owner_id: Number(t.from_id) || -1 } }];
if (c === 'precio') {
  const U = ['/precio prd-0001 69.90 [oferta 59.90 | sin oferta]', '/precio prd-0001 69.90'];
  if (!reP.test(id0)) return uso(U[0], U[1]);
  const r = args.slice(1).map(function (a) { return a.toLowerCase(); });
  const campos = {};
  for (let i = 0; i < r.length; i++) {
    if (r[i] === 's/' || r[i] === 's/.' || r[i] === 'soles' || r[i] === 'a') continue;
    if (r[i] === 'sin' && r[i + 1] === 'oferta') { campos.precio_oferta = 0; i++; continue; }
    if (r[i] === 'oferta') {
      let j = i + 1;
      if (r[j] === 'a' || r[j] === 's/') j++;
      const n = nbNumero(r[j]);
      if (n === null || n <= 0) return uso(U[0], U[1]);
      campos.precio_oferta = n; i = j; continue;
    }
    const n = nbNumero(r[i]);
    if (n === null || n <= 0 || campos.precio !== undefined) return uso(U[0], U[1]);
    campos.precio = n;
  }
  if (campos.precio === undefined && campos.precio_oferta === undefined) return uso(U[0], U[1]);
  return W3({ op: 'actualizar', entidad: 'producto', id: id0, campos: campos });
}
if (c === 'stock') {
  // v4: "/stock <id> <color> <talla> <n>" (stock por color Y talla, 0 a 15). También "<color> <n>" (todas las tallas de ese color),
  // "<talla> <n>" (esa talla en todos los colores), +n (llegaron) y -n (vendidos). La clave puede tener varias palabras ("Blanco hueso M").
  // Lo decide WF3, que tiene el catálogo; aquí solo se separan las claves de las cantidades.
  const U = ['/stock prd-0001 Blanco M 5 (unidades de esa talla y color, de 0 a 15), Blanco M +2 (llegaron), Blanco M -1 (vendido); sin talla afecta todas las tallas del color: /stock prd-0001 Blanco 5; varios: /stock prd-0001 Blanco M 5 Arena L 3', '/stock prd-0001 Blanco M 5'];
  const r = args.slice(1);
  if (!reP.test(id0) || !r.length) return uso(U[0], U[1]);
  const items = [];
  let palabras = [];
  let modo = null;
  const esNum = function (x) { return /^[+-]?\d{1,4}$/.test(String(x === undefined ? '' : x).replace('−', '-')); };
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const m = /^([+-]?)(\d{1,4})$/.exec(a.replace('−', '-'));
    // Un número sin signo seguido de otro número es una talla (Negro 38 5): la cantidad es el último.
    if (!m || (m[1] === '' && esNum(r[i + 1]))) { palabras.push(a); continue; }
    const clave = textoSeguro(palabras.join(' '), 30);
    palabras = [];
    if (!clave || items.some(function (x) { return claveColor(x.clave) === claveColor(clave); })) return uso(U[0], U[1]);
    const md = m[1] === '+' ? 'sumar' : m[1] === '-' ? 'restar' : 'fijar';
    if (modo && modo !== md) return R('En un mismo /stock usa solo totales (Blanco M 5), solo sumas (Blanco M +2) o solo restas (Blanco M -1).\nSiguiente paso: envía un /stock por cada tipo de cambio.');
    modo = md;
    items.push({ clave: clave, cantidad: Number(m[2]) });
  }
  if (palabras.length || !items.length || items.length > 8) return uso(U[0], U[1]);
  return W3({ op: 'stock', entidad: 'producto', id: id0, campos: { stock_items: items, stock_modo: modo } });
}
if (c === 'frescura') {
  // v2: índice de frescura (1 a 5 hojitas) que se ve en la web.
  const n = /^[1-5]$/.test(args[1] || '') ? Number(args[1]) : null;
  if (!reP.test(id0) || n === null || args.length > 2) return uso('/frescura prd-0001 5 (de 1 a 5 hojitas: lino 5, algodón 4, dri-fit 3, denim 2)', '/frescura prd-0001 5');
  return W3({ op: 'actualizar', entidad: 'producto', id: id0, campos: { frescura: n } });
}
if (c === 'ocultar' || c === 'mostrar') {
  if (!reP.test(id0) && !reA.test(id0)) return uso('/' + c + ' prd-0001 (o un artículo: art-0001)', '/' + c + ' prd-0001');
  return W3({ op: c === 'ocultar' ? 'desactivar' : 'reactivar', entidad: reA.test(id0) ? 'articulo' : 'producto', id: id0, campos: {} });
}
if (c === 'articulo_ocultar') {
  if (!reA.test(id0)) return uso('/articulo_ocultar art-0001', '/articulo_ocultar art-0001');
  return W3({ op: 'desactivar', entidad: 'articulo', id: id0, campos: {} });
}
if (c === 'foto') {
  if (!reP.test(id0)) return uso('envía una foto con la leyenda /foto prd-0001', '/foto prd-0001 como leyenda de la foto');
  if (!Array.isArray(t.fotos) || !t.fotos.length) return R('Para agregar una foto envíala con la leyenda /foto ' + h(id0) + ' (en el mismo mensaje).\nSiguiente paso: adjunta la foto y escribe esa leyenda.');
  return W3({ op: 'agregar_imagen', entidad: 'producto', id: id0, campos: {} });
}
if (c === 'borrar') {
  if (!reP.test(id0)) return uso('/borrar prd-0001 (elimina el producto; pide doble confirmación). Para solo esconderlo usa /ocultar.', '/borrar prd-0001');
  return W3({ op: 'eliminar', entidad: 'producto', id: id0, campos: {} });
}
if (c === 'whatsapp') {
  let w = args.join('').replace(/\D/g, '');
  if (/^9\d{8}$/.test(w)) w = '51' + w;
  if (!/^51\d{9}$/.test(w)) return uso('/whatsapp 51987654321 (51 + los 9 dígitos del celular)', '/whatsapp 51987654321');
  return W3({ op: 'whatsapp', entidad: 'sitio', id: 'site', campos: { whatsapp: w } });
}
if (c === 'limpiar_muestras') {
  const n = args[0] && /^\d{1,4}$/.test(args[0]) ? Number(args[0]) : null;
  return W3({ op: 'limpiar_muestras', entidad: 'producto', id: null, campos: { cantidad_confirmada: n } });
}
if (c === 'articulo') {
  const tema = textoSeguro(args.join(' '), 300);
  if (Array.from(tema).length < 5) return uso('/articulo tema del artículo', '/articulo cómo vestir fresco en la selva');
  const tt = Object.assign({}, t, { texto: tema, fotos: [] });
  return [{ json: Object.assign({}, tt, { ruta: 'borrador', trabajo: tt, modo: 'llm', tipo_entidad: 'articulo', draft_id: '' }) }];
}
if (c === 'imagen') {
  let objetivo = '';
  let resto = args;
  if (/^(art-\d{4,6}|look-\d{1,3})$/i.test(args[0] || '')) { objetivo = args[0].toLowerCase(); resto = args.slice(1); }
  const prompt = resto.join(' ').trim();
  if (Array.from(prompt).length < 3 || Array.from(prompt).length > 500 || /[<>]/.test(prompt)) return uso('/imagen [art-0001|look-1] descripción (3 a 500 caracteres)', '/imagen sombrero de palma sobre una mesa de madera');
  return [{ json: { ruta: 'imagen', prompt: prompt, objetivo: objetivo, chat_id: chat, from_id: Number(t.from_id) || 0, rol: rol, nombre: String(t.nombre || ''), origen: 'telegram', trabajo: t } }];
}
return R('No conozco ese comando.\nSiguiente paso: escribe /ayuda para ver la lista.');

//// Responder
// @incluir comun
const m = $input.first().json.mensajes;
if (Array.isArray(m) && m.length) return m.map(function (x) { return { json: x }; });
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
return [{ json: enviar(t.chat_id, 'No conozco ese comando.\nSiguiente paso: escribe /ayuda para ver la lista.') }];

//// Consulta
// @incluir validar.js
// @incluir comun
// @incluir negocio
// /lista [categoria|articulos|ocultos] y /ver <id>, leídos de GitHub (rama configurada): lo que ve la web.
const cfg = $('Config').first().json;
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
const q = $('Interpretar').first().json;
const dp = nbDoc($('GET productos').first().json);
const da = nbDoc($input.first().json);
if (!dp || !da || !Array.isArray(dp.productos) || !Array.isArray(da.articulos)) return [{ json: enviar(t.chat_id, 'No pude leer el catálogo de GitHub.\nSiguiente paso: inténtalo de nuevo en unos minutos.') }];
const P = dp.productos.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
const A = da.articulos.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
const marcas = function (x) { return (x.activo === false ? ' · OCULTO' : '') + (x.muestra === true ? ' · muestra' : ''); };
const precio = function (p) { return nbSoles(p.precio) + (typeof p.precio_oferta === 'number' ? ' (oferta ' + nbSoles(p.precio_oferta) + ')' : ''); };
if (q.cmd === 'ver') {
  let L = [];
  let sig;
  if (q.id.indexOf('prd-') === 0) {
    const p = P.find(function (x) { return x.id === q.id; });
    if (!p) return [{ json: enviar(t.chat_id, 'No existe ' + h(q.id) + ' en el catálogo publicado.\nSiguiente paso: usa /lista para ver los ids.') }];
    const fr = inferirFrescura(p);
    const color1 = ((p.colores || [])[0] || {}).nombre || 'Blanco';
    const talla1 = (p.tallas || [])[0] || 'M';
    // v4: matriz color x talla (0 = agotado) y totales derivados.
    const spv = p.stock_por_variante && typeof p.stock_por_variante === 'object' ? p.stock_por_variante : {};
    const lineaStock = ['tallas: ' + h((p.tallas || []).join(' ')),
      'stock por color y talla (total ' + (Number(p.stock) || 0) + '):'].concat((p.colores || []).map(function (x) {
      const f = spv[x.nombre] || {};
      return '  ' + h(x.nombre) + ': ' + (p.tallas || []).map(function (t) { const q = Number(f[t]) || 0; return t + ' ' + (q === 0 ? '0 (agotado)' : q); }).join(', ') + ' (' + (Number(p.stock_por_color && p.stock_por_color[x.nombre]) || 0) + ')';
    }));
    L = ['<b>' + h(p.id) + ' · ' + h(p.nombre) + '</b>', 'categoría: ' + h(p.categoria) + ' / ' + h(p.subcategoria || 'otros'), 'precio: ' + precio(p)].concat(lineaStock, [
      p.material ? 'material: ' + h(p.material) : '',
      'frescura: ' + nbHojitas(fr.valor) + (fr.valor !== null && fr.fuente !== 'dato' ? ' (calculada por la tela)' : ''),
      'visible en la web: ' + (p.activo === false ? 'no' : 'sí') + ' · muestra: ' + (p.muestra ? 'sí' : 'no') + ' · destacado: ' + (p.destacado ? 'sí' : 'no'),
      'fotos: ' + (p.imagenes || []).length + ((p.imagenes || []).some(function (i) { return i.origen === 'ia_local'; }) ? ' (alguna generada con IA)' : ''),
      p.descripcion ? 'descripción: ' + h(textoSeguro(p.descripcion, 300)) : '']).filter(Boolean);
    sig = 'Siguiente paso: para cambiarlo usa /precio ' + p.id + ' 69.90, /stock ' + p.id + ' ' + h(color1 + ' ' + talla1 + ' 5') + ', /frescura ' + p.id + ' 5 o /' + (p.activo === false ? 'mostrar ' : 'ocultar ') + p.id + '.';
  } else {
    const a = A.find(function (x) { return x.id === q.id; });
    if (!a) return [{ json: enviar(t.chat_id, 'No existe ' + h(q.id) + ' entre los artículos publicados.\nSiguiente paso: usa /lista articulos para ver los ids.') }];
    L = ['<b>' + h(a.id) + ' · ' + h(a.titulo) + '</b>', 'resumen: ' + h(textoSeguro(a.resumen || '', 240)), 'fecha: ' + h(String(a.fecha || '').slice(0, 10)),
      'visible en la web: ' + (a.activo === false ? 'no' : 'sí') + ' · muestra: ' + (a.muestra ? 'sí' : 'no'),
      'contenido: ' + (a.bloques || []).length + ' bloques', 'productos relacionados: ' + h((a.productos_relacionados || []).join(', ') || 'ninguno')];
    sig = 'Siguiente paso: para cambiar la portada usa /imagen ' + a.id + ' descripción; para esconderlo, /articulo_ocultar ' + a.id + '.';
  }
  return [{ json: enviar(t.chat_id, L.join('\n') + '\n' + sig) }];
}
const f = q.filtro;
const CAT = { hombres: 'hombres', hombre: 'hombres', mujeres: 'mujeres', mujer: 'mujeres', damas: 'mujeres', ninos: 'ninos', nino: 'ninos', ninas: 'ninos', nina: 'ninos', accesorios: 'accesorios' };
let titulo;
let lineas;
if (/^articulos?$/.test(f)) {
  titulo = 'Artículos (' + A.length + ')';
  lineas = A.map(function (a) { return h(a.id) + ' · ' + h(textoSeguro(a.titulo, 70)) + marcas(a); });
} else {
  let lista = P;
  if (f && CAT[f]) { lista = P.filter(function (p) { return p.categoria === CAT[f]; }); titulo = 'Productos de ' + CAT[f]; }
  else if (/^ocultos?$/.test(f)) { lista = P.filter(function (p) { return p.activo === false; }); titulo = 'Productos ocultos'; }
  else if (/^muestras?$/.test(f)) { lista = P.filter(function (p) { return p.muestra === true; }); titulo = 'Productos de muestra'; }
  else if (f) return [{ json: enviar(t.chat_id, 'No conozco el filtro "' + h(textoSeguro(f, 30)) + '".\nSiguiente paso: usa /lista, /lista hombres, /lista mujeres, /lista ninos, /lista accesorios, /lista ocultos o /lista articulos.') }];
  else titulo = 'Productos';
  titulo += ' (' + lista.length + ')';
  lineas = lista.map(function (p) { return h(p.id) + ' · ' + h(textoSeguro(p.nombre, 50)) + ' · ' + precio(p) + ' · stock ' + (Number(p.stock) || 0) + marcas(p); });
}
let cuerpo = '<b>' + h(titulo) + '</b>' + (lineas.length ? '' : '\n(ninguno)');
let n = 0;
for (const l of lineas) { if (cuerpo.length + l.length > 3600) break; cuerpo += '\n' + l; n++; }
if (n < lineas.length) cuerpo += '\n… y ' + (lineas.length - n) + ' más (filtra por categoría).';
return [{ json: enviar(t.chat_id, cuerpo + '\nSiguiente paso: usa /ver ' + (/^articulos?$/.test(f) ? 'art-0001' : 'prd-0001') + ' para ver el detalle.') }];

//// Estado
// @incluir comun
// Cola de pb_inbox, aprobados por publicar, pausa, pendientes del autor y último commit del bot.
const cfg = $('Config').first().json;
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
const filas = function (n) { return $(n).all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined; }); };
const cola = filas('Inbox nuevo').length;
const aprob = filas('Aprobados').length;
const mios = filas('Mis pendientes');
const ahora = Date.now();
const espera = Math.max(0, cfg.ULTIMO_COMMIT_AT + cfg.MIN_ENTRE_COMMITS_MS - ahora);
const L = ['<b>Estado de Palmera Brava</b>',
  'Publicación: ' + (cfg.PAUSA === 1 ? 'EN PAUSA (usa /reanudar)' : 'activa'),
  'Mensajes en cola: ' + cola + (cola >= 100 ? '+' : ''),
  'Borradores aprobados sin publicar: ' + aprob + (aprob && cfg.PAUSA !== 1 ? (espera ? ' (próximo lote en ~' + Math.ceil(espera / 60000) + ' min)' : ' (salen en el próximo ciclo)') : ''),
  'Tus borradores pendientes: ' + mios.length + (mios.length ? ' (' + h(mios.slice(0, 5).map(function (b) { return b.draft_id; }).join(', ')) + ')' : ''),
  'Último cambio publicado por el bot: ' + (cfg.ULTIMO_COMMIT_AT ? h(isoLima(cfg.ULTIMO_COMMIT_AT).slice(0, 16).replace('T', ' ')) + ' (hace ' + Math.round((ahora - cfg.ULTIMO_COMMIT_AT) / 60000) + ' min)' : 'todavía ninguno')];
if (cfg.FALLOS_SEGUIDOS > 0) L.push('Fallos seguidos leyendo Telegram: ' + cfg.FALLOS_SEGUIDOS);
const sig = cfg.PAUSA === 1 ? 'usa /reanudar para publicar lo aprobado.' : mios.length ? 'revisa tus borradores pendientes (toca Publicar o Cancelar) o usa /cancelar.' : 'nada; todo está al día.';
return [{ json: enviar(t.chat_id, L.join('\n') + '\nSiguiente paso: ' + sig) }];

//// Armar deshacer
// @incluir comun
// /deshacer (D17): solo si el HEAD de la rama es un commit del bot. El borrador guarda head_sha; WF5 vuelve a comprobarlo al publicar.
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
const r = $input.first().json || {};
const msg = function (texto) { return [{ json: Object.assign({ ir: 'msg' }, enviar(t.chat_id, texto)) }]; };
if (r.ok !== true) return msg('No pude leer el historial de GitHub.\nSiguiente paso: inténtalo de nuevo en unos minutos.');
if (!r.head_es_bot) return msg('El último cambio de la rama no lo hizo el bot, así que /deshacer no está disponible (solo revierte cambios del bot).\nSiguiente paso: usa /historial para ver los cambios del bot.');
if (!/^[0-9a-f]{40}$/.test(String(r.head_sha || '')) || !/^[0-9a-f]{40}$/.test(String(r.parent_sha || ''))) return msg('No encontré el commit anterior al último cambio.\nSiguiente paso: avisa al admin.');
const op = { op: 'deshacer', entidad: 'sitio', id: r.head_sha.slice(0, 7), campos: { head_sha: r.head_sha, head_mensaje: String(r.head_mensaje || '').slice(0, 200), parent_sha: r.parent_sha } };
return [{ json: Object.assign({}, t, { ir: 'wf3', trabajo: t, modo: 'operacion', tipo_entidad: 'producto', operacion: op, draft_id: '' }) }];

//// Pausa
// @incluir comun
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
const q = $('Interpretar').first().json;
const ok = $input.all().some(function (i) { return i.json && i.json.id !== undefined; });
if (!ok) return [{ json: enviar(t.chat_id, 'No encontré la clave PAUSA en pb_config.\nSiguiente paso: pide al admin que ejecute WF0 Setup.') }];
return [{ json: enviar(t.chat_id, q.valor === '1'
  ? 'Publicación en pausa: los borradores aprobados esperan y no se hace ningún commit.\nSiguiente paso: usa /reanudar cuando quieras publicar.'
  : 'Publicación reanudada: lo aprobado sale en el próximo lote (mínimo 6 min entre commits).\nSiguiente paso: nada; te aviso cuando esté publicado.') }];

//// Ids cancelados
const filas = $input.all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined && j.draft_id; });
if (!filas.length) return [{ json: { draft_id: 'ninguno' } }];
return filas.map(function (f) { return { json: { draft_id: f.draft_id } }; });

//// Cancelados
// @incluir comun
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
const filas = $('Cancelar pendientes').all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined && j.draft_id; });
if (!filas.length) return [{ json: enviar(t.chat_id, 'No tenías borradores pendientes.\nSiguiente paso: envía una foto o un comando cuando quieras.') }];
const out = filas.filter(function (f) { return Number(f.preview_message_id) > 0; }).map(function (f) { return quitarTeclado(t.chat_id, f.preview_message_id); });
out.push(enviar(t.chat_id, 'Cancelé ' + filas.length + ' borrador' + (filas.length === 1 ? '' : 'es') + ' pendiente' + (filas.length === 1 ? '' : 's') + ' (' + h(filas.slice(0, 8).map(function (f) { return f.draft_id; }).join(', ')) + '). No se publicó nada.\nSiguiente paso: envía otro mensaje cuando quieras.'));
return out.map(function (m) { return { json: m }; });

//// Salida
// @incluir comun
// Salida común: {ok:true} | lo que devolvió WF3/WF5/WF6 si fue ok:false | {ok:false, reintentar:true} si el sub-workflow falló.
// Las respuestas de Telegram (ok/description/result) no cuentan como fallo del trabajo.
const s = ($input.first() && $input.first().json) || {};
const esTelegram = s.result !== undefined || s.error_code !== undefined || s.description !== undefined;
if (!esTelegram && s.ok === false) return [{ json: { ok: false, reintentar: s.reintentar === true, error: censurar(String(s.error || 'sub-workflow sin éxito')).slice(0, 300) } }];
if (!esTelegram && s.error !== undefined && s.ok === undefined) {
  const m = typeof s.error === 'string' ? s.error : (s.error && (s.error.message || s.error.description)) || 'error en el sub-workflow';
  return [{ json: { ok: false, reintentar: true, error: censurar(m).slice(0, 300) } }];
}
return [{ json: { ok: true, draft_id: s.draft_id || '' } }];
