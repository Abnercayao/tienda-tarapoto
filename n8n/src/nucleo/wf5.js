//// Config
// @incluir comun
// WF5 sigue aunque falte el token (la cadena de GitHub no lo necesita); los avisos a Telegram fallarán en silencio.
return [{ json: armarConfig($input.all().map(function (i) { return i.json; })) }];

//// Modo
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
let modo = String(e.modo || '');
if (!modo && t.callback && t.callback.data) modo = 'callback';
return [{ json: { modo: modo } }];

//// Salida desconocida
return [{ json: { ok: false, error: 'WF5: modo desconocido (usa callback, lote o historial)' } }];

//// Parsear callback
// callback_data (<= 64 bytes): pub:<draft> | no:<draft> | ok2:<draft> | dst:<draft>:hero|portada|look
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
const data = String((t.callback && t.callback.data) || '');
const m = /^(pub|no|ok2):(drf-[a-z0-9]{6,20})$/.exec(data) || /^(dst):(drf-[a-z0-9]{6,20}):(hero|portada|look)$/.exec(data);
return [{ json: m ? { valido: true, accion: m[1], draft_id: m[2], destino: m[3] || '' } : { valido: false, accion: '', draft_id: 'ninguno', destino: '' } }];

//// Verificar
// @incluir validar.js
// @incluir comun
// D2: solo el AUTOR del borrador, desde la vista previa VIGENTE, con el borrador en "pendiente" y con permiso del rol ACTUAL.
const cfg = $('Config').first().json;
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
const p = $('Parsear callback').first().json;
const b = $input.all().map(function (i) { return i.json; }).find(function (j) { return j && j.draft_id === p.draft_id; }) || null;
const cb = t.callback || {};
const base = { draft_id: p.draft_id, chat_id: Number(t.chat_id), message_id: Number(cb.message_id) || 0, accion: 'alerta', texto: '', b: b, pausa: cfg.PAUSA };
const salir = function (texto) { return [{ json: Object.assign(base, { accion: 'alerta', texto: texto }) }]; };
const ajeno = 'Este borrador no es tuyo o ya no está pendiente.\nSiguiente paso: usa tus propios borradores.';
if (!p.valido) return salir('No entendí ese botón.\nSiguiente paso: usa los botones del mensaje más reciente.');
if (!b || Number(b.owner_id) !== Number(t.from_id) || b.estado !== 'pendiente') return salir(ajeno);
if (Number(b.preview_message_id) !== base.message_id) return salir('Ese botón es de una vista previa anterior.\nSiguiente paso: usa los botones del mensaje más reciente.');
const expira = Date.parse(b.expira || '');
if (Number.isFinite(expira) && expira < Date.now()) return [{ json: Object.assign(base, { accion: 'cerrar', nuevo_estado: 'expirado' }) }];
let campos = {};
try { campos = JSON.parse(b.campos || '{}') || {}; } catch (x) { campos = {}; }
const envuelto = campos && typeof campos.campos === 'object' && campos.campos !== null;
const interno = envuelto ? campos.campos : campos;
const permiso = ({ eliminar: 'borrar', limpiar_muestras: 'limpiar_muestras', deshacer: 'deshacer', whatsapp: 'whatsapp' })[b.op] ||
  (b.entidad === 'sitio' && interno.whatsapp !== undefined ? 'whatsapp'
    : b.op === 'agregar_imagen' && b.entidad !== 'producto' ? 'imagen'
      : b.entidad === 'articulo' ? 'articulo' : b.op);
if (!puede(t.rol, 'publicar') || !puede(t.rol, permiso)) {
  return salir('Tu rol (' + h(t.rol || 'sin rol') + ') no puede publicar este cambio (' + h(permiso) + ').\nSiguiente paso: pídeselo al dueño o al admin.');
}
const req = Number(b.confirmaciones_requeridas) === 2 ? 2 : 1;
const conf = Number(b.confirmaciones) || 0;
let faltantes = [];
try { faltantes = JSON.parse(b.faltantes || '[]'); } catch (x) { faltantes = ['?']; }
if (!Array.isArray(faltantes)) faltantes = ['?'];
if (p.accion === 'no') return [{ json: Object.assign(base, { accion: 'cerrar', nuevo_estado: 'cancelado' }) }];
if (p.accion === 'dst') {
  if (b.op !== 'agregar_imagen' || b.entidad === 'producto' || faltantes.indexOf('destino') < 0) return salir(ajeno);
  const objetivo = String(interno.objetivo || '');
  if (p.destino === 'portada' && !/^art-\d{4,6}$/.test(objetivo)) return salir('Para usarla como portada necesito saber de qué artículo.\nSiguiente paso: usa /imagen art-0001 seguido de la descripción.');
  if (p.destino === 'look' && !/^look-\d{1,3}$/.test(objetivo)) return salir('Para usarla en el lookbook necesito saber qué look.\nSiguiente paso: usa /imagen look-1 seguido de la descripción.');
  const nuevos = Object.assign({}, interno, { destino: p.destino });
  return [{ json: Object.assign(base, {
    accion: 'destino',
    campos_nuevos: JSON.stringify(envuelto ? Object.assign({}, campos, { campos: nuevos }) : nuevos),
    entidad_nueva: p.destino === 'portada' ? 'articulo' : 'sitio',
    entidad_id_nuevo: p.destino === 'portada' ? objetivo : 'site'
  }) }];
}
if (p.accion === 'pub' || p.accion === 'ok2') {
  if (faltantes.length) return salir('Aún falta: ' + h(faltantes.join(', ')) + '.\nSiguiente paso: envía los datos que faltan.');
  if (p.accion === 'pub' && req === 2 && conf === 0) return [{ json: Object.assign(base, { accion: 'confirmar1' }) }];
  if ((p.accion === 'pub' && req === 1 && conf === 0) || (p.accion === 'ok2' && req === 2 && conf === 1)) {
    return [{ json: Object.assign(base, { accion: 'aprobar', conf_previa: conf, conf_nueva: req }) }];
  }
}
return salir(ajeno);

