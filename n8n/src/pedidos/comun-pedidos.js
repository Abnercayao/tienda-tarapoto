// --- comun-pedidos.js (Palmera Brava v3): ayudas de WF13 (Pedido-Crear), WF14 (MP-Notificación), WF15 (Seguimiento) y WF16 (Pedidos-Bot) ---
// Se inserta donde un Code dice "// @incluir comun-pedidos", DESPUÉS del bloque de validar.js y de comun.js cuando se usan sus funciones
// (crearPedido, vistaPublicaPedido, armarConfig, h, enviar...). Prefijo "pd" para no chocar con ellos. Sin módulos de Node (el task runner los bloquea).
const PD = {
  VENTANA_MS: 600000,          // ventana de los límites (10 min)
  CREAR_IP: 6,                 // pedidos nuevos por IP en 10 min
  CREAR_GLOBAL: 60,            // pedidos nuevos en total en 10 min
  SEG_IP: 20,                  // consultas de seguimiento por IP en 10 min
  SEG_FALLOS_IP: 8,            // consultas fallidas (número o correo que no coinciden) por IP en 10 min
  PAGO_IP: 20,                 // vueltas de Mercado Pago (/pedido/pago) por IP en 10 min
  PAGO_FALLOS_IP: 8,           // /pedido/pago fallidas (correo o número que no coinciden) por IP en 10 min
  CACHE_MS: 60000,             // catálogo publicado en caché (precios y stock casi al día)
  CACHE_VIEJA_MS: 3600000,     // si la web no responde, se usa la caché de hasta 1 h
  MAX_CUERPO: 8192,            // bytes del JSON del navegador
  CONFIRMAR_MS: 600000,        // los botones de confirmación del bot valen 10 min
  VENCE_PREFERENCIA_MS: 48 * 3600000
};
const PD_ENVIO_CORTO = { shalom: 'Shalom', olva: 'Olva Courier', bus: 'agencia de bus', local: 'entrega local en Tarapoto' };
// pb_config -> config del núcleo (armarConfig de comun.js) + claves de pedidos (todas opcionales).
//   MP_API_URL: https://api.mercadopago.com (o un simulador LOCAL en pruebas; cualquier otro valor se ignora: el token nunca sale a otro host)
//   MP_MODO: "auto" (por defecto: Mercado Pago; si la credencial es el placeholder -> pago simulado) | "simulado" (nunca llama a MP)
//   MP_LINK: "init_point" (por defecto; token APP_USR- de prueba) | "sandbox_init_point" (esquema antiguo con token TEST-)
//   MP_WEBHOOK_SECRET: clave secreta de Webhooks del panel de MP (si existe, se valida x-signature)
//   TUNEL_URL: https://<x>.trycloudflare.com (la guarda WF12) -> notification_url = TUNEL_URL + /mp-notificacion
//   CATALOGO_URL: de dónde se leen data/products.json y data/site.json (por defecto SITIO_URL; en pruebas, un servidor local)
//   TELEGRAM_API_URL: https://api.telegram.org (o un Telegram simulado local en pruebas)
function pdConfig(filas) {
  const cfg = armarConfig(filas);
  const raw = {};
  (filas || []).forEach(function (f) { if (f && typeof f.clave === 'string') raw[f.clave] = f.valor === null || f.valor === undefined ? '' : String(f.valor).trim(); });
  const local = /^http:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal):\d{2,5}$/;
  const mp = String(raw.MP_API_URL || '').replace(/\/$/, '');
  cfg.MP_API_URL = mp === 'https://api.mercadopago.com' || local.test(mp) ? mp : 'https://api.mercadopago.com';
  cfg.MP_MODO = raw.MP_MODO === 'simulado' ? 'simulado' : 'auto';
  cfg.MP_LINK = raw.MP_LINK === 'sandbox_init_point' ? 'sandbox_init_point' : 'init_point';
  cfg.MP_WEBHOOK_SECRET = /^[A-Za-z0-9_-]{8,200}$/.test(raw.MP_WEBHOOK_SECRET || '') ? raw.MP_WEBHOOK_SECRET : '';
  const tunel = String(raw.TUNEL_URL || '').toLowerCase().replace(/\/$/, '');
  cfg.TUNEL_URL = /^https:\/\/[a-z0-9]+(-[a-z0-9]+)*\.trycloudflare\.com$/.test(tunel) && !/^https:\/\/api\./.test(tunel) ? tunel : '';
  const cat = String(raw.CATALOGO_URL || '').replace(/\/?$/, '/');
  cfg.CATALOGO_URL = /^https:\/\/[^\s<>"'?#]+\/$/.test(cat) || /^http:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal):\d{2,5}\/([^\s<>"'?#]*\/)?$/.test(cat) ? cat : String(cfg.SITIO_URL).replace(/\/?$/, '/');
  cfg.TELEGRAM_API_URL = /^https?:\/\/[a-z0-9.-]+(:\d{2,5})?\/?$/i.test(raw.TELEGRAM_API_URL || '') ? raw.TELEGRAM_API_URL.replace(/\/$/, '') : 'https://api.telegram.org';
  cfg.PEDIDO_ULTIMO = /^PB-\d{6}$/.test(raw.PEDIDO_ULTIMO || '') ? raw.PEDIDO_ULTIMO : '';
  // Avisos de pedidos: admins y dueños (ids > 0). Marketing no ve datos de clientes.
  cfg.DESTINOS_PEDIDOS = (cfg.AUTORIZADOS || []).filter(function (a) { return a.id > 0 && (a.rol === 'admin' || a.rol === 'dueno'); })
    .map(function (a) { return a.id; }).filter(function (x, i, l) { return l.indexOf(x) === i; });
  return cfg;
}
// ---------- IP y límites (datos estáticos del workflow; solo persisten en ejecuciones de producción) ----------
function pdFnv(s, semilla) { let x = semilla >>> 0; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return ('0000000' + x.toString(16)).slice(-8); }
function pdHashIp(ip) { return pdFnv('pb|' + ip, 2166136261) + pdFnv(ip + '|chat', 33554467); } // igual que hashIp() del chat
function pdIp(hdr) {
  const hd = hdr && typeof hdr === 'object' ? hdr : {};
  const v = String(hd['x-real-ip'] || String(hd['x-forwarded-for'] || '').split(',')[0] || '').trim();
  return /^[0-9a-f:.]{3,45}$/i.test(v) ? v.toLowerCase() : 'sin-ip';
}
// Ventana deslizante: true si entra (y la registra). clave = "crear|<ip>", "seg|<ip>"...
function pdLimite(sd, clave, max, ahora, registrar) {
  sd.lim = sd.lim && typeof sd.lim === 'object' ? sd.lim : {};
  const l = (Array.isArray(sd.lim[clave]) ? sd.lim[clave] : []).filter(function (t) { return ahora - t < PD.VENTANA_MS; });
  const entra = l.length < max;
  if (entra && registrar !== false) l.push(ahora);
  sd.lim[clave] = l;
  const claves = Object.keys(sd.lim);
  if (claves.length > 2000) claves.forEach(function (k) { if (!sd.lim[k].length || ahora - sd.lim[k][sd.lim[k].length - 1] > PD.VENTANA_MS) delete sd.lim[k]; });
  return entra;
}
// "pb-123", "PB000123", "#123", "123" -> "PB-000123" ('' si no parece un número de pedido).
function pdNumero(t) {
  const m = /^\s*#?\s*(?:pb)?[\s-]*(\d{1,6})\s*$/i.exec(String(t === null || t === undefined ? '' : t));
  return m && Number(m[1]) > 0 ? 'PB-' + ('000000' + Number(m[1])).slice(-6) : '';
}
function pdCorreo(t) { const c = String(t === null || t === undefined ? '' : t).trim().toLowerCase(); return c.length <= 120 && /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(c) ? c : ''; }
// Errores del contrato ("[stock] prd-0019: no hay suficiente…") -> texto para el cliente, sin códigos ni rutas.
function pdErroresPublicos(errores) {
  const out = [];
  (Array.isArray(errores) ? errores : []).forEach(function (e) {
    let t = String(e || '').replace(/^\[[a-z_]+\]\s*/, '').replace(/^(pedido\.)?[a-z_]+(\[\d+\])?(\.[a-z_]+)*:\s*/i, '').replace(/^prd-\d{4,6}:\s*/, '').replace(/[<>]/g, '').trim();
    if (!t) return;
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (!/[.!?)]$/.test(t)) t += '.';
    if (out.indexOf(t) < 0) out.push(t);
  });
  return out.slice(0, 8);
}
function pdSoles(n) { return 'S/ ' + Number(n || 0).toFixed(2); }
function pdOpcionNombre(site, id) {
  const ops = site && site.envios && Array.isArray(site.envios.opciones) ? site.envios.opciones : [];
  const o = ops.find(function (x) { return x && x.id === id; });
  return o && o.nombre ? String(o.nombre) : PD_ENVIO_CORTO[id] || String(id || '');
}
function pdEstadoTexto(e) {
  return ({ pendiente_pago: 'Pendiente de pago', pagado: 'Pagado', preparando: 'Preparando', enviado: 'Enviado', listo_recojo: 'Listo para recoger', entregado: 'Entregado', cancelado: 'Cancelado' })[e] || String(e || '');
}
function pdTalla(t) { return t === 'UNICA' ? 'talla única' : 'talla ' + t; }
// ---------- Telegram (HTML; usa h() de comun.js) ----------
// Resumen de un pedido. detallado = datos del cliente (solo admin y dueño, por privado).
function pdTextoPedido(p, site, detallado) {
  const L = [];
  L.push('<b>' + h(p.numero) + '</b> · ' + h(pdEstadoTexto(p.estado)) + ' · ' + h(pdSoles(p.total)) + (p.pago && p.pago.preference_id && /^SIM-/.test(p.pago.preference_id) ? ' · <i>pago simulado (demo)</i>' : ''));
  L.push('Fecha: ' + h(String(p.fecha || '').slice(0, 16).replace('T', ' ')));
  (p.items || []).forEach(function (it) { L.push('• ' + h(it.cantidad + ' × ' + it.nombre + ' (' + it.color + ', ' + pdTalla(it.talla) + ') ' + pdSoles(it.precio_unit))); });
  L.push('Subtotal ' + h(pdSoles(p.subtotal)) + ' + envío ' + h(pdSoles(p.envio_costo)));
  const e = p.envio || {};
  L.push('Envío: ' + h(pdOpcionNombre(site, e.opcion)) + ' → ' + h([e.distrito, e.provincia, e.departamento].filter(Boolean).join(', ')) + (e.tiempo_estimado ? ' (' + h(e.tiempo_estimado) + ')' : ''));
  if (detallado) {
    const c = p.cliente || {};
    L.push('Cliente: ' + h(c.nombre) + ' · ' + h(c.correo) + ' · +' + h(c.telefono) + (c.dni ? ' · DNI ' + h(c.dni) : ''));
    if (e.direccion) L.push('Dirección: ' + h(e.direccion) + (e.referencia ? ' (ref.: ' + h(e.referencia) + ')' : ''));
    if (e.agencia_destino) L.push('Recoge en: ' + h(e.agencia_destino));
  } else L.push('Cliente: ' + h(String((p.cliente && p.cliente.nombre) || '').split(/\s+/)[0]) + ' (datos de contacto solo para admin y dueño)');
  if (p.pago) L.push('Pago: ' + h(p.pago.estado) + (p.pago.payment_id ? ' · operación ' + h(p.pago.payment_id) : ''));
  if (p.seguimiento) L.push('Seguimiento: ' + h(pdOpcionNombre(site, p.seguimiento.agencia)) + (p.seguimiento.codigo ? ' · ' + h(p.seguimiento.codigo) : '') + (p.seguimiento.url ? ' · ' + h(p.seguimiento.url) : ''));
  const H = Array.isArray(p.historial) ? p.historial : [];
  if (H.length > 1) L.push('Historial: ' + H.map(function (x) { return h(pdEstadoTexto(x.estado) + ' ' + String(x.fecha || '').slice(5, 16).replace('T', ' ')); }).join(' → '));
  return L.join('\n');
}
// Siguiente paso sugerido según el estado (para el bot).
function pdSiguientePaso(p) {
  const n = p.numero;
  if (p.estado === 'pendiente_pago') return 'espera el pago (te aviso al confirmarse) o cancélalo con /cancelar_pedido ' + n + '.';
  if (p.estado === 'pagado') return 'prepáralo y escribe /preparando ' + n + ' (o /enviar ' + n + ' ' + p.envio.opcion + ' <código>).';
  if (p.estado === 'preparando') return 'cuando lo despaches escribe /enviar ' + n + ' ' + p.envio.opcion + (p.envio.opcion === 'local' ? '' : ' <código>') + '.';
  if (p.estado === 'enviado') return p.envio.opcion === 'local' ? 'al entregarlo escribe /entregado ' + n + '.' : 'si llegó a la agencia escribe /recojo ' + n + '; al entregarse, /entregado ' + n + '.';
  if (p.estado === 'listo_recojo') return 'cuando el cliente lo recoja escribe /entregado ' + n + '.';
  return 'nada; el pedido está cerrado.';
}
// Mensaje de Telegram para cada destino (admin y dueño). El texto debe terminar en "Siguiente paso".
function pdAvisos(cfg, texto) { return (cfg.DESTINOS_PEDIDOS || []).map(function (id) { return enviar(id, texto); }); }
// ---------- Mercado Pago ----------
// Pago "simulado" (credencial sin configurar o MP_MODO=simulado): mismo objeto que GET /v1/payments/{id}, aprobado, SOLO para
// pedidos creados en modo simulado (preference_id "SIM-..."). Un pedido real nunca acepta este pago.
function pdEsSimulado(p) { return !!(p && p.pago && /^SIM-/.test(String(p.pago.preference_id || ''))); }
function pdPagoSimulado(p) {
  return { id: 'SIM' + String(p.numero).replace(/\D/g, ''), status: 'approved', status_detail: 'pago simulado (demo)', external_reference: p.numero, currency_id: 'PEN', transaction_amount: p.total };
}
// SHA-256 y HMAC-SHA256 en JS puro (el task runner de n8n no deja cargar el módulo de cifrado de Node). Probado contra Node crypto en probar-pedidos.js.
const PD_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
function pdUtf8(s) { const t = unescape(encodeURIComponent(String(s))); const out = new Array(t.length); for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i); return out; }
function pdSha256(bytes) {
  const rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const m = bytes.slice();
  const bits = bytes.length * 8;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  for (let i = 7; i >= 0; i--) m.push(Math.floor(bits / Math.pow(2, i * 8)) & 0xff);
  const w = new Array(64);
  for (let o = 0; o < m.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], k = H[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + PD_K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + k) | 0;
  }
  const out = [];
  H.forEach(function (x) { out.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff); });
  return out;
}
function pdHex(bytes) { return bytes.map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
function pdHmacSha256Hex(clave, mensaje) {
  let k = pdUtf8(clave);
  if (k.length > 64) k = pdSha256(k);
  while (k.length < 64) k.push(0);
  const ipad = k.map(function (b) { return b ^ 0x36; });
  const opad = k.map(function (b) { return b ^ 0x5c; });
  return pdHex(pdSha256(opad.concat(pdSha256(ipad.concat(pdUtf8(mensaje))))));
}
// x-signature de Mercado Pago ("ts=...,v1=..."): HMAC-SHA256(secreto, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;").
// Un valor que falta se quita del texto; data.id alfanumérico va en minúsculas. -> { ok, motivo }
function pdFirmaMP(firma, requestId, dataId, secreto) {
  if (!secreto) return { ok: true, motivo: 'sin clave secreta configurada (no se valida la firma)' };
  const partes = {};
  String(firma || '').split(',').forEach(function (p) { const i = p.indexOf('='); if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  if (!partes.ts || !/^[0-9a-f]{64}$/i.test(partes.v1 || '')) return { ok: false, motivo: 'falta la cabecera x-signature (ts y v1)' };
  const id = String(dataId === null || dataId === undefined ? '' : dataId);
  let manifiesto = '';
  if (id) manifiesto += 'id:' + (/^[a-z0-9]+$/i.test(id) ? id.toLowerCase() : id) + ';';
  if (requestId) manifiesto += 'request-id:' + requestId + ';';
  manifiesto += 'ts:' + partes.ts + ';';
  const esperado = pdHmacSha256Hex(secreto, manifiesto);
  const v1 = partes.v1.toLowerCase();
  let dif = 0;
  for (let i = 0; i < 64; i++) dif |= esperado.charCodeAt(i) ^ v1.charCodeAt(i);
  return dif === 0 ? { ok: true, motivo: 'firma válida' } : { ok: false, motivo: 'firma inválida' };
}
// ---------- Stock tras un pago (borradores del sistema, auto-aprobados; WF5 los publica en el siguiente lote) ----------
// Un borrador "stock" por producto con stock_por_color [{color, cantidad}] y stock_modo "restar" (aplicarStockColor de validar.js).
// rol "dueno": límites de daño del dueño. chat_id = primer admin/dueño (recibe "Publicado: stock …" o el error si no alcanzó).
function pdBorradoresStock(pedido, cfg, ahora) {
  const porProducto = {};
  (pedido.items || []).forEach(function (it) {
    const l = porProducto[it.id] = porProducto[it.id] || [];
    const x = l.find(function (y) { return y.color === it.color; });
    if (x) x.cantidad += it.cantidad; else l.push({ color: it.color, cantidad: it.cantidad });
  });
  const chat = (cfg.DESTINOS_PEDIDOS || [])[0] || 0;
  return Object.keys(porProducto).map(function (id, i) {
    const lista = porProducto[id];
    const resumen = 'stock ' + id + ' -' + lista.map(function (x) { return x.cantidad + ' ' + x.color; }).join(', -') + ' (pedido ' + pedido.numero + ')';
    return {
      draft_id: 'drf-' + (Number(ahora) + i).toString(36) + String(pedido.numero).replace(/\D/g, '').slice(-6), owner_id: 0, rol: 'dueno', chat_id: chat, preview_message_id: 0,
      origen: 'pedido', op: 'stock', entidad: 'producto', entidad_id: id,
      campos: JSON.stringify({ stock_por_color: lista, stock_modo: 'restar' }), campos_inferidos: '[]', faltantes: '[]', avisos: '[]',
      update_ids: '[]', file_ids: '[]', file_unique_ids: '[]', fecha: isoLima(ahora), expira: isoLima(Number(ahora) + 86400000), estado: 'aprobado',
      confirmaciones: 0, confirmaciones_requeridas: 1, intentos: 0, error: '', commit_sha: '', texto: 'Pago confirmado de ' + pedido.numero,
      resumen: resumen.slice(0, 200), fecha_ms: Number(ahora)
    };
  });
}
// site.json publicado (caché 10 min en los datos estáticos). ctx = this del nodo Code (helpers.httpRequest). null si no responde.
async function pdSite(ctx, cfg, sd) {
  const ahora = Date.now();
  if (sd.site && ahora - Number(sd.site.ts) < 600000 && sd.site.base === cfg.CATALOGO_URL) return sd.site.datos;
  try {
    const r = await ctx.helpers.httpRequest({ method: 'GET', url: cfg.CATALOGO_URL + 'data/site.json?v=' + Math.floor(ahora / 600000), json: true, timeout: 8000 });
    const s = typeof r === 'string' ? JSON.parse(r) : r;
    if (s && typeof s === 'object' && !Array.isArray(s)) { sd.site = { ts: ahora, base: cfg.CATALOGO_URL, datos: s }; return s; }
  } catch (e) { /* sin red: caché vieja */ }
  return sd.site ? sd.site.datos : null;
}
// ---------- Bot: botones de confirmación ("ped:" y "usr:"; WF2 los manda a WF4 -> WF16) ----------
function pdCaduca(ahora) { return Math.floor((Number(ahora) + PD.CONFIRMAR_MS) / 1000).toString(36); }
function pdVigente(c36, ahora) { const t = parseInt(String(c36 || ''), 36); return Number.isFinite(t) && t * 1000 >= Number(ahora); }
// --- fin comun-pedidos.js ---
