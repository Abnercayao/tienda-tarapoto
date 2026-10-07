#!/usr/bin/env node
/*
 * n8n/tools/construir-nucleo.js — Genera los workflows del NÚCLEO (WF0, WF1, WF2, WF5, WF9) en n8n/workflows/.
 *   node n8n/tools/construir-nucleo.js
 * Fuente del código de los nodos Code: n8n/src/nucleo/*.js (secciones "//// <Nombre del nodo>").
 *   "// @incluir comun"       -> n8n/src/nucleo/comun.js
 *   "// @incluir validar.js"  -> bloque "COPIAR A N8N ... FIN" de tools/validar.js (A11: una sola fuente)
 * IDs fijos: workflows según ARQUITECTURA-N8N.md §3; nodos con UUID v4 derivado de "<wf>|<nombre>" (estable entre builds).
 * Sin pinData, sin meta.instanceId, sin secretos (las credenciales se referencian por id; el token vive en pb_config).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..', '..');
const SRC = path.join(RAIZ, 'n8n', 'src', 'nucleo');
const SALIDA = path.join(RAIZ, 'n8n', 'workflows');

const ID = {
  WF0: 'pbWf00Setup00000', WF1: 'pbWf01Ingesta000', WF2: 'pbWf02Worker0000', WF3: 'pbWf03Borrador00', WF4: 'pbWf04Comandos00',
  WF5: 'pbWf05Publicar00', WF6: 'pbWf06Imagen0000', WF8: 'pbWf08PanelApi00', WF9: 'pbWf09Errores000'
};
const CRED_GITHUB = { githubApi: { id: 'pbCredGithub0001', name: 'GitHub Palmera Brava' } };

// ---------- inclusión de código ----------
function bloqueValidar() {
  const t = fs.readFileSync(path.join(RAIZ, 'tools', 'validar.js'), 'utf8').replace(/\r\n/g, '\n');
  const ini = '// === COPIAR A N8N ===';
  const fin = '// === FIN COPIAR A N8N ===';
  const i = t.indexOf(ini);
  const f = t.indexOf(fin);
  if (i < 0 || f < i) throw new Error('No encuentro el bloque COPIAR A N8N en tools/validar.js');
  return t.slice(i, f + fin.length);
}
const COMUN = fs.readFileSync(path.join(SRC, 'comun.js'), 'utf8').replace(/\r\n/g, '\n').trim();
const VALIDAR = bloqueValidar();
function incluir(code) {
  return code.replace(/^\/\/ @incluir validar\.js$/m, function () { return VALIDAR; }).replace(/^\/\/ @incluir comun$/m, function () { return COMUN; });
}
function secciones(archivo) {
  const t = fs.readFileSync(path.join(SRC, archivo), 'utf8').replace(/\r\n/g, '\n');
  const partes = t.split(/^\/\/\/\/ (.+)$/m);
  const out = {};
  for (let i = 1; i < partes.length; i += 2) out[partes[i].trim()] = partes[i + 1].trim() + '\n';
  return out;
}
function uuid(semilla) {
  const x = crypto.createHash('sha1').update(semilla).digest('hex');
  return x.slice(0, 8) + '-' + x.slice(8, 12) + '-4' + x.slice(13, 16) + '-' + ((parseInt(x[16], 16) & 3) | 8).toString(16) + x.slice(17, 20) + '-' + x.slice(20, 32);
}

// ---------- tablas (ARQUITECTURA §4) ----------
const TABLAS = {
  pb_config: [['clave', 'string'], ['valor', 'string']],
  pb_locks: [['nombre', 'string'], ['holder', 'string'], ['hasta', 'number']],
  pb_inbox: [['update_id', 'number'], ['tipo', 'string'], ['chat_id', 'number'], ['from_id', 'number'], ['nombre', 'string'], ['rol', 'string'],
    ['message_id', 'number'], ['media_group_id', 'string'], ['file_id', 'string'], ['file_unique_id', 'string'], ['texto', 'string'],
    ['callback_id', 'string'], ['callback_data', 'string'], ['callback_message_id', 'number'], ['fecha', 'number'], ['recibido', 'number'],
    ['estado', 'string'], ['intentos', 'number'], ['error', 'string']],
  pb_borradores: [['draft_id', 'string'], ['owner_id', 'number'], ['rol', 'string'], ['chat_id', 'number'], ['preview_message_id', 'number'],
    ['origen', 'string'], ['op', 'string'], ['entidad', 'string'], ['entidad_id', 'string'], ['campos', 'string'], ['campos_inferidos', 'string'],
    ['faltantes', 'string'], ['avisos', 'string'], ['update_ids', 'string'], ['file_ids', 'string'], ['file_unique_ids', 'string'],
    ['fecha', 'string'], ['expira', 'string'], ['estado', 'string'], ['confirmaciones', 'number'], ['confirmaciones_requeridas', 'number'],
    ['intentos', 'number'], ['error', 'string'], ['commit_sha', 'string'], ['texto', 'string'], ['resumen', 'string'], ['fecha_ms', 'number']],
  pb_imagenes: [['draft_id', 'string'], ['n', 'number'], ['b64', 'string'], ['mime', 'string'], ['ancho', 'number'], ['alto', 'number'],
    ['origen', 'string'], ['alt', 'string'], ['file_unique_id', 'string']]
};

// ---------- constructor de un workflow ----------
function workflow(id, nombre, settings, archivoCodigo) {
  const wf = { id: id, name: nombre, active: false, nodes: [], connections: {}, settings: settings, meta: {}, tags: [] };
  const codigo = archivoCodigo ? secciones(archivoCodigo) : {};
  const usados = new Set();
  let notas = 0;
  const A = {
    wf: wf,
    nodo: function (name, type, tv, pos, parameters, extra) {
      if (wf.nodes.some(function (n) { return n.name === name; })) throw new Error(id + ': nodo repetido ' + name);
      wf.nodes.push(Object.assign({ id: uuid(id + '|' + name), name: name, type: 'n8n-nodes-base.' + type, typeVersion: tv, position: pos, parameters: parameters }, extra || {}));
      return name;
    },
    code: function (name, pos, extra) {
      if (!codigo[name]) throw new Error(id + ': falta el código de "' + name + '" en ' + archivoCodigo);
      usados.add(name);
      return A.nodo(name, 'code', 2, pos, { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: incluir(codigo[name]) }, extra);
    },
    con: function (de, a, salida) {
      const s = salida || 0;
      const c = wf.connections[de] = wf.connections[de] || { main: [] };
      while (c.main.length <= s) c.main.push([]);
      c.main[s].push({ node: a, type: 'main', index: 0 });
    },
    cadena: function () { const l = Array.prototype.slice.call(arguments); for (let i = 0; i < l.length - 1; i++) A.con(l[i], l[i + 1]); },
    nota: function (texto, pos, ancho, alto, color) {
      notas++;
      wf.nodes.push({ id: uuid(id + '|nota|' + notas), name: 'Nota ' + notas, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: pos,
        parameters: { content: texto, width: ancho, height: alto, color: color || 7 } });
    },
    fin: function () {
      const sobran = Object.keys(codigo).filter(function (k) { return !usados.has(k); });
      if (sobran.length) throw new Error(id + ': secciones de código sin nodo: ' + sobran.join(', '));
      return wf;
    }
  };
  return A;
}

// ---------- ayudas de parámetros ----------
const rl = function (tabla) { return { __rl: true, mode: 'name', value: tabla }; };
const filtros = function (l) { return l.length ? { conditions: l.map(function (c) { return { keyName: c[0], condition: c[1], keyValue: c[2] }; }) } : {}; };
const esquema = function (tabla, cols) {
  return cols.map(function (c) {
    const def = TABLAS[tabla].find(function (x) { return x[0] === c; });
    if (!def) throw new Error('columna ' + c + ' no existe en ' + tabla);
    return { id: c, displayName: c, required: false, defaultMatch: false, display: true, type: def[1], canBeUsedToMatch: true };
  });
};
function dtCrear(W, name, tabla, pos) {
  return W.nodo(name, 'dataTable', 1.1, pos, { resource: 'table', operation: 'create', tableName: tabla,
    columns: { column: TABLAS[tabla].map(function (c) { return { name: c[0], type: c[1] }; }) }, options: { createIfNotExists: true } });
}
function dtLeer(W, name, tabla, conds, pos, o) {
  o = o || {};
  const p = { resource: 'row', operation: 'get', dataTableId: rl(tabla), matchType: o.match || 'allConditions', filters: filtros(conds), returnAll: !o.limit };
  if (o.limit) p.limit = o.limit;
  if (o.orden) { p.orderBy = true; p.orderByColumn = o.orden; p.orderByDirection = o.dir || 'ASC'; }
  const extra = { alwaysOutputData: true };
  if (o.unaVez !== false) extra.executeOnce = true;
  return W.nodo(name, 'dataTable', 1.1, pos, p, extra);
}
function dtActualizar(W, name, tabla, conds, valores, pos, o) {
  if (!conds.length) throw new Error(name + ': update sin filtros');
  const extra = { alwaysOutputData: true };
  if (o && o.unaVez) extra.executeOnce = true;
  return W.nodo(name, 'dataTable', 1.1, pos, { resource: 'row', operation: 'update', dataTableId: rl(tabla), matchType: 'allConditions', filters: filtros(conds),
    columns: { mappingMode: 'defineBelow', value: valores, matchingColumns: [], schema: esquema(tabla, Object.keys(valores)), attemptToConvertTypes: false, convertFieldsToString: false },
    options: {} }, extra);
}
function dtInsertar(W, name, tabla, pos) {
  return W.nodo(name, 'dataTable', 1.1, pos, { resource: 'row', operation: 'insert', dataTableId: rl(tabla),
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: esquema(tabla, TABLAS[tabla].map(function (c) { return c[0]; })), attemptToConvertTypes: false, convertFieldsToString: false },
    options: {} });
}
function dtBorrar(W, name, tabla, conds, pos) {
  if (!conds.length) throw new Error(name + ': deleteRows sin filtros');
  return W.nodo(name, 'dataTable', 1.1, pos, { resource: 'row', operation: 'deleteRows', dataTableId: rl(tabla), matchType: 'allConditions', filters: filtros(conds), options: {} }, { alwaysOutputData: true });
}
let nCond = 0;
function filtroSi(expr) {
  nCond++;
  return { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
    conditions: [{ id: uuid('cond|' + nCond + '|' + expr), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' };
}
function si(W, name, expr, pos) { return W.nodo(name, 'if', 2.3, pos, { conditions: filtroSi(expr), looseTypeValidation: false, options: {} }); }
function segun(W, name, expr, claves, pos) {
  return W.nodo(name, 'switch', 3.4, pos, { mode: 'rules', rules: { values: claves.map(function (k) {
    return { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
      conditions: [{ id: uuid('sw|' + name + '|' + k), leftValue: expr, rightValue: k, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
    renameOutput: true, outputKey: k };
  }) }, options: { fallbackOutput: 'extra', renameFallbackOutput: 'otro' } });
}
const TOKEN = "$('Config').first().json.BOT_TOKEN";
function telegram(W, name, pos) {
  return W.nodo(name, 'httpRequest', 4.5, pos, { method: 'POST', url: '=https://api.telegram.org/bot{{ ' + TOKEN + ' }}/{{ $json.metodo }}',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.cuerpo) }}',
    options: { timeout: 20000, response: { response: { neverError: true, responseFormat: 'json' } } } }, { onError: 'continueRegularOutput' });
}
function telegramGet(W, name, metodo, query, pos, extra) {
  const p = { method: 'GET', url: '=https://api.telegram.org/bot{{ ' + TOKEN + ' }}/' + metodo, options: { timeout: 20000, response: { response: { neverError: true, responseFormat: 'json' } } } };
  if (query) { p.sendQuery = true; p.queryParameters = { parameters: query.map(function (q) { return { name: q[0], value: q[1] }; }) }; }
  return W.nodo(name, 'httpRequest', 4.5, pos, p, Object.assign({ onError: 'continueRegularOutput' }, extra || {}));
}
const REPO = "{{ $('Config').first().json.REPO }}";
const RAMA = "{{ $('Config').first().json.REPO_BRANCH }}";
function github(W, name, metodo, url, pos, o) {
  o = o || {};
  const p = { method: metodo, url: url, authentication: 'predefinedCredentialType', nodeCredentialType: 'githubApi',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'Accept', value: o.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] } };
  if (o.query) { p.sendQuery = true; p.queryParameters = { parameters: o.query.map(function (q) { return { name: q[0], value: q[1] }; }) }; }
  if (o.cuerpo) { p.sendBody = true; p.contentType = 'json'; p.specifyBody = 'json'; p.jsonBody = o.cuerpo; }
  p.options = { timeout: 30000, response: { response: { fullResponse: true, neverError: true, responseFormat: o.raw ? 'text' : 'json' } } };
  return W.nodo(name, 'httpRequest', 4.5, pos, p, { credentials: CRED_GITHUB, onError: 'continueRegularOutput' });
}
function ejecutar(W, name, destino, pos) {
  return W.nodo(name, 'executeWorkflow', 1.3, pos, { source: 'database', workflowId: { __rl: true, mode: 'id', value: destino },
    workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
    mode: 'once', options: { waitForSubWorkflow: true } }, { onError: 'continueRegularOutput', alwaysOutputData: true });
}
const COMUNES = { executionOrder: 'v1', timezone: 'America/Lima', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', errorWorkflow: ID.WF9 };
const X = function (c) { return c * 240; };

// =====================================================================================================
// WF0 Setup
// =====================================================================================================
function wf0() {
  const W = workflow(ID.WF0, 'PB WF0 Setup', Object.assign({}, COMUNES, { saveManualExecutions: false }), 'wf0.js');
  W.nota('## WF0 · Setup (manual)\nEjecútalo **una vez al instalar** y **cada vez que cambies AUTORIZADOS**.\n\n1. Crea las 5 Data Tables (si ya existen, no las toca).\n2. Inserta en `pb_config` solo las claves que faltan (nunca pisa lo editado).\n3. Con token válido: `getMe`, quita el webhook, publica los comandos de cada rol y la descripción del bot.\n\n**Primera vez:** corre → pega el token en `pb_config.BOT_TOKEN` (Data Tables) y en la credencial "Telegram Palmera Brava" → corre otra vez.', [X(0) - 40, -420], 560, 300, 4);
  W.nodo('Ejecutar setup', 'manualTrigger', 1, [X(0), 0], {});
  W.nota('### 1 · Tablas\n`createIfNotExists`: crear o reutilizar por nombre (prefijo `pb_`, ninguno contiene a otro).', [X(1) - 40, -160], 1220, 320, 7);
  dtCrear(W, 'Crear pb_config', 'pb_config', [X(1), 0]);
  dtCrear(W, 'Crear pb_locks', 'pb_locks', [X(2), 0]);
  dtCrear(W, 'Crear pb_inbox', 'pb_inbox', [X(3), 0]);
  dtCrear(W, 'Crear pb_borradores', 'pb_borradores', [X(4), 0]);
  dtCrear(W, 'Crear pb_imagenes', 'pb_imagenes', [X(5), 0]);
  W.cadena('Ejecutar setup', 'Crear pb_config', 'Crear pb_locks', 'Crear pb_inbox', 'Crear pb_borradores', 'Crear pb_imagenes');
  W.nota('### 2 · Valores por defecto\nSolo inserta lo que falta: `AUTORIZADOS` con ids 0 (nadie autorizado todavía), repo, rama, pausa, tiempos y URLs locales de Ollama y sd-server.', [X(6) - 40, -260], 1220, 640, 5);
  dtLeer(W, 'Leer config inicial', 'pb_config', [], [X(6), 0]);
  W.code('Claves por defecto', [X(7), 0]);
  si(W, '¿Faltan claves?', '={{ $json.nada !== true }}', [X(8), 0]);
  dtInsertar(W, 'Insertar claves', 'pb_config', [X(9), -140]);
  dtLeer(W, 'Leer locks', 'pb_locks', [], [X(9), 120]);
  W.code('Lock por defecto', [X(10), 120]);
  si(W, '¿Falta lock?', '={{ $json.nada !== true }}', [X(11), 120]);
  dtInsertar(W, 'Insertar lock', 'pb_locks', [X(12), 0]);
  W.cadena('Crear pb_imagenes', 'Leer config inicial', 'Claves por defecto', '¿Faltan claves?');
  W.con('¿Faltan claves?', 'Insertar claves', 0); W.con('¿Faltan claves?', 'Leer locks', 1); W.con('Insertar claves', 'Leer locks');
  W.cadena('Leer locks', 'Lock por defecto', '¿Falta lock?');
  W.con('¿Falta lock?', 'Insertar lock', 0);
  W.nota('### 3 · Bot de Telegram\nSin token: termina y dice qué hacer. Con token: `deleteWebhook` (getUpdates no convive con webhook), `deleteMyCommands` en el ámbito general (los extraños no ven comandos) y `setMyCommands` **por chat** según el rol (marketing no ve /borrar, /whatsapp, /limpiar_muestras, /deshacer, /pausa).\n\n**Alta de usuarios:** la persona escribe /start → su id aparece en `desconocidos_recientes` → cópialo a `AUTORIZADOS` → vuelve a ejecutar.', [X(12) - 40, 280], 1700, 520, 6);
  dtLeer(W, 'Leer config', 'pb_config', [], [X(13), 400]);
  W.code('Config', [X(14), 400]);
  si(W, '¿Hay token?', '={{ $json.hayToken === true }}', [X(15), 400]);
  W.code('Falta token', [X(16), 620]);
  telegramGet(W, 'getMe', 'getMe', null, [X(16), 400]);
  W.nodo('deleteWebhook', 'httpRequest', 4.5, [X(17), 400], { method: 'POST', url: '=https://api.telegram.org/bot{{ ' + TOKEN + ' }}/deleteWebhook',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '{"drop_pending_updates": false}',
    options: { timeout: 20000, response: { response: { neverError: true, responseFormat: 'json' } } } }, { onError: 'continueRegularOutput' });
  W.code('Comandos por rol', [X(18), 400]);
  telegram(W, 'Configurar bot', [X(19), 400]);
  W.code('Resumen', [X(20), 400]);
  W.con('Insertar lock', 'Leer config'); W.con('¿Falta lock?', 'Leer config', 1);
  W.cadena('Leer config', 'Config', '¿Hay token?');
  W.con('¿Hay token?', 'getMe', 0); W.con('¿Hay token?', 'Falta token', 1);
  W.cadena('getMe', 'deleteWebhook', 'Comandos por rol', 'Configurar bot', 'Resumen');
  return W.fin();
}

// =====================================================================================================
// WF1 Ingesta
// =====================================================================================================
function wf1() {
  const W = workflow(ID.WF1, 'PB WF1 Ingesta', Object.assign({}, COMUNES, { saveDataErrorExecution: 'none', saveManualExecutions: false, executionTimeout: 60 }), 'wf1.js');
  W.nota('## WF1 · Ingesta (cada 10 s)\nLee Telegram con **getUpdates** (sin webhook: la PC no necesita IP pública), guarda cada mensaje en `pb_inbox` y **recién después** confirma (ACK). No procesa nada: eso lo hace WF2.\n\nNo guarda ejecuciones (ni exitosas ni fallidas): los mensajes y el token no quedan en el historial.', [X(0) - 40, -560], 620, 280, 4);
  W.nota('### 1 · Disparador\nSchedule 10 s; ticks perdidos no se acumulan. Sin `BOT_TOKEN` válido termina en silencio.', [X(0) - 40, -240], 700, 420, 7);
  W.nodo('Cada 10 s', 'scheduleTrigger', 1.4, [X(0), 0], { rule: { interval: [{ field: 'seconds', secondsInterval: 10 }] } });
  dtLeer(W, 'Leer config', 'pb_config', [], [X(1), 0]);
  W.code('Config', [X(2), 0]);
  W.nota('### 2 · Capturar\n`getUpdates?timeout=0&limit=20` solo `message` y `callback_query`. **Filtro D2:** chat privado y `from.id` en AUTORIZADOS. Extraños: silencio (se anotan en `DESCONOCIDOS`). Foto = la más grande; álbum = `media_group_id`.', [X(3) - 40, -240], 700, 420, 5);
  W.nodo('Leer Telegram', 'httpRequest', 4.5, [X(3), 0], { method: 'GET', url: '=https://api.telegram.org/bot{{ $json.BOT_TOKEN }}/getUpdates',
    sendQuery: true, queryParameters: { parameters: [{ name: 'timeout', value: '0' }, { name: 'limit', value: '20' }, { name: 'allowed_updates', value: '["message","callback_query"]' }] },
    options: { timeout: 20000, response: { response: { responseFormat: 'json' } } } }, { onError: 'continueErrorOutput' });
  W.code('Normalizar', [X(4), 0]);
  W.nota('### 3 · Guardar (idempotente)\nSe insertan solo los `update_id` que no están ya en `pb_inbox`. **Sin continueOnFail:** si la inserción falla no hay ACK y Telegram los vuelve a entregar.', [X(5) - 40, -340], 940, 520, 6);
  si(W, '¿Hay filas?', '={{ $json.filas.length > 0 }}', [X(5), 0]);
  dtLeer(W, 'Ya en inbox', 'pb_inbox', [['update_id', 'gte', '={{ $json.minUpdateId }}'], ['update_id', 'lte', '={{ $json.maxFilaId }}']], [X(6), -120]);
  W.code('Solo nuevos', [X(7), -120]);
  si(W, '¿Insertar?', '={{ $json.noop !== true }}', [X(8), -120]);
  W.nodo('Insertar inbox', 'dataTable', 1.1, [X(9), -220], {
    resource: 'row', operation: 'insert', dataTableId: rl('pb_inbox'),
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: esquema('pb_inbox', TABLAS.pb_inbox.map(function (c) { return c[0]; })), attemptToConvertTypes: false, convertFieldsToString: false },
    options: {} });
  W.nota('### 4 · Confirmar y avisar\nACK con `offset = max+1`. Luego: `ULTIMO_POLL_AT`, respuesta inmediata a los botones ("Recibido…"), "Recibido, preparo el borrador" y "Volví" si la PC estuvo apagada > 5 min.', [X(10) - 40, -240], 1660, 420, 7);
  W.code('Preparar ACK', [X(10), 0]);
  si(W, '¿ACK?', '={{ $json.ack === true }}', [X(11), 0]);
  telegramGet(W, 'ACK getUpdates', 'getUpdates', [['offset', '={{ $json.offset }}'], ['limit', '1'], ['timeout', '0'], ['allowed_updates', '["message","callback_query"]']], [X(12), -100]);
  W.code('Estado poll', [X(13), 0]);
  dtActualizar(W, 'Guardar config', 'pb_config', [['clave', 'eq', '={{ $json.clave }}']], { valor: '={{ $json.valor }}' }, [X(14), 0]);
  W.code('Avisos', [X(15), 0]);
  telegram(W, 'Enviar Telegram', [X(16), 0]);
  W.nota('### Fallo de lectura\nSin internet, token revocado o webhook activo. Cuenta `FALLOS_SEGUIDOS`; a los 30 seguidos (≈5 min) avisa al admin, máximo 1 vez por hora.', [X(4) - 40, 260], 940, 300, 3);
  W.code('Fallo', [X(4), 380]);
  dtActualizar(W, 'Guardar fallo', 'pb_config', [['clave', 'eq', '={{ $json.clave }}']], { valor: '={{ $json.valor }}' }, [X(5), 380]);
  W.code('Alerta fallo', [X(6), 380]);
  telegram(W, 'Enviar alerta', [X(7), 380]);
  W.cadena('Cada 10 s', 'Leer config', 'Config', 'Leer Telegram');
  W.con('Leer Telegram', 'Normalizar', 0); W.con('Leer Telegram', 'Fallo', 1);
  W.cadena('Normalizar', '¿Hay filas?');
  W.con('¿Hay filas?', 'Ya en inbox', 0); W.con('¿Hay filas?', 'Preparar ACK', 1);
  W.cadena('Ya en inbox', 'Solo nuevos', '¿Insertar?');
  W.con('¿Insertar?', 'Insertar inbox', 0); W.con('¿Insertar?', 'Preparar ACK', 1);
  W.con('Insertar inbox', 'Preparar ACK');
  W.cadena('Preparar ACK', '¿ACK?');
  W.con('¿ACK?', 'ACK getUpdates', 0); W.con('¿ACK?', 'Estado poll', 1);
  W.cadena('ACK getUpdates', 'Estado poll', 'Guardar config', 'Avisos', 'Enviar Telegram');
  W.cadena('Fallo', 'Guardar fallo', 'Alerta fallo', 'Enviar alerta');
  return W.fin();
}

// =====================================================================================================
// WF2 Worker
// =====================================================================================================
function wf2() {
  const W = workflow(ID.WF2, 'PB WF2 Worker', Object.assign({}, COMUNES, { executionTimeout: 840 }), 'wf2.js');
  W.nota('## WF2 · Worker (cada 10 s)\nToma el lock `worker` (lease 15 min, lo comparte con el panel WF8: GPU y GitHub nunca en paralelo), procesa **un** trabajo de `pb_inbox`, lo marca y, si toca, publica el lote con WF5. Siempre libera el lock al final (si muere, WF9 lo libera).', [X(0) - 40, -600], 640, 280, 4);
  W.nota('### 1 · Lock\n`UPDATE pb_locks SET holder=<ejecución> WHERE nombre=worker AND hasta < ahora` (atómico). Si no lo obtiene, termina.', [X(0) - 40, -280], 1180, 460, 7);
  W.nodo('Cada 10 s', 'scheduleTrigger', 1.4, [X(0), 0], { rule: { interval: [{ field: 'seconds', secondsInterval: 10 }] } });
  dtLeer(W, 'Leer config', 'pb_config', [], [X(1), 0]);
  W.code('Config', [X(2), 0]);
  dtActualizar(W, 'Tomar lock', 'pb_locks', [['nombre', 'eq', 'worker'], ['hasta', 'lt', '={{ Date.now() }}']],
    { holder: '={{ $execution.id }}', hasta: '={{ Date.now() + 900000 }}' }, [X(3), 0], { unaVez: true });
  si(W, '¿Lock tomado?', '={{ $json.holder === $execution.id }}', [X(4), 0]);
  W.nota('### 2 · Elegir trabajo\nEl más antiguo en `nuevo`; un álbum entero cuando su última foto tiene ≥ 20 s. **Rol recalculado** desde AUTORIZADOS (revocar = efecto inmediato). Huérfanos en `procesando` (worker muerto) se reintentan hasta 2 veces. "completar" = el autor tiene un borrador con faltantes de < 24 h.', [X(5) - 40, -280], 1660, 460, 5);
  dtLeer(W, 'Leer inbox', 'pb_inbox', [['estado', 'eq', 'nuevo']], [X(5), 0], { limit: 20, orden: 'id', dir: 'ASC' });
  dtLeer(W, 'Leer huerfanos', 'pb_inbox', [['estado', 'eq', 'procesando'], ['intentos', 'lt', 2]], [X(6), 0], { limit: 5, orden: 'id', dir: 'ASC' });
  W.code('Elegir', [X(7), 0]);
  dtLeer(W, 'Pendientes del autor', 'pb_borradores', [['owner_id', 'eq', '={{ $json.hay ? $json.trabajo.from_id : -1 }}'], ['estado', 'eq', 'pendiente']], [X(8), 0]);
  W.code('Preparar trabajo', [X(9), 0]);
  W.code('Por mensaje', [X(10), 0]);
  dtActualizar(W, 'Marcar procesando', 'pb_inbox', [['update_id', 'eq', '={{ $json.update_id }}'], ['estado', 'eq', '={{ $json.estado_previo }}']],
    { estado: 'procesando', intentos: '={{ $json.intentos }}' }, [X(11), 0]);
  W.code('Reunir', [X(12), 0]);
  W.nota('### 3 · Despacho\n`callback` → WF5 (verifica dueño, vista previa vigente y estado). `comando` → WF4. Foto/texto → WF3 (borrador con IA). Voz/archivo → respuesta fija. Los sub-workflows deben estar **publicados**.', [X(13) - 40, -560], 980, 900, 6);
  segun(W, 'Ruta', '={{ $json.ruta }}', ['callback', 'comando', 'borrador', 'fijo'], [X(13), 0]);
  ejecutar(W, 'WF5 callback', ID.WF5, [X(14), -360]);
  ejecutar(W, 'WF4 Comandos', ID.WF4, [X(14), -180]);
  ejecutar(W, 'WF3 Borrador', ID.WF3, [X(14), 0]);
  W.code('Mensaje fijo', [X(14), 180]);
  telegram(W, 'Enviar fijo', [X(15), 180]);
  W.nota('### 4 · Marcar y publicar\n`hecho`, o `error` con `intentos+1` (vuelve a `nuevo` si < 3; error censurado). Luego, si hay aprobados, no hay `PAUSA` y pasaron ≥ 6 min desde el último commit → WF5 modo lote. Al final **libera el lock**.', [X(16) - 40, -280], 1900, 520, 7);
  W.code('Resultado', [X(16), 0]);
  dtActualizar(W, 'Marcar resultado', 'pb_inbox', [['update_id', 'eq', '={{ $json.update_id }}'], ['estado', 'eq', 'procesando']],
    { estado: '={{ $json.estado }}', intentos: '={{ $json.intentos }}', error: '={{ $json.error }}' }, [X(17), 0]);
  W.code('Aviso de fallo', [X(17), 180]);
  telegram(W, 'Enviar aviso', [X(18), 180]);
  dtLeer(W, 'Leer aprobados', 'pb_borradores', [['estado', 'eq', 'aprobado'], ['estado', 'eq', 'publicando']], [X(18), 0], { limit: 1, match: 'anyCondition' });
  W.code('Decidir lote', [X(19), 0]);
  si(W, '¿Publicar lote?', '={{ $json.lote === true }}', [X(20), 0]);
  ejecutar(W, 'WF5 lote', ID.WF5, [X(21), -120]);
  dtActualizar(W, 'Liberar lock', 'pb_locks', [['nombre', 'eq', 'worker'], ['holder', 'eq', '={{ $execution.id }}']], { holder: '', hasta: 0 }, [X(22), 0], { unaVez: true });
  W.cadena('Cada 10 s', 'Leer config', 'Config', 'Tomar lock', '¿Lock tomado?');
  W.con('¿Lock tomado?', 'Leer inbox', 0);
  W.cadena('Leer inbox', 'Leer huerfanos', 'Elegir', 'Pendientes del autor', 'Preparar trabajo', 'Por mensaje', 'Marcar procesando', 'Reunir', 'Ruta');
  W.con('Ruta', 'WF5 callback', 0); W.con('Ruta', 'WF4 Comandos', 1); W.con('Ruta', 'WF3 Borrador', 2); W.con('Ruta', 'Mensaje fijo', 3); W.con('Ruta', 'Resultado', 4);
  W.con('WF5 callback', 'Resultado'); W.con('WF4 Comandos', 'Resultado'); W.con('WF3 Borrador', 'Resultado');
  W.cadena('Mensaje fijo', 'Enviar fijo', 'Resultado');
  W.cadena('Resultado', 'Marcar resultado', 'Leer aprobados', 'Decidir lote', '¿Publicar lote?');
  W.cadena('Resultado', 'Aviso de fallo', 'Enviar aviso');
  W.con('¿Publicar lote?', 'WF5 lote', 0); W.con('¿Publicar lote?', 'Liberar lock', 1);
  W.con('WF5 lote', 'Liberar lock');
  return W.fin();
}

// =====================================================================================================
// WF5 Publicar
// =====================================================================================================
function wf5() {
  const W = workflow(ID.WF5, 'PB WF5 Publicar', Object.assign({}, COMUNES, { callerPolicy: 'workflowsFromSameOwner' }), 'wf5.js');
  W.nota('## WF5 · Publicar (sub-workflow)\nÚnico que escribe en GitHub. Lo llama WF2 **con el lock tomado**.\n- `modo:"callback"`: botones Publicar / Cancelar / Confirmar / destino de imagen.\n- `modo:"lote"`: cadena D5 con todo lo aprobado → 1 commit.\n- `modo:"historial"`: últimos 5 commits del bot + HEAD (para /historial y /deshacer; `enviar:false` = solo datos).\n\nSalida: `{ok, …}`.', [X(0) - 40, -420], 640, 340, 4);
  W.nodo('Entrada', 'executeWorkflowTrigger', 1.2, [X(0), 0], { inputSource: 'passthrough' });
  dtLeer(W, 'Leer config', 'pb_config', [], [X(1), 0]);
  W.code('Config', [X(2), 0]);
  W.code('Modo', [X(3), 0]);
  segun(W, 'Segun modo', '={{ $json.modo }}', ['callback', 'lote', 'historial'], [X(4), 0]);
  W.code('Salida desconocida', [X(5), 160]);
  W.cadena('Entrada', 'Leer config', 'Config', 'Modo', 'Segun modo');
  W.con('Segun modo', 'Salida desconocida', 3);

  // ---- callback ----
  const yc = -900;
  W.nota('### Callback (D2)\nWF1 ya respondió "Recibido" al botón. Aquí se **verifica**: autor = quien toca, botón de la vista previa vigente, estado `pendiente`, no vencido (24 h) y permiso del rol **actual** (`puede()` de validar.js). Cada transición es `UPDATE … WHERE draft_id AND estado` (0 filas = no hace nada). Doble confirmación para eliminar, limpiar muestras, WhatsApp y deshacer.', [X(5) - 40, yc - 300], 1180, 280, 5);
  W.code('Parsear callback', [X(5), yc]);
  dtLeer(W, 'Leer borrador', 'pb_borradores', [['draft_id', 'eq', '={{ $json.draft_id }}']], [X(6), yc], { limit: 1 });
  W.code('Verificar', [X(7), yc]);
  segun(W, 'Accion', '={{ $json.accion }}', ['alerta', 'cerrar', 'confirmar1', 'aprobar', 'destino'], [X(8), yc]);
  dtActualizar(W, 'Cerrar borrador', 'pb_borradores', [['draft_id', 'eq', '={{ $json.draft_id }}'], ['estado', 'eq', 'pendiente']], { estado: '={{ $json.nuevo_estado }}' }, [X(9), yc - 200]);
  dtActualizar(W, 'Confirmacion 1', 'pb_borradores', [['draft_id', 'eq', '={{ $json.draft_id }}'], ['estado', 'eq', 'pendiente'], ['confirmaciones', 'eq', 0]], { confirmaciones: 1 }, [X(9), yc - 60]);
  dtActualizar(W, 'Aprobar', 'pb_borradores', [['draft_id', 'eq', '={{ $json.draft_id }}'], ['estado', 'eq', 'pendiente'], ['faltantes', 'eq', '[]'], ['confirmaciones', 'eq', '={{ $json.conf_previa }}']],
    { estado: 'aprobado', confirmaciones: '={{ $json.conf_nueva }}' }, [X(9), yc + 80]);
  dtActualizar(W, 'Guardar destino', 'pb_borradores', [['draft_id', 'eq', '={{ $json.draft_id }}'], ['estado', 'eq', 'pendiente']],
    { campos: '={{ $json.campos_nuevos }}', faltantes: '[]', entidad: '={{ $json.entidad_nueva }}', entidad_id: '={{ $json.entidad_id_nuevo }}' }, [X(9), yc + 220]);
  W.code('Respuestas', [X(10), yc]);
  telegram(W, 'Enviar callback', [X(11), yc]);
  W.code('Nuevo preview', [X(12), yc]);
  dtActualizar(W, 'Guardar preview', 'pb_borradores', [['draft_id', 'eq', '={{ $json.draft_id }}'], ['estado', 'eq', 'pendiente']], { preview_message_id: '={{ $json.preview_message_id }}' }, [X(13), yc]);
  W.code('Imagenes cancelado', [X(14), yc]);
  dtBorrar(W, 'Borrar imagenes cancelado', 'pb_imagenes', [['draft_id', 'eq', '={{ $json.draft_id }}']], [X(15), yc]);
  W.code('Salida callback', [X(16), yc]);
  W.con('Segun modo', 'Parsear callback', 0);
  W.cadena('Parsear callback', 'Leer borrador', 'Verificar', 'Accion');
  W.con('Accion', 'Respuestas', 0); W.con('Accion', 'Cerrar borrador', 1); W.con('Accion', 'Confirmacion 1', 2); W.con('Accion', 'Aprobar', 3); W.con('Accion', 'Guardar destino', 4); W.con('Accion', 'Respuestas', 5);
  ['Cerrar borrador', 'Confirmacion 1', 'Aprobar', 'Guardar destino'].forEach(function (n) { W.con(n, 'Respuestas'); });
  W.cadena('Respuestas', 'Enviar callback', 'Nuevo preview', 'Guardar preview', 'Imagenes cancelado', 'Borrar imagenes cancelado', 'Salida callback');

  // ---- historial ----
  const yh = -1500;
  W.nota('### Historial (D17)\n`GET /commits?sha=main&per_page=20` → últimos 5 con autor "Tienda Bot". Devuelve `head_sha`, `head_es_bot` y `parent_sha`: /deshacer solo procede si HEAD es del bot y sigue siendo ese sha al publicar.', [X(5) - 40, yh - 220], 1180, 200, 5);
  github(W, 'GET commits', 'GET', '=https://api.github.com/repos/' + REPO + '/commits', [X(5), yh], { query: [['sha', '=' + RAMA], ['per_page', '20']] });
  W.code('Historial', [X(6), yh]);
  si(W, '¿Enviar historial?', '={{ $json.enviar_mensaje === true }}', [X(7), yh]);
  telegram(W, 'Enviar historial', [X(8), yh - 100]);
  W.code('Salida historial', [X(9), yh]);
  W.con('Segun modo', 'GET commits', 2);
  W.cadena('GET commits', 'Historial', '¿Enviar historial?');
  W.con('¿Enviar historial?', 'Enviar historial', 0); W.con('¿Enviar historial?', 'Salida historial', 1);
  W.con('Enviar historial', 'Salida historial');

  // ---- lote (cadena D5) ----
  const yl = 600;
  W.nota('### Lote · 1 · Tomar\nTodo lo `aprobado` (máx. 20; un /deshacer va solo). Respeta `PAUSA` y ≥ 6 min entre commits. `aprobado → publicando` con `UPDATE … WHERE estado=<previo>`: solo entra lo que esta ejecución tomó. Huérfanos en `publicando` (WF5 murió a mitad) se reintentan contando el intento (3 → `error`). Las imágenes ya vienen en WebP base64 de `pb_imagenes`.', [X(5) - 40, yl - 340], 1420, 520, 7);
  dtLeer(W, 'Leer aprobados', 'pb_borradores', [['estado', 'eq', 'aprobado'], ['estado', 'eq', 'publicando']], [X(5), yl], { limit: 20, orden: 'id', dir: 'ASC', match: 'anyCondition' });
  W.code('Elegir lote', [X(6), yl]);
  si(W, '¿Hay lote?', '={{ $json.nada !== true }}', [X(7), yl]);
  W.code('Sin lote', [X(8), yl + 200]);
  dtActualizar(W, 'Marcar publicando', 'pb_borradores', [['draft_id', 'eq', '={{ $json.draft_id }}'], ['estado', 'eq', '={{ $json.estado_previo }}']],
    { estado: '={{ $json.estado_nuevo }}', intentos: '={{ $json.intentos }}', error: '={{ $json.error }}' }, [X(8), yl]);
  W.code('Tomados', [X(9), yl]);
  dtLeer(W, 'Leer imagenes', 'pb_imagenes', [['draft_id', 'eq', '={{ $json.draft_id }}']], [X(10), yl], { unaVez: false });
  W.nota('### Lote · 2 · Cadena D5 (Git Data API)\n1 `GET ref` → 2 `GET commit` (tree) → 3 `GET contents ?ref=<sha>` → 4 **Aplicar + validar** (salta `draft_id` ya aplicados; `validar()` por borrador y final) → 5 `POST blobs` (imagen: nombre con `sha[0:8]`) → 6 `POST tree` con `base_tree` → 7 `POST commit` (autor "Tienda Bot") → 8 `PATCH ref` `force:false`.\n**422 → espera 2–5 s y reinicia desde GET ref (máx. 3).**', [X(11) - 40, yl - 340], 3640, 760, 6);
  W.code('Intento', [X(11), yl]);
  github(W, 'GET ref', 'GET', '=https://api.github.com/repos/' + REPO + '/git/ref/heads/' + RAMA, [X(12), yl]);
  github(W, 'GET commit', 'GET', '=https://api.github.com/repos/' + REPO + "/git/commits/{{ $json.statusCode === 200 && $json.body && $json.body.object ? $json.body.object.sha : 'invalido' }}", [X(13), yl]);
  W.code('Pedir archivos', [X(14), yl]);
  si(W, '¿Leer archivos?', '={{ $json.fallo !== true }}', [X(15), yl]);
  github(W, 'GET contenidos', 'GET', '=https://api.github.com/repos/' + REPO + '/contents/data/{{ $json.nombre }}.json', [X(16), yl], { raw: true, query: [['ref', '={{ $json.ref }}']] });
  W.code('Aplicar lote', [X(17), yl]);
  segun(W, 'Siguiente paso', '={{ $json.paso }}', ['blobs', 'arbol', 'fin'], [X(18), yl]);
  github(W, 'POST blobs', 'POST', '=https://api.github.com/repos/' + REPO + '/git/blobs', [X(19), yl - 120], { cuerpo: "={{ JSON.stringify({ content: $json.content, encoding: 'base64' }) }}" });
  W.code('Arbol', [X(20), yl]);
  si(W, '¿Arbol ok?', '={{ $json.fallo !== true }}', [X(21), yl]);
  github(W, 'POST tree', 'POST', '=https://api.github.com/repos/' + REPO + '/git/trees', [X(22), yl - 120], { cuerpo: '={{ JSON.stringify({ base_tree: $json.base_tree, tree: $json.tree }) }}' });
  github(W, 'POST commit', 'POST', '=https://api.github.com/repos/' + REPO + '/git/commits', [X(23), yl - 120],
    { cuerpo: "={{ JSON.stringify({ message: $('Arbol').first().json.mensaje, tree: ($json.body && $json.body.sha) || '', parents: [$('Arbol').first().json.head], author: { name: 'Tienda Bot', email: $('Config').first().json.COMMIT_EMAIL } }) }}" });
  github(W, 'PATCH ref', 'PATCH', '=https://api.github.com/repos/' + REPO + '/git/refs/heads/' + RAMA, [X(24), yl - 120],
    { cuerpo: "={{ JSON.stringify({ sha: ($json.body && $json.body.sha) || '', force: false }) }}" });
  W.code('Revisar', [X(25), yl]);
  si(W, '¿Reintentar?', '={{ $json.reintentar === true }}', [X(26), yl]);
  W.nodo('Esperar', 'wait', 1.1, [X(26), yl + 260], { resume: 'timeInterval', amount: '={{ 2 + Math.floor(Math.random() * 4) }}', unit: 'seconds' }, { webhookId: uuid(ID.WF5 + '|webhook|Esperar') });
  W.nota('### Lote · 3 · Cerrar\n`publicando → publicado` (+`commit_sha`, `entidad_id` asignado) o `error`; si falló GitHub vuelve a `aprobado` con `intentos+1` (3 → `error`). Borra sus imágenes de `pb_imagenes`, guarda `ULTIMO_COMMIT_AT` y avisa a cada autor ("Publicado… (commit abc1234)").', [X(27) - 40, yl - 340], 1900, 520, 7);
  W.code('Cierre', [X(27), yl]);
  dtActualizar(W, 'Actualizar borradores', 'pb_borradores', [['draft_id', 'eq', '={{ $json.draft_id }}'], ['estado', 'eq', 'publicando']],
    { estado: '={{ $json.estado }}', commit_sha: '={{ $json.commit_sha }}', error: '={{ $json.error }}', intentos: '={{ $json.intentos }}', entidad_id: '={{ $json.entidad_id }}' }, [X(28), yl]);
  W.code('Imagenes publicadas', [X(29), yl]);
  dtBorrar(W, 'Borrar imagenes', 'pb_imagenes', [['draft_id', 'eq', '={{ $json.draft_id }}']], [X(30), yl]);
  W.code('Hora del commit', [X(31), yl]);
  dtActualizar(W, 'Guardar ULTIMO_COMMIT_AT', 'pb_config', [['clave', 'eq', '={{ $json.clave }}']], { valor: '={{ $json.valor }}' }, [X(32), yl]);
  W.code('Avisos lote', [X(33), yl]);
  telegram(W, 'Enviar lote', [X(34), yl]);
  W.code('Salida lote', [X(35), yl]);
  W.con('Segun modo', 'Leer aprobados', 1);
  W.cadena('Leer aprobados', 'Elegir lote', '¿Hay lote?');
  W.con('¿Hay lote?', 'Marcar publicando', 0); W.con('¿Hay lote?', 'Sin lote', 1);
  W.cadena('Marcar publicando', 'Tomados', 'Leer imagenes', 'Intento', 'GET ref', 'GET commit', 'Pedir archivos', '¿Leer archivos?');
  W.con('¿Leer archivos?', 'GET contenidos', 0); W.con('¿Leer archivos?', 'Revisar', 1);
  W.cadena('GET contenidos', 'Aplicar lote', 'Siguiente paso');
  W.con('Siguiente paso', 'POST blobs', 0); W.con('Siguiente paso', 'Arbol', 1); W.con('Siguiente paso', 'Cierre', 2); W.con('Siguiente paso', 'Cierre', 3);
  W.cadena('POST blobs', 'Arbol', '¿Arbol ok?');
  W.con('¿Arbol ok?', 'POST tree', 0); W.con('¿Arbol ok?', 'Revisar', 1);
  W.cadena('POST tree', 'POST commit', 'PATCH ref', 'Revisar', '¿Reintentar?');
  W.con('¿Reintentar?', 'Esperar', 0); W.con('¿Reintentar?', 'Cierre', 1);
  W.con('Esperar', 'Intento');
  W.cadena('Cierre', 'Actualizar borradores', 'Imagenes publicadas', 'Borrar imagenes', 'Hora del commit', 'Guardar ULTIMO_COMMIT_AT', 'Avisos lote', 'Enviar lote', 'Salida lote');
  return W.fin();
}

// =====================================================================================================
// WF9 Errores
// =====================================================================================================
function wf9() {
  const s = Object.assign({}, COMUNES);
  delete s.errorWorkflow;
  const W = workflow(ID.WF9, 'PB WF9 Errores', s, 'wf9.js');
  W.nota('## WF9 · Errores\nWorkflow de error de todos los demás (`settings.errorWorkflow`).\n1. Resume workflow, nodo y mensaje **censurados** (sin token ni PAT).\n2. Libera el lock `worker` si lo tenía la ejecución que falló.\n3. Avisa a los admin por Telegram, **máximo 1 vez por hora por workflow|nodo** (`pb_config.ALERTAS`).', [X(0) - 40, -360], 640, 300, 4);
  W.nodo('Error Trigger', 'errorTrigger', 1, [X(0), 0], {});
  W.code('Resumir error', [X(1), 0]);
  dtActualizar(W, 'Liberar lock (fallo)', 'pb_locks', [['nombre', 'eq', 'worker'], ['holder', 'eq', '={{ $json.execution_id }}']], { holder: '', hasta: 0 }, [X(2), 0], { unaVez: true });
  dtLeer(W, 'Leer config', 'pb_config', [], [X(3), 0]);
  W.code('Config', [X(4), 0]);
  W.code('Limitar alertas', [X(5), 0]);
  dtActualizar(W, 'Guardar alertas', 'pb_config', [['clave', 'eq', "={{ $json.enviar ? 'ALERTAS' : '__ninguna__' }}"]], { valor: '={{ $json.alertas }}' }, [X(6), 0]);
  W.code('Mensajes', [X(7), 0]);
  telegram(W, 'Enviar alerta', [X(8), 0]);
  W.cadena('Error Trigger', 'Resumir error', 'Liberar lock (fallo)', 'Leer config', 'Config', 'Limitar alertas', 'Guardar alertas', 'Mensajes', 'Enviar alerta');
  return W.fin();
}

// ---------- escribir ----------
const salidas = { 'WF0-setup.json': wf0(), 'WF1-ingesta.json': wf1(), 'WF2-worker.json': wf2(), 'WF5-publicar.json': wf5(), 'WF9-errores.json': wf9() };
fs.mkdirSync(SALIDA, { recursive: true });
for (const f of Object.keys(salidas)) {
  const texto = JSON.stringify(salidas[f], null, 2) + '\n';
  fs.writeFileSync(path.join(SALIDA, f), texto);
  console.log('escrito n8n/workflows/' + f + ' (' + salidas[f].nodes.length + ' nodos, ' + Math.round(texto.length / 1024) + ' KB)');
}
