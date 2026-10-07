// --- comun.js (Palmera Brava): ayudas compartidas por los nodos Code del núcleo (WF0, WF1, WF2, WF5, WF9) ---
// Se inserta donde un Code dice "// @incluir comun". Sin require ni crypto (el task runner los bloquea).
const PB_TABLAS = { config: 'pb_config', locks: 'pb_locks', inbox: 'pb_inbox', borradores: 'pb_borradores', imagenes: 'pb_imagenes' };
// Escapa texto para parse_mode HTML de Telegram.
function h(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// Quita tokens de Telegram, PAT de GitHub y similares de cualquier texto que vaya a un mensaje o a una tabla.
function censurar(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/bot\d+:[\w-]+/g, 'bot***')
    .replace(/\d{8,10}:[\w-]{30,}/g, '***')
    .replace(/github_pat_\w+/g, 'github_pat_***')
    .replace(/gh[pousr]_\w+/g, 'gh*_***')
    .replace(/(authorization["':=\s]+)(token|bearer)\s+[^\s"',}]+/gi, '$1$2 ***');
}
// Mensaje para Telegram (HTML). El texto YA debe venir escapado y terminar en "Siguiente paso: ...".
function enviar(chatId, texto, extra) {
  const t = String(texto || '');
  if (!/\nSiguiente paso: \S/.test(t)) throw new Error('Mensaje sin "Siguiente paso": ' + t.slice(0, 60));
  return { metodo: 'sendMessage', cuerpo: Object.assign({ chat_id: Number(chatId), text: t.slice(0, 4096), parse_mode: 'HTML', link_preview_options: { is_disabled: true } }, extra || {}) };
}
function quitarTeclado(chatId, messageId) {
  return { metodo: 'editMessageReplyMarkup', cuerpo: { chat_id: Number(chatId), message_id: Number(messageId), reply_markup: { inline_keyboard: [] } } };
}
function botones(filas) { return { reply_markup: { inline_keyboard: filas } }; }
// pb_config (filas {clave, valor}) -> objeto con tipos ya convertidos. Valores raros se ignoran (token con formato inválido = sin token).
function armarConfig(filas) {
  const c = {};
  (filas || []).forEach(function (f) { if (f && typeof f.clave === 'string') c[f.clave] = f.valor === null || f.valor === undefined ? '' : String(f.valor); });
  const num = function (k, d) { const n = Number(c[k]); return c[k] !== undefined && c[k] !== '' && Number.isFinite(n) ? n : d; };
  const json = function (k, d) { try { const v = JSON.parse(c[k]); return v === null || v === undefined ? d : v; } catch (e) { return d; } };
  const tok = String(c.BOT_TOKEN || '').trim();
  let aut = json('AUTORIZADOS', []);
  aut = (Array.isArray(aut) ? aut : []).filter(function (a) { return a && Number(a.id) > 0 && ['admin', 'dueno', 'marketing'].indexOf(a.rol) >= 0; })
    .map(function (a) { return { id: Number(a.id), rol: a.rol, nombre: String(a.nombre || '').replace(/[<>]/g, '').slice(0, 60) }; });
  const repo = String(c.REPO || '').trim();
  const rama = String(c.REPO_BRANCH || '').trim();
  const alertas = json('ALERTAS', {});
  const desconocidos = json('DESCONOCIDOS', []);
  return {
    BOT_TOKEN: /^\d{5,12}:[A-Za-z0-9_-]{30,}$/.test(tok) ? tok : '',
    AUTORIZADOS: aut,
    REPO: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? repo : 'Abnercayao/tienda-tarapoto',
    REPO_BRANCH: /^[A-Za-z0-9_.\/-]+$/.test(rama) ? rama : 'main',
    SITIO_URL: /^https:\/\/[^\s<>"']+$/.test(c.SITIO_URL || '') ? c.SITIO_URL : 'https://abnercayao.github.io/tienda-tarapoto/',
    COMMIT_EMAIL: /^[^\s@<>]+@[^\s@<>]+$/.test(c.COMMIT_EMAIL || '') ? c.COMMIT_EMAIL : '297644875+Abnercayao@users.noreply.github.com',
    PAUSA: c.PAUSA === '1' ? 1 : 0,
    MIN_ENTRE_COMMITS_MS: num('MIN_ENTRE_COMMITS_MS', 360000),
    ULTIMO_COMMIT_AT: num('ULTIMO_COMMIT_AT', 0),
    ULTIMO_POLL_AT: num('ULTIMO_POLL_AT', 0),
    FALLOS_SEGUIDOS: num('FALLOS_SEGUIDOS', 0),
    ULTIMA_ALERTA_AT: num('ULTIMA_ALERTA_AT', 0),
    ALERTAS: alertas && typeof alertas === 'object' && !Array.isArray(alertas) ? alertas : {},
    DESCONOCIDOS: Array.isArray(desconocidos) ? desconocidos.slice(-10) : [],
    OLLAMA_URL: c.OLLAMA_URL || 'http://host.docker.internal:11434',
    OLLAMA_MODELO: c.OLLAMA_MODELO || 'qwen3.5:4b-q4_K_M',
    SD_URL: c.SD_URL || 'http://host.docker.internal:1234',
    claves: Object.keys(c)
  };
}
function rolDe(cfg, id) { const a = (cfg.AUTORIZADOS || []).find(function (x) { return x.id === Number(id); }); return a ? a.rol : null; }
// Destinatarios de avisos técnicos: admins; si no hay, el dueño.
function admins(cfg) {
  const a = (cfg.AUTORIZADOS || []).filter(function (x) { return x.rol === 'admin'; });
  return a.length ? a : (cfg.AUTORIZADOS || []).filter(function (x) { return x.rol === 'dueno'; });
}
function isoLima(ms) { const d = new Date((ms === undefined ? Date.now() : ms) - 5 * 3600000); return d.toISOString().slice(0, 19) + '-05:00'; }
// --- fin comun.js ---
