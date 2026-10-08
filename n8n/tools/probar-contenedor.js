#!/usr/bin/env node
/*
 * n8n/tools/probar-contenedor.js — Prueba REAL de los 9 workflows en un contenedor n8n DESECHABLE (nunca el contenedor "n8n").
 *   node n8n/tools/probar-contenedor.js            (crea n8n-prueba en 127.0.0.1:5699, prueba y SIEMPRE lo borra al final)
 *   node n8n/tools/probar-contenedor.js --dejar    (no borra el contenedor; bórralo luego con: docker rm -f n8n-prueba)
 *   node n8n/tools/probar-contenedor.js --sin-ollama  (omite las 2 llamadas reales a Ollama)
 * Sin bot real: BOT_TOKEN falso (Telegram responde 404), credenciales = plantilla (GitHub responde 401: nada se publica).
 * Workflows de prueba (solo en el contenedor desechable; ids pbTest…):
 *   pbTest00Setup000  = WF0 con Webhook GET /webhook/t-setup en lugar del disparador manual.
 *   pbTest03Borrador  = WF3 con Webhook POST /webhook/t-wf3 y los 3 GET de GitHub SIN credencial (repo público, solo lectura).
 *   pbTestSeed000000  = sembrar/leer tablas: POST t-config, POST t-inbox, POST t-borrador, GET t-dump.
 *   pbTestError00000  = GET /webhook/t-error: toma el lock "worker" y falla a propósito (errorWorkflow = WF9).
 * Luego publica WF1–WF9 y deja correr WF1/WF2 (schedule 10 s) sobre filas sembradas en pb_inbox.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..');
const DIR_WF = path.join(RAIZ, 'n8n', 'workflows');
const CONT = 'n8n-prueba';
const IMAGEN = 'docker.n8n.io/n8nio/n8n:2.40.7';
const BASE = 'http://127.0.0.1:5699';
const CLAVE_PANEL = 'PEGAR_EN_LA_UI_DE_N8N';                 // valor de la plantilla de credenciales (solo contenedor desechable)
const TOKEN_FALSO = '123456789:' + 'X'.repeat(35);           // formato válido, Telegram responde 404
const DEJAR = process.argv.includes('--dejar');
const SIN_OLLAMA = process.argv.includes('--sin-ollama');
const IDS = ['pbWf00Setup00000', 'pbWf01Ingesta000', 'pbWf02Worker0000', 'pbWf03Borrador00', 'pbWf04Comandos00', 'pbWf05Publicar00',
  'pbWf06Imagen0000', 'pbWf08PanelApi00', 'pbWf09Errores000'];
const TEST = { setup: 'pbTest00Setup000', wf3: 'pbTest03Borrador', seed: 'pbTestSeed000000', error: 'pbTestError00000' };

let ok = 0, fallos = 0;
const resumen = [];
function caso(nombre, cond, detalle) {
  if (cond) { ok++; console.log('  ok    ' + nombre); resumen.push('ok    ' + nombre); }
  else {
    fallos++;
    const d = detalle !== undefined ? ' -> ' + (typeof detalle === 'string' ? detalle : JSON.stringify(detalle)).slice(0, 700) : '';
    console.log('  FALLA ' + nombre + d); resumen.push('FALLA ' + nombre + d);
  }
}
function docker(args, opciones) {
  return execFileSync('docker', args, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }, opciones || {}));
}
function n8n(args) { return docker(['exec', '-u', 'node', CONT, 'n8n'].concat(args)).split('\n').filter(function (l) { return l && !/^ - |deprecations/.test(l); }).join('\n'); }
const dormir = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function http(metodo, ruta, cuerpo, cabeceras, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(function () { ctl.abort(); }, timeoutMs || 30000);
  try {
    const r = await fetch(BASE + ruta, { method: metodo, headers: Object.assign(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}, cabeceras || {}),
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined, signal: ctl.signal });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (e) { json = null; }
    return { status: r.status, headers: r.headers, texto: texto, json: json };
  } catch (e) { return { status: 0, texto: String(e && e.message), json: null, headers: new Headers() }; }
  finally { clearTimeout(t); }
}
async function esperarSalud() {
  for (let i = 0; i < 90; i++) {
    const r = await http('GET', '/healthz', undefined, {}, 3000);
    if (r.status === 200) { await dormir(3000); return true; }
    await dormir(1000);
  }
  return false;
}

// ---------- workflows de prueba ----------
let uuidN = 0;
const uuid = function () { uuidN++; return '00000000-0000-4000-8000-' + String(uuidN).padStart(12, '0'); };
function webhook(nombre, metodo, ruta, pos) {
  return { id: uuid(), name: nombre, type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: pos || [0, 0], webhookId: uuid(),
    parameters: { httpMethod: metodo, path: ruta, responseMode: 'lastNode', responseData: 'firstEntryJson', options: {} } };
}
function code(nombre, js, pos) {
  return { id: uuid(), name: nombre, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos || [0, 0], parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: js } };
}
function dt(nombre, tabla, op, extra, pos) {
  return Object.assign({ id: uuid(), name: nombre, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: pos || [0, 0],
    parameters: Object.assign({ resource: 'row', operation: op, dataTableId: { __rl: true, mode: 'name', value: tabla } }, extra) },
  op === 'get' ? { alwaysOutputData: true, executeOnce: true } : {});
}
function enlazar(conns, a, b, salida) {
  conns[a] = conns[a] || { main: [] };
  const s = salida || 0;
  while (conns[a].main.length <= s) conns[a].main.push([]);
  conns[a].main[s].push({ node: b, type: 'main', index: 0 });
}
function wfTest(id, nombre, nodos, conns) {
  return { id: id, name: nombre, nodes: nodos, connections: conns, active: false, settings: { executionOrder: 'v1', timezone: 'America/Lima', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'none' }, pinData: {} };
}
function construirPruebas(dir) {
  const leer = function (f) { return JSON.parse(fs.readFileSync(path.join(DIR_WF, f), 'utf8')); };
  // T0: WF0 por webhook
  const w0 = leer('WF0-setup.json');
  const trig = w0.nodes.find(function (n) { return n.type === 'n8n-nodes-base.manualTrigger'; });
  Object.assign(trig, webhook(trig.name, 'GET', 't-setup', trig.position), { id: trig.id, name: trig.name });
  w0.id = TEST.setup; w0.name = 'PB TEST WF0 por webhook'; delete w0.settings.errorWorkflow; w0.settings.saveManualExecutions = false;
  // T3: WF3 por webhook, GitHub sin credencial
  const w3 = leer('WF3-borrador-ia.json');
  const ent = w3.nodes.find(function (n) { return n.name === 'Entrada'; });
  const wh = webhook('Webhook t-wf3', 'POST', 't-wf3', [ent.position[0] - 220, ent.position[1]]);
  Object.assign(ent, code('Entrada', 'return [{ json: $input.first().json.body }];', ent.position), { id: ent.id });
  w3.nodes.push(wh);
  enlazar(w3.connections, wh.name, 'Entrada');
  w3.nodes.forEach(function (n) {
    if (/^GET (productos|articulos|sitio)$/.test(n.name)) { n.parameters.authentication = 'none'; delete n.parameters.nodeCredentialType; delete n.credentials; }
  });
  w3.id = TEST.wf3; w3.name = 'PB TEST WF3 por webhook'; delete w3.settings.errorWorkflow; delete w3.settings.callerPolicy;
  // TS: sembrar y leer tablas
  const N = [], C = {};
  const add = function (n) { N.push(n); return n.name; };
  add(webhook('t-config', 'POST', 't-config', [0, 0]));
  add(code('Pares', 'const c = $input.first().json.body.config || {};\nreturn Object.keys(c).map(function (k) { return { json: { clave: k, valor: typeof c[k] === "string" ? c[k] : JSON.stringify(c[k]) } }; });', [220, 0]));
  add(dt('Actualizar config', 'pb_config', 'update', { matchType: 'allConditions', filters: { conditions: [{ keyName: 'clave', condition: 'eq', keyValue: '={{ $json.clave }}' }] },
    columns: { mappingMode: 'defineBelow', value: { valor: '={{ $json.valor }}' }, matchingColumns: [], schema: [{ id: 'valor', displayName: 'valor', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }], attemptToConvertTypes: false, convertFieldsToString: false }, options: {} }, [440, 0]));
  N[N.length - 1].alwaysOutputData = true;
  add(code('Config lista', 'return [{ json: { ok: true, filas: $input.all().filter(function (i) { return i.json.id !== undefined; }).length } }];', [660, 0]));
  enlazar(C, 't-config', 'Pares'); enlazar(C, 'Pares', 'Actualizar config'); enlazar(C, 'Actualizar config', 'Config lista');
  [['t-inbox', 'pb_inbox', 300], ['t-borrador', 'pb_borradores', 600]].forEach(function (x) {
    const a = add(webhook(x[0], 'POST', x[0], [0, x[2]]));
    const b = add(code('Filas ' + x[0], 'return ($input.first().json.body.filas || []).map(function (f) { return { json: f }; });', [220, x[2]]));
    const c = add(dt('Insertar ' + x[1], x[1], 'insert', { columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: false }, options: {} }, [440, x[2]]));
    const d = add(code('Insertadas ' + x[0], 'return [{ json: { ok: true, filas: $input.all().length } }];', [660, x[2]]));
    enlazar(C, a, b); enlazar(C, b, c); enlazar(C, c, d);
  });
  add(webhook('t-dump', 'GET', 't-dump', [0, 900]));
  const tablas = ['pb_config', 'pb_locks', 'pb_inbox', 'pb_borradores', 'pb_imagenes'];
  let prev = 't-dump';
  tablas.forEach(function (t, i) { const n = add(dt('Leer ' + t, t, 'get', { matchType: 'allConditions', filters: {}, returnAll: true }, [220 + i * 220, 900])); enlazar(C, prev, n); prev = n; });
  add(code('Dump', [
    'const leer = function (n) { return $(n).all().map(function (i) { return i.json; }).filter(function (j) { return j.id !== undefined; }); };',
    'const config = {}; leer("Leer pb_config").forEach(function (f) { config[f.clave] = f.clave === "BOT_TOKEN" ? (f.valor ? "(definido)" : "") : f.valor; });',
    'const nConfig = leer("Leer pb_config").length;',
    'return [{ json: { config: config, n_config: nConfig, locks: leer("Leer pb_locks"), inbox: leer("Leer pb_inbox"), borradores: leer("Leer pb_borradores"),',
    '  imagenes: leer("Leer pb_imagenes").map(function (f) { return { draft_id: f.draft_id, n: f.n, mime: f.mime, bytes: String(f.b64 || "").length }; }) } }];'
  ].join('\n'), [1400, 900]));
  enlazar(C, prev, 'Dump');
  const ws = wfTest(TEST.seed, 'PB TEST sembrar y leer tablas', N, C);
  const NE = [], CE = {};
  NE.push(webhook('t-error', 'GET', 't-error', [0, 0]));
  NE.push(dt('Tomar lock', 'pb_locks', 'update', { matchType: 'allConditions', filters: { conditions: [{ keyName: 'nombre', condition: 'eq', keyValue: 'worker' }, { keyName: 'hasta', condition: 'lt', keyValue: '={{ Date.now() }}' }] },
    columns: { mappingMode: 'defineBelow', value: { holder: '={{ $execution.id }}', hasta: '={{ Date.now() + 900000 }}' }, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: false }, options: {} }, [220, 0]));
  NE[1].alwaysOutputData = true;
  NE.push(code('Fallar', 'throw new Error("fallo de prueba con bot" + "' + TOKEN_FALSO + '" + " y github_pat_" + "A".repeat(30));', [440, 0]));
  enlazar(CE, 't-error', 'Tomar lock'); enlazar(CE, 'Tomar lock', 'Fallar');
  const we = wfTest(TEST.error, 'PB TEST error -> WF9', NE, CE);
  we.settings.errorWorkflow = 'pbWf09Errores000';
  [[w0, 'T0-setup.json'], [w3, 'T3-wf3.json'], [ws, 'TS-seed.json'], [we, 'TE-error.json']].forEach(function (x) { fs.writeFileSync(path.join(dir, x[1]), JSON.stringify(x[0], null, 1)); });
}

// ---------- ejecuciones guardadas (SQLite del contenedor desechable) ----------
function ejecuciones() {
  const js = [
    'const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");',
    'const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);',
    'db.all("SELECT e.id, e.workflowId, e.status, e.mode, e.deletedAt, d.data FROM execution_entity e LEFT JOIN execution_data d ON d.executionId = e.id ORDER BY e.id", function (err, filas) {',
    '  if (err) { console.log(JSON.stringify({ error: String(err) })); return; }',
    '  console.log(JSON.stringify(filas.map(function (f) {',
    '    const s = String(f.data || ""); const m = /"message":"([^"]{0,300})/.exec(s); const nodo = /"lastNodeExecuted":"([^"]*)"/.exec(s);',
    '    return { id: f.id, wf: f.workflowId, status: f.deletedAt ? "descartada" : f.status, mode: f.mode, msg: m ? m[1] : "", nodo: nodo ? nodo[1] : "" };',
    '  })));',
    '});'
  ].join('\n');
  try { return JSON.parse(docker(['exec', '-u', 'node', CONT, 'node', '-e', js]).trim().split('\n').pop()); } catch (e) { return [{ error: String(e.message).slice(0, 300) }]; }
}
// Mensajes "lastNodeExecuted" de n8n apuntan al índice en data (flatted): se buscan nombres legibles aparte.
function erroresLegibles() {
  const js = [
    'const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");',
    'const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);',
    'db.all("SELECT e.id, e.workflowId, d.data FROM execution_entity e JOIN execution_data d ON d.executionId = e.id WHERE e.status IN (\'error\',\'crashed\') AND e.deletedAt IS NULL AND e.workflowId <> \'' + TEST.error + '\' ORDER BY e.id", function (err, filas) {',
    '  if (err) { console.log("[]"); return; }',
    '  console.log(JSON.stringify(filas.map(function (f) { const arr = JSON.parse(f.data); const txt = arr.filter(function (x) { return typeof x === "string"; });',
    '    const msg = txt.find(function (x) { return /error|failed|cannot|not |invalid|undefined|is not/i.test(x) && x.length < 400; }) || "";',
    '    return { id: f.id, wf: f.workflowId, msg: msg }; })));',
    '});'
  ].join('\n');
  try { return JSON.parse(docker(['exec', '-u', 'node', CONT, 'node', '-e', js]).trim().split('\n').pop()); } catch (e) { return [{ error: String(e.message).slice(0, 300) }]; }
}

async function dump() { const r = await http('GET', '/webhook/t-dump'); return r.json || {}; }
const fila = function (d, uid) { return (d.inbox || []).filter(function (f) { return f.update_id === uid; }); };

async function principal() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-prueba-'));
  console.log('Contenedor desechable ' + CONT + ' (' + IMAGEN + ') en ' + BASE + '; archivos temporales en ' + tmp);
  try { docker(['rm', '-f', CONT]); } catch (e) { /* no existía */ }
  docker(['run', '--rm', '-d', '--name', CONT, '-p', '127.0.0.1:5699:5678', '-e', 'N8N_DIAGNOSTICS_ENABLED=false', '-e', 'GENERIC_TIMEZONE=America/Lima',
    '-e', 'TZ=America/Lima', '-e', 'N8N_PERSONALIZATION_ENABLED=false', IMAGEN]);
  caso('contenedor n8n-prueba arriba (/healthz 200)', await esperarSalud());

  // 1) Importación
  construirPruebas(tmp);
  docker(['exec', '-u', 'root', CONT, 'sh', '-c', 'rm -rf /tmp/imp && mkdir -p /tmp/imp/wf /tmp/imp/test']);
  docker(['cp', DIR_WF + path.sep + '.', CONT + ':/tmp/imp/wf/']);
  ['T0-setup.json', 'T3-wf3.json', 'TS-seed.json', 'TE-error.json'].forEach(function (f) { docker(['cp', path.join(tmp, f), CONT + ':/tmp/imp/test/' + f]); });
  docker(['cp', path.join(RAIZ, 'n8n', 'reference', 'credenciales.plantilla.json'), CONT + ':/tmp/imp/cred.json']);
  docker(['exec', '-u', 'root', CONT, 'chown', '-R', 'node:node', '/tmp/imp']);
  const rc = n8n(['import:credentials', '--input=/tmp/imp/cred.json']);
  const nCred = JSON.parse(fs.readFileSync(path.join(RAIZ, 'n8n', 'reference', 'credenciales.plantilla.json'), 'utf8')).length;
  caso('import:credentials (plantilla, ' + nCred + ')', new RegExp('imported ' + nCred + ' credentials', 'i').test(rc), rc);
  const rw = n8n(['import:workflow', '--separate', '--input=/tmp/imp/wf']);
  const nWf = fs.readdirSync(DIR_WF).filter(function (x) { return /\.json$/.test(x); }).length;
  caso('import:workflow de los ' + nWf + ' workflows de n8n/workflows', new RegExp('imported ' + nWf + ' workflows', 'i').test(rw), rw);
  const rt = n8n(['import:workflow', '--separate', '--input=/tmp/imp/test']);
  caso('import:workflow de 4 workflows de prueba', /imported 4 workflows/i.test(rt), rt);
  const lista = n8n(['list:workflow']);
  caso('list:workflow muestra los 9 ids fijos', IDS.every(function (id) { return lista.indexOf(id + '|') >= 0; }), lista);

  // 2) Publicar todo salvo WF1/WF2 (aún no hay tablas) y reiniciar
  const publicar = function (ids) { ids.forEach(function (id) { const r = n8n(['publish:workflow', '--id=' + id]); if (!/publish|success/i.test(r)) caso('publish ' + id, false, r); }); };
  publicar(IDS.filter(function (id) { return !/Wf01|Wf02/.test(id); }).concat([TEST.setup, TEST.wf3, TEST.seed, TEST.error]));
  docker(['restart', CONT]);
  caso('reinicio tras publicar (salud)', await esperarSalud());
  const logs1 = docker(['logs', CONT]) + '';
  caso('sin errores de activación en el log', !/(could not be activated|There was a problem activating|Error.*activat)/i.test(logs1),
    (logs1.match(/.*activat.*/gi) || []).slice(0, 5).join(' | '));

  // 3) WF0 (vía T0): tablas y claves por defecto; idempotente
  const s1 = await http('GET', '/webhook/t-setup', undefined, {}, 60000);
  caso('WF0 sin token: termina en "Falta token" (listo:false)', s1.status === 200 && s1.json && s1.json.listo === false, s1.texto);
  let d = await dump();
  caso('WF0 creó pb_config con 22 claves y pb_locks con "worker"', d.n_config === 22 && (d.locks || []).length === 1 && d.locks[0].nombre === 'worker' && d.locks[0].hasta === 0, { n: d.n_config, locks: d.locks });
  const s2 = await http('GET', '/webhook/t-setup', undefined, {}, 60000);
  d = await dump();
  caso('WF0 2.ª corrida idempotente (sin claves ni locks duplicados)', s2.status === 200 && d.n_config === 22 && d.locks.length === 1, { n: d.n_config, locks: d.locks.length });

  // 4) Config de prueba: token falso, 4 autorizados (uno con id 0 = inactivo)
  const AUT = [{ id: 111, rol: 'admin', nombre: 'Admin prueba' }, { id: 222, rol: 'marketing', nombre: 'Mkt prueba' }, { id: 333, rol: 'dueno', nombre: 'Dueno prueba' }, { id: 0, rol: 'dueno', nombre: 'Inactivo' }];
  const rcfg = await http('POST', '/webhook/t-config', { config: { BOT_TOKEN: TOKEN_FALSO, AUTORIZADOS: AUT } });
  caso('pb_config actualizado (BOT_TOKEN falso + AUTORIZADOS)', rcfg.json && rcfg.json.filas === 2, rcfg.texto);
  const s3 = await http('GET', '/webhook/t-setup', undefined, {}, 90000);
  caso('WF0 con token falso: getMe falla y lo informa sin romperse', s3.status === 200 && s3.json && s3.json.listo !== true, s3.texto.slice(0, 400));

  // 5) WF8 Panel-API: clave, CORS, validación, estado
  const e0 = await http('GET', '/webhook/estado');
  caso('WF8 GET /estado sin X-Tienda-Key -> 403', e0.status === 403, e0.status);
  const e1 = await http('GET', '/webhook/estado', undefined, { 'X-Tienda-Key': 'clave-incorrecta' });
  caso('WF8 GET /estado con clave errónea -> 403', e1.status === 403, e1.status);
  const e2 = await http('GET', '/webhook/estado', undefined, { 'X-Tienda-Key': CLAVE_PANEL, Origin: 'http://localhost:8080' }, 60000);
  caso('WF8 GET /estado con clave -> 200 {ok, ocupado, cola, aprobados, pausa}', e2.status === 200 && e2.json && e2.json.ok === true && 'ocupado' in e2.json && 'cola' in e2.json, e2.texto.slice(0, 400));
  caso('WF8 /estado: CORS para http://localhost:8080 y Cache-Control no-store', e2.headers.get('access-control-allow-origin') === 'http://localhost:8080' && /no-store/.test(e2.headers.get('cache-control') || ''),
    { acao: e2.headers.get('access-control-allow-origin'), cc: e2.headers.get('cache-control') });
  const pre = await http('OPTIONS', '/webhook/crear-imagen', undefined, { Origin: 'http://127.0.0.1:8080', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-tienda-key,content-type' });
  caso('WF8 preflight OPTIONS crear-imagen -> 204 con origen permitido', pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'http://127.0.0.1:8080', { s: pre.status, acao: pre.headers.get('access-control-allow-origin') });
  const c0 = await http('POST', '/webhook/crear-imagen', { prompt_usuario: 'camisa de lino' });
  caso('WF8 POST crear-imagen sin clave -> 403', c0.status === 403, c0.status);
  const c1 = await http('POST', '/webhook/crear-imagen', { prompt_usuario: 'x' }, { 'X-Tienda-Key': CLAVE_PANEL }, 60000);
  caso('WF8 POST crear-imagen con pedido inválido -> 400 + siguiente_paso', c1.status === 400 && c1.json && c1.json.ok === false && /\S/.test(c1.json.siguiente_paso || ''), c1.status + ' ' + c1.texto.slice(0, 300));
  const t0 = Date.now();
  const c2 = await http('POST', '/webhook/crear-imagen', { prompt_usuario: 'camisa de lino blanca colgada en una percha de madera', tipo: 'producto', personas: false, size: '768x1024', seed: 7 },
    { 'X-Tienda-Key': CLAVE_PANEL }, 120000);
  d = await dump();
  caso('WF8 crear-imagen con sd-server apagado -> 502 JSON (siguiente_paso) y lock liberado', c2.status === 502 && c2.json && c2.json.ok === false && d.locks[0].hasta === 0,
    { s: c2.status, b: c2.texto.slice(0, 300), lock: d.locks[0], ms: Date.now() - t0 });

  // 6) WF3 real (vía T3) con Ollama real; Telegram falso -> la vista previa no sale -> reintentar
  if (!SIN_OLLAMA) {
    const base = { chat_id: 111, from_id: 111, nombre: 'Admin prueba', rol: 'admin', message_id: 10, comando: '', args: [], fotos: [], callback: null, origen: 'telegram', tipo: 'texto' };
    const tr1 = Object.assign({}, base, { texto: 'Polo de lino blanco para hombre, 59.90 soles, tallas S M L', update_ids: [9001] });
    const t1 = Date.now();
    const r1 = await http('POST', '/webhook/t-wf3', Object.assign({}, tr1, { trabajo: tr1, modo: 'llm', tipo_entidad: 'producto', draft_id: '' }), {}, 400000);
    const ms1 = Date.now() - t1;
    d = await dump();
    const b1 = (d.borradores || []).find(function (b) { return r1.json && b.draft_id === r1.json.draft_id; });
    let c = {}; try { c = JSON.parse((b1 && b1.campos) || '{}'); } catch (e) { c = {}; }
    caso('WF3 + Ollama real (' + Math.round(ms1 / 1000) + ' s): borrador "crear producto" con precio 59.9, categoria hombres y tallas S M L',
      !!b1 && b1.op === 'crear' && b1.entidad === 'producto' && Number(c.precio) === 59.9 && c.categoria === 'hombres' && ['S', 'M', 'L'].every(function (t) { return (c.tallas || []).indexOf(t) >= 0; }),
      { r: r1.texto.slice(0, 300), b: b1 && { op: b1.op, ent: b1.entidad, campos: b1.campos, faltantes: b1.faltantes, estado: b1.estado } });
    caso('WF3 con Telegram caído: {ok:false, reintentar:true} y el borrador huérfano queda en "error" (no "pendiente")',
      r1.json && r1.json.ok === false && r1.json.reintentar === true && !!b1 && b1.estado === 'error', { r: r1.json, estado: b1 && b1.estado });
    const tr2 = Object.assign({}, base, { chat_id: 222, from_id: 222, rol: 'marketing', texto: 'Elimina el producto prd-0001 del catálogo', update_ids: [9002] });
    const t2 = Date.now();
    const r2 = await http('POST', '/webhook/t-wf3', Object.assign({}, tr2, { trabajo: tr2, modo: 'llm', tipo_entidad: 'producto', draft_id: '' }), {}, 400000);
    const d2 = await dump();
    const b2 = (d2.borradores || []).find(function (b) { return r2.json && b.draft_id === r2.json.draft_id; });
    caso('WF3 + Ollama real (' + Math.round((Date.now() - t2) / 1000) + ' s): "Elimina prd-0001" (marketing) nunca da op eliminar (solo /borrar); como mucho un borrador reversible',
      !!r2.json && (!b2 || (['crear', 'actualizar', 'desactivar', 'reactivar', 'stock', 'agregar_imagen'].indexOf(b2.op) >= 0 && b2.estado !== 'aprobado')),
      { r: r2.texto.slice(0, 300), b: b2 && { op: b2.op, id: b2.entidad_id, estado: b2.estado } });
  }

  // 6b) WF9: una ejecución que falla con el lock tomado -> WF9 lo libera y registra la alerta (límite 1/h por wf|nodo)
  const re = await http('GET', '/webhook/t-error', undefined, {}, 30000);
  let dl = null;
  for (let i = 0; i < 20; i++) { await dormir(1000); dl = await dump(); if (dl.locks[0].hasta === 0 && /error -> WF9\|Fallar/.test(dl.config.ALERTAS || '')) break; }
  caso('WF9: ejecución fallida (HTTP ' + re.status + ') -> lock liberado y ALERTAS["PB TEST error -> WF9|Fallar"] anotado (clave = nombre del workflow|nodo)', dl.locks[0].hasta === 0 && dl.locks[0].holder === '' && /error -> WF9\|Fallar/.test(dl.config.ALERTAS || ''),
    { lock: dl.locks[0], alertas: dl.config.ALERTAS });

  // 7) WF1 + WF2 en vivo con filas sembradas
  const ahora = Date.now();
  const fila0 = { tipo: 'texto', chat_id: 111, from_id: 111, nombre: 'Admin prueba', rol: 'admin', message_id: 0, media_group_id: '', file_id: '', file_unique_id: '', texto: '',
    callback_id: '', callback_data: '', callback_message_id: 0, fecha: ahora, recibido: ahora - 60000, estado: 'nuevo', intentos: 0, error: '' };
  const F = function (uid, x) { return Object.assign({}, fila0, { update_id: uid, message_id: uid }, x); };
  const quien = function (id, rol) { return { chat_id: id, from_id: id, rol: rol }; };
  const borr = { draft_id: 'drf-prueba01', owner_id: 111, rol: 'admin', chat_id: 111, preview_message_id: 500, origen: 'telegram', op: 'actualizar', entidad: 'producto', entidad_id: 'prd-0001',
    campos: JSON.stringify({ precio: 49.9 }), campos_inferidos: '[]', faltantes: '[]', avisos: '[]', update_ids: '[1]', file_ids: '[]', file_unique_ids: '[]',
    fecha: '', expira: new Date(ahora + 86400000).toISOString(), estado: 'pendiente', confirmaciones: 0, confirmaciones_requeridas: 1, intentos: 0, error: '', commit_sha: '', texto: 'precio', resumen: 'prd-0001 precio 49.90', fecha_ms: ahora };
  const borr2 = Object.assign({}, borr, { draft_id: 'drf-prueba02', op: 'eliminar', campos: '{}', confirmaciones_requeridas: 2, preview_message_id: 600, resumen: 'eliminar prd-0002', entidad_id: 'prd-0002' });
  const borr3 = Object.assign({}, borr, { draft_id: 'drf-prueba03', estado: 'publicando', preview_message_id: 700, resumen: 'huérfano publicando' });
  const rb = await http('POST', '/webhook/t-borrador', { filas: [borr, borr2, borr3] });
  caso('sembrados 3 borradores (2 pendientes + 1 huérfano en "publicando")', rb.json && rb.json.filas === 3, rb.texto);
  const filas = [
    F(1001, Object.assign({ tipo: 'comando', texto: '/ayuda' }, quien(111, 'admin'))),
    F(1002, Object.assign({ tipo: 'comando', texto: '/borrar prd-0001' }, quien(222, 'marketing'))),
    F(1003, Object.assign({ tipo: 'texto', texto: 'hola' }, quien(444, 'admin'))),               // ya no autorizado
    F(1004, Object.assign({ tipo: 'voz' }, quien(333, 'dueno'))),
    F(1005, Object.assign({ tipo: 'callback', callback_id: 'cb5', callback_data: 'pub:drf-prueba01', callback_message_id: 500 }, quien(222, 'marketing'))),  // ajeno
    F(1006, Object.assign({ tipo: 'callback', callback_id: 'cb6', callback_data: 'pub:drf-prueba01', callback_message_id: 499 }, quien(111, 'admin'))),      // vista previa vieja
    F(1007, Object.assign({ tipo: 'callback', callback_id: 'cb7', callback_data: 'pub:drf-prueba01', callback_message_id: 500 }, quien(111, 'admin'))),      // válido -> aprobado
    F(1008, Object.assign({ tipo: 'comando', texto: '/pausa' }, quien(222, 'marketing'))),
    F(1009, Object.assign({ tipo: 'comando', texto: '/estado' }, quien(333, 'dueno'))),
    F(1010, Object.assign({ tipo: 'texto', texto: 'Camisa de lino arena para mujer 79.90 tallas S M' }, quien(333, 'dueno'))), // WF3 real: GitHub 401 -> reintentos
    F(1011, Object.assign({ tipo: 'callback', callback_id: 'cb11', callback_data: 'pub:drf-prueba02', callback_message_id: 600 }, quien(111, 'admin'))),     // doble confirmación (1/2)
    F(1012, Object.assign({ tipo: 'callback', callback_id: 'cb12', callback_data: 'pub:drf-prueba01:x', callback_message_id: 500 }, quien(111, 'admin')))   // data inválida
  ];
  const ri = await http('POST', '/webhook/t-inbox', { filas: filas });
  caso('sembradas ' + filas.length + ' filas en pb_inbox', ri.json && ri.json.filas === filas.length, ri.texto);
  publicar(['pbWf01Ingesta000', 'pbWf02Worker0000']);
  docker(['restart', CONT]);
  caso('reinicio con WF1/WF2 publicados (salud)', await esperarSalud());
  const limite = Date.now() + 6 * 60000;
  const terminal = function (f) { return f.estado === 'hecho' || f.estado === 'error'; };
  while (Date.now() < limite) {
    d = await dump();
    const pend = filas.filter(function (f) { const x = fila(d, f.update_id); return !x.length || !x.every(terminal); });
    const b1 = (d.borradores || []).find(function (b) { return b.draft_id === 'drf-prueba01'; }) || {};
    const b3 = (d.borradores || []).find(function (b) { return b.draft_id === 'drf-prueba03'; }) || {};
    if (!pend.length && b1.estado === 'error' && b3.estado === 'error') break;
    await dormir(5000);
  }
  const est = function (uid) { return fila(d, uid).map(function (f) { return f.estado + (f.error ? '(' + f.error + ')' : '') + '#' + f.intentos; }).join(','); };
  console.log('  estado final pb_inbox: ' + filas.map(function (f) { return f.update_id + '=' + est(f.update_id); }).join('  '));
  const B = function (id) { return (d.borradores || []).find(function (b) { return b.draft_id === id; }) || {}; };
  caso('WF2 /ayuda (admin) -> WF4 -> hecho', est(1001) === 'hecho#0', est(1001));
  caso('WF2 /borrar de marketing -> WF4 responde "sin permiso" -> hecho (sin borrador)', est(1002) === 'hecho#0' && !(d.borradores || []).some(function (b) { return /\b1002\b/.test(b.update_ids || ''); }), est(1002));
  caso('WF2 autor que ya no está en AUTORIZADOS -> error "no autorizado"', /^error\(no autorizado\)/.test(est(1003)), est(1003));
  caso('WF2 voz -> mensaje fijo -> hecho', est(1004) === 'hecho#0', est(1004));
  caso('WF5 callback de otro usuario -> rechazado (hecho, borrador sigue/termina por su autor)', est(1005) === 'hecho#0', est(1005));
  caso('WF5 callback de vista previa vieja -> rechazado (hecho)', est(1006) === 'hecho#0', est(1006));
  caso('WF5 callback válido -> hecho', est(1007) === 'hecho#0', est(1007));
  caso('WF5 lote con GitHub 401 -> nunca "publicado"; tras 3 intentos el borrador queda en "error"', B('drf-prueba01').estado === 'error' && !B('drf-prueba01').commit_sha,
    { estado: B('drf-prueba01').estado, intentos: B('drf-prueba01').intentos, error: B('drf-prueba01').error });
  caso('WF4 /pausa de marketing -> sin permiso, PAUSA sigue en 0', est(1008) === 'hecho#0' && d.config.PAUSA === '0', { e: est(1008), pausa: d.config.PAUSA });
  caso('WF4 /estado (dueño) -> hecho', est(1009) === 'hecho#0', est(1009));
  caso('WF3 real con GitHub 401 -> 3 intentos y "error" (aviso al usuario)', /^error\(.+\)#3$/.test(est(1010)), est(1010));
  caso('WF5 lote: huérfano "publicando" se recupera, cuenta intentos y termina en "error" (GitHub 401), nunca "publicado"', B('drf-prueba03').estado === 'error' && B('drf-prueba03').intentos === 3 && !B('drf-prueba03').commit_sha,
    { estado: B('drf-prueba03').estado, intentos: B('drf-prueba03').intentos, error: B('drf-prueba03').error });
  caso('WF5 "pub" en borrador de doble confirmación -> confirmaciones=1, sigue pendiente', B('drf-prueba02').estado === 'pendiente' && B('drf-prueba02').confirmaciones === 1, { e: B('drf-prueba02').estado, c: B('drf-prueba02').confirmaciones });
  caso('WF5 callback_data inválido -> rechazado (hecho)', est(1012) === 'hecho#0', est(1012));
  caso('WF1 con token falso: getUpdates falla y suma FALLOS_SEGUIDOS (sin romper)', Number(d.config.FALLOS_SEGUIDOS) > 0, d.config.FALLOS_SEGUIDOS);
  caso('lock "worker" libre al final (o tomado por un tick en curso)', d.locks.length === 1 && (d.locks[0].hasta === 0 || d.locks[0].hasta > Date.now()), d.locks);

  // 8) Ejecuciones con error guardadas
  await dormir(2000);
  const ex = ejecuciones();
  const errores = ex.filter(function (e) { return (e.status === 'error' || e.status === 'crashed') && e.wf !== TEST.error; });
  const porWf = {};
  ex.forEach(function (e) { const k = e.wf + ':' + e.status; porWf[k] = (porWf[k] || 0) + 1; });
  console.log('  ejecuciones guardadas por workflow:estado: ' + JSON.stringify(porWf));
  const leg = errores.length ? erroresLegibles() : [];
  caso('ninguna ejecución con error/crash guardada (salvo la de prueba de WF9)', errores.length === 0, leg.slice(0, 6));
  return { ejecuciones: porWf, errores: leg };
}

principal().catch(function (e) { fallos++; console.log('  FALLA excepción: ' + (e && e.stack || e)); }).then(function () {
  if (!DEJAR) { try { docker(['rm', '-f', CONT]); console.log('Contenedor ' + CONT + ' borrado.'); } catch (e) { console.log('No pude borrar ' + CONT + ': ' + e.message); } }
  console.log('\n' + ok + ' ok, ' + fallos + ' fallo(s)');
  process.exitCode = fallos ? 1 : 0;
});