//// Respuestas
// @incluir comun
// Arma los mensajes según la acción y si la transición de estado afectó 1 fila (0 filas = alguien llegó antes: no se hace nada).
const v = $('Verificar').first().json;
const ok = v.accion !== 'alerta' && $input.all().some(function (i) { return i.json && i.json.id !== undefined; });
const ajeno = 'Este borrador no es tuyo o ya no está pendiente.\nSiguiente paso: usa tus propios borradores.';
const b = v.b || {};
const out = [];
const marca = function (m, extra) { return Object.assign(m, extra || {}); };
if (v.accion === 'alerta') out.push(enviar(v.chat_id, v.texto));
else if (!ok) out.push(enviar(v.chat_id, ajeno));
else {
  out.push(quitarTeclado(v.chat_id, v.message_id));
  if (v.accion === 'cerrar') {
    out.push(enviar(v.chat_id, v.nuevo_estado === 'expirado'
      ? 'Este borrador venció (más de 24 h) y no se publicó.\nSiguiente paso: envía el cambio de nuevo.'
      : 'Borrador cancelado; no se publicó nada.\nSiguiente paso: envía otro mensaje cuando quieras.'));
  } else if (v.accion === 'confirmar1') {
    const nombres = { eliminar: 'ELIMINAR', limpiar_muestras: 'QUITAR TODOS LOS PRODUCTOS DE MUESTRA', deshacer: 'DESHACER el último cambio publicado', whatsapp: 'CAMBIAR EL WHATSAPP de la tienda' };
    const accion = (nombres[b.op] || (b.entidad === 'sitio' ? nombres.whatsapp : String(b.op || '').toUpperCase())) + (b.entidad_id ? ' ' + b.entidad_id : '') + (b.resumen ? ': ' + b.resumen : '');
    out.push(marca(enviar(v.chat_id, 'Vas a ' + h(accion) + '.\nSiguiente paso: toca Confirmar para aprobarlo o ignora este mensaje.',
      botones([[{ text: 'Confirmar', callback_data: 'ok2:' + v.draft_id }, { text: 'Cancelar', callback_data: 'no:' + v.draft_id }]])), { guardar_preview: true }));
  } else if (v.accion === 'aprobar') {
    out.push(enviar(v.chat_id, v.pausa === 1
      ? 'Aprobado, pero la publicación está en pausa.\nSiguiente paso: usa /reanudar para publicar.'
      : 'Aprobado. Se publica en el próximo lote (máx. 6 min) y la web cambia 1–10 min después.\nSiguiente paso: nada; te aviso cuando esté publicado.'));
  } else if (v.accion === 'destino') {
    const donde = v.entidad_nueva === 'articulo' ? 'portada de ' + v.entidad_id_nuevo : (JSON.parse(v.campos_nuevos).destino === 'look' ? 'lookbook' : 'portada de la web (hero)');
    out.push(marca(enviar(v.chat_id, 'Borrador ' + h(v.draft_id) + ': imagen referencial (IA) para ' + h(donde) + '.\nSiguiente paso: toca Publicar si todo está bien, o Cancelar.',
      botones([[{ text: 'Publicar', callback_data: 'pub:' + v.draft_id }, { text: 'Cancelar', callback_data: 'no:' + v.draft_id }]])), { guardar_preview: true }));
  }
}
out[0].ok_update = ok;
return out.map(function (m) { return { json: m }; });

//// Nuevo preview
// Si se envió una vista previa nueva (doble confirmación o destino de imagen), su message_id pasa a preview_message_id.
const v = $('Verificar').first().json;
const enviados = $('Respuestas').all().map(function (i) { return i.json; });
const resp = $input.all().map(function (i) { return i.json || {}; });
for (let i = 0; i < enviados.length; i++) {
  const r = resp[i] || {};
  if (enviados[i].guardar_preview && r.ok === true && r.result && r.result.message_id) return [{ json: { draft_id: v.draft_id, preview_message_id: Number(r.result.message_id) } }];
}
return [{ json: { draft_id: 'ninguno', preview_message_id: 0 } }];

//// Imagenes cancelado
// Borrador cancelado o vencido: sus imágenes ya no sirven.
const v = $('Verificar').first().json;
const r = $('Respuestas').first().json;
return [{ json: { draft_id: v.accion === 'cerrar' && r.ok_update ? v.draft_id : 'ninguno' } }];

//// Salida callback
const v = $('Verificar').first().json;
return [{ json: { ok: true, accion: v.accion, draft_id: v.draft_id } }];

//// Historial
// @incluir comun
// D17: últimos 5 commits del bot + datos del HEAD (los usa WF4 para armar /deshacer con head_sha).
const cfg = $('Config').first().json;
const e = $('Entrada').first().json || {};
const t = e.trabajo || e;
const r = $input.first().json || {};
const quiereEnviar = Number(t.chat_id) > 0 && e.enviar !== false;
let resultado;
let texto;
if (r.statusCode !== 200 || !Array.isArray(r.body)) {
  texto = 'No pude leer el historial de GitHub (HTTP ' + h(r.statusCode || 'sin respuesta') + ').\nSiguiente paso: inténtalo de nuevo en unos minutos.';
  resultado = { ok: false, error: 'GET commits HTTP ' + (r.statusCode || 'sin respuesta'), texto: texto };
} else {
  const lista = r.body;
  const esBot = function (c) { return !!(c && c.commit && c.commit.author && c.commit.author.name === 'Tienda Bot'); };
  const primera = function (c) { return String((c && c.commit && c.commit.message) || '').split('\n')[0].slice(0, 200); };
  const fecha = function (iso) { const d = new Date(Date.parse(iso) - 5 * 3600000).toISOString(); return d.slice(8, 10) + '/' + d.slice(5, 7) + ' ' + d.slice(11, 16); };
  const delBot = lista.filter(esBot).slice(0, 5);
  const head = lista[0] || null;
  const headEsBot = esBot(head);
  texto = delBot.length
    ? 'Últimos cambios publicados por el bot:\n' + delBot.map(function (c, i) { return (i + 1) + '. ' + c.sha.slice(0, 7) + ' · ' + fecha(c.commit.author.date) + ' · ' + h(primera(c).slice(0, 120)); }).join('\n')
    : 'Todavía no hay cambios publicados por el bot.';
  if (head && !headEsBot) texto += '\nEl último cambio de ' + h(cfg.REPO_BRANCH) + ' no es del bot, así que /deshacer no está disponible.';
  texto += headEsBot ? '\nSiguiente paso: si el último cambio está mal, usa /deshacer (solo deshace el más reciente).' : '\nSiguiente paso: nada; aquí solo aparecen cambios del bot.';
  resultado = {
    ok: true, texto: texto,
    head_sha: head ? head.sha : '', head_es_bot: headEsBot, head_mensaje: primera(head),
    parent_sha: head && head.parents && head.parents[0] ? head.parents[0].sha : '',
    commits: delBot.map(function (c) { return { sha: c.sha, fecha: c.commit.author.date, mensaje: primera(c) }; })
  };
}
return [{ json: Object.assign({ enviar_mensaje: quiereEnviar, resultado: resultado }, quiereEnviar ? enviar(t.chat_id, texto) : {}) }];

//// Salida historial
return [{ json: $('Historial').first().json.resultado }];

//// Elegir lote
// Lote = todo lo "aprobado" (máx. 20, orden de llegada). Un /deshacer va SOLO en su lote. Respeta PAUSA y >= 6 min entre commits.
// "publicando" = huérfano de un WF5 que murió a mitad de la cadena (apagón, reinicio): solo WF2 llama al lote y con el lock,
// así que nadie más lo está publicando. Se reintenta (Aplicar lote salta lo que ya llegó al repo: borradores_aplicados)
// contando el intento; con 3 pasa a "error".
const cfg = $('Config').first().json;
const filas = $input.all().map(function (i) { return i.json; }).filter(function (j) { return j && j.draft_id && (j.estado === 'aprobado' || j.estado === 'publicando'); });
if (cfg.PAUSA === 1) return [{ json: { nada: true, motivo: 'pausa' } }];
if (Date.now() - cfg.ULTIMO_COMMIT_AT < cfg.MIN_ENTRE_COMMITS_MS) return [{ json: { nada: true, motivo: 'faltan minutos entre commits' } }];
const deshacer = filas.find(function (f) { return f.op === 'deshacer'; });
const lote = deshacer ? [deshacer] : filas.filter(function (f) { return f.op !== 'deshacer'; });
if (!lote.length) return [{ json: { nada: true, motivo: 'no hay borradores aprobados' } }];
return lote.map(function (f) {
  const huerfano = f.estado === 'publicando';
  const n = (Number(f.intentos) || 0) + (huerfano ? 1 : 0);
  const rendirse = huerfano && n >= 3;
  return { json: { draft_id: f.draft_id, estado_previo: f.estado, estado_nuevo: rendirse ? 'error' : 'publicando', intentos: n,
    error: rendirse ? 'la publicación se interrumpió 3 veces (n8n se detuvo a mitad del commit)' : String(f.error || '') } };
});

