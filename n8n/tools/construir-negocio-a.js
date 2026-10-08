#!/usr/bin/env node
/*
 * n8n/tools/construir-negocio-a.js — Genera WF3 (Borrador-IA) y WF4 (Comandos) en n8n/workflows/.
 *   node n8n/tools/construir-negocio-a.js
 * Mismo patrón que construir-nucleo.js. Código de los nodos Code: n8n/src/negocio/wf3.js y wf4.js (secciones "//// <Nodo>").
 *   "// @incluir validar.js" -> bloque "COPIAR A N8N ... FIN" de tools/validar.js (una sola fuente, A11)
 *   "// @incluir comun"      -> n8n/src/nucleo/comun.js
 *   "// @incluir negocio"    -> n8n/src/negocio/comun-negocio.js (vista previa, plantilla manual, operaciones de comandos)
 *   "// @incluir prompts"    -> PROMPT_EXTRACCION y PROMPT_ARTICULO_N8N desde n8n/prompts/extraccion.md
 * IDs fijos (ARQUITECTURA-N8N.md §3); UUID de nodo derivado de "<wf>|<nombre>". Sin pinData, sin instanceId, sin secretos.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..', '..');
const SRC = path.join(RAIZ, 'n8n', 'src', 'negocio');
const SALIDA = path.join(RAIZ, 'n8n', 'workflows');
const ID = { WF3: 'pbWf03Borrador00', WF4: 'pbWf04Comandos00', WF5: 'pbWf05Publicar00', WF6: 'pbWf06Imagen0000', WF9: 'pbWf09Errores000', WF16: 'pbWf16PedBot0000' };
const CRED_GITHUB = { githubApi: { id: 'pbCredGithub0001', name: 'GitHub Palmera Brava' } };
const CRED_TELEGRAM = { telegramApi: { id: 'pbCredTelegram01', name: 'Telegram Palmera Brava' } };

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
  const md = leer(path.join(RAIZ, 'n8n', 'prompts', 'extraccion.md'));
  const bloque = function (titulo) {
    const m = new RegExp('^## ' + titulo + '[^\\n]*\\n+```text\\n([\\s\\S]*?)\\n```', 'm').exec(md);
    if (!m || m[1].indexOf('{{CATALOGO}}') < 0) throw new Error('n8n/prompts/extraccion.md: falta la sección "## ' + titulo + '" con un bloque ```text que contenga {{CATALOGO}}');
    return m[1];
  };
  const p = { producto: bloque('Producto'), articulo: bloque('Artículo') };
  const v = require(path.join(RAIZ, 'tools', 'validar.js'));
  if (p.producto !== v.PROMPT_PRODUCTO) console.warn('AVISO: el prompt de producto de extraccion.md difiere de PROMPT_PRODUCTO (tools/validar.js); WF3 usa el de extraccion.md.');
  if (p.articulo !== v.PROMPT_ARTICULO) console.warn('AVISO: el prompt de artículo de extraccion.md difiere de PROMPT_ARTICULO (tools/validar.js); WF3 usa el de extraccion.md.');
  return '// Prompts de n8n/prompts/extraccion.md (generado; no editar aquí).\nconst PROMPT_EXTRACCION = ' + JSON.stringify(p.producto) + ';\nconst PROMPT_ARTICULO_N8N = ' + JSON.stringify(p.articulo) + ';';
}
const INCLUSIONES = {
  'validar.js': bloqueValidar(),
  comun: leer(path.join(RAIZ, 'n8n', 'src', 'nucleo', 'comun.js')).trim(),
  negocio: leer(path.join(SRC, 'comun-negocio.js')).trim(),
  prompts: prompts()
};
function incluir(code) {
  return code.replace(/^\/\/ @incluir (\S+)$/mg, function (linea, k) {
    if (!INCLUSIONES[k]) throw new Error('inclusión desconocida: ' + k);
    return INCLUSIONES[k];
  });
}
function secciones(archivo) {
  const t = leer(path.join(SRC, archivo));
  const partes = t.split(/^\/\/\/\/ (.+)$/m);
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

// ---------- ayudas de parámetros (mismas formas que construir-nucleo.js, verificadas en ARQUITECTURA §1) ----------
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
function si(W, name, expr, pos) {
  return W.nodo(name, 'if', 2.3, pos, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
    conditions: [{ id: uuid('cond|' + W.wf.id + '|' + name), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
  looseTypeValidation: false, options: {} });
}
function segun(W, name, expr, claves, pos) {
  return W.nodo(name, 'switch', 3.4, pos, { mode: 'rules', rules: { values: claves.map(function (k) {
    return { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
      conditions: [{ id: uuid('sw|' + W.wf.id + '|' + name + '|' + k), leftValue: expr, rightValue: k, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
    renameOutput: true, outputKey: k };
  }) }, options: { fallbackOutput: 'extra', renameFallbackOutput: 'otro' } });
}
const TOKEN = "$('Config').first().json.BOT_TOKEN";
function telegram(W, name, pos) {
  return W.nodo(name, 'httpRequest', 4.5, pos, { method: 'POST', url: '=https://api.telegram.org/bot{{ ' + TOKEN + ' }}/{{ $json.metodo }}',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.cuerpo) }}',
    options: { timeout: 20000, response: { response: { neverError: true, responseFormat: 'json' } } } }, { onError: 'continueRegularOutput' });
}
const REPO = "{{ $('Config').first().json.REPO }}";
const RAMA = "{{ $('Config').first().json.REPO_BRANCH }}";
function githubRaw(W, name, archivo, pos) {
  return W.nodo(name, 'httpRequest', 4.5, pos, { method: 'GET', url: '=https://api.github.com/repos/' + REPO + '/contents/data/' + archivo,
    authentication: 'predefinedCredentialType', nodeCredentialType: 'githubApi',
    sendQuery: true, queryParameters: { parameters: [{ name: 'ref', value: '=' + RAMA }] },
    sendHeaders: true, headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github.raw+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] },
    options: { timeout: 30000, response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } } } },
  { credentials: CRED_GITHUB, onError: 'continueRegularOutput', executeOnce: true });
}
function ollama(W, name, campo, pos) {
  return W.nodo(name, 'httpRequest', 4.5, pos, { method: 'POST', url: "={{ $('Config').first().json.OLLAMA_URL }}/api/chat",
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.' + campo + ') }}',
    options: { timeout: 180000, response: { response: { neverError: true, responseFormat: 'json' } } } }, { onError: 'continueRegularOutput' });
}
function ejecutar(W, name, destino, pos) {
  return W.nodo(name, 'executeWorkflow', 1.3, pos, { source: 'database', workflowId: { __rl: true, mode: 'id', value: destino },
    workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
    mode: 'once', options: { waitForSubWorkflow: true } }, { onError: 'continueRegularOutput', alwaysOutputData: true });
}
const COMUNES = { executionOrder: 'v1', timezone: 'America/Lima', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', errorWorkflow: ID.WF9, callerPolicy: 'workflowsFromSameOwner' };
const X = function (c) { return c * 240; };

// =====================================================================================================
// WF3 Borrador-IA
// =====================================================================================================
function wf3() {
  const W = workflow(ID.WF3, 'PB WF3 Borrador-IA', Object.assign({}, COMUNES), 'wf3.js');
  W.nota('## WF3 · Borrador-IA (sub-workflow)\nLo llaman WF2 (texto/foto/álbum libre: `modo` llm o completar) y WF4 (comandos: `modo` operacion; `/articulo`: llm + artículo).\n**Nunca publica:** guarda un borrador `pendiente` en `pb_borradores` (+ fotos WebP en `pb_imagenes`) y manda la vista previa con Publicar/Cancelar. WF5 publica solo tras el botón del autor.\n\nSalida: `{ok, draft_id}` o `{ok:false, reintentar:true}` (GitHub o Telegram caídos; WF2 reintenta hasta 3 veces).', [X(0) - 40, -760], 720, 300, 4);
  W.nodo('Entrada', 'executeWorkflowTrigger', 1.2, [X(0), 0], { inputSource: 'passthrough' });
  dtLeer(W, 'Leer config', 'pb_config', [], [X(1), 0]);
  W.code('Config', [X(2), 0]);
  W.code('Preparar', [X(3), 0]);
  W.nota('### 1 · Catálogo actual\nLos 3 JSON del repo (rama de `pb_config`) para validar ids, mostrar el "antes" y armar el catálogo del prompt. En `completar` se lee el borrador pendiente del autor.', [X(4) - 40, -260], 1180, 440, 7);
  dtLeer(W, 'Leer borrador previo', 'pb_borradores', [['draft_id', 'eq', "={{ $('Preparar').first().json.draft_previo || 'ninguno' }}"]], [X(4), 0], { limit: 1 });
  githubRaw(W, 'GET productos', 'products.json', [X(5), 0]);
  githubRaw(W, 'GET articulos', 'articles.json', [X(6), 0]);
  githubRaw(W, 'GET sitio', 'site.json', [X(7), 0]);
  W.code('Catalogo', [X(8), 0]);
  si(W, '¿Catálogo ok?', '={{ $json.ok === true }}', [X(9), 0]);
  W.code('Salida sin catalogo', [X(10), 320]);
  W.nota('### 2 · Fotos (máx. 6; álbum = un trabajo)\nTelegram `file get` + descarga (credencial **Telegram Palmera Brava**) → Edit Image: máx. 1200 px, **WebP** → base64 y medidas. Las fotos quedan en `pb_imagenes`; WF5 no vuelve a descargarlas (A7). Fallidas: aviso en la vista previa.', [X(10) - 40, -560], 1180, 420, 5);
  si(W, '¿Hay fotos?', "={{ $('Preparar').first().json.fotos.length > 0 }}", [X(10), 0]);
  W.code('Fotos a descargar', [X(11), -260]);
  W.nodo('Descargar foto', 'telegram', 1.2, [X(12), -260], { resource: 'file', operation: 'get', fileId: '={{ $json.file_id }}', download: true, additionalFields: {} },
    { credentials: CRED_TELEGRAM, onError: 'continueRegularOutput' });
  W.nodo('WebP 1200', 'editImage', 1.1, [X(13), -260], { operation: 'resize', dataPropertyName: 'data', width: 1200, height: 1200, resizeOption: 'onlyIfLarger', options: { format: 'webp' } },
    { onError: 'continueRegularOutput' });
  W.code('Fotos procesadas', [X(14), -260]);
  W.nota('### 3 · IA local (Ollama)\n`/api/chat` con `format` = esquema JSON, `think:false`, `num_ctx 8192`, prompt de `n8n/prompts/extraccion.md` y hasta 3 fotos. `validarOperacion()` corrige de forma determinista (categoría, campos por operación, **crear** si el texto no pide un cambio) y, si corrigió a crear, **1 reintento**. Comandos (`operacion`) no usan IA. Ollama caído → plantilla manual.', [X(15) - 40, -760], 1420, 460, 6);
  si(W, '¿Usar IA?', "={{ $('Preparar').first().json.modo !== 'operacion' }}", [X(15), 0]);
  W.code('Cuerpo Ollama', [X(16), -200]);
  ollama(W, 'Ollama', 'cuerpo', [X(17), -200]);
  W.code('Validar IA', [X(18), -200]);
  si(W, '¿Reintentar?', "={{ $json.estado === 'reintentar' }}", [X(19), -200]);
  ollama(W, 'Ollama reintento', 'cuerpo2', [X(20), -420]);
  W.code('Validar reintento', [X(21), -420]);
  W.nota('### 4 · Borrador y vista previa\nPermiso con el rol actual. Faltantes obligatorios → pide **solo** eso (sin Publicar). Vista previa con diff `antes → después`, "(sugerido por IA)" y avisos; Publicar/Cancelar como `pub:`/`no:` + draft. Guarda `preview_message_id` (WF5 solo acepta botones de esa vista previa).', [X(22) - 40, -560], 2140, 420, 7);
  W.code('Armar borrador', [X(22), 0]);
  segun(W, 'Accion', '={{ $json.accion }}', ['crear', 'actualizar', 'mensaje'], [X(23), 0]);
  W.code('Fila nueva', [X(24), -240]);
  dtInsertar(W, 'Insertar borrador', 'pb_borradores', [X(25), -240]);
  dtActualizar(W, 'Actualizar borrador', 'pb_borradores',
    [['draft_id', 'eq', '={{ $json.fila.draft_id }}'], ['estado', 'eq', 'pendiente'], ['owner_id', 'eq', "={{ $('Preparar').first().json.from_id }}"]],
    { op: '={{ $json.fila.op }}', entidad: '={{ $json.fila.entidad }}', entidad_id: '={{ $json.fila.entidad_id }}', campos: '={{ $json.fila.campos }}',
      campos_inferidos: '={{ $json.fila.campos_inferidos }}', faltantes: '={{ $json.fila.faltantes }}', avisos: '={{ $json.fila.avisos }}',
      texto: '={{ $json.fila.texto }}', resumen: '={{ $json.fila.resumen }}', confirmaciones_requeridas: '={{ $json.fila.confirmaciones_requeridas }}' }, [X(25), 0], { unaVez: true });
  W.code('Filas imagenes', [X(26), -120]);
  si(W, '¿Imágenes?', '={{ $json.nada !== true }}', [X(27), -120]);
  dtInsertar(W, 'Insertar imagenes', 'pb_imagenes', [X(28), -240]);
  W.code('Mensajes', [X(29), 0]);
  telegram(W, 'Enviar Telegram', [X(30), 0]);
  W.code('Preview enviado', [X(31), 0]);
  dtActualizar(W, 'Guardar preview id', 'pb_borradores', [['draft_id', 'eq', '={{ $json.draft_id }}'], ['estado', 'eq', 'pendiente']],
    { preview_message_id: '={{ $json.preview_message_id }}', estado: '={{ $json.estado }}', error: '={{ $json.error }}' }, [X(32), 0], { unaVez: true });
  W.code('Salida', [X(33), 0]);

  W.cadena('Entrada', 'Leer config', 'Config', 'Preparar', 'Leer borrador previo', 'GET productos', 'GET articulos', 'GET sitio', 'Catalogo', '¿Catálogo ok?');
  W.con('¿Catálogo ok?', '¿Hay fotos?', 0); W.con('¿Catálogo ok?', 'Salida sin catalogo', 1);
  W.con('¿Hay fotos?', 'Fotos a descargar', 0); W.con('¿Hay fotos?', '¿Usar IA?', 1);
  W.cadena('Fotos a descargar', 'Descargar foto', 'WebP 1200', 'Fotos procesadas', '¿Usar IA?');
  W.con('¿Usar IA?', 'Cuerpo Ollama', 0); W.con('¿Usar IA?', 'Armar borrador', 1);
  W.cadena('Cuerpo Ollama', 'Ollama', 'Validar IA', '¿Reintentar?');
  W.con('¿Reintentar?', 'Ollama reintento', 0); W.con('¿Reintentar?', 'Armar borrador', 1);
  W.cadena('Ollama reintento', 'Validar reintento', 'Armar borrador');
  W.cadena('Armar borrador', 'Accion');
  W.con('Accion', 'Fila nueva', 0); W.con('Accion', 'Actualizar borrador', 1); W.con('Accion', 'Mensajes', 2); W.con('Accion', 'Mensajes', 3);
  W.cadena('Fila nueva', 'Insertar borrador', 'Filas imagenes');
  W.con('Actualizar borrador', 'Filas imagenes');
  W.cadena('Filas imagenes', '¿Imágenes?');
  W.con('¿Imágenes?', 'Insertar imagenes', 0); W.con('¿Imágenes?', 'Mensajes', 1);
  W.con('Insertar imagenes', 'Mensajes');
  W.cadena('Mensajes', 'Enviar Telegram', 'Preview enviado', 'Guardar preview id', 'Salida');
  return W.fin();
}

// =====================================================================================================
// WF4 Comandos
// =====================================================================================================
function wf4() {
  const W = workflow(ID.WF4, 'PB WF4 Comandos', Object.assign({}, COMUNES), 'wf4.js');
  W.nota('## WF4 · Comandos (sub-workflow de WF2)\nInterpreta `/comando args`, revisa el **permiso del rol actual** (marketing no usa /borrar, /whatsapp, /limpiar_muestras, /deshacer, /pausa, /reanudar) y:\n- consultas → responde (catálogo leído de GitHub);\n- **toda escritura** → operación a WF3 (borrador + Publicar);\n- /historial y /deshacer → WF5 (`modo:"historial"`);\n- /imagen → WF6; /pausa, /reanudar, /cancelar → `pb_config` / `pb_borradores`;\n- v3: pedidos, envíos y usuarios → WF16.', [X(0) - 40, -1240], 760, 340, 4);
  W.nodo('Entrada', 'executeWorkflowTrigger', 1.2, [X(0), 0], { inputSource: 'passthrough' });
  dtLeer(W, 'Leer config', 'pb_config', [], [X(1), 0]);
  W.code('Config', [X(2), 0]);
  W.code('Interpretar', [X(3), 0]);
  segun(W, 'Ruta', '={{ $json.ruta }}', ['responder', 'consulta', 'estado', 'historial', 'deshacer', 'borrador', 'imagen', 'pausa', 'cancelar', 'pedidos'], [X(4), 0]);
  const y = function (k) { return -880 + k * 220; };
  W.nota('### Consultas (sin borrador)\n/ayuda, /lista, /ver, /estado, /ids y respuestas de uso o de permiso.', [X(5) - 40, y(0) - 120], 1200, 620, 7);
  W.code('Responder', [X(5), y(0)]);
  githubRaw(W, 'GET productos', 'products.json', [X(5), y(1)]);
  githubRaw(W, 'GET articulos', 'articles.json', [X(6), y(1)]);
  W.code('Consulta', [X(7), y(1)]);
  dtLeer(W, 'Inbox nuevo', 'pb_inbox', [['estado', 'eq', 'nuevo']], [X(5), y(2)], { limit: 100 });
  dtLeer(W, 'Aprobados', 'pb_borradores', [['estado', 'eq', 'aprobado']], [X(6), y(2)], { limit: 100 });
  dtLeer(W, 'Mis pendientes', 'pb_borradores', [['owner_id', 'eq', "={{ $('Interpretar').first().json.owner_id }}"], ['estado', 'eq', 'pendiente']], [X(7), y(2)], { limit: 20 });
  W.code('Estado', [X(8), y(2)]);
  W.nota('### Sub-workflows (deben estar publicados)\nWF5 historial · /deshacer (solo si HEAD es del bot; WF5 lo vuelve a verificar al publicar) · WF3 borrador · WF6 imagen.', [X(5) - 40, y(3) - 120], 1200, 900, 6);
  ejecutar(W, 'WF5 historial', ID.WF5, [X(5), y(3)]);
  ejecutar(W, 'WF5 head', ID.WF5, [X(5), y(4)]);
  W.code('Armar deshacer', [X(6), y(4)]);
  si(W, '¿Deshacer?', "={{ $json.ir === 'wf3' }}", [X(7), y(4)]);
  ejecutar(W, 'WF3 Borrador', ID.WF3, [X(8), y(5)]);
  ejecutar(W, 'WF6 Imagen', ID.WF6, [X(5), y(6)]);
  W.nota('### Control inmediato\n/pausa y /reanudar cambian `PAUSA`; /cancelar pasa tus borradores `pendiente` a `cancelado`, quita sus botones y borra sus fotos.', [X(5) - 40, y(7) - 120], 1200, 480, 5);
  dtActualizar(W, 'Guardar pausa', 'pb_config', [['clave', 'eq', 'PAUSA']], { valor: '={{ $json.valor }}' }, [X(5), y(7)], { unaVez: true });
  W.code('Pausa', [X(6), y(7)]);
  dtActualizar(W, 'Cancelar pendientes', 'pb_borradores', [['owner_id', 'eq', '={{ $json.owner_id }}'], ['estado', 'eq', 'pendiente']], { estado: 'cancelado' }, [X(5), y(8)], { unaVez: true });
  W.code('Ids cancelados', [X(6), y(8)]);
  dtBorrar(W, 'Borrar imagenes', 'pb_imagenes', [['draft_id', 'eq', '={{ $json.draft_id }}']], [X(7), y(8)]);
  W.code('Cancelados', [X(8), y(8)]);
  W.nota('### v3 · Pedidos y usuarios\n/envios, /pedidos, /pedido, /preparando, /enviar, /recojo, /entregado, /cancelar_pedido, /desconocidos, /autorizar, /desautorizar y sus botones (`ped:`/`usr:`) → **WF16 Pedidos-Bot** (debe estar publicado).', [X(5) - 40, y(9) - 140], 1200, 300, 4);
  ejecutar(W, 'WF16 Pedidos', ID.WF16, [X(5), y(9)]);
  telegram(W, 'Enviar', [X(10), 0]);
  W.code('Salida', [X(11), 0]);

  W.cadena('Entrada', 'Leer config', 'Config', 'Interpretar', 'Ruta');
  ['Responder', 'GET productos', 'Inbox nuevo', 'WF5 historial', 'WF5 head', 'WF3 Borrador', 'WF6 Imagen', 'Guardar pausa', 'Cancelar pendientes', 'WF16 Pedidos', 'Responder']
    .forEach(function (n, i) { W.con('Ruta', n, i); });
  W.con('Responder', 'Enviar');
  W.cadena('GET productos', 'GET articulos', 'Consulta', 'Enviar');
  W.cadena('Inbox nuevo', 'Aprobados', 'Mis pendientes', 'Estado', 'Enviar');
  W.con('WF5 historial', 'Salida');
  W.cadena('WF5 head', 'Armar deshacer', '¿Deshacer?');
  W.con('¿Deshacer?', 'WF3 Borrador', 0); W.con('¿Deshacer?', 'Enviar', 1);
  W.con('WF3 Borrador', 'Salida');
  W.con('WF6 Imagen', 'Salida');
  W.con('WF16 Pedidos', 'Salida');
  W.cadena('Guardar pausa', 'Pausa', 'Enviar');
  W.cadena('Cancelar pendientes', 'Ids cancelados', 'Borrar imagenes', 'Cancelados', 'Enviar');
  W.con('Enviar', 'Salida');
  return W.fin();
}

// ---------- escribir ----------
const salidas = { 'WF3-borrador-ia.json': wf3(), 'WF4-comandos.json': wf4() };
fs.mkdirSync(SALIDA, { recursive: true });
for (const f of Object.keys(salidas)) {
  const texto = JSON.stringify(salidas[f], null, 2) + '\n';
  fs.writeFileSync(path.join(SALIDA, f), texto);
  console.log('escrito n8n/workflows/' + f + ' (' + salidas[f].nodes.length + ' nodos, ' + Math.round(texto.length / 1024) + ' KB)');
}
