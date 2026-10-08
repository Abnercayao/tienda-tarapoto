#!/usr/bin/env node
/*
 * n8n/src/chat/construir-wf11.js — Genera n8n/workflows/WF11-chat-vendedor.json (agente vendedor "Vale" de la web).
 *   node n8n/src/chat/construir-wf11.js
 * Mismo patrón que n8n/tools/construir-negocio-b.js. Código de los nodos Code: n8n/src/chat/wf11.js (secciones "//// <Nodo>").
 *   "// @incluir validar.js"      -> bloque "COPIAR A N8N ... FIN" de tools/validar.js (frescura y stock con la misma regla que la web)
 *   "// @incluir comun"           -> n8n/src/nucleo/comun.js (armarConfig, admins, h, enviar)
 *   "// @incluir comun-chat"      -> n8n/src/chat/comun-chat.js (reglas deterministas del chat y las citas)
 *   "// @incluir prompt-vendedor" -> PROMPT_VENDEDOR y PROMPT_APRENDIZAJE desde n8n/prompts/vendedor.md
 * IDs fijos; UUID de nodo derivado de "<wf>|<nombre>". Sin pinData, sin instanceId, sin secretos.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const SRC = __dirname;
const SALIDA = path.join(RAIZ, 'n8n', 'workflows');
const ID = { WF11: 'pbWf11ChatVend00', WF9: 'pbWf09Errores000', WF15: 'pbWf15PedSegui00' };
const CRED_TELEGRAM = { telegramApi: { id: 'pbCredTelegram01', name: 'Telegram Palmera Brava' } };
const ORIGENES_CHAT = 'https://abnercayao.github.io,http://127.0.0.1:8080,http://localhost:8080';
const ARCHIVO = 'WF11-chat-vendedor.json';

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
function prompts() {
  const md = leer(path.join(RAIZ, 'n8n', 'prompts', 'vendedor.md'));
  const bloque = function (titulo, marcas) {
    const m = new RegExp('^## ' + titulo + '[^\\n]*\\n+```text\\n([\\s\\S]*?)\\n```', 'm').exec(md);
    if (!m) throw new Error('n8n/prompts/vendedor.md: falta la sección "## ' + titulo + '" con un bloque ```text');
    (marcas || []).forEach(function (k) { if (m[1].indexOf('{{' + k + '}}') < 0) throw new Error('n8n/prompts/vendedor.md (' + titulo + '): falta el marcador {{' + k + '}}'); });
    return m[1];
  };
  const v = bloque('Vendedor', ['TIENDA', 'WHATSAPP', 'CATALOGO', 'APRENDIZAJE', 'FECHA', 'CALENDARIO', 'OCUPADOS', 'CITA', 'PAGINA']);
  const a = bloque('Aprendizaje');
  return '// Prompts de n8n/prompts/vendedor.md (generado; no editar aquí).\nconst PROMPT_VENDEDOR = ' + JSON.stringify(v) + ';\nconst PROMPT_APRENDIZAJE = ' + JSON.stringify(a) + ';';
}
const INCLUSIONES = {
  'validar.js': bloqueValidar(),
  comun: leer(path.join(RAIZ, 'n8n', 'src', 'nucleo', 'comun.js')).trim(),
  'comun-chat': leer(path.join(SRC, 'comun-chat.js')).trim(),
  'prompt-vendedor': prompts()
};
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

// ---------- tablas del chat (las crea el propio WF11 con createIfNotExists; pb_config la crea WF0) ----------
const TABLAS = {
  pb_config: [['clave', 'string'], ['valor', 'string']],
  pb_citas: [['cita_id', 'string'], ['sesion', 'string'], ['nombre', 'string'], ['negocio', 'string'], ['rubro', 'string'], ['correo', 'string'],
    ['telefono', 'string'], ['fecha', 'string'], ['hora', 'string'], ['inicio_ms', 'number'], ['fin_ms', 'number'], ['modalidad', 'string'],
    ['notas', 'string'], ['estado', 'string'], ['resumen', 'string'], ['aviso_telegram', 'string'], ['ip_hash', 'string'], ['creada_ms', 'number']],
  pb_chat_mensajes: [['sesion', 'string'], ['rol', 'string'], ['texto', 'string'], ['intencion', 'string'], ['ip_hash', 'string'], ['fecha_ms', 'number'],
    ['turno', 'number'], ['cita_json', 'string'], ['pagina', 'string'], ['error', 'string'], ['ms_ia', 'number']],
  pb_chat_aprendizaje: [['clave', 'string'], ['tipo', 'string'], ['texto', 'string'], ['frecuencia', 'number'], ['activo', 'boolean'], ['origen', 'string'],
    ['ultima_sesion', 'string'], ['ultima_vez', 'number'], ['creado_ms', 'number']]
};

// ---------- constructor ----------
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
    columns: { column: TABLAS[tabla].map(function (c) { return { name: c[0], type: c[1] }; }) }, options: { createIfNotExists: true } }, { executeOnce: true });
}
function dtLeer(W, name, tabla, conds, pos, o) {
  o = o || {};
  const p = { resource: 'row', operation: 'get', dataTableId: rl(tabla), matchType: 'allConditions', filters: filtros(conds), returnAll: !o.limit };
  if (o.limit) p.limit = o.limit;
  if (o.orden) { p.orderBy = true; p.orderByColumn = o.orden; p.orderByDirection = o.dir || 'ASC'; }
  return W.nodo(name, 'dataTable', 1.1, pos, p, { alwaysOutputData: true, executeOnce: true });
}
function dtActualizar(W, name, tabla, conds, valores, pos) {
  if (!conds.length) throw new Error(name + ': update sin filtros');
  return W.nodo(name, 'dataTable', 1.1, pos, { resource: 'row', operation: 'update', dataTableId: rl(tabla), matchType: 'allConditions', filters: filtros(conds),
    columns: { mappingMode: 'defineBelow', value: valores, matchingColumns: [], schema: esquema(tabla, Object.keys(valores)), attemptToConvertTypes: false, convertFieldsToString: false },
    options: {} }, { alwaysOutputData: true, executeOnce: true, onError: 'continueRegularOutput' });
}
function dtInsertar(W, name, tabla, pos, extra) {
  return W.nodo(name, 'dataTable', 1.1, pos, { resource: 'row', operation: 'insert', dataTableId: rl(tabla),
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: esquema(tabla, TABLAS[tabla].map(function (c) { return c[0]; })), attemptToConvertTypes: false, convertFieldsToString: false },
    options: {} }, extra);
}
function dtUpsert(W, name, tabla, clave, pos) {
  const valores = {};
  TABLAS[tabla].forEach(function (c) { valores[c[0]] = '={{ $json.' + c[0] + ' }}'; });
  return W.nodo(name, 'dataTable', 1.1, pos, { resource: 'row', operation: 'upsert', dataTableId: rl(tabla), matchType: 'allConditions',
    filters: filtros([[clave, 'eq', '={{ $json.' + clave + ' }}']]),
    columns: { mappingMode: 'defineBelow', value: valores, matchingColumns: [], schema: esquema(tabla, Object.keys(valores)), attemptToConvertTypes: false, convertFieldsToString: false },
    options: {} }, { onError: 'continueRegularOutput' });
}
function si(W, name, expr, pos) {
  return W.nodo(name, 'if', 2.3, pos, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
    conditions: [{ id: uuid('cond|' + W.wf.id + '|' + name), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
  looseTypeValidation: false, options: {} });
}
function http(W, name, metodo, url, cuerpo, timeout, pos) {
  const p = { method: metodo, url: url, options: { timeout: timeout, response: { response: { fullResponse: false, neverError: true, responseFormat: 'json' } } } };
  if (cuerpo) Object.assign(p, { sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: cuerpo });
  return W.nodo(name, 'httpRequest', 4.5, pos, p, { onError: 'continueRegularOutput', executeOnce: true });
}
function ejecutar(W, name, destino, pos) {
  return W.nodo(name, 'executeWorkflow', 1.3, pos, { source: 'database', workflowId: { __rl: true, mode: 'id', value: destino },
    workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
    mode: 'once', options: { waitForSubWorkflow: true } }, { onError: 'continueRegularOutput', alwaysOutputData: true });
}
const COMUNES = { executionOrder: 'v1', timezone: 'America/Lima', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', errorWorkflow: ID.WF9 };
const X = function (c) { return c * 240; };

// =====================================================================================================
// WF11 Chat-Vendedor (webhook POST /webhook/chat-tienda; lo llama tools/chat-proxy.py)
// =====================================================================================================
function wf11() {
  // Ollama del chat 45 s (la web espera 60 s) + aprendizaje 90 s + Telegram: 5 min como techo.
  const W = workflow(ID.WF11, 'PB WF11 Chat-Vendedor', Object.assign({}, COMUNES, { executionTimeout: 300 }), 'wf11.js');
  const CFG = "$('Config').first().json";
  W.nota('## WF11 · Chat-Vendedor ("Vale", web)\n`POST /webhook/chat-tienda` **sin clave**: solo escucha en 127.0.0.1 y lo llama `tools/chat-proxy.py` (túnel Cloudflare). Allowed Origins `' + ORIGENES_CHAT + '`.\nCuerpo `{sessionId, mensaje, pagina}` → `{respuesta, escribiendo_ms, cita?, accion?, pedido?}`. 400 = pedido inválido, 429 = límite (20/sesión y 40/IP en 10 min).\n1. Tablas propias (`createIfNotExists`): `pb_citas`, `pb_chat_mensajes`, `pb_chat_aprendizaje`.\n2. Historial (12), notas aprendidas, citas ocupadas y catálogo de la web (caché 10 min).\n3. Ollama `llama3.1:8b` con esquema JSON (45 s; si falla: respaldo con WhatsApp).\n4. **Reglas fijas** (`Interpretar`): valida datos, muestra resumen y agenda solo tras el "sí".\n5. Responde y DESPUÉS: aprendizaje (cada 6 mensajes o al agendar) y aviso a los admins por Telegram (mensaje + `.ics`).\nDetalle: `docs/CHAT-VENDEDOR.md`.', [X(0) - 40, -1000], 980, 460, 4);
  W.nodo('POST chat-tienda', 'webhook', 2.1, [X(0), 0], { httpMethod: 'POST', path: 'chat-tienda', responseMode: 'responseNode', options: { allowedOrigins: ORIGENES_CHAT } },
    { webhookId: uuid('webhook|' + ID.WF11 + '|chat-tienda') });
  W.code('Validar', [X(1), 0]);
  si(W, '¿Válido?', '={{ $json.valido === true }}', [X(2), 0]);
  W.nota('### 1 · Tablas y contexto\nLas 3 tablas se crean solas la primera vez (`createIfNotExists`). Límites con `pb_chat_mensajes` (últimos 10 min). El estado de la cita viaja en `cita_json` de la última fila del asistente. Catálogo: `products.json` y `site.json` de la web publicada (datos estáticos del workflow, 10 min).', [X(3) - 40, -320], 2440, 500, 7);
  dtCrear(W, 'Crear pb_citas', 'pb_citas', [X(3), 0]);
  dtCrear(W, 'Crear pb_chat_mensajes', 'pb_chat_mensajes', [X(4), 0]);
  dtCrear(W, 'Crear pb_chat_aprendizaje', 'pb_chat_aprendizaje', [X(5), 0]);
  dtLeer(W, 'Leer config', 'pb_config', [], [X(6), 0]);
  W.code('Config', [X(7), 0]);
  dtLeer(W, 'Recientes', 'pb_chat_mensajes', [['fecha_ms', 'gt', '={{ Date.now() - 600000 }}'], ['rol', 'eq', 'usuario']], [X(8), 0], { limit: 1000 });
  dtLeer(W, 'Historial', 'pb_chat_mensajes', [['sesion', 'eq', "={{ $('Validar').first().json.sesion }}"]], [X(9), 0], { limit: 12, orden: 'id', dir: 'DESC' });
  dtLeer(W, 'Aprendizaje', 'pb_chat_aprendizaje', [], [X(10), 0], { limit: 500, orden: 'frecuencia', dir: 'DESC' });
  dtLeer(W, 'Citas', 'pb_citas', [['inicio_ms', 'gt', '={{ Date.now() - 3600000 }}'], ['estado', 'eq', 'confirmada']], [X(11), 0]);
  W.code('Catálogo', [X(12), 0]);
  W.code('Preparar', [X(13), 0]);
  si(W, '¿Llamar IA?', '={{ $json.llamar_ia === true }}', [X(14), 0]);
  W.nota('### v3 · Seguimiento de pedido (sin IA)\n"Hacer seguimiento de mi pedido", "¿dónde está mi pedido?", "PB-000123"… → con número y correo llama a **WF15** (sub-workflow, debe estar publicado) y responde el estado con la vista pública (sin datos personales). Si falta un dato, lo pide y devuelve `accion: "formulario_seguimiento"` (la web muestra el formulario dentro del chat).', [X(15) - 40, 560], 1700, 420, 5);
  si(W, '¿Seguimiento?', '={{ $json.seguimiento === true }}', [X(15), 720]);
  si(W, '¿Consultar pedido?', '={{ $json.consultar === true }}', [X(16), 720]);
  ejecutar(W, 'WF15 Seguimiento', ID.WF15, [X(17), 640]);
  W.code('Respuesta seguimiento', [X(18), 760]);
  W.code('Filas seguimiento', [X(19), 760]);
  dtInsertar(W, 'Guardar seguimiento', 'pb_chat_mensajes', [X(20), 760], { onError: 'continueRegularOutput' });
  W.code('Cuerpo seguimiento', [X(21), 760]);
  W.nota('### 2 · IA y reglas fijas\nOllama `/api/chat` (`format` = esquema JSON, `num_ctx 8192`, `temperature 0.6`, `keep_alive 10m`, 45 s). `Interpretar`: honestidad (si preguntan, es IA), solo enlaces de wa.me y del sitio, datos de la cita validados; la cita se guarda solo tras el resumen y el "sí". `Revisar citas` vuelve a mirar choques y el tope de 2 citas futuras por contacto justo antes de guardar.', [X(15) - 40, -320], 1900, 500, 6);
  http(W, 'Ollama', 'POST', '={{ ' + CFG + '.OLLAMA_URL }}/api/chat', '={{ JSON.stringify($json.cuerpo) }}', 45000, [X(15), 0]);
  W.code('Interpretar', [X(16), 0]);
  si(W, '¿Agendar?', '={{ $json.agendar === true }}', [X(17), 0]);
  dtLeer(W, 'Revisar citas', 'pb_citas', [['inicio_ms', 'gt', '={{ Date.now() - 3600000 }}'], ['estado', 'eq', 'confirmada']], [X(18), -160]);
  W.code('Confirmar cita', [X(19), -160]);
  si(W, '¿Guardar cita?', '={{ $json.insertar === true }}', [X(20), -160]);
  W.code('Fila cita', [X(21), -260]);
  dtInsertar(W, 'Insertar cita', 'pb_citas', [X(22), -260], { onError: 'continueRegularOutput' });
  W.code('Filas chat', [X(23), 0]);
  dtInsertar(W, 'Guardar mensajes', 'pb_chat_mensajes', [X(24), 0]);
  W.code('Respuesta', [X(25), 0]);
  W.nodo('Responder', 'respondToWebhook', 1.5, [X(26), 0], { respondWith: 'json', responseBody: '={{ JSON.stringify($json.cuerpo) }}',
    options: { responseCode: '={{ $json.status }}', responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } } });
  W.nota('### 3 · Después de responder\nNo demora al visitante. Cada 6 mensajes de una sesión o al agendar: 2.ª llamada a la IA → resumen + preguntas, objeciones y datos útiles (filtrados: sin datos personales ni instrucciones) → upsert en `pb_chat_aprendizaje` (frecuencia +1 por conversación). Al agendar: mensaje a cada admin (token de `pb_config`) y `.ics` con el nodo Telegram (credencial **Telegram Palmera Brava**) → `pb_citas.aviso_telegram`.', [X(27) - 40, -420], 2200, 900, 5);
  si(W, '¿Después?', '={{ $json.aprender === true || $json.agendada === true }}', [X(27), 0]);
  W.code('Pedir aprendizaje', [X(28), 0]);
  http(W, 'Ollama aprendizaje', 'POST', '={{ ' + CFG + '.OLLAMA_URL }}/api/chat', '={{ JSON.stringify($json.cuerpo) }}', 90000, [X(29), 0]);
  W.code('Procesar aprendizaje', [X(30), 0]);
  si(W, '¿Avisar cita?', '={{ $json.agendada === true }}', [X(31), -200]);
  W.code('Aviso cita', [X(32), -280]);
  W.nodo('Enviar aviso', 'httpRequest', 4.5, [X(33), -280], { method: 'POST', url: '={{ ' + CFG + '.TELEGRAM_API_URL }}/bot{{ ' + CFG + '.BOT_TOKEN }}/{{ $json.metodo }}',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.cuerpo) }}',
    options: { timeout: 20000, response: { response: { neverError: true, responseFormat: 'json' } } } }, { onError: 'continueRegularOutput' });
  W.code('Archivo ICS', [X(34), -280]);
  W.nodo('Enviar ICS', 'telegram', 1.2, [X(35), -280], { resource: 'message', operation: 'sendDocument', chatId: '={{ $json.chat_id }}', binaryData: true,
    binaryPropertyName: 'data', additionalFields: { caption: '={{ $json.caption }}', parse_mode: 'HTML' } }, { credentials: CRED_TELEGRAM, onError: 'continueRegularOutput' });
  W.code('Resultado aviso', [X(36), -280]);
  dtActualizar(W, 'Marcar aviso', 'pb_citas', [['cita_id', 'eq', '={{ $json.cita_id }}']], { aviso_telegram: '={{ $json.aviso_telegram }}', resumen: '={{ $json.resumen }}' }, [X(37), -280]);
  W.code('Filas aprendizaje', [X(31), 200]);
  dtUpsert(W, 'Guardar aprendizaje', 'pb_chat_aprendizaje', 'clave', [X(32), 200]);

  W.cadena('POST chat-tienda', 'Validar', '¿Válido?');
  W.con('¿Válido?', 'Crear pb_citas', 0); W.con('¿Válido?', 'Responder', 1);
  W.cadena('Crear pb_citas', 'Crear pb_chat_mensajes', 'Crear pb_chat_aprendizaje', 'Leer config', 'Config', 'Recientes', 'Historial', 'Aprendizaje', 'Citas', 'Catálogo', 'Preparar', '¿Llamar IA?');
  W.con('¿Llamar IA?', 'Ollama', 0); W.con('¿Llamar IA?', '¿Seguimiento?', 1);
  W.con('¿Seguimiento?', '¿Consultar pedido?', 0); W.con('¿Seguimiento?', 'Responder', 1);
  W.con('¿Consultar pedido?', 'WF15 Seguimiento', 0); W.con('¿Consultar pedido?', 'Respuesta seguimiento', 1);
  W.cadena('WF15 Seguimiento', 'Respuesta seguimiento', 'Filas seguimiento', 'Guardar seguimiento', 'Cuerpo seguimiento', 'Responder');
  W.cadena('Ollama', 'Interpretar', '¿Agendar?');
  W.con('¿Agendar?', 'Revisar citas', 0); W.con('¿Agendar?', 'Filas chat', 1);
  W.cadena('Revisar citas', 'Confirmar cita', '¿Guardar cita?');
  W.con('¿Guardar cita?', 'Fila cita', 0); W.con('¿Guardar cita?', 'Filas chat', 1);
  W.cadena('Fila cita', 'Insertar cita', 'Filas chat', 'Guardar mensajes', 'Respuesta', 'Responder', '¿Después?');
  W.con('¿Después?', 'Pedir aprendizaje', 0);
  W.cadena('Pedir aprendizaje', 'Ollama aprendizaje', 'Procesar aprendizaje');
  W.con('Procesar aprendizaje', '¿Avisar cita?');
  W.con('Procesar aprendizaje', 'Filas aprendizaje');
  W.con('¿Avisar cita?', 'Aviso cita', 0);
  W.cadena('Aviso cita', 'Enviar aviso', 'Archivo ICS', 'Enviar ICS', 'Resultado aviso', 'Marcar aviso');
  W.cadena('Filas aprendizaje', 'Guardar aprendizaje');
  return W.fin();
}

if (require.main === module) {
  const wf = wf11();
  const texto = JSON.stringify(wf, null, 2) + '\n';
  fs.mkdirSync(SALIDA, { recursive: true });
  fs.writeFileSync(path.join(SALIDA, ARCHIVO), texto);
  console.log('escrito n8n/workflows/' + ARCHIVO + ' (' + wf.nodes.length + ' nodos, ' + Math.round(texto.length / 1024) + ' KB)');
}
module.exports = { wf11: wf11, TABLAS: TABLAS, ID: ID, ORIGENES_CHAT: ORIGENES_CHAT,
  // ayudas que reutiliza construir-wf12.js (WF12 Chat-URL)
  workflow: workflow, dtLeer: dtLeer, si: si, uuid: uuid, COMUNES: COMUNES, X: X };
