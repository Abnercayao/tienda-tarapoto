#!/usr/bin/env node
/*
 * n8n/src/pedidos/probar-pedidos.js — Prueba SIN red los nodos Code REALES de WF13, WF14, WF15, WF16 (y los cambios v3 de WF2, WF4 y WF11)
 * leídos de n8n/workflows/*.json, con tablas en memoria, Mercado Pago simulado y Telegram simulado (mismo mini-runtime que probar-wf11.js:
 * $input, $('Nodo'), this.helpers.httpRequest, $getWorkflowStaticData). Recorre cada workflow por las mismas ramas que n8n.
 *   node n8n/src/pedidos/probar-pedidos.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const RAIZ = path.resolve(__dirname, '..', '..', '..');
const V = require(path.join(RAIZ, 'tools', 'validar.js'));
const WF = function (f) { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'n8n', 'workflows', f), 'utf8')); };
const W13 = WF('WF13-pedido-crear.json'), W14 = WF('WF14-mp-notificacion.json'), W15 = WF('WF15-pedido-seguimiento.json'), W16 = WF('WF16-pedidos-bot.json');
const W2 = WF('WF2-worker.json'), W4 = WF('WF4-comandos.json'), W11 = WF('WF11-chat-vendedor.json');
const DATA = function (f) { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'data', f), 'utf8')); };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TOKEN_FALSO = '123456789:' + 'X'.repeat(35);

let ok = 0, fallos = 0;
function caso(nombre, cond, detalle) {
  if (cond) { ok++; console.log('  ok    ' + nombre); }
  else { fallos++; console.log('  FALLA ' + nombre + (detalle !== undefined ? ' -> ' + JSON.stringify(detalle).slice(0, 900) : '')); }
}
const items = function (l) { return (l || []).map(function (j) { return j && (j.json || j.binary) ? j : { json: j }; }); };
const J = function (l) { return (l || []).map(function (i) { return i.json; }); };
const ESTATICO = { W13: {}, W14: {}, W15: {}, W16: {}, W11: {} };
let PRODUCTOS = DATA('products.json');
const SITE = DATA('site.json');
async function correr(W, nodo, input, nodos, estatico) {
  const n = W.nodes.find(function (x) { return x.name === nodo; });
  if (!n) throw new Error(W.name + ': no existe el nodo ' + nodo);
  const inp = items(input);
  const $ = function (nombre) {
    if (!(nombre in (nodos || {}))) return { isExecuted: false, first: function () { throw new Error('nodo no ejecutado: ' + nombre); }, all: function () { throw new Error('nodo no ejecutado: ' + nombre); } };
    const l = items(nodos[nombre]);
    return { isExecuted: true, first: function () { return l[0]; }, last: function () { return l[l.length - 1]; }, all: function () { return l; } };
  };
  const $input = { all: function () { return inp; }, first: function () { return inp[0]; } };
  const helpers = {
    httpRequest: async function (o) {
      if (/data\/products\.json/.test(o.url)) return JSON.parse(JSON.stringify(PRODUCTOS));
      if (/data\/site\.json/.test(o.url)) return JSON.parse(JSON.stringify(SITE));
      throw new Error('URL inesperada ' + o.url);
    }
  };
  const f = new AsyncFunction('$', '$input', '$json', '$getWorkflowStaticData', n.parameters.jsCode);
  return J(items((await f.call({ helpers: helpers }, $, $input, inp[0] ? inp[0].json : {}, function () { return estatico || {}; })) || []));
}

// ---------- tablas en memoria ----------
let idN = 1;
const AUT = [{ id: 0, rol: 'admin', nombre: 'ejemplo' }, { id: 111, rol: 'admin', nombre: 'Abner' }, { id: 222, rol: 'dueno', nombre: 'Emily' }, { id: 333, rol: 'marketing', nombre: 'Mkt' }];
const T = { config: [], pedidos: [], borradores: [] };
function cfg(clave, valor) { const f = T.config.find(function (x) { return x.clave === clave; }); if (f) f.valor = valor; else T.config.push({ id: idN++, clave: clave, valor: valor }); }
cfg('BOT_TOKEN', TOKEN_FALSO); cfg('AUTORIZADOS', JSON.stringify(AUT)); cfg('TUNEL_URL', 'https://prueba-uno.trycloudflare.com');
cfg('DESCONOCIDOS', JSON.stringify([{ id: 444444, nombre: 'Emily Nueva', fecha: '2026-10-08T10:00:00-05:00' }, { id: 555555, nombre: 'Otro <b>', fecha: '2026-10-08T11:00:00-05:00' }]));
const leerOVacio = function (l) { return l.length ? l : [{}]; };
const TG = [];
const MP = { modo: 'ok', prefs: [], pagos: {}, consultas: [] };
function mpResp(metodo, ruta, cuerpo) {
  MP.consultas.push({ metodo: metodo, ruta: ruta });
  if (MP.modo === '401') return { statusCode: 401, body: { message: 'invalid access token', error: 'unauthorized', status: 401 } };
  if (MP.modo === '500') return { statusCode: 500, body: { message: 'internal error' } };
  if (metodo === 'POST' && ruta === '/checkout/preferences') {
    const id = '123456789-' + (MP.prefs.length + 1).toString().padStart(4, '0');
    MP.prefs.push(cuerpo);
    return { statusCode: 201, body: { id: id, init_point: 'https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=' + id, sandbox_init_point: 'https://sandbox.mercadopago.com.pe/checkout/v1/redirect?pref_id=' + id } };
  }
  let m = /^\/v1\/payments\/(\d+)$/.exec(ruta);
  if (m) return MP.pagos[m[1]] ? { statusCode: 200, body: MP.pagos[m[1]] } : { statusCode: 404, body: { message: 'Payment not found', code: 2000 } };
  m = /^\/v1\/payments\/search\?external_reference=(PB-\d{6})/.exec(ruta);
  if (m) { const ref = m[1]; return { statusCode: 200, body: { results: Object.keys(MP.pagos).map(function (k) { return MP.pagos[k]; }).filter(function (p) { return p.external_reference === ref; }) } }; }
  return { statusCode: 404, body: {} };
}
function pagoMP(id, numero, status, monto, extra) {
  MP.pagos[id] = Object.assign({ id: Number(id), status: status, status_detail: status === 'approved' ? 'accredited' : 'cc_rejected_insufficient_amount', external_reference: numero, currency_id: 'PEN', transaction_amount: monto, live_mode: false }, extra || {});
}

// ---------- WF13 ----------
async function crear(body, ip) {
  const N = { 'POST pedido-crear': [{ body: body, headers: { 'x-real-ip': ip || '200.1.1.1' } }] };
  const fin = async function (desde) { N['Respuesta'] = await correr(W13, 'Respuesta', desde, N, ESTATICO.W13); return { N: N, status: N['Respuesta'][0].status, cuerpo: N['Respuesta'][0].cuerpo }; };
  N['Entrada'] = await correr(W13, 'Entrada', [{}], N, ESTATICO.W13);
  if (!N['Entrada'][0].valido) return fin(N['Entrada']);
  N['Crear pb_pedidos'] = [{}];
  N['Leer config'] = T.config.slice();
  N['Config'] = await correr(W13, 'Config', N['Leer config'], N);
  N['Catálogo'] = await correr(W13, 'Catálogo', [{}], N, ESTATICO.W13);
  N['Revisar'] = await correr(W13, 'Revisar', [{}], N);
  if (!N['Revisar'][0].seguir) return fin(N['Revisar']);
  N['Leer contador'] = leerOVacio(T.config.filter(function (x) { return x.clave === 'PEDIDO_ULTIMO'; }).map(function (x) { return Object.assign({}, x); }));
  N['Último pedido'] = leerOVacio(T.pedidos.slice(-1).map(function (x) { return Object.assign({}, x); }));
  N['Proponer número'] = await correr(W13, 'Proponer número', [{}], N);
  const pn = N['Proponer número'][0];
  if (pn.falta) { cfg('PEDIDO_ULTIMO', pn.actual); N['Crear contador'] = [Object.assign({}, T.config.find(function (x) { return x.clave === 'PEDIDO_ULTIMO'; }))]; }
  if (crear.antesDeReservar) crear.antesDeReservar();
  const fc = T.config.find(function (x) { return x.clave === 'PEDIDO_ULTIMO' && x.valor === pn.actual; });
  if (fc) fc.valor = pn.siguiente;
  N['Reservar número'] = fc ? [Object.assign({}, fc)] : [{}];
  N['Crear pedido'] = await correr(W13, 'Crear pedido', N['Reservar número'], N);
  if (!N['Crear pedido'][0].seguir) return fin(N['Crear pedido']);
  N['Fila pedido'] = await correr(W13, 'Fila pedido', N['Crear pedido'], N);
  const fila = Object.assign({ id: idN++ }, N['Fila pedido'][0]);
  T.pedidos.push(fila);
  N['Insertar pedido'] = [Object.assign({}, fila)];
  if (N['Crear pedido'][0].usar_mp) N['Crear preferencia'] = [mpResp('POST', '/checkout/preferences', N['Crear pedido'][0].preferencia)];
  N['Resultado pago'] = await correr(W13, 'Resultado pago', N['Crear preferencia'] || N['Insertar pedido'], N);
  const rp = N['Resultado pago'][0];
  const f = T.pedidos.find(function (x) { return x.numero === rp.fila.numero; });
  Object.assign(f, rp.fila);
  N['Guardar pago'] = [Object.assign({}, f)];
  const r = await fin(N['Guardar pago']);
  if (N['Respuesta'][0].avisar) { N['Aviso nuevo'] = await correr(W13, 'Aviso nuevo', N['Respuesta'], N); N['Aviso nuevo'].forEach(function (m) { TG.push(m); }); }
  return r;
}
// ---------- WF14 ----------
async function wf14(desde, datos) {
  const N = {};
  if (desde === 'mp') { N['POST mp-notificacion'] = [datos]; N['Responder MP'] = [datos]; }
  else if (desde === 'web') N['POST pedido-pago'] = [datos];
  else N['Entrada sub'] = [datos];
  N['Entrada'] = await correr(W14, 'Entrada', [{}], N, ESTATICO.W14);
  const fin = async function (desdeNodo) {
    N['Respuesta'] = await correr(W14, 'Respuesta', desdeNodo, N);
    if (N['Respuesta'][0].desde === 'sub') N['Salida sub'] = await correr(W14, 'Salida sub', N['Respuesta'], N);
    return { N: N, r: N['Respuesta'][0], sub: N['Salida sub'] ? N['Salida sub'][0] : null };
  };
  if (!N['Entrada'][0].valido) return fin(N['Entrada']);
  N['Crear pb_pedidos'] = [{}];
  N['Leer config'] = T.config.slice();
  N['Config'] = await correr(W14, 'Config', N['Leer config'], N);
  N['Preparar consulta'] = await correr(W14, 'Preparar consulta', [{}], N);
  const pc = N['Preparar consulta'][0];
  if (pc.consulta === 'pago') N['GET pago'] = [mpResp('GET', '/v1/payments/' + pc.payment_id)];
  else if (pc.consulta === 'buscar') N['Buscar pago'] = [mpResp('GET', '/v1/payments/search?external_reference=' + pc.numero)];
  else if (pc.consulta !== 'simulado') return fin(N['Preparar consulta']);
  N['Pago MP'] = await correr(W14, 'Pago MP', [{}], N);
  const num = N['Pago MP'][0].numero || 'ninguno';
  N['Leer pedido'] = leerOVacio(T.pedidos.filter(function (x) { return x.numero === num; }).map(function (x) { return Object.assign({}, x); }));
  N['Aplicar pago'] = await correr(W14, 'Aplicar pago', N['Leer pedido'], N);
  const a = N['Aplicar pago'][0];
  if (!a.guardar) return fin(N['Aplicar pago']);
  const f = T.pedidos.find(function (x) { return x.numero === a.numero && x.actualizado === a.actualizado_previo; });
  if (f && !wf14.perderCarrera) Object.assign(f, a.fila);
  N['Guardar pedido'] = f && !wf14.perderCarrera ? [Object.assign({}, f)] : [{}];
  N['Guardado'] = await correr(W14, 'Guardado', N['Guardar pedido'], N);
  const g = N['Guardado'][0];
  if (g.stock.length) { N['Filas stock'] = await correr(W14, 'Filas stock', [{}], N); N['Filas stock'].forEach(function (b) { T.borradores.push(Object.assign({ id: idN++ }, b)); }); }
  if (g.avisar) { N['Avisos pago'] = await correr(W14, 'Avisos pago', [{}], N); N['Avisos pago'].forEach(function (m) { TG.push(m); }); }
  return fin(N['Avisos pago'] || N['Guardado']);
}
const notif = function (id, extra) { return Object.assign({ body: { action: 'payment.updated', type: 'payment', data: { id: String(id) }, live_mode: false }, query: { 'data.id': String(id), type: 'payment' }, headers: {} }, extra || {}); };
function firmar(secreto, dataId, reqId, ts) { const v1 = nodeCrypto.createHmac('sha256', secreto).update('id:' + dataId + ';request-id:' + reqId + ';ts:' + ts + ';').digest('hex'); return 'ts=' + ts + ',v1=' + v1; }
// ---------- WF15 ----------
async function seguir(desde, datos) {
  const N = {};
  if (desde === 'web') N['POST pedido-seguimiento'] = [{ body: datos, headers: { 'x-real-ip': datos.__ip || '201.2.2.2' } }]; else N['Entrada sub'] = [datos];
  N['Entrada'] = await correr(W15, 'Entrada', [{}], N, ESTATICO.W15);
  const e = N['Entrada'][0];
  let out = N['Entrada'];
  if (e.valido) {
    N['Crear pb_pedidos'] = [{}];
    N['Leer pedido'] = leerOVacio(T.pedidos.filter(function (x) { return x.numero === e.numero; }).map(function (x) { return Object.assign({}, x); }));
    N['Leer config'] = T.config.slice();
    N['Config'] = await correr(W15, 'Config', N['Leer config'], N);
    N['Vista'] = await correr(W15, 'Vista', [{}], N, ESTATICO.W15);
    out = N['Vista'];
  }
  if (out[0].desde === 'sub') return (await correr(W15, 'Salida sub', out, N))[0];
  return out[0];
}
// ---------- WF16 ----------
async function bot(rol, texto, callback, idUsuario) {
  const ids = { admin: 111, dueno: 222, marketing: 333 };
  const yo = idUsuario || ids[rol];
  const partes = (texto || '').split(/\s+/);
  const t = { chat_id: yo, from_id: yo, rol: rol, nombre: 'Prueba', texto: texto || '', comando: callback ? 'boton_pedidos' : partes[0].slice(1), args: callback ? [] : partes.slice(1), callback: callback ? { id: 'cb1', data: callback, message_id: 77 } : null };
  const N = { Entrada: [{ trabajo: t }] };
  N['Leer config'] = T.config.slice();
  N['Config'] = await correr(W16, 'Config', N['Leer config'], N);
  N['Crear pb_pedidos'] = [{}];
  N['Interpretar'] = await correr(W16, 'Interpretar', [{}], N, ESTATICO.W16);
  const q = N['Interpretar'][0];
  let msgs;
  if (q.ruta === 'responder') msgs = await correr(W16, 'Responder', N['Interpretar'], N);
  else if (q.ruta === 'lista') {
    N['Leer abiertos'] = leerOVacio(T.pedidos.filter(function (x) { return ['pendiente_pago', 'pagado', 'preparando'].indexOf(x.estado) >= 0; }).map(function (x) { return Object.assign({}, x); }));
    msgs = await correr(W16, 'Lista', N['Leer abiertos'], N);
  } else if (q.ruta === 'pedido') {
    N['Leer pedido'] = leerOVacio(T.pedidos.filter(function (x) { return x.numero === q.numero; }).map(function (x) { return Object.assign({}, x); }));
    N['Revisar pedido'] = await correr(W16, 'Revisar pedido', N['Leer pedido'], N, ESTATICO.W16);
    if (N['Revisar pedido'][0].reconsultar) { const s = await wf14('sub', N['Revisar pedido'][0]); N['WF14 reconsultar'] = [s.sub]; }
    msgs = await correr(W16, 'Detalle', N['WF14 reconsultar'] || N['Revisar pedido'], N, ESTATICO.W16);
  } else if (q.ruta === 'cambiar') {
    N['Leer pedido cambio'] = leerOVacio(T.pedidos.filter(function (x) { return x.numero === q.numero; }).map(function (x) { return Object.assign({}, x); }));
    N['Transición'] = await correr(W16, 'Transición', N['Leer pedido cambio'], N, ESTATICO.W16);
    const tr = N['Transición'][0];
    if (tr.guardar) {
      const f = T.pedidos.find(function (x) { return x.numero === tr.numero && x.actualizado === tr.actualizado_previo; });
      if (f) Object.assign(f, tr.fila);
      N['Guardar cambio'] = f ? [Object.assign({}, f)] : [{}];
    }
    msgs = await correr(W16, 'Avisos cambio', N['Guardar cambio'] || N['Transición'], N);
  } else if (q.ruta === 'usuarios') {
    N['Leer autorizados'] = leerOVacio(T.config.filter(function (x) { return x.clave === 'AUTORIZADOS'; }).map(function (x) { return Object.assign({}, x); }));
    N['Cambiar autorizados'] = await correr(W16, 'Cambiar autorizados', N['Leer autorizados'], N);
    const ca = N['Cambiar autorizados'][0];
    if (ca.guardar) {
      const f = T.config.find(function (x) { return x.clave === 'AUTORIZADOS' && x.valor === ca.previo; });
      if (f) f.valor = ca.nuevo;
      N['Guardar autorizados'] = f ? [Object.assign({}, f)] : [{}];
    }
    msgs = await correr(W16, 'Avisos usuarios', N['Guardar autorizados'] || N['Cambiar autorizados'], N);
  }
  return { q: q, msgs: msgs || [], texto: (msgs || []).filter(function (m) { return m.metodo === 'sendMessage'; }).map(function (m) { return m.cuerpo.text; }).join('\n---\n') };
}
const terminaBien = function (m) { return m.metodo !== 'sendMessage' || /\nSiguiente paso: \S/.test(m.cuerpo.text); };

// =====================================================================================================
const P = PRODUCTOS.productos;
const prod = function (id) { return P.find(function (p) { return p.id === id; }); };
const p19 = prod('prd-0019');
const color0 = p19.colores[0].nombre;
const cliente = { nombre: 'Ana Ríos', correo: 'Ana.Rios@Correo.com', telefono: '987 654 321', dni: '12345678' };
const envioLima = { opcion: 'shalom', departamento: 'Lima', provincia: 'Lima', distrito: 'Miraflores', agencia_destino: 'Shalom Av. Arequipa 123' };
const solicitud = function (extra) { return Object.assign({ cliente: cliente, envio: envioLima, items: [{ id: 'prd-0019', color: color0, talla: 'M', cantidad: 2, precio_unit: 1 }], total_visto: 1, origen: 'web' }, extra || {}); };

(async function () {
  console.log('HMAC-SHA256 en JS puro (comun-pedidos) vs Node crypto');
  {
    const src = fs.readFileSync(path.join(__dirname, 'comun-pedidos.js'), 'utf8');
    const f = new Function(src + '\nreturn { hmac: pdHmacSha256Hex, firma: pdFirmaMP, numero: pdNumero, errores: pdErroresPublicos };')();
    const casos = [['clave', ''], ['', 'mensaje'], ['k'.repeat(100), 'id:123;request-id:abc;ts:1700000000;'], ['ñandú€', 'pedido PB-000101 · S/ 144.90 ✓'], [nodeCrypto.randomBytes(20).toString('hex'), 'x'.repeat(1000)]];
    caso('5 vectores (clave larga, UTF-8, vacío, 1000 caracteres) iguales a crypto.createHmac', casos.every(function (c) { return f.hmac(c[0], c[1]) === nodeCrypto.createHmac('sha256', c[0]).update(c[1]).digest('hex'); }));
    const sec = 'secreto-de-prueba-123';
    caso('pdFirmaMP: firma válida', f.firma(firmar(sec, '123456', 'req-1', '1704908010'), 'req-1', '123456', sec).ok === true);
    caso('pdFirmaMP: v1 alterado -> inválida', f.firma(firmar(sec, '123456', 'req-1', '1704908010').replace(/v1=./, 'v1=0'), 'req-1', '123456', sec).ok === false);
    caso('pdFirmaMP: otro data.id -> inválida', f.firma(firmar(sec, '123456', 'req-1', '1704908010'), 'req-1', '999999', sec).ok === false);
    caso('pdFirmaMP: sin cabecera con clave configurada -> inválida', f.firma('', '', '123456', sec).ok === false);
    caso('pdFirmaMP: sin clave configurada -> se acepta (la verdad la da GET /v1/payments)', f.firma('', '', '123456', '').ok === true);
    caso('pdNumero: "pb-101", "PB000101", "#101" -> PB-000101', ['pb-101', 'PB000101', '#101', ' PB-000101 '].every(function (x) { return f.numero(x) === 'PB-000101'; }) && f.numero('abc') === '' && f.numero('PB-0000001') === '');
    caso('pdErroresPublicos: sin códigos ni rutas', f.errores(['[stock] prd-0019: no hay suficiente stock de X', '[cliente] cliente.nombre: escribe nombre y apellido'])[1] === 'Escribe nombre y apellido.', f.errores(['[stock] prd-0019: no hay suficiente stock de X', '[cliente] cliente.nombre: escribe nombre y apellido']));
  }

  console.log('\nWF13 Pedido-Crear');
  let r = await crear(solicitud());
  const esperado = Math.round((V.precioVigente(p19) * 2 + 15) * 100) / 100;
  caso('pedido válido -> ok, PB-000101, total del catálogo (no el del navegador)', r.status === 200 && r.cuerpo.ok === true && r.cuerpo.numero === 'PB-000101' && r.cuerpo.total === esperado, r.cuerpo);
  caso('total manipulado (total_visto 1, precio_unit 1) -> se cobra el real y se avisa', /se actualizó a S\/ /.test(r.cuerpo.aviso_total || '') && r.N['Crear pedido'][0].pedido.items[0].precio_unit === V.precioVigente(p19), r.cuerpo);
  caso('init_point de Mercado Pago (modo prueba) en la respuesta', /^https:\/\/www\.mercadopago\.com\.pe\//.test(r.cuerpo.init_point) && r.cuerpo.modo_pago === 'prueba' && r.cuerpo.simulado === false);
  const pref = MP.prefs[0];
  const sumaItems = pref.items.reduce(function (s, i) { return s + Math.round(i.unit_price * 100) * i.quantity; }, 0) / 100;
  caso('preferencia: ítems + envío suman el total, PEN, external_reference', sumaItems === esperado && pref.items.every(function (i) { return i.currency_id === 'PEN'; }) && pref.external_reference === 'PB-000101' && pref.items.some(function (i) { return i.id === 'ENVIO-SHALOM'; }), pref);
  caso('preferencia: back_urls sin "#" y notification_url = túnel/mp-notificacion', ['success', 'pending', 'failure'].every(function (k) { return pref.back_urls[k].indexOf('#') < 0 && /pedido=PB-000101/.test(pref.back_urls[k]); }) && pref.notification_url === 'https://prueba-uno.trycloudflare.com/mp-notificacion?source_news=webhooks', pref);
  caso('preferencia: payer sin correo (modo prueba), vence con zona -05:00', !pref.payer.email && pref.payer.name === 'Ana' && /\.000-05:00$/.test(pref.expiration_date_to), pref.payer);
  const fila1 = T.pedidos.find(function (x) { return x.numero === 'PB-000101'; });
  caso('pb_pedidos: fila con columnas del contrato, correo en minúsculas, preference_id', fila1 && Object.keys(fila1).filter(function (k) { return k !== 'id'; }).sort().join() === V.COLUMNAS_PB_PEDIDOS.map(function (c) { return c.nombre; }).sort().join() && fila1.correo === 'ana.rios@correo.com' && /^123456789-/.test(fila1.preference_id), fila1);
  caso('pedido guardado pasa validarPedido (con catálogo)', V.validarPedido(fila1.pedido_json, { site: SITE, productos: P }).ok, V.validarPedido(fila1.pedido_json, { site: SITE, productos: P }).errores);
  caso('vista pública en la respuesta: sin correo, celular, DNI ni dirección', !/ana\.rios|987654321|"dni"|Arequipa 123|Ríos/.test(JSON.stringify(r.cuerpo.pedido)), r.cuerpo.pedido);
  caso('Telegram "Nuevo pedido" a admin y dueño (no a marketing), con datos del cliente', TG.length === 2 && TG.every(function (m) { return /Nuevo pedido/.test(m.cuerpo.text) && /ana\.rios@correo\.com/.test(m.cuerpo.text) && terminaBien(m); }) && TG.map(function (m) { return m.cuerpo.chat_id; }).sort().join() === '111,222', TG);
  caso('PEDIDO_ULTIMO avanzó a PB-000101', T.config.find(function (x) { return x.clave === 'PEDIDO_ULTIMO'; }).valor === 'PB-000101');
  const poco = P.find(function (p) { return p.activo && p.stock_por_color && Object.keys(p.stock_por_color).some(function (k) { return p.stock_por_color[k] > 0 && p.stock_por_color[k] < 9; }); });
  const colPoco = Object.keys(poco.stock_por_color).find(function (k) { return poco.stock_por_color[k] > 0 && poco.stock_por_color[k] < 9; });
  r = await crear(solicitud({ items: [{ id: poco.id, color: colPoco, talla: poco.tallas[0], cantidad: poco.stock_por_color[colPoco] + 1 }] }), '200.1.1.2');
  caso('stock insuficiente -> ok:false con el motivo, sin gastar número', r.cuerpo.ok === false && /stock/i.test(r.cuerpo.errores.join(' ')) && T.config.find(function (x) { return x.clave === 'PEDIDO_ULTIMO'; }).valor === 'PB-000101', r.cuerpo);
  const agotado = P.find(function (p) { return p.stock_por_color && Object.keys(p.stock_por_color).some(function (k) { return p.stock_por_color[k] === 0; }); });
  const colAg = Object.keys(agotado.stock_por_color).find(function (k) { return agotado.stock_por_color[k] === 0; });
  r = await crear(solicitud({ items: [{ id: agotado.id, color: colAg, talla: agotado.tallas[0], cantidad: 1 }] }), '200.1.1.2');
  caso('color agotado (' + agotado.id + ' ' + colAg + ') -> rechazado', r.cuerpo.ok === false && /stock/i.test(r.cuerpo.errores.join(' ')), r.cuerpo);
  r = await crear(solicitud({ items: [{ id: 'prd-9999', color: 'Rojo', talla: 'M', cantidad: 1 }] }), '200.1.1.2');
  caso('producto inexistente -> rechazado', r.cuerpo.ok === false && /no existe/.test(r.cuerpo.errores.join(' ')), r.cuerpo);
  r = await crear(solicitud({ cliente: { nombre: 'Ana Ríos', correo: 'ana@correo.com', telefono: '987654321' } }), '200.1.1.2');
  caso('Shalom (agencia) sin DNI -> pide DNI', r.cuerpo.ok === false && /DNI/.test(r.cuerpo.errores.join(' ')), r.cuerpo);
  r = await crear(solicitud({ envio: { opcion: 'local', departamento: 'Lima', provincia: 'Lima', distrito: 'Miraflores', direccion: 'Av. Larco 123' } }), '200.1.1.2');
  caso('entrega local fuera de Tarapoto -> rechazada', r.cuerpo.ok === false && /no llega/.test(r.cuerpo.errores.join(' ')), r.cuerpo);
  r = await crear('no es un objeto', '200.1.1.3');
  caso('cuerpo que no es objeto -> 400', r.status === 400 && r.cuerpo.ok === false);
  let ultimo;
  for (let i = 0; i < 7; i++) ultimo = await crear(solicitud({ items: [] }), '200.9.9.9');
  caso('límite por IP: el 7.º intento en 10 min -> 429', ultimo.status === 429, ultimo.cuerpo);
  MP.modo = '401';
  r = await crear(solicitud({ envio: { opcion: 'local', departamento: 'San Martín', provincia: 'San Martín', distrito: 'Morales', direccion: 'Jr. Los Pinos 456' }, items: [{ id: 'prd-0019', color: color0, talla: 'L', cantidad: 1 }] }), '200.1.1.4');
  caso('credencial placeholder (401) -> pago SIMULADO marcado, PB-000102', r.cuerpo.ok === true && r.cuerpo.simulado === true && r.cuerpo.numero === 'PB-000102' && /Pago simulado/.test(r.cuerpo.aviso) && /payment_id=SIMULADO/.test(r.cuerpo.init_point) && r.cuerpo.init_point.indexOf('#') < 0, r.cuerpo);
  caso('aviso de Telegram del simulado lo dice', /SIMULADO/.test(TG[TG.length - 1].cuerpo.text));
  MP.modo = '500';
  r = await crear(solicitud({ items: [{ id: 'prd-0019', color: color0, talla: 'S', cantidad: 1 }] }), '200.1.1.5');
  caso('Mercado Pago caído (500) -> 502 con el número registrado', r.status === 502 && r.cuerpo.ok === false && r.cuerpo.numero === 'PB-000103' && T.pedidos.some(function (x) { return x.numero === 'PB-000103' && x.estado === 'pendiente_pago'; }), r.cuerpo);
  MP.modo = 'ok';
  crear.antesDeReservar = function () { cfg('PEDIDO_ULTIMO', 'PB-000104'); };
  r = await crear(solicitud({ items: [{ id: 'prd-0019', color: color0, talla: 'S', cantidad: 1 }] }), '200.1.1.6');
  crear.antesDeReservar = null;
  caso('dos pedidos a la vez (el contador cambió) -> 503 reintentar, sin número duplicado', r.status === 503 && r.cuerpo.reintentar === true, r.cuerpo);
  cfg('MP_MODO', 'simulado');
  r = await crear(solicitud({ items: [{ id: 'prd-0019', color: color0, talla: 'S', cantidad: 1 }] }), '200.1.1.7');
  caso('MP_MODO=simulado -> no llama a MP; número tras PB-000104 = PB-000105', r.cuerpo.simulado === true && r.cuerpo.numero === 'PB-000105' && !r.N['Crear preferencia'], r.cuerpo);
  cfg('MP_MODO', 'auto');

  console.log('\nWF14 MP-Notificación');
  const correoDe = function (num) { const f = T.pedidos.find(function (x) { return x.numero === num; }); return f ? String(f.correo || '') : ''; };
  pagoMP('7001', 'PB-000101', 'approved', esperado);
  TG.length = 0;
  let w = await wf14('mp', notif('7001'));
  let f101 = V.pedidoDesdeFila(T.pedidos.find(function (x) { return x.numero === 'PB-000101'; }));
  caso('aviso de pago aprobado -> PB-000101 "pagado" con historial', f101.estado === 'pagado' && f101.pago.estado === 'aprobado' && f101.pago.payment_id === '7001' && f101.historial.map(function (h) { return h.estado; }).join() === 'pendiente_pago,pagado', f101);
  caso('solo se consultó GET /v1/payments/7001 (el cuerpo del aviso no se cree)', MP.consultas.slice(-1)[0].ruta === '/v1/payments/7001');
  caso('Telegram "Pago confirmado" a admin y dueño', TG.length === 2 && TG.every(function (m) { return /Pago confirmado/.test(m.cuerpo.text) && terminaBien(m); }), TG);
  const borr = T.borradores.slice();
  caso('borrador de stock auto-aprobado (op stock, restar, rol dueño, origen pedido)', borr.length === 1 && borr[0].estado === 'aprobado' && borr[0].op === 'stock' && borr[0].entidad_id === 'prd-0019' && borr[0].rol === 'dueno' && borr[0].origen === 'pedido' && /^drf-[a-z0-9]{6,20}$/.test(borr[0].draft_id) && JSON.parse(borr[0].campos).stock_modo === 'restar', borr);
  const ap = V.aplicarStockColor(prod('prd-0019'), JSON.parse(borr[0].campos).stock_por_color, 'restar');
  caso('ese borrador, aplicado como en WF5, descuenta 2 de ' + color0, ap.ok && ap.stock_por_color[color0] === p19.stock_por_color[color0] - 2, ap);
  caso('columnas del borrador = pb_borradores de WF0', Object.keys(borr[0]).filter(function (k) { return k !== 'id'; }).sort().join() === require('./construir-pedidos.js').TABLAS.pb_borradores.map(function (c) { return c[0]; }).sort().join());
  w = await wf14('mp', notif('7001'));
  caso('aviso repetido -> sin cambios, sin otro Telegram ni otro borrador', TG.length === 2 && T.borradores.length === 1 && !w.N['Guardado']);
  const secreto = 'clave-secreta-webhooks-01';
  cfg('MP_WEBHOOK_SECRET', secreto);
  pagoMP('7002', 'PB-000103', 'approved', 159.9);
  const n0 = MP.consultas.length;
  w = await wf14('mp', notif('7002', { headers: { 'x-signature': 'ts=1704908010,v1=' + 'a'.repeat(64), 'x-request-id': 'req-9' } }));
  caso('con clave secreta: firma inválida -> no consulta a MP ni cambia nada', MP.consultas.length === n0 && w.N['Preparar consulta'][0].consulta === 'nada', w.N['Preparar consulta']);
  w = await wf14('mp', notif('7002', { headers: {} }));
  caso('con clave secreta: sin x-signature -> rechazado', MP.consultas.length === n0);
  w = await wf14('mp', notif('7002', { headers: { 'x-signature': firmar(secreto, '7002', 'req-10', '1704908010'), 'x-request-id': 'req-10' } }));
  let f103 = V.pedidoDesdeFila(T.pedidos.find(function (x) { return x.numero === 'PB-000103'; }));
  caso('firma válida pero monto distinto del total -> no se marca pagado', MP.consultas.length === n0 + 1 && f103.estado === 'pendiente_pago' && /transaction_amount/.test(JSON.stringify(w.N['Aplicar pago'][0].errores)), w.N['Aplicar pago'][0]);
  cfg('MP_WEBHOOK_SECRET', '');
  pagoMP('7003', 'PB-000103', 'rejected', f103.total);
  TG.length = 0;
  w = await wf14('mp', notif('7003'));
  f103 = V.pedidoDesdeFila(T.pedidos.find(function (x) { return x.numero === 'PB-000103'; }));
  caso('pago rechazado -> sigue pendiente de pago, pago "rechazado", aviso', f103.estado === 'pendiente_pago' && f103.pago.estado === 'rechazado' && TG.length === 2 && /rechazado/i.test(TG[0].cuerpo.text), f103.pago);
  w = await wf14('mp', { body: { type: 'merchant_order', data: { id: '1' } }, query: {}, headers: {} });
  caso('aviso que no es de pago (merchant_order) -> se ignora', w.r.cuerpo.ok === false && !w.N['Config']);
  w = await wf14('web', { body: { numero: 'PB-000103', payment_id: '7001' }, headers: { 'x-real-ip': '1.2.3.4' } });
  caso('vuelta de la web con el pago de OTRO pedido -> no lo aplica', w.r.cuerpo.ok === false || w.r.cuerpo.estado === 'pendiente_pago', w.r);
  pagoMP('7004', 'PB-000103', 'approved', f103.total);
  w = await wf14('web', { body: { numero: 'pb-103', payment_id: '7004' }, headers: { 'x-real-ip': '1.2.3.4' } });
  caso('vuelta de la web (respaldo si no llegó el aviso) -> pagado, respuesta sin datos personales', w.r.status === 200 && w.r.cuerpo.ok === true && w.r.cuerpo.estado === 'pagado' && w.r.cuerpo.estado_texto === 'Pagado' && Object.keys(w.r.cuerpo).join() === 'ok,numero,estado,estado_texto,pago_estado', w.r.cuerpo);
  caso('un rechazo tardío no pisa el pago aprobado', (await wf14('mp', notif('7003'))) && V.pedidoDesdeFila(T.pedidos.find(function (x) { return x.numero === 'PB-000103'; })).estado === 'pagado');
  wf14.perderCarrera = true;
  pagoMP('7005', 'PB-000105', 'approved', V.pedidoDesdeFila(T.pedidos.find(function (x) { return x.numero === 'PB-000105'; })).total);
  const b0 = T.borradores.length; const tg0 = TG.length;
  w = await wf14('web', { body: { numero: 'PB-000105', payment_id: 'SIMULADO', correo: correoDe('PB-000105') }, headers: {} });
  wf14.perderCarrera = false;
  caso('carrera perdida (otro guardó antes) -> sin aviso ni borrador duplicados', T.borradores.length === b0 && TG.length === tg0 && w.N['Guardado'][0].guardado === false);
  w = await wf14('web', { body: { numero: 'PB-000102', payment_id: 'SIMULADO' }, headers: { 'x-real-ip': '5.5.5.1' } });
  caso('pago SIMULADO sin correo -> no_encontrado (no se marca pagado)', w.r.cuerpo.ok === false && w.r.cuerpo.motivo === 'no_encontrado' && V.pedidoDesdeFila(T.pedidos.find(function (x) { return x.numero === 'PB-000102'; })).estado !== 'pagado', w.r.cuerpo);
  w = await wf14('web', { body: { numero: 'PB-000102', payment_id: 'SIMULADO', correo: 'otra@correo.com' }, headers: { 'x-real-ip': '5.5.5.1' } });
  caso('pago SIMULADO con correo errado -> no_encontrado (no se marca pagado)', w.r.cuerpo.ok === false && w.r.cuerpo.motivo === 'no_encontrado' && V.pedidoDesdeFila(T.pedidos.find(function (x) { return x.numero === 'PB-000102'; })).estado !== 'pagado', w.r.cuerpo);
  w = await wf14('web', { body: { numero: 'PB-000102', payment_id: 'SIMULADO', correo: correoDe('PB-000102').toUpperCase() + ' ' }, headers: {} });
  caso('pago SIMULADO de un pedido simulado -> pagado (marcado)', w.r.cuerpo.estado === 'pagado' && w.r.cuerpo.simulado === true && /SIMULADO/.test(V.pedidoDesdeFila(T.pedidos.find(function (x) { return x.numero === 'PB-000102'; })).historial[1].nota), w.r.cuerpo);
  pagoMP('7006', 'PB-000999', 'approved', 10);
  w = await wf14('web', { body: { numero: 'PB-000101', payment_id: 'SIMULADO', correo: correoDe('PB-000101') }, headers: {} });
  caso('pago SIMULADO de un pedido con Mercado Pago real -> rechazado', w.r.cuerpo.estado === 'pagado' && /real/.test(JSON.stringify(w.N['Aplicar pago'][0].errores)) && w.N['Aplicar pago'][0].guardar === false, w.N['Aplicar pago'][0]);
  w = await wf14('web', { body: { numero: 'PB-000101', payment_id: '12ab' }, headers: {} });
  caso('payment_id inválido -> 400', w.r.status === 400);

  console.log('\nWF15 Seguimiento');
  let s = await seguir('web', { numero: 'PB-000101', correo: 'ANA.rios@correo.com ' });
  caso('número + correo (mayúsculas/espacios) -> estado, historial y tiempo estimado', s.status === 200 && s.cuerpo.ok === true && s.cuerpo.pedido.estado === 'pagado' && s.cuerpo.pedido.historial.length === 2 && s.cuerpo.pedido.envio.tiempo_estimado === '2–3 días hábiles', s.cuerpo);
  caso('vista pública: sin correo, celular, DNI, dirección ni apellido', !/correo\.com|987654321|12345678|Arequipa 123|Ríos/.test(JSON.stringify(s.cuerpo)), s.cuerpo);
  const malo1 = await seguir('web', { numero: 'PB-000101', correo: 'otra@correo.com', __ip: '9.9.9.1' });
  const malo2 = await seguir('web', { numero: 'PB-000909', correo: 'ana.rios@correo.com', __ip: '9.9.9.1' });
  caso('correo incorrecto y número inexistente -> la MISMA respuesta "no_encontrado"', JSON.stringify(malo1) === JSON.stringify(malo2) && malo1.cuerpo.motivo === 'no_encontrado', [malo1, malo2]);
  caso('datos inválidos -> 400', (await seguir('web', { numero: 'hola', correo: 'x' })).status === 400);
  let lim;
  for (let i = 0; i < 9; i++) lim = await seguir('web', { numero: 'PB-000101', correo: 'adivino' + i + '@correo.com', __ip: '9.9.9.2' });
  caso('8 fallos por IP -> el siguiente intento es 429 (aunque sea correcto)', lim.status === 429 && (await seguir('web', { numero: 'PB-000101', correo: 'ana.rios@correo.com', __ip: '9.9.9.2' })).status === 429, lim);
  const sub = await seguir('sub', { numero: 'PB-000101', correo: 'ana.rios@correo.com', ip_hash: 'abcdef0123456789' });
  caso('como sub-workflow (chat Vale) -> {ok, pedido}', sub.ok === true && sub.pedido.numero === 'PB-000101', sub);

  console.log('\nWF16 Pedidos-Bot');
  let b = await bot('dueno', '/pedidos');
  caso('/pedidos (dueño): lista los abiertos', /Pedidos abiertos/.test(b.texto) && /PB-000101/.test(b.texto) && terminaBien(b.msgs[0]), b.texto);
  b = await bot('marketing', '/pedido PB-000101');
  caso('/pedido (marketing): sin correo ni teléfono del cliente', /PB-000101/.test(b.texto) && !/correo\.com|987654321/.test(b.texto) && /solo para admin y dueño/.test(b.texto), b.texto);
  b = await bot('dueno', '/pedido pb-101');
  caso('/pedido (dueño): detalle con contacto y siguiente paso', /ana\.rios@correo\.com/.test(b.texto) && /\/preparando PB-000101/.test(b.texto), b.texto);
  b = await bot('marketing', '/preparando PB-000101');
  caso('marketing no cambia estados', /no cambiarlos/.test(b.texto) && b.q.ruta === 'responder');
  b = await bot('dueno', '/preparando PB-000101');
  caso('/preparando -> preparando', /→ Preparando/.test(b.texto) && V.pedidoDesdeFila(T.pedidos.find(function (x) { return x.numero === 'PB-000101'; })).estado === 'preparando', b.texto);
  b = await bot('dueno', '/enviar PB-000101 shalom 123');
  caso('/enviar con código de Shalom mal formado -> error con ejemplo', /No cambié/.test(b.texto) && /12345678-ABCD/.test(b.texto), b.texto);
  b = await bot('dueno', '/enviar PB-000101 shalom 12345678-ABCD');
  f101 = V.pedidoDesdeFila(T.pedidos.find(function (x) { return x.numero === 'PB-000101'; }));
  caso('/enviar shalom 12345678-ABCD -> enviado con código y URL de rastreo', f101.estado === 'enviado' && f101.seguimiento.codigo === '12345678-ABCD' && f101.seguimiento.url === 'https://shalom.com.pe/rastrea' && /clave de 4 dígitos/.test(b.texto), f101.seguimiento);
  s = await seguir('web', { numero: 'PB-000101', correo: 'ana.rios@correo.com', __ip: '9.9.9.3' });
  caso('el seguimiento muestra agencia, código y URL', s.cuerpo.pedido.seguimiento.agencia_nombre === 'Shalom' && s.cuerpo.pedido.seguimiento.url === 'https://shalom.com.pe/rastrea', s.cuerpo.pedido.seguimiento);
  b = await bot('dueno', '/recojo PB-000101');
  b = await bot('dueno', '/entregado PB-000101');
  caso('/recojo y /entregado -> entregado (historial de 6 pasos)', V.pedidoDesdeFila(T.pedidos.find(function (x) { return x.numero === 'PB-000101'; })).historial.length === 6 && /Entregado/.test(b.texto), b.texto);
  b = await bot('dueno', '/preparando PB-000101');
  caso('transición no permitida (entregado -> preparando) -> explica', /No cambié/.test(b.texto) && /entregado/.test(b.texto), b.texto);
  b = await bot('dueno', '/cancelar_pedido PB-000103');
  const btn = b.msgs[0].cuerpo.reply_markup && b.msgs[0].cuerpo.reply_markup.inline_keyboard[0][0].callback_data;
  caso('/cancelar_pedido de un pedido pagado -> pide confirmación con botón y avisa la devolución', /^ped:can:000103:[0-9a-z]+$/.test(btn || '') && /Está pagado/.test(b.texto), b.msgs[0]);
  b = await bot('dueno', null, 'ped:can:000103:' + Math.floor(Date.now() / 1000 - 5).toString(36));
  caso('botón vencido -> no cancela', /venció/.test(b.texto) && V.pedidoDesdeFila(T.pedidos.find(function (x) { return x.numero === 'PB-000103'; })).estado === 'pagado');
  b = await bot('dueno', null, btn);
  caso('botón Sí, cancelar -> cancelado, quita el teclado y recuerda devolver el dinero', b.msgs[0].metodo === 'editMessageReplyMarkup' && /Cancelado/.test(b.texto) && /devuelve el dinero/.test(b.texto), b.msgs);
  b = await bot('dueno', '/envios');
  caso('/envios: Shalom, Olva, bus y local con costo y tiempo', /Shalom/.test(b.texto) && /Olva Courier/.test(b.texto) && /bus/.test(b.texto) && /Entrega local/.test(b.texto) && /S\/ 15\.00/.test(b.texto) && !/motocarro/i.test(b.texto), b.texto);
  b = await bot('dueno', '/desconocidos');
  caso('/desconocidos (dueño): ids con nombre escapado', /444444/.test(b.texto) && /Otro b/.test(b.texto) && !/Otro <b>/.test(b.texto), b.texto);
  b = await bot('marketing', '/desconocidos');
  caso('marketing no ve /desconocidos', /no cambiarlos ni gestionar usuarios/.test(b.texto));
  b = await bot('dueno', '/autorizar 444444 admin');
  caso('/autorizar ... admin -> nunca por el bot', /no se asigna por el bot/.test(b.texto));
  b = await bot('dueno', '/autorizar 222 marketing');
  caso('/autorizar a uno mismo -> no', /tu propio acceso/.test(b.texto));
  b = await bot('dueno', '/autorizar 111 marketing');
  caso('/autorizar a un admin -> no', /es admin/.test(b.texto));
  b = await bot('dueno', '/autorizar 444444 dueño');
  const btnA = b.msgs[0].cuerpo.reply_markup.inline_keyboard[0][0].callback_data;
  caso('/autorizar 444444 dueño -> confirmación con botón', /^usr:aut:444444:d:[0-9a-z]+$/.test(btnA) && /Emily Nueva/.test(b.texto), b.msgs[0]);
  b = await bot('marketing', null, btnA);
  caso('el botón lo toca marketing -> no hace nada', /ya no puede gestionar usuarios/.test(b.texto) && !/444444/.test(T.config.find(function (x) { return x.clave === 'AUTORIZADOS'; }).valor));
  b = await bot('dueno', null, btnA);
  let aut = JSON.parse(T.config.find(function (x) { return x.clave === 'AUTORIZADOS'; }).valor);
  caso('confirmado -> AUTORIZADOS + {444444, dueno}, menú (setMyCommands) y bienvenida', aut.some(function (a) { return a.id === 444444 && a.rol === 'dueno'; }) && aut.length === 5 &&
    b.msgs.some(function (m) { return m.metodo === 'setMyCommands' && m.cuerpo.scope.chat_id === 444444 && m.cuerpo.commands.some(function (c) { return c.command === 'enviar'; }); }) &&
    b.msgs.some(function (m) { return m.metodo === 'sendMessage' && m.cuerpo.chat_id === 444444 && /dueño/.test(m.cuerpo.text); }), b.msgs);
  b = await bot('dueno', null, btnA);
  caso('el mismo botón otra vez -> "ya es" sin duplicar', JSON.parse(T.config.find(function (x) { return x.clave === 'AUTORIZADOS'; }).valor).length === 5);
  b = await bot('dueno', '/desautorizar 111');
  caso('/desautorizar a un admin -> no', /es admin/.test(b.texto));
  b = await bot('dueno', '/desautorizar 333');
  const btnD = b.msgs[0].cuerpo.reply_markup.inline_keyboard[0][0].callback_data;
  b = await bot('dueno', null, btnD);
  aut = JSON.parse(T.config.find(function (x) { return x.clave === 'AUTORIZADOS'; }).valor);
  caso('/desautorizar 333 + botón -> quitado y deleteMyCommands', !aut.some(function (a) { return a.id === 333; }) && b.msgs.some(function (m) { return m.metodo === 'deleteMyCommands' && m.cuerpo.scope.chat_id === 333; }), b.msgs);
  b = await bot('marketing', '/pedidos', null, 333);
  caso('revocado: efecto inmediato', /No estás autorizado/.test(b.texto));
  b = await bot('dueno', '/pedido PB-000105');
  caso('/pedido de un simulado pendiente: no reconsulta MP', b.q.ruta === 'pedido' && /simulado/.test(b.texto));
  const pend = T.pedidos.find(function (x) { return x.numero === 'PB-000104'; });
  caso('(no existe PB-000104: el número lo tomó "otro" en la prueba de carrera)', !pend);
  pagoMP('7010', 'PB-000103', 'approved', 1);
  b = await bot('dueno', '/pedido PB-000999');
  caso('/pedido inexistente -> lo dice', /No encontré el pedido PB-000999/.test(b.texto));

  console.log('\nWF2 / WF4 / WF11 (cambios v3)');
  {
    const N = { Config: [{ AUTORIZADOS: [{ id: 222, rol: 'dueno', nombre: 'E' }] }], 'Leer inbox': [{ id: 1, update_id: 10, estado: 'nuevo', intentos: 0, tipo: 'callback', chat_id: 222, from_id: 222, callback_id: 'x', callback_data: 'usr:aut:444444:m:zzzz', callback_message_id: 5, recibido: 0 }] };
    const e = (await correr(W2, 'Elegir', [], N))[0];
    caso('WF2: botón "usr:" -> ruta comando "boton_pedidos" (no WF5)', e.ruta === 'comando' && e.trabajo.comando === 'boton_pedidos' && e.trabajo.callback.data === 'usr:aut:444444:m:zzzz', e);
    N['Leer inbox'][0].callback_data = 'pub:drf-abcdef';
    caso('WF2: botón "pub:" sigue yendo a WF5', (await correr(W2, 'Elegir', [], N))[0].ruta === 'callback');
    const cfg4 = await correr(W4, 'Config', T.config, {});
    const i4 = async function (rol, comando, args) { return (await correr(W4, 'Interpretar', [], { Config: cfg4, Entrada: [{ trabajo: { chat_id: 1, from_id: 1, rol: rol, comando: comando, args: args || [] } }] }))[0]; };
    caso('WF4: /pedidos y /envios (marketing) -> WF16', (await i4('marketing', 'pedidos')).ruta === 'pedidos' && (await i4('marketing', 'envios')).ruta === 'pedidos');
    caso('WF4: /enviar y /autorizar (marketing) -> sin permiso', /no puede usar/.test((await i4('marketing', 'enviar', ['PB-000101'])).mensajes[0].cuerpo.text) && /no puede usar/.test((await i4('marketing', 'autorizar', ['1'])).mensajes[0].cuerpo.text));
    caso('WF4: /ayuda del dueño lista pedidos, estados y usuarios', /\/enviar PB-000101/.test((await i4('dueno', 'ayuda')).mensajes[0].cuerpo.text) && /\/autorizar/.test((await i4('dueno', 'ayuda')).mensajes[0].cuerpo.text));
    // WF11: seguimiento sin IA
    const v = { sesion: 'sesion-seg-0001', mensaje: 'Hacer seguimiento de mi pedido', pagina: {}, ip_hash: 'abcdef0123456789', ahora: Date.now() };
    const base11 = { Validar: [v], Config: [{ CHAT_MODELO: 'llama3.1:8b' }], Recientes: [{}], Historial: [{}], Aprendizaje: [{}], Citas: [{}], 'Catálogo': [{ whatsapp: '51995542938', ids: {}, tienda: '', catalogo: '' }] };
    let p = (await correr(W11, 'Preparar', [], base11))[0];
    caso('WF11: "Hacer seguimiento de mi pedido" -> sin IA, pide datos', p.llamar_ia === false && p.seguimiento === true && p.consultar === false, p);
    let rs = (await correr(W11, 'Respuesta seguimiento', [], Object.assign({}, base11, { Preparar: [p] })))[0];
    caso('WF11: respuesta pide número y correo + accion formulario_seguimiento', /número de tu pedido/.test(rs.texto) && rs.accion === 'formulario_seguimiento' && rs.filas.length === 2 && rs.filas[1].intencion === 'seguimiento', rs);
    const hist = [{ id: 1, sesion: v.sesion, rol: 'usuario', texto: 'Hacer seguimiento de mi pedido', intencion: 'seguimiento' }, { id: 2, sesion: v.sesion, rol: 'asistente', texto: rs.texto, intencion: 'seguimiento', cita_json: '' }];
    const v2 = Object.assign({}, v, { mensaje: 'Es el PB-000101, mi correo ana.rios@correo.com' });
    p = (await correr(W11, 'Preparar', [], Object.assign({}, base11, { Validar: [v2], Historial: hist })))[0];
    caso('WF11: con número y correo -> consulta WF15', p.consultar === true && p.numero === 'PB-000101' && p.correo === 'ana.rios@correo.com', p);
    rs = (await correr(W11, 'Respuesta seguimiento', [], Object.assign({}, base11, { Validar: [v2], Preparar: [p], 'WF15 Seguimiento': [sub] })))[0];
    caso('WF11: responde estado e historial de WF15 (sin datos personales)', /PB-000101 está: Pagado/.test(rs.texto) && /Historial:/.test(rs.texto) && rs.pedido && !/correo\.com/.test(rs.texto), rs.texto);
    const cu = (await correr(W11, 'Cuerpo seguimiento', [], Object.assign({}, base11, { 'Respuesta seguimiento': [rs] })))[0];
    caso('WF11: cuerpo para la web {respuesta, escribiendo_ms, pedido}', cu.status === 200 && typeof cu.cuerpo.respuesta === 'string' && cu.cuerpo.pedido.numero === 'PB-000101' && cu.aprender === false);
    p = (await correr(W11, 'Preparar', [], Object.assign({}, base11, { Validar: [Object.assign({}, v, { mensaje: '¿Cómo hago un pedido?' })] })))[0];
    caso('WF11: "¿Cómo hago un pedido?" sigue yendo a la IA', p.llamar_ia === true && /Vale/.test(p.cuerpo.messages[0].content) && !/Valeria/.test(p.cuerpo.messages[0].content));
  }

  console.log('\n' + ok + ' ok, ' + fallos + ' fallo(s)');
  process.exit(fallos ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
