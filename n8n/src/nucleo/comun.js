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
// v3: menú de comandos de Telegram por rol (setMyCommands). Lo usan WF0 (Setup) y WF16 (/autorizar le publica el menú a la persona).
const PB_COMANDOS = {
  ayuda: 'Qué puedo hacer y ejemplos', lista: 'Productos (opcional: categoría)', ver: 'Ver un producto: /ver prd-0001',
  estado: 'Cola, pausa y último cambio publicado', historial: 'Últimos 5 cambios del bot', precio: 'Cambiar precio: /precio prd-0001 69.90',
  stock: 'Stock por color (0 a 20): /stock prd-0001 Blanco 5', frescura: 'Frescura 1 a 5 hojitas: /frescura prd-0001 5', ocultar: 'Ocultar un producto', mostrar: 'Volver a mostrar un producto',
  foto: 'Foto con leyenda /foto prd-0001', articulo: 'Borrador de artículo: /articulo tema', articulo_ocultar: 'Ocultar un artículo',
  imagen: 'Imagen con IA local: /imagen descripción', cancelar: 'Cancelar tus borradores pendientes',
  envios: 'Opciones de envío, costos y tiempos', pedidos: 'Pedidos abiertos (por pagar, pagados, en preparación)', pedido: 'Ver un pedido: /pedido PB-000101',
  preparando: 'Pedido en preparación: /preparando PB-000101', enviar: 'Despachado: /enviar PB-000101 shalom 12345678-ABCD', recojo: 'Llegó a la agencia: /recojo PB-000101',
  entregado: 'Entregado: /entregado PB-000101', cancelar_pedido: 'Cancelar un pedido (con confirmación)',
  desconocidos: 'Quién escribió /start sin estar autorizado', autorizar: 'Dar acceso: /autorizar 123456789 dueno|marketing', desautorizar: 'Quitar acceso: /desautorizar 123456789',
  borrar: 'Eliminar un producto (doble confirmación)', whatsapp: 'Cambiar el WhatsApp de la tienda', limpiar_muestras: 'Quitar los productos de muestra',
  deshacer: 'Deshacer el último cambio del bot', pausa: 'Pausar la publicación', reanudar: 'Reanudar la publicación', ids: 'Ver quién escribió sin estar autorizado'
};
const PB_CMD_MARKETING = ['ayuda', 'lista', 'ver', 'estado', 'historial', 'precio', 'stock', 'frescura', 'ocultar', 'mostrar', 'foto', 'articulo', 'articulo_ocultar', 'imagen', 'cancelar', 'envios', 'pedidos', 'pedido'];
const PB_CMD_DUENO = PB_CMD_MARKETING.concat(['preparando', 'enviar', 'recojo', 'entregado', 'cancelar_pedido', 'desconocidos', 'autorizar', 'desautorizar', 'borrar', 'whatsapp', 'limpiar_muestras', 'deshacer', 'pausa', 'reanudar']);
const PB_CMD_ADMIN = PB_CMD_DUENO.concat(['ids']);
function comandosDeRol(rol) { return (rol === 'admin' ? PB_CMD_ADMIN : rol === 'dueno' ? PB_CMD_DUENO : PB_CMD_MARKETING).map(function (k) { return { command: k, description: PB_COMANDOS[k] }; }); }
function isoLima(ms) { const d = new Date((ms === undefined ? Date.now() : ms) - 5 * 3600000); return d.toISOString().slice(0, 19) + '-05:00'; }
// v4 (CONTRATO): stock inicial por color+talla de un producto NUEVO. Lo usan la vista previa (WF3) y "Aplicar lote" (WF5),
// así lo que el dueño aprueba es lo que se publica. Requiere el bloque de validar.js (aplicarStockVariante, STOCK_VARIANTE_ASUMIDO).
// nombres = nombres finales de colores; tallas = tallas finales; lista = [{color, talla, cantidad}] (null = todos).
//   1) hay cantidades -> esas ("10 de cada talla y color", "blanco M 3"); lo que no se nombra empieza en 0.
//   2) nada -> STOCK_VARIANTE_ASUMIDO en cada variante (la vista previa lo avisa: "corrígelo con /stock").
// Devuelve { ok, errores[], spv: {color: {talla: n}}, total, modo: 'dado'|'asumido' }.
function pbStockInicial(nombres, tallas, lista) {
  const n = (Array.isArray(nombres) ? nombres : []).filter(function (x) { return typeof x === 'string' && x; });
  const t = (Array.isArray(tallas) ? tallas : []).filter(function (x) { return typeof x === 'string' && x; });
  if (Array.isArray(lista) && lista.length) {
    const r = aplicarStockVariante({ colores: n, tallas: t }, lista, 'fijar');
    return { ok: r.ok, errores: r.errores, spv: r.stock_por_variante, total: r.stock, modo: 'dado' };
  }
  const spv = {};
  n.forEach(function (c) { spv[c] = {}; t.forEach(function (k) { spv[c][k] = STOCK_VARIANTE_ASUMIDO; }); });
  return { ok: true, errores: [], spv: spv, total: n.length * t.length * STOCK_VARIANTE_ASUMIDO, modo: 'asumido' };
}
// Al cambiar colores o tallas de un producto: las variantes que siguen conservan su cantidad (mismo color sin contar
// mayúsculas ni tildes), las nuevas empiezan en 0 y las quitadas desaparecen. previo = stock_por_variante actual.
function pbStockTrasVariantes(previo, nombres, tallas) {
  const ant = previo && typeof previo === 'object' && !Array.isArray(previo) ? previo : {};
  const out = {};
  (nombres || []).forEach(function (n) {
    const k = Object.keys(ant).find(function (x) { return claveColor(x) === claveColor(n); });
    const fila = k !== undefined && ant[k] && typeof ant[k] === 'object' ? ant[k] : {};
    out[n] = {};
    (tallas || []).forEach(function (t) { out[n][t] = Number.isInteger(fila[t]) && fila[t] >= 0 ? Math.min(fila[t], MAX_STOCK_VARIANTE) : 0; });
  });
  return out;
}
// Nombres de color finales (como los guarda WF5): colorHex() de validar.js, sin repetidos (claveColor).
function pbNombresColor(lista) {
  const out = [], vistos = [];
  (Array.isArray(lista) ? lista : []).slice(0, 8).forEach(function (x) {
    const nombre = colorHex(x && typeof x === 'object' ? x.nombre : x).nombre;
    const k = claveColor(nombre);
    if (vistos.indexOf(k) < 0) { vistos.push(k); out.push(nombre); }
  });
  return out;
}
// --- fin comun.js ---
