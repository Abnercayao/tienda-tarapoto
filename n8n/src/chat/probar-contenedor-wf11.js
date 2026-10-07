#!/usr/bin/env node
/*
 * n8n/src/chat/probar-contenedor-wf11.js — Prueba REAL de WF11 en un contenedor n8n DESECHABLE (nunca el contenedor "n8n").
 *   node n8n/src/chat/probar-contenedor-wf11.js           (crea n8n-prueba-chat en 127.0.0.1:5698, prueba y SIEMPRE lo borra)
 *   node n8n/src/chat/probar-contenedor-wf11.js --dejar   (no lo borra; luego: docker rm -f n8n-prueba-chat)
 * Usa Ollama real (llama3.1:8b en el host) y la web publicada (catálogo). Telegram SIMULADO dentro del contenedor (127.0.0.1:8799):
 * credencial "Telegram Palmera Brava" con baseUrl del simulador y token falso; pb_config.TELEGRAM_API_URL apunta al simulador.
 * Workflows: WF11 (copia con saveDataSuccessExecution "all" y sin errorWorkflow) + pbTestChatSeed00 (sembrar y leer tablas).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const CONT = 'n8n-prueba-chat';
const IMAGEN = 'docker.n8n.io/n8nio/n8n:2.40.7';
const PUERTO = 5698;
const BASE = 'http://127.0.0.1:' + PUERTO;
const TOKEN_FALSO = '123456789:' + 'X'.repeat(35);
const DEJAR = process.argv.includes('--dejar');
const WF11 = 'pbWf11ChatVend00', SEED = 'pbTestChatSeed00';
const ORIGEN = 'https://abnercayao.github.io';

let ok = 0, fallos = 0;
function caso(nombre, cond, detalle) {
  if (cond) { ok++; console.log('  ok    ' + nombre); }
  else { fallos++; console.log('  FALLA ' + nombre + (detalle !== undefined ? ' -> ' + (typeof detalle === 'string' ? detalle : JSON.stringify(detalle)).slice(0, 800) : '')); }
}
function docker(args) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }); }
function n8n(args) { return docker(['exec', '-u', 'node', CONT, 'n8n'].concat(args)); }
const dormir = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function http(metodo, ruta, cuerpo, cabeceras, timeoutMs) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + ruta, { method: metodo, headers: Object.assign(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}, cabeceras || {}),
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(timeoutMs || 30000) });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (e) { json = null; }
    return { status: r.status, headers: r.headers, texto: texto, json: json, ms: Date.now() - t0 };
  } catch (e) { return { status: 0, texto: String(e && e.message), json: null, headers: new Headers(), ms: Date.now() - t0 }; }
}
async function esperarSalud() {
  for (let i = 0; i < 90; i++) { const r = await http('GET', '/healthz', undefined, {}, 3000); if (r.status === 200) { await dormir(3000); return true; } await dormir(1000); }
  return false;
}
const chat = function (sesion, mensaje, extra) { return http('POST', '/webhook/chat-tienda', Object.assign({ sessionId: sesion, mensaje: mensaje, pagina: { seccion: 'catalogo' } }, extra || {}), { Origin: ORIGEN, 'X-Forwarded-For': '190.2.3.4' }, 90000); };

// ---------- workflow de prueba: sembrar y leer tablas ----------
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
  add(code('Pares', 'const c = $("t-config").first().json.body.config || {};\nreturn Object.keys(c).map(function (k) { return { json: { clave: k, valor: typeof c[k] === "string" ? c[k] : JSON.stringify(c[k]) } }; });', [440, 0]));
  add(dt('Upsert config', 'pb_config', { resource: 'row', operation: 'upsert', matchType: 'allConditions', filters: { conditions: [{ keyName: 'clave', condition: 'eq', keyValue: '={{ $json.clave }}' }] },
    columns: { mappingMode: 'defineBelow', value: { clave: '={{ $json.clave }}', valor: '={{ $json.valor }}' }, matchingColumns: [], schema: [col('clave', 'string'), col('valor', 'string')], attemptToConvertTypes: false, convertFieldsToString: false }, options: {} }, [660, 0]));
  add(code('Config lista', 'return [{ json: { ok: true, filas: $input.all().length } }];', [880, 0]));
  con('t-config', 'Crear pb_config'); con('Crear pb_config', 'Pares'); con('Pares', 'Upsert config'); con('Upsert config', 'Config lista');
  add(wh('t-mensajes', 'POST', 't-mensajes', [0, 300]));
  add(code('Filas', 'return ($input.first().json.body.filas || []).map(function (f) { return { json: f }; });', [220, 300]));
  add(dt('Insertar mensajes', 'pb_chat_mensajes', { resource: 'row', operation: 'insert', columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], attemptToConvertTypes: false, convertFieldsToString: false }, options: {} }, [440, 300]));
  add(code('Insertados', 'return [{ json: { ok: true, filas: $input.all().length } }];', [660, 300]));
  con('t-mensajes', 'Filas'); con('Filas', 'Insertar mensajes'); con('Insertar mensajes', 'Insertados');
  add(wh('t-dump', 'GET', 't-dump', [0, 600]));
  let prev = 't-dump';
  ['pb_citas', 'pb_chat_mensajes', 'pb_chat_aprendizaje'].forEach(function (t, i) {
    const x = add(dt('Leer ' + t, t, { resource: 'row', operation: 'get', matchType: 'allConditions', filters: {}, returnAll: true }, [220 + 220 * i, 600], { alwaysOutputData: true, executeOnce: true }));
    con(prev, x); prev = x;
  });
  add(code('Dump', 'const l = function (n) { return $(n).all().map(function (i) { return i.json; }).filter(function (j) { return j.id !== undefined; }); };\n' +
    'return [{ json: { citas: l("Leer pb_citas"), mensajes: l("Leer pb_chat_mensajes"), aprendizaje: l("Leer pb_chat_aprendizaje") } }];', [880, 600]));
  con(prev, 'Dump');
  return { id: SEED, name: 'PB TEST chat sembrar y leer', nodes: N, connections: C, active: false, settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none' }, pinData: {} };
}
const MOCK = [
  "const http = require('http'); const fs = require('fs');",
  "http.createServer(function (req, res) { const ch = []; req.on('data', function (c) { ch.push(c); }); req.on('end', function () {",
  "  const buf = Buffer.concat(ch); const ct = String(req.headers['content-type'] || ''); const metodo = req.url.split('?')[0].split('/').pop();",
  "  const reg = { url: req.url.replace(/bot[^/]+/, 'bot***'), metodo: metodo, ct: ct.split(';')[0], bytes: buf.length };",
  "  if (/json/.test(ct)) { try { reg.json = JSON.parse(buf.toString('utf8')); } catch (e) { reg.texto = buf.toString('utf8').slice(0, 500); } }",
  "  else { const s = buf.toString('utf8'); const g = function (re) { const m = re.exec(s); return m ? m[1] : ''; };",
  "    reg.chat_id = g(/name=\"chat_id\"\\r\\n\\r\\n([^\\r]+)/); reg.caption = g(/name=\"caption\"\\r\\n\\r\\n([^\\r]+)/); reg.parse_mode = g(/name=\"parse_mode\"\\r\\n\\r\\n([^\\r]+)/);",
  "    reg.filename = g(/filename=\"([^\"]+)\"/); reg.part_ct = g(/Content-Type: ([^\\r]+)\\r\\n\\r\\nBEGIN:VCALENDAR/); reg.ics = /BEGIN:VCALENDAR[\\s\\S]*END:VCALENDAR/.test(s);",
  "    reg.summary = g(/(SUMMARY:[^\\r]+)/); reg.dtstart = g(/(DTSTART:[^\\r]+)/); reg.dtend = g(/(DTEND:[^\\r]+)/); }",
  "  fs.appendFileSync('/tmp/mock-telegram.log', JSON.stringify(reg) + '\\n');",
  "  res.setHeader('content-type', 'application/json');",
  "  res.end(JSON.stringify({ ok: true, result: { message_id: 1000 + Math.floor(Math.random() * 9000), chat: { id: 1 }, date: Math.floor(Date.now() / 1000), document: metodo === 'sendDocument' ? { file_name: reg.filename, file_id: 'X' } : undefined } }));",
  "}); }).listen(8799, '127.0.0.1');"
].join('\n');
function mockLog() {
  try { return docker(['exec', CONT, 'sh', '-c', 'cat /tmp/mock-telegram.log 2>/dev/null || true']).split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); }); } catch (e) { return []; }
}
// Ejecuciones guardadas (SQLite + flatted del contenedor desechable): estado y salida de un nodo.
function ejecuciones(nodo) {
  const js = [
    'const sqlite3 = require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");',
    'let flatted = null; try { flatted = require(require.resolve("flatted", { paths: ["/usr/local/lib/node_modules/n8n", "/usr/local/lib/node_modules/n8n/node_modules/n8n-workflow"] })); } catch (e) { flatted = null; }',
    'const db = new sqlite3.Database("/home/node/.n8n/database.sqlite", sqlite3.OPEN_READONLY);',
    'db.all("SELECT e.id, e.workflowId, e.status, d.data FROM execution_entity e LEFT JOIN execution_data d ON d.executionId = e.id WHERE e.workflowId = \'' + WF11 + '\' ORDER BY e.id", function (err, filas) {',
    '  if (err) { console.log(JSON.stringify({ error: String(err) })); return; }',
    '  console.log(JSON.stringify(filas.map(function (f) { let salida = null, ultimo = "", msg = "";',
    '    try { const d = flatted.parse(f.data); const rd = d.resultData || {}; ultimo = rd.lastNodeExecuted || ""; msg = rd.error ? String(rd.error.message || "").slice(0, 200) : "";',
    '      const run = rd.runData && rd.runData[' + JSON.stringify(nodo) + ']; salida = run && run[0] && run[0].data ? run[0].data.main[0].map(function (i) { return i.json; }) : null; } catch (e) { msg = "flatted: " + e.message; }',
    '    return { id: f.id, status: f.status, ultimo: ultimo, msg: msg, salida: salida }; })));',
    '});'
  ].join('\n');
  try { return JSON.parse(docker(['exec', '-u', 'node', CONT, 'node', '-e', js]).trim().split('\n').pop()); } catch (e) { return [{ error: String(e.message).slice(0, 300) }]; }
}
const dump = async function () { const r = await http('GET', '/webhook/t-dump'); return r.json || {}; };
function diaHabil(desde) { let ms = Date.now() + desde * 86400000; while (new Date(ms - 5 * 3600000).getUTCDay() === 0) ms += 86400000; return new Date(ms - 5 * 3600000).toISOString().slice(0, 10); }

async function principal() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-chat-'));
  console.log('Contenedor desechable ' + CONT + ' (' + IMAGEN + ') en ' + BASE);
  try { docker(['rm', '-f', CONT]); } catch (e) { /* no existía */ }
  docker(['run', '--rm', '-d', '--name', CONT, '-p', '127.0.0.1:' + PUERTO + ':5678', '-e', 'N8N_DIAGNOSTICS_ENABLED=false', '-e', 'GENERIC_TIMEZONE=America/Lima',
    '-e', 'TZ=America/Lima', '-e', 'N8N_PERSONALIZATION_ENABLED=false', IMAGEN]);
  caso('contenedor arriba (/healthz 200)', await esperarSalud());

  // Importación: credencial Telegram -> simulador; WF11 (copia de prueba) + sembrador
  const wf = JSON.parse(fs.readFileSync(path.join(RAIZ, 'n8n', 'workflows', 'WF11-chat-vendedor.json'), 'utf8'));
  wf.settings.saveDataSuccessExecution = 'all'; delete wf.settings.errorWorkflow;
  fs.mkdirSync(path.join(tmp, 'wf'));
  fs.writeFileSync(path.join(tmp, 'wf', 'WF11.json'), JSON.stringify(wf));
  fs.writeFileSync(path.join(tmp, 'wf', 'SEED.json'), JSON.stringify(seed()));
  fs.writeFileSync(path.join(tmp, 'cred.json'), JSON.stringify([{ id: 'pbCredTelegram01', name: 'Telegram Palmera Brava', type: 'telegramApi', data: { accessToken: TOKEN_FALSO, baseUrl: 'http://127.0.0.1:8799' } }]));
  fs.writeFileSync(path.join(tmp, 'mock.js'), MOCK);
  docker(['exec', '-u', 'root', CONT, 'sh', '-c', 'rm -rf /tmp/imp && mkdir -p /tmp/imp']);
  docker(['cp', path.join(tmp, 'wf'), CONT + ':/tmp/imp/wf']);
  docker(['cp', path.join(tmp, 'cred.json'), CONT + ':/tmp/imp/cred.json']);
  docker(['cp', path.join(tmp, 'mock.js'), CONT + ':/tmp/mock-telegram.js']);
  docker(['exec', '-u', 'root', CONT, 'chown', '-R', 'node:node', '/tmp/imp', '/tmp/mock-telegram.js']);
  caso('import:credentials (Telegram -> simulador)', /imported 1 credential/i.test(n8n(['import:credentials', '--input=/tmp/imp/cred.json'])));
  caso('import:workflow (WF11 + sembrador)', /imported 2 workflows/i.test(n8n(['import:workflow', '--separate', '--input=/tmp/imp/wf'])));
  [WF11, SEED].forEach(function (id) { n8n(['publish:workflow', '--id=' + id]); });
  docker(['restart', CONT]);
  caso('reinicio tras publicar', await esperarSalud());
  const logs = docker(['logs', CONT]) + '';
  caso('sin errores de activación', !/(could not be activated|problem activating)/i.test(logs), (logs.match(/.*activat.*/gi) || []).slice(0, 3).join(' | '));
  docker(['exec', '-d', '-u', 'node', CONT, 'node', '/tmp/mock-telegram.js']);
  await dormir(800);

  // Config (pb_config la crea WF0 en la instancia real; aquí el sembrador)
  const AUT = [{ id: 111, rol: 'admin', nombre: 'Admin prueba' }, { id: 222, rol: 'dueno', nombre: 'Dueño prueba' }];
  const rc = await http('POST', '/webhook/t-config', { config: { BOT_TOKEN: TOKEN_FALSO, AUTORIZADOS: AUT, TELEGRAM_API_URL: 'http://127.0.0.1:8799' } });
  caso('pb_config sembrado (token falso, admin 111, Telegram simulado)', rc.json && rc.json.filas === 3, rc.texto);

  // Entrada y CORS
  const pre = await http('OPTIONS', '/webhook/chat-tienda', undefined, { Origin: ORIGEN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' });
  caso('preflight OPTIONS desde ' + ORIGEN + ' -> 204 con Allow-Origin', pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGEN, { s: pre.status, acao: pre.headers.get('access-control-allow-origin') });
  const pre2 = await http('OPTIONS', '/webhook/chat-tienda', undefined, { Origin: 'http://localhost:8080', 'Access-Control-Request-Method': 'POST' });
  caso('preflight desde http://localhost:8080 -> permitido', pre2.headers.get('access-control-allow-origin') === 'http://localhost:8080', pre2.headers.get('access-control-allow-origin'));
  const malo = await chat('X', 'hola');
  caso('sessionId inválido -> 400 {respuesta}', malo.status === 400 && malo.json && /sesión/.test(malo.json.respuesta), malo.status + ' ' + malo.texto);

  // Conversación real con llama3.1:8b
  const S = 'prueba-' + Date.now().toString(36);
  const r1 = await chat(S, '¿Tienen camisas de lino para hombre? ¿Qué precio tienen?');
  caso('consulta (1.ª, crea tablas y carga catálogo) -> 200 en ' + (r1.ms / 1000).toFixed(1) + ' s, menciona lino y S/', r1.status === 200 && r1.json && /lino/i.test(r1.json.respuesta) && /S\/ ?\d/.test(r1.json.respuesta) && r1.json.escribiendo_ms >= 800, r1.texto);
  caso('respuesta con Allow-Origin ' + ORIGEN + ' y Cache-Control no-store', r1.headers.get('access-control-allow-origin') === ORIGEN && /no-store/.test(r1.headers.get('cache-control') || ''), { acao: r1.headers.get('access-control-allow-origin'), cc: r1.headers.get('cache-control') });
  console.log('        Valeria: ' + (r1.json ? r1.json.respuesta : r1.texto));
  const r2 = await chat(S, '¿Y la tienen en talla L?');
  caso('2.º mensaje -> 200 en ' + (r2.ms / 1000).toFixed(1) + ' s', r2.status === 200 && r2.json && r2.json.respuesta, r2.texto);
  console.log('        Valeria: ' + (r2.json ? r2.json.respuesta : r2.texto));
  const ex = ejecuciones('Catálogo');
  const fuentes = ex.map(function (e) { return e.salida && e.salida[0] ? e.salida[0].fuente : null; }).filter(Boolean);
  caso('catálogo: 1.ª vez desde la web publicada, 2.ª desde la caché (datos estáticos)', fuentes[0] === 'web' && fuentes[1] === 'cache', fuentes);
  const exP = ejecuciones('Preparar');
  const sis = exP.length && exP[exP.length - 1].salida ? exP[exP.length - 1].salida[0].cuerpo.messages : [];
  caso('historial re-inyectado (system + 2 previos + actual)', sis.length === 4 && sis[1].role === 'user' && sis[2].role === 'assistant', sis.map(function (m) { return m.role; }));

  // Cita completa
  const F = diaHabil(3);
  const p = F.split('-').map(Number);
  const dia = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  const C = 'cita-' + Date.now().toString(36);
  const pasos = ['Me encanta esta web. ¿El bot también puede tomar pedidos? Quisiera conversar con Abner, aunque no sé si tendré tiempo para actualizar la web.', 'Sí, agendemos. Soy Carla Ruiz y tengo la panadería Pan del Huallaga',
    'Mi correo es carla.ruiz@gmail.com y mi WhatsApp es 987 654 321', 'El ' + dia + ' ' + p[2] + ' a las 10 de la mañana, por videollamada',
    'Mis datos: Carla Ruiz, negocio Pan del Huallaga, rubro panadería, carla.ruiz@gmail.com, 987654321, fecha ' + F + ', 10:00, videollamada'];
  let resumen = false, ms = [];
  for (let i = 0; i < pasos.length && !resumen; i++) {
    const r = await chat(C, pasos[i]);
    ms.push(r.ms);
    console.log('        Visitante: ' + pasos[i] + '\n        Valeria: ' + (r.json ? r.json.respuesta : r.status + ' ' + r.texto).replace(/\n/g, ' / '));
    resumen = !!(r.json && /Revisa por favor los datos/.test(r.json.respuesta));
  }
  caso('la conversación llega al resumen fijo de la cita', resumen);
  const rs = await chat(C, 'Sí, todo correcto');
  ms.push(rs.ms);
  console.log('        Visitante: Sí, todo correcto\n        Valeria: ' + (rs.json ? rs.json.respuesta : rs.texto));
  caso('"Sí, todo correcto" -> 200 con cita.agendada (' + F + ' 10:00)', rs.status === 200 && rs.json && rs.json.cita && rs.json.cita.agendada === true && rs.json.cita.fecha === F && rs.json.cita.hora === '10:00', rs.texto);
  caso('tiempos de respuesta del chat < 60 s (web): ' + ms.map(function (x) { return (x / 1000).toFixed(1); }).join(', ') + ' s', ms.every(function (x) { return x < 60000; }));
  let d = {};
  for (let i = 0; i < 60; i++) { d = await dump(); const c = (d.citas || [])[0]; if (c && c.aviso_telegram) break; await dormir(2000); }
  const cita = (d.citas || [])[0] || {};
  caso('pb_citas: 1 cita confirmada, 10:00–10:30 hora de Perú (15:00Z), datos normalizados', (d.citas || []).length === 1 && cita.estado === 'confirmada' && new Date(cita.inicio_ms).toISOString().slice(11, 16) === '15:00' &&
    cita.fin_ms - cita.inicio_ms === 1800000 && cita.correo === 'carla.ruiz@gmail.com' && cita.telefono === '+51 987 654 321' && cita.modalidad === 'videollamada', cita);
  caso('pb_citas.aviso_telegram = "mensaje 1/1, ics 1/1" y resumen de la IA', cita.aviso_telegram === 'mensaje 1/1, ics 1/1' && String(cita.resumen || '').length > 10, { aviso: cita.aviso_telegram, resumen: cita.resumen });
  const log = mockLog();
  const sm = log.filter(function (x) { return x.metodo === 'sendMessage'; });
  const sd = log.filter(function (x) { return x.metodo === 'sendDocument'; });
  caso('Telegram sendMessage (HTTP, token de pb_config) solo al admin 111 con datos + resumen + "Siguiente paso"', sm.length === 1 && sm[0].json.chat_id === 111 && /Nueva cita/.test(sm[0].json.text) && /Pan del Huallaga/.test(sm[0].json.text) &&
    /Resumen de la conversación: /.test(sm[0].json.text) && /\nSiguiente paso: /.test(sm[0].json.text) && sm[0].json.parse_mode === 'HTML', sm);
  caso('Telegram sendDocument (nodo Telegram 1.2 + credencial) multipart con .ics: chat 111, text/calendar, VEVENT 15:00Z', sd.length === 1 && sd[0].chat_id === '111' && /^cita-pan-del-huallaga-\d{4}-\d{2}-\d{2}\.ics$/.test(sd[0].filename) &&
    sd[0].ics === true && /text\/calendar/.test(sd[0].part_ct) && /T150000Z$/.test(sd[0].dtstart) && /T153000Z$/.test(sd[0].dtend) && /SUMMARY:Cita Palmera Brava – Pan del Huallaga/.test(sd[0].summary) && sd[0].parse_mode === 'HTML', sd);
  console.log('        Telegram simulado: ' + JSON.stringify(sd[0] || {}).slice(0, 400));
  const msgs = (d.mensajes || []).filter(function (m) { return m.sesion === C; });
  caso('pb_chat_mensajes: 2 filas por turno; la última del asistente con estado "agendada"', msgs.length === 2 * ms.length && JSON.parse(msgs.filter(function (m) { return m.rol === 'asistente'; }).pop().cita_json).estado === 'agendada', msgs.length);
  console.log('        pb_chat_aprendizaje: ' + (d.aprendizaje || []).length + ' notas -> ' + (d.aprendizaje || []).map(function (a) { return a.tipo + ': ' + a.texto; }).join(' | ').slice(0, 600));
  const exA = ejecuciones('Ollama aprendizaje').filter(function (e) { return e.salida; }).pop();
  console.log('        IA aprendizaje (crudo): ' + (exA && exA.salida[0] && exA.salida[0].message ? exA.salida[0].message.content : JSON.stringify(exA && exA.salida)).replace(/\s+/g, ' ').slice(0, 900));
  caso('pb_chat_aprendizaje: notas guardadas al agendar (tipo, clave, frecuencia 1, activo)', (d.aprendizaje || []).length >= 1 && d.aprendizaje.every(function (a) { return /^(pregunta|objecion|dato):/.test(a.clave) && a.frecuencia >= 1 && a.activo === true && a.origen === 'auto'; }), d.aprendizaje);

  // Límite por sesión (sembrado) y Ollama caído
  const L = 'limite-' + Date.now().toString(36);
  const filas = []; for (let i = 0; i < 20; i++) filas.push({ sesion: L, rol: 'usuario', texto: 'x', intencion: 'otro', ip_hash: 'h', fecha_ms: Date.now() - 1000, turno: i + 1, cita_json: '', pagina: '', error: '', ms_ia: 0 });
  await http('POST', '/webhook/t-mensajes', { filas: filas });
  const rl = await chat(L, 'hola');
  caso('21.º mensaje de la sesión en 10 min -> 429 sin IA (' + rl.ms + ' ms)', rl.status === 429 && rl.json && /rápido/.test(rl.json.respuesta), rl.status + ' ' + rl.texto);
  await http('POST', '/webhook/t-config', { config: { OLLAMA_URL: 'http://127.0.0.1:9' } });
  const rc2 = await chat('caida-' + Date.now().toString(36), 'hola, ¿tienen vestidos?');
  caso('Ollama caído -> 200 con respaldo de WhatsApp (' + rc2.ms + ' ms)', rc2.status === 200 && rc2.json && /wa\.me\/51995542938/.test(rc2.json.respuesta), rc2.texto);
  const todas = ejecuciones('Respuesta');
  caso('todas las ejecuciones de WF11 terminaron en success', todas.length >= 8 && todas.every(function (e) { return e.status === 'success'; }), todas.filter(function (e) { return e.status !== 'success'; }).map(function (e) { return { id: e.id, s: e.status, ultimo: e.ultimo, msg: e.msg }; }));
}

principal().catch(function (e) { fallos++; console.error(e); }).then(function () {
  if (!DEJAR) { try { docker(['rm', '-f', CONT]); console.log('Contenedor ' + CONT + ' borrado.'); } catch (e) { console.log('No pude borrar ' + CONT + ': ' + e.message); } }
  console.log('\n' + ok + ' ok, ' + fallos + ' fallas');
  process.exit(fallos ? 1 : 0);
});
