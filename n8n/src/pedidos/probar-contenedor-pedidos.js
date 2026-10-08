#!/usr/bin/env node
/*
 * n8n/src/pedidos/probar-contenedor-pedidos.js — Prueba de punta a punta de PEDIDOS + MERCADO PAGO (WF13, WF14, WF15) y del seguimiento
 * desde el chat (WF11 -> WF15), en un n8n 2.40.7 DESECHABLE (nunca el contenedor "n8n"). Sin red externa para MP ni Telegram.
 *   node n8n/src/pedidos/probar-contenedor-pedidos.js            (crea n8n-prueba-pedidos en 127.0.0.1:5694, prueba y SIEMPRE lo borra)
 *   node n8n/src/pedidos/probar-contenedor-pedidos.js --dejar    (no lo borra; luego: docker rm -f n8n-prueba-pedidos)
 * - Importa WF0, WF9, WF11, WF13, WF14, WF15 + un workflow auxiliar (sembrar pb_config, crear pb_borradores y leer tablas).
 *   Credenciales FALSAS: Telegram (token falso), GitHub (PAT falso), X-Tienda-Key de prueba y "Mercado Pago Prueba" con un token falso.
 * - Simuladores DENTRO del contenedor (un proceso node): Mercado Pago en :8797 (pb_config.MP_API_URL), Telegram en :8798
 *   (pb_config.TELEGRAM_API_URL) y la web publicada en :8799/sitio/ (pb_config.CATALOGO_URL, sirve data/products.json y site.json).
 *   Control desde el host: 127.0.0.1:5693 (/__control).
 * - tools/chat-proxy.py corre en el host (puerto 8791 -> contenedor) y las llamadas pasan por él, como la web y Mercado Pago.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const CONT = 'n8n-prueba-pedidos';
const IMAGEN = 'docker.n8n.io/n8nio/n8n:2.40.7';
const PUERTO = 5694, PUERTO_CTL = 5693, PUERTO_PROXY = 8791;
const BASE = 'http://127.0.0.1:' + PUERTO;
const PROXY = 'http://127.0.0.1:' + PUERTO_PROXY;
const TOKEN_FALSO = '123456789:' + 'X'.repeat(35);
const MP_FALSO = 'APP_USR-token-falso-de-prueba';
const SECRETO = 'clave-secreta-webhooks-prueba';
const DEJAR = process.argv.includes('--dejar');
const ID = { WF0: 'pbWf00Setup00000', WF9: 'pbWf09Errores000', WF11: 'pbWf11ChatVend00', WF13: 'pbWf13PedCrear00', WF14: 'pbWf14MpNotif000', WF15: 'pbWf15PedSegui00', SEED: 'pbTestPedidoSeed' };
const ORIGEN = 'https://abnercayao.github.io';
const B = require('./construir-pedidos.js');

let ok = 0, fallos = 0;
function caso(nombre, cond, detalle) {
  if (cond) { ok++; console.log('  ok    ' + nombre); }
  else { fallos++; console.log('  FALLA ' + nombre + (detalle !== undefined ? ' -> ' + (typeof detalle === 'string' ? detalle : JSON.stringify(detalle)).slice(0, 900) : '')); }
}
function docker(args) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }); }
function n8n(args) { return docker(['exec', '-u', 'node', CONT, 'n8n'].concat(args)); }
const dormir = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function http(metodo, url, cuerpo, cabeceras, timeoutMs) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: metodo, headers: Object.assign(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}, cabeceras || {}),
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(timeoutMs || 60000) });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (e) { json = null; }
    return { status: r.status, headers: r.headers, texto: texto, json: json, ms: Date.now() - t0 };
  } catch (e) { return { status: 0, texto: String(e && (e.cause && e.cause.code || e.message)), json: null, headers: new Headers(), ms: Date.now() - t0 }; }
}

// ---------- workflow auxiliar ----------
let n = 0;
const uuid = function () { n++; return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); };
const wh = function (nombre, metodo, ruta, pos) { return { id: uuid(), name: nombre, type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: pos, webhookId: uuid(), parameters: { httpMethod: metodo, path: ruta, responseMode: 'lastNode', responseData: 'firstEntryJson', options: {} } }; };
const code = function (nombre, js, pos) { return { id: uuid(), name: nombre, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: js } }; };
const dt = function (nombre, tabla, params, pos, extra) { return Object.assign({ id: uuid(), name: nombre, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: pos, parameters: Object.assign({ dataTableId: { __rl: true, mode: 'name', value: tabla } }, params) }, extra || {}); };
const col = function (c, t) { return { id: c, displayName: c, required: false, defaultMatch: false, display: true, type: t, canBeUsedToMatch: true }; };
function seed() {
  const N = [], C = {};
  const add = function (x) { N.push(x); return x.name; };
  const con = function (a, b) { C[a] = C[a] || { main: [[]] }; C[a].main[0].push({ node: b, type: 'main', index: 0 }); };
  add(wh('t-config', 'POST', 't-config', [0, 0]));
  add({ id: uuid(), name: 'Crear pb_config', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [220, 0], executeOnce: true,
    parameters: { resource: 'table', operation: 'create', tableName: 'pb_config', columns: { column: [{ name: 'clave', type: 'string' }, { name: 'valor', type: 'string' }] }, options: { createIfNotExists: true } } });
  add({ id: uuid(), name: 'Crear pb_borradores', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [330, 0], executeOnce: true,
    parameters: { resource: 'table', operation: 'create', tableName: 'pb_borradores', columns: { column: B.TABLAS.pb_borradores.map(function (c) { return { name: c[0], type: c[1] }; }) }, options: { createIfNotExists: true } } });
  add(code('Pares', 'const c = $("t-config").first().json.body.config || {};\nreturn Object.keys(c).map(function (k) { return { json: { clave: k, valor: typeof c[k] === "string" ? c[k] : JSON.stringify(c[k]) } }; });', [440, 0]));
  add(dt('Upsert config', 'pb_config', { resource: 'row', operation: 'upsert', matchType: 'allConditions', filters: { conditions: [{ keyName: 'clave', condition: 'eq', keyValue: '={{ $json.clave }}' }] },
    columns: { mappingMode: 'defineBelow', value: { clave: '={{ $json.clave }}', valor: '={{ $json.valor }}' }, matchingColumns: [], schema: [col('clave', 'string'), col('valor', 'string')], attemptToConvertTypes: false, convertFieldsToString: false }, options: {} }, [660, 0]));
  add(code('Config lista', 'return [{ json: { ok: true, filas: $input.all().length } }];', [880, 0]));
  con('t-config', 'Crear pb_config'); con('Crear pb_config', 'Crear pb_borradores'); con('Crear pb_borradores', 'Pares'); con('Pares', 'Upsert config'); con('Upsert config', 'Config lista');
  add(wh('t-dump', 'GET', 't-dump', [0, 300]));
  let prev = 't-dump';
  ['pb_pedidos', 'pb_borradores', 'pb_config', 'pb_chat_mensajes'].forEach(function (t, i) {
    const x = add(dt('Leer ' + t, t, { resource: 'row', operation: 'get', matchType: 'allConditions', filters: {}, returnAll: true }, [220 + 220 * i, 300], { alwaysOutputData: true, executeOnce: true, onError: 'continueRegularOutput' }));
    con(prev, x); prev = x;
  });
  add(code('Dump', 'const l = function (n) { try { return $(n).all().map(function (i) { return i.json; }).filter(function (j) { return j.id !== undefined; }); } catch (e) { return []; } };\n' +
    'return [{ json: { pedidos: l("Leer pb_pedidos"), borradores: l("Leer pb_borradores"), config: l("Leer pb_config"), mensajes: l("Leer pb_chat_mensajes") } }];', [1200, 300]));
  con(prev, 'Dump');
  return { id: ID.SEED, name: 'PB TEST pedidos sembrar y leer', nodes: N, connections: C, active: false, settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none' }, pinData: {} };
}
// Simuladores (Mercado Pago :8797, Telegram :8798, web :8799/sitio/ + control :8799/__control). Mismo proceso node.
const MOCK = [
  "const http = require('http'); const fs = require('fs');",
  'const TOKEN_MP = ' + JSON.stringify(MP_FALSO) + ';',
  "const E = { modoMp: 'ok', prefs: [], pagos: {}, mpLog: [], tg: [], web: 0 };",
  "const leer = function (req, cb) { const ch = []; req.on('data', function (c) { ch.push(c); }); req.on('end', function () { cb(Buffer.concat(ch).toString('utf8')); }); };",
  "const enviar = function (res, st, j) { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };",
  "http.createServer(function (req, res) { leer(req, function (cuerpo) {",
  "  const u = new URL(req.url, 'http://x'); const auth = req.headers.authorization || '';",
  "  E.mpLog.push({ metodo: req.method, ruta: u.pathname + u.search, auth: auth === 'Bearer ' + TOKEN_MP, idem: req.headers['x-idempotency-key'] || '', cuerpo: cuerpo ? JSON.parse(cuerpo) : null });",
  "  if (E.modoMp === '401' || auth !== 'Bearer ' + TOKEN_MP) return enviar(res, 401, { message: 'invalid access token', error: 'unauthorized', status: 401 });",
  "  if (req.method === 'POST' && u.pathname === '/checkout/preferences') { const id = '99887766-pref-' + (E.prefs.length + 1); E.prefs.push(JSON.parse(cuerpo));",
  "    return enviar(res, 201, { id: id, init_point: 'https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=' + id, sandbox_init_point: 'https://sandbox.mercadopago.com.pe/checkout/v1/redirect?pref_id=' + id }); }",
  "  let m = /^\\/v1\\/payments\\/(\\d+)$/.exec(u.pathname);",
  "  if (m) return E.pagos[m[1]] ? enviar(res, 200, E.pagos[m[1]]) : enviar(res, 404, { message: 'Payment not found', code: 2000 });",
  "  if (u.pathname === '/v1/payments/search') { const ref = u.searchParams.get('external_reference'); return enviar(res, 200, { results: Object.keys(E.pagos).map(function (k) { return E.pagos[k]; }).filter(function (p) { return p.external_reference === ref; }) }); }",
  "  enviar(res, 404, {});",
  "}); }).listen(8797, '0.0.0.0');",
  "http.createServer(function (req, res) { leer(req, function (cuerpo) { let j = {}; try { j = JSON.parse(cuerpo); } catch (e) { j = {}; }",
  "  E.tg.push({ ruta: req.url.replace(/bot[^/]+/, 'bot***'), tokenOk: req.url.indexOf('/bot' + " + JSON.stringify(TOKEN_FALSO) + " + '/') === 0, cuerpo: j });",
  "  enviar(res, 200, { ok: true, result: { message_id: E.tg.length } }); }); }).listen(8798, '0.0.0.0');",
  "http.createServer(function (req, res) { leer(req, function (cuerpo) { const u = new URL(req.url, 'http://x');",
  "  if (u.pathname === '/__control') { if (req.method === 'POST') { const c = JSON.parse(cuerpo || '{}'); if (c.pago) E.pagos[c.pago.id] = c.pago; if (c.modoMp) E.modoMp = c.modoMp; if (c.limpiar) { E.tg = []; E.mpLog = []; } } return enviar(res, 200, E); }",
  "  const f = { '/sitio/data/products.json': '/tmp/sitio/products.json', '/sitio/data/site.json': '/tmp/sitio/site.json' }[u.pathname];",
  "  if (f) { E.web++; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(fs.readFileSync(f)); }",
  "  enviar(res, 404, {}); }); }).listen(8799, '0.0.0.0');"
].join('\n');
const ctl = async function (cambios) { const r = await http(cambios ? 'POST' : 'GET', 'http://127.0.0.1:' + PUERTO_CTL + '/__control', cambios); return r.json || { prefs: [], pagos: {}, mpLog: [], tg: [] }; };
const dump = async function () { const r = await http('GET', BASE + '/webhook/t-dump'); return r.json || {}; };
function ejecuciones(wfId) {
  const js = [
    'const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");',
    'const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);',
    'db.all("SELECT id, status FROM execution_entity WHERE workflowId = \'' + wfId + '\' ORDER BY id", function (err, f) { console.log(JSON.stringify(err ? { error: String(err) } : f)); });'
  ].join('\n');
  try { return JSON.parse(docker(['exec', '-u', 'node', CONT, 'node', '-e', js]).trim().split('\n').pop()); } catch (e) { return [{ error: String(e.message).slice(0, 300) }]; }
}
function firmar(dataId, reqId, ts) { return 'ts=' + ts + ',v1=' + nodeCrypto.createHmac('sha256', SECRETO).update('id:' + dataId + ';request-id:' + reqId + ';ts:' + ts + ';').digest('hex'); }
const pedidoDe = function (d, num) { const f = (d.pedidos || []).find(function (x) { return x.numero === num; }); return f ? JSON.parse(f.pedido_json) : null; };

async function principal() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-pedidos-'));
  console.log('Contenedor desechable ' + CONT + ' (' + IMAGEN + ') en ' + BASE + ' (simuladores: control en 127.0.0.1:' + PUERTO_CTL + ')');
  try { docker(['rm', '-f', CONT]); } catch (e) { /* no existía */ }
  docker(['run', '--rm', '-d', '--name', CONT, '-p', '127.0.0.1:' + PUERTO + ':5678', '-p', '127.0.0.1:' + PUERTO_CTL + ':8799',
    '-e', 'N8N_DIAGNOSTICS_ENABLED=false', '-e', 'GENERIC_TIMEZONE=America/Lima', '-e', 'TZ=America/Lima', '-e', 'N8N_PERSONALIZATION_ENABLED=false', IMAGEN]);
  // El CLI (import/publish) no debe correr mientras el proceso principal hace las migraciones de la base: se espera /healthz.
  for (let i = 0; i < 120; i++) { await dormir(1000); if ((await http('GET', BASE + '/healthz', undefined, {}, 3000)).status === 200) break; }
  await dormir(2000);
  // ---------- importación ----------
  const plantilla = JSON.parse(fs.readFileSync(path.join(RAIZ, 'n8n', 'reference', 'credenciales.plantilla.json'), 'utf8'));
  const datos = { pbCredTelegram01: { accessToken: TOKEN_FALSO, baseUrl: 'https://api.telegram.org' }, pbCredGithub0001: { server: 'https://api.github.com', user: 'Abnercayao', accessToken: 'pat-falso' },
    pbCredHeader0001: { name: 'X-Tienda-Key', value: 'clave-de-prueba' }, pbCredMercPago01: { name: 'Authorization', value: 'Bearer ' + MP_FALSO } };
  fs.writeFileSync(path.join(tmp, 'cred.json'), JSON.stringify(plantilla.map(function (c) { return { id: c.id, name: c.name, type: c.type, data: datos[c.id] }; })));
  fs.mkdirSync(path.join(tmp, 'wf'));
  [['WF0', 'WF0-setup.json'], ['WF9', 'WF9-errores.json'], ['WF11', 'WF11-chat-vendedor.json'], ['WF13', 'WF13-pedido-crear.json'], ['WF14', 'WF14-mp-notificacion.json'], ['WF15', 'WF15-pedido-seguimiento.json']].forEach(function (x) {
    const wf = JSON.parse(fs.readFileSync(path.join(RAIZ, 'n8n', 'workflows', x[1]), 'utf8'));
    wf.nodes.forEach(function (nd) { Object.keys(nd.credentials || {}).forEach(function (t) { const pl = plantilla.find(function (p) { return p.type === t && p.name === nd.credentials[t].name; }); nd.credentials[t] = { id: pl.id, name: pl.name }; }); });
    if (x[0] !== 'WF0' && x[0] !== 'WF9') wf.settings.saveDataSuccessExecution = 'all'; // para revisar que todas terminen en success
    fs.writeFileSync(path.join(tmp, 'wf', x[0] + '.json'), JSON.stringify(wf));
  });
  fs.writeFileSync(path.join(tmp, 'wf', 'SEED.json'), JSON.stringify(seed()));
  fs.writeFileSync(path.join(tmp, 'mock.js'), MOCK);
  fs.mkdirSync(path.join(tmp, 'sitio'));
  fs.copyFileSync(path.join(RAIZ, 'data', 'products.json'), path.join(tmp, 'sitio', 'products.json'));
  fs.copyFileSync(path.join(RAIZ, 'data', 'site.json'), path.join(tmp, 'sitio', 'site.json'));
  docker(['exec', '-u', 'root', CONT, 'sh', '-c', 'rm -rf /tmp/imp /tmp/sitio && mkdir -p /tmp/imp']);
  docker(['cp', path.join(tmp, 'wf'), CONT + ':/tmp/imp/wf']);
  docker(['cp', path.join(tmp, 'cred.json'), CONT + ':/tmp/imp/cred.json']);
  docker(['cp', path.join(tmp, 'mock.js'), CONT + ':/tmp/mock.js']);
  docker(['cp', path.join(tmp, 'sitio'), CONT + ':/tmp/sitio']);
  docker(['exec', '-u', 'root', CONT, 'chown', '-R', 'node:node', '/tmp/imp', '/tmp/mock.js', '/tmp/sitio']);
  caso('import:credentials (4 falsas, incluida "Mercado Pago Prueba")', /imported 4 credentials/i.test(n8n(['import:credentials', '--input=/tmp/imp/cred.json'])));
  caso('import:workflow (WF0, WF9, WF11, WF13, WF14, WF15 + auxiliar)', /imported 7 workflows/i.test(n8n(['import:workflow', '--separate', '--input=/tmp/imp/wf'])));
  [ID.WF9, ID.WF15, ID.WF14, ID.WF13, ID.WF11, ID.SEED].forEach(function (id) { n8n(['publish:workflow', '--id=' + id]); });
  docker(['restart', CONT]);
  let listo = false;
  for (let i = 0; i < 60 && !listo; i++) { await dormir(1000); listo = (await http('GET', BASE + '/healthz', undefined, {}, 3000)).status === 200; }
  await dormir(1500);
  const logs = docker(['logs', CONT]) + '';
  caso('n8n arrancó y activó los webhooks sin errores de activación', listo && !/(error|problem) (activating|with)? ?workflow/i.test(logs), logs.slice(-800));
  docker(['exec', '-d', '-u', 'node', CONT, 'node', '/tmp/mock.js']);
  await dormir(800);
  const AUT = [{ id: 111, rol: 'admin', nombre: 'Admin prueba' }, { id: 222, rol: 'dueno', nombre: 'Emily prueba' }, { id: 333, rol: 'marketing', nombre: 'Mkt prueba' }];
  const rc = await http('POST', BASE + '/webhook/t-config', { config: { BOT_TOKEN: TOKEN_FALSO, AUTORIZADOS: AUT, TELEGRAM_API_URL: 'http://127.0.0.1:8798', MP_API_URL: 'http://127.0.0.1:8797',
    CATALOGO_URL: 'http://127.0.0.1:8799/sitio/', TUNEL_URL: 'https://prueba-pedidos.trycloudflare.com', MP_WEBHOOK_SECRET: SECRETO, PEDIDO_ULTIMO: 'PB-000100' } });
  caso('pb_config sembrada (simuladores de MP, Telegram y web)', rc.status === 200 && rc.json && rc.json.ok === true, rc.texto);

  const py = spawn('python', [path.join(RAIZ, 'tools', 'chat-proxy.py'), '--puerto', String(PUERTO_PROXY), '--destino', BASE + '/webhook/chat-tienda'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logProxy = '';
  py.stdout.on('data', function (d) { logProxy += d; }); py.stderr.on('data', function (d) { logProxy += d; });
  try {
    for (let i = 0; i < 20; i++) { if ((await http('GET', PROXY + '/salud', undefined, {}, 2000)).status === 200) break; await dormir(300); }
    const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data', 'products.json'), 'utf8')).productos;
    const p19 = P.find(function (p) { return p.id === 'prd-0019'; });
    const color = p19.colores[0].nombre;
    const precio = p19.precio_oferta && p19.precio_oferta < p19.precio ? p19.precio_oferta : p19.precio;
    const solicitud = function (extra) {
      return Object.assign({ cliente: { nombre: 'Ana Ríos', correo: 'ana.rios@correo.com', telefono: '987654321', dni: '12345678' },
        envio: { opcion: 'olva', departamento: 'Lima', provincia: 'Lima', distrito: 'Surco', direccion: 'Av. Primavera 123' },
        items: [{ id: 'prd-0019', color: color, talla: 'M', cantidad: 1, precio_unit: 1 }], total_visto: 1, origen: 'web' }, extra || {});
    };
    console.log('\n-- WF13 vía proxy (/pedido) --');
    const o1 = await http('OPTIONS', PROXY + '/pedido', undefined, { Origin: ORIGEN, 'Access-Control-Request-Method': 'POST' });
    caso('OPTIONS /pedido -> 204 con CORS de la web', o1.status === 204 && o1.headers.get('access-control-allow-origin') === ORIGEN, o1.status);
    await ctl({ limpiar: true });
    let r = await http('POST', PROXY + '/pedido', solicitud(), { Origin: ORIGEN, 'CF-Connecting-IP': '190.1.1.1' });
    const total1 = Math.round((precio + 22) * 100) / 100;
    caso('POST /pedido -> 200 {ok, PB-000101, total real, init_point de MP prueba}', r.status === 200 && r.json && r.json.ok === true && r.json.numero === 'PB-000101' && r.json.total === total1 && /^https:\/\/www\.mercadopago\.com\.pe\//.test(r.json.init_point) && r.json.modo_pago === 'prueba', r.texto);
    caso('CORS en la respuesta y sin datos personales en la vista', r.headers.get('access-control-allow-origin') === ORIGEN && !/ana\.rios|987654321|Primavera|Ríos/.test(JSON.stringify(r.json && r.json.pedido)), r.json && r.json.pedido);
    await dormir(1500);
    let c = await ctl();
    const pref = c.mpLog.find(function (x) { return x.ruta === '/checkout/preferences'; }) || {};
    caso('MP recibió la preferencia con "Bearer <token de la credencial>" y X-Idempotency-Key = número', pref.auth === true && pref.idem === 'PB-000101', pref);
    const suma = pref.cuerpo ? pref.cuerpo.items.reduce(function (s, i) { return s + Math.round(i.unit_price * 100) * i.quantity; }, 0) / 100 : -1;
    caso('preferencia: ítems + envío Olva = total; back_urls sin "#"; notification_url del túnel', suma === total1 && pref.cuerpo.notification_url === 'https://prueba-pedidos.trycloudflare.com/mp-notificacion?source_news=webhooks' && pref.cuerpo.back_urls.success.indexOf('#') < 0, pref.cuerpo);
    const nuevos = c.tg.filter(function (m) { return /Nuevo pedido/.test(m.cuerpo.text || ''); });
    caso('Telegram (simulado): "Nuevo pedido" a admin y dueño, con el token de pb_config', nuevos.length === 2 && nuevos.every(function (m) { return m.tokenOk; }) && nuevos.map(function (m) { return m.cuerpo.chat_id; }).sort().join() === '111,222', c.tg);
    r = await http('POST', BASE + '/webhook/pedido-crear', solicitud({ items: [{ id: 'prd-0019', color: color, talla: 'M', cantidad: 25 }] }));
    caso('cantidad fuera de rango -> ok:false con texto para el cliente', r.status === 200 && r.json && r.json.ok === false && /cantidad/i.test(r.json.errores.join(' ')), r.texto);
    const poco = P.find(function (p) { return p.activo && p.stock_por_color && Object.keys(p.stock_por_color).some(function (k) { return p.stock_por_color[k] > 0 && p.stock_por_color[k] < 9; }); });
    const colPoco = Object.keys(poco.stock_por_color).find(function (k) { return poco.stock_por_color[k] > 0 && poco.stock_por_color[k] < 9; });
    r = await http('POST', BASE + '/webhook/pedido-crear', solicitud({ items: [{ id: poco.id, color: colPoco, talla: poco.tallas[0], cantidad: poco.stock_por_color[colPoco] + 1 }] }));
    caso('stock insuficiente (' + poco.id + ' ' + colPoco + ') -> ok:false "stock"', r.json && r.json.ok === false && /stock/i.test(r.json.errores.join(' ')), r.texto);

    console.log('\n-- WF14: aviso de Mercado Pago vía proxy (/mp-notificacion) --');
    await ctl({ limpiar: true, pago: { id: 5550001, status: 'approved', status_detail: 'accredited', external_reference: 'PB-000101', currency_id: 'PEN', transaction_amount: total1, live_mode: false } });
    const ajeno = await http('POST', PROXY + '/mp-notificacion?data.id=5550001&type=payment', { type: 'payment', data: { id: '5550001' } }, { Origin: ORIGEN });
    caso('aviso con Origin de navegador -> 403 (ruta sin CORS)', ajeno.status === 403);
    const malo = await http('POST', PROXY + '/mp-notificacion?data.id=5550001&type=payment', { action: 'payment.updated', type: 'payment', data: { id: '5550001' } }, { 'x-signature': 'ts=1,v1=' + 'b'.repeat(64), 'x-request-id': 'req-malo' });
    await dormir(2500);
    let d = await dump();
    c = await ctl();
    caso('firma inválida -> 200 para MP pero NO consulta el pago ni cambia el pedido', malo.status === 200 && !c.mpLog.some(function (x) { return /\/v1\/payments/.test(x.ruta); }) && pedidoDe(d, 'PB-000101').estado === 'pendiente_pago', c.mpLog);
    const bueno = await http('POST', PROXY + '/mp-notificacion?data.id=5550001&type=payment', { action: 'payment.updated', type: 'payment', data: { id: '5550001' } }, { 'x-signature': firmar('5550001', 'req-bueno', '1760000000'), 'x-request-id': 'req-bueno' });
    let p101 = null;
    for (let i = 0; i < 20; i++) { await dormir(1000); d = await dump(); p101 = pedidoDe(d, 'PB-000101'); if (p101 && p101.estado === 'pagado') break; }
    c = await ctl();
    caso('firma válida -> 200 y GET /v1/payments/5550001 con el token', bueno.status === 200 && c.mpLog.some(function (x) { return x.ruta === '/v1/payments/5550001' && x.auth; }), c.mpLog);
    caso('PB-000101 -> "pagado" con historial y payment_id', p101 && p101.estado === 'pagado' && p101.pago.payment_id === '5550001' && p101.historial.length === 2, p101);
    const borr = (d.borradores || []).filter(function (b) { return b.origen === 'pedido'; });
    caso('pb_borradores: borrador de stock aprobado para WF5 (prd-0019, restar 1 ' + color + ')', borr.length === 1 && borr[0].estado === 'aprobado' && borr[0].op === 'stock' && JSON.parse(borr[0].campos).stock_por_color[0].cantidad === 1, borr);
    caso('Telegram: "Pago confirmado" a admin y dueño', c.tg.filter(function (m) { return /Pago confirmado/.test(m.cuerpo.text || ''); }).length === 2, c.tg);
    await http('POST', PROXY + '/mp-notificacion?data.id=5550001&type=payment', { type: 'payment', data: { id: '5550001' } }, { 'x-signature': firmar('5550001', 'req-otra', '1760000001'), 'x-request-id': 'req-otra' });
    await dormir(3000);
    d = await dump(); c = await ctl();
    caso('aviso repetido -> sin otro borrador ni otro Telegram', (d.borradores || []).filter(function (b) { return b.origen === 'pedido'; }).length === 1 && c.tg.filter(function (m) { return /Pago confirmado/.test(m.cuerpo.text || ''); }).length === 2);

    console.log('\n-- WF15: seguimiento vía proxy --');
    r = await http('POST', PROXY + '/seguimiento', { numero: 'PB-000101', correo: 'Ana.Rios@correo.com' }, { Origin: ORIGEN, 'CF-Connecting-IP': '190.2.2.2' });
    caso('/seguimiento -> estado Pagado, historial, tiempo de Olva a Lima', r.status === 200 && r.json && r.json.ok === true && r.json.pedido.estado === 'pagado' && r.json.pedido.envio.tiempo_estimado === '2–3 días hábiles', r.texto);
    caso('sin correo, celular, DNI ni dirección', !/ana\.rios|987654321|12345678|Primavera|Ríos/.test(r.texto), r.texto);
    const m1 = await http('POST', PROXY + '/pedido/consultar', { numero: 'PB-000101', correo: 'otra@correo.com' }, { Origin: ORIGEN, 'CF-Connecting-IP': '190.2.2.3' });
    const m2 = await http('POST', PROXY + '/pedido/consultar', { numero: 'PB-000777', correo: 'ana.rios@correo.com' }, { Origin: ORIGEN, 'CF-Connecting-IP': '190.2.2.3' });
    caso('/pedido/consultar: correo incorrecto y número inexistente -> misma respuesta "no_encontrado"', m1.texto === m2.texto && m1.json && m1.json.motivo === 'no_encontrado', [m1.texto, m2.texto]);

    console.log('\n-- WF11 -> WF15: seguimiento desde el chat (sin IA) vía /chat --');
    const S = 'seg-' + Date.now().toString(36) + '-chat';
    const ch1 = await http('POST', PROXY + '/chat', { sessionId: S, mensaje: 'Hacer seguimiento de mi pedido', pagina: { seccion: 'inicio' } }, { Origin: ORIGEN, 'CF-Connecting-IP': '190.3.3.3' }, 90000);
    console.log('        Vale: ' + (ch1.json ? ch1.json.respuesta : ch1.texto));
    caso('chip "Hacer seguimiento de mi pedido" -> pide número y correo + accion formulario_seguimiento', ch1.status === 200 && ch1.json && /número de tu pedido/.test(ch1.json.respuesta) && ch1.json.accion === 'formulario_seguimiento', ch1.texto);
    const ch2 = await http('POST', PROXY + '/chat', { sessionId: S, mensaje: 'Es el PB-000101 y mi correo es ana.rios@correo.com', pagina: { seccion: 'inicio' } }, { Origin: ORIGEN, 'CF-Connecting-IP': '190.3.3.3' }, 90000);
    console.log('        Vale: ' + (ch2.json ? ch2.json.respuesta : ch2.texto));
    caso('con número y correo -> estado "Pagado" e historial (WF15 como sub-workflow), tarjeta "pedido"', ch2.status === 200 && ch2.json && /PB-000101 está: Pagado/.test(ch2.json.respuesta) && ch2.json.pedido && ch2.json.pedido.numero === 'PB-000101', ch2.texto);

    console.log('\n-- pago SIMULADO (credencial con placeholder) y vuelta de la web (/pedido/pago) --');
    await ctl({ modoMp: '401', limpiar: true });
    r = await http('POST', PROXY + '/pedido', solicitud({ envio: { opcion: 'local', departamento: 'San Martín', provincia: 'San Martín', distrito: 'Tarapoto', direccion: 'Jr. Lamas 456' } }), { Origin: ORIGEN, 'CF-Connecting-IP': '190.4.4.4' });
    caso('MP responde 401 (placeholder) -> pedido PB-000102 en modo "pago simulado" marcado', r.json && r.json.ok === true && r.json.numero === 'PB-000102' && r.json.simulado === true && /Pago simulado/.test(r.json.aviso) && /payment_id=SIMULADO/.test(r.json.init_point), r.texto);
    const pg = await http('POST', PROXY + '/pedido/pago', { numero: 'PB-000102', payment_id: 'SIMULADO' }, { Origin: ORIGEN, 'CF-Connecting-IP': '190.4.4.4' });
    caso('/pedido/pago SIMULADO -> pagado (simulado), sin datos personales', pg.status === 200 && pg.json && pg.json.estado === 'pagado' && pg.json.simulado === true && !/ana|987/.test(pg.texto), pg.texto);
    const pg2 = await http('POST', PROXY + '/pedido/pago', { numero: 'PB-000101', payment_id: 'SIMULADO' }, { Origin: ORIGEN, 'CF-Connecting-IP': '190.4.4.5' });
    d = await dump();
    caso('SIMULADO sobre un pedido con MP real -> no cambia nada', pg2.status === 200 && pedidoDe(d, 'PB-000101').pago.payment_id === '5550001', pg2.texto);
    await ctl({ modoMp: 'ok' });

    console.log('\n-- proxy: allowlist --');
    const rutas = [['GET', '/pedido', 405], ['POST', '/webhook/pedido-crear', 404], ['POST', '/webhook/mp-notificacion', 404], ['POST', '/t-dump', 404], ['GET', '/webhook/t-dump', 404], ['OPTIONS', '/mp-notificacion', 405]];
    const est = [];
    for (const x of rutas) est.push((await http(x[0], PROXY + x[1], x[0] === 'POST' ? {} : undefined, {})).status);
    caso('solo las rutas permitidas (GET /pedido 405; /webhook/* y otras 404)', est.join() === rutas.map(function (x) { return x[2]; }).join(), est);
    const foraneo = await http('POST', PROXY + '/pedido', solicitud(), { Origin: 'https://evil.example' });
    caso('POST /pedido con Origin ajeno -> 403', foraneo.status === 403);
    const grande = await http('POST', PROXY + '/pedido', { relleno: 'x'.repeat(9000) }, { Origin: ORIGEN });
    caso('POST /pedido de más de 8 KB -> 413', grande.status === 413);
    const lim = [];
    for (let i = 0; i < 6; i++) lim.push((await http('POST', PROXY + '/pedido', { items: [] }, { Origin: ORIGEN, 'CF-Connecting-IP': '190.9.9.9' })).status);
    caso('límite del proxy: 5 pedidos por IP y minuto (el 6.º -> 429)', lim[5] === 429, lim);

    const ex = {};
    [ID.WF13, ID.WF14, ID.WF15, ID.WF11].forEach(function (id) { ex[id] = ejecuciones(id); });
    const malas = Object.keys(ex).map(function (k) { return ex[k].filter(function (e) { return e.status !== 'success'; }).map(function (e) { return k + '#' + e.id + ':' + e.status; }); }).reduce(function (a, b) { return a.concat(b); }, []);
    caso('todas las ejecuciones de WF11/WF13/WF14/WF15 terminaron en success (' + Object.keys(ex).map(function (k) { return k.slice(4, 8) + ' ' + ex[k].length; }).join(', ') + ')', malas.length === 0 && ex[ID.WF13].length >= 5 && ex[ID.WF14].length >= 4, malas);
  } finally { py.kill(); }
  if (/Traceback/.test(logProxy)) caso('chat-proxy sin excepciones', false, logProxy.slice(-600));
}

principal().catch(function (e) { fallos++; console.error(e); }).then(function () {
  if (!DEJAR) { try { docker(['rm', '-f', CONT]); console.log('Contenedor ' + CONT + ' borrado.'); } catch (e) { console.log('No pude borrar ' + CONT + ': ' + e.message); } }
  console.log('\n' + ok + ' ok, ' + fallos + ' fallo(s)');
  process.exit(fallos ? 1 : 0);
});
