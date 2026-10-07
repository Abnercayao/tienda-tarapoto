//// Config
// @incluir comun
return [{ json: armarConfig($input.all().map(function (i) { return i.json; })) }];

//// Validar pedido
// @incluir comun
// Cuerpo de admin.html (pedirAN8n): {prompt, prompt_usuario, tipo, personas, size, tamano_final, recortar_arriba, seed, origen:"panel"}.
// WF6 rehace el prompt desde prompt_usuario con las mismas frases del panel y DECIDE el recorte (con personas siempre recorta).
// Destinatario de la foto en Telegram (dueño del borrador): primer admin con id > 0; si no hay, primer dueño.
const cfg = $('Config').first().json;
const w = $('POST crear-imagen').first().json || {};
const b = w.body && typeof w.body === 'object' && !Array.isArray(w.body) ? w.body : {};
const malo = function (msg, paso) { return [{ json: { valido: false, status: 400, cuerpo: { ok: false, error: msg, siguiente_paso: paso } } }]; };
const texto = String(b.prompt_usuario || b.prompt || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
const n = Array.from(texto).length;
if (n < 3 || n > 1200) return malo('la descripción debe tener entre 3 y 1200 caracteres', 'escribe qué quieres ver en la imagen (por ejemplo, la prenda, el color y el fondo).');
const TAM = ['768x1024', '1344x768', '1216x832', '1024x1024'];
const final = TAM.indexOf(String(b.tamano_final || '')) >= 0 ? String(b.tamano_final) : TAM.indexOf(String(b.size || '')) >= 0 ? String(b.size) : '';
const obj = String(b.objetivo || '').trim().toLowerCase();
const s0 = Number(b.seed);
const aut = cfg.AUTORIZADOS || [];
const dest = aut.find(function (a) { return a.rol === 'admin' && a.id > 0; }) || aut.find(function (a) { return a.rol === 'dueno' && a.id > 0; }) || null;
return [{ json: { valido: true, inicio: Date.now(), pedido: {
  prompt: texto, objetivo: /^(art-\d{4,6}|look-\d{1,3})$/.test(obj) ? obj : '', size: final,
  personas: b.personas === 'adultos' || b.personas === 'ninguna' ? b.personas : '',
  seed: Number.isInteger(s0) && s0 >= 1 && s0 <= 2147483646 ? s0 : 0,
  tipo: ['hero', 'lookbook', 'blog', 'producto-muestra'].indexOf(b.tipo) >= 0 ? b.tipo : '',
  chat_id: dest ? dest.id : 0, from_id: dest ? dest.id : 0, rol: dest ? dest.rol : '', nombre: dest ? dest.nombre : '', origen: 'panel'
} } }];

//// Esperar turno
// Lock "worker" ocupado (WF2 con Ollama/GitHub u otra imagen): se reintenta cada 5 s durante 10 min como máximo.
const v = $('Validar pedido').first().json;
const espera = Date.now() - Number(v.inicio || 0);
return [{ json: { agotado: !(espera < 600000), espera_s: Math.round(espera / 1000) } }];

//// Ocupado
return [{ json: { status: 423, cuerpo: { ok: false, error: 'ocupado', mensaje: 'La GPU estuvo ocupada 10 minutos (bot de Telegram, publicación u otra imagen).',
  siguiente_paso: 'intenta de nuevo en unos minutos; en Telegram, /estado muestra la cola.' } } }];

//// Pedido
// Ítem de entrada de WF6 (passthrough). WF8 ya tiene el lock: WF6 no lo toca.
return [{ json: $('Validar pedido').first().json.pedido }];

//// Respuesta
// @incluir comun
// Lock ya liberado. Rehace el binario desde el b64 de WF6 (en esta ejecución) o arma el error JSON para el panel.
const r = $('WF6 Imagen').first() ? $('WF6 Imagen').first().json || {} : {};
if (r.ok === true && typeof r.b64 === 'string' && r.b64.length > 100) {
  const buf = Buffer.from(r.b64, 'base64');
  const bin = await this.helpers.prepareBinaryData(buf, 'palmera-brava-ia-' + (Number(r.seed) || 0) + '.webp', 'image/webp');
  return [{ json: { ok: true, draft_id: String(r.draft_id || ''), telegram: r.telegram === true ? 'si' : 'no', seed: String(Number(r.seed) || ''),
    tamano: String(r.tamano || '') }, binary: { data: bin } }];
}
const e = r.error;
const msg = censurar(typeof e === 'string' ? e : (e && (e.message || e.description)) || 'WF6 no devolvió la imagen').replace(/\s+/g, ' ').slice(0, 200);
const PASOS = {
  pedido: 'revisa el texto del pedido.',
  sd: 'revisa sd-server arriba (tools\\iniciar-sd-server.bat) y vuelve a intentar.',
  recorte: 'vuelve a generar con otra semilla.'
};
return [{ json: { ok: false, status: r.etapa === 'pedido' ? 400 : 502,
  cuerpo: { ok: false, error: msg, siguiente_paso: PASOS[r.etapa] || 'revisa la ejecución de "PB WF6 Imagen-IA" en n8n (Executions) y que WF6 esté publicado.' } } }];

//// Config estado
// @incluir comun
return [{ json: armarConfig($input.all().map(function (i) { return i.json; })) }];

//// Estado
// @incluir comun
// Resumen para el panel (sin token ni ids): cola, borradores, lock de GPU/GitHub, pausa, último commit, poller y salud de Ollama y sd-server.
const cfg = $('Config estado').first().json;
const filas = function (n) { return $(n).all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined; }); };
const ahora = Date.now();
const lock = filas('Leer lock')[0] || {};
const ocupado = Number(lock.hasta) > ahora;
const cola = filas('Inbox nuevo').length;
const aprobados = filas('Aprobados').length;
const pendientes = filas('Pendientes').length;
const ov = $('Ollama version').first().json || {};
const ops = $('Ollama ps').first().json || {};
const sd = $('sd-server salud').first().json || {};
const ollamaOk = typeof ov.version === 'string';
const cargados = (Array.isArray(ops.models) ? ops.models : []).map(function (m) { return String((m && (m.name || m.model)) || ''); }).filter(Boolean).slice(0, 5);
const sdOk = Number(sd.statusCode) >= 200 && Number(sd.statusCode) < 500;   // responde = en línea (fullResponse)
const pollHace = cfg.ULTIMO_POLL_AT ? Math.round((ahora - cfg.ULTIMO_POLL_AT) / 1000) : -1;
const autorizados = (cfg.AUTORIZADOS || []).filter(function (a) { return a.id > 0; }).length;
const fecha = function (ms) { return ms ? isoLima(ms).slice(0, 16).replace('T', ' ') : 'nunca'; };
const mas = function (k) { return k >= 200 ? '200 o más' : String(k); };
let paso = 'nada; todo en orden.';
if (!cfg.BOT_TOKEN) paso = 'pega el token del bot en la Data Table pb_config (BOT_TOKEN) y ejecuta "PB WF0 Setup".';
else if (!autorizados) paso = 'escribe /start al bot, copia tu id desde pb_config.DESCONOCIDOS a AUTORIZADOS y ejecuta WF0.';
else if (pollHace < 0 || pollHace > 60) paso = 'publica "PB WF1 Ingesta" en n8n (no lee Telegram desde hace ' + (pollHace < 0 ? 'siempre' : pollHace + ' s') + ').';
else if (cfg.PAUSA === 1 && aprobados) paso = 'usa /reanudar en Telegram para publicar los aprobados.';
else if (!sdOk) paso = 'para crear imágenes, ejecuta tools\\iniciar-sd-server.bat.';
else if (!ollamaOk) paso = 'inicia Ollama para que el bot entienda fotos y mensajes.';
const lineas = [
  'Bot de Telegram: ' + (cfg.BOT_TOKEN ? 'configurado' : 'SIN TOKEN') + '; ' + autorizados + ' persona(s) autorizada(s); última lectura de Telegram: ' + (pollHace < 0 ? 'nunca' : 'hace ' + pollHace + ' s') + (cfg.FALLOS_SEGUIDOS ? ' (' + cfg.FALLOS_SEGUIDOS + ' fallos seguidos)' : '') + '.',
  'GPU y GitHub: ' + (ocupado ? 'ocupados hasta las ' + isoLima(Number(lock.hasta)).slice(11, 19) : 'libres') + '.',
  'Mensajes en cola: ' + mas(cola) + '. Borradores pendientes: ' + mas(pendientes) + '. Aprobados por publicar: ' + mas(aprobados) + '.',
  'Publicación: ' + (cfg.PAUSA === 1 ? 'EN PAUSA' : 'activa') + '. Último commit del bot: ' + fecha(cfg.ULTIMO_COMMIT_AT) + '.',
  'Ollama: ' + (ollamaOk ? 'en línea (v' + ov.version + (cargados.length ? '; cargado: ' + cargados.join(', ') : '; sin modelos en VRAM') + ')' : 'no responde') + '.',
  'sd-server: ' + (sdOk ? 'en línea' : 'no responde') + '.',
  'Siguiente paso: ' + paso
];
return [{ json: {
  ok: true, ahora: isoLima(ahora), ocupado: ocupado, lock_hasta: ocupado ? Number(lock.hasta) : 0, cola: cola, pendientes: pendientes, aprobados: aprobados,
  pausa: cfg.PAUSA === 1, ultimo_commit_at: cfg.ULTIMO_COMMIT_AT, ultimo_poll_at: cfg.ULTIMO_POLL_AT, fallos_poller: cfg.FALLOS_SEGUIDOS,
  bot_token: cfg.BOT_TOKEN !== '', autorizados: autorizados,
  ollama: { ok: ollamaOk, version: ollamaOk ? ov.version : '', cargados: cargados }, sd_server: { ok: sdOk },
  texto: lineas.join('\n')
} }];
