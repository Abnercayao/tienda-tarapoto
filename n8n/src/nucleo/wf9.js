//// Resumir error
// @incluir comun
// Datos del Error Trigger -> workflow, nodo y mensaje corto, SIEMPRE censurados (sin tokens ni PAT).
const e = $input.first().json || {};
const ex = e.execution || {};
const err = ex.error || (e.trigger && e.trigger.error) || {};
const nodo = ex.lastNodeExecuted || (err.node && err.node.name) || (e.trigger ? 'disparador' : '?');
const mensaje = censurar(err.message || err.description || 'error desconocido').replace(/\s+/g, ' ').slice(0, 200);
return [{ json: {
  wf: censurar((e.workflow && e.workflow.name) || 'workflow').slice(0, 60),
  wf_id: String((e.workflow && e.workflow.id) || ''),
  nodo: censurar(nodo).slice(0, 60),
  mensaje: mensaje,
  execution_id: ex.id !== undefined && ex.id !== null ? String(ex.id) : 'ninguna'
} }];

//// Config
// @incluir comun
const cfg = armarConfig($input.all().map(function (i) { return i.json; }));
if (!cfg.BOT_TOKEN) return [];
return [{ json: cfg }];

//// Limitar alertas
// @incluir comun
// Máximo 1 aviso por hora por "workflow|nodo" (pb_config.ALERTAS guarda la última hora de cada uno, se purga a las 24 h).
const cfg = $('Config').first().json;
const r = $('Resumir error').first().json;
const ahora = Date.now();
const clave = (r.wf + '|' + r.nodo).slice(0, 120);
const alertas = {};
Object.keys(cfg.ALERTAS).forEach(function (k) { const t = Number(cfg.ALERTAS[k]); if (Number.isFinite(t) && ahora - t < 86400000) alertas[k] = t; });
const enviarAviso = !(alertas[clave] && ahora - alertas[clave] < 3600000);
if (enviarAviso) alertas[clave] = ahora;
const texto = 'Error en ' + h(r.wf) + ' (nodo ' + h(r.nodo) + '): ' + h(r.mensaje) + '.\nSiguiente paso: si se repite, abre http://localhost:5678 → Executions.';
return [{ json: {
  enviar: enviarAviso,
  alertas: JSON.stringify(alertas),
  mensajes: enviarAviso ? admins(cfg).map(function (a) { return enviar(a.id, texto); }) : []
} }];

//// Mensajes
const l = $('Limitar alertas').first().json;
return l.mensajes.map(function (m) { return { json: m }; });
