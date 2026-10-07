//// Config
// @incluir comun
// Sin token válido el workflow termina en silencio (no es un error: falta configurar, ver WF0).
const cfg = armarConfig($input.all().map(function (i) { return i.json; }));
if (!cfg.BOT_TOKEN) return [];
return [{ json: cfg }];

//// Normalizar
// @incluir comun
// Un update de Telegram -> una fila de pb_inbox. Filtro D2: solo chats PRIVADOS de ids en AUTORIZADOS (id > 0).
const cfg = $('Config').first().json;
const r = $input.first().json || {};
const updates = r.ok === true && Array.isArray(r.result) ? r.result : [];
const ahora = Date.now();
const limpio = function (s, n) { return String(s === null || s === undefined ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, n); };
const filas = [];
let maxUpdateId = 0;
let desconocidos = cfg.DESCONOCIDOS.slice();
let cambioDesconocidos = false;
for (const u of updates) {
  const uid = Number(u && u.update_id);
  if (!Number.isInteger(uid) || uid <= 0) continue;
  if (uid > maxUpdateId) maxUpdateId = uid;
  const cb = u.callback_query || null;
  const m = cb ? null : (u.message || null);
  if (!cb && !m) continue;
  const from = (cb ? cb.from : m.from) || {};
  const chat = cb ? (cb.message && cb.message.chat) : m.chat;
  if (!chat || chat.type !== 'private' || from.is_bot) continue;          // grupos y canales: se ignoran en silencio
  const fromId = Number(from.id);
  const nombre = limpio([from.first_name, from.last_name].filter(Boolean).join(' '), 60).replace(/[<>]/g, '');
  const aut = cfg.AUTORIZADOS.find(function (a) { return a.id === fromId; });
  if (!aut || Number(chat.id) !== fromId) {
    // Extraño en chat privado: no se responde; solo se anota (máx. 10) para que el admin copie su id a AUTORIZADOS.
    if (fromId > 0) {
      desconocidos = desconocidos.filter(function (d) { return d && d.id !== fromId; });
      desconocidos.push({ id: fromId, nombre: nombre, fecha: isoLima(ahora) });
      desconocidos = desconocidos.slice(-10);
      cambioDesconocidos = true;
    }
    continue;
  }
  const f = {
    update_id: uid, tipo: 'otro', chat_id: Number(chat.id), from_id: fromId, nombre: nombre, rol: aut.rol,
    message_id: 0, media_group_id: '', file_id: '', file_unique_id: '', texto: '',
    callback_id: '', callback_data: '', callback_message_id: 0,
    fecha: ahora, recibido: ahora, estado: 'nuevo', intentos: 0, error: ''
  };
  if (cb) {
    f.tipo = 'callback';
    f.callback_id = limpio(cb.id, 100);
    f.callback_data = limpio(cb.data, 64);
    f.callback_message_id = Number(cb.message && cb.message.message_id) || 0;
    f.message_id = f.callback_message_id;
  } else {
    f.message_id = Number(m.message_id) || 0;
    f.fecha = Number(m.date) > 0 ? Number(m.date) * 1000 : ahora;
    f.media_group_id = limpio(m.media_group_id, 64);
    f.texto = limpio(typeof m.text === 'string' ? m.text : (typeof m.caption === 'string' ? m.caption : ''), 4096);
    if (Array.isArray(m.photo) && m.photo.length) {
      const foto = m.photo[m.photo.length - 1];                         // la más grande
      f.tipo = 'foto'; f.file_id = limpio(foto.file_id, 200); f.file_unique_id = limpio(foto.file_unique_id, 100);
    } else if (typeof m.text === 'string') f.tipo = m.text.trim().charAt(0) === '/' ? 'comando' : 'texto';
    else if (m.voice || m.audio || m.video_note) f.tipo = 'voz';
    else if (m.document) f.tipo = 'documento';
  }
  filas.push(f);
}
const ids = filas.map(function (f) { return f.update_id; });
const volvi = filas.length > 0 && cfg.ULTIMO_POLL_AT > 0 && ahora - cfg.ULTIMO_POLL_AT > 300000;
return [{ json: {
  filas: filas, maxUpdateId: maxUpdateId,
  minUpdateId: ids.length ? Math.min.apply(null, ids) : 0, maxFilaId: ids.length ? Math.max.apply(null, ids) : 0,
  volvi: volvi, desconocidos: cambioDesconocidos ? desconocidos : null
} }];

