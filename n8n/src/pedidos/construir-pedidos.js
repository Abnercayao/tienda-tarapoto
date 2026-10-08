#!/usr/bin/env node
/*
 * n8n/src/pedidos/construir-pedidos.js — Genera los workflows de PEDIDOS y MERCADO PAGO (v3) en n8n/workflows/:
 *   WF13 Pedido-Crear (POST /webhook/pedido-crear)          WF14 MP-Notificación (POST /webhook/mp-notificacion y /webhook/pedido-pago)
 *   WF15 Pedido-Seguimiento (POST /webhook/pedido-seguimiento) WF16 Pedidos-Bot (sub-workflow de WF4: /pedidos, /enviar, /autorizar…)
 *   node n8n/src/pedidos/construir-pedidos.js
 * Mismo patrón que n8n/src/chat/construir-wf11.js. Código de los nodos Code: n8n/src/pedidos/wf13.js … wf16.js (secciones "//// <Nodo>").
 *   "// @incluir validar.js"     -> bloque "COPIAR A N8N ... FIN" de tools/validar.js (crearPedido, aplicarPagoMP, transicionPedido…)
 *   "// @incluir comun"          -> n8n/src/nucleo/comun.js (armarConfig, h, enviar, botones, comandosDeRol)
 *   "// @incluir comun-pedidos"  -> n8n/src/pedidos/comun-pedidos.js (config de pedidos, límites, firma de MP, textos de Telegram)
 * IDs fijos (ARQUITECTURA-N8N.md §12); UUID de nodo derivado de "<wf>|<nombre>". Sin pinData, sin instanceId, sin secretos:
 * el Access Token de Mercado Pago vive SOLO en la credencial "Mercado Pago Prueba" (pbCredMercPago01), que rellena el usuario.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const SRC = __dirname;
const SALIDA = path.join(RAIZ, 'n8n', 'workflows');
const ID = {
  WF13: 'pbWf13PedCrear00', WF14: 'pbWf14MpNotif000', WF15: 'pbWf15PedSegui00', WF16: 'pbWf16PedBot0000', WF9: 'pbWf09Errores000'
};
const ARCHIVOS = { WF13: 'WF13-pedido-crear.json', WF14: 'WF14-mp-notificacion.json', WF15: 'WF15-pedido-seguimiento.json', WF16: 'WF16-pedidos-bot.json' };
const CRED_MP = { httpHeaderAuth: { id: 'pbCredMercPago01', name: 'Mercado Pago Prueba' } };
// Solo la web (GitHub Pages) y el servidor local de pruebas; el proxy además bloquea otros Origin.
const ORIGENES_WEB = 'https://abnercayao.github.io,http://127.0.0.1:8080,http://localhost:8080';

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
const INCLUSIONES = {
  'validar.js': bloqueValidar(),
  comun: leer(path.join(RAIZ, 'n8n', 'src', 'nucleo', 'comun.js')).trim(),
  'comun-pedidos': leer(path.join(SRC, 'comun-pedidos.js')).trim()
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

// ---------- tablas ----------
// pb_pedidos: COLUMNAS_PB_PEDIDOS de tools/validar.js (contrato v3, 00.5). pb_borradores: la MISMA definición que crea WF0
// (se comprueba contra n8n/workflows/WF0-setup.json para que los borradores de stock no rompan el insert).
const V = require(path.join(RAIZ, 'tools', 'validar.js'));
const TABLAS = {
  pb_config: [['clave', 'string'], ['valor', 'string']],
  pb_pedidos: V.COLUMNAS_PB_PEDIDOS.map(function (c) { return [c.nombre, c.tipo]; }),
  pb_borradores: [['draft_id', 'string'], ['owner_id', 'number'], ['rol', 'string'], ['chat_id', 'number'], ['preview_message_id', 'number'],
    ['origen', 'string'], ['op', 'string'], ['entidad', 'string'], ['entidad_id', 'string'], ['campos', 'string'], ['campos_inferidos', 'string'],
    ['faltantes', 'string'], ['avisos', 'string'], ['update_ids', 'string'], ['file_ids', 'string'], ['file_unique_ids', 'string'],
    ['fecha', 'string'], ['expira', 'string'], ['estado', 'string'], ['confirmaciones', 'number'], ['confirmaciones_requeridas', 'number'],
    ['intentos', 'number'], ['error', 'string'], ['commit_sha', 'string'], ['texto', 'string'], ['resumen', 'string'], ['fecha_ms', 'number']]
};
(function revisarBorradores() {
  const f = path.join(SALIDA, 'WF0-setup.json');
  if (!fs.existsSync(f)) return;
  const n = JSON.parse(leer(f)).nodes.find(function (x) { return x.name === 'Crear pb_borradores'; });
  const cols = n ? n.parameters.columns.column.map(function (c) { return c.name + ':' + c.type; }).join(',') : '';
  const mias = TABLAS.pb_borradores.map(function (c) { return c[0] + ':' + c[1]; }).join(',');
  if (cols !== mias) throw new Error('pb_borradores de construir-pedidos.js no coincide con WF0 (n8n/tools/construir-nucleo.js): ' + cols);
})();

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
  const p = { resource: 'row', operation: 'get', dataTableId: rl(tabla), matchType: o.match || 'allConditions', filters: filtros(conds), returnAll: !o.limit };
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
function dtInsertarValores(W, name, tabla, valores, pos) {
  return W.nodo(name, 'dataTable', 1.1, pos, { resource: 'row', operation: 'insert', dataTableId: rl(tabla),
    columns: { mappingMode: 'defineBelow', value: valores, matchingColumns: [], schema: esquema(tabla, Object.keys(valores)), attemptToConvertTypes: false, convertFieldsToString: false },
    options: {} }, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
}
// Todas las columnas de pb_pedidos menos "numero" desde $json.fila (o desde otro nodo).
function valoresPedido(origen) {
  const v = {};
  TABLAS.pb_pedidos.forEach(function (c) { if (c[0] !== 'numero') v[c[0]] = '={{ ' + origen + '.fila.' + c[0] + ' }}'; });
  return v;
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
function webhook(W, name, ruta, pos, origenes) {
  return W.nodo(name, 'webhook', 2.1, pos, { httpMethod: 'POST', path: ruta, responseMode: 'responseNode', options: origenes ? { allowedOrigins: origenes } : {} },
    { webhookId: uuid('webhook|' + W.wf.id + '|' + ruta) });
}
function responder(W, name, pos, cuerpo, codigo) {
  return W.nodo(name, 'respondToWebhook', 1.5, pos, { respondWith: 'json', responseBody: cuerpo || '={{ JSON.stringify($json.cuerpo) }}',
    options: { responseCode: codigo || '={{ $json.status }}', responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } } });
}
const CFG = "$('Config').first().json";
// HTTP a Mercado Pago con la credencial Header Auth "Mercado Pago Prueba" (Authorization: Bearer <Access Token de PRUEBA>).
function mp(W, name, metodo, ruta, pos, o) {
  o = o || {};
  const p = { method: metodo, url: '={{ ' + CFG + '.MP_API_URL }}' + ruta, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' };
  if (o.query) { p.sendQuery = true; p.queryParameters = { parameters: o.query.map(function (q) { return { name: q[0], value: q[1] }; }) }; }
  if (o.cabeceras) { p.sendHeaders = true; p.headerParameters = { parameters: o.cabeceras.map(function (q) { return { name: q[0], value: q[1] }; }) }; }
  if (o.cuerpo) { p.sendBody = true; p.contentType = 'json'; p.specifyBody = 'json'; p.jsonBody = o.cuerpo; }
  p.options = { timeout: o.timeout || 15000, response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } };
  return W.nodo(name, 'httpRequest', 4.5, pos, p, { credentials: CRED_MP, onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
}
// Telegram con el token de pb_config (como el resto del bot; A2) y TELEGRAM_API_URL (api.telegram.org o un simulador local en pruebas).
function telegram(W, name, pos) {
  return W.nodo(name, 'httpRequest', 4.5, pos, { method: 'POST', url: '={{ ' + CFG + '.TELEGRAM_API_URL }}/bot{{ ' + CFG + '.BOT_TOKEN }}/{{ $json.metodo }}',
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.cuerpo) }}',
    options: { timeout: 20000, response: { response: { neverError: true, responseFormat: 'json' } } } }, { onError: 'continueRegularOutput' });
}
function ejecutar(W, name, destino, pos) {
  return W.nodo(name, 'executeWorkflow', 1.3, pos, { source: 'database', workflowId: { __rl: true, mode: 'id', value: destino },
    workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
    mode: 'once', options: { waitForSubWorkflow: true } }, { onError: 'continueRegularOutput', alwaysOutputData: true });
}
const COMUNES = { executionOrder: 'v1', timezone: 'America/Lima', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', errorWorkflow: ID.WF9 };
const SUB = { callerPolicy: 'workflowsFromSameOwner' };
const X = function (c) { return c * 240; };

// =====================================================================================================
// WF13 Pedido-Crear
// =====================================================================================================
function wf13() {
  const W = workflow(ID.WF13, 'PB WF13 Pedido-Crear', Object.assign({}, COMUNES, { executionTimeout: 90 }), 'wf13.js');
  W.nota('## WF13 · Pedido-Crear (checkout de la web)\n`POST /webhook/pedido-crear` **sin clave**: solo escucha en 127.0.0.1; lo llama `tools/chat-proxy.py` (ruta pública `/pedido`). Origins `' + ORIGENES_WEB + '`.\n1. Valida la forma y limita (6 por IP y 60 en total cada 10 min).\n2. **Recalcula todo con el catálogo publicado** (`crearPedido` de validar.js: precio vigente, stock por color, envío por zona). Nunca usa el precio del navegador.\n3. Reserva el número `PB-000101…` (UPDATE condicional en `pb_config.PEDIDO_ULTIMO`) y guarda en `pb_pedidos`.\n4. Crea la preferencia de **Checkout Pro** con la credencial **Mercado Pago Prueba**. Placeholder o token inválido → **pago simulado** (marcado).\n5. Responde `{ok, numero, total, init_point, modo_pago, pedido}` y DESPUÉS avisa por Telegram a admins y dueños.\nDetalle: `docs/PEDIDOS.md`.', [X(0) - 40, -900], 1000, 420, 4);
  webhook(W, 'POST pedido-crear', 'pedido-crear', [X(0), 0], ORIGENES_WEB);
  W.code('Entrada', [X(1), 0]);
  si(W, '¿Válido?', '={{ $json.valido === true }}', [X(2), 0]);
  W.nota('### 1 · Catálogo y revisión\n`pb_pedidos` se crea sola (`createIfNotExists`). products.json y site.json **publicados** (caché 60 s; si la web no responde, caché de hasta 1 h). La revisión usa el número PB-999999 para no gastar números en pedidos inválidos.', [X(3) - 40, -360], 1660, 520, 7);
  dtCrear(W, 'Crear pb_pedidos', 'pb_pedidos', [X(3), -120]);
  dtLeer(W, 'Leer config', 'pb_config', [], [X(4), -120]);
  W.code('Config', [X(5), -120]);
  W.code('Catálogo', [X(6), -120]);
  W.code('Revisar', [X(7), -120]);
  si(W, '¿Seguir?', '={{ $json.seguir === true }}', [X(8), -120]);
  W.nota('### 2 · Número correlativo (atómico)\n`UPDATE pb_config SET valor=<siguiente> WHERE clave=PEDIDO_ULTIMO AND valor=<actual>`: si dos pedidos llegan a la vez, solo uno se queda con el número; el otro responde 503 "vuelve a intentarlo". Si alguien editó el contador, manda el último número de `pb_pedidos`.', [X(9) - 40, -520], 1420, 380, 5);
  dtLeer(W, 'Leer contador', 'pb_config', [['clave', 'eq', 'PEDIDO_ULTIMO']], [X(9), -240], { limit: 1 });
  dtLeer(W, 'Último pedido', 'pb_pedidos', [], [X(10), -240], { limit: 1, orden: 'id', dir: 'DESC' });
  W.code('Proponer número', [X(11), -240]);
  si(W, '¿Falta contador?', '={{ $json.falta === true }}', [X(12), -240]);
  dtInsertarValores(W, 'Crear contador', 'pb_config', { clave: 'PEDIDO_ULTIMO', valor: '={{ $json.actual }}' }, [X(13), -360]);
  dtActualizar(W, 'Reservar número', 'pb_config', [['clave', 'eq', 'PEDIDO_ULTIMO'], ['valor', 'eq', "={{ $('Proponer número').first().json.actual }}"]],
    { valor: "={{ $('Proponer número').first().json.siguiente }}" }, [X(14), -240]);
  W.nota('### 3 · Guardar y Mercado Pago\nEl pedido se guarda en `pb_pedidos` ANTES de llamar a MP. `POST {MP_API_URL}/checkout/preferences` (Header Auth **Mercado Pago Prueba**, `X-Idempotency-Key` = número). `back_urls` sin `#` (`?mp=ok&pedido=…`), `notification_url` = `TUNEL_URL/mp-notificacion` (lo guarda WF12). `MP_LINK` elige `init_point` o `sandbox_init_point`.', [X(15) - 40, -520], 1900, 380, 6);
  W.code('Crear pedido', [X(15), -240]);
  si(W, '¿Pedido creado?', '={{ $json.seguir === true }}', [X(16), -240]);
  W.code('Fila pedido', [X(17), -320]);
  dtInsertar(W, 'Insertar pedido', 'pb_pedidos', [X(18), -320]);
  si(W, '¿Usar MP?', "={{ $('Crear pedido').first().json.usar_mp === true }}", [X(19), -320]);
  mp(W, 'Crear preferencia', 'POST', '/checkout/preferences', [X(20), -420], { cuerpo: "={{ JSON.stringify($('Crear pedido').first().json.preferencia) }}",
    cabeceras: [['X-Idempotency-Key', "={{ $('Crear pedido').first().json.pedido.numero }}"]] });
  W.code('Resultado pago', [X(21), -320]);
  dtActualizar(W, 'Guardar pago', 'pb_pedidos', [['numero', 'eq', '={{ $json.fila.numero }}']], valoresPedido('$json'), [X(22), -320]);
  W.nota('### 4 · Responder y avisar\nRespuesta para la web; después (sin demorar al cliente) "Nuevo pedido" a admins y dueños con el token de `pb_config`.', [X(23) - 40, -300], 1180, 420, 5);
  W.code('Respuesta', [X(23), 0]);
  responder(W, 'Responder', [X(24), 0]);
  si(W, '¿Avisar?', '={{ $json.avisar === true }}', [X(25), 0]);
  W.code('Aviso nuevo', [X(26), -100]);
  telegram(W, 'Enviar aviso', [X(27), -100]);

  W.cadena('POST pedido-crear', 'Entrada', '¿Válido?');
  W.con('¿Válido?', 'Crear pb_pedidos', 0); W.con('¿Válido?', 'Respuesta', 1);
  W.cadena('Crear pb_pedidos', 'Leer config', 'Config', 'Catálogo', 'Revisar', '¿Seguir?');
  W.con('¿Seguir?', 'Leer contador', 0); W.con('¿Seguir?', 'Respuesta', 1);
  W.cadena('Leer contador', 'Último pedido', 'Proponer número', '¿Falta contador?');
  W.con('¿Falta contador?', 'Crear contador', 0); W.con('¿Falta contador?', 'Reservar número', 1);
  W.cadena('Crear contador', 'Reservar número', 'Crear pedido', '¿Pedido creado?');
  W.con('¿Pedido creado?', 'Fila pedido', 0); W.con('¿Pedido creado?', 'Respuesta', 1);
  W.cadena('Fila pedido', 'Insertar pedido', '¿Usar MP?');
  W.con('¿Usar MP?', 'Crear preferencia', 0); W.con('¿Usar MP?', 'Resultado pago', 1);
  W.cadena('Crear preferencia', 'Resultado pago', 'Guardar pago', 'Respuesta', 'Responder', '¿Avisar?');
  W.con('¿Avisar?', 'Aviso nuevo', 0);
  W.cadena('Aviso nuevo', 'Enviar aviso');
  return W.fin();
}

// =====================================================================================================
// WF14 MP-Notificación (+ vuelta de la web y reconsulta del bot)
// =====================================================================================================
function wf14() {
  const W = workflow(ID.WF14, 'PB WF14 MP-Notificacion', Object.assign({}, COMUNES, SUB, { executionTimeout: 120 }), 'wf14.js');
  W.nota('## WF14 · Mercado Pago: confirmación del pago\nTres entradas:\n- `POST /webhook/mp-notificacion` (proxy `/mp-notificacion`): aviso de MP → **200 al instante** y luego se procesa.\n- `POST /webhook/pedido-pago` (proxy `/pedido/pago`): la web al volver de MP `{numero, correo, payment_id?}` (`SIMULADO` = demo). **Correo del pedido obligatorio** salvo con un `payment_id` real de MP de ese pedido; sin él o errado → la misma respuesta que un pedido inexistente; 8 fallos por IP cada 10 min → 429.\n- Sub-workflow (WF16 `/pedido`): busca el pago por `external_reference`.\n**Solo se cree `GET /v1/payments/{id}`** con la credencial (nunca el cuerpo del aviso ni el `?status=`). Si `pb_config.MP_WEBHOOK_SECRET` existe, se valida `x-signature` (HMAC-SHA256 en JS puro).\n`aplicarPagoMP` (validar.js): referencia, PEN y monto = total → `pagado` con historial. Al pagarse: borradores de **stock** auto-aprobados (WF5 los publica en el próximo lote) + aviso a admins y dueños.', [X(0) - 40, -1000], 1100, 440, 4);
  webhook(W, 'POST mp-notificacion', 'mp-notificacion', [X(0), -200]);
  responder(W, 'Responder MP', [X(1), -200], '{"ok":true}', 200);
  webhook(W, 'POST pedido-pago', 'pedido-pago', [X(1), 0], ORIGENES_WEB);
  W.nodo('Entrada sub', 'executeWorkflowTrigger', 1.2, [X(1), 200], { inputSource: 'passthrough' });
  W.code('Entrada', [X(2), 0]);
  si(W, '¿Válido?', '={{ $json.valido === true }}', [X(3), 0]);
  W.nota('### 1 · Firma y consulta a Mercado Pago\nFirma inválida → no consulta nada. `pago` = GET /v1/payments/{id} · `buscar` = /v1/payments/search?external_reference=PB-… · `simulado` = sin MP (solo pedidos SIM-).', [X(4) - 40, -460], 1900, 420, 7);
  dtCrear(W, 'Crear pb_pedidos', 'pb_pedidos', [X(4), -120]);
  dtLeer(W, 'Leer config', 'pb_config', [], [X(5), -120]);
  W.code('Config', [X(6), -120]);
  W.code('Preparar consulta', [X(7), -120]);
  segun(W, 'Consulta', '={{ $json.consulta }}', ['pago', 'buscar', 'simulado'], [X(8), -120]);
  mp(W, 'GET pago', 'GET', '/v1/payments/{{ $json.payment_id }}', [X(9), -300]);
  mp(W, 'Buscar pago', 'GET', '/v1/payments/search', [X(9), -140], { query: [['external_reference', '={{ $json.numero }}'], ['sort', 'date_created'], ['criteria', 'desc'], ['limit', '10']] });
  W.code('Pago MP', [X(10), -120]);
  W.nota('### 2 · Aplicar y guardar\n`UPDATE pb_pedidos … WHERE numero AND actualizado = <previo>`: si el aviso y la vuelta de la web llegan juntos, solo uno guarda → un solo aviso y un solo descuento de stock.', [X(11) - 40, -460], 1420, 420, 5);
  dtLeer(W, 'Leer pedido', 'pb_pedidos', [['numero', 'eq', "={{ $json.numero || 'ninguno' }}"]], [X(11), -120], { limit: 2 });
  W.code('Aplicar pago', [X(12), -120]);
  si(W, '¿Guardar?', '={{ $json.guardar === true }}', [X(13), -120]);
  dtActualizar(W, 'Guardar pedido', 'pb_pedidos', [['numero', 'eq', '={{ $json.numero }}'], ['actualizado', 'eq', '={{ $json.actualizado_previo }}']], valoresPedido('$json'), [X(14), -200]);
  W.code('Guardado', [X(15), -200]);
  W.nota('### 3 · Stock y avisos\nUn borrador `stock` (modo `restar`, rol dueño, origen `pedido`) por producto en `pb_borradores` con estado **aprobado**: WF2 llama a WF5 en el siguiente lote y queda un commit `data(products): … [pedido draft:…]`. Si ya no alcanza el stock, WF5 lo marca error y avisa al primer admin/dueño.', [X(16) - 40, -620], 1420, 400, 6);
  si(W, '¿Stock?', '={{ $json.stock.length > 0 }}', [X(16), -200]);
  W.code('Filas stock', [X(17), -300]);
  dtInsertar(W, 'Insertar borradores', 'pb_borradores', [X(18), -300], { onError: 'continueRegularOutput' });
  si(W, '¿Avisar?', "={{ $('Guardado').first().json.avisar === true }}", [X(19), -200]);
  W.code('Avisos pago', [X(20), -300]);
  telegram(W, 'Enviar aviso', [X(21), -300]);
  W.nota('### 4 · Respuesta\nWeb: `{ok, numero, estado, estado_texto, pago_estado}` (sin datos personales) o `{ok:false, motivo:"no_encontrado"}`. Sub-workflow: además el pedido. El aviso de MP ya recibió su 200.', [X(22) - 40, 160], 960, 300, 5);
  W.code('Respuesta', [X(22), 0]);
  segun(W, 'Según origen', '={{ $json.desde }}', ['web', 'sub'], [X(23), 0]);
  responder(W, 'Responder', [X(24), -80]);
  W.code('Salida sub', [X(24), 100]);

  W.cadena('POST mp-notificacion', 'Responder MP', 'Entrada');
  W.con('POST pedido-pago', 'Entrada'); W.con('Entrada sub', 'Entrada');
  W.cadena('Entrada', '¿Válido?');
  W.con('¿Válido?', 'Crear pb_pedidos', 0); W.con('¿Válido?', 'Respuesta', 1);
  W.cadena('Crear pb_pedidos', 'Leer config', 'Config', 'Preparar consulta', 'Consulta');
  W.con('Consulta', 'GET pago', 0); W.con('Consulta', 'Buscar pago', 1); W.con('Consulta', 'Pago MP', 2); W.con('Consulta', 'Respuesta', 3);
  W.con('GET pago', 'Pago MP'); W.con('Buscar pago', 'Pago MP');
  W.cadena('Pago MP', 'Leer pedido', 'Aplicar pago', '¿Guardar?');
  W.con('¿Guardar?', 'Guardar pedido', 0); W.con('¿Guardar?', 'Respuesta', 1);
  W.cadena('Guardar pedido', 'Guardado', '¿Stock?');
  W.con('¿Stock?', 'Filas stock', 0); W.con('¿Stock?', '¿Avisar?', 1);
  W.cadena('Filas stock', 'Insertar borradores', '¿Avisar?');
  W.con('¿Avisar?', 'Avisos pago', 0); W.con('¿Avisar?', 'Respuesta', 1);
  W.cadena('Avisos pago', 'Enviar aviso', 'Respuesta', 'Según origen');
  W.con('Según origen', 'Responder', 0); W.con('Según origen', 'Salida sub', 1);
  return W.fin();
}

// =====================================================================================================
// WF15 Pedido-Seguimiento
// =====================================================================================================
function wf15() {
  const W = workflow(ID.WF15, 'PB WF15 Pedido-Seguimiento', Object.assign({}, COMUNES, SUB, { executionTimeout: 30 }), 'wf15.js');
  W.nota('## WF15 · Seguimiento de pedido\n`POST /webhook/pedido-seguimiento` (proxy `/seguimiento` y `/pedido/consultar`) `{numero, correo}` y sub-workflow de **WF11** (chat Vale).\n- Busca por número y compara el correo (`mismoCorreo`). **Misma respuesta** si falla cualquiera de los dos: `{ok:false, motivo:"no_encontrado"}`.\n- Límites por IP: 20 consultas y 8 fallos cada 10 min (429 `limite`).\n- Devuelve `vistaPublicaPedido` (validar.js): estado, historial, agencia, código y URL de rastreo, tiempo estimado; **sin** correo, celular, DNI, dirección ni apellidos.', [X(0) - 40, -720], 980, 380, 4);
  webhook(W, 'POST pedido-seguimiento', 'pedido-seguimiento', [X(0), 0], ORIGENES_WEB);
  W.nodo('Entrada sub', 'executeWorkflowTrigger', 1.2, [X(0), 200], { inputSource: 'passthrough' });
  W.code('Entrada', [X(1), 0]);
  si(W, '¿Válido?', '={{ $json.valido === true }}', [X(2), 0]);
  dtCrear(W, 'Crear pb_pedidos', 'pb_pedidos', [X(3), -120]);
  dtLeer(W, 'Leer pedido', 'pb_pedidos', [['numero', 'eq', "={{ $('Entrada').first().json.numero }}"]], [X(4), -120], { limit: 2 });
  dtLeer(W, 'Leer config', 'pb_config', [], [X(5), -120]);
  W.code('Config', [X(6), -120]);
  W.code('Vista', [X(7), -120]);
  segun(W, 'Según origen', '={{ $json.desde }}', ['web', 'sub'], [X(8), 0]);
  responder(W, 'Responder', [X(9), -80]);
  W.code('Salida sub', [X(9), 100]);
  W.nota('### Datos\n`pb_pedidos` (Data Table) y `site.json` publicado (nombres de estados y agencias, caché 10 min). Nada se guarda en el repo.', [X(3) - 40, -360], 1180, 200, 7);
  W.con('POST pedido-seguimiento', 'Entrada'); W.con('Entrada sub', 'Entrada');
  W.cadena('Entrada', '¿Válido?');
  W.con('¿Válido?', 'Crear pb_pedidos', 0); W.con('¿Válido?', 'Según origen', 1);
  W.cadena('Crear pb_pedidos', 'Leer pedido', 'Leer config', 'Config', 'Vista', 'Según origen');
  W.con('Según origen', 'Responder', 0); W.con('Según origen', 'Salida sub', 1);
  return W.fin();
}

// =====================================================================================================
// WF16 Pedidos-Bot (sub-workflow de WF4)
// =====================================================================================================
function wf16() {
  const W = workflow(ID.WF16, 'PB WF16 Pedidos-Bot', Object.assign({}, COMUNES, SUB, { executionTimeout: 120 }), 'wf16.js');
  W.nota('## WF16 · Pedidos y usuarios en Telegram (sub-workflow de WF4)\n- Todos: `/envios`, `/pedidos`, `/pedido PB-000101` (marketing: sin datos de contacto).\n- Admin y dueño: `/preparando`, `/enviar <num> <shalom|olva|bus|local> <código>`, `/recojo`, `/entregado`, `/cancelar_pedido` (botón), `/desconocidos`, `/autorizar <id> <dueno|marketing>`, `/desautorizar <id>` (botón). **admin nunca se asigna ni se quita por el bot**; nadie se cambia a sí mismo.\n- Botones `ped:`/`usr:` (WF2 → WF4 → aquí), válidos 10 min, con el rol **actual** de quien toca.\n- Estados con `transicionPedido` (validar.js) y UPDATE condicional (`actualizado` previo).', [X(0) - 40, -1300], 1100, 380, 4);
  W.nodo('Entrada', 'executeWorkflowTrigger', 1.2, [X(0), 0], { inputSource: 'passthrough' });
  dtLeer(W, 'Leer config', 'pb_config', [], [X(1), 0]);
  W.code('Config', [X(2), 0]);
  dtCrear(W, 'Crear pb_pedidos', 'pb_pedidos', [X(3), 0]);
  W.code('Interpretar', [X(4), 0]);
  segun(W, 'Ruta', '={{ $json.ruta }}', ['responder', 'lista', 'pedido', 'cambiar', 'usuarios'], [X(5), 0]);
  const y = function (k) { return -880 + k * 240; };
  W.code('Responder', [X(6), y(0)]);
  dtLeer(W, 'Leer abiertos', 'pb_pedidos', [['estado', 'eq', 'pendiente_pago'], ['estado', 'eq', 'pagado'], ['estado', 'eq', 'preparando']], [X(6), y(1)], { match: 'anyCondition', limit: 200 });
  W.code('Lista', [X(7), y(1)]);
  W.nota('### /pedido y /cancelar_pedido\nSi sigue pendiente de pago con Mercado Pago real, reconsulta el pago con **WF14** (por si el aviso no llegó porque el túnel cambió).', [X(6) - 40, y(2) - 140], 1220, 360, 7);
  dtLeer(W, 'Leer pedido', 'pb_pedidos', [['numero', 'eq', "={{ $('Interpretar').first().json.numero }}"]], [X(6), y(2)], { limit: 2 });
  W.code('Revisar pedido', [X(7), y(2)]);
  si(W, '¿Reconsultar?', '={{ $json.reconsultar === true }}', [X(8), y(2)]);
  ejecutar(W, 'WF14 reconsultar', ID.WF14, [X(9), y(2) - 100]);
  W.code('Detalle', [X(10), y(2)]);
  W.nota('### Cambios de estado\n`transicionPedido` → UPDATE `pb_pedidos` WHERE numero AND actualizado = previo.', [X(6) - 40, y(3) + 60], 1220, 260, 5);
  dtLeer(W, 'Leer pedido cambio', 'pb_pedidos', [['numero', 'eq', "={{ $('Interpretar').first().json.numero }}"]], [X(6), y(3) + 200], { limit: 2 });
  W.code('Transición', [X(7), y(3) + 200]);
  si(W, '¿Guardar cambio?', '={{ $json.guardar === true }}', [X(8), y(3) + 200]);
  dtActualizar(W, 'Guardar cambio', 'pb_pedidos', [['numero', 'eq', '={{ $json.numero }}'], ['actualizado', 'eq', '={{ $json.actualizado_previo }}']], valoresPedido('$json'), [X(9), y(3) + 120]);
  W.code('Avisos cambio', [X(10), y(3) + 200]);
  W.nota('### Usuarios\nAUTORIZADOS de `pb_config` (UPDATE condicional sobre el valor previo). Al autorizar: `setMyCommands` para esa persona + bienvenida; al quitar: `deleteMyCommands`.', [X(6) - 40, y(5) + 40], 1220, 300, 6);
  dtLeer(W, 'Leer autorizados', 'pb_config', [['clave', 'eq', 'AUTORIZADOS']], [X(6), y(5) + 200], { limit: 1 });
  W.code('Cambiar autorizados', [X(7), y(5) + 200]);
  si(W, '¿Guardar usuarios?', '={{ $json.guardar === true }}', [X(8), y(5) + 200]);
  dtActualizar(W, 'Guardar autorizados', 'pb_config', [['clave', 'eq', 'AUTORIZADOS'], ['valor', 'eq', '={{ $json.previo }}']], { valor: '={{ $json.nuevo }}' }, [X(9), y(5) + 120]);
  W.code('Avisos usuarios', [X(10), y(5) + 200]);
  telegram(W, 'Enviar', [X(12), 0]);
  W.code('Salida', [X(13), 0]);

  W.cadena('Entrada', 'Leer config', 'Config', 'Crear pb_pedidos', 'Interpretar', 'Ruta');
  ['Responder', 'Leer abiertos', 'Leer pedido', 'Leer pedido cambio', 'Leer autorizados', 'Responder'].forEach(function (n, i) { W.con('Ruta', n, i); });
  W.con('Responder', 'Enviar');
  W.cadena('Leer abiertos', 'Lista', 'Enviar');
  W.cadena('Leer pedido', 'Revisar pedido', '¿Reconsultar?');
  W.con('¿Reconsultar?', 'WF14 reconsultar', 0); W.con('¿Reconsultar?', 'Detalle', 1);
  W.cadena('WF14 reconsultar', 'Detalle', 'Enviar');
  W.cadena('Leer pedido cambio', 'Transición', '¿Guardar cambio?');
  W.con('¿Guardar cambio?', 'Guardar cambio', 0); W.con('¿Guardar cambio?', 'Avisos cambio', 1);
  W.cadena('Guardar cambio', 'Avisos cambio', 'Enviar');
  W.cadena('Leer autorizados', 'Cambiar autorizados', '¿Guardar usuarios?');
  W.con('¿Guardar usuarios?', 'Guardar autorizados', 0); W.con('¿Guardar usuarios?', 'Avisos usuarios', 1);
  W.cadena('Guardar autorizados', 'Avisos usuarios', 'Enviar');
  W.con('Enviar', 'Salida');
  return W.fin();
}

const GENERADORES = { WF13: wf13, WF14: wf14, WF15: wf15, WF16: wf16 };
if (require.main === module) {
  fs.mkdirSync(SALIDA, { recursive: true });
  Object.keys(GENERADORES).forEach(function (k) {
    const wf = GENERADORES[k]();
    const texto = JSON.stringify(wf, null, 2) + '\n';
    fs.writeFileSync(path.join(SALIDA, ARCHIVOS[k]), texto);
    console.log('escrito n8n/workflows/' + ARCHIVOS[k] + ' (' + wf.nodes.length + ' nodos, ' + Math.round(texto.length / 1024) + ' KB)');
  });
}
module.exports = { ID: ID, ARCHIVOS: ARCHIVOS, TABLAS: TABLAS, ORIGENES_WEB: ORIGENES_WEB, wf13: wf13, wf14: wf14, wf15: wf15, wf16: wf16 };