//// Sin lote
return [{ json: { ok: true, publicado: false, motivo: $input.first().json.motivo || 'nada que publicar' } }];

//// Tomados
// Solo entran al lote los borradores que ESTA ejecución pasó de aprobado a publicando (UPDATE ... WHERE estado = aprobado).
const aprobados = $('Leer aprobados').all().map(function (i) { return i.json; }).filter(function (j) { return j && j.draft_id; });
// (las filas que el UPDATE devolvió traen ya los intentos nuevos; un huérfano que se rindió vuelve como "error" y no entra)
const tomadas = {};
$input.all().map(function (i) { return i.json; }).filter(function (j) { return j && j.id !== undefined && j.draft_id && j.estado === 'publicando'; })
  .forEach(function (j) { tomadas[j.draft_id] = j; });
const lote = aprobados.filter(function (b) { return tomadas[b.draft_id]; })
  .map(function (b) { return Object.assign({}, b, { estado: 'publicando', intentos: Number(tomadas[b.draft_id].intentos) || 0 }); });
if (!lote.length) return [{ json: { draft_id: 'ninguno', lote: [] } }];
return lote.map(function (b, i) { return { json: i === 0 ? { draft_id: b.draft_id, lote: lote } : { draft_id: b.draft_id } }; });

//// Intento
// Contador de la cadena D5 (1..3). En un reintento llega desde "Esperar" con el número siguiente.
const j = $input.first().json || {};
return [{ json: { intento: Number(j.intento) > 0 ? Number(j.intento) : 1 } }];

//// Pedir archivos
// D5 pasos 1-2 ya hechos (ref y commit). Paso 3: los tres JSON en ESE sha (y en el padre si el lote es un /deshacer).
const ref = $('GET ref').first().json || {};
const com = $input.first().json || {};
const lote = $('Tomados').first().json.lote || [];
const head = ref.statusCode === 200 && ref.body && ref.body.object && /^[0-9a-f]{40}$/.test(ref.body.object.sha) ? ref.body.object.sha : null;
if (!head) return [{ json: { fallo: true, reintentable: true, motivo: 'GET ref HTTP ' + (ref.statusCode || 'sin respuesta') } }];
if (!(com.statusCode === 200 && com.body && com.body.tree && com.body.tree.sha)) return [{ json: { fallo: true, reintentable: true, motivo: 'GET commit HTTP ' + (com.statusCode || 'sin respuesta') } }];
const padre = com.body.parents && com.body.parents[0] ? com.body.parents[0].sha : '';
const autor = com.body.author && com.body.author.name ? com.body.author.name : '';
const pedidos = [];
['products', 'articles', 'site'].forEach(function (n) { pedidos.push({ nombre: n, cual: 'actual', ref: head }); });
if (lote.some(function (b) { return b.op === 'deshacer'; }) && padre) ['products', 'articles', 'site'].forEach(function (n) { pedidos.push({ nombre: n, cual: 'padre', ref: padre }); });
return pedidos.map(function (p) { return { json: Object.assign(p, { head: head, tree: com.body.tree.sha, padre: padre, autor: autor }) }; });

//// Aplicar lote
// @incluir validar.js
// @incluir comun
// D5 pasos 3-4: aplica cada borrador sobre el estado acumulado, valida POR BORRADOR (límites de daño, CONTRATO §7),
// salta los draft_id ya presentes en borradores_aplicados y valida el resultado final. Las imágenes llevan un nombre
// temporal (...-pbimgNNNN.webp) que "Arbol" cambia por <sha8> del blob.
const lote = $('Tomados').first().json.lote || [];
const imgs = $('Leer imagenes').all().map(function (i) { return i.json; }).filter(function (j) { return j && j.draft_id && j.b64; });
const pedidos = $('Pedir archivos').all().map(function (i) { return i.json; });
const resp = $input.all().map(function (i) { return i.json || {}; });
const ARCHIVOS = ['products', 'articles', 'site'];
const fin = function (resuelto, motivo, resultados) { return [{ json: { paso: 'fin', resuelto: resuelto, exito: resuelto, commit_sha: '', motivo: censurar(motivo || '').slice(0, 300), resultados: resultados || {} } }]; };

function parseJ(s, d) { if (s === null || s === undefined || s === '') return d; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch (e) { return d; } }
function r2(n) { return Math.round(Number(n) * 100) / 100; }
const ORDEN_PRODUCTO = ['id', 'slug', 'nombre', 'categoria', 'subcategoria', 'precio', 'precio_oferta', 'tallas', 'stock_por_talla', 'stock_por_color', 'stock', 'colores',
  'material', 'frescura', 'descripcion', 'etiquetas', 'imagenes', 'destacado', 'activo', 'muestra', 'fecha_creacion', 'fecha_actualizacion'];
