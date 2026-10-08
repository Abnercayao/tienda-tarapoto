//// Config
// @incluir comun
const cfg = armarConfig($input.all().map(function (i) { return i.json; }));
if (!cfg.BOT_TOKEN) return [];
return [{ json: cfg }];

//// Elegir
// @incluir comun
// Toma UN trabajo: el mensaje más antiguo en estado "nuevo". Un álbum (media_group_id) se procesa entero, y solo
// cuando su foto más reciente llegó hace >= 20 s. Filas "procesando" = huérfanas de un worker que murió (tenemos el lock):
// se reintentan una vez más (intentos + 1); con intentos >= 2 se dejan.
const cfg = $('Config').first().json;
const ahora = Date.now();
const filas = $('Leer inbox').all().concat($input.all()).map(function (i) { return i.json; })
  .filter(function (j) { return j.update_id !== undefined && j.update_id !== null && (j.estado === 'nuevo' || (j.estado === 'procesando' && (Number(j.intentos) || 0) < 2)); })
  .sort(function (a, b) { return (Number(a.id) || 0) - (Number(b.id) || 0); });
const usados = new Set();
let elegido = null;
for (const f of filas) {
  if (usados.has(f.update_id)) continue;
  if (f.media_group_id) {
    const grupo = filas.filter(function (x) { return x.media_group_id === f.media_group_id && x.chat_id === f.chat_id; });
    grupo.forEach(function (x) { usados.add(x.update_id); });
    const masNuevo = Math.max.apply(null, grupo.map(function (x) { return Number(x.recibido) || 0; }));
    if (ahora - masNuevo < 20000) continue;                              // el álbum todavía puede estar llegando
    elegido = grupo.slice().sort(function (a, b) { return (Number(a.message_id) || 0) - (Number(b.message_id) || 0); });
    break;
  }
  elegido = [f];
  break;
}
if (!elegido) return [{ json: { hay: false, ruta: 'nada', filas: [] } }];
// Duplicados del mismo update_id (solapamiento de WF1) se marcan juntos (el update filtra por update_id).
const unicos = [];
const vistos = new Set();
elegido.forEach(function (x) { if (!vistos.has(x.update_id)) { vistos.add(x.update_id); unicos.push(x); } });
const base = unicos[0];
const rol = rolDe(cfg, base.from_id);                                  // rol recalculado: revocar surte efecto al instante
const fotos = unicos.filter(function (x) { return x.tipo === 'foto' && x.file_id; }).slice(0, 6)
  .map(function (x) { return { file_id: x.file_id, file_unique_id: x.file_unique_id }; });
const conTexto = unicos.find(function (x) { return x.texto && String(x.texto).trim(); });
const texto = conTexto ? String(conTexto.texto) : '';
let comando = '';
let args = [];
const t = texto.trim();
if (t.charAt(0) === '/' && base.tipo !== 'callback') {
  const partes = t.split(/\s+/);
  comando = partes[0].slice(1).split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
  args = partes.slice(1, 40).map(function (a) { return a.slice(0, 200); });
}
const tipo = fotos.length ? 'foto' : base.tipo;
let ruta;
if (!rol) ruta = 'rechazado';
else if (tipo === 'callback' && /^(ped|usr):/.test(String(base.callback_data || ''))) { ruta = 'comando'; comando = 'boton_pedidos'; } // v3: botones de WF16
else if (tipo === 'callback') ruta = 'callback';
else if (comando) ruta = 'comando';
else if (tipo === 'foto' || tipo === 'texto') ruta = 'borrador';
else ruta = 'fijo';
const trabajo = {
  tipo: tipo, update_ids: unicos.map(function (x) { return Number(x.update_id); }), chat_id: Number(base.chat_id), from_id: Number(base.from_id),
  nombre: String(base.nombre || ''), rol: rol || '', message_id: Number(base.message_id) || 0, texto: texto, comando: comando, args: args, fotos: fotos,
  callback: tipo === 'callback' ? { id: base.callback_id, data: base.callback_data, message_id: Number(base.callback_message_id) || 0 } : null,
  origen: 'telegram'
};
return [{ json: {
  hay: true, ruta: ruta, trabajo: trabajo,
  filas: unicos.map(function (x) {
    const previo = x.estado;
    return { update_id: Number(x.update_id), estado_previo: previo, intentos: (Number(x.intentos) || 0) + (previo === 'procesando' ? 1 : 0) };
  })
} }];

