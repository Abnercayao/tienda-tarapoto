#!/usr/bin/env node
/*
 * n8n/src/chat/construir-wf12.js — Genera n8n/workflows/WF12-chat-url.json (registra la URL pública del chat en data/chat.json).
 *   node n8n/src/chat/construir-wf12.js
 * Lo llama tools/iniciar-chat.ps1 (y detener-chat.bat) SOLO desde esta PC:
 *   POST http://127.0.0.1:5678/webhook/chat-url  (Header Auth X-Tienda-Key, credencial pbCredHeader0001)
 *   {"url":"https://<x>.trycloudflare.com"}  o  {"activo":false}
 * Si difiere del data/chat.json de GitHub, lo actualiza con la Contents API (PUT con sha; nunca force) -> commit
 * "chat: actualizar URL del túnel". Código de los nodos Code: n8n/src/chat/wf12.js. Mismas ayudas que construir-wf11.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('./construir-wf11.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const SALIDA = path.join(RAIZ, 'n8n', 'workflows');
const ARCHIVO = 'WF12-chat-url.json';
const ID_WF12 = 'pbWf12ChatUrl000';
const CRED_HEADER = { httpHeaderAuth: { id: 'pbCredHeader0001', name: 'Header X-Tienda-Key' } };
const CRED_GITHUB = { githubApi: { id: 'pbCredGithub0001', name: 'GitHub Palmera Brava' } };
// Ninguna página web debe llamar a este webhook: solo el script local (sin Origin). CORS restringido a n8n mismo.
const ORIGENES = 'http://127.0.0.1:5678,http://localhost:5678';
const X = B.X;

function github(W, name, metodo, url, pos, o) {
  o = o || {};
  const p = { method: metodo, url: url, authentication: 'predefinedCredentialType', nodeCredentialType: 'githubApi',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'X-GitHub-Api-Version', value: '2022-11-28' }] } };
  if (o.query) { p.sendQuery = true; p.queryParameters = { parameters: o.query.map(function (q) { return { name: q[0], value: q[1] }; }) }; }
  if (o.cuerpo) { p.sendBody = true; p.contentType = 'json'; p.specifyBody = 'json'; p.jsonBody = o.cuerpo; }
  p.options = { timeout: 30000, response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } };
  return W.nodo(name, 'httpRequest', 4.5, pos, p, { credentials: CRED_GITHUB, onError: 'continueRegularOutput', alwaysOutputData: true });
}

// v3: guarda la URL del túnel en pb_config.TUNEL_URL ('' = chat apagado). WF13 la usa como notification_url de Mercado Pago.
function guardarTunel(W, name, pos) {
  const col = function (c) { return { id: c, displayName: c, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }; };
  return W.nodo(name, 'dataTable', 1.1, pos, { resource: 'row', operation: 'upsert', dataTableId: { __rl: true, mode: 'name', value: 'pb_config' }, matchType: 'allConditions',
    filters: { conditions: [{ keyName: 'clave', condition: 'eq', keyValue: 'TUNEL_URL' }] },
    columns: { mappingMode: 'defineBelow', value: { clave: 'TUNEL_URL', valor: "={{ $('Validar URL').first().json.url }}" }, matchingColumns: [], schema: [col('clave'), col('valor')], attemptToConvertTypes: false, convertFieldsToString: false },
    options: {} }, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' });
}

function wf12() {
  const W = B.workflow(ID_WF12, 'PB WF12 Chat-URL', Object.assign({}, B.COMUNES, { executionTimeout: 120 }), 'wf12.js');
  const CFG = "$('Config').first().json";
  const RUTA = '{{ ' + CFG + '.GITHUB_API_URL }}/repos/{{ ' + CFG + '.REPO }}/contents/data/chat.json';
  W.nota('## WF12 · Chat-URL (URL pública del chat)\n`POST /webhook/chat-url` con **Header Auth** `X-Tienda-Key` (credencial **Header X-Tienda-Key**). Solo lo llama `tools/iniciar-chat.ps1` desde esta PC (el proxy del chat NO reenvía esta ruta).\n- `{"url":"https://<x>.trycloudflare.com"}` → chat activo · `{"activo":false}` → chat apagado.\n- Lee `data/chat.json` de GitHub (Contents API). **Si no cambió, no hace commit.** Si cambió: `validar({chat})` y PUT con `sha` (commit "chat: actualizar URL del túnel", autor "Tienda Chat"; nunca force).\n- v3: guarda la URL en `pb_config.TUNEL_URL` (notification_url de Mercado Pago en WF13), aunque data/chat.json no cambie.\n- Respuestas: 200 `{ok, cambiado, commit?}` · 400 URL inválida · 409 conflicto (reintentar) · 422 validar() · 502 GitHub.\nDetalle: `docs/CHAT-VENDEDOR.md`.', [X(0) - 40, -560], 1180, 420, 4);
  W.nodo('POST chat-url', 'webhook', 2.1, [X(0), 0], { httpMethod: 'POST', path: 'chat-url', authentication: 'headerAuth', responseMode: 'responseNode',
    options: { allowedOrigins: ORIGENES } }, { webhookId: B.uuid('webhook|' + ID_WF12 + '|chat-url'), credentials: CRED_HEADER });
  W.code('Validar URL', [X(1), 0]);
  B.si(W, '¿Válido?', '={{ $json.valido === true }}', [X(2), 0]);
  guardarTunel(W, 'Guardar TUNEL_URL', [X(3), -240]);
  B.dtLeer(W, 'Leer config', 'pb_config', [], [X(3), -120]);
  W.code('Config', [X(4), -120]);
  github(W, 'Leer chat.json', 'GET', '=' + RUTA, [X(5), -120], { query: [['ref', '={{ ' + CFG + '.REPO_BRANCH }}']] });
  W.code('Comparar', [X(6), -120]);
  B.si(W, '¿Escribir?', '={{ $json.escribir === true }}', [X(7), -120]);
  github(W, 'Escribir chat.json', 'PUT', '=' + RUTA, [X(8), -240], { cuerpo: '={{ JSON.stringify($json.cuerpoPut) }}' });
  W.code('Resultado', [X(9), -240]);
  W.nodo('Responder', 'respondToWebhook', 1.5, [X(10), 0], { respondWith: 'json', responseBody: '={{ JSON.stringify($json.cuerpo) }}',
    options: { responseCode: '={{ $json.status }}', responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } } });
  W.nota('### GitHub (Contents API)\nGET `contents/data/chat.json?ref=<rama>` → `sha` + contenido. PUT con `sha` (404 = se crea sin `sha`). Sin lock `worker`: el PUT es atómico; si WF5 publica a la vez, su PATCH de ref recibe 422 y reintenta (D5). `GITHUB_API_URL` en `pb_config` solo acepta api.github.com o un simulador local (pruebas).', [X(5) - 40, -520], 1220, 240, 7);

  W.cadena('POST chat-url', 'Validar URL', '¿Válido?');
  W.con('¿Válido?', 'Guardar TUNEL_URL', 0); W.con('¿Válido?', 'Responder', 1);
  W.con('Guardar TUNEL_URL', 'Leer config');
  W.cadena('Leer config', 'Config', 'Leer chat.json', 'Comparar', '¿Escribir?');
  W.con('¿Escribir?', 'Escribir chat.json', 0); W.con('¿Escribir?', 'Responder', 1);
  W.cadena('Escribir chat.json', 'Resultado', 'Responder');
  return W.fin();
}

if (require.main === module) {
  const wf = wf12();
  const texto = JSON.stringify(wf, null, 2) + '\n';
  fs.mkdirSync(SALIDA, { recursive: true });
  fs.writeFileSync(path.join(SALIDA, ARCHIVO), texto);
  console.log('escrito n8n/workflows/' + ARCHIVO + ' (' + wf.nodes.length + ' nodos, ' + Math.round(texto.length / 1024) + ' KB)');
}
module.exports = { wf12: wf12, ID_WF12: ID_WF12 };