const ORDEN_ARTICULO = ['id', 'slug', 'titulo', 'resumen', 'portada', 'bloques', 'productos_relacionados', 'autor', 'fecha', 'fecha_actualizacion', 'activo', 'muestra'];
function ordenar(o, orden) {
  const r = {};
  orden.forEach(function (k) { if (o[k] !== undefined) r[k] = o[k]; });
  Object.keys(o).forEach(function (k) { if (r[k] === undefined && o[k] !== undefined) r[k] = o[k]; });
  return r;
}
function slugUnico(base, lista, propio) {
  let s = String(base || '').slice(0, 74).replace(/-+$/, '');
  if (s.length < 3) s = (s ? s + '-' : '') + 'pb-' + Date.now().toString(36).slice(-4);
  const usados = new Set(lista.filter(function (x) { return x && x.id !== propio; }).map(function (x) { return x.slug; }));
  let c = s;
  let k = 2;
  while (usados.has(c)) c = s + '-' + (k++);
  return c;
}
function etiquetas(l) {
  const out = [];
  (Array.isArray(l) ? l : []).forEach(function (e) { const s = slugificar(e).slice(0, 24).replace(/-+$/, ''); if (s.length >= 2 && out.indexOf(s) < 0) out.push(s); });
  return out.slice(0, 10);
}
function colores(l) {
  const vistos = [];
  // Sin repetidos (claveColor), igual que pbNombresColor() de la vista previa: stock_por_color se indexa por nombre.
  return (Array.isArray(l) ? l : []).slice(0, 8).map(function (x) {
    const k = colorHex(typeof x === 'string' ? x : x && x.nombre);
    const hex = x && typeof x === 'object' && /^#[0-9A-Fa-f]{6}$/.test(x.hex || '') ? x.hex.toUpperCase() : k.hex;
    return { nombre: k.nombre, hex: hex };
  }).filter(function (c) { const q = claveColor(c.nombre); if (vistos.indexOf(q) >= 0) return false; vistos.push(q); return true; });
}
// v2: frescura 1..5 del borrador o, si no viene, la de la tabla por material (inferirFrescura de validar.js); null = sin índice.
function frescuraDe(c, base) {
  if (Number.isInteger(c.frescura) && c.frescura >= 1 && c.frescura <= 5) return c.frescura;
  return inferirFrescura({ material: base.material, nombre: base.nombre, etiquetas: base.etiquetas }).valor;
}
function sinCodigo(errores) { return errores.map(function (e) { return String(e).replace(/^\[[a-z_]+\]\s*/, ''); }).join('; '); }
function ordenTallas(l) { return TALLAS.filter(function (t) { return l.indexOf(t) >= 0; }); }
function nuevaImagen(ctx, carpeta, base, fila, alt, origen) {
  ctx.contador++;
  const tmp = carpeta + base + '-pbimg' + String(ctx.contador).padStart(4, '0') + '.webp';
  const obj = { src: tmp, alt: textoSeguro(alt, 160), origen: origen };
  if (Array.from(obj.alt).length < 5) obj.alt = 'Imagen de Palmera Brava';
  if (Number.isInteger(Number(fila.ancho)) && Number(fila.ancho) > 0) obj.ancho = Number(fila.ancho);
  if (Number.isInteger(Number(fila.alto)) && Number(fila.alto) > 0) obj.alto = Number(fila.alto);
  return { obj: obj, blob: { tmp: tmp, prefijo: carpeta + base + '-', b64: String(fila.b64 || '') } };
}
// eliminar / limpiar_muestras: quita las referencias en artículos (relacionados y bloques "producto") y en el lookbook.
function quitarReferencias(E, quitados, out, ctx) {
  const q = new Set(quitados);
  const A = E.articles.articulos;
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    const antes = JSON.stringify([a.productos_relacionados, a.bloques]);
    const n = Object.assign({}, a);
    if (Array.isArray(n.productos_relacionados)) n.productos_relacionados = n.productos_relacionados.filter(function (id) { return !q.has(id); });
    if (Array.isArray(n.bloques)) {
      n.bloques = n.bloques.map(function (bl) { return bl && bl.tipo === 'producto' ? Object.assign({}, bl, { ids: (bl.ids || []).filter(function (id) { return !q.has(id); }) }) : bl; })
        .filter(function (bl) { return !(bl && bl.tipo === 'producto' && !bl.ids.length); });
    }
    if (JSON.stringify([n.productos_relacionados, n.bloques]) !== antes) {
      n.fecha_actualizacion = ctx.ahora;
      A[i] = ordenar(n, ORDEN_ARTICULO);
      out.ids.push(a.id);
      if (out.archivos.indexOf('articles') < 0) out.archivos.push('articles');
    }
  }
  let tocaSitio = false;
  (E.site.lookbook || []).forEach(function (l) {
    const n = (l.productos || []).length;
    l.productos = (l.productos || []).filter(function (id) { return !q.has(id); });
    if (l.productos.length !== n) tocaSitio = true;
  });
  if (tocaSitio) { out.ids.push('site'); if (out.archivos.indexOf('site') < 0) out.archivos.push('site'); }
}
// Aplica UN borrador (CONTRATO §8) sobre E = {products, articles, site}. Devuelve {ok, errores, ids, archivos, imagenes, entidad_id, linea}.
function aplicarBorrador(E, b, fotos, ctx) {
  const out = { ok: true, errores: [], ids: [], archivos: [], imagenes: [], entidad_id: b.entidad_id || '', linea: '' };
  const falla = function (m) { return { ok: false, errores: ['[aplicar] ' + m] }; };
  const vacio = function (v) { return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length); };
  let c = parseJ(b.campos, {});
  if (c && typeof c === 'object' && c.campos && typeof c.campos === 'object' && (c.op || c.entidad)) c = c.campos;   // vino la operación completa
  if (!c || typeof c !== 'object' || Array.isArray(c)) c = {};
  const op = String(b.op || '');
  const ent = String(b.entidad || 'producto');
  const P = E.products && E.products.productos;
  const A = E.articles && E.articles.articulos;
  const S = E.site;
  if (!Array.isArray(P) || !Array.isArray(A) || !S || typeof S !== 'object') return falla('los JSON del repo no tienen la forma esperada');
  fotos = fotos.slice().sort(function (x, y) { return (Number(x.n) || 0) - (Number(y.n) || 0); });

  // --- /deshacer (D17): commit NUEVO que restaura data/* del padre, solo si HEAD sigue siendo el commit del bot que se pidió ---
  if (op === 'deshacer') {
    if (!c.head_sha || c.head_sha !== ctx.head) return falla('main cambió desde que pediste /deshacer; usa /historial y vuelve a pedirlo');
    if (ctx.autorHead !== 'Tienda Bot') return falla('el último commit de main no es del bot; /deshacer solo revierte cambios del bot');
    if (!ctx.padreSha || !ctx.padres.products || !ctx.padres.articles || !ctx.padres.site) return falla('no pude leer la versión anterior de data/');
    ARCHIVOS.forEach(function (n) {
      if (JSON.stringify(sinEnvoltura(ctx.padres[n])) === JSON.stringify(sinEnvoltura(E[n]))) return;
      const nuevo = JSON.parse(JSON.stringify(ctx.padres[n]));
      nuevo.version = E[n].version; nuevo.actualizado = E[n].actualizado; nuevo.borradores_aplicados = E[n].borradores_aplicados;
      E[n] = nuevo;
      out.archivos.push(n);
    });
    if (!out.archivos.length) return falla('el último commit no cambió data/: no hay nada que deshacer');
    out.entidad_id = ctx.head.slice(0, 7);
    out.linea = 'deshacer ' + ctx.head.slice(0, 7) + ' (vuelve a ' + ctx.padreSha.slice(0, 7) + ')';
    return out;
  }

  // --- imagen de /imagen (WF6) con destino elegido: hero, portada de artículo o look ---
  if (op === 'agregar_imagen' && ent !== 'producto') {
    const f = fotos[0];
    if (!f) return falla('no encontré la imagen del borrador en pb_imagenes');
    const origen = f.origen === 'foto' ? 'foto' : 'ia_local';
    const alt = c.alt || f.alt || c.prompt || 'Imagen de Palmera Brava';
    if (c.destino === 'hero') {
      const im = nuevaImagen(ctx, 'assets/img/brand/', 'hero', f, alt, origen);
      S.hero = S.hero || { imagenes: [] };
      S.hero.imagenes = [im.obj].concat(S.hero.imagenes || []).slice(0, 4);
      out.imagenes.push(im.blob); out.ids.push('site'); out.archivos.push('site'); out.entidad_id = 'site';
      out.linea = 'agregar_imagen site hero';
      return out;
    }
    if (c.destino === 'look') {
      const look = (S.lookbook || []).find(function (l) { return l.id === c.objetivo; });
      if (!look) return falla('no existe el look ' + String(c.objetivo || '?').slice(0, 20));
      const im = nuevaImagen(ctx, 'assets/img/lookbook/', look.id, f, alt, origen);
      look.imagen = im.obj;
      out.imagenes.push(im.blob); out.ids.push('site'); out.archivos.push('site'); out.entidad_id = look.id;
      out.linea = 'agregar_imagen site ' + look.id;
      return out;
    }
    if (c.destino === 'portada') {
      const i = A.findIndex(function (a) { return a.id === c.objetivo; });
      if (i < 0) return falla('no existe el artículo ' + String(c.objetivo || '?').slice(0, 20));
      const im = nuevaImagen(ctx, 'assets/img/blog/', A[i].slug, f, alt, origen);
      A[i] = ordenar(Object.assign({}, A[i], { portada: im.obj, fecha_actualizacion: ctx.ahora }), ORDEN_ARTICULO);
      out.imagenes.push(im.blob); out.ids.push(A[i].id); out.archivos.push('articles'); out.entidad_id = A[i].id;
      out.linea = 'agregar_imagen ' + A[i].id + ' portada';
      return out;
    }
    return falla('falta el destino de la imagen (hero, portada o look)');
  }

  // --- datos de la tienda: en v1 solo el WhatsApp (/whatsapp) ---
  if (ent === 'sitio') {
    if (op === 'whatsapp' || (op === 'actualizar' && c.whatsapp !== undefined)) {
      const w = String(c.whatsapp || '').replace(/\D/g, '');
      if (!/^51\d{9}$/.test(w)) return falla('el número de WhatsApp debe tener 11 dígitos y empezar por 51');
      S.whatsapp = w;
      S.telefono_visible = '+51 ' + w.slice(2, 5) + ' ' + w.slice(5, 8) + ' ' + w.slice(8);
      out.ids.push('site'); out.archivos.push('site'); out.entidad_id = 'site';
      out.linea = 'actualizar site whatsapp ' + w;
      return out;
    }
    return falla('cambio de datos de la tienda no soportado en v1 (' + op + ')');
  }

  // --- artículos ---
  if (ent === 'articulo') {
    if (op === 'crear') {
      const id = siguienteId(A, 'art');
      const titulo = textoSeguro(c.titulo, 110);
      if (Array.from(titulo).length < 5) return falla('falta el título del artículo');
      const slug = slugUnico(slugificar(titulo), A);
      const rel = (Array.isArray(c.productos_relacionados) ? c.productos_relacionados : [])
        .filter(function (x, i, l) { return l.indexOf(x) === i && P.some(function (p) { return p.id === x; }); }).slice(0, 8);
      const bloques = bloquesDesdeLLM(c.bloques);
      if (rel.length) bloques.push({ tipo: 'producto', ids: rel.slice(0, 4) });
      let portada;
      if (fotos.length) {
        const im = nuevaImagen(ctx, 'assets/img/blog/', slug, fotos[0], c.alt_portada || titulo, fotos[0].origen === 'foto' ? 'foto' : 'ia_local');
        portada = im.obj; out.imagenes.push(im.blob);
      } else {
        const heroes = (S.hero && S.hero.imagenes) || [];
        if (!heroes.length) return falla('no hay imagen para la portada (usa /imagen art-... y el botón Portada)');
        portada = JSON.parse(JSON.stringify(heroes[heroes.length - 1]));   // provisional: se cambia con /imagen + Portada
      }
      A.push(ordenar({ id: id, slug: slug, titulo: titulo, resumen: textoSeguro(c.resumen || titulo, 240), portada: portada, bloques: bloques,
        productos_relacionados: rel, autor: 'Equipo Palmera Brava', fecha: ctx.ahora, activo: true, muestra: false }, ORDEN_ARTICULO));
      out.ids.push(id); out.archivos.push('articles'); out.entidad_id = id;
      out.linea = 'crear ' + id + ' ' + textoSeguro(titulo, 50);
      return out;
    }
    const i = A.findIndex(function (a) { return a.id === b.entidad_id; });
    if (i < 0) return falla('el artículo ' + String(b.entidad_id || '?').slice(0, 20) + ' no existe');
    const a = JSON.parse(JSON.stringify(A[i]));
    if (op === 'desactivar' || op === 'reactivar') {
      if (a.activo === (op === 'reactivar')) return falla(op === 'reactivar' ? 'ya estaba visible' : 'ya estaba oculto');
      a.activo = op === 'reactivar';
    } else if (op === 'actualizar') {
      let n = 0;
      if (!vacio(c.titulo)) { a.titulo = textoSeguro(c.titulo, 110); n++; }
      if (!vacio(c.resumen)) { a.resumen = textoSeguro(c.resumen, 240); n++; }
      if (Array.isArray(c.bloques) && c.bloques.length) {
        const prod = (a.bloques || []).filter(function (bl) { return bl && bl.tipo === 'producto'; });
        a.bloques = bloquesDesdeLLM(c.bloques).concat(prod).slice(0, 60); n++;
      }
      if (Array.isArray(c.productos_relacionados) && c.productos_relacionados.length) {
        a.productos_relacionados = c.productos_relacionados.filter(function (x, k, l) { return l.indexOf(x) === k && P.some(function (p) { return p.id === x; }); }).slice(0, 8); n++;
      }
      if (!n) return falla('no hay ningún campo que cambiar');
    } else return falla('operación no soportada para artículos: ' + op);
    a.fecha_actualizacion = ctx.ahora;
    A[i] = ordenar(a, ORDEN_ARTICULO);
    out.ids.push(a.id); out.archivos.push('articles'); out.entidad_id = a.id;
    out.linea = op + ' ' + a.id;
    return out;
  }

  if (ent !== 'producto') return falla('entidad desconocida: ' + ent);
  // --- productos ---
  if (op === 'crear') {
    const id = siguienteId(P, 'prd');
    const nombre = textoSeguro(c.nombre, 70);
    if (Array.from(nombre).length < 3) return falla('falta el nombre');
    if (CATEGORIAS.indexOf(c.categoria) < 0) return falla('falta la categoría');
    if (!(typeof c.precio === 'number' && c.precio > 0)) return falla('falta el precio');
    const tallas = ordenTallas(Array.isArray(c.tallas) ? c.tallas : []);
    if (!tallas.length) return falla('faltan las tallas');
    const slug = slugUnico(slugificar(nombre), P);
    const p = { id: id, slug: slug, nombre: nombre, categoria: c.categoria, subcategoria: SUBCATEGORIAS.indexOf(c.subcategoria) >= 0 ? c.subcategoria : 'otros', precio: r2(c.precio) };
    if (typeof c.precio_oferta === 'number' && c.precio_oferta > 0) p.precio_oferta = r2(c.precio_oferta);
    p.tallas = tallas;
    p.colores = colores(c.colores);
    if (!p.colores.length) return falla('faltan los colores');
    // v2 (CONTRATO 0.3): stock_por_color es la fuente de verdad (sin stock_por_talla); lo mismo que mostró la vista previa.
    const st = Array.isArray(c.stock_tallas) ? c.stock_tallas.filter(function (s) { return s && tallas.indexOf(s.talla) >= 0; }) : [];
    const si = pbStockInicial(p.colores.map(function (x) { return x.nombre; }), c.stock_por_color, st);
    if (!si.ok) return falla(sinCodigo(si.errores));
    p.stock_por_color = si.spc; p.stock = stockTotal(p);
    if (!vacio(c.material)) { const m = textoSeguro(c.material, 60); if (Array.from(m).length >= 2) p.material = m; }
    p.descripcion = typeof c.descripcion === 'string' ? textoSeguro(c.descripcion, 600) : '';
    p.etiquetas = etiquetas(c.etiquetas);
    const fr = frescuraDe(c, p);
    if (fr !== null) p.frescura = fr;
    p.imagenes = [];
    fotos.slice(0, 6).forEach(function (f, i) {
      const im = nuevaImagen(ctx, 'assets/img/products/', slug + '-' + (i + 1), f, c.alt_imagen || f.alt || nombre, f.origen === 'ia_local' ? 'ia_local' : 'foto');
      p.imagenes.push(im.obj); out.imagenes.push(im.blob);
    });
    p.destacado = c.destacado === true; p.activo = true; p.muestra = false;
    p.fecha_creacion = ctx.ahora; p.fecha_actualizacion = ctx.ahora;
    P.push(p);
    out.ids.push(id); out.archivos.push('products'); out.entidad_id = id;
    out.linea = 'crear ' + id + ' ' + textoSeguro(nombre, 50);
    return out;
  }
  if (op === 'limpiar_muestras') {
    const muestras = P.filter(function (p) { return p.muestra === true; }).map(function (p) { return p.id; });
    if (!muestras.length) return falla('no hay productos de muestra');
    if (typeof c.cantidad === 'number' && c.cantidad !== muestras.length) return falla('ahora hay ' + muestras.length + ' productos de muestra y confirmaste ' + c.cantidad + '; vuelve a pedir /limpiar_muestras');
    for (let i = P.length - 1; i >= 0; i--) if (P[i].muestra === true) P.splice(i, 1);
    muestras.forEach(function (id) { out.ids.push(id); });
    out.archivos.push('products');
    quitarReferencias(E, muestras, out, ctx);
    out.entidad_id = 'products';
    out.linea = 'limpiar_muestras ' + muestras.length + ' productos';
    return out;
  }
  const idx = P.findIndex(function (x) { return x.id === b.entidad_id; });
  if (idx < 0) return falla('el producto ' + String(b.entidad_id || '?').slice(0, 20) + ' no existe');
  const p = JSON.parse(JSON.stringify(P[idx]));
  out.entidad_id = p.id; out.ids.push(p.id); out.archivos.push('products');
  if (op === 'eliminar') {
    P.splice(idx, 1);
    quitarReferencias(E, [p.id], out, ctx);
    out.linea = 'eliminar ' + p.id + ' ' + textoSeguro(p.nombre, 50);
    return out;
  }
  let detalle = '';
  if (op === 'desactivar' || op === 'reactivar') {
    if (p.activo === (op === 'reactivar')) return falla(op === 'reactivar' ? 'ya estaba visible' : 'ya estaba oculto');
    p.activo = op === 'reactivar';
  } else if (op === 'stock' && Array.isArray(c.stock_por_color) && c.stock_por_color.length) {
    // v2: "/stock <id> <color> <n>" y "quedan 2 del blanco": aplicarStockColor() de validar.js (0..20 por color).
    const r = aplicarStockColor(p, c.stock_por_color, c.stock_modo || 'fijar');
    if (!r.ok) return falla(sinCodigo(r.errores));
    p.stock_por_color = r.stock_por_color; p.stock = stockTotal(p);
    detalle = r.cambios.join(' ');
  } else if (op === 'stock') {
    const modo = c.stock_modo || 'fijar';
    const lista = Array.isArray(c.stock_tallas) ? c.stock_tallas : [];
    if (!lista.length) return falla('no hay tallas ni colores en el cambio de stock');
    if (p.stock_por_color && typeof p.stock_por_color === 'object') return falla('el stock se lleva por color: /stock ' + p.id + ' <color> <n>');
    const permitidas = TALLAS_POR_CATEGORIA[p.categoria] || [];
    const partes = [];
    for (const s of lista) {
      const t = String(s && s.talla);
      const q = Math.floor(Number(s && s.cantidad));
      if (!Number.isFinite(q) || q < 0) return falla('cantidad inválida para la talla ' + t.slice(0, 5));
      if (p.tallas.indexOf(t) < 0) {
        if (permitidas.indexOf(t) < 0) return falla('la talla ' + t.slice(0, 5) + ' no corresponde a ' + p.categoria);
        p.tallas = ordenTallas(p.tallas.concat([t]));
        p.stock_por_talla[t] = 0;
      }
      const actual = Number(p.stock_por_talla[t]) || 0;
      const nuevo = modo === 'sumar' ? actual + q : modo === 'restar' ? actual - q : q;
      if (nuevo < 0) return falla('no hay suficiente stock de la talla ' + t + ' (hay ' + actual + ')');
      p.stock_por_talla[t] = nuevo;
      partes.push(t + '=' + nuevo);
    }
    const spt = {};
    p.tallas.forEach(function (t) { spt[t] = Number(p.stock_por_talla[t]) || 0; });
    p.stock_por_talla = spt; p.stock = stockTotal(p);
    detalle = partes.join(' ');
  } else if (op === 'agregar_imagen') {
    if (!fotos.length) return falla('no llegó la foto');
    const lista = c.reemplazar === true ? [] : (p.imagenes || []).slice();
    if (lista.length + fotos.length > 6) return falla('un producto admite máximo 6 fotos (ya tiene ' + lista.length + ')');
    fotos.forEach(function (f, i) {
      const im = nuevaImagen(ctx, 'assets/img/products/', p.slug + '-' + (lista.length + 1), f, c.alt_imagen || f.alt || p.nombre, f.origen === 'ia_local' ? 'ia_local' : 'foto');
      lista.push(im.obj); out.imagenes.push(im.blob);
    });
    p.imagenes = lista;
    detalle = fotos.length === 1 ? '1 foto' : fotos.length + ' fotos';
  } else if (op === 'actualizar') {
    const cambios = [];
    if (!vacio(c.nombre)) { p.nombre = textoSeguro(c.nombre, 70); cambios.push('nombre'); }
    if (!vacio(c.categoria) && c.categoria !== p.categoria) { p.categoria = c.categoria; cambios.push('categoria ' + c.categoria); }
    if (!vacio(c.subcategoria) && c.subcategoria !== p.subcategoria) { p.subcategoria = c.subcategoria; cambios.push('subcategoria ' + c.subcategoria); }
    if (typeof c.precio === 'number' && c.precio > 0) { p.precio = r2(c.precio); cambios.push('precio ' + p.precio.toFixed(2)); }
    if (typeof c.precio_oferta === 'number') {
      if (c.precio_oferta === 0) { if (p.precio_oferta !== undefined) { delete p.precio_oferta; cambios.push('sin oferta'); } }
      else { p.precio_oferta = r2(c.precio_oferta); cambios.push('oferta ' + p.precio_oferta.toFixed(2)); }
    }
    if (Array.isArray(c.tallas) && c.tallas.length) {
      const nt = ordenTallas(c.tallas);
      p.tallas = nt;
      // v2: stock_por_talla es opcional; si existe sigue a las tallas (con stock_por_color no se suma: stockTotal).
      if (p.stock_por_talla && typeof p.stock_por_talla === 'object') {
        const spt = {};
        nt.forEach(function (t) { spt[t] = Number(p.stock_por_talla[t]) || 0; });
        p.stock_por_talla = spt;
      }
      p.stock = stockTotal(p);
      cambios.push('tallas ' + nt.join(' '));
    }
    if (Array.isArray(c.colores) && c.colores.length) {
      p.colores = colores(c.colores);
      const nombres = p.colores.map(function (x) { return x.nombre; });
      // Los colores que siguen conservan su stock, los nuevos empiezan en 0 y los quitados desaparecen (CONTRATO 0.3).
      if (p.stock_por_color && typeof p.stock_por_color === 'object') { p.stock_por_color = pbStockTrasColores(p.stock_por_color, nombres); p.stock = stockTotal(p); }
      (p.imagenes || []).forEach(function (im) { if (im && typeof im.color === 'string' && nombres.indexOf(im.color) < 0) delete im.color; });
      cambios.push('colores');
    }
    if (Number.isInteger(c.frescura) && c.frescura >= 1 && c.frescura <= 5 && c.frescura !== p.frescura) { p.frescura = c.frescura; cambios.push('frescura ' + c.frescura); }
    if (!vacio(c.material)) { const m = textoSeguro(c.material, 60); if (Array.from(m).length >= 2) { p.material = m; cambios.push('material'); } }
    if (typeof c.descripcion === 'string' && c.descripcion.trim()) { p.descripcion = textoSeguro(c.descripcion, 600); cambios.push('descripcion'); }
    if (Array.isArray(c.etiquetas) && c.etiquetas.length) { p.etiquetas = etiquetas(c.etiquetas); cambios.push('etiquetas'); }
    if (typeof c.destacado === 'boolean') { p.destacado = c.destacado; cambios.push(c.destacado ? 'destacado' : 'no destacado'); }
    if (!cambios.length) return falla('no hay ningún campo que cambiar');
    detalle = cambios.join(', ');
  } else return falla('operación no soportada para productos: ' + op);
  p.fecha_actualizacion = ctx.ahora;
  P[idx] = ordenar(p, ORDEN_PRODUCTO);
  out.linea = op + ' ' + p.id + (detalle ? ' ' + detalle : '');
  return out;
}