//// Solo nuevos
// Idempotencia (A6): no se vuelve a insertar un update_id que ya está en pb_inbox (p. ej. si falló el ACK anterior).
const n = $('Normalizar').first().json;
const existentes = new Set($input.all().map(function (i) { return i.json.update_id; }).filter(function (v) { return v !== undefined && v !== null; }).map(Number));
const vistos = new Set();
const nuevas = [];
for (const f of n.filas) {
  if (existentes.has(f.update_id) || vistos.has(f.update_id)) continue;
  vistos.add(f.update_id);
  nuevas.push(f);
}
return nuevas.length ? nuevas.map(function (f) { return { json: f }; }) : [{ json: { noop: true } }];

//// Preparar ACK
// El ACK (offset = max+1) va DESPUÉS de guardar en pb_inbox: si la inserción falla, Telegram vuelve a entregar.
const n = $('Normalizar').first().json;
return [{ json: { ack: n.maxUpdateId > 0, offset: n.maxUpdateId + 1 } }];

//// Estado poll
const cfg = $('Config').first().json;
const n = $('Normalizar').first().json;
const out = [{ clave: 'ULTIMO_POLL_AT', valor: String(Date.now()) }];
if (cfg.FALLOS_SEGUIDOS !== 0) out.push({ clave: 'FALLOS_SEGUIDOS', valor: '0' });
if (n.desconocidos) out.push({ clave: 'DESCONOCIDOS', valor: JSON.stringify(n.desconocidos) });
return out.map(function (j) { return { json: j }; });

//// Avisos
// @incluir comun
// Respuesta inmediata (A5): callbacks -> answerCallbackQuery; fotos/texto -> "Recibido"; tras un apagón -> "Volví".
const n = $('Normalizar').first().json;
let nuevas = [];
try { if ($('Solo nuevos').isExecuted) nuevas = $('Solo nuevos').all().map(function (i) { return i.json; }).filter(function (j) { return j.update_id; }); } catch (e) { nuevas = []; }
const out = [];
const chatsAvisados = new Set();
if (n.volvi) {
  const porChat = {};
  nuevas.forEach(function (f) { porChat[f.chat_id] = (porChat[f.chat_id] || 0) + 1; });
  Object.keys(porChat).forEach(function (chat) {
    chatsAvisados.add(Number(chat));
    out.push(enviar(chat, 'Volví (la PC estuvo apagada o sin internet). Tengo ' + porChat[chat] + ' mensajes pendientes y los proceso en orden.\nSiguiente paso: espera mis respuestas.'));
  });
}
nuevas.forEach(function (f) {
  if (f.tipo === 'callback' && f.callback_id) {
    out.push({ metodo: 'answerCallbackQuery', cuerpo: { callback_query_id: f.callback_id, text: 'Recibido. Siguiente paso: espera la respuesta.' } });
  } else if (f.tipo === 'comando') {
    out.push({ metodo: 'sendChatAction', cuerpo: { chat_id: f.chat_id, action: 'typing' } });
  } else if ((f.tipo === 'foto' || f.tipo === 'texto') && !chatsAvisados.has(f.chat_id)) {
    chatsAvisados.add(f.chat_id);                                       // un solo "Recibido" por chat (álbumes incluidos)
    out.push({ metodo: 'sendChatAction', cuerpo: { chat_id: f.chat_id, action: 'typing' } });
    out.push(enviar(f.chat_id, 'Recibido, preparo el borrador (puede tardar hasta 1 min).\nSiguiente paso: espera la vista previa.'));
  }
});
return out.map(function (j) { return { json: j }; });

//// Fallo
// @incluir comun
// getUpdates falló (sin internet, token revocado, webhook activo...). Cuenta fallos seguidos; alerta como máximo 1 vez por hora.
const cfg = $('Config').first().json;
const e = $input.first().json || {};
const detalle = censurar((e.error && (e.error.message || e.error.description)) || e.message || JSON.stringify(e).slice(0, 200)).slice(0, 200);
const ahora = Date.now();
const fallos = cfg.FALLOS_SEGUIDOS + 1;
const alerta = fallos >= 30 && ahora - cfg.ULTIMA_ALERTA_AT > 3600000;
const out = [{ clave: 'FALLOS_SEGUIDOS', valor: String(fallos), alerta: alerta, fallos: fallos, detalle: detalle }];
if (alerta) out.push({ clave: 'ULTIMA_ALERTA_AT', valor: String(ahora), alerta: alerta, fallos: fallos, detalle: detalle });
return out.map(function (j) { return { json: j }; });

//// Alerta fallo
// @incluir comun
const cfg = $('Config').first().json;
const f = $('Fallo').first().json;
if (!f.alerta) return [];
return admins(cfg).map(function (a) {
  return { json: enviar(a.id, 'No puedo leer Telegram desde hace ' + f.fallos + ' intentos seguidos (' + h(f.detalle) + ').\nSiguiente paso: revisa el internet de la PC y que pb_config.BOT_TOKEN sea el token vigente.') };
});
