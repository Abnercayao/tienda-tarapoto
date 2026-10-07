#!/usr/bin/env node
/*
 * n8n/validar-workflows.js — Revisión estática de n8n/workflows/*.json antes de importarlos (n8n 2.40.7).
 *   node n8n/validar-workflows.js              (todos los .json de n8n/workflows)
 *   node n8n/validar-workflows.js WF5-publicar.json --estricto   (también acepta rutas a otros .json)
 *   node n8n/validar-workflows.js <copias>/*.json --con-id   (copias para importar: credenciales con id fijo)
 * Comprueba: JSON válido; id/nombre del workflow según ARQUITECTURA-N8N.md §3; ids y nombres de nodo únicos;
 * typeVersion <= máximos de la arquitectura (§1); conexiones a nodos existentes y a salidas que existen;
 * sin secretos, sin pinData, sin meta.instanceId; executeWorkflow -> ids conocidos (y presentes con --estricto);
 * credenciales = plantilla; settings (A10); Code compila y no usa require/crypto; $('Nodo') apunta a nodos reales;
 * Data Tables por nombre conocidas y update/delete con filtros + allConditions; webhookId en Webhook/Wait; sticky notes.
 * Sale con código 1 si hay errores. Los avisos no fallan (salvo --estricto).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR_N8N = __dirname;
const DIR_WF = path.join(DIR_N8N, 'workflows');
const args = process.argv.slice(2);
const ESTRICTO = args.includes('--estricto');
const CON_ID = args.includes('--con-id'); // copias para importar: cada credencial debe llevar el id fijo de la plantilla
const pedidos = args.filter(function (a) { return !a.startsWith('--'); });

// ARQUITECTURA-N8N.md §3
const WORKFLOWS = {
  pbWf00Setup00000: { nombre: 'PB WF0 Setup', archivo: 'WF0-setup.json' },
  pbWf01Ingesta000: { nombre: 'PB WF1 Ingesta', archivo: 'WF1-ingesta.json' },
  pbWf02Worker0000: { nombre: 'PB WF2 Worker', archivo: 'WF2-worker.json' },
  pbWf03Borrador00: { nombre: 'PB WF3 Borrador-IA', archivo: 'WF3-borrador-ia.json' },
  pbWf04Comandos00: { nombre: 'PB WF4 Comandos', archivo: 'WF4-comandos.json' },
  pbWf05Publicar00: { nombre: 'PB WF5 Publicar', archivo: 'WF5-publicar.json' },
  pbWf06Imagen0000: { nombre: 'PB WF6 Imagen-IA', archivo: 'WF6-imagen-ia.json' },
  pbWf08PanelApi00: { nombre: 'PB WF8 Panel-API', archivo: 'WF8-panel-api.json' },
  pbWf09Errores000: { nombre: 'PB WF9 Errores', archivo: 'WF9-errores.json' }
};
const WF9 = 'pbWf09Errores000';
const WF1 = 'pbWf01Ingesta000';
// ARQUITECTURA-N8N.md §1 (máximos verificados). stickyNote: 1.
const MAX_TV = {
  scheduleTrigger: 1.4, manualTrigger: 1, code: 2, httpRequest: 4.5, if: 2.3, switch: 3.4, executeWorkflow: 1.3,
  executeWorkflowTrigger: 1.2, dataTable: 1.1, telegram: 1.2, editImage: 1.1, webhook: 2.1, respondToWebhook: 1.5,
  errorTrigger: 1, wait: 1.1, noOp: 1, stickyNote: 1
};
const PROHIBIDOS = { readWriteFile: 'en 2.x no llega al volumen montado (ARQUITECTURA §1)' };
const DISPARADORES = ['scheduleTrigger', 'manualTrigger', 'executeWorkflowTrigger', 'webhook', 'errorTrigger'];
const TABLAS = ['pb_config', 'pb_locks', 'pb_inbox', 'pb_borradores', 'pb_imagenes'];
const SECRETOS = [
  [/(?<!\d)\d{8,10}:[A-Za-z0-9_-]{30,}/, 'token de bot de Telegram'],
  [/github_pat_[A-Za-z0-9_]{22,}/, 'PAT de GitHub (fine-grained)'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'token de GitHub'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clave privada'],
  [/\bsk-[A-Za-z0-9]{20,}/, 'clave de API (sk-)']
];

function cargarCredenciales() {
  const f = path.join(DIR_N8N, 'reference', 'credenciales.plantilla.json');
  const m = {};
  try { JSON.parse(fs.readFileSync(f, 'utf8')).forEach(function (c) { m[c.id] = c; }); } catch (e) { /* sin plantilla: se avisa abajo */ }
  return m;
}
const CREDS = cargarCredenciales();