// --- 1) documentos leídos en el sha de HEAD (y del padre si es /deshacer) ---
const docs = {};
const padres = {};
for (let i = 0; i < pedidos.length; i++) {
  const p = pedidos[i];
  const r = resp[i] || {};
  if (r.statusCode !== 200) return fin(false, 'GET data/' + p.nombre + '.json HTTP ' + (r.statusCode || 'sin respuesta'));
  let txt = r.body !== undefined ? r.body : r.data;
  if (typeof txt !== 'string') txt = JSON.stringify(txt);
  try { (p.cual === 'padre' ? padres : docs)[p.nombre] = JSON.parse(txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt); }
  catch (e) { return fin(false, 'data/' + p.nombre + '.json no es JSON válido'); }
}
for (const n of ARCHIVOS) if (!docs[n]) return fin(false, 'falta data/' + n + '.json');
const original = {};
ARCHIVOS.forEach(function (n) { original[n] = serializar(docs[n]); });
const ctx = { ahora: isoLima(), head: pedidos[0].head, padreSha: pedidos[0].padre, autorHead: pedidos[0].autor, padres: padres, contador: 0 };
// --- 2) idempotencia: draft_id ya aplicados en CUALQUIERA de los tres archivos ---
const yaAplicados = new Set();
ARCHIVOS.forEach(function (n) { (docs[n].borradores_aplicados || []).forEach(function (d) { yaAplicados.add(d); }); });
// --- 3) aplicar y validar borrador por borrador ---
let estado = JSON.parse(JSON.stringify(docs));
const resultados = {};
const porArchivo = { products: [], articles: [], site: [] };
const imagenes = [];
const lineas = [];
for (const b of lote) {
  if (yaAplicados.has(b.draft_id)) { resultados[b.draft_id] = { estado: 'publicado', commit_sha: ctx.head, nota: 'ya estaba aplicado' }; continue; }
  const antes = JSON.parse(JSON.stringify(estado));
  let r;
  try { r = aplicarBorrador(estado, b, imgs.filter(function (x) { return x.draft_id === b.draft_id; }), ctx); }
  catch (e) { r = { ok: false, errores: ['[aplicar] ' + String((e && e.message) || e)] }; }
  if (r.ok) {
    const v = validar(estado, b.op === 'deshacer' ? {} : { anterior: antes, idsLote: r.ids, rol: b.rol, permitirLimpieza: b.op === 'limpiar_muestras' });
    if (!v.ok) r = { ok: false, errores: v.errores };
  }
  if (!r.ok) {
    estado = antes;
    resultados[b.draft_id] = { estado: 'error', error: censurar(r.errores.slice(0, 3).join('; ')).slice(0, 500) };
    continue;
  }
  r.archivos.forEach(function (n) { porArchivo[n].push(b.draft_id); });
  r.imagenes.forEach(function (x) { imagenes.push(x); });
  lineas.push({ draft_id: b.draft_id, linea: r.linea + ' [' + (b.origen || 'telegram') + ' draft:' + b.draft_id + ']' });
  resultados[b.draft_id] = { estado: 'publicado', entidad_id: r.entidad_id || '', resumen: r.linea };
}
// --- 4) envoltura (version+1, actualizado, borradores_aplicados) y validación final del documento completo ---
ARCHIVOS.forEach(function (n) {
  if (!porArchivo[n].length) return;
  const d = estado[n];
  d.version = (Number(d.version) || 0) + 1;
  d.actualizado = ctx.ahora;
  d.borradores_aplicados = (Array.isArray(d.borradores_aplicados) ? d.borradores_aplicados : [])
    .filter(function (x) { return porArchivo[n].indexOf(x) < 0; }).concat(porArchivo[n]).slice(-MAX_BORRADORES_APLICADOS);
});
if (lineas.length) {
  const vf = validar(estado, {});
  if (!vf.ok) {
    lineas.forEach(function (l) { resultados[l.draft_id] = { estado: 'error', error: censurar('validación final: ' + vf.errores.slice(0, 3).join('; ')).slice(0, 500) }; });
    return fin(true, 'la validación final falló', resultados);
  }
}
const cambiados = ARCHIVOS.filter(function (n) { return serializar(estado[n]) !== original[n]; });
if (!lineas.length || !cambiados.length) return fin(true, 'nada nuevo que publicar', resultados);
// --- 5) mensaje de commit: "data(products): crear prd-0017 Camisa ... [telegram draft:drf-...]" ---
const origenes = lote.map(function (b) { return b.origen || 'telegram'; }).filter(function (o, i, l) { return l.indexOf(o) === i; }).join(',');
const mensaje = censurar(lineas.length === 1
  ? 'data(' + cambiados.join(',') + '): ' + lineas[0].linea
  : 'data(' + cambiados.join(',') + '): lote de ' + lineas.length + ' cambios [' + origenes + ']\n\n' + lineas.map(function (l) { return '- ' + l.linea; }).join('\n')).slice(0, 4000);