//// Preparar trabajo
// Decide el modo de WF3: "completar" si el autor tiene un borrador pendiente con faltantes (< 24 h) y manda solo texto.
const e = $('Elegir').first().json;
if (!e.hay) return [{ json: e }];
const t = e.trabajo;
let modo = e.ruta === 'callback' ? 'callback' : 'llm';
let draftId = '';
let tipoEntidad = 'producto';
if (e.ruta === 'borrador' && !t.fotos.length) {
  const ahora = Date.now();
  const pend = $input.all().map(function (i) { return i.json; })
    .filter(function (b) { return b.draft_id && b.estado === 'pendiente' && Number(b.owner_id) === t.from_id && ahora - (Number(b.fecha_ms) || 0) < 86400000; })
    .filter(function (b) { let f = []; try { f = JSON.parse(b.faltantes || '[]'); } catch (x) { f = []; } return Array.isArray(f) && f.length > 0 && f.indexOf('destino') < 0; })
    .sort(function (a, b) { return (Number(b.fecha_ms) || 0) - (Number(a.fecha_ms) || 0); });
  if (pend.length) { modo = 'completar'; draftId = pend[0].draft_id; tipoEntidad = pend[0].entidad === 'articulo' ? 'articulo' : 'producto'; }
}
// Entrada de los sub-workflows: campos del trabajo en el primer nivel + el mismo objeto en "trabajo".
const entrada = Object.assign({}, t, { trabajo: t, modo: modo, tipo_entidad: tipoEntidad, draft_id: draftId });
return [{ json: Object.assign({}, e, { entrada: entrada }) }];

//// Por mensaje
const p = $input.first().json;
if (!p.hay) return [{ json: { update_id: -1, estado_previo: 'nuevo', intentos: 0 } }];
return p.filas.map(function (f) { return { json: f }; });

//// Reunir
// Si no se pudo pasar ninguna fila a "procesando" (ya la tomó otro), no se hace nada.
const p = $('Preparar trabajo').first().json;
const tomados = $input.all().filter(function (i) { return i.json && i.json.id !== undefined; }).length;
if (!p.hay || tomados === 0) return [{ json: { ruta: 'nada' } }];
return [{ json: Object.assign({ ruta: p.ruta }, p.entrada) }];

//// Mensaje fijo
// @incluir comun
const t = $input.first().json;
const textos = {
  voz: 'Aún no entiendo audios.\nSiguiente paso: escríbeme el mensaje o envía una foto.',
  documento: 'Recibí un archivo. Si es una foto, reenvíala como foto (así se borran los datos de ubicación).\nSiguiente paso: reenvíala como foto.',
  otro: 'Solo entiendo texto, fotos y comandos.\nSiguiente paso: escribe /ayuda para ver la lista.'
};
return [{ json: enviar(t.chat_id, textos[t.tipo] || textos.otro) }];

//// Resultado
// @incluir comun
// Sub-workflow: {ok:true} = hecho; {ok:false, reintentar:true} o excepción = vuelve a "nuevo" (máx. 3 intentos);
// {ok:false} sin reintentar = error definitivo (el sub ya le avisó al usuario).
const p = $('Preparar trabajo').first().json;
const r = $('Reunir').first().json;
const nada = [{ json: { update_id: -1, estado: 'procesando', intentos: 0, error: '', aviso: null } }];
if (!p.hay || r.ruta === 'nada') return nada;
const s = ($input.first() && $input.first().json) || {};
let ok = true;
let reintentar = false;
let error = '';
if (p.ruta === 'rechazado') { ok = false; error = 'no autorizado'; }
else if (p.ruta !== 'fijo') {
  if (s.error !== undefined && s.ok === undefined) {
    ok = false; reintentar = true;
    error = typeof s.error === 'string' ? s.error : (s.error && (s.error.message || s.error.description)) || 'error en el sub-workflow';
  } else if (s.ok === false) { ok = false; reintentar = s.reintentar === true; error = String(s.error || 'no se pudo procesar'); }
}
error = censurar(error).replace(/\s+/g, ' ').slice(0, 300);
const items = p.filas.map(function (f) {
  if (ok) return { update_id: f.update_id, estado: 'hecho', intentos: f.intentos, error: '' };
  const n = f.intentos + 1;
  return { update_id: f.update_id, estado: reintentar && n < 3 ? 'nuevo' : 'error', intentos: n, error: error };
});
const definitivo = !ok && reintentar && !items.some(function (i) { return i.estado === 'nuevo'; });
items[0].aviso = definitivo
  ? enviar(p.trabajo.chat_id, 'No pude procesar tu mensaje tras 3 intentos (' + h(error.slice(0, 150)) + ').\nSiguiente paso: inténtalo de nuevo en unos minutos; si se repite, avisa al admin.')
  : null;
return items.map(function (j) { return { json: j }; });

//// Aviso de fallo
const a = $('Resultado').first().json.aviso;
return a ? [{ json: a }] : [];

//// Decidir lote
// Publica (WF5 modo lote) si hay borradores aprobados, no hay pausa y pasaron >= MIN_ENTRE_COMMITS_MS desde el último commit.
const cfg = $('Config').first().json;
const hay = $input.all().some(function (i) { return i.json && i.json.draft_id; });
const lote = hay && cfg.PAUSA !== 1 && Date.now() - cfg.ULTIMO_COMMIT_AT >= cfg.MIN_ENTRE_COMMITS_MS;
return [{ json: { lote: lote, modo: 'lote', origen: 'worker' } }];