function salidasDe(n) {
  const t = n.type.replace('n8n-nodes-base.', '');
  let k = 1;
  if (t === 'if') k = 2;
  else if (t === 'switch') {
    const p = n.parameters || {};
    k = ((p.rules && p.rules.values) || []).length + (p.options && p.options.fallbackOutput === 'extra' ? 1 : 0);
  } else if (DISPARADORES.indexOf(t) >= 0 && t !== 'executeWorkflowTrigger') k = 1;
  if (n.onError === 'continueErrorOutput') k++;
  return k;
}
function cadenas(v, ruta, out) {
  if (typeof v === 'string') out.push([ruta, v]);
  else if (Array.isArray(v)) v.forEach(function (x, i) { cadenas(x, ruta + '[' + i + ']', out); });
  else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { cadenas(v[k], ruta + '.' + k, out); });
  return out;
}
function refsANodos(texto) {
  const out = [];
  const re = /\$\(\s*(['"])((?:(?!\1).)+)\1\s*\)|\$node\[\s*(['"])((?:(?!\3).)+)\3\s*\]/g;
  let m;
  while ((m = re.exec(texto))) out.push(m[2] || m[4]);
  return out;
}

function revisar(entrada) {
  const archivo = path.basename(entrada);
  const ruta = fs.existsSync(entrada) && entrada !== archivo ? entrada : path.join(DIR_WF, archivo);
  const E = [];
  const A = [];
  const err = function (m) { E.push(m); };
  const avi = function (m) { A.push(m); };
  let texto;
  let wf;
  try { texto = fs.readFileSync(ruta, 'utf8'); } catch (e) { return { E: ['no se puede leer: ' + e.message], A: A }; }
  try { wf = JSON.parse(texto); } catch (e) { return { E: ['JSON inválido: ' + e.message], A: A }; }
  if (!wf || typeof wf !== 'object' || Array.isArray(wf)) return { E: ['la raíz debe ser un objeto workflow'], A: A };

  // --- workflow ---
  const meta = WORKFLOWS[wf.id];
  if (typeof wf.id !== 'string' || !/^[A-Za-z0-9]{16}$/.test(wf.id)) err('id del workflow inválido (16 alfanuméricos): ' + wf.id);
  else if (!meta) err('id ' + wf.id + ' no está en ARQUITECTURA §3');
  else {
    if (wf.name !== meta.nombre) err('nombre "' + wf.name + '" ≠ "' + meta.nombre + '"');
    if (archivo !== meta.archivo) avi('el archivo debería llamarse ' + meta.archivo);
  }
  if (wf.active !== false) err('"active" debe ser false (se publica a mano tras importar)');
  if (!Array.isArray(wf.nodes) || !wf.nodes.length) return { E: E.concat(['sin nodos']), A: A };
  if (!wf.connections || typeof wf.connections !== 'object') err('sin objeto "connections"');
  if (wf.pinData && Object.keys(wf.pinData).length) err('tiene pinData (datos de prueba fijados)');
  if (wf.meta && wf.meta.instanceId) err('tiene meta.instanceId');
  if (/"instanceId"\s*:/.test(texto)) err('aparece "instanceId" en el archivo');
  SECRETOS.forEach(function (s) { const m = s[0].exec(texto); if (m) err('posible secreto (' + s[1] + '): ' + m[0].slice(0, 12) + '…'); });

  // --- settings (A10 y §3) ---
  const s = wf.settings || {};
  if (s.executionOrder !== 'v1') err('settings.executionOrder debe ser "v1"');
  if (s.timezone !== 'America/Lima') avi('settings.timezone no es America/Lima');
  if (s.saveDataSuccessExecution !== 'none') err('settings.saveDataSuccessExecution debe ser "none" (A10)');
  if (wf.id === WF9) { if (s.errorWorkflow) err('WF9 no debe tener errorWorkflow (bucle)'); }
  else if (s.errorWorkflow !== WF9) err('settings.errorWorkflow debe ser ' + WF9);
  if (wf.id === WF1) {
    if (s.saveDataErrorExecution !== 'none') err('WF1: saveDataErrorExecution debe ser "none" (no guardar mensajes ni token)');
    if (s.saveManualExecutions !== false) err('WF1: saveManualExecutions debe ser false');
  } else if (s.saveDataErrorExecution !== 'all') avi('saveDataErrorExecution distinto de "all"');

  // --- nodos ---
  const porNombre = {};
  const ids = new Set();
  let notas = 0;
  let disparadores = 0;
  const destinos = new Set();
  wf.nodes.forEach(function (n, i) {
    const q = 'nodo ' + (n && n.name ? '"' + n.name + '"' : '#' + i);
    if (!n || typeof n !== 'object') { err(q + ': no es objeto'); return; }
    if (typeof n.id !== 'string' || !n.id) err(q + ': sin id');
    else if (ids.has(n.id)) err(q + ': id repetido ' + n.id);
    else ids.add(n.id);
    if (n.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(n.id)) avi(q + ': id no es UUID v4');
    if (typeof n.name !== 'string' || !n.name) err(q + ': sin nombre');
    else if (porNombre[n.name]) err(q + ': nombre repetido');
    else porNombre[n.name] = n;
    if (typeof n.type !== 'string' || n.type.indexOf('n8n-nodes-base.') !== 0) { err(q + ': tipo fuera de n8n-nodes-base: ' + n.type); return; }
    const t = n.type.slice('n8n-nodes-base.'.length);
    if (PROHIBIDOS[t]) err(q + ': ' + t + ' no se usa: ' + PROHIBIDOS[t]);
    else if (!(t in MAX_TV)) err(q + ': tipo ' + t + ' no está en la tabla de la arquitectura');
    else if (typeof n.typeVersion !== 'number' || n.typeVersion > MAX_TV[t]) err(q + ': typeVersion ' + n.typeVersion + ' > máx. ' + MAX_TV[t] + ' (' + t + ')');
    if (!Array.isArray(n.position) || n.position.length !== 2 || !n.position.every(Number.isFinite)) err(q + ': position inválida');
    if (!n.parameters || typeof n.parameters !== 'object') err(q + ': sin parameters');
    const p = n.parameters || {};
    if (t === 'stickyNote') { notas++; return; }
    if (DISPARADORES.indexOf(t) >= 0) disparadores++;
    if ((t === 'webhook' || t === 'wait') && !n.webhookId) err(q + ': ' + t + ' sin webhookId fijo');
    if (n.continueOnFail) avi(q + ': usa continueOnFail (preferir onError)');
    // credenciales: solo {id, name} de la plantilla
    if (n.credentials) Object.keys(n.credentials).forEach(function (tipo) {
      const c = n.credentials[tipo] || {};
      const extra = Object.keys(c).filter(function (k) { return k !== 'id' && k !== 'name'; });
      if (extra.length) err(q + ': la credencial lleva campos extra (' + extra.join(',') + ')');
      // Sin id = forma del repo público (tools/limpiar-workflows.js lo quita, D14): se exige nombre+tipo de la plantilla.
      // n8n/tools/preparar-importacion.js vuelve a poner el id fijo antes de importar (y --con-id lo exige).
      const sinId = c.id === undefined;
      if (sinId && CON_ID) err(q + ': credencial "' + c.name + '" sin id (usa n8n/tools/preparar-importacion.js)');
      const pl = sinId
        ? Object.keys(CREDS).map(function (k) { return CREDS[k]; }).filter(function (x) { return x.type === tipo && x.name === c.name; })[0]
        : CREDS[c.id];
      if (!pl) err(q + ': credencial ' + (sinId ? '"' + c.name + '" (' + tipo + ')' : c.id) + ' no está en reference/credenciales.plantilla.json');
      else if (pl.type !== tipo || pl.name !== c.name) err(q + ': credencial ' + c.id + ' no coincide con la plantilla (' + pl.type + ' / ' + pl.name + ')');
    });
    if (t === 'httpRequest' && p.authentication === 'predefinedCredentialType' && !(n.credentials && n.credentials[p.nodeCredentialType])) err(q + ': falta la credencial ' + p.nodeCredentialType);
    if (t === 'httpRequest' && /api\.telegram\.org/.test(String(p.url || '')) && n.credentials) err(q + ': HTTP a Telegram con credencial (el token va en la URL desde pb_config, A2)');
    // Data Tables
    if (t === 'dataTable') {
      if (p.resource === 'table') {
        if (TABLAS.indexOf(p.tableName) < 0) err(q + ': tabla desconocida ' + p.tableName);
      } else {
        const d = p.dataTableId || {};
        if (d.mode !== 'name' || TABLAS.indexOf(d.value) < 0) err(q + ': dataTableId debe ser por nombre y conocido (' + d.mode + ':' + d.value + ')');
        // anyCondition solo se admite en lecturas (get) tipo "IN": todas las condiciones 'eq' sobre la MISMA columna.
        const conds = (p.filters && p.filters.conditions) || [];
        const esIn = p.operation === 'get' && p.matchType === 'anyCondition' && conds.length > 1 &&
          conds.every(function (c) { return c.condition === 'eq' && c.keyName === conds[0].keyName; });
        if (['update', 'deleteRows', 'get', 'rowExists', 'rowNotExists', 'upsert'].indexOf(p.operation) >= 0 && conds.length && p.matchType !== 'allConditions' && !esIn) err(q + ': matchType debe ser allConditions (o anyCondition en un get "IN" sobre una sola columna)');
        if ((p.operation === 'update' || p.operation === 'deleteRows') && !(p.filters && p.filters.conditions && p.filters.conditions.length)) err(q + ': ' + p.operation + ' sin filtros (afectaría toda la tabla)');
      }
    }
    // Execute Workflow
    if (t === 'executeWorkflow') {
      const w = p.workflowId || {};
      const dest = typeof w === 'string' ? w : w.value;
      if (p.source !== 'database') err(q + ': source debe ser "database"');
      if (!WORKFLOWS[dest]) err(q + ': executeWorkflow a un id desconocido: ' + dest);
      else if (dest === wf.id) err(q + ': se llama a sí mismo');
      else {
        destinos.add(dest);
        if (!fs.existsSync(path.join(DIR_WF, WORKFLOWS[dest].archivo))) (ESTRICTO ? err : avi)(q + ': ' + WORKFLOWS[dest].archivo + ' (' + dest + ') todavía no existe en n8n/workflows');
      }
    }
    // Code
    if (t === 'code') {
      const js = String(p.jsCode || '');
      if (p.language && p.language !== 'javaScript') err(q + ': lenguaje ' + p.language);
      try { new vm.Script('(async function () {\n' + js + '\n})', { filename: archivo + ':' + n.name }); }
      catch (e) { err(q + ': el código no compila: ' + e.message); }
      if (/\brequire\s*\(/.test(js)) err(q + ': usa require() (bloqueado en el task runner)');
      if (/\bcrypto\s*\./.test(js)) err(q + ': usa crypto (undefined en el task runner)');
      if (/^\s*\/\/ @incluir\b/m.test(js)) err(q + ': quedó una marca "// @incluir" sin reemplazar');
    }
  });
  if (!notas) err('sin sticky notes explicativas');
  // Un disparador por workflow; la única excepción son varios Webhook (WF8: una ruta por endpoint), con rutas distintas.
  const hooks = wf.nodes.filter(function (n) { return n.type === 'n8n-nodes-base.webhook'; });
  const rutas = hooks.map(function (n) { return String((n.parameters || {}).httpMethod || 'GET') + ' ' + String((n.parameters || {}).path || ''); });
  if (disparadores > 1 && hooks.length === disparadores) {
    if (new Set(rutas).size !== rutas.length) err('dos Webhook con el mismo método y ruta: ' + rutas.join(', '));
  } else if (disparadores !== 1) err('debe haber exactamente 1 disparador (hay ' + disparadores + ')');

  // referencias $('Nodo') en expresiones y código
  wf.nodes.forEach(function (n) {
    if (!n || n.type === 'n8n-nodes-base.stickyNote') return;
    cadenas(n.parameters || {}, '', []).forEach(function (par) {
      refsANodos(par[1]).forEach(function (r) { if (!porNombre[r]) err('nodo "' + n.name + '"' + par[0] + ': referencia a nodo inexistente $(\'' + r + '\')'); });
    });
  });

  // --- conexiones ---
  const entrantes = {};
  Object.keys(wf.connections || {}).forEach(function (de) {
    const n = porNombre[de];
    if (!n) { err('conexión desde nodo inexistente "' + de + '"'); return; }
    const c = wf.connections[de];
    Object.keys(c).forEach(function (tipo) {
      if (tipo !== 'main') err('conexión "' + de + '" de tipo ' + tipo);
      const salidas = c[tipo] || [];
      const max = salidasDe(n);
      if (salidas.length > max) err('"' + de + '" usa la salida ' + (salidas.length - 1) + ' pero solo tiene ' + max);
      salidas.forEach(function (lista, k) {
        (lista || []).forEach(function (x) {
          if (!x || !porNombre[x.node]) { err('"' + de + '"[' + k + '] -> nodo inexistente "' + (x && x.node) + '"'); return; }
          const tt = porNombre[x.node].type.replace('n8n-nodes-base.', '');
          if (DISPARADORES.indexOf(tt) >= 0 || tt === 'stickyNote') err('"' + de + '" -> "' + x.node + '" (no admite entrada)');
          if (x.type !== 'main' || x.index !== 0) err('"' + de + '" -> "' + x.node + '": type/index inesperado');
          entrantes[x.node] = (entrantes[x.node] || 0) + 1;
        });
      });
    });
  });
  wf.nodes.forEach(function (n) {
    const t = n.type.replace('n8n-nodes-base.', '');
    if (t === 'stickyNote' || DISPARADORES.indexOf(t) >= 0) return;
    if (!entrantes[n.name]) err('nodo "' + n.name + '" sin conexión de entrada (inalcanzable)');
  });
  // alcanzable desde el disparador
  const disp = wf.nodes.filter(function (n) { return DISPARADORES.indexOf(n.type.replace('n8n-nodes-base.', '')) >= 0; }).map(function (n) { return n.name; });
  const vistos = new Set(disp);
  const pila = disp.slice();
  while (pila.length) {
    const x = pila.pop();
    ((wf.connections[x] || {}).main || []).forEach(function (l) { (l || []).forEach(function (y) { if (y && !vistos.has(y.node)) { vistos.add(y.node); pila.push(y.node); } }); });
  }
  wf.nodes.forEach(function (n) { if (n.type !== 'n8n-nodes-base.stickyNote' && !vistos.has(n.name)) err('nodo "' + n.name + '" no es alcanzable desde el disparador'); });
  // sub-workflows
  const esSub = wf.nodes.some(function (n) { return n.type === 'n8n-nodes-base.executeWorkflowTrigger'; });
  if (esSub && s.callerPolicy !== 'workflowsFromSameOwner') err('sub-workflow sin settings.callerPolicy "workflowsFromSameOwner"');
  return { E: E, A: A, nodos: wf.nodes.length, notas: notas, destinos: Array.from(destinos) };
}

const archivos = (pedidos.length ? pedidos : fs.readdirSync(DIR_WF).filter(function (f) { return /\.json$/.test(f); }).sort());
if (!Object.keys(CREDS).length) console.log('AVISO: no encontré reference/credenciales.plantilla.json');
let errores = 0;
let avisos = 0;
archivos.forEach(function (f) {
  const r = revisar(f);
  errores += r.E.length;
  avisos += r.A.length;
  console.log((r.E.length ? 'FALLA ' : 'OK    ') + path.basename(f) + (r.nodos ? ' (' + r.nodos + ' nodos, ' + r.notas + ' notas' + (r.destinos.length ? ', llama a ' + r.destinos.join(',') : '') + ')' : ''));
  r.E.forEach(function (m) { console.log('   ERROR  ' + m); });
  r.A.forEach(function (m) { console.log('   aviso  ' + m); });
});
console.log('\n' + archivos.length + ' archivo(s), ' + errores + ' error(es), ' + avisos + ' aviso(s)' + (ESTRICTO ? ' [estricto]' : ''));
process.exit(errores || (ESTRICTO && avisos) ? 1 : 0);