const textos = {};
cambiados.forEach(function (n) { textos[n] = serializar(estado[n]); });
const arbol = { textos: textos, imagenes: imagenes.map(function (x) { return { tmp: x.tmp, prefijo: x.prefijo }; }), mensaje: mensaje, head: ctx.head, tree: pedidos[0].tree, resultados: resultados };
if (!imagenes.length) return [{ json: { paso: 'arbol', arbol: arbol } }];
// D5 paso 5: primero los blobs de imagen (un ítem por imagen; el primero lleva el árbol pendiente).
return imagenes.map(function (x, i) { return { json: Object.assign({ paso: 'blobs', content: x.b64 }, i === 0 ? { arbol: arbol } : {}) }; });

//// Arbol
// D5 paso 6 (preparación): nombre final de cada imagen = prefijo + 8 primeros caracteres del sha del blob.
const ap = $('Aplicar lote').all().map(function (i) { return i.json; });
const a = ap[0].arbol;
const resp = ap[0].paso === 'blobs' ? $input.all().map(function (i) { return i.json || {}; }) : [];
const textos = Object.assign({}, a.textos);
const imagenesTree = [];
const vistos = new Set();
for (let i = 0; i < a.imagenes.length; i++) {
  const r = resp[i] || {};
  const sha = r.body && r.body.sha;
  if (Number(r.statusCode) !== 201 || !/^[0-9a-f]{40}$/.test(String(sha || ''))) {
    const s = Number(r.statusCode) || 0;
    return [{ json: { fallo: true, reintentable: s === 0 || s === 409 || s === 429 || s >= 500, motivo: 'POST blobs HTTP ' + (s || 'sin respuesta') } }];
  }
  const final = a.imagenes[i].prefijo + sha.slice(0, 8) + '.webp';
  Object.keys(textos).forEach(function (n) { textos[n] = textos[n].split(a.imagenes[i].tmp).join(final); });
  if (!vistos.has(final)) { vistos.add(final); imagenesTree.push({ path: final, mode: '100644', type: 'blob', sha: sha }); }
}
const tree = [];
for (const n of Object.keys(textos)) {
  if (/-pbimg\d{4}\.webp/.test(textos[n])) return [{ json: { fallo: true, reintentable: false, motivo: 'quedó una imagen sin nombre final en ' + n } }];
  tree.push({ path: 'data/' + n + '.json', mode: '100644', type: 'blob', content: textos[n] });
}
return [{ json: { fallo: false, base_tree: a.tree, tree: tree.concat(imagenesTree), mensaje: a.mensaje, head: a.head } }];

