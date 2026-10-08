//// Entrada
// @incluir comun-pedidos
// Solicitud de la web (o del chat) reenviada por tools/chat-proxy.py (POST /pedido): CONTRATO 00.7.
//   {cliente{nombre, correo, telefono, dni?}, envio{opcion, departamento, provincia, distrito, direccion?, referencia?, agencia_destino?},
//    items[{id, color, talla, cantidad}], total_visto?, origen?: "web"|"chat"}
// Los precios del navegador NO se leen: el total sale del catálogo publicado (crearPedido de validar.js).
const w = $('POST pedido-crear').first().json || {};
const b = w.body && typeof w.body === 'object' && !Array.isArray(w.body) ? w.body : null;
const ahora = Date.now();
const sd = $getWorkflowStaticData('global');
const ip = pdHashIp(pdIp(w.headers || {}));
const malo = function (status, errores, extra) { return [{ json: Object.assign({ valido: false, status: status, cuerpo: { ok: false, errores: errores } }, extra || {}) }]; };
if (!b) return malo(400, ['No pude leer tu pedido. Recarga la página y vuelve a intentarlo.']);
if (JSON.stringify(b).length > PD.MAX_CUERPO) return malo(400, ['Tu pedido tiene demasiados datos.']);
if (!pdLimite(sd, 'crear|' + ip, PD.CREAR_IP, ahora) || !pdLimite(sd, 'crear|*', PD.CREAR_GLOBAL, ahora)) {
  return malo(429, ['Recibimos muchos pedidos seguidos desde tu conexión. Espera unos minutos y vuelve a intentarlo, o escríbenos por WhatsApp.']);
}
const obj = function (v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const c = obj(b.cliente), e = obj(b.envio);
if (!Array.isArray(b.items) || !b.items.length) return malo(400, ['Tu bolsa está vacía.']);
const texto = function (v, n) { return v === undefined || v === null ? undefined : String(v).slice(0, n); };
const solicitud = {
  cliente: { nombre: texto(c.nombre, 80), correo: texto(c.correo, 120), telefono: texto(c.telefono, 20) },
  envio: { opcion: texto(e.opcion, 20), departamento: texto(e.departamento, 40), provincia: texto(e.provincia, 60), distrito: texto(e.distrito, 60) },
  items: b.items.slice(0, 25).map(function (x) { const i = obj(x); return { id: texto(i.id, 20), color: texto(i.color, 40), talla: texto(i.talla, 10), cantidad: i.cantidad }; }),
  origen: b.origen === 'chat' ? 'chat' : 'web'
};
if (c.dni !== undefined && c.dni !== null && String(c.dni).trim() !== '') solicitud.cliente.dni = String(c.dni).replace(/\s/g, '').slice(0, 12);
['direccion', 'referencia', 'agencia_destino'].forEach(function (k) { if (e[k] !== undefined && e[k] !== null && String(e[k]).trim() !== '') solicitud.envio[k] = texto(e[k], 200); });
if (typeof b.total_visto === 'number' && Number.isFinite(b.total_visto)) solicitud.total_visto = b.total_visto;
return [{ json: { valido: true, solicitud: solicitud, ip_hash: ip, ahora: ahora } }];

//// Config
// @incluir comun
// @incluir comun-pedidos
return [{ json: pdConfig($input.all().map(function (i) { return i.json; })) }];

//// Catálogo
// @incluir comun-pedidos
// products.json y site.json PUBLICADOS (lo mismo que ve el cliente), caché 60 s. Si la web no responde: caché de hasta 1 h.
const cfg = $('Config').first().json;
const sd = $getWorkflowStaticData('global');
const ahora = Date.now();
if (sd.cat && ahora - Number(sd.cat.ts) < PD.CACHE_MS && sd.cat.base === cfg.CATALOGO_URL) return [{ json: { ok: true, fuente: 'cache', productos: sd.cat.productos, site: sd.cat.site } }];
const traer = async function (f) {
  const r = await this.helpers.httpRequest({ method: 'GET', url: cfg.CATALOGO_URL + 'data/' + f + '?v=' + Math.floor(ahora / 30000), json: true, timeout: 10000 });
  return typeof r === 'string' ? JSON.parse(r) : r;
}.bind(this);
let error = '';
try {
  const r = await Promise.all([traer('products.json'), traer('site.json')]);
  if (r[0] && Array.isArray(r[0].productos) && r[1] && typeof r[1] === 'object' && r[1].envios) {
    sd.cat = { ts: ahora, base: cfg.CATALOGO_URL, productos: r[0].productos, site: r[1] };
    return [{ json: { ok: true, fuente: 'web', productos: r[0].productos, site: r[1] } }];
  }
  error = 'products.json o site.json sin el formato esperado';
} catch (e) { error = String((e && e.message) || e).slice(0, 200); }
if (sd.cat && ahora - Number(sd.cat.ts) < PD.CACHE_VIEJA_MS) return [{ json: { ok: true, fuente: 'cache-vieja', error: error, productos: sd.cat.productos, site: sd.cat.site } }];
return [{ json: { ok: false, error: error } }];

//// Revisar
// @incluir validar.js
// @incluir comun-pedidos
// Revisión completa ANTES de gastar un número (número de prueba PB-999999): datos, precios vigentes, stock por color y envío.
const e = $('Entrada').first().json;
const cat = $('Catálogo').first().json;
const no = function (status, errores) { return [{ json: { seguir: false, status: status, cuerpo: { ok: false, errores: errores } } }]; };
if (!cat.ok) return no(503, ['No pude cargar el catálogo en este momento. Vuelve a intentarlo en unos minutos o escríbenos por WhatsApp.']);
const mp = cat.site && cat.site.pagos && cat.site.pagos.mercadopago;
if (!mp || mp.activo !== true) return no(200, ['Los pagos en línea están desactivados. Escríbenos por WhatsApp para completar tu pedido.']);
const r = crearPedido(e.solicitud, { productos: cat.productos, site: cat.site, numero: 'PB-999999' });
if (!r.ok) return [{ json: { seguir: false, status: 200, cuerpo: { ok: false, errores: pdErroresPublicos(r.errores), stock: r.errores.some(function (x) { return /^\[stock\]/.test(x); }) }, errores_internos: r.errores } }];
return [{ json: { seguir: true, total: r.pedido.total } }];

//// Proponer número
// @incluir validar.js
// Número correlativo: pb_config.PEDIDO_ULTIMO (lo crea WF0 o este paso) y, por si alguien lo editó, el último de pb_pedidos.
// Se reserva con UPDATE pb_config SET valor=<siguiente> WHERE clave=PEDIDO_ULTIMO AND valor=<actual> (atómico: dos pedidos a la vez
// no pueden quedarse con el mismo número; el que pierde responde "vuelve a intentarlo").
const filas = $('Leer contador').all().map(function (i) { return i.json; }).filter(function (j) { return j && j.clave === 'PEDIDO_ULTIMO'; });
const ult = $('Último pedido').all().map(function (i) { return i.json; }).filter(function (j) { return j && /^PB-\d{6}$/.test(String(j.numero || '')); });
const actual = filas.length ? String(filas[0].valor === null || filas[0].valor === undefined ? '' : filas[0].valor) : null;
let sig = siguienteNumeroPedido(actual && /^PB-\d{6}$/.test(actual) ? actual : '');
if (ult.length) { const s2 = siguienteNumeroPedido(ult[0].numero); if (s2 > sig) sig = s2; }
return [{ json: { falta: actual === null || actual === '', actual: actual === null || actual === '' ? 'PB-000100' : actual, siguiente: sig } }];

//// Crear pedido
// @incluir validar.js
// @incluir comun-pedidos
// Con el número reservado: pedido definitivo + cuerpo de la preferencia de Checkout Pro (CONTRATO 00.6). El envío va como un ítem más.
const e = $('Entrada').first().json;
const cfg = $('Config').first().json;
const cat = $('Catálogo').first().json;
const pn = $('Proponer número').first().json;
const reservado = $input.all().some(function (i) { return i.json && i.json.id !== undefined && i.json.valor === pn.siguiente; });
if (!reservado) return [{ json: { seguir: false, status: 503, cuerpo: { ok: false, reintentar: true, errores: ['Entraron varios pedidos a la vez. Vuelve a intentarlo en unos segundos.'] } } }];
const r = crearPedido(e.solicitud, { productos: cat.productos, site: cat.site, numero: pn.siguiente });
if (!r.ok) return [{ json: { seguir: false, status: 200, cuerpo: { ok: false, errores: pdErroresPublicos(r.errores) }, errores_internos: r.errores } }];
const pedido = r.pedido;
const vence = fechaLima(Date.now() + PD.VENCE_PREFERENCIA_MS).replace(/-05:00$/, '.000-05:00');
const pref = preferenciaMercadoPago(pedido, { urlBase: cfg.SITIO_URL, notificationUrl: cfg.TUNEL_URL ? cfg.TUNEL_URL + '/mp-notificacion?source_news=webhooks' : '',
  vence: vence, nombreEnvio: pdOpcionNombre(cat.site, pedido.envio.opcion) });
return [{ json: { seguir: true, pedido: pedido, preferencia: pref, usar_mp: cfg.MP_MODO !== 'simulado', avisos: r.avisos, total_web: r.avisos.some(function (a) { return /^\[total_web\]/.test(a); }) } }];

//// Fila pedido
// @incluir validar.js
// Exactamente las columnas de pb_pedidos (COLUMNAS_PB_PEDIDOS). El pedido queda guardado ANTES de llamar a Mercado Pago.
return [{ json: filaPedido($('Crear pedido').first().json.pedido) }];

//// Resultado pago
// @incluir validar.js
// @incluir comun-pedidos
// Respuesta de POST /checkout/preferences. 401/403 o token inválido = la credencial "Mercado Pago Prueba" sigue con el placeholder
// -> PAGO SIMULADO (demo, claramente marcado). MP_MODO=simulado -> simulado sin llamar a MP. Otro fallo -> el pedido queda registrado sin enlace.
const cfg = $('Config').first().json;
const cat = $('Catálogo').first().json;
const c = $('Crear pedido').first().json;
const pedido = JSON.parse(JSON.stringify(c.pedido));
let modo = 'simulado', motivo = 'MP_MODO=simulado en pb_config', detalleMp = '';
if ($('Crear preferencia').isExecuted) {
  const r = $input.first().json || {};
  const st = Number(r.statusCode) || 0;
  const body = r.body && typeof r.body === 'object' ? r.body : {};
  const link = cfg.MP_LINK === 'sandbox_init_point' && body.sandbox_init_point ? body.sandbox_init_point : (body.init_point || body.sandbox_init_point || '');
  if ((st === 200 || st === 201) && body.id && /^https:\/\/[^\s<>"'`]+$/.test(link)) {
    modo = 'mercadopago'; motivo = '';
    pedido.pago.preference_id = String(body.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    pedido.pago.init_point = link.slice(0, 400);
  } else if (st === 401 || st === 403 || /invalid[_ ]?(access[_ ]?)?token|unauthorized|bearer/i.test(JSON.stringify(body).slice(0, 2000))) {
    modo = 'simulado'; motivo = 'la credencial "Mercado Pago Prueba" no tiene un Access Token válido (HTTP ' + st + ')';
  } else {
    modo = 'error'; motivo = 'Mercado Pago respondió HTTP ' + (st || 'sin respuesta');
    detalleMp = String(body.message || body.error || '').replace(/[<>]/g, '').slice(0, 160);
  }
}
const base = String(cfg.SITIO_URL).replace(/\/?$/, '/');
if (modo === 'simulado') {
  pedido.pago.preference_id = 'SIM-' + pedido.numero.replace(/\D/g, '');
  // Mismo regreso que Mercado Pago (back_urls): la web llama a /pedido/pago con payment_id=SIMULADO y n8n lo aprueba (solo pedidos SIM-).
  pedido.pago.init_point = base + '?mp=ok&pedido=' + encodeURIComponent(pedido.numero) + '&payment_id=SIMULADO&status=approved&simulado=1';
  pedido.pago.detalle = 'pago simulado (demo)';
}
pedido.pago.actualizado = fechaLima();
const v = validarPedido(pedido, { site: cat.site });
if (!v.ok) { modo = 'error'; motivo = 'el pedido con los datos de pago no pasó validarPedido: ' + v.errores.slice(0, 2).join('; '); }
const vista = vistaPublicaPedido(pedido, cat.site);
let status = 200, cuerpo;
if (modo === 'error') {
  status = 502;
  cuerpo = { ok: false, numero: pedido.numero, errores: ['No pudimos conectar con Mercado Pago. Tu pedido ' + pedido.numero + ' quedó registrado: vuelve a intentarlo en unos minutos o escríbenos por WhatsApp.'] };
} else {
  cuerpo = { ok: true, numero: pedido.numero, total: pedido.total, moneda: 'PEN', init_point: pedido.pago.init_point || null, modo_pago: modo === 'mercadopago' ? 'prueba' : 'simulado',
    simulado: modo === 'simulado', pedido: vista };
  if (modo === 'simulado') cuerpo.aviso = 'Pago simulado (demo): Mercado Pago aún no está configurado en esta tienda de prueba. No se cobra nada.';
  if (c.total_web) cuerpo.aviso_total = 'El total se actualizó a ' + pdSoles(pedido.total) + ' con los precios vigentes.';
}
return [{ json: { modo: modo, motivo: motivo, detalle_mp: detalleMp, pedido: pedido, fila: filaPedido(modo === 'error' ? c.pedido : pedido), status: status, cuerpo: cuerpo } }];

//// Respuesta
// Respuesta final para la web. Las ramas de error (Entrada, Revisar, Crear pedido) llegan aquí con {status, cuerpo} ya armados.
const j = ($('Resultado pago').isExecuted ? $('Resultado pago').first().json : $input.first().json) || {};
return [{ json: { status: Number(j.status) || 200, cuerpo: j.cuerpo || { ok: false, errores: ['Error inesperado.'] }, avisar: j.modo !== undefined } }];

//// Aviso nuevo
// @incluir comun
// @incluir comun-pedidos
// Después de responder: "Nuevo pedido" a admins y dueños (token de pb_config; sin token no se avisa).
const cfg = $('Config').first().json;
const cat = $('Catálogo').first().json;
const r = $('Resultado pago').first().json;
if (!cfg.BOT_TOKEN || !cfg.DESTINOS_PEDIDOS.length) return [];
const p = r.pedido;
const pago = r.modo === 'mercadopago' ? 'esperando el pago en Mercado Pago (modo prueba)' : r.modo === 'simulado' ? 'pago SIMULADO (demo: ' + r.motivo + ')' : 'sin enlace de pago (' + r.motivo + (r.detalle_mp ? ': ' + r.detalle_mp : '') + ')';
const texto = '🛍️ <b>Nuevo pedido</b> desde ' + h(p.origen === 'chat' ? 'el chat' : 'la web') + ' · ' + h(pago) + '\n' + pdTextoPedido(p, cat.site, true) +
  '\nSiguiente paso: ' + h(r.modo === 'error' ? 'revisa la credencial "Mercado Pago Prueba" en n8n; el cliente puede volver a intentarlo.' : 'te aviso cuando se confirme el pago. Ver: /pedido ' + p.numero);
return pdAvisos(cfg, texto).map(function (m) { return { json: m }; });
