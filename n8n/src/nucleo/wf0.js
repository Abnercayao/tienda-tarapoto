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
  SD_URL: 'http://host.docker.internal:1234',
  // v3 pedidos y Mercado Pago (docs/PEDIDOS.md). El Access Token NO va aquí: vive solo en la credencial "Mercado Pago Prueba".
  PEDIDO_ULTIMO: 'PB-000100',
  MP_MODO: 'auto',
  MP_LINK: 'init_point',
  MP_WEBHOOK_SECRET: '',
  TUNEL_URL: ''
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
// Menú por rol: comandosDeRol() de comun.js (v3: + /envios, /pedidos, /pedido; dueño y admin: estados de pedidos y /autorizar).
const lista = comandosDeRol;
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
      : 'Listo. Publica los workflows (WF9, WF3, WF16, WF4, WF5, WF6, WF8, WF14, WF15, WF13, WF2, WF1) y escribe /ayuda al bot.'
} }];
