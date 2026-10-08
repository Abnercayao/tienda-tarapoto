//// Entrada
// @incluir comun-pedidos
// Seguimiento de pedido (CONTRATO 00.7): número + correo -> vista pública (sin correo, celular, DNI, dirección ni apellidos).
//   web = POST /webhook/pedido-seguimiento (proxy /seguimiento y /pedido/consultar): {numero, correo}
//   sub = WF11 (chat Vale, intención "seguimiento"): {numero, correo, ip_hash}
// Mismo resultado si falla el número o el correo ("no_encontrado"); límites por IP (consultas y fallos) contra adivinanzas.
const ahora = Date.now();
const web = $('POST pedido-seguimiento').isExecuted;
const desde = web ? 'web' : 'sub';
const obj = function (v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
let datos, ip;
if (web) { const w = $('POST pedido-seguimiento').first().json || {}; datos = obj(w.body); ip = pdHashIp(pdIp(w.headers || {})); }
else { datos = obj($('Entrada sub').first().json); ip = /^[0-9a-f]{8,32}$/.test(String(datos.ip_hash || '')) ? String(datos.ip_hash) : 'sub'; }
const no = function (status, motivo) { return [{ json: { desde: desde, valido: false, status: status, cuerpo: { ok: false, motivo: motivo } } }]; };
const sd = $getWorkflowStaticData('global');
if (!pdLimite(sd, 'fallo|' + ip, PD.SEG_FALLOS_IP, ahora, false) || !pdLimite(sd, 'seg|' + ip, PD.SEG_IP, ahora)) return no(429, 'limite');
const numero = pdNumero(datos.numero);
const correo = pdCorreo(datos.correo);
if (!numero || !correo) return no(400, 'datos_invalidos');
return [{ json: { desde: desde, valido: true, numero: numero, correo: correo, ip_hash: ip } }];

//// Config
// @incluir comun
// @incluir comun-pedidos
return [{ json: pdConfig($input.all().map(function (i) { return i.json; })) }];

//// Vista
// @incluir validar.js
// @incluir comun-pedidos
// Busca por número y compara el correo (mismoCorreo). site.json publicado (caché 10 min) para los nombres de estados y agencias.
const e = $('Entrada').first().json;
const cfg = $('Config').first().json;
const sd = $getWorkflowStaticData('global');
const ahora = Date.now();
const filas = $('Leer pedido').all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined && j.numero === e.numero; });
const fila = filas.find(function (f) { return mismoCorreo(f.correo, e.correo); });
const pedido = fila ? pedidoDesdeFila(fila) : null;
if (!pedido) {
  pdLimite(sd, 'fallo|' + e.ip_hash, PD.SEG_FALLOS_IP, ahora); // cuenta el fallo
  return [{ json: { desde: e.desde, status: 200, cuerpo: { ok: false, motivo: 'no_encontrado' } } }];
}
const site = await pdSite(this, cfg, sd);
const vista = vistaPublicaPedido(pedido, site);
return [{ json: { desde: e.desde, status: 200, cuerpo: { ok: true, pedido: vista } } }];

//// Salida sub
// Para WF11: {ok, pedido|motivo}.
const j = $input.first().json || {};
return [{ json: Object.assign({ status: j.status }, j.cuerpo || { ok: false, motivo: 'error' }) }];
