//// Entrada
// @incluir comun-pedidos
// Tres entradas (CONTRATO 00.6 y 00.7):
//   mp  = aviso de Mercado Pago (POST /webhook/mp-notificacion, vía proxy /mp-notificacion). n8n ya respondió 200 al recibirlo.
//         {"type":"payment","data":{"id":"123"}} (+ ?data.id=123&type=payment) o el IPN antiguo ?topic=payment&id=123. Otros tipos: se ignoran.
//   web = vuelta de Mercado Pago a la web (POST /webhook/pedido-pago, vía proxy /pedido/pago): {numero, correo?, payment_id?}.
//         payment_id "SIMULADO" = pago simulado de la demo (solo pedidos creados en modo simulado).
//         El correo del pedido es OBLIGATORIO salvo que payment_id sea un pago real de Mercado Pago de ESTE pedido (GET /v1/payments/{id}):
//         SIMULADO o sin payment_id sin el correo correcto -> la MISMA respuesta que un pedido inexistente ({ok:false, motivo:"no_encontrado"}).
//         Límites por IP: PD.PAGO_IP consultas y PD.PAGO_FALLOS_IP fallos (correo o número que no coinciden) cada 10 min -> 429.
//   sub = sub-workflow (WF16 /pedido <num>): {numero} -> busca el pago por external_reference.
// Lo único que se cree es la respuesta de GET /v1/payments/{id} con nuestro token (nunca el cuerpo del aviso ni el ?status= de la URL).
const ahora = Date.now();
const desde = $('POST mp-notificacion').isExecuted ? 'mp' : $('POST pedido-pago').isExecuted ? 'web' : 'sub';
const no = function (status, motivo, extra) { return [{ json: Object.assign({ desde: desde, valido: false, motivo: motivo, status: status, cuerpo: { ok: false, motivo: motivo } }, extra || {}) }]; };
const obj = function (v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
if (desde === 'mp') {
  const w = $('POST mp-notificacion').first().json || {};
  const q = obj(w.query), b = obj(w.body), hd = obj(w.headers);
  const tipo = String(b.type || q.type || b.topic || q.topic || '').toLowerCase();
  const id = String(q['data.id'] || obj(b.data).id || (tipo === 'payment' ? q.id || b.id || '' : '') || '').trim();
  if (tipo !== 'payment') return no(200, 'aviso de tipo "' + tipo.slice(0, 30) + '": no es un pago, se ignora');
  if (!/^\d{3,20}$/.test(id)) return no(200, 'aviso sin id de pago válido');
  return [{ json: { desde: desde, valido: true, consulta: 'pago', payment_id: id, numero: '',
    firma: { x_signature: String(hd['x-signature'] || '').slice(0, 300), x_request_id: String(hd['x-request-id'] || '').slice(0, 100), data_id: String(q['data.id'] || '').slice(0, 30) } } }];
}
let numero, pid, correo = '', ip = '';
if (desde === 'web') {
  const w = $('POST pedido-pago').first().json || {};
  const b = obj(w.body);
  const sd = $getWorkflowStaticData('global');
  ip = pdHashIp(pdIp(w.headers || {}));
  if (!pdLimite(sd, 'pagofallo|' + ip, PD.PAGO_FALLOS_IP, ahora, false) || !pdLimite(sd, 'pago|' + ip, PD.PAGO_IP, ahora)) return no(429, 'limite');
  numero = pdNumero(b.numero);
  pid = String(b.payment_id === undefined || b.payment_id === null ? '' : b.payment_id).trim();
  correo = pdCorreo(b.correo);
} else {
  const s = $('Entrada sub').first().json || {};
  numero = pdNumero(s.numero);
  pid = String(s.payment_id === undefined || s.payment_id === null ? '' : s.payment_id).trim();
}
if (!numero) return no(400, 'numero_invalido');
if (pid && pid !== 'SIMULADO' && !/^\d{3,20}$/.test(pid)) return no(400, 'payment_id_invalido');
// Web sin pago real que lo respalde (SIMULADO o sin payment_id) y sin correo: lo mismo que un pedido inexistente, sin leer nada.
if (desde === 'web' && !correo && (!pid || pid === 'SIMULADO')) return no(200, 'no_encontrado');
return [{ json: { desde: desde, valido: true, numero: numero, correo: correo, ip_hash: ip, payment_id: pid === 'SIMULADO' ? '' : pid, consulta: pid === 'SIMULADO' ? 'simulado' : pid ? 'pago' : 'buscar', firma: null } }];

//// Config
// @incluir comun
// @incluir comun-pedidos
return [{ json: pdConfig($input.all().map(function (i) { return i.json; })) }];

//// Preparar consulta
// @incluir comun-pedidos
// Firma x-signature (solo avisos de MP y solo si pb_config.MP_WEBHOOK_SECRET tiene la clave secreta del panel de Webhooks).
// Firma inválida -> no se consulta nada (un aviso falso tampoco podría marcar un pago: se verifica con GET /v1/payments).
const e = $('Entrada').first().json;
const cfg = $('Config').first().json;
let consulta = e.consulta, motivo = '';
if (e.desde === 'mp') {
  const f = pdFirmaMP(e.firma.x_signature, e.firma.x_request_id, e.firma.data_id || e.payment_id, cfg.MP_WEBHOOK_SECRET);
  if (!f.ok) { consulta = 'nada'; motivo = f.motivo; }
}
return [{ json: Object.assign({}, e, { consulta: consulta, motivo: motivo }) }];

//// Pago MP
// GET /v1/payments/{id} o /v1/payments/search?external_reference=… -> un pago (o null). La web y el bot solo aceptan pagos de SU pedido.
const p = $('Preparar consulta').first().json;
let pago = null, error = '';
const leer = function (n) { return $(n).isExecuted ? ($(n).first().json || {}) : null; };
if (p.consulta === 'pago') {
  const r = leer('GET pago') || {};
  if (Number(r.statusCode) === 200 && r.body && r.body.id !== undefined) pago = r.body;
  else error = Number(r.statusCode) === 401 || Number(r.statusCode) === 403 ? 'credencial de Mercado Pago inválida (HTTP ' + r.statusCode + ')' : 'GET /v1/payments HTTP ' + (r.statusCode || 'sin respuesta');
} else if (p.consulta === 'buscar') {
  const r = leer('Buscar pago') || {};
  const lista = r.body && Array.isArray(r.body.results) ? r.body.results.filter(function (x) { return x && x.external_reference === p.numero; }) : [];
  pago = lista.find(function (x) { return x.status === 'approved'; }) || lista[0] || null;
  if (!pago) error = Number(r.statusCode) === 200 ? 'sin pagos para ' + p.numero : 'GET /v1/payments/search HTTP ' + (r.statusCode || 'sin respuesta');
}
let numero = p.numero;
if (pago) {
  const ref = String(pago.external_reference || '');
  if (p.desde === 'mp') numero = ref;
  else if (ref !== p.numero) { error = 'el pago ' + String(pago.id).slice(0, 20) + ' no es del pedido ' + p.numero; pago = null; }
}
if (!/^PB-\d{6}$/.test(String(numero || ''))) { numero = ''; if (!error) error = 'el pago no trae un número de pedido de esta tienda'; }
return [{ json: { numero: numero, pago: pago, error: error, simulado: p.consulta === 'simulado', consulta: p.consulta } }];

//// Aplicar pago
// @incluir validar.js
// @incluir comun-pedidos
// aplicarPagoMP de validar.js: referencia, moneda PEN y monto = total; estado del pedido con historial. Idempotente (avisos repetidos
// no duplican el historial) y un rechazo tardío no pisa un pago aprobado.
// Web: sin un pago real de Mercado Pago de ESTE pedido (consulta "pago" con GET /v1/payments/{id} correcto) hace falta el correo del
// pedido (mismoCorreo: sin espacios ni mayúsculas). Si no coincide -> igual que un pedido inexistente, y cuenta como fallo de la IP.
const pm = $('Pago MP').first().json;
const e = $('Entrada').first().json;
const filas = $input.all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined && j.numero === pm.numero; });
const fila = filas[0] || null;
const porPagoReal = pm.consulta === 'pago' && !!pm.pago;
if (e.desde === 'web' && !porPagoReal && !(fila && mismoCorreo(String(fila.correo || ''), String(e.correo || '')))) {
  if (e.correo) pdLimite($getWorkflowStaticData('global'), 'pagofallo|' + e.ip_hash, PD.PAGO_FALLOS_IP, Date.now());
  return [{ json: { guardar: false, numero: pm.numero, pedido: null, notificar: null, errores: ['no_encontrado'], motivo: 'no_encontrado', simulado: false } }];
}
const pedido = fila ? pedidoDesdeFila(fila) : null;
const base = { guardar: false, numero: pm.numero, pedido: pedido, notificar: null, errores: [], simulado: false };
if (!pedido) return [{ json: Object.assign(base, { errores: [pm.error || 'no_encontrado'], motivo: 'no_encontrado' }) }];
let pago = pm.pago;
if (pm.simulado) {
  if (!pdEsSimulado(pedido)) return [{ json: Object.assign(base, { errores: ['el pedido usa Mercado Pago real: no acepta pagos simulados'] }) }];
  pago = pdPagoSimulado(pedido);
  base.simulado = true;
}
if (!pago) return [{ json: Object.assign(base, { errores: [pm.error || 'sin pago'] }) }];
const r = aplicarPagoMP(pedido, pago, {});
if (!r.ok) return [{ json: Object.assign(base, { errores: r.errores }) }];
// Pago simulado: el historial lo dice claro (lo ven el cliente en Seguimiento y el dueño en /pedido).
if (base.simulado && r.cambio && r.pedido.historial.length) r.pedido.historial[r.pedido.historial.length - 1].nota = 'Pago SIMULADO aprobado (demo: Mercado Pago aún no está configurado; no hubo cobro real)';
return [{ json: Object.assign(base, { guardar: r.cambio === true, actualizado_previo: String(fila.actualizado || ''), pedido: r.pedido, notificar: r.notificar,
  fila: filaPedido(r.pedido), avisos: r.avisos, payment_id: String(pago.id) }) }];