//// Revisar
// @incluir comun
// D5 paso 8: PATCH 200 = publicado. 422 (no fast-forward) o fallo transitorio -> reintento COMPLETO desde GET ref (máx. 3).
const intento = $('Intento').first().json.intento;
const j = $input.first().json || {};
const sc = function (x) { return Number(x && x.statusCode) || 0; };
const transitorio = function (s) { return s === 0 || s === 409 || s === 429 || s >= 500; };
const det = function (x) { const m = x && x.body && (x.body.message || (typeof x.body === 'string' ? x.body : '')); return m ? ' (' + censurar(String(m)).slice(0, 120) + ')' : ''; };
let r;
if (j.fallo === true) r = { exito: false, reintentable: j.reintentable !== false, motivo: j.motivo };
else {
  const t = $('POST tree').first().json || {};
  const c = $('POST commit').first().json || {};
  if (sc(t) !== 201) r = { exito: false, reintentable: transitorio(sc(t)), motivo: 'POST tree HTTP ' + sc(t) + det(t) };
  else if (sc(c) !== 201) r = { exito: false, reintentable: transitorio(sc(c)), motivo: 'POST commit HTTP ' + sc(c) + det(c) };
  else if (sc(j) === 200) r = { exito: true, commit_sha: c.body.sha };
  else r = { exito: false, reintentable: sc(j) === 422 || transitorio(sc(j)), motivo: 'PATCH ref HTTP ' + sc(j) + det(j) };
}
if (!r.exito && r.reintentable && intento < 3) return [{ json: { reintentar: true, intento: intento + 1, motivo: censurar(r.motivo || '') } }];
const a = r.exito ? $('Aplicar lote').first().json : null;
return [{ json: {
  reintentar: false, resuelto: r.exito, exito: r.exito, commit_sha: r.commit_sha || '',
  motivo: censurar(r.motivo || '').slice(0, 300) + (r.exito ? '' : ' (intento ' + intento + ')'),
  resultados: a && a.arbol ? a.arbol.resultados : {}
} }];

