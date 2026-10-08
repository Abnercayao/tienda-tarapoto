// --- comun-negocio.js (Palmera Brava): ayudas de WF3 (Borrador-IA) y WF4 (Comandos) ---
// Se inserta donde un Code dice "// @incluir negocio", SIEMPRE después del bloque de validar.js y de comun.js
// (usa validarOperacion, puede, textoSeguro, TALLAS..., h, enviar, censurar). Prefijo "nb" para no chocar con ellos.
const NB_ETIQUETA = {
  nombre: 'nombre', categoria: 'categoría', subcategoria: 'subcategoría', precio: 'precio', precio_oferta: 'precio de oferta',
  tallas: 'tallas', stock_tallas: 'stock por talla', stock_por_color: 'stock por color', stock_modo: 'modo de stock', colores: 'colores',
  material: 'material', frescura: 'frescura', descripcion: 'descripción', etiquetas: 'etiquetas', alt_imagen: 'descripción de la foto', destacado: 'destacado',
  id: 'id del producto', foto: 'la foto', campos: 'qué quieres cambiar', titulo: 'título', resumen: 'resumen', bloques: 'contenido',
  productos_relacionados: 'productos relacionados', alt_portada: 'descripción de la portada', tema: 'tema'
};
const NB_EJEMPLO = {
  nombre: 'nombre Polo de lino', categoria: 'categoría hombres', precio: 'precio 59.90', tallas: 'tallas S M L', colores: 'colores azul, blanco',
  id: 'prd-0003', stock_tallas: 'M 5, L 3', stock_por_color: 'blanco 5, arena 3 (o 10 por color)', foto: 'envía la foto',
  campos: 'precio 59.90', titulo: 'título del artículo'
};
const NB_DOBLE = ['eliminar', 'limpiar_muestras', 'deshacer', 'whatsapp'];
// Solo estos faltantes bloquean el botón Publicar (el LLM suele listar también opcionales como material o descripción).
const NB_REQUERIDOS = {
  producto: { crear: ['nombre', 'categoria', 'precio', 'tallas', 'colores'], actualizar: ['id', 'campos'], stock: ['id', 'stock_por_color', 'stock_tallas'],
    agregar_imagen: ['id', 'foto'], desactivar: ['id'], reactivar: ['id'] },
  articulo: { crear: ['titulo', 'bloques', 'tema'], actualizar: ['id', 'campos'], desactivar: ['id'], reactivar: ['id'] }
};
const NB_PLANTILLA = 'nombre: \ncategoria: hombres / mujeres / ninos / accesorios\nprecio: \ntallas: \ncolores: \nstock por color: \nmaterial: ';
// v2: hojitas de frescura ("5/5 hojitas") y stock por color ("Blanco 10, Arena 3") para la vista previa y /ver.
function nbHojitas(n) { return Number.isInteger(n) && n >= 1 && n <= 5 ? n + '/5 hojitas' : '—'; }
function nbStockColores(v) {
  if (Array.isArray(v)) return v.map(function (x) { return textoSeguro(x && x.color, 24) + ' ' + (x && x.cantidad); }).join(', ');
  return v && typeof v === 'object' ? Object.keys(v).map(function (k) { return k + ' ' + v[k]; }).join(', ') : '';
}
// Nombre EXACTO del color del producto p que corresponde a lo que escribió el dueño ("blanca" = "Blanco"), o null.
function nbColorDe(p, texto) {
  const nombres = (p && Array.isArray(p.colores) ? p.colores : []).map(function (c) { return c && typeof c === 'object' ? c.nombre : c; }).filter(Boolean);
  const k = claveColor(texto);
  if (!k) return null;
  const base = function (x) { return x.split(' ').map(function (w) { return w.replace(/s$/, '').replace(/a$/, 'o'); }).join(' '); };
  return nombres.find(function (n) { return claveColor(n) === k; }) || nombres.find(function (n) { return base(claveColor(n)) === base(k); }) || null;
}
function nbJSON(s, d) { if (s === null || s === undefined || s === '') return d; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch (e) { return d; } }
function nbVacio(v) { return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length); }
function nbEjecutado(nombre) { try { return $(nombre).isExecuted === true; } catch (e) { return false; } }
// Respuesta de GitHub (HTTP Request con fullResponse y Accept raw) -> documento JSON, o null.
function nbDoc(r) {
  if (!r || r.statusCode !== 200) return null;
  let txt = r.body !== undefined ? r.body : r.data;
  if (txt && typeof txt === 'object') return txt;
  txt = String(txt || '');
  try { return JSON.parse(txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt); } catch (e) { return null; }
}
function nbSoles(n) { return 'S/ ' + Number(n).toFixed(2); }
function nbValor(k, v) {
  if (v === null || v === undefined) return '—';
  let s;
  if (k === 'precio' || k === 'precio_oferta') s = Number(v) === 0 ? 'sin oferta' : nbSoles(v);
  else if (k === 'tallas') s = v.join(' ');
  else if (k === 'stock_tallas') s = v.map(function (x) { return x.talla + ': ' + x.cantidad; }).join(', ');
  else if (k === 'stock_por_color') s = nbStockColores(v);
  else if (k === 'frescura') s = nbHojitas(v);
  else if (k === 'colores') s = v.map(function (c) { return c && typeof c === 'object' ? c.nombre : c; }).join(', ');
  else if (k === 'etiquetas' || k === 'productos_relacionados') s = v.join(', ');
  else if (k === 'destacado') s = v ? 'sí' : 'no';
  else if (k === 'descripcion' || k === 'resumen') s = textoSeguro(v, 220);
  else s = textoSeguro(typeof v === 'object' ? JSON.stringify(v) : String(v), 120);
  return h(s);
}
function nbLimpiarAviso(a) { return textoSeguro(String(a || '').replace(/^\[[a-z_]+\]\s*/, ''), 220); }
// Permiso que exige una operación (igual que WF5 "Verificar").
function nbPermiso(op, entidad, campos) {
  return ({ eliminar: 'borrar', limpiar_muestras: 'limpiar_muestras', deshacer: 'deshacer', whatsapp: 'whatsapp' })[op] ||
    (entidad === 'sitio' && campos && campos.whatsapp !== undefined ? 'whatsapp'
      : op === 'agregar_imagen' && entidad !== 'producto' ? 'imagen' : entidad === 'articulo' ? 'articulo' : op);
}
function nbBloqueantes(op) {
  const req = ((NB_REQUERIDOS[op.entidad === 'articulo' ? 'articulo' : 'producto'] || {})[op.op]) || [];
  const c = op.campos || {};
  // Un campo que ya tiene valor no falta (el LLM a veces lo lista igual).
  return (Array.isArray(op.faltantes) ? op.faltantes : []).filter(function (f, i, l) {
    return req.indexOf(f) >= 0 && l.indexOf(f) === i && !(Object.prototype.hasOwnProperty.call(c, f) && !nbVacio(c[f]));
  });
}
// Igual que el catálogo que arma cuerpoOllama() (máx. 200 activos).
function nbLineasCatalogo(productos) {
  return (Array.isArray(productos) ? productos : []).filter(function (p) { return p && typeof p === 'object' && p.activo !== false; }).slice(0, 200)
    .map(function (p) { return p.id + ' | ' + textoSeguro(p.nombre, 70) + ' | ' + p.categoria + ' | ' + p.precio; }).join('\n') || '(vacío)';
}
// Cuerpo de /api/chat: cuerpoOllama() de validar.js (format, think:false, num_ctx 8192) con el prompt de n8n/prompts/extraccion.md.
function nbCuerpo(o) {
  const c = cuerpoOllama({ tipo: o.tipo, texto: o.texto, imagenesBase64: o.imagenes || [], productos: o.productos, reintento: !!o.reintento, modelo: o.modelo, keepAlive: o.keepAlive });
  c.messages[0].content = (o.tipo === 'articulo' ? PROMPT_ARTICULO_N8N : PROMPT_EXTRACCION).replace('{{CATALOGO}}', nbLineasCatalogo(o.productos));
  return c;
}
// Respuesta de Ollama -> {estado:'ok'|'reintentar'|'ia_caida', v (validarOperacion), cuerpo2}. "primero" = resultado de la 1.ª llamada.
function nbEvaluarIA(r, c, cat, primero) {
  const content = r && r.message && typeof r.message.content === 'string' && r.message.content.trim() ? r.message.content : null;
  const seg = r && r.total_duration ? Math.round(r.total_duration / 1e8) / 10 : null;
  if (!content) {
    if (primero && primero.v) return Object.assign({}, primero, { estado: 'ok', nota: 'el reintento no respondió; se usa la 1.ª respuesta ya corregida' });
    const det = r && r.error ? (typeof r.error === 'string' ? r.error : (r.error.message || JSON.stringify(r.error))) : 'respuesta vacía';
    return { estado: 'ia_caida', detalle: censurar(String(det)).slice(0, 200) };
  }
  const v = validarOperacion(content, { texto: c.texto_ia, productos: cat.productos, articulos: cat.articulos, hayFoto: c.hayFoto });
  if (!primero && v.reintentar === 'crear') {
    const c2 = JSON.parse(JSON.stringify(c.cuerpo));
    c2.messages[1].content += NOTA_REINTENTO_CREAR;
    return { estado: 'reintentar', v: v, cuerpo2: c2, segundos: seg };
  }
  if (primero && primero.v && primero.v.ok && !v.ok) return Object.assign({}, primero, { estado: 'ok', nota: 'el reintento no pasó la validación; se usa la 1.ª respuesta ya corregida' });
  return { estado: 'ok', v: v, segundos: seg, reintento: !!primero };
}
function nbOpVacia(tipo) {
  const campos = {};
  (tipo === 'articulo' ? CAMPOS_LLM_ARTICULO : CAMPOS_LLM_PRODUCTO).forEach(function (k) { campos[k] = ['tallas', 'stock_tallas', 'stock_por_color', 'colores', 'etiquetas', 'bloques', 'productos_relacionados'].indexOf(k) >= 0 ? [] : null; });
  return { op: 'crear', entidad: tipo === 'articulo' ? 'articulo' : 'producto', id: null, campos: campos, campos_inferidos: [], faltantes: [] };
}
function nbNumero(s) {
  const m = /^(?:s\/\.?)?\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:soles?)?$/i.exec(String(s || '').trim());
  return m ? Math.round(parseFloat(m[1].replace(',', '.')) * 100) / 100 : null;
}
function nbTalla(s) {
  const t = String(s || '').trim().toUpperCase().replace(/^Ú/, 'U');
  if (t === 'UNICA' || t === 'ÚNICA') return 'UNICA';
  return TALLAS.indexOf(t) >= 0 ? t : null;
}
function nbTallas(texto) {
  const out = [];
  const t = String(texto || '').toUpperCase();
  const r = /(\d{2})\s*(?:A|-|AL)\s*(?:LA\s*)?(\d{2})/.exec(t);
  if (r && Number(r[1]) < Number(r[2])) for (let n = Number(r[1]); n <= Number(r[2]); n++) { if (TALLAS.indexOf(String(n)) >= 0) out.push(String(n)); }
  t.split(/[\s,;\/]+/).forEach(function (x) { const k = nbTalla(x); if (k && out.indexOf(k) < 0) out.push(k); });
  return TALLAS.filter(function (k) { return out.indexOf(k) >= 0; });
}
// Plantilla manual (IA caída): "nombre: …; categoria: …; precio: …; tallas: …; colores: …" (líneas o ";"). Determinista.
function nbPlantilla(texto) {
  const op = nbOpVacia('producto');
  const c = op.campos;
  let n = 0;
  String(texto || '').split(/[\n;]+/).forEach(function (linea) {
    const m = /^\s*([a-zA-ZáéíóúñÁÉÍÓÚÑ_ ]{4,20}?)\s*[:=]\s*(.*)$/.exec(linea) || /^\s*(precio|oferta|tallas?|colou?res?|categor[ií]a)\s+(.+)$/i.exec(linea);
    if (!m) return;
    const k = quitarTildes(m[1]).toLowerCase().trim();
    const v = m[2].trim();
    if (!v || /^hombres \/ mujeres/.test(v)) return;
    if (k === 'nombre') { c.nombre = textoSeguro(v, 70); n++; }
    else if (k === 'categoria') { const cat = quitarTildes(v).toLowerCase().replace(/[^a-z]/g, ''); if (CATEGORIAS.indexOf(cat) >= 0) { c.categoria = cat; n++; } }
    else if (k === 'subcategoria') { const s = quitarTildes(v).toLowerCase().trim().replace(/\s+/g, '-'); if (SUBCATEGORIAS.indexOf(s) >= 0 || (typeof ALIAS_SUBCATEGORIA === 'object' && ALIAS_SUBCATEGORIA[s])) { c.subcategoria = ALIAS_SUBCATEGORIA[s] || s; n++; } }
    else if (k === 'precio') { const p = nbNumero(v.split(/\s+(?:oferta|con)\s+/i)[0]); if (p) { c.precio = p; n++; } const o = /oferta\s*(?:a\s*)?(?:s\/\.?\s*)?(\d+(?:[.,]\d{1,2})?)/i.exec(v); if (o) c.precio_oferta = nbNumero(o[1]); }
    else if (k === 'oferta' || k === 'precio oferta' || k === 'precio_oferta') { const p = nbNumero(v); if (p) { c.precio_oferta = p; n++; } }
    else if (k === 'tallas' || k === 'talla') { const t = nbTallas(v); if (t.length) { c.tallas = t; n++; } }
    else if (k === 'colores' || k === 'color') { const l = v.split(/,|\s+y\s+|\//).map(function (x) { return textoSeguro(x, 24); }).filter(Boolean).slice(0, 8); if (l.length) { c.colores = l; n++; } }
    else if (k === 'material' || k === 'tela') { c.material = textoSeguro(v, 60); n++; }
    else if (k === 'descripcion') { c.descripcion = textoSeguro(v, 600); n++; }
    else if (k === 'frescura') { const f = parseInt(v, 10); if (f >= 1 && f <= 5) { c.frescura = f; n++; } }
    else if (k === 'stock por color' || k === 'stock') {
      // "10 por color" / "10 de cada color" / "10" -> la misma cantidad en todos los colores; "blanco 5, arena 3" -> por color.
      const cada = /^(\d{1,2})(?:\s+(?:por|de cada|cada)\s+colou?r)?$/i.exec(v);
      if (cada) { c.stock_por_color = [{ color: '*', cantidad: Number(cada[1]) }]; n++; return; }
      const pares = [];
      v.split(/,|;|\s+y\s+/).forEach(function (x) { const m = /^\s*(.+?)\s*[:=]?\s*(\d{1,2})\s*$/.exec(x); if (m) pares.push({ color: textoSeguro(m[1], 24), cantidad: Number(m[2]) }); });
      if (pares.length) { c.stock_por_color = pares; n++; }
    }
  });
  // "10 por color": se expande con los colores (que pueden venir en una línea posterior).
  if (c.stock_por_color.length === 1 && c.stock_por_color[0].color === '*') {
    const q = c.stock_por_color[0].cantidad;
    c.stock_por_color = c.colores.map(function (x) { return { color: x, cantidad: q }; });
  }
  return n ? op : null;
}
// Completar un borrador: lo que el dueño dice ahora pisa lo anterior; lo que la IA deduce de nuevo NO pisa lo que ya había.
function nbFusionar(prev, nueva, explicito) {
  const out = JSON.parse(JSON.stringify(prev));
  if (!nueva || !nueva.campos) return out;
  const infPrev = new Set(prev.campos_inferidos || []);
  const infNueva = new Set(explicito ? [] : (nueva.campos_inferidos || []));
  const faltaba = new Set(prev.faltantes || []);
  Object.keys(out.campos).forEach(function (k) {
    const v = nueva.campos[k];
    if (nbVacio(v)) return;
    const deducido = infNueva.has(k);
    if (!deducido || nbVacio(out.campos[k]) || faltaba.has(k)) {
      out.campos[k] = v;
      if (deducido) infPrev.add(k); else infPrev.delete(k);
    }
  });
  if (!out.id && nueva.id) out.id = nueva.id;
  out.campos_inferidos = Array.from(infPrev);
  out.faltantes = [];
  return out;
}
function nbOpDeFila(b) {
  const tipo = b.entidad === 'articulo' ? 'articulo' : 'producto';
  const base = nbOpVacia(tipo);
  let c = nbJSON(b.campos, {});
  if (c && c.campos && typeof c.campos === 'object' && (c.op || c.entidad)) c = c.campos;
  return { op: b.op || 'crear', entidad: b.entidad || tipo, id: b.entidad_id || null, campos: Object.assign(base.campos, c || {}),
    campos_inferidos: nbJSON(b.campos_inferidos, []), faltantes: nbJSON(b.faltantes, []) };
}
// Revisión final contra el catálogo (lo que WF5 rechazaría al publicar, dicho antes).
function nbPostChequeo(op, cat) {
  const err = [];
  const c = op.campos || {};
  if (op.entidad === 'producto' && op.id) {
    const p = cat.productos.find(function (x) { return x.id === op.id; });
    if (!p) return err;
    if (op.op === 'desactivar' && p.activo === false) err.push(op.id + ' ya está oculto');
    if (op.op === 'reactivar' && p.activo !== false) err.push(op.id + ' ya está visible');
    if (op.op === 'stock') {
      const perm = TALLAS_POR_CATEGORIA[p.categoria] || [];
      // v2 (CONTRATO 0.3): con stock_por_color la disponibilidad se lleva por color; el stock por talla no se suma.
      if (!nbVacio(c.stock_tallas) && p.stock_por_color && typeof p.stock_por_color === 'object') {
        const col = (p.colores || []).map(function (x) { return x.nombre; });
        err.push(op.id + ' lleva el stock por color (' + col.join(', ') + '): usa /stock ' + op.id + ' ' + (col[0] || 'Blanco') + ' 5');
        return err;
      }
      (c.stock_tallas || []).forEach(function (s) {
        if ((p.tallas || []).indexOf(s.talla) < 0 && perm.indexOf(s.talla) < 0) err.push('la talla ' + s.talla + ' no corresponde a ' + p.categoria);
        const actual = Number(p.stock_por_talla && p.stock_por_talla[s.talla]) || 0;
        if (c.stock_modo === 'restar' && actual - s.cantidad < 0) err.push('no hay suficiente stock de la talla ' + s.talla + ' (hay ' + actual + ')');
      });
    }
    if (op.op === 'actualizar') {
      const precio = typeof c.precio === 'number' ? c.precio : p.precio;
      if (typeof c.precio_oferta === 'number' && c.precio_oferta > 0 && c.precio_oferta >= precio) err.push('la oferta (' + nbSoles(c.precio_oferta) + ') debe ser menor que el precio (' + nbSoles(precio) + ')');
      if (typeof c.precio === 'number' && c.precio_oferta === null && typeof p.precio_oferta === 'number' && p.precio_oferta >= c.precio) err.push('el precio nuevo (' + nbSoles(c.precio) + ') no puede ser menor o igual que la oferta actual (' + nbSoles(p.precio_oferta) + '); agrega "sin oferta" u "oferta N"');
    }
  }
  if (op.entidad === 'articulo' && op.id) {
    const a = cat.articulos.find(function (x) { return x.id === op.id; });
    if (a && op.op === 'desactivar' && a.activo === false) err.push(op.id + ' ya está oculto');
    if (a && op.op === 'reactivar' && a.activo !== false) err.push(op.id + ' ya está visible');
  }
  return err;
}
// Operaciones armadas por WF4 (sin LLM). Devuelve lo mismo que validarOperacion() o {mensaje} para responder sin borrador.
function nbEvaluarOperacion(o, cat, texto, nFotos) {
  const res = function (ok, errores, op, avisos, mensaje) { return { ok: ok, errores: errores || [], avisos: avisos || [], faltantes: [], operacion: op, mensaje: mensaje || null }; };
  if (!o || typeof o !== 'object') return res(false, ['no llegó la operación']);
  const op = String(o.op || '');
  const ent = String(o.entidad || 'producto');
  const c = Object.assign({}, o.campos || {});
  const P = cat.productos, A = cat.articulos, S = cat.sitio;
  if (op === 'stock' && Array.isArray(c.stock_items)) {
    // "/stock <id> <color|talla> <n> ...": cada nombre que coincide con un color del producto va a stock_por_color;
    // si no, se prueba como talla (compatibilidad v1). Lo decide WF3 porque WF4 no tiene el catálogo.
    const p = P.find(function (x) { return x.id === o.id; });
    if (!p) return res(false, ['el producto ' + textoSeguro(o.id || '?', 20) + ' no existe']);
    const porColor = [], porTalla = [];
    for (const it of c.stock_items) {
      const color = nbColorDe(p, it && it.clave);
      const talla = color ? null : nbTalla(it && it.clave);
      if (color) porColor.push({ color: color, cantidad: Number(it.cantidad) });
      else if (talla) porTalla.push({ talla: talla, cantidad: Number(it.cantidad) });
      else return res(false, [p.id + ' no tiene el color ' + textoSeguro(it && it.clave, 24) + ' (colores: ' + (p.colores || []).map(function (x) { return x.nombre; }).join(', ') + ')']);
    }
    if (porColor.length && porTalla.length) return res(false, ['en un mismo /stock usa solo colores o solo tallas']);
    delete c.stock_items;
    c.stock_por_color = porColor; c.stock_tallas = porTalla;
  }
  if (OPS_LLM.indexOf(op) >= 0 && (ent === 'producto' || ent === 'articulo')) {
    const v = validarOperacion({ op: op, entidad: ent, id: o.id || null, campos: c, campos_inferidos: [], faltantes: [] },
      { texto: String(texto || '') + ' ' + (o.id || ''), productos: P, articulos: A, hayFoto: nFotos > 0 });
    v.avisos = v.avisos.filter(function (a) { return !/^\[(id_inferido|op_corregida)\]/.test(a); });
    // Un comando que no cambia nada (p. ej. /frescura con el mismo valor): respuesta directa, sin borrador.
    if (v.ok && op === 'actualizar' && v.faltantes.indexOf('campos') >= 0 && v.faltantes.indexOf('id') < 0) {
      return res(false, [], null, [], 'No hay nada que cambiar: ' + h(o.id) + ' ya tiene esos datos.\nSiguiente paso: revisa el producto con /ver ' + h(o.id) + '.');
    }
    return v;
  }
  if (op === 'eliminar') {
    const p = P.find(function (x) { return x.id === o.id; });
    if (!p) return res(false, ['el producto ' + textoSeguro(o.id || '?', 20) + ' no existe']);
    const avisos = [];
    A.forEach(function (a) { if ((a.productos_relacionados || []).indexOf(p.id) >= 0 || (a.bloques || []).some(function (b) { return b && b.tipo === 'producto' && (b.ids || []).indexOf(p.id) >= 0; })) avisos.push('también se quita de ' + a.id + ' (' + textoSeguro(a.titulo, 40) + ')'); });
    ((S && S.lookbook) || []).forEach(function (l) { if ((l.productos || []).indexOf(p.id) >= 0) avisos.push('también se quita del ' + l.id); });
    return res(true, [], { op: 'eliminar', entidad: 'producto', id: p.id, campos: {}, campos_inferidos: [], faltantes: [] }, avisos);
  }
  if (op === 'limpiar_muestras') {
    const m = P.filter(function (x) { return x.muestra === true; });
    if (!m.length) return res(false, [], null, [], 'No hay productos de muestra en el catálogo.\nSiguiente paso: nada; el catálogo ya está limpio.');
    if (Number(c.cantidad_confirmada) !== m.length) {
      return res(false, [], null, [], 'Hay ' + m.length + ' productos de muestra (' + h(m.slice(0, 20).map(function (x) { return x.id; }).join(', ')) + (m.length > 20 ? '…' : '') + ').' +
        (c.cantidad_confirmada ? ' Escribiste ' + h(String(c.cantidad_confirmada)) + ', que no coincide.' : '') +
        '\nSiguiente paso: si quieres quitarlos todos, escribe /limpiar_muestras ' + m.length + ' (luego pediré doble confirmación).');
    }
    const quedan = P.length - m.length;
    const avisos = ['se quitan también de artículos y del lookbook'];
    if (quedan === 0) avisos.push('el catálogo quedará vacío hasta que agregues productos reales');
    return res(true, [], { op: 'limpiar_muestras', entidad: 'producto', id: null, campos: { cantidad: m.length }, campos_inferidos: [], faltantes: [] }, avisos);
  }
  if (op === 'whatsapp') {
    const w = String(c.whatsapp || '').replace(/\D/g, '');
    if (!/^51\d{9}$/.test(w)) return res(false, ['el número debe tener 11 dígitos y empezar por 51 (ej.: 51987654321)']);
    if (WHATSAPP_EJEMPLO.indexOf(w) >= 0) return res(false, ['ese número es de ejemplo; usa el número real de la tienda']);
    if (S && S.whatsapp === w) return res(false, ['la tienda ya usa ese número']);
    return res(true, [], { op: 'whatsapp', entidad: 'sitio', id: 'site', campos: { whatsapp: w }, campos_inferidos: [], faltantes: [] }, ['revisa el número: los clientes escribirán a ese WhatsApp']);
  }
  if (op === 'deshacer') {
    if (!/^[0-9a-f]{40}$/.test(String(c.head_sha || ''))) return res(false, ['no tengo el commit a deshacer']);
    return res(true, [], { op: 'deshacer', entidad: 'sitio', id: String(c.head_sha).slice(0, 7), campos: { head_sha: c.head_sha, head_mensaje: textoSeguro(c.head_mensaje || '', 200), parent_sha: c.parent_sha || '' }, campos_inferidos: [], faltantes: [] },
      ['se publica un commit NUEVO con los datos anteriores; el historial no se borra']);
  }
  return res(false, ['operación no soportada: ' + textoSeguro(op, 30)]);
}
// Vista previa (HTML) + resumen corto + teclado. x = {draft_id, op, cat, avisos, faltantes, nFotos, extra}
function nbVistaPrevia(x) {
  const o = x.op;
  const c = o.campos || {};
  const inf = new Set(o.campos_inferidos || []);
  const P = x.cat.productos, A = x.cat.articulos, S = x.cat.sitio || {};
  const prod = o.entidad === 'producto' && o.id ? P.find(function (p) { return p.id === o.id; }) : null;
  const art = o.entidad === 'articulo' && o.id ? A.find(function (a) { return a.id === o.id; }) : null;
  const ia = function (k) { return inf.has(k) ? ' <i>(sugerido por IA)</i>' : ''; };
  const L = [];
  let resumen = '';
  const titulo = ({ crear: o.entidad === 'articulo' ? 'artículo nuevo' : 'producto nuevo', actualizar: 'actualizar', desactivar: 'ocultar', reactivar: 'volver a mostrar',
    stock: 'cambiar stock', agregar_imagen: 'agregar foto', eliminar: 'ELIMINAR', limpiar_muestras: 'QUITAR PRODUCTOS DE MUESTRA', whatsapp: 'cambiar WhatsApp', deshacer: 'DESHACER el último cambio' })[o.op] || o.op;
  const nombre = prod ? prod.nombre : art ? art.titulo : '';
  L.push('<b>Borrador ' + h(x.draft_id) + '</b>: ' + h(titulo) + (o.id && o.op !== 'deshacer' && o.entidad !== 'sitio' ? ' ' + h(o.id) : '') + (nombre ? ' · ' + h(textoSeguro(nombre, 60)) : ''));
  const ORDEN_P = ['nombre', 'categoria', 'subcategoria', 'precio', 'precio_oferta', 'tallas', 'stock_tallas', 'colores', 'material', 'frescura', 'descripcion', 'etiquetas', 'destacado'];
  if (o.entidad === 'producto' && o.op === 'crear') {
    ORDEN_P.forEach(function (k) { if (!nbVacio(c[k])) L.push(NB_ETIQUETA[k] + ': ' + nbValor(k, c[k]) + ia(k)); });
    if (nbVacio(c.frescura)) L.push('frescura: — (no reconocí la tela; puedes decir "frescura 4")');
    if (!nbVacio(c.colores)) {
      // Lo mismo que publicará WF5 (pbStockInicial de comun.js).
      const si = pbStockInicial(pbNombresColor(c.colores), c.stock_por_color, c.stock_tallas);
      L.push('stock por color: ' + h(nbStockColores(si.spc)) + ' (total ' + si.total + ')' +
        (si.modo === 'asumido' ? ' — asumido, ajústalo luego con /stock' : si.modo === 'repartido' ? ' — repartido del stock por talla' : '') + ia('stock_por_color'));
    }
    L.push('fotos: ' + (x.nFotos ? x.nFotos : 'ninguna (la web mostrará un marcador; agrégala luego con /foto)'));
    resumen = textoSeguro((c.nombre || 'producto nuevo') + (typeof c.precio === 'number' ? ' ' + nbSoles(c.precio) : ''), 300);
  } else if (o.entidad === 'producto' && o.op === 'actualizar' && prod) {
    const cambios = [];
    ORDEN_P.forEach(function (k) {
      if (nbVacio(c[k]) && !(k === 'precio_oferta' && c[k] === 0)) return;
      const antes = k === 'precio_oferta' && prod.precio_oferta === undefined ? 'sin oferta' : nbValor(k, prod[k]);
      L.push(NB_ETIQUETA[k] + ': ' + antes + ' → ' + nbValor(k, c[k]) + ia(k));
      cambios.push(k === 'precio' || k === 'precio_oferta' ? NB_ETIQUETA[k] + ' ' + (c[k] === 0 ? 'sin oferta' : Number(c[k]).toFixed(2)) : k === 'frescura' ? 'frescura ' + c[k] : NB_ETIQUETA[k]);
    });
    if (!nbVacio(c.colores)) {
      const spc = pbStockTrasColores(prod.stock_por_color, pbNombresColor(c.colores));
      L.push('stock por color: ' + h(nbStockColores(spc)) + ' (los colores nuevos empiezan en 0; ajústalos con /stock)');
    }
    resumen = textoSeguro(prod.nombre + ': ' + cambios.join(', '), 300);
  } else if (o.op === 'stock' && prod && !nbVacio(c.stock_por_color)) {
    // v2: stock por color (0 a 20), con aplicarStockColor() de validar.js: lo mismo que hará WF5.
    const modo = c.stock_modo || 'fijar';
    const r = aplicarStockColor(prod, c.stock_por_color, modo);
    const antes = prod.stock_por_color && typeof prod.stock_por_color === 'object' ? prod.stock_por_color : {};
    const signo = modo === 'sumar' ? '+' : modo === 'restar' ? '−' : '';
    c.stock_por_color.forEach(function (s) {
      const nombre = nbColorDe(prod, s.color) || s.color;
      const a = Number(antes[nombre]) || 0;
      L.push('stock ' + h(nombre) + ': ' + a + ' → ' + r.stock_por_color[nombre] + (signo ? ' (' + signo + s.cantidad + ')' : '') + (r.stock_por_color[nombre] === 0 ? ' · agotado' : ''));
    });
    L.push('stock total: ' + (Number(prod.stock) || 0) + ' → ' + r.stock);
    resumen = textoSeguro(prod.nombre + ': stock ' + c.stock_por_color.map(function (s) { return (nbColorDe(prod, s.color) || s.color) + ' ' + (modo === 'sumar' ? '+' : modo === 'restar' ? '-' : '') + s.cantidad; }).join(', '), 300);
  } else if (o.op === 'stock' && prod) {
    const modo = c.stock_modo || 'fijar';
    (c.stock_tallas || []).forEach(function (s) {
      const a = Number(prod.stock_por_talla && prod.stock_por_talla[s.talla]) || 0;
      const n = modo === 'sumar' ? a + s.cantidad : modo === 'restar' ? a - s.cantidad : s.cantidad;
      L.push('stock talla ' + h(s.talla) + ': ' + a + ' → ' + n + (modo !== 'fijar' ? ' (' + (modo === 'sumar' ? '+' : '−') + s.cantidad + ')' : ''));
    });
    resumen = textoSeguro(prod.nombre + ': stock ' + (c.stock_tallas || []).map(function (s) { return s.talla + ' ' + (modo === 'sumar' ? '+' : modo === 'restar' ? '-' : '') + s.cantidad; }).join(', '), 300);
  } else if ((o.op === 'desactivar' || o.op === 'reactivar') && (prod || art)) {
    L.push('visible en la web: ' + (o.op === 'desactivar' ? 'sí → no' : 'no → sí'));
    resumen = textoSeguro((o.op === 'desactivar' ? 'ocultar ' : 'mostrar ') + nombre, 300);
  } else if (o.op === 'agregar_imagen' && prod) {
    const n = (prod.imagenes || []).length;
    L.push('fotos: ' + n + ' → ' + (c.reemplazar === true ? x.nFotos + ' (reemplaza las actuales)' : n + x.nFotos));
    if (!nbVacio(c.alt_imagen)) L.push('descripción de la foto: ' + nbValor('alt_imagen', c.alt_imagen) + ia('alt_imagen'));
    resumen = textoSeguro(prod.nombre + ': ' + x.nFotos + ' foto(s)', 300);
  } else if (o.op === 'eliminar' && prod) {
    L.push('Se elimina del catálogo: ' + h(prod.id) + ' "' + h(textoSeguro(prod.nombre, 60)) + '" (' + nbSoles(prod.precio) + ', stock ' + (prod.stock || 0) + ').');
    resumen = textoSeguro(prod.nombre, 300);
  } else if (o.op === 'limpiar_muestras') {
    const m = P.filter(function (p) { return p.muestra === true; });
    L.push('Se quitan ' + m.length + ' productos de muestra: ' + h(m.slice(0, 30).map(function (p) { return p.id; }).join(', ')) + (m.length > 30 ? '…' : ''));
    resumen = m.length + ' productos de muestra';
  } else if (o.op === 'whatsapp') {
    L.push('WhatsApp de la tienda: ' + h(S.whatsapp || '—') + ' → ' + h(c.whatsapp));
    resumen = (S.whatsapp || '—') + ' → ' + c.whatsapp;
  } else if (o.op === 'deshacer') {
    L.push('Se revierte el commit ' + h(String(c.head_sha).slice(0, 7)) + ' ("' + h(textoSeguro(c.head_mensaje || '', 120)) + '"): data/ vuelve a la versión ' + h(String(c.parent_sha || '').slice(0, 7)) + '.');
    resumen = String(c.head_sha).slice(0, 7) + ' ' + textoSeguro(c.head_mensaje || '', 120);
  } else if (o.entidad === 'articulo' && o.op === 'crear') {
    const bl = Array.isArray(c.bloques) ? c.bloques : [];
    const palabras = bl.reduce(function (n, b) { return n + String(b.texto || '').split(/\s+/).filter(Boolean).length + (b.items || []).join(' ').split(/\s+/).filter(Boolean).length; }, 0);
    L.push('título: ' + nbValor('titulo', c.titulo) + ia('titulo'));
    if (!nbVacio(c.resumen)) L.push('resumen: ' + nbValor('resumen', c.resumen) + ia('resumen'));
    L.push('contenido: ' + bl.length + ' bloques, unas ' + palabras + ' palabras' + ia('bloques'));
    const subs = bl.filter(function (b) { return b.tipo === 'subtitulo'; }).slice(0, 6).map(function (b) { return '· ' + h(textoSeguro(b.texto, 80)); });
    if (subs.length) L.push(subs.join('\n'));
    const primero = bl.find(function (b) { return b.tipo === 'parrafo'; });
    if (primero) L.push('inicio: "' + h(textoSeguro(primero.texto, 260)) + '"');
    if (!nbVacio(c.productos_relacionados)) L.push('productos relacionados: ' + nbValor('productos_relacionados', c.productos_relacionados));
    L.push('portada: provisional (después de publicar usa /imagen art-XXXX y el botón Portada)');
    resumen = textoSeguro(c.titulo || 'artículo nuevo', 300);
  } else if (o.entidad === 'articulo' && o.op === 'actualizar' && art) {
    ['titulo', 'resumen'].forEach(function (k) { if (!nbVacio(c[k])) L.push(NB_ETIQUETA[k] + ': ' + nbValor(k, art[k]) + ' → ' + nbValor(k, c[k]) + ia(k)); });
    if (!nbVacio(c.bloques)) L.push('contenido: se reemplaza por ' + c.bloques.length + ' bloques' + ia('bloques'));
    resumen = textoSeguro(art.titulo, 300);
  } else {
    L.push('operación: ' + h(o.op) + ' ' + h(o.entidad) + ' ' + h(o.id || ''));
    resumen = textoSeguro(o.op + ' ' + (o.id || ''), 300);
  }
  const avisos = (x.avisos || []).map(nbLimpiarAviso).filter(Boolean).filter(function (a, i, l) { return l.indexOf(a) === i; }).slice(0, 6);
  if (avisos.length) L.push('Avisos:\n' + avisos.map(function (a) { return '- ' + h(a); }).join('\n'));
  (x.extra || []).forEach(function (e) { L.push(e); });
  const falt = x.faltantes || [];
  let fin;
  let teclado;
  if (falt.length) {
    const ej = falt.map(function (f) { return NB_EJEMPLO[f]; }).filter(Boolean).slice(0, 3);
    L.push('Me falta: ' + h(falt.map(function (f) { return NB_ETIQUETA[f] || f; }).join(', ')) + '. Respóndeme solo con eso' + (ej.length ? ' (ej.: ' + h(ej.join('; ')) + ')' : '') + '.');
    fin = 'Siguiente paso: envía los datos que faltan (o toca Cancelar para descartar este borrador).';
    teclado = [[{ text: 'Cancelar', callback_data: 'no:' + x.draft_id }]];
  } else {
    fin = NB_DOBLE.indexOf(o.op) >= 0 ? 'Siguiente paso: toca Publicar (te pediré una segunda confirmación) o Cancelar.' : 'Siguiente paso: toca Publicar si todo está bien, o Cancelar.';
    teclado = [[{ text: 'Publicar', callback_data: 'pub:' + x.draft_id }, { text: 'Cancelar', callback_data: 'no:' + x.draft_id }]];
  }
  let cuerpo = L.join('\n');
  if (cuerpo.length > 3800) cuerpo = cuerpo.slice(0, 3790).replace(/<[^>]*$/, '').replace(/&[a-z]*$/, '') + '…';
  if ((cuerpo.match(/<i>/g) || []).length !== (cuerpo.match(/<\/i>/g) || []).length || (cuerpo.match(/<b>/g) || []).length !== (cuerpo.match(/<\/b>/g) || []).length) cuerpo = cuerpo.replace(/<\/?[bi]>/g, '');
  return { texto: cuerpo + '\n' + fin, teclado: teclado, resumen: resumen };
}
function nbAyuda(rol, nombre, saludo) {
  const L = [];
  if (saludo) L.push('Hola' + (nombre ? ' ' + h(textoSeguro(nombre, 40)) : '') + ', soy el bot privado de Palmera Brava. Tu rol: ' + h(rol) + '.');
  L.push('<b>Producto nuevo</b>: envía una foto (o varias) con una leyenda como "Polo de lino para hombre, 59.90, tallas S M L, azul". Preparo un borrador y tú tocas Publicar.');
  L.push('<b>Consultas</b>: /lista [hombres|mujeres|ninos|accesorios|articulos|ocultos], /ver prd-0001, /estado, /historial');
  L.push('<b>Cambios</b> (siempre con borrador y botón Publicar): /precio prd-0001 69.90 [oferta 59.90 | sin oferta], /stock prd-0001 Blanco 5 (stock por color, de 0 a 20; Blanco +2 si llegaron, Blanco -1 si vendiste; varios: Blanco 5 Arena 3), /frescura prd-0001 5 (de 1 a 5 hojitas), /ocultar prd-0001, /mostrar prd-0001, /foto prd-0001 (como leyenda de una foto), /cancelar');
  L.push('<b>Producto nuevo con stock</b>: "Polo de lino blanco y arena, 59.90, tallas S M L, 10 por color". La frescura se sugiere por la tela (lino 5, algodón 4, dri-fit 3, denim 2).');
  L.push('<b>Contenido</b>: /articulo tema, /articulo_ocultar art-0001, /imagen [art-0001|look-1] descripción');
  L.push('<b>Pedidos</b>: /pedidos (abiertos), /pedido PB-000101, /envios (opciones, costos y tiempos)' + (rol === 'marketing' ? ' (sin datos de contacto del cliente)' : ''));
  if (rol === 'admin' || rol === 'dueno') L.push('<b>Estados</b>: /preparando PB-000101, /enviar PB-000101 shalom 12345678-ABCD (olva 26-0123456, bus Movil Bus:0012345, local), /recojo PB-000101, /entregado PB-000101, /cancelar_pedido PB-000101 (con botón)');
  if (rol === 'admin' || rol === 'dueno') L.push('<b>Usuarios</b>: /desconocidos, /autorizar 123456789 dueno|marketing, /desautorizar 123456789 (con botón; admin no se asigna por el bot)');
  if (rol === 'admin' || rol === 'dueno') L.push('<b>Delicado</b> (doble confirmación): /borrar prd-0001, /whatsapp 51987654321, /limpiar_muestras, /deshacer, /pausa, /reanudar');
  if (rol === 'admin') L.push('<b>Admin</b>: /ids (quién escribió sin estar autorizado)');
  L.push('Siguiente paso: envía una foto con su descripción o usa uno de los comandos.');
  return L.join('\n');
}
// --- fin comun-negocio.js ---