//// Guardado
// @incluir comun
// @incluir comun-pedidos
// El UPDATE filtra por "actualizado" previo: si otro aviso (o la vuelta de la web) ya guardó este mismo cambio, aquí no se repiten
// ni el aviso de Telegram ni el descuento de stock.
const a = $('Aplicar pago').first().json;
const cfg = $('Config').first().json;
const ok = $input.all().some(function (i) { return i.json && i.json.id !== undefined && i.json.numero === a.numero; });
const stock = ok && a.notificar === 'pagado' ? pdBorradoresStock(a.pedido, cfg, Date.now()) : [];
const notificar = ok ? a.notificar : null;
return [{ json: { guardado: ok, stock: stock, notificar: notificar, avisar: !!(notificar && cfg.BOT_TOKEN && cfg.DESTINOS_PEDIDOS.length) } }];

//// Filas stock
return $('Guardado').first().json.stock.map(function (f) { return { json: f }; });

//// Avisos pago
// @incluir comun
// @incluir comun-pedidos
// Pago confirmado (o rechazado / devuelto) -> admins y dueños. Sin token de bot: no se avisa.
const cfg = $('Config').first().json;
const a = $('Aplicar pago').first().json;
const g = $('Guardado').first().json;
if (!cfg.BOT_TOKEN || !g.notificar || !cfg.DESTINOS_PEDIDOS.length) return [];
const p = a.pedido;
let titulo, paso;
if (g.notificar === 'pagado') {
  titulo = '✅ <b>Pago confirmado</b> ' + (a.simulado ? '(SIMULADO, demo) ' : '(Mercado Pago, modo prueba) ') + 'de ' + h(p.numero);
  const n = g.stock.length;
  paso = 'prepara el pedido y escribe /preparando ' + p.numero + '. El stock se descuenta solo en el próximo lote (' + n + ' cambio' + (n === 1 ? '' : 's') + ' aprobado' + (n === 1 ? '' : 's') + ').';
} else if (g.notificar === 'cancelado') {
  titulo = '↩️ <b>Mercado Pago informa una devolución</b> de ' + h(p.numero) + ': el pedido pasó a cancelado';
  paso = 'revisa la devolución en Mercado Pago.';
} else {
  titulo = '⚠️ <b>Pago rechazado</b> de ' + h(p.numero) + ' (' + h(String(p.pago.detalle || p.pago.estado)) + ')';
  paso = 'nada; el cliente puede volver a intentarlo desde el enlace de pago.';
}
return pdAvisos(cfg, titulo + '\n' + pdTextoPedido(p, null, true) + '\nSiguiente paso: ' + h(paso)).map(function (m) { return { json: m }; });

