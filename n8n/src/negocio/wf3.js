//// Config
// @incluir comun
// WF3 sigue aunque falte el token: el borrador se guarda igual; los mensajes a Telegram fallarán en silencio.
return [{ json: armarConfig($input.all().map(function (i) { return i.json; })) }];

//// Preparar
// Entrada (WF2 o WF4): campos del trabajo + trabajo + modo (llm|completar|operacion) + tipo_entidad + operacion? + draft_id?
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
const modo = ['llm', 'completar', 'operacion'].indexOf(e.modo) >= 0 ? e.modo : 'llm';
const op = modo === 'operacion' && e.operacion && typeof e.operacion === 'object' ? e.operacion : null;
const tipo = (op ? op.entidad === 'articulo' : e.tipo_entidad === 'articulo') ? 'articulo' : 'producto';
const fotos = (Array.isArray(t.fotos) ? t.fotos : []).filter(function (f) { return f && f.file_id; }).slice(0, 6)
  .map(function (f, i) { return { n: i + 1, file_id: String(f.file_id), file_unique_id: String(f.file_unique_id || '') }; });
const previo = modo === 'completar' && /^drf-[a-z0-9]{6,20}$/.test(String(e.draft_id || '')) ? String(e.draft_id) : '';
const nuevo = 'drf-' + Date.now().toString(36) + (Math.random().toString(36).slice(2) + '00').slice(0, 2);
return [{ json: {
  modo: modo, tipo: tipo, operacion: op, texto: String(t.texto || '').slice(0, 2000), fotos: tipo === 'articulo' ? [] : fotos,
  chat_id: Number(t.chat_id) || 0, from_id: Number(t.from_id) || 0, rol: String(t.rol || ''), nombre: String(t.nombre || '').slice(0, 60),
  update_ids: Array.isArray(t.update_ids) ? t.update_ids.map(Number) : [], origen: ['telegram', 'form', 'panel'].indexOf(t.origen) >= 0 ? t.origen : 'telegram',
  draft_previo: previo, draft_id: previo || nuevo
} }];

//// Catalogo
// @incluir comun
// @incluir negocio
// Los tres JSON del repo (rama configurada). Sin catálogo no se puede validar ni mostrar el "antes": se reintenta (WF2, máx. 3).
const docs = { productos: nbDoc($('GET productos').first().json), articulos: nbDoc($('GET articulos').first().json), sitio: nbDoc($('GET sitio').first().json) };
const P = docs.productos && Array.isArray(docs.productos.productos) ? docs.productos.productos : null;
const A = docs.articulos && Array.isArray(docs.articulos.articulos) ? docs.articulos.articulos : null;
const S = docs.sitio && typeof docs.sitio === 'object' ? docs.sitio : null;
if (!P || !A || !S) {
  const cod = function (n) { const r = $(n).first().json || {}; return n.replace('GET ', '') + ' HTTP ' + (r.statusCode || 'sin respuesta'); };
  return [{ json: { ok: false, motivo: 'no pude leer el catálogo de GitHub (' + [cod('GET productos'), cod('GET articulos'), cod('GET sitio')].join(', ') + ')' } }];
}
return [{ json: { ok: true, productos: P, articulos: A, sitio: S } }];

//// Salida sin catalogo
// @incluir comun
return [{ json: { ok: false, reintentar: true, error: censurar($input.first().json.motivo || 'sin catálogo').slice(0, 300) } }];

//// Fotos a descargar
return $('Preparar').first().json.fotos.map(function (f) { return { json: f }; });

