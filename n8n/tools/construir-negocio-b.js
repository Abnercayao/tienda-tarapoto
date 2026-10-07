#!/usr/bin/env node
/*
 * n8n/tools/construir-negocio-b.js — Genera WF6 (Imagen-IA) y WF8 (Panel-API) en n8n/workflows/.
 *   node n8n/tools/construir-negocio-b.js
 * Mismo patrón que construir-negocio-a.js. Código de los nodos Code: n8n/src/negocio/wf6.js y wf8.js (secciones "//// <Nodo>").
 *   "// @incluir validar.js" -> bloque "COPIAR A N8N ... FIN" de tools/validar.js (A11)
 *   "// @incluir comun"      -> n8n/src/nucleo/comun.js
 * IDs fijos (ARQUITECTURA-N8N.md §3); UUID de nodo derivado de "<wf>|<nombre>". Sin pinData, sin instanceId, sin secretos.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..', '..');
const SRC = path.join(RAIZ, 'n8n', 'src', 'negocio');
const SALIDA = path.join(RAIZ, 'n8n', 'workflows');
const ID = { WF6: 'pbWf06Imagen0000', WF8: 'pbWf08PanelApi00', WF9: 'pbWf09Errores000' };
const CRED_TELEGRAM = { telegramApi: { id: 'pbCredTelegram01', name: 'Telegram Palmera Brava' } };
const CRED_HEADER = { httpHeaderAuth: { id: 'pbCredHeader0001', name: 'Header X-Tienda-Key' } };
const ORIGENES = 'http://localhost:8080,http://127.0.0.1:8080';

// ---------- inclusión de código ----------
const leer = function (f) { return fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); };
function bloqueValidar() {
  const t = leer(path.join(RAIZ, 'tools', 'validar.js'));
  const i = t.indexOf('// === COPIAR A N8N ===');
  const fin = '// === FIN COPIAR A N8N ===';
  const f = t.indexOf(fin);
  if (i < 0 || f < i) throw new Error('No encuentro el bloque COPIAR A N8N en tools/validar.js');
  return t.slice(i, f + fin.length);
}
const INCLUSIONES = { 'validar.js': bloqueValidar(), comun: leer(path.join(RAIZ, 'n8n', 'src', 'nucleo', 'comun.js')).trim() };
function incluir(code) {
  return code.replace(/^\/\/ @incluir (\S+)$/mg, function (linea, k) {
    if (!INCLUSIONES[k]) throw new Error('inclusión desconocida: ' + k);
    return INCLUSIONES[k];
  });
}
function secciones(archivo) {
  const partes = leer(path.join(SRC, archivo)).split(/^\/\/\/\/ (.+)$/m);
  const out = {};
  for (let i = 1; i < partes.length; i += 2) out[partes[i].trim()] = partes[i + 1].trim() + '\n';
  return out;
}
function uuid(semilla) {
  const x = crypto.createHash('sha1').update(semilla).digest('hex');
  return x.slice(0, 8) + '-' + x.slice(8, 12) + '-4' + x.slice(13, 16) + '-' + ((parseInt(x[16], 16) & 3) | 8).toString(16) + x.slice(17, 20) + '-' + x.slice(20, 32);
}

// ---------- columnas (ARQUITECTURA §4; iguales a construir-nucleo.js) ----------
const TABLAS = {
  pb_config: [['clave', 'string'], ['valor', 'string']],
  pb_locks: [['nombre', 'string'], ['holder', 'string'], ['hasta', 'number']],
  pb_inbox: [['estado', 'string']],
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
  const codigo = secciones(archivoCodigo);
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

// ---------- ayudas de parámetros (mismas formas que construir-negocio-a.js, verificadas en ARQUITECTURA §1) ----------
const rl = function (tabla) { return { __rl: true, mode: 'name', value: tabla }; };
const filtros = function (l) { return l.length ? { conditions: l.map(function (c) { return { keyName: c[0], condition: c[1], keyValue: c[2] }; }) } : {}; };
const esquema = function (tabla, cols) {
  return cols.map(function (c) {
    const def = TABLAS[tabla].find(function (x) { return x[0] === c; });
    if (!def) throw new Error('columna ' + c + ' no existe en ' + tabla);
    return { id: c, displayName: c, required: false, defaultMatch: false, display: true, type: def[1], canBeUsedToMatch: true };
  });
};
function dtLeer(W, name, tabla, conds, pos, o) {
  o = o || {};
  const p = { resource: 'row', operation: 'get', dataTableId: rl(tabla), matchType: 'allConditions', filters: filtros(conds), returnAll: !o.limit };
  if (o.limit) p.limit = o.limit;
  return W.nodo(name, 'dataTable', 1.1, pos, p, { alwaysOutputData: true, executeOnce: true });
}
function dtActualizar(W, name, tabla, conds, valores, pos) {
  if (!conds.length) throw new Error(name + ': update sin filtros');
  return W.nodo(name, 'dataTable', 1.1, pos, { resource: 'row', operation: 'update', dataTableId: rl(tabla), matchType: 'allConditions', filters: filtros(conds),
    columns: { mappingMode: 'defineBelow', value: valores, matchingColumns: [], schema: esquema(tabla, Object.keys(valores)), attemptToConvertTypes: false, convertFieldsToString: false },
    options: {} }, { alwaysOutputData: true, executeOnce: true });
}
function dtInsertar(W, name, tabla, pos) {
  return W.nodo(name, 'dataTable', 1.1, pos, { resource: 'row', operation: 'insert', dataTableId: rl(tabla),
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: esquema(tabla, TABLAS[tabla].map(function (c) { return c[0]; })), attemptToConvertTypes: false, convertFieldsToString: false },
    options: {} });
}
function si(W, name, expr, pos) {
  return W.nodo(name, 'if', 2.3, pos, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
    conditions: [{ id: uuid('cond|' + W.wf.id + '|' + name), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
  looseTypeValidation: false, options: {} });
}
const TOKEN = "$('Config').first().json.BOT_TOKEN";
function telegram(W, name, pos) {
  return W.nodo(name, 'httpRequest', 4.5, pos, { method: 'POST', url: '=https://api.telegram.org/bot{{ ' + TOKEN + ' }}/{{ $json.metodo }}',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.cuerpo) }}',
    options: { timeout: 20000, response: { response: { neverError: true, responseFormat: 'json' } } } }, { onError: 'continueRegularOutput' });
}
// HTTP a servicios locales (Ollama, sd-server). base = expresión de la URL base; cuerpo = expresión JSON o null (GET).
function http(W, name, metodo, url, cuerpo, timeout, pos, o) {
  o = o || {};
  const p = { method: metodo, url: url, options: { timeout: timeout, response: { response: { fullResponse: !!o.completa, neverError: true, responseFormat: o.formato || 'json' } } } };
  if (cuerpo) Object.assign(p, { sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: cuerpo });
  const extra = { onError: 'continueRegularOutput' };
  if (o.unaVez) extra.executeOnce = true;
  return W.nodo(name, 'httpRequest', 4.5, pos, p, extra);
}
function ejecutar(W, name, destino, pos) {
  return W.nodo(name, 'executeWorkflow', 1.3, pos, { source: 'database', workflowId: { __rl: true, mode: 'id', value: destino },
    workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
    mode: 'once', options: { waitForSubWorkflow: true } }, { onError: 'continueRegularOutput', alwaysOutputData: true });
}
function webhook(W, name, metodo, ruta, pos) {
  return W.nodo(name, 'webhook', 2.1, pos, { httpMethod: metodo, path: ruta, authentication: 'headerAuth', responseMode: 'responseNode',
    options: { allowedOrigins: ORIGENES } }, { webhookId: uuid('webhook|' + W.wf.id + '|' + ruta), credentials: CRED_HEADER });
}
const COMUNES = { executionOrder: 'v1', timezone: 'America/Lima', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', errorWorkflow: ID.WF9 };
const X = function (c) { return c * 240; };

// =====================================================================================================
// WF6 Imagen-IA (sub-workflow: lo llaman WF4 (/imagen, con el lock de WF2) y WF8 (panel, con su propio lock))
// =====================================================================================================
function wf6() {
  const W = workflow(ID.WF6, 'PB WF6 Imagen-IA', Object.assign({}, COMUNES, { callerPolicy: 'workflowsFromSameOwner' }), 'wf6.js');
  W.nota('## WF6 · Imagen-IA (sub-workflow)\nLo llaman WF4 (`/imagen [art-0001|look-1] descripción`, ya con el lock de WF2) y WF8 (panel, con su lock). **No toma el lock.**\n1. Prompt en inglés con las frases de `tools/image-prompts.json`; **niños = sin personas**; persona adulta = se genera más alta y se **recorta arriba** (sin rostro).\n2. Ollama `keep_alive:0` (libera la VRAM) → sd-server (8 pasos, euler/simple, cfg 1.0; timeout 10 min).\n3. Foto a Telegram con Hero / Portada / Lookbook / Descartar → borrador `pendiente` (falta `destino`) + WebP en `pb_imagenes`.\n**Nunca publica:** WF5 publica tras elegir destino y tocar Publicar.\n\nSalida: `{ok, draft_id, ...}` + binario `data` (y `b64` para el panel).', [X(0) - 40, -900], 760, 420, 4);
  W.nodo('Entrada', 'executeWorkflowTrigger', 1.2, [X(0), 0], { inputSource: 'passthrough' });
  dtLeer(W, 'Leer config', 'pb_config', [], [X(1), 0]);
  W.code('Config', [X(2), 0]);
  W.code('Preparar', [X(3), 0]);
  si(W, '¿Válido?', '={{ $json.valido === true }}', [X(4), 0]);
  si(W, '¿Avisar inicio?', '={{ $json.avisar_inicio === true }}', [X(5), 0]);
  W.code('Aviso generando', [X(6), -200]);
  telegram(W, 'Enviar aviso', [X(7), -200]);
  W.nota('### 1 · GPU\nSe descargan de la VRAM los modelos de Ollama (`/api/ps` → `keep_alive:0` a cada uno) y se pide la imagen a sd-server con parámetros explícitos (`<sd_cpp_extra_args>`: seed, 8 pasos, euler, simple, txt_cfg 1.0; `output_format` webp).', [X(8) - 40, -300], 1180, 480, 6);
  http(W, 'Ollama ps', 'GET', "={{ $('Config').first().json.OLLAMA_URL }}/api/ps", null, 5000, [X(8), 0], { unaVez: true });
  W.code('Modelos a liberar', [X(9), 0]);
  http(W, 'Liberar VRAM', 'POST', "={{ $('Config').first().json.OLLAMA_URL }}/api/generate", '={{ JSON.stringify($json.cuerpo) }}', 30000, [X(10), 0]);
  http(W, 'sd-server', 'POST', "={{ $('Config').first().json.SD_URL }}/v1/images/generations", "={{ JSON.stringify($('Preparar').first().json.cuerpo_sd) }}", 600000, [X(11), 0], { unaVez: true, completa: true });
  W.code('Imagen', [X(12), 0]);
  W.nota('### 2 · Sin rostros\nCon persona adulta se generó más alta (p. ej. 768×1216) y aquí se recorta la parte de **arriba** (gravedad Sur) hasta el tamaño final (768×1024). Si el recorte no sale exacto, la imagen **no se envía**. PNG → WebP con el mismo nodo.', [X(13) - 40, -300], 1180, 480, 5);
  si(W, '¿Imagen ok?', '={{ $json.ok === true }}', [X(13), 0]);
  si(W, '¿Recortar o convertir?', '={{ $json.convertir === true }}', [X(14), 0]);
  W.nodo('Recortar arriba', 'editImage', 1.1, [X(15), -120], { operation: 'crop', dataPropertyName: 'data', width: '={{ $json.crop_ancho }}', height: '={{ $json.crop_alto }}',
    positionX: 0, positionY: '={{ $json.crop_y }}', options: { format: 'webp' } }, { onError: 'continueRegularOutput' });
  W.code('Imagen final', [X(16), 0]);
  si(W, '¿Final ok?', '={{ $json.ok === true }}', [X(17), 0]);
  W.nota('### 3 · Telegram y borrador\n`sendPhoto` (credencial **Telegram Palmera Brava**) con Hero / Portada / Lookbook / Descartar (`dst:<draft>:hero|portada|look`, `no:<draft>`). Su `message_id` es el `preview_message_id`: WF5 solo acepta esos botones, del autor y con el borrador `pendiente`. Panel sin admin/dueño con id → solo devuelve la imagen.', [X(18) - 40, -360], 1660, 540, 7);
  si(W, '¿A Telegram?', "={{ $('Preparar').first().json.chat_id > 0 }}", [X(18), 0]);
  W.nodo('Enviar foto', 'telegram', 1.2, [X(19), -120], {
    resource: 'message', operation: 'sendPhoto', chatId: "={{ $('Preparar').first().json.chat_id }}", binaryData: true, binaryPropertyName: 'data',
    replyMarkup: 'inlineKeyboard',
    inlineKeyboard: { rows: [
      { row: { buttons: [
        { text: 'Hero', additionalFields: { callback_data: "=dst:{{ $('Preparar').first().json.draft_id }}:hero" } },
        { text: 'Portada', additionalFields: { callback_data: "=dst:{{ $('Preparar').first().json.draft_id }}:portada" } },
        { text: 'Lookbook', additionalFields: { callback_data: "=dst:{{ $('Preparar').first().json.draft_id }}:look" } }
      ] } },
      { row: { buttons: [{ text: 'Descartar', additionalFields: { callback_data: "=no:{{ $('Preparar').first().json.draft_id }}" } }] } }
    ] },
    additionalFields: { caption: "={{ $('Preparar').first().json.caption }}", parse_mode: 'HTML' }
  }, { credentials: CRED_TELEGRAM, onError: 'continueRegularOutput' });
  W.code('Foto enviada', [X(20), -120]);
  si(W, '¿Enviada?', '={{ $json.ok === true }}', [X(21), -120]);
  W.code('Fila borrador', [X(22), -240]);
  dtInsertar(W, 'Insertar borrador', 'pb_borradores', [X(23), -240]);
  W.code('Fila imagen', [X(24), -240]);
  dtInsertar(W, 'Insertar imagen', 'pb_imagenes', [X(25), -240]);
  W.nota('### Fallos\nPedido inválido, sd-server caído, recorte fallido o Telegram sin entregar → un mensaje claro (solo si vino de Telegram) y `{ok:false}` sin reintento (cada intento ocupa la GPU ~1 min).', [X(18) - 40, 260], 1660, 400, 3);
  W.code('Error', [X(19), 400]);
  si(W, '¿Avisar error?', '={{ $json.avisar === true }}', [X(20), 400]);
  telegram(W, 'Enviar error', [X(21), 320]);
  W.code('Salida', [X(26), 0]);

  W.cadena('Entrada', 'Leer config', 'Config', 'Preparar', '¿Válido?');
  W.con('¿Válido?', '¿Avisar inicio?', 0); W.con('¿Válido?', 'Error', 1);
  W.con('¿Avisar inicio?', 'Aviso generando', 0); W.con('¿Avisar inicio?', 'Ollama ps', 1);
  W.cadena('Aviso generando', 'Enviar aviso', 'Ollama ps');
  W.cadena('Ollama ps', 'Modelos a liberar', 'Liberar VRAM', 'sd-server', 'Imagen', '¿Imagen ok?');
  W.con('¿Imagen ok?', '¿Recortar o convertir?', 0); W.con('¿Imagen ok?', 'Error', 1);
  W.con('¿Recortar o convertir?', 'Recortar arriba', 0); W.con('¿Recortar o convertir?', 'Imagen final', 1);
  W.cadena('Recortar arriba', 'Imagen final', '¿Final ok?');
  W.con('¿Final ok?', '¿A Telegram?', 0); W.con('¿Final ok?', 'Error', 1);
  W.con('¿A Telegram?', 'Enviar foto', 0); W.con('¿A Telegram?', 'Salida', 1);
  W.cadena('Enviar foto', 'Foto enviada', '¿Enviada?');
  W.con('¿Enviada?', 'Fila borrador', 0); W.con('¿Enviada?', 'Error', 1);
  W.cadena('Fila borrador', 'Insertar borrador', 'Fila imagen', 'Insertar imagen', 'Salida');
  W.cadena('Error', '¿Avisar error?');
  W.con('¿Avisar error?', 'Enviar error', 0); W.con('¿Avisar error?', 'Salida', 1);
  W.con('Enviar error', 'Salida');
  return W.fin();
}

// =====================================================================================================
// WF8 Panel-API (webhooks del panel local admin.html)
// =====================================================================================================
function wf8() {
  // Espera del lock (10 min) + Ollama (30 s) + sd-server (10 min) + Telegram/Data Tables: 23 min como techo.
  const W = workflow(ID.WF8, 'PB WF8 Panel-API', Object.assign({}, COMUNES, { executionTimeout: 1380 }), 'wf8.js');
  W.nota('## WF8 · Panel-API (webhooks de admin.html)\nAmbos con **Header Auth** `X-Tienda-Key` (credencial **Header X-Tienda-Key**; sin clave o con otra → 403) y Allowed Origins `' + ORIGENES + '`. CORS no es autenticación: la clave sí.\n- `POST /webhook/crear-imagen` → espera el lock `worker` (cada 5 s, máx. 10 min; GPU compartida con WF2) → WF6 → **libera el lock** → responde la imagen `image/webp` (cabeceras `X-Draft-Id`, `X-Telegram`, `X-Seed`). Ocupado 10 min → 423.\n- `GET /webhook/estado` → cola, borradores, lock, pausa, último commit, poller y salud de Ollama / sd-server (sin token ni ids).', [X(0) - 40, -980], 900, 400, 4);
  // --- POST crear-imagen ---
  webhook(W, 'POST crear-imagen', 'POST', 'crear-imagen', [X(0), 0]);
  dtLeer(W, 'Leer config', 'pb_config', [], [X(1), 0]);
  W.code('Config', [X(2), 0]);
  W.code('Validar pedido', [X(3), 0]);
  si(W, '¿Pedido válido?', '={{ $json.valido === true }}', [X(4), 0]);
  W.nota('### Lock compartido (GPU y GitHub)\n`UPDATE pb_locks SET holder=<ejecución> WHERE nombre=worker AND hasta < ahora` (atómico, lease 15 min). Si no lo obtiene: Wait 5 s y otra vez, hasta 10 min. WF9 lo libera si esta ejecución falla.', [X(5) - 40, -300], 940, 640, 6);
  dtActualizar(W, 'Tomar lock', 'pb_locks', [['nombre', 'eq', 'worker'], ['hasta', 'lt', '={{ Date.now() }}']],
    { holder: '={{ $execution.id }}', hasta: '={{ Date.now() + 900000 }}' }, [X(5), 0]);
  si(W, '¿Lock tomado?', '={{ $json.holder === $execution.id }}', [X(6), 0]);
  W.code('Esperar turno', [X(7), 200]);
  si(W, '¿Seguir esperando?', '={{ $json.agotado === false }}', [X(8), 200]);
  W.nodo('Esperar 5 s', 'wait', 1.1, [X(8), 0 + 400], { resume: 'timeInterval', amount: 5, unit: 'seconds' }, { webhookId: uuid('wait|' + ID.WF8 + '|lock') });
  W.code('Ocupado', [X(9), 320]);
  W.code('Pedido', [X(7), -160]);
  ejecutar(W, 'WF6 Imagen', ID.WF6, [X(8), -160]);
  dtActualizar(W, 'Liberar lock', 'pb_locks', [['nombre', 'eq', 'worker'], ['holder', 'eq', '={{ $execution.id }}']], { holder: '', hasta: 0 }, [X(9), -160]);
  W.code('Respuesta', [X(10), -160]);
  si(W, '¿Imagen lista?', '={{ $json.ok === true }}', [X(11), -160]);
  W.nodo('Responder imagen', 'respondToWebhook', 1.5, [X(12), -260], { respondWith: 'binary', responseDataSource: 'set', inputFieldName: 'data',
    options: { responseHeaders: { entries: [
      { name: 'X-Draft-Id', value: '={{ $json.draft_id }}' },
      { name: 'X-Telegram', value: '={{ $json.telegram }}' },
      { name: 'X-Seed', value: '={{ $json.seed }}' },
      { name: 'Access-Control-Expose-Headers', value: 'X-Draft-Id, X-Telegram, X-Seed' },
      { name: 'Cache-Control', value: 'no-store' }
    ] } } });
  W.nodo('Responder JSON', 'respondToWebhook', 1.5, [X(12), 120], { respondWith: 'json', responseBody: '={{ JSON.stringify($json.cuerpo) }}',
    options: { responseCode: '={{ $json.status }}', responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } } });
  // --- GET estado ---
  W.nota('### GET /webhook/estado\nSolo lectura: Data Tables + `GET` a Ollama (`/api/version`, `/api/ps`) y sd-server (`/sdcpp/v1/capabilities`), 3 s cada uno.', [X(0) - 40, 560], 2900, 360, 5);
  webhook(W, 'GET estado', 'GET', 'estado', [X(0), 720]);
  dtLeer(W, 'Leer config estado', 'pb_config', [], [X(1), 720]);
  W.code('Config estado', [X(2), 720]);
  dtLeer(W, 'Leer lock', 'pb_locks', [['nombre', 'eq', 'worker']], [X(3), 720], { limit: 1 });
  dtLeer(W, 'Inbox nuevo', 'pb_inbox', [['estado', 'eq', 'nuevo']], [X(4), 720], { limit: 200 });
  dtLeer(W, 'Aprobados', 'pb_borradores', [['estado', 'eq', 'aprobado']], [X(5), 720], { limit: 200 });
  dtLeer(W, 'Pendientes', 'pb_borradores', [['estado', 'eq', 'pendiente']], [X(6), 720], { limit: 200 });
  http(W, 'Ollama version', 'GET', "={{ $('Config estado').first().json.OLLAMA_URL }}/api/version", null, 3000, [X(7), 720], { unaVez: true });
  http(W, 'Ollama ps', 'GET', "={{ $('Config estado').first().json.OLLAMA_URL }}/api/ps", null, 3000, [X(8), 720], { unaVez: true });
  http(W, 'sd-server salud', 'GET', "={{ $('Config estado').first().json.SD_URL }}/sdcpp/v1/capabilities", null, 3000, [X(9), 720], { unaVez: true, completa: true, formato: 'text' });
  W.code('Estado', [X(10), 720]);
  W.nodo('Responder estado', 'respondToWebhook', 1.5, [X(11), 720], { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}',
    options: { responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } } });

  W.cadena('POST crear-imagen', 'Leer config', 'Config', 'Validar pedido', '¿Pedido válido?');
  W.con('¿Pedido válido?', 'Tomar lock', 0); W.con('¿Pedido válido?', 'Responder JSON', 1);
  W.cadena('Tomar lock', '¿Lock tomado?');
  W.con('¿Lock tomado?', 'Pedido', 0); W.con('¿Lock tomado?', 'Esperar turno', 1);
  W.cadena('Esperar turno', '¿Seguir esperando?');
  W.con('¿Seguir esperando?', 'Esperar 5 s', 0); W.con('¿Seguir esperando?', 'Ocupado', 1);
  W.con('Esperar 5 s', 'Tomar lock');
  W.con('Ocupado', 'Responder JSON');
  W.cadena('Pedido', 'WF6 Imagen', 'Liberar lock', 'Respuesta', '¿Imagen lista?');
  W.con('¿Imagen lista?', 'Responder imagen', 0); W.con('¿Imagen lista?', 'Responder JSON', 1);
  W.cadena('GET estado', 'Leer config estado', 'Config estado', 'Leer lock', 'Inbox nuevo', 'Aprobados', 'Pendientes', 'Ollama version', 'Ollama ps', 'sd-server salud', 'Estado', 'Responder estado');
  return W.fin();
}

// ---------- escribir ----------
const salidas = { 'WF6-imagen-ia.json': wf6(), 'WF8-panel-api.json': wf8() };
fs.mkdirSync(SALIDA, { recursive: true });
for (const f of Object.keys(salidas)) {
  const texto = JSON.stringify(salidas[f], null, 2) + '\n';
  fs.writeFileSync(path.join(SALIDA, f), texto);
  console.log('escrito n8n/workflows/' + f + ' (' + salidas[f].nodes.length + ' nodos, ' + Math.round(texto.length / 1024) + ' KB)');
}