//// Respuesta
// @incluir comun-pedidos
// Lo que vuelve a la web (sin datos personales) o a WF16. Los avisos de MP no esperan respuesta (ya se respondió 200).
const e = $('Entrada').first().json;
if (!e.valido) return [{ json: { desde: e.desde, status: e.status, cuerpo: e.cuerpo } }];
const a = $('Aplicar pago').isExecuted ? $('Aplicar pago').first().json : null;
const g = $('Guardado').isExecuted ? $('Guardado').first().json : null;
const pc = $('Preparar consulta').first().json;
if (!a || !a.pedido) return [{ json: { desde: e.desde, status: 200, cuerpo: { ok: false, motivo: pc.consulta === 'nada' ? 'firma_invalida' : 'no_encontrado' }, detalle: pc.motivo || (a && a.errores) || [] } }];
const p = a.pedido;
const cuerpo = { ok: true, numero: p.numero, estado: p.estado, estado_texto: pdEstadoTexto(p.estado), pago_estado: p.pago.estado };
if (a.simulado) cuerpo.simulado = true;
if (a.errores && a.errores.length) cuerpo.aviso = 'No pude confirmar el pago con Mercado Pago todavía; vuelve a consultar en unos minutos.';
return [{ json: { desde: e.desde, status: 200, cuerpo: cuerpo, pedido: e.desde === 'sub' ? p : undefined, cambio: !!(g && g.guardado) } }];

//// Salida sub
// Para WF16 (/pedido <num>): el pedido actualizado (o el motivo).
const j = $input.first().json || {};
return [{ json: Object.assign({ ok: !!(j.cuerpo && j.cuerpo.ok) }, j.cuerpo || {}, { pedido: j.pedido || null, cambio: j.cambio === true }) }];