//// Fotos procesadas
// Binario WebP (Edit Image: máx. 1200 px, calidad por defecto de gm) -> base64 + ancho/alto leídos de la cabecera RIFF. Fallidas = ok:false.
const pedidas = $('Fotos a descargar').all().map(function (i) { return i.json; });
const items = $input.all();
function dims(b) {
  if (!b || b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const f = b.toString('ascii', 12, 16);
  if (f === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (f === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (f === 'VP8L') { const bits = b.readUInt32LE(21); return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 }; }
  return null;
}
const fotos = [];
for (let i = 0; i < pedidas.length; i++) {
  const p = pedidas[i];
  const it = items[i];
  let buf = null;
  try { if (it && it.binary && it.binary.data) buf = await this.helpers.getBinaryDataBuffer(i, 'data'); } catch (e) { buf = null; }
  const d = dims(buf);
  if (!d || buf.length > 5000000) { fotos.push({ n: p.n, ok: false, file_id: p.file_id, file_unique_id: p.file_unique_id }); continue; }
  fotos.push({ n: p.n, ok: true, file_id: p.file_id, file_unique_id: p.file_unique_id, b64: buf.toString('base64'), mime: 'image/webp', ancho: d.w, alto: d.h, bytes: buf.length });
}
return [{ json: { fotos: fotos } }];

//// Cuerpo Ollama
// @incluir validar.js
// @incluir comun
// @incluir negocio
// @incluir prompts
// Petición a /api/chat: format = esquema del LLM (data/schema/ollama-format-*.json), think:false, num_ctx 8192, prompt de n8n/prompts/extraccion.md.
// "completar": el texto original del borrador + lo que el dueño acaba de responder (sin volver a mandar las fotos).
const cfg = $('Config').first().json;
const p = $('Preparar').first().json;
const cat = $('Catalogo').first().json;
const fotos = nbEjecutado('Fotos procesadas') ? ($('Fotos procesadas').first().json.fotos || []).filter(function (f) { return f.ok; }) : [];
const previo = $('Leer borrador previo').all().map(function (i) { return i.json; })
  .find(function (b) { return b && b.draft_id && b.draft_id === p.draft_previo && b.estado === 'pendiente' && Number(b.owner_id) === p.from_id; }) || null;
let texto = p.texto.trim();
let hayFoto = fotos.length > 0;
if (previo) {
  texto = (String(previo.texto || '').trim() + '\nDatos que faltaban: ' + texto).trim();
  hayFoto = nbJSON(previo.file_ids, []).length > 0;
} else if (!texto && hayFoto) texto = '(El dueño envió solo la foto, sin texto.)';
const cuerpo = nbCuerpo({ tipo: p.tipo, texto: texto, imagenes: fotos.slice(0, 3).map(function (f) { return f.b64; }), productos: cat.productos, modelo: cfg.OLLAMA_MODELO });
return [{ json: { cuerpo: cuerpo, texto_ia: texto, hayFoto: hayFoto, completar: !!previo } }];

//// Validar IA
// @incluir validar.js
// @incluir comun
// @incluir negocio
// validarOperacion(): esquema, corrección determinista (categoría, campos por operación, "crear" si el texto no pide un cambio).
// Si corrigió a "crear" se repite UNA vez la llamada con la nota "es un producto NUEVO".
return [{ json: nbEvaluarIA($input.first().json, $('Cuerpo Ollama').first().json, $('Catalogo').first().json, null) }];

//// Validar reintento
// @incluir validar.js
// @incluir comun
// @incluir negocio
// Segunda (y última) respuesta. Si falla o sale peor, se queda la primera ya corregida.
return [{ json: nbEvaluarIA($input.first().json, $('Cuerpo Ollama').first().json, $('Catalogo').first().json, $('Validar IA').first().json) }];

//// Armar borrador
// @incluir validar.js
// @incluir comun
// @incluir negocio
// Decide: borrador nuevo (accion "crear"), completar uno existente ("actualizar") o solo responder ("mensaje").
// Permisos con el rol ACTUAL (WF2 lo recalcula). Faltantes bloqueantes = los obligatorios de la operación.
const p = $('Preparar').first().json;
const cat = $('Catalogo').first().json;
const fotos = nbEjecutado('Fotos procesadas') ? ($('Fotos procesadas').first().json.fotos || []) : [];
const fotosOk = fotos.filter(function (f) { return f.ok; });
const previo = $('Leer borrador previo').all().map(function (i) { return i.json; })
  .find(function (b) { return b && b.draft_id && b.draft_id === p.draft_previo && b.estado === 'pendiente' && Number(b.owner_id) === p.from_id; }) || null;
const completar = p.modo === 'completar' && !!previo;
const ia = nbEjecutado('Validar reintento') ? $('Validar reintento').first().json : nbEjecutado('Validar IA') ? $('Validar IA').first().json : null;
const cuerpoIA = nbEjecutado('Cuerpo Ollama') ? $('Cuerpo Ollama').first().json : { texto_ia: p.texto };
const out = { accion: 'mensaje', draft_id: 'ninguno', mensajes: [], fila: null, imagenes: [] };
const salir = function (texto) { out.mensajes.push(enviar(p.chat_id, texto)); return [{ json: out }]; };
const ctx = { texto: cuerpoIA.texto_ia, productos: cat.productos, articulos: cat.articulos, hayFoto: completar ? nbJSON(previo.file_ids, []).length > 0 : fotosOk.length > 0 };
const extra = [];
let r;
let explicito = false;
if (p.modo === 'operacion') {
  r = nbEvaluarOperacion(p.operacion, cat, p.texto, fotosOk.length);
  if (r.mensaje) return salir(r.mensaje);
} else if (!ia || ia.estado === 'ia_caida') {
  if (p.tipo === 'articulo') return salir('La IA local no responde y no puedo redactar el artículo ahora.\nSiguiente paso: vuelve a intentar /articulo en unos minutos.');
  const pl = nbPlantilla(p.texto);
  if (!completar && !pl && pideCambio(p.texto) && !fotosOk.length) {
    return salir('La IA local no responde. Para cambios usa los comandos: /precio prd-0001 69.90, /stock prd-0001 Blanco 5, /frescura prd-0001 5, /ocultar prd-0001.\nSiguiente paso: usa un comando o inténtalo de nuevo en unos minutos.');
  }
  explicito = true;
  r = validarOperacion(pl || nbOpVacia('producto'), ctx);
  extra.push('La IA local no responde: llené solo lo que entendí. Copia, completa y envíame:\n<code>' + h(NB_PLANTILLA) + '</code>');
} else r = ia.v;
if (completar && r && r.operacion) {
  const fusion = nbFusionar(nbOpDeFila(previo), r.operacion, explicito);
  const avisosIA = r.avisos || [];
  r = validarOperacion(fusion, ctx);
  r.avisos = avisosIA.filter(function (a) { return /^\[(categoria|stock|tallas|colores)]/.test(a); }).concat(r.avisos);
}
const o = r ? r.operacion : null;
if (o) {
  const accion = nbPermiso(o.op, o.entidad, o.campos);
  if (!puede(p.rol, accion)) return salir('Tu rol (' + h(p.rol || 'sin rol') + ') no puede hacer este cambio (' + h(accion) + ').\nSiguiente paso: pídeselo al dueño o al admin.');
}
const errores = ((r && r.errores) || []).concat(r && r.ok && o ? nbPostChequeo(o, cat) : []);
if (errores.length) {
  const lista = errores.slice(0, 3).map(function (x) { return '- ' + h(nbLimpiarAviso(x)); }).join('\n');
  return salir('No pude preparar el borrador:\n' + lista + '\nSiguiente paso: ' + (p.modo === 'operacion'
    ? 'revisa el id con /lista o /ver y vuelve a intentarlo.'
    : completar ? 'envía de nuevo solo los datos que faltan.' : 'escríbelo de otra forma (ej.: Polo de lino para hombre, 59.90, tallas S M L, azul) o usa un comando como /precio.'));
}
if (!o) return salir('No pude entender el mensaje.\nSiguiente paso: escríbelo de otra forma (ej.: Polo de lino para hombre, 59.90, tallas S M L, azul).');
o.faltantes = nbBloqueantes(o);
// Si el texto ya dice la categoría (inferirCategoria), no es "sugerida por IA".
if (o.entidad === 'producto' && o.campos.categoria && inferirCategoria(ctx.texto) === o.campos.categoria) o.campos_inferidos = (o.campos_inferidos || []).filter(function (k) { return k !== 'categoria'; });
// Igual con la tela y los colores escritos en el mensaje ("Polo de lino blanco y arena"): los dijo el dueño, no la IA.
if (o.entidad === 'producto' && o.op === 'crear') {
  const tn = ' ' + claveColor(ctx.texto).replace(/[^a-z0-9ñ]+/g, ' ') + ' ';
  const dicho = function (v) { const k = claveColor(v).replace(/[^a-z0-9ñ]+/g, ' ').trim(); return !!k && tn.indexOf(' ' + k + ' ') >= 0; };
  o.campos_inferidos = (o.campos_inferidos || []).filter(function (k) {
    if (k === 'material') return !dicho(o.campos.material);
    if (k === 'colores') return !(Array.isArray(o.campos.colores) && o.campos.colores.length && o.campos.colores.every(dicho));
    return true;
  });
}
if (o.entidad === 'articulo' && o.faltantes.length) {
  return salir('No pude redactar un artículo con ese tema (falta: ' + h(o.faltantes.map(function (f) { return NB_ETIQUETA[f] || f; }).join(', ')) + ').\nSiguiente paso: escribe /articulo seguido de un tema claro, por ejemplo /articulo cómo lavar el lino.');
}
const usaFotos = o.entidad === 'producto' && (o.op === 'crear' || o.op === 'agregar_imagen');
if (o.op === 'agregar_imagen' && !completar && !fotosOk.length) return salir('No me llegó la foto (o no pude descargarla).\nSiguiente paso: envía la foto con la leyenda /foto ' + h(o.id || 'prd-0001') + '.');
const avisos = (r.avisos || []).slice();
if (fotos.length > fotosOk.length) avisos.push('No pude descargar ' + (fotos.length - fotosOk.length) + ' foto(s); reenvíalas luego con /foto.');
if (fotosOk.length && !usaFotos) avisos.push('La foto no se usa en este cambio; para agregarla envíala con la leyenda /foto ' + (o.id || 'prd-0001') + '.');
if (completar && previo.preview_message_id) out.mensajes.push(quitarTeclado(p.chat_id, previo.preview_message_id));
const draftId = completar ? previo.draft_id : p.draft_id;
const nFotos = completar ? nbJSON(previo.file_ids, []).length : (usaFotos ? fotosOk.length : 0);
const vp = nbVistaPrevia({ draft_id: draftId, op: o, cat: cat, avisos: avisos, faltantes: o.faltantes, nFotos: nFotos, extra: extra });
out.mensajes.push(Object.assign(enviar(p.chat_id, vp.texto, botones(vp.teclado)), { guardar_preview: true }));
const ahora = Date.now();
const campos = JSON.stringify(o.campos);
const texto = (completar ? cuerpoIA.texto_ia : p.texto).slice(0, 2000);
const req = NB_DOBLE.indexOf(o.op) >= 0 ? 2 : 1;
out.draft_id = draftId;
if (completar) {
  out.accion = 'actualizar';
  out.fila = { draft_id: draftId, op: o.op, entidad: o.entidad, entidad_id: o.id || '', campos: campos, campos_inferidos: JSON.stringify(o.campos_inferidos || []),
    faltantes: JSON.stringify(o.faltantes), avisos: JSON.stringify(avisos.map(nbLimpiarAviso).slice(0, 10)), texto: texto, resumen: vp.resumen, confirmaciones_requeridas: req };
} else {
  out.accion = 'crear';
  const fotosUsadas = usaFotos ? fotosOk : [];
  out.fila = {
    draft_id: draftId, owner_id: p.from_id, rol: p.rol, chat_id: p.chat_id, preview_message_id: 0, origen: p.origen, op: o.op, entidad: o.entidad,
    entidad_id: o.id || '', campos: campos, campos_inferidos: JSON.stringify(o.campos_inferidos || []), faltantes: JSON.stringify(o.faltantes),
    avisos: JSON.stringify(avisos.map(nbLimpiarAviso).slice(0, 10)), update_ids: JSON.stringify(p.update_ids),
    file_ids: JSON.stringify(fotosUsadas.map(function (f) { return f.file_id; })), file_unique_ids: JSON.stringify(fotosUsadas.map(function (f) { return f.file_unique_id; })),
    fecha: isoLima(ahora), expira: isoLima(ahora + 86400000), estado: 'pendiente', confirmaciones: 0, confirmaciones_requeridas: req,
    intentos: 0, error: '', commit_sha: '', texto: texto, resumen: vp.resumen, fecha_ms: ahora
  };
  const alt = o.campos.alt_imagen || o.campos.nombre || (cat.productos.find(function (x) { return x.id === o.id; }) || {}).nombre || 'Prenda de Palmera Brava';
  out.imagenes = fotosUsadas.map(function (f, i) {
    return { draft_id: draftId, n: i + 1, b64: f.b64, mime: f.mime, ancho: f.ancho, alto: f.alto, origen: 'foto', alt: textoSeguro(alt, 160), file_unique_id: f.file_unique_id };
  });
}
return [{ json: out }];

//// Fila nueva
// Exactamente las columnas de pb_borradores (Insert con autoMap).
return [{ json: $('Armar borrador').first().json.fila }];

//// Filas imagenes
const a = $('Armar borrador').first().json;
if (a.accion !== 'crear' || !a.imagenes.length) return [{ json: { nada: true } }];
return a.imagenes.map(function (f) { return { json: f }; });

//// Mensajes
// @incluir comun
// Completar: si el UPDATE no tocó ninguna fila, el borrador dejó de estar pendiente (lo cancelaron): no se manda la vista previa.
const a = $('Armar borrador').first().json;
let msgs = a.mensajes;
if (a.accion === 'actualizar') {
  let ok = false;
  try { ok = $('Actualizar borrador').all().some(function (i) { return i.json && i.json.id !== undefined; }); } catch (e) { ok = false; }
  if (!ok) msgs = [Object.assign(enviar(a.mensajes[a.mensajes.length - 1].cuerpo.chat_id, 'Ese borrador ya no estaba pendiente; no cambié nada.\nSiguiente paso: envía el producto completo de nuevo.'), { sin_borrador: true })];
}
return msgs.map(function (m) { return { json: m }; });

//// Preview enviado
// message_id de la vista previa -> preview_message_id (WF5 solo acepta botones de esa vista previa).
const a = $('Armar borrador').first().json;
const env = $('Mensajes').all().map(function (i) { return i.json; });
const resp = $input.all().map(function (i) { return i.json || {}; });
let pid = 0;
let fallo = '';
for (let i = 0; i < env.length; i++) {
  if (!env[i].guardar_preview) continue;
  const r = resp[i] || {};
  if (r.ok === true && r.result && r.result.message_id) pid = Number(r.result.message_id);
  else fallo = String(r.description || (r.error && (r.error.message || r.error)) || 'sin respuesta');
}
// Borrador NUEVO cuya vista previa no salió: queda en "error" (nadie puede aprobarlo y WF2 reintenta creando otro);
// así no se acumulan "pendiente" sin botones que luego "completar" tomaría por error.
const crearFallido = a.accion === 'crear' && !pid;
return [{ json: {
  draft_id: (pid && a.accion !== 'mensaje') || crearFallido ? a.draft_id : 'ninguno', preview_message_id: pid,
  estado: crearFallido ? 'error' : 'pendiente', error: crearFallido ? 'vista previa no enviada' : '', fallo: fallo
} }];

//// Salida
// @incluir comun
// Salida común de los sub-workflows: {ok, draft_id} | {ok:false, reintentar:true, error} (WF2 reintenta hasta 3 veces).
const a = $('Armar borrador').first().json;
const pe = $('Preview enviado').first().json;
if (a.accion !== 'mensaje' && !pe.preview_message_id && pe.fallo) {
  return [{ json: { ok: false, reintentar: true, draft_id: a.draft_id, error: censurar('no pude enviar la vista previa: ' + pe.fallo).slice(0, 300) } }];
}
return [{ json: { ok: true, draft_id: a.accion === 'mensaje' ? '' : a.draft_id, accion: a.accion } }];
