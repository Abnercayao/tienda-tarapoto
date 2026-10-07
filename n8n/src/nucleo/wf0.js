//// Claves por defecto
// Inserta en pb_config SOLO las claves que faltan (nunca pisa lo que el usuario ya editó).
const def = {
  BOT_TOKEN: '',
  AUTORIZADOS: JSON.stringify([
    { id: 0, rol: 'admin', nombre: 'Abner (demo y soporte)' },
    { id: 0, rol: 'dueno', nombre: 'Dueño de la tienda' },
    { id: 0, rol: 'marketing', nombre: 'Encargado de marketing' }
  ]),
  REPO: 'Abnercayao/tienda-tarapoto',
  REPO_BRANCH: 'main',
  SITIO_URL: 'https://abnercayao.github.io/tienda-tarapoto/',
  COMMIT_EMAIL: '297644875+Abnercayao@users.noreply.github.com',
  PAUSA: '0',
  MIN_ENTRE_COMMITS_MS: '360000',
  ULTIMO_COMMIT_AT: '0',
  ULTIMO_POLL_AT: '0',
  FALLOS_SEGUIDOS: '0',
  ULTIMA_ALERTA_AT: '0',
  ALERTAS: '{}',
  DESCONOCIDOS: '[]',
  OLLAMA_URL: 'http://host.docker.internal:11434',
  OLLAMA_MODELO: 'qwen3.5:4b-q4_K_M',
  SD_URL: 'http://host.docker.internal:1234'
};
const existentes = new Set($input.all().map(function (i) { return i.json.clave; }).filter(Boolean));
const faltan = Object.keys(def).filter(function (k) { return !existentes.has(k); });
if (!faltan.length) return [{ json: { nada: true } }];
return faltan.map(function (k) { return { json: { clave: k, valor: def[k] } }; });

//// Lock por defecto
// Una sola fila "worker" en pb_locks (A4: un lock para GPU y GitHub).
const hay = $input.all().some(function (i) { return i.json.nombre === 'worker'; });
return hay ? [{ json: { nada: true } }] : [{ json: { nombre: 'worker', holder: '', hasta: 0 } }];

//// Config
// @incluir comun
const cfg = armarConfig($input.all().map(function (i) { return i.json; }));
cfg.hayToken = cfg.BOT_TOKEN !== '';
return [{ json: cfg }];

//// Falta token
return [{ json: {
  listo: false,
  tablas: 'pb_config, pb_locks, pb_inbox, pb_borradores, pb_imagenes (creadas o ya existentes)',
  falta: 'BOT_TOKEN vacío o con formato inválido',
  siguiente_paso: 'Pega el token de BotFather en Data Tables > pb_config > BOT_TOKEN y en la credencial "Telegram Palmera Brava"; luego vuelve a ejecutar este workflow.'
} }];

//// Comandos por rol
// @incluir comun
// setMyCommands por chat (scope chat) según el rol; los desconocidos no ven ningún comando (deleteMyCommands en scope default).
const cfg = $('Config').first().json;
const C = {
  ayuda: 'Qué puedo hacer y ejemplos', lista: 'Productos (opcional: categoría)', ver: 'Ver un producto: /ver prd-0001',
  estado: 'Cola, pausa y último cambio publicado', historial: 'Últimos 5 cambios del bot', precio: 'Cambiar precio: /precio prd-0001 69.90',
  stock: 'Stock por color (0 a 20): /stock prd-0001 Blanco 5', frescura: 'Frescura 1 a 5 hojitas: /frescura prd-0001 5', ocultar: 'Ocultar un producto', mostrar: 'Volver a mostrar un producto',
  foto: 'Foto con leyenda /foto prd-0001', articulo: 'Borrador de artículo: /articulo tema', articulo_ocultar: 'Ocultar un artículo',
  imagen: 'Imagen con IA local: /imagen descripción', cancelar: 'Cancelar tus borradores pendientes',
  borrar: 'Eliminar un producto (doble confirmación)', whatsapp: 'Cambiar el WhatsApp de la tienda', limpiar_muestras: 'Quitar los productos de muestra',
  deshacer: 'Deshacer el último cambio del bot', pausa: 'Pausar la publicación', reanudar: 'Reanudar la publicación', ids: 'Ver quién escribió sin estar autorizado'
};
const TODOS = ['ayuda', 'lista', 'ver', 'estado', 'historial', 'precio', 'stock', 'frescura', 'ocultar', 'mostrar', 'foto', 'articulo', 'articulo_ocultar', 'imagen', 'cancelar'];
const DUENO = TODOS.concat(['borrar', 'whatsapp', 'limpiar_muestras', 'deshacer', 'pausa', 'reanudar']);
const ADMIN = DUENO.concat(['ids']);
const lista = function (rol) { return (rol === 'admin' ? ADMIN : rol === 'dueno' ? DUENO : TODOS).map(function (k) { return { command: k, description: C[k] }; }); };
const desc = 'Bot privado de Palmera Brava. Si no respondo, la PC de la tienda está apagada.';
const out = [{ metodo: 'deleteMyCommands', cuerpo: { scope: { type: 'default' } } }];
cfg.AUTORIZADOS.forEach(function (a) { out.push({ metodo: 'setMyCommands', cuerpo: { commands: lista(a.rol), scope: { type: 'chat', chat_id: a.id } } }); });
out.push({ metodo: 'setMyDescription', cuerpo: { description: desc } });
out.push({ metodo: 'setMyShortDescription', cuerpo: { short_description: desc } });
return out.map(function (j) { return { json: j }; });

//// Resumen
// @incluir comun
const cfg = $('Config').first().json;
const me = $('getMe').first().json || {};
const pedidos = $('Comandos por rol').all().map(function (i) { return i.json; });
const resp = $input.all().map(function (i) { return i.json; });
const fallos = [];
resp.forEach(function (r, i) {
  if (!r || r.ok !== true) fallos.push((pedidos[i] ? pedidos[i].metodo : '?') + ': ' + censurar((r && (r.description || (r.error && r.error.message))) || 'sin respuesta').slice(0, 160));
});
const sinId = cfg.AUTORIZADOS.length === 0;
return [{ json: {
  listo: me.ok === true && fallos.length === 0,
  bot: me.ok === true && me.result ? '@' + me.result.username : null,
  token_valido: me.ok === true,
  autorizados_activos: cfg.AUTORIZADOS,
  desconocidos_recientes: cfg.DESCONOCIDOS,
  fallos: fallos,
  siguiente_paso: me.ok !== true
    ? 'El token no funciona: revisa pb_config.BOT_TOKEN (cópialo de BotFather) y vuelve a ejecutar.'
    : sinId
      ? 'Pide a cada persona que escriba /start al bot, copia su id desde desconocidos_recientes a AUTORIZADOS (pb_config) y vuelve a ejecutar este workflow.'
      : 'Listo. Publica los workflows (WF9, WF3, WF4, WF5, WF6, WF8, WF2, WF1) y escribe /ayuda al bot.'
} }];