//// Cierre
// @incluir comun
// Estado final de cada borrador del lote: publicado (+commit_sha) | error | de vuelta a aprobado (intentos+1; con 3 -> error).
const lote = $('Tomados').first().json.lote || [];
const j = $input.first().json || {};
const resuelto = j.resuelto === true;
const res = j.resultados || {};
const items = lote.map(function (b) {
  const r = res[b.draft_id];
  const intentos = Number(b.intentos) || 0;
  if (resuelto && r) {
    if (r.estado === 'error') return { draft_id: b.draft_id, estado: 'error', commit_sha: '', error: r.error || 'no se pudo aplicar', intentos: intentos, entidad_id: b.entidad_id || '' };
    return { draft_id: b.draft_id, estado: 'publicado', commit_sha: r.commit_sha || j.commit_sha || '', error: '', intentos: intentos, entidad_id: r.entidad_id || b.entidad_id || '' };
  }
  const n = intentos + 1;
  return { draft_id: b.draft_id, estado: n >= 3 ? 'error' : 'aprobado', commit_sha: '', error: censurar(j.motivo || 'falló la publicación').slice(0, 500), intentos: n, entidad_id: b.entidad_id || '' };
});
if (!items.length) items.push({ draft_id: 'ninguno', estado: 'publicando', commit_sha: '', error: '', intentos: 0, entidad_id: '' });
const hecho = resuelto && !!j.commit_sha;
return items.map(function (x) { return { json: Object.assign(x, { commit_hecho: hecho }) }; });

//// Imagenes publicadas
// Las imágenes de borradores terminados (publicado o error) se borran de pb_imagenes (ya están en el repo o no sirven).
const c = $('Cierre').all().map(function (i) { return i.json; }).filter(function (x) { return x.draft_id !== 'ninguno' && (x.estado === 'publicado' || x.estado === 'error'); });
return c.length ? c.map(function (x) { return { json: { draft_id: x.draft_id } }; }) : [{ json: { draft_id: 'ninguno' } }];

//// Hora del commit
const hecho = $('Cierre').first().json.commit_hecho === true;
return [{ json: { clave: hecho ? 'ULTIMO_COMMIT_AT' : '__ninguna__', valor: String(Date.now()) } }];

//// Avisos lote
// @incluir comun
const cfg = $('Config').first().json;
const lote = $('Tomados').first().json.lote || [];
const cierre = $('Cierre').all().map(function (i) { return i.json; });
const porChat = {};
cierre.forEach(function (x) {
  const b = lote.find(function (y) { return y.draft_id === x.draft_id; });
  if (!b || !(Number(b.chat_id) > 0)) return;
  const g = porChat[b.chat_id] = porChat[b.chat_id] || { pub: [], err: [], esp: [] };
  const res = String(b.resumen || (b.op + ' ' + (x.entidad_id || b.entidad_id || ''))).slice(0, 200);
  if (x.estado === 'publicado') g.pub.push({ res: res, sha: x.commit_sha });
  else if (x.estado === 'error') g.err.push({ id: x.draft_id, res: res, error: x.error });
  else if (x.estado === 'aprobado') g.esp.push({ res: res, error: x.error });
});
const out = [];
Object.keys(porChat).forEach(function (ch) {
  const g = porChat[ch];
  if (g.pub.length) out.push(enviar(ch, 'Publicado: ' + g.pub.map(function (p) { return h(p.res); }).join('; ') + ' (commit ' + h(String(g.pub[0].sha || '').slice(0, 7)) + '). Se verá en 1–10 min: ' + h(cfg.SITIO_URL) + '\nSiguiente paso: revisa la web; si algo salió mal, usa /deshacer.'));
  g.err.forEach(function (e) { out.push(enviar(ch, 'No se publicó el borrador ' + h(e.id) + ' (' + h(e.res) + '): ' + h(String(e.error || '').slice(0, 300)) + '\nSiguiente paso: corrige el dato y envía el cambio de nuevo.')); });
  if (g.esp.length) out.push(enviar(ch, 'Todavía no pude publicar ' + g.esp.length + ' cambio(s) aprobado(s): ' + h(String(g.esp[0].error || '').slice(0, 150)) + '. Lo reintento solo.\nSiguiente paso: nada; te aviso cuando esté publicado.'));
});
return out.map(function (m) { return { json: m }; });

//// Salida lote
const c = $('Cierre').all().map(function (i) { return i.json; }).filter(function (x) { return x.draft_id !== 'ninguno'; });
return [{ json: {
  ok: true,
  publicados: c.filter(function (x) { return x.estado === 'publicado'; }).length,
  errores: c.filter(function (x) { return x.estado === 'error'; }).length,
  pendientes: c.filter(function (x) { return x.estado === 'aprobado'; }).length,
  commit_sha: (c.find(function (x) { return x.commit_sha; }) || {}).commit_sha || ''
} }];
