#!/usr/bin/env node
/*
 * n8n/tools/probar-negocio.js — Ejecuta los nodos Code REALES de n8n/workflows/WF3-borrador-ia.json y WF4-comandos.json
 * con datos simulados (y data/*.json reales) en el mismo mini-runtime que probar-nucleo.js ($input, $('Nodo'), this.helpers).
 *   node n8n/tools/probar-negocio.js            (simulado: sin Telegram, GitHub ni n8n)
 *   node n8n/tools/probar-negocio.js --ollama [--articulo]   (además: 4 mensajes REALES a Ollama en http://127.0.0.1:11434 con
 *                                                el cuerpo exacto que arma WF3 -prompt y format-; al final keep_alive:0)
 * Integración: los borradores que arma WF3 se pasan por "Aplicar lote" de WF5 (el aplicador real) para comprobar el contrato.
 */
'use strict';
// Credencial de un nodo: el repo guarda los workflows limpios (tools/limpiar-workflows.js quita el id, PLAN D14) y
// n8n/tools/preparar-importacion.js lo vuelve a poner; se acepta sin id o con el id fijo, siempre con el nombre exacto.
function credOk(c, id, nombre) { return !!c && (c.id === undefined || c.id === id) && c.name === nombre; }
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..');
const WF = function (f) { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'n8n', 'workflows', f), 'utf8')); };
const W3 = WF('WF3-borrador-ia.json'), W4 = WF('WF4-comandos.json'), W5 = WF('WF5-publicar.json');
const DATA = function (f) { return fs.readFileSync(path.join(RAIZ, 'data', f), 'utf8'); };
const DOCS = { products: DATA('products.json'), articles: DATA('articles.json'), site: DATA('site.json') };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TOKEN_FALSO = '123456789:' + 'X'.repeat(35);
const REAL = process.argv.includes('--ollama');
const OLLAMA = 'http://127.0.0.1:11434';

let ok = 0, fallos = 0;
function caso(nombre, cond, detalle) {
  if (cond) { ok++; console.log('  ok   ' + nombre); }
  else { fallos++; console.log('  FALLA ' + nombre + (detalle !== undefined ? ' -> ' + JSON.stringify(detalle).slice(0, 500) : '')); }
}
const items = function (l) { return (l || []).map(function (j) { return j && (j.json || j.binary) ? j : { json: j }; }); };
async function correr(wf, nodo, input, nodos, helpers) {
  const n = wf.nodes.find(function (x) { return x.name === nodo; });
  if (!n) throw new Error(wf.name + ': no existe el nodo ' + nodo);
  const inp = items(input);
  const $ = function (nombre) {
    if (!(nombre in (nodos || {}))) return { isExecuted: false, first: function () { throw new Error('nodo no ejecutado: ' + nombre); }, all: function () { throw new Error('nodo no ejecutado: ' + nombre); } };
    const l = items(nodos[nombre]);
    return { isExecuted: true, first: function () { return l[0]; }, last: function () { return l[l.length - 1]; }, all: function () { return l; } };
  };
  const $input = { all: function () { return inp; }, first: function () { return inp[0]; }, last: function () { return inp[inp.length - 1]; } };
  const f = new AsyncFunction('$', '$input', '$json', '$execution', n.parameters.jsCode);
  const r = await f.call({ helpers: helpers || {} }, $, $input, inp[0] ? inp[0].json : {}, { id: '900' });
  return (r || []).map(function (x) { return x.json; });
}
function camino(wf, de, a) {
  const vistos = new Set([de]);
  const pila = [de];
  while (pila.length) {
    const x = pila.pop();
    if (x === a) return true;
    ((wf.connections[x] || {}).main || []).forEach(function (l) { (l || []).forEach(function (y) { if (!vistos.has(y.node)) { vistos.add(y.node); pila.push(y.node); } }); });
  }
  return false;
}
const nodo = function (wf, n) { return wf.nodes.find(function (x) { return x.name === n; }); };
const AUT = JSON.stringify([{ id: 111, rol: 'admin', nombre: 'Abner' }, { id: 222, rol: 'dueno', nombre: 'Dueño' }, { id: 333, rol: 'marketing', nombre: 'Mkt' }]);
const CONFIG_FILAS = [{ clave: 'BOT_TOKEN', valor: TOKEN_FALSO }, { clave: 'AUTORIZADOS', valor: AUT }, { clave: 'PAUSA', valor: '0' },
  { clave: 'ULTIMO_COMMIT_AT', valor: String(Date.now() - 120000) }, { clave: 'MIN_ENTRE_COMMITS_MS', valor: '360000' },
  { clave: 'DESCONOCIDOS', valor: JSON.stringify([{ id: 999, nombre: 'Extraño', fecha: '2026-10-06T10:00:00-05:00' }]) }];
const gh = function (txt, cod) { return { statusCode: cod || 200, body: txt, headers: {} }; };
const llm = function (op, campos, extra) {
  return { message: { role: 'assistant', content: JSON.stringify(Object.assign({ op: op, entidad: 'producto', id: null, campos: campos || {}, campos_inferidos: [], faltantes: [] }, extra || {})) }, total_duration: 2.5e9 };
};
const trabajo = function (o) {
  return Object.assign({ tipo: 'texto', update_ids: [701], chat_id: 222, from_id: 222, nombre: 'Dueño', rol: 'dueno', message_id: 5, texto: '', comando: '', args: [], fotos: [], callback: null, origen: 'telegram' }, o || {});
};
const entradaWF3 = function (t, o) { return Object.assign({}, t, { trabajo: t, modo: 'llm', tipo_entidad: 'producto', draft_id: '' }, o || {}); };
const WEBP = [fs.readFileSync(path.join(RAIZ, 'assets', 'img', 'products', 'prd-0005-1.webp')), fs.readFileSync(path.join(RAIZ, 'assets', 'img', 'products', 'prd-0001-1.webp'))];
const TODOS = [];
const terminaBien = function (m) { return !m.cuerpo || !m.cuerpo.text || /\nSiguiente paso: \S[^\n]*$/.test(m.cuerpo.text); };

// Recorre WF3 como lo haría n8n (mismas ramas) con Data Tables, GitHub, Telegram y Ollama simulados (Ollama puede ser real).
async function flujoWF3(entrada, o) {
  o = o || {};
  const N = { Entrada: [entrada] };
  N['Config'] = await correr(W3, 'Config', CONFIG_FILAS, N);
  N['Preparar'] = await correr(W3, 'Preparar', [{}], N);
  N['Leer borrador previo'] = o.previo ? [o.previo] : [{}];
  const d = o.docs || DOCS;
  N['GET productos'] = [gh(d.products, o.ghCodigo)]; N['GET articulos'] = [gh(d.articles)]; N['GET sitio'] = [gh(d.site)];
  N['Catalogo'] = await correr(W3, 'Catalogo', N['GET sitio'], N);
  if (!N['Catalogo'][0].ok) { N['Salida sin catalogo'] = await correr(W3, 'Salida sin catalogo', N['Catalogo'], N); N.salida = N['Salida sin catalogo'][0]; return N; }
  if (N['Preparar'][0].fotos.length) {
    N['Fotos a descargar'] = await correr(W3, 'Fotos a descargar', [{}], N);
    const bufs = o.fotos || [];
    const its = N['Fotos a descargar'].map(function (f, i) { return bufs[i] ? { json: { ok: true }, binary: { data: { mimeType: 'image/webp', fileName: 'x.webp' } } } : { json: { error: 'Bad Request: file not found' } }; });
    N['Fotos procesadas'] = await correr(W3, 'Fotos procesadas', its, N, { getBinaryDataBuffer: async function (i) { return bufs[i]; } });
  }
  if (N['Preparar'][0].modo !== 'operacion') {
    N['Cuerpo Ollama'] = await correr(W3, 'Cuerpo Ollama', [{}], N);
    const r1 = await o.ollama(N['Cuerpo Ollama'][0].cuerpo, 1);
    N['Ollama'] = [r1];
    N['Validar IA'] = await correr(W3, 'Validar IA', [r1], N);
    if (N['Validar IA'][0].estado === 'reintentar') {
      const r2 = await o.ollama(N['Validar IA'][0].cuerpo2, 2);
      N['Ollama reintento'] = [r2];
      N['Validar reintento'] = await correr(W3, 'Validar reintento', [r2], N);
    }
  }
  N['Armar borrador'] = await correr(W3, 'Armar borrador', [{}], N);
  const a = N['Armar borrador'][0];
  if (a.accion === 'crear') {
    N['Fila nueva'] = await correr(W3, 'Fila nueva', [a], N);
    N['Insertar borrador'] = [Object.assign({ id: 41 }, N['Fila nueva'][0])];
  } else if (a.accion === 'actualizar') N['Actualizar borrador'] = o.actualizarFalla ? [{}] : [Object.assign({ id: 40 }, o.previo, a.fila)];
  if (a.accion !== 'mensaje') {
    N['Filas imagenes'] = await correr(W3, 'Filas imagenes', [{}], N);
    if (N['Filas imagenes'][0].nada !== true) N['Insertar imagenes'] = N['Filas imagenes'];
  }
  N['Mensajes'] = await correr(W3, 'Mensajes', [{}], N);
  N['Mensajes'].forEach(function (m) { TODOS.push(m); });
  N['Enviar Telegram'] = N['Mensajes'].map(function (m, i) { return o.telegramFalla ? { ok: false, error_code: 502, description: 'Bad Gateway' } : { ok: true, result: { message_id: 800 + i } }; });
  N['Preview enviado'] = await correr(W3, 'Preview enviado', N['Enviar Telegram'], N);
  N['Guardar preview id'] = [{}];
  N['Salida'] = await correr(W3, 'Salida', [{}], N);
  N.salida = N['Salida'][0];
  return N;
}
// Aplica la fila del borrador con el "Aplicar lote" REAL de WF5 sobre data/*.json (contrato WF3 -> WF5).
async function aplicarEnWF5(fila, imagenes) {
  const lote = [Object.assign({}, fila, { estado: 'publicando' })];
  const head = 'a'.repeat(40);
  const pedidos = ['products', 'articles', 'site'].map(function (n) { return { nombre: n, cual: 'actual', ref: head, head: head, tree: 'b'.repeat(40), padre: 'c'.repeat(40), autor: 'Abner' }; });
  const out = await correr(W5, 'Aplicar lote', pedidos.map(function (p) { return gh(DOCS[p.nombre]); }),
    { Tomados: [{ draft_id: fila.draft_id, lote: lote }], 'Leer imagenes': imagenes && imagenes.length ? imagenes : [{}], 'Pedir archivos': pedidos });
  const j = out[0] || {};
  const res = (j.arbol && j.arbol.resultados) || j.resultados || {};
  const r = res[fila.draft_id] || { estado: '?', paso: j.paso, motivo: j.motivo };
  const txt = j.arbol && j.arbol.textos && j.arbol.textos.products;
  Object.defineProperty(r, 'producto', { enumerable: false, value: function (id) { return txt ? JSON.parse(txt).productos.find(function (p) { return p.id === id; }) : null; } });
  return r;
}
const SIG_ID = 'prd-' + String(JSON.parse(DOCS.products).productos.reduce(function (m, p) { return Math.max(m, Number(p.id.slice(4))); }, 0) + 1).padStart(4, '0');
async function flujoWF4(t, o) {
  o = o || {};
  const N = { Entrada: [{ trabajo: t }] };
  N['Config'] = await correr(W4, 'Config', CONFIG_FILAS, N);
  N['Interpretar'] = await correr(W4, 'Interpretar', [{}], N);
  return N;
}

(async function () {
  const sim = function (respuestas) { let i = 0; return async function () { return respuestas[Math.min(i++, respuestas.length - 1)]; }; };
  console.log('WF3 Borrador-IA (simulado)');
  // 1) álbum de 2 fotos + leyenda completa (una foto falla al descargar)
  let N = await flujoWF3(entradaWF3(trabajo({ tipo: 'foto', texto: 'Vestido de lino para dama, 79.90, tallas S M L, color naranja', fotos: [{ file_id: 'F1', file_unique_id: 'U1' }, { file_id: 'F2', file_unique_id: 'U2' }, { file_id: 'F3', file_unique_id: 'U3' }] })),
    { fotos: [WEBP[0], WEBP[1], null], ollama: sim([llm('crear', { nombre: 'Vestido de lino', categoria: 'mujeres', subcategoria: 'vestidos', precio: 79.9, tallas: ['S', 'M', 'L'], colores: ['naranja'], material: 'lino', descripcion: 'Vestido fresco.', alt_imagen: 'Vestido naranja de lino' }, { campos_inferidos: ['descripcion', 'subcategoria'], faltantes: ['material', 'stock_tallas'] })]) });
  const c1 = N['Cuerpo Ollama'][0].cuerpo;
  const formato = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data', 'schema', 'ollama-format-producto.json'), 'utf8'));
  const md = fs.readFileSync(path.join(RAIZ, 'n8n', 'prompts', 'extraccion.md'), 'utf8').replace(/\r\n/g, '\n');
  const promptMd = /## Producto[^\n]*\n+```text\n([\s\S]*?)\n```/.exec(md)[1];
  caso('Ollama: format = data/schema/ollama-format-producto.json, think:false, num_ctx 8192, stream:false', JSON.stringify(c1.format) === JSON.stringify(formato) && c1.think === false && c1.options.num_ctx === 8192 && c1.stream === false);
  caso('Ollama: prompt del sistema = n8n/prompts/extraccion.md con el catálogo (16 líneas)', c1.messages[0].content.startsWith(promptMd.split('{{CATALOGO}}')[0]) && /prd-0016 \| Bolso de yute tejido \| accesorios \| /.test(c1.messages[0].content) && !/\{\{CATALOGO\}\}/.test(c1.messages[0].content));
  caso('Ollama: 2 fotos WebP en base64 (la 3.ª falló)', c1.messages[1].images.length === 2 && Buffer.from(c1.messages[1].images[0], 'base64').toString('ascii', 8, 12) === 'WEBP');
  const fp = N['Fotos procesadas'][0].fotos;
  caso('Fotos procesadas: medidas leídas de la cabecera WebP (768x1024) y fallida = ok:false', fp[0].ok && fp[0].ancho === 768 && fp[0].alto === 1024 && fp[2].ok === false, fp.map(function (f) { return [f.ok, f.ancho, f.alto]; }));
  let a = N['Armar borrador'][0];
  const fila = N['Fila nueva'][0];
  const COLS = ['draft_id', 'owner_id', 'rol', 'chat_id', 'preview_message_id', 'origen', 'op', 'entidad', 'entidad_id', 'campos', 'campos_inferidos', 'faltantes', 'avisos', 'update_ids', 'file_ids', 'file_unique_ids', 'fecha', 'expira', 'estado', 'confirmaciones', 'confirmaciones_requeridas', 'intentos', 'error', 'commit_sha', 'texto', 'resumen', 'fecha_ms'];
  caso('fila = exactamente las 27 columnas de pb_borradores, estado pendiente, expira +24 h', JSON.stringify(Object.keys(fila).sort()) === JSON.stringify(COLS.slice().sort()) && fila.estado === 'pendiente' && Date.parse(fila.expira) - Date.parse(fila.fecha) === 86400000 && /^drf-[a-z0-9]{6,20}$/.test(fila.draft_id));
  caso('faltantes opcionales del LLM (material, stock) NO bloquean: Publicar + Cancelar', fila.faltantes === '[]' && a.mensajes[0].cuerpo.reply_markup.inline_keyboard[0].map(function (b) { return b.callback_data; }).join() === 'pub:' + fila.draft_id + ',no:' + fila.draft_id);
  const vp = a.mensajes[0].cuerpo.text;
  caso('vista previa: "(sugerido por IA)", stock asumido, aviso de foto fallida y "Siguiente paso"', /descripción: .*sugerido por IA/.test(vp) && /stock por color: Naranja 1 \(total 1\) — asumido/.test(vp) && /No pude descargar 1 foto/.test(vp) && terminaBien(a.mensajes[0]), vp);
  caso('v2: vista previa "frescura: 5/5 hojitas (sugerido por IA)" (lino, inferida por la tabla)', /frescura: 5\/5 hojitas <i>\(sugerido por IA\)<\/i>/.test(vp) && JSON.parse(fila.campos).frescura === 5 && JSON.parse(fila.campos_inferidos).indexOf('frescura') >= 0, vp);
  caso('pb_imagenes: 2 filas WebP con medidas y alt', N['Insertar imagenes'].length === 2 && N['Insertar imagenes'][0].mime === 'image/webp' && N['Insertar imagenes'][0].ancho === 768 && N['Insertar imagenes'][1].n === 2 && N['Insertar imagenes'][0].alt === 'Vestido naranja de lino');
  caso('preview_message_id guardado y salida {ok, draft_id}', N['Preview enviado'][0].preview_message_id === 800 && N.salida.ok === true && N.salida.draft_id === fila.draft_id);
  let ap = await aplicarEnWF5(fila, N['Insertar imagenes']);
  caso('WF5 "Aplicar lote" acepta el borrador (crea ' + SIG_ID + ' con 2 imágenes)', ap.estado === 'publicado' && ap.entidad_id === SIG_ID, ap);
  let pn = ap.producto(SIG_ID);
  caso('v2: WF5 publica stock_por_color {Naranja:1}, stock 1, frescura 5 y sin stock_por_talla', pn && JSON.stringify(pn.stock_por_color) === '{"Naranja":1}' && pn.stock === 1 && pn.frescura === 5 && pn.stock_por_talla === undefined && Object.keys(pn).indexOf('stock_por_color') < Object.keys(pn).indexOf('stock'), pn);

  // 1b) v2: "10 por color" + frescura inferida por el material aunque el LLM no la dé (format v2)
  N = await flujoWF3(entradaWF3(trabajo({ texto: 'Polo de lino blanco y arena para hombre, 59.90, tallas S M L, 10 por color' })),
    { ollama: sim([llm('crear', { nombre: 'Polo de lino', categoria: 'hombres', subcategoria: 'polos', precio: 59.9, tallas: ['S', 'M', 'L'], colores: ['blanco', 'arena'], material: 'lino', stock_por_color: [{ color: 'blanco', cantidad: 10 }, { color: 'arena', cantidad: 10 }] }, { campos_inferidos: ['material', 'colores', 'subcategoria'] })]) });
  a = N['Armar borrador'][0];
  caso('v2: format de Ollama con frescura y stock_por_color', !!N['Cuerpo Ollama'][0].cuerpo.format.properties.campos.properties.frescura && !!N['Cuerpo Ollama'][0].cuerpo.format.properties.campos.properties.stock_por_color && /10 por color/.test(N['Cuerpo Ollama'][0].cuerpo.messages[0].content));
  caso('v2: "10 por color" -> vista previa "stock por color: Blanco 10, Arena 10 (total 20)" y frescura sugerida', /stock por color: Blanco 10, Arena 10 \(total 20\)/.test(a.mensajes[0].cuerpo.text) && /frescura: 5\/5 hojitas <i>\(sugerido por IA\)/.test(a.mensajes[0].cuerpo.text) && a.fila.faltantes === '[]', a.mensajes[0].cuerpo.text);
  caso('tela y colores escritos por el dueño no salen como "(sugerido por IA)"', /material: lino\n/.test(a.mensajes[0].cuerpo.text) && /colores: blanco, arena\n/.test(a.mensajes[0].cuerpo.text) && /subcategoría: polos <i>\(sugerido por IA\)/.test(a.mensajes[0].cuerpo.text), a.mensajes[0].cuerpo.text);
  ap = await aplicarEnWF5(a.fila, []);
  pn = ap.producto(SIG_ID);
  caso('v2: WF5 publica {Blanco:10, Arena:10}, stock 20, frescura 5', ap.estado === 'publicado' && pn && JSON.stringify(pn.stock_por_color) === '{"Blanco":10,"Arena":10}' && pn.stock === 20 && pn.frescura === 5, pn || ap);
  // 1c) plantilla manual (IA caída) con "stock por color: 10 por color" y colores en otra línea
  N = await flujoWF3(entradaWF3(trabajo({ texto: 'nombre: Short de drill\ncategoria: hombres\nprecio: 49.90\ntallas: S M L\nstock por color: 4 por color\ncolores: beige, negro\nmaterial: drill' })),
    { ollama: sim([{ error: 'connect ECONNREFUSED' }]) });
  a = N['Armar borrador'][0];
  const cpl0 = a.fila ? JSON.parse(a.fila.campos) : {};
  caso('v2: plantilla sin IA: "4 por color" se reparte en los colores y frescura 3 (drill) sugerida', a.fila && JSON.stringify(cpl0.stock_por_color) === '[{"color":"beige","cantidad":4},{"color":"negro","cantidad":4}]' && cpl0.frescura === 3 && /frescura: 3\/5 hojitas <i>\(sugerido por IA\)/.test(a.mensajes[0].cuerpo.text), a.fila || a.mensajes);

  // 2) "actualizar" a un producto parecido sin pedir cambio -> corrección determinista + 1 reintento
  N = await flujoWF3(entradaWF3(trabajo({ texto: 'Camisa de lino blanca para hombre 89,90 tallas M L XL' })),
    { ollama: sim([llm('actualizar', { precio: 89.9 }, { id: 'prd-0001' }), llm('crear', { nombre: 'Camisa de lino blanca', categoria: 'hombres', precio: 89.9, tallas: ['M', 'L', 'XL'], colores: ['blanco'] })]) });
  caso('LLM "actualiza" un parecido -> se corrige a crear y se reintenta 1 vez', N['Validar IA'][0].estado === 'reintentar' && /producto NUEVO/.test(N['Validar IA'][0].cuerpo2.messages[1].content) && N['Validar reintento'][0].estado === 'ok');
  a = N['Armar borrador'][0];
  caso('resultado del reintento: crear completo, sin faltantes', a.accion === 'crear' && a.fila.op === 'crear' && a.fila.faltantes === '[]', a.fila);
  // 3) falta el precio -> pide solo eso; luego "completar"
  N = await flujoWF3(entradaWF3(trabajo({ texto: 'Short de drill para hombre tallas 30 M L color beige', from_id: 333, chat_id: 333, rol: 'marketing' })),
    { ollama: sim([llm('crear', { nombre: 'Short de drill', categoria: 'hombres', tallas: ['M', 'L'], colores: ['beige'] }, { faltantes: ['precio'] })]) });
  a = N['Armar borrador'][0];
  caso('falta precio: "Me falta: precio", solo botón Cancelar, sin Publicar', JSON.parse(a.fila.faltantes).join() === 'precio' && /Me falta: precio/.test(a.mensajes[0].cuerpo.text) && a.mensajes[0].cuerpo.reply_markup.inline_keyboard[0].length === 1 && terminaBien(a.mensajes[0]));
  const previo = Object.assign({}, N['Fila nueva'][0], { id: 40, preview_message_id: 801 });
  N = await flujoWF3(entradaWF3(trabajo({ texto: 'precio 45.90', from_id: 333, chat_id: 333, rol: 'marketing' }), { modo: 'completar', draft_id: previo.draft_id }),
    { previo: previo, ollama: sim([llm('crear', { nombre: 'Short de drill', categoria: 'hombres', precio: 45.9, tallas: ['M', 'L'], colores: ['beige'], descripcion: 'Otra descripción' }, { campos_inferidos: ['descripcion'] })]) });
  a = N['Armar borrador'][0];
  caso('completar: mismo draft_id, precio añadido, sin faltantes, quita botones de la vista previa anterior', a.accion === 'actualizar' && a.draft_id === previo.draft_id && JSON.parse(a.fila.campos).precio === 45.9 && a.fila.faltantes === '[]' &&
    a.mensajes[0].metodo === 'editMessageReplyMarkup' && a.mensajes[0].cuerpo.message_id === 801 && /Datos que faltaban: precio 45.90/.test(N['Cuerpo Ollama'][0].texto_ia));
  N = await flujoWF3(entradaWF3(trabajo({ texto: 'precio 45.90', from_id: 333, chat_id: 333, rol: 'marketing' }), { modo: 'completar', draft_id: previo.draft_id }),
    { previo: previo, actualizarFalla: true, ollama: sim([llm('crear', { precio: 45.9 })]) });
  caso('completar sobre un borrador que ya no está pendiente -> aviso, sin vista previa', N['Mensajes'].length === 1 && /ya no estaba pendiente/.test(N['Mensajes'][0].cuerpo.text));
  // 4) Ollama caído
  N = await flujoWF3(entradaWF3(trabajo({ tipo: 'foto', texto: 'Blusa nueva', fotos: [{ file_id: 'F1', file_unique_id: 'U1' }] })),
    { fotos: [WEBP[0]], ollama: sim([{ error: { message: 'connect ECONNREFUSED 172.17.0.1:11434' } }]) });
  a = N['Armar borrador'][0];
  caso('IA caída con foto: borrador con la foto + plantilla manual y faltantes obligatorios', a.accion === 'crear' && N['Insertar imagenes'].length === 1 && /La IA local no responde/.test(a.mensajes[0].cuerpo.text) &&
    /precio/.test(a.fila.faltantes) && /colores/.test(a.fila.faltantes) && terminaBien(a.mensajes[0]));
  const previoIA = Object.assign({}, N['Fila nueva'][0], { id: 42, preview_message_id: 802 });
  N = await flujoWF3(entradaWF3(trabajo({ texto: 'nombre: Blusa de gasa\ncategoria: mujeres\nprecio: S/ 49,90\ntallas: S M L\ncolores: blanco, rosado' }), { modo: 'completar', draft_id: previoIA.draft_id }),
    { previo: previoIA, ollama: sim([{ error: 'model not found' }]) });
  a = N['Armar borrador'][0];
  const cpl = JSON.parse(a.fila.campos);
  caso('IA caída + plantilla llena: se completa sin IA (determinista)', a.accion === 'actualizar' && a.fila.faltantes === '[]' && cpl.precio === 49.9 && cpl.categoria === 'mujeres' && cpl.tallas.join() === 'S,M,L' && cpl.colores.length === 2, cpl);
  N = await flujoWF3(entradaWF3(trabajo({ texto: 'sube el precio del prd-0003 a 59' })), { ollama: sim([{ error: 'timeout' }]) });
  caso('IA caída y el texto pide un cambio -> sugiere comandos, sin borrador', N['Armar borrador'][0].accion === 'mensaje' && /\/precio prd-0001 69.90/.test(N['Mensajes'][0].cuerpo.text));
  // 5) sin catálogo -> reintentar
  N = await flujoWF3(entradaWF3(trabajo({ texto: 'Polo' })), { ghCodigo: 401, ollama: sim([llm('crear', {})]) });
  caso('GitHub sin acceso -> {ok:false, reintentar:true} sin llamar a la IA', N.salida.ok === false && N.salida.reintentar === true && !N['Cuerpo Ollama'] && /HTTP 401/.test(N.salida.error));
  // 6) Telegram no entrega la vista previa -> reintentar
  N = await flujoWF3(entradaWF3(trabajo({ texto: 'Polo de algodón para dama 39.90 tallas S M rojo' })),
    { telegramFalla: true, ollama: sim([llm('crear', { nombre: 'Polo de algodón', categoria: 'mujeres', precio: 39.9, tallas: ['S', 'M'], colores: ['rojo'] })]) });
  caso('vista previa no enviada -> {ok:false, reintentar:true}', N.salida.ok === false && N.salida.reintentar === true);
  caso('vista previa no enviada -> el borrador nuevo se marca "error" (no queda "pendiente" huérfano)', N['Preview enviado'][0].estado === 'error' && N['Preview enviado'][0].draft_id === N['Armar borrador'][0].draft_id);
  // 7) categoría corregida por el texto
  N = await flujoWF3(entradaWF3(trabajo({ texto: 'Gorro UV para niños celeste 25 soles talla unica' })),
    { ollama: sim([llm('crear', { nombre: 'Gorro UV', categoria: 'accesorios', subcategoria: 'gorros', precio: 25, tallas: ['UNICA'], colores: ['celeste'] })]) });
  a = N['Armar borrador'][0];
  caso('categoría corregida a "ninos" con aviso en la vista previa', JSON.parse(a.fila.campos).categoria === 'ninos' && /el texto indica "ninos"/.test(a.mensajes[0].cuerpo.text));
  // 8) artículo
  const bloques = [{ tipo: 'parrafo', texto: 'En Tarapoto el sol pega fuerte todo el año.', items: [] }, { tipo: 'subtitulo', texto: 'Telas frescas', items: [] }, { tipo: 'lista', texto: '', items: ['Lino', 'Algodón', 'Viscosa'] }];
  N = await flujoWF3(entradaWF3(trabajo({ texto: 'qué ropa usar en la selva', tipo: 'comando' }), { tipo_entidad: 'articulo' }),
    { ollama: sim([{ message: { content: JSON.stringify({ op: 'crear', entidad: 'articulo', id: null, campos: { titulo: 'Qué ropa usar en la selva', resumen: 'Consejos para vestir fresco en el calor de Tarapoto.', bloques: bloques, productos_relacionados: ['prd-0001', 'prd-0999'], alt_portada: 'Prendas de lino sobre una silla' }, campos_inferidos: ['titulo', 'resumen', 'bloques'], faltantes: [] }) } }]) });
  a = N['Armar borrador'][0];
  caso('/articulo: prompt de artículo + format de artículo, temperatura 0.3', N['Cuerpo Ollama'][0].cuerpo.options.temperature === 0.3 && N['Cuerpo Ollama'][0].cuerpo.format.properties.entidad.enum[0] === 'articulo' && /redactor del blog/.test(N['Cuerpo Ollama'][0].cuerpo.messages[0].content));
  caso('/articulo: borrador con título (sugerido por IA), id inexistente quitado, portada provisional', a.accion === 'crear' && a.fila.entidad === 'articulo' && /título: .*sugerido por IA/.test(a.mensajes[0].cuerpo.text) &&
    JSON.parse(a.fila.campos).productos_relacionados.join() === 'prd-0001' && /portada: provisional/.test(a.mensajes[0].cuerpo.text));
  ap = await aplicarEnWF5(a.fila, []);
  caso('WF5 "Aplicar lote" acepta el artículo (art-0004)', ap.estado === 'publicado' && ap.entidad_id === 'art-0004', ap);

  console.log('WF3 · operaciones de WF4 (sin IA)');
  const op = async function (rol, operacion, extraT) {
    const id = { admin: 111, dueno: 222, marketing: 333 }[rol];
    const t = trabajo(Object.assign({ tipo: 'comando', from_id: id, chat_id: id, rol: rol, texto: '/x ' + (operacion.id || '') }, extraT || {}));
    return flujoWF3(Object.assign({}, t, { trabajo: t, modo: 'operacion', tipo_entidad: operacion.entidad === 'articulo' ? 'articulo' : 'producto', operacion: operacion, draft_id: '' }), { fotos: extraT && extraT.bufs });
  };
  N = await op('marketing', { op: 'actualizar', entidad: 'producto', id: 'prd-0001', campos: { precio: 79.9 } });
  a = N['Armar borrador'][0];
  caso('/precio: diff "precio: S/ 89.90 → S/ 79.90", sin IA, 1 confirmación', !N['Cuerpo Ollama'] && /precio: S\/ 89\.90 → S\/ 79\.90/.test(a.mensajes[0].cuerpo.text) && a.fila.confirmaciones_requeridas === 1 && a.fila.op === 'actualizar', a.mensajes[0] && a.mensajes[0].cuerpo.text);
  ap = await aplicarEnWF5(a.fila, []);
  caso('WF5 aplica el /precio', ap.estado === 'publicado', ap);
  N = await op('dueno', { op: 'actualizar', entidad: 'producto', id: 'prd-0001', campos: { precio: 70 } });
  caso('precio menor o igual que la oferta vigente -> error claro, sin borrador', N['Armar borrador'][0].accion === 'mensaje' && /oferta actual/.test(N['Mensajes'][0].cuerpo.text));
  N = await op('dueno', { op: 'actualizar', entidad: 'producto', id: 'prd-0001', campos: { precio_oferta: 0 } });
  caso('"sin oferta": precio de oferta: S/ 74.90 → sin oferta', /precio de oferta: S\/ 74\.90 → sin oferta/.test(N['Mensajes'][0].cuerpo.text));
  // v2: /stock por color (WF4 manda stock_items; WF3 decide color o talla con el catálogo)
  N = await op('dueno', { op: 'stock', entidad: 'producto', id: 'prd-0001', campos: { stock_items: [{ clave: 'blanco hueso', cantidad: 2 }], stock_modo: 'sumar' } });
  caso('v2 /stock prd-0001 blanco hueso +2: "stock Blanco hueso: 7 → 9 (+2)" y total 19 → 21', /stock Blanco hueso: 7 → 9 \(\+2\)/.test(N['Mensajes'][0].cuerpo.text) && /stock total: 19 → 21/.test(N['Mensajes'][0].cuerpo.text), N['Mensajes'][0].cuerpo.text);
  ap = await aplicarEnWF5(N['Armar borrador'][0].fila, []);
  pn = ap.producto('prd-0001');
  caso('v2: WF5 aplica el /stock por color ({Arena:12, Blanco hueso:9}, stock 21)', ap.estado === 'publicado' && pn && JSON.stringify(pn.stock_por_color) === '{"Arena":12,"Blanco hueso":9}' && pn.stock === 21, pn || ap);
  N = await op('dueno', { op: 'stock', entidad: 'producto', id: 'prd-0002', campos: { stock_items: [{ clave: 'Celeste', cantidad: 0 }, { clave: 'blancos hueso', cantidad: 20 }], stock_modo: 'fijar' } });
  caso('v2 /stock varios colores: "Celeste: 0 → 0 · agotado" y plural/minúsculas reconocidos', /stock Celeste: 0 → 0 · agotado/.test(N['Mensajes'][0].cuerpo.text) && /stock Blanco hueso: 9 → 20/.test(N['Mensajes'][0].cuerpo.text), N['Mensajes'][0].cuerpo.text);
  N = await op('dueno', { op: 'stock', entidad: 'producto', id: 'prd-0001', campos: { stock_items: [{ clave: 'Arena', cantidad: 25 }], stock_modo: 'fijar' } });
  caso('v2 /stock Arena 25 -> error "de 0 a 20", sin borrador', N['Armar borrador'][0].accion === 'mensaje' && /de 0 a 20/.test(N['Mensajes'][0].cuerpo.text), N['Mensajes'][0].cuerpo.text);
  N = await op('dueno', { op: 'stock', entidad: 'producto', id: 'prd-0001', campos: { stock_items: [{ clave: 'Arena', cantidad: 13 }], stock_modo: 'restar' } });
  caso('v2 /stock Arena -13 con 12 -> "no hay suficiente stock"', N['Armar borrador'][0].accion === 'mensaje' && /no hay suficiente stock de Arena/.test(N['Mensajes'][0].cuerpo.text), N['Mensajes'][0].cuerpo.text);
  N = await op('dueno', { op: 'stock', entidad: 'producto', id: 'prd-0001', campos: { stock_items: [{ clave: 'fucsia', cantidad: 3 }], stock_modo: 'fijar' } });
  caso('v2 /stock con un color que el producto no tiene -> error con los colores', N['Armar borrador'][0].accion === 'mensaje' && /no tiene el color fucsia \(colores: Arena, Blanco hueso\)/.test(N['Mensajes'][0].cuerpo.text), N['Mensajes'][0].cuerpo.text);
  N = await op('dueno', { op: 'stock', entidad: 'producto', id: 'prd-0001', campos: { stock_items: [{ clave: 'M', cantidad: 2 }], stock_modo: 'sumar' } });
  caso('v2 /stock por talla en un producto con stock por color -> "usa /stock prd-0001 Arena 5"', N['Armar borrador'][0].accion === 'mensaje' && /lleva el stock por color/.test(N['Mensajes'][0].cuerpo.text) && /\/stock prd-0001 Arena 5/.test(N['Mensajes'][0].cuerpo.text), N['Mensajes'][0].cuerpo.text);
  // compatibilidad v1: producto sin stock_por_color -> /stock por talla sigue funcionando
  const docsV1 = JSON.parse(DOCS.products);
  const v1 = docsV1.productos.find(function (p) { return p.id === 'prd-0001'; });
  delete v1.stock_por_color; v1.stock_por_talla = { S: 3, M: 5, L: 4, XL: 2 }; v1.stock = 14;
  const DOCS_V1 = Object.assign({}, DOCS, { products: JSON.stringify(docsV1) });
  N = await flujoWF3(Object.assign({}, trabajo({ rol: 'dueno' }), { trabajo: trabajo({ rol: 'dueno' }), modo: 'operacion', tipo_entidad: 'producto', draft_id: '',
    operacion: { op: 'stock', entidad: 'producto', id: 'prd-0001', campos: { stock_items: [{ clave: 'M', cantidad: 2 }], stock_modo: 'sumar' } } }), { docs: DOCS_V1 });
  caso('v1 (sin stock_por_color): /stock M +2: "stock talla M: 5 → 7 (+2)"', /stock talla M: 5 → 7 \(\+2\)/.test(N['Mensajes'][0].cuerpo.text), N['Mensajes'][0].cuerpo.text);
  N = await flujoWF3(Object.assign({}, trabajo({ rol: 'dueno' }), { trabajo: trabajo({ rol: 'dueno' }), modo: 'operacion', tipo_entidad: 'producto', draft_id: '',
    operacion: { op: 'stock', entidad: 'producto', id: 'prd-0001', campos: { stock_items: [{ clave: '8', cantidad: 2 }], stock_modo: 'fijar' } } }), { docs: DOCS_V1 });
  caso('v1: /stock con talla de niños en un producto de hombres -> error', N['Armar borrador'][0].accion === 'mensaje' && /no corresponde/.test(N['Mensajes'][0].cuerpo.text), N['Mensajes'][0].cuerpo.text);
  // v2: /frescura
  N = await op('dueno', { op: 'actualizar', entidad: 'producto', id: 'prd-0003', campos: { frescura: 3 } });
  a = N['Armar borrador'][0];
  caso('v2 /frescura prd-0003 3: "frescura: 4/5 hojitas → 3/5 hojitas" sin "(sugerido por IA)"', a.fila && /frescura: 4\/5 hojitas → 3\/5 hojitas\n/.test(a.mensajes[0].cuerpo.text) && !/frescura:[^\n]*sugerido/.test(a.mensajes[0].cuerpo.text), a.mensajes[0] && a.mensajes[0].cuerpo.text);
  ap = await aplicarEnWF5(a.fila, []);
  caso('v2: WF5 aplica /frescura (prd-0003 frescura 3)', ap.estado === 'publicado' && ap.producto('prd-0003').frescura === 3, ap);
  N = await op('dueno', { op: 'actualizar', entidad: 'producto', id: 'prd-0003', campos: { frescura: 4 } });
  caso('v2 /frescura con el mismo valor -> "No hay nada que cambiar", sin borrador', N['Armar borrador'][0].accion === 'mensaje' && /No hay nada que cambiar/.test(N['Mensajes'][0].cuerpo.text), N['Mensajes'][0].cuerpo.text);
  // v2: cambiar colores conserva el stock de los que siguen; los nuevos empiezan en 0
  N = await op('dueno', { op: 'actualizar', entidad: 'producto', id: 'prd-0001', campos: { colores: ['Arena', 'Negro'] } });
  caso('v2: cambiar colores -> vista previa "stock por color: Arena 12, Negro 0"', /stock por color: Arena 12, Negro 0/.test(N['Mensajes'][0].cuerpo.text), N['Mensajes'][0].cuerpo.text);
  ap = await aplicarEnWF5(N['Armar borrador'][0].fila, []);
  pn = ap.producto('prd-0001');
  caso('v2: WF5 aplica colores ({Arena:12, Negro:0}, stock 12, foto de "Blanco hueso" sin color)', ap.estado === 'publicado' && pn && JSON.stringify(pn.stock_por_color) === '{"Arena":12,"Negro":0}' && pn.stock === 12 && pn.imagenes.every(function (im) { return im.color === undefined || im.color === 'Arena'; }), pn || ap);
  N = await op('dueno', { op: 'reactivar', entidad: 'producto', id: 'prd-0002', campos: {} });
  caso('/mostrar de un producto ya visible -> error', /ya está visible/.test(N['Mensajes'][0].cuerpo.text));
  N = await op('dueno', { op: 'desactivar', entidad: 'producto', id: 'prd-0099', campos: {} });
  caso('/ocultar de un id inexistente -> "no existe en el catálogo"', N['Armar borrador'][0].accion === 'mensaje' && /no existe/.test(N['Mensajes'][0].cuerpo.text));
  N = await op('dueno', { op: 'desactivar', entidad: 'articulo', id: 'art-0002', campos: {} });
  caso('/articulo_ocultar: borrador "visible en la web: sí → no"', N['Armar borrador'][0].fila.entidad === 'articulo' && /visible en la web: sí → no/.test(N['Mensajes'][0].cuerpo.text));
  N = await op('dueno', { op: 'agregar_imagen', entidad: 'producto', id: 'prd-0003', campos: {} }, { tipo: 'foto', fotos: [{ file_id: 'F', file_unique_id: 'U' }], bufs: [WEBP[1]] });
  a = N['Armar borrador'][0];
  caso('/foto: "fotos: 3 → 4" y 1 fila en pb_imagenes', /fotos: 3 → 4/.test(a.mensajes[0].cuerpo.text) && N['Insertar imagenes'].length === 1);
  ap = await aplicarEnWF5(a.fila, N['Insertar imagenes']);
  caso('WF5 aplica el /foto', ap.estado === 'publicado', ap);
  N = await op('dueno', { op: 'eliminar', entidad: 'producto', id: 'prd-0001', campos: {} });
  a = N['Armar borrador'][0];
  caso('/borrar: doble confirmación y avisa artículos y look que lo citan', a.fila.confirmaciones_requeridas === 2 && /art-0001/.test(a.mensajes[0].cuerpo.text) && /look-2/.test(a.mensajes[0].cuerpo.text) && /segunda confirmación/.test(a.mensajes[0].cuerpo.text));
  ap = await aplicarEnWF5(a.fila, []);
  caso('WF5 aplica el /borrar (y quita referencias)', ap.estado === 'publicado', ap);
  N = await op('marketing', { op: 'eliminar', entidad: 'producto', id: 'prd-0001', campos: {} });
  caso('marketing no puede /borrar ni aunque llegue a WF3', N['Armar borrador'][0].accion === 'mensaje' && /no puede/.test(N['Mensajes'][0].cuerpo.text));
  N = await op('dueno', { op: 'limpiar_muestras', entidad: 'producto', id: null, campos: { cantidad_confirmada: null } });
  caso('/limpiar_muestras sin número: dice cuántos hay (16) y pide el número exacto', N['Armar borrador'][0].accion === 'mensaje' && /Hay 16 productos de muestra/.test(N['Mensajes'][0].cuerpo.text) && /\/limpiar_muestras 16/.test(N['Mensajes'][0].cuerpo.text));
  N = await op('dueno', { op: 'limpiar_muestras', entidad: 'producto', id: null, campos: { cantidad_confirmada: 15 } });
  caso('/limpiar_muestras 15 (no coincide) -> sin borrador', N['Armar borrador'][0].accion === 'mensaje' && /no coincide/.test(N['Mensajes'][0].cuerpo.text));
  N = await op('admin', { op: 'limpiar_muestras', entidad: 'producto', id: null, campos: { cantidad_confirmada: 16 } });
  a = N['Armar borrador'][0];
  caso('/limpiar_muestras 16 -> borrador con cantidad 16 y doble confirmación', a.accion === 'crear' && JSON.parse(a.fila.campos).cantidad === 16 && a.fila.confirmaciones_requeridas === 2);
  N = await op('dueno', { op: 'whatsapp', entidad: 'sitio', id: 'site', campos: { whatsapp: '51987654321' } });
  caso('/whatsapp con número de ejemplo -> rechazado', N['Armar borrador'][0].accion === 'mensaje' && /ejemplo/.test(N['Mensajes'][0].cuerpo.text));
  N = await op('dueno', { op: 'whatsapp', entidad: 'sitio', id: 'site', campos: { whatsapp: '51955512345' } });
  a = N['Armar borrador'][0];
  caso('/whatsapp: "51995542938 → 51955512345" con doble confirmación', /51995542938 → 51955512345/.test(a.mensajes[0].cuerpo.text) && a.fila.confirmaciones_requeridas === 2 && a.fila.entidad === 'sitio');
  ap = await aplicarEnWF5(a.fila, []);
  caso('WF5 aplica el /whatsapp', ap.estado === 'publicado', ap);
  N = await op('dueno', { op: 'deshacer', entidad: 'sitio', id: 'eeeeeee', campos: { head_sha: 'e'.repeat(40), head_mensaje: 'data(products): crear prd-0017', parent_sha: 'c'.repeat(40) } });
  a = N['Armar borrador'][0];
  caso('/deshacer: borrador con head_sha y doble confirmación', a.fila.op === 'deshacer' && JSON.parse(a.fila.campos).head_sha === 'e'.repeat(40) && a.fila.confirmaciones_requeridas === 2 && /Se revierte el commit eeeeeee/.test(a.mensajes[0].cuerpo.text));
  caso('las ' + TODOS.filter(function (m) { return m.metodo === 'sendMessage'; }).length + ' respuestas de WF3 terminan en "Siguiente paso: …" con HTML equilibrado', TODOS.every(function (m) { return m.metodo !== 'sendMessage' || (terminaBien(m) && (m.cuerpo.text.match(/<b>/g) || []).length === (m.cuerpo.text.match(/<\/b>/g) || []).length); }));

  console.log('WF4 Comandos');
  const cmd = async function (rol, texto, extra) {
    const id = { admin: 111, dueno: 222, marketing: 333 }[rol];
    const partes = texto.trim().split(/\s+/);
    const t = trabajo(Object.assign({ tipo: 'comando', from_id: id, chat_id: id, rol: rol, texto: texto, comando: partes[0].slice(1), args: partes.slice(1) }, extra || {}));
    return (await flujoWF4(t))['Interpretar'][0];
  };
  let r = await cmd('dueno', '/precio prd-0001 69.90 oferta 59.90');
  caso('/precio prd-0001 69.90 oferta 59.90 -> WF3 operacion actualizar', r.ruta === 'borrador' && r.modo === 'operacion' && r.operacion.op === 'actualizar' && r.operacion.campos.precio === 69.9 && r.operacion.campos.precio_oferta === 59.9);
  r = await cmd('dueno', '/precio prd-0001 S/ 69,90 sin oferta');
  caso('/precio con "S/ 69,90 sin oferta"', r.operacion && r.operacion.campos.precio === 69.9 && r.operacion.campos.precio_oferta === 0);
  r = await cmd('dueno', '/precio prd-0001');
  caso('/precio sin número -> uso', r.ruta === 'responder' && /^Uso:/.test(r.mensajes[0].cuerpo.text));
  r = await cmd('marketing', '/stock prd-0001 M 5 l 3');
  caso('/stock prd-0001 M 5 l 3 (marketing) -> fijar M=5 l=3 (WF3 decide color o talla)', r.operacion && r.operacion.op === 'stock' && r.operacion.campos.stock_modo === 'fijar' && r.operacion.campos.stock_items.map(function (s) { return s.clave + s.cantidad; }).join() === 'M5,l3');
  r = await cmd('dueno', '/stock prd-0001 Blanco hueso 5 Arena 3');
  caso('v2 /stock prd-0001 Blanco hueso 5 Arena 3 -> colores de varias palabras', r.operacion && r.operacion.campos.stock_items.map(function (s) { return s.clave + '=' + s.cantidad; }).join() === 'Blanco hueso=5,Arena=3' && r.operacion.campos.stock_modo === 'fijar');
  r = await cmd('dueno', '/stock prd-0001 Arena');
  caso('/stock sin cantidad -> uso con ejemplo por color', r.ruta === 'responder' && /^Uso: \/stock prd-0001 Blanco 5/.test(r.mensajes[0].cuerpo.text));
  r = await cmd('dueno', '/frescura prd-0003 5');
  caso('v2 /frescura prd-0003 5 -> WF3 actualizar {frescura:5}', r.operacion && r.operacion.op === 'actualizar' && r.operacion.campos.frescura === 5 && r.operacion.id === 'prd-0003');
  r = await cmd('dueno', '/frescura prd-0003 7');
  caso('/frescura fuera de 1..5 -> uso', r.ruta === 'responder' && /^Uso: \/frescura/.test(r.mensajes[0].cuerpo.text));
  r = await cmd('dueno', '/stock prd-0001 M +5 L -1');
  caso('/stock mezclando suma y resta -> pide separarlos', r.ruta === 'responder' && /un \/stock por cada tipo/.test(r.mensajes[0].cuerpo.text));
  for (const c of ['/borrar prd-0001', '/whatsapp 51955512345', '/limpiar_muestras', '/deshacer', '/pausa', '/reanudar']) {
    r = await cmd('marketing', c);
    caso('marketing: ' + c.split(' ')[0] + ' -> sin permiso', r.ruta === 'responder' && /Tu rol \(marketing\) no puede usar/.test(r.mensajes[0].cuerpo.text));
  }
  r = await cmd('dueno', '/borrar prd-0001');
  caso('dueño: /borrar -> WF3 eliminar', r.operacion && r.operacion.op === 'eliminar' && r.operacion.id === 'prd-0001');
  r = await cmd('dueno', '/whatsapp 955 512 345');
  caso('/whatsapp 955 512 345 -> 51955512345', r.operacion && r.operacion.campos.whatsapp === '51955512345');
  r = await cmd('admin', '/limpiar_muestras 16');
  caso('/limpiar_muestras 16 -> cantidad_confirmada 16', r.operacion && r.operacion.campos.cantidad_confirmada === 16);
  r = await cmd('dueno', '/foto prd-0001');
  caso('/foto sin foto adjunta -> explica cómo', r.ruta === 'responder' && /leyenda \/foto prd-0001/.test(r.mensajes[0].cuerpo.text));
  r = await cmd('dueno', '/foto prd-0001', { fotos: [{ file_id: 'F', file_unique_id: 'U' }], tipo: 'foto' });
  caso('/foto con foto -> WF3 agregar_imagen con la foto', r.operacion && r.operacion.op === 'agregar_imagen' && r.fotos.length === 1);
  r = await cmd('marketing', '/ocultar art-0002');
  caso('/ocultar art-0002 -> desactivar artículo', r.operacion && r.operacion.op === 'desactivar' && r.operacion.entidad === 'articulo' && r.tipo_entidad === 'articulo');
  r = await cmd('marketing', '/articulo cómo lavar el lino');
  caso('/articulo tema -> WF3 llm artículo con el tema como texto', r.ruta === 'borrador' && r.modo === 'llm' && r.tipo_entidad === 'articulo' && r.trabajo.texto === 'cómo lavar el lino');
  r = await cmd('marketing', '/imagen art-0001 sombrero de palma sobre una mesa');
  caso('/imagen art-0001 … -> WF6 con objetivo y prompt', r.ruta === 'imagen' && r.objetivo === 'art-0001' && r.prompt === 'sombrero de palma sobre una mesa' && r.origen === 'telegram');
  r = await cmd('dueno', '/imagen <script>');
  caso('/imagen con < > -> uso', r.ruta === 'responder');
  r = await cmd('dueno', '/historial');
  caso('/historial -> WF5 modo historial (enviar)', r.ruta === 'historial' && r.modo === 'historial' && r.enviar === true);
  r = await cmd('marketing', '/frutas');
  caso('comando desconocido -> /ayuda', r.ruta === 'responder' && /No conozco ese comando/.test(r.mensajes[0].cuerpo.text));
  r = await cmd('marketing', '/ayuda');
  const r2 = await cmd('admin', '/start');
  caso('/ayuda por rol: marketing sin "Delicado"; admin con /ids y saludo', !/Delicado/.test(r.mensajes[0].cuerpo.text) && /\/ids/.test(r2.mensajes[0].cuerpo.text) && /^Hola Dueño, soy el bot privado/.test(r2.mensajes[0].cuerpo.text) && /Tu rol: admin/.test(r2.mensajes[0].cuerpo.text));
  r = await cmd('dueno', '/ids');
  const r3 = await cmd('admin', '/ids');
  caso('/ids solo admin (lista DESCONOCIDOS)', /no puede usar \/ids/.test(r.mensajes[0].cuerpo.text) && /999 · Extraño/.test(r3.mensajes[0].cuerpo.text));
  // Consulta y estado
  const N4 = { Config: await correr(W4, 'Config', CONFIG_FILAS), Entrada: [{ trabajo: trabajo() }] };
  N4['Interpretar'] = [{ ruta: 'consulta', cmd: 'lista', filtro: 'hombres' }];
  N4['GET productos'] = [gh(DOCS.products)];
  let m = (await correr(W4, 'Consulta', [gh(DOCS.articles)], N4))[0];
  caso('/lista hombres: 5 productos con precio y oferta', /Productos de hombres \(5\)/.test(m.cuerpo.text) && /prd-0001 · Camisa de lino manga corta · S\/ 89\.90 \(oferta S\/ 74\.90\)/.test(m.cuerpo.text) && terminaBien(m));
  N4['Interpretar'] = [{ ruta: 'consulta', cmd: 'ver', id: 'prd-0001' }];
  m = (await correr(W4, 'Consulta', [gh(DOCS.articles)], N4))[0];
  caso('v2 /ver prd-0001: stock por color, frescura y comandos sugeridos', /stock por color: Arena 12, Blanco hueso 7 \(total 19\)/.test(m.cuerpo.text) && /frescura: 5\/5 hojitas/.test(m.cuerpo.text) && /\/stock prd-0001 Arena 5/.test(m.cuerpo.text) && /\/precio prd-0001/.test(m.cuerpo.text), m.cuerpo.text);
  N4['Interpretar'] = [{ ruta: 'consulta', cmd: 'ver', id: 'prd-0002' }];
  m = (await correr(W4, 'Consulta', [gh(DOCS.articles)], N4))[0];
  caso('v2 /ver prd-0002: color agotado marcado', /Celeste 0 \(agotado\)/.test(m.cuerpo.text), m.cuerpo.text);
  N4['Interpretar'] = [{ ruta: 'consulta', cmd: 'lista', filtro: 'zapatos' }];
  m = (await correr(W4, 'Consulta', [gh(DOCS.articles)], N4))[0];
  caso('/lista con filtro desconocido -> opciones', /No conozco el filtro/.test(m.cuerpo.text));
  N4['Interpretar'] = [{ ruta: 'estado', owner_id: 222 }];
  N4['Inbox nuevo'] = [{ id: 1 }, { id: 2 }]; N4['Aprobados'] = [{ id: 3, draft_id: 'drf-a' }]; N4['Mis pendientes'] = [{ id: 4, draft_id: 'drf-mio001' }];
  m = (await correr(W4, 'Estado', [{}], N4))[0];
  caso('/estado: cola 2, 1 aprobado con minutos al próximo lote, 1 pendiente propio', /Mensajes en cola: 2/.test(m.cuerpo.text) && /aprobados sin publicar: 1 \(próximo lote en ~4 min\)/.test(m.cuerpo.text) && /drf-mio001/.test(m.cuerpo.text) && terminaBien(m), m.cuerpo.text);
  // /deshacer
  const hist = { ok: true, head_sha: 'e'.repeat(40), head_es_bot: true, head_mensaje: 'data(products): crear prd-0017', parent_sha: 'c'.repeat(40) };
  N4['Entrada'] = [{ trabajo: trabajo() }];
  m = (await correr(W4, 'Armar deshacer', [hist], N4))[0];
  caso('/deshacer con HEAD del bot -> WF3 operacion deshacer', m.ir === 'wf3' && m.operacion.op === 'deshacer' && m.operacion.campos.parent_sha === 'c'.repeat(40));
  m = (await correr(W4, 'Armar deshacer', [Object.assign({}, hist, { head_es_bot: false })], N4))[0];
  caso('/deshacer con HEAD que no es del bot -> mensaje', m.ir === 'msg' && /no lo hizo el bot/.test(m.cuerpo.text));
  // /pausa y /cancelar
  N4['Interpretar'] = [{ ruta: 'pausa', valor: '1' }];
  m = (await correr(W4, 'Pausa', [{ id: 9, clave: 'PAUSA', valor: '1' }], N4))[0];
  caso('/pausa -> "Publicación en pausa"', /Publicación en pausa/.test(m.cuerpo.text));
  N4['Cancelar pendientes'] = [{ id: 1, draft_id: 'drf-uno0001', preview_message_id: 55 }, { id: 2, draft_id: 'drf-dos0002', preview_message_id: 0 }];
  const ids = await correr(W4, 'Ids cancelados', N4['Cancelar pendientes'], N4);
  m = await correr(W4, 'Cancelados', [{}], N4);
  caso('/cancelar: borra imágenes de ambos, quita 1 teclado y resume', ids.length === 2 && m.length === 2 && m[0].metodo === 'editMessageReplyMarkup' && /Cancelé 2 borradores/.test(m[1].cuerpo.text));
  // Salida
  const sal = async function (x) { return (await correr(W4, 'Salida', [x], {}))[0]; };
  caso('Salida: propaga ok:false de WF3, reintenta si el sub falló, Telegram = ok', (await sal({ ok: false, reintentar: true, error: 'x' })).reintentar === true &&
    (await sal({ error: 'Workflow is not active' })).reintentar === true && (await sal({ ok: false, error_code: 400, description: 'Bad Request' })).ok === true);
  // estructura
  caso('WF4: todas las rutas llegan a Salida', ['Responder', 'Consulta', 'Estado', 'WF5 historial', 'Armar deshacer', 'WF3 Borrador', 'WF6 Imagen', 'Pausa', 'Cancelados'].every(function (n) { return camino(W4, n, 'Salida'); }));
  caso('WF3: los nodos externos no cortan el flujo (onError continueRegularOutput)', ['Descargar foto', 'WebP 1200', 'Ollama', 'Ollama reintento', 'GET productos', 'Enviar Telegram'].every(function (n) { return nodo(W3, n).onError === 'continueRegularOutput'; }));
  caso('WF3: Telegram (descarga) usa la credencial pbCredTelegram01; Ollama timeout 180 s', credOk(nodo(W3, 'Descargar foto').credentials.telegramApi, 'pbCredTelegram01', 'Telegram Palmera Brava') && nodo(W3, 'Ollama').parameters.options.timeout === 180000);
  caso('WF3: el borrador se guarda ANTES de mandar la vista previa', camino(W3, 'Insertar borrador', 'Enviar Telegram') && camino(W3, 'Insertar imagenes', 'Enviar Telegram'));

  if (REAL) await pruebaReal(flujoWF3);
  console.log('\n' + ok + ' ok, ' + fallos + ' fallo(s)');
  process.exit(fallos ? 1 : 0);
})().catch(function (e) { console.error('ERROR del arnés: ' + (e && e.stack || e)); process.exit(2); });

// ------------------------------------------------------------------ Prueba REAL con Ollama (host)
async function pruebaReal(flujo) {
  console.log('\nOllama REAL (' + OLLAMA + ', cuerpo exacto de WF3 "Cuerpo Ollama")');
  const llamadas = [];
  const real = async function (cuerpo) {
    const t0 = Date.now();
    try {
      const r = await fetch(OLLAMA + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(180000) });
      const j = await r.json();
      llamadas.push({ ms: Date.now() - t0, prompt: j.prompt_eval_count, salida: j.eval_count });
      return j;
    } catch (e) { llamadas.push({ ms: Date.now() - t0, error: e.message }); return { error: { message: e.message } }; }
  };
  // v2: 4 mensajes (frescura por la tela, "10 por color", stock por color en un producto existente, foto).
  const spc = function (c) { const o = {}; (c.stock_por_color || []).forEach(function (s) { o[String(s.color).toLowerCase()] = s.cantidad; }); return o; };
  const casos = [
    { texto: 'Polo de lino blanco y arena, 10 por color, 59.90', espera: function (o, c) { const s = spc(c); return o.op === 'crear' && c.precio === 59.9 && c.colores.length === 2 && s.blanco === 10 && s.arena === 10 && c.frescura === 5; } },
    { texto: 'Quedan 2 del color arena en el prd-0003', espera: function (o, c) { return o.op === 'stock' && o.id === 'prd-0003' && c.stock_modo === 'fijar' && spc(c).arena === 2; } },
    { texto: 'Short de denim para dama, 69.90, tallas S M L, color azul, 5 de cada color', espera: function (o, c) { return o.op === 'crear' && c.categoria === 'mujeres' && c.precio === 69.9 && spc(c).azul === 5 && c.frescura === 2; } },
    { texto: 'Vestido nuevo de lino, 79.90, tallas S M L', fotos: [WEBP[0]], espera: function (o, c) { return o.op === 'crear' && c.categoria === 'mujeres' && c.precio === 79.9 && c.colores.length > 0 && c.frescura === 5; } }
  ];
  for (let i = 0; i < casos.length; i++) {
    const k = casos[i];
    const desde = llamadas.length;
    const fotos = k.fotos ? k.fotos.map(function (b, j) { return { file_id: 'F' + j, file_unique_id: 'U' + j }; }) : [];
    const N = await flujo(entradaWF3(trabajo({ texto: k.texto, tipo: fotos.length ? 'foto' : 'texto', fotos: fotos })), { fotos: k.fotos, ollama: real });
    const a = N['Armar borrador'][0];
    const o = a.fila ? { op: a.fila.op, id: a.fila.entidad_id } : {};
    const c = a.fila ? JSON.parse(a.fila.campos) : {};
    const ll = llamadas.slice(desde);
    const ms = ll.reduce(function (s, x) { return s + x.ms; }, 0);
    const bien = !!a.fila && k.espera(o, c);
    caso('real ' + (i + 1) + ': "' + k.texto.slice(0, 48) + '"' + (k.fotos ? ' + foto' : '') + ' -> ' + (a.fila ? o.op + ' ' + (o.id || 'nuevo') + ' ' + (c.categoria || '') + ' faltan[' + JSON.parse(a.fila.faltantes).join(',') + ']' : 'sin borrador') +
      ' · ' + ll.length + ' llamada(s), ' + (ms / 1000).toFixed(1) + ' s, prompt ' + ll.map(function (x) { return x.prompt; }).join('+') + ' tokens', bien, { campos: c, avisos: a.fila && a.fila.avisos, error: ll.find(function (x) { return x.error; }), mensaje: a.mensajes && a.mensajes[a.mensajes.length - 1].cuerpo.text });
    if (a.fila) console.log('       vista previa: ' + a.mensajes[a.mensajes.length - 1].cuerpo.text.replace(/<[^>]+>/g, '').split('\n').slice(0, 9).join(' | ').slice(0, 400));
  }
  if (process.argv.includes('--articulo')) {
    const desde = llamadas.length;
    const N = await flujo(entradaWF3(trabajo({ texto: 'cómo cuidar la ropa de lino en clima húmedo', tipo: 'comando' }), { tipo_entidad: 'articulo' }), { ollama: real });
    const a = N['Armar borrador'][0];
    const c = a.fila ? JSON.parse(a.fila.campos) : {};
    const ll = llamadas.slice(desde);
    caso('real artículo: "/articulo cómo cuidar la ropa de lino…" -> ' + (a.fila ? 'crear artículo, ' + (c.bloques || []).length + ' bloques' : 'sin borrador') + ' · ' + (ll[0].ms / 1000).toFixed(1) + ' s, salida ' + ll[0].salida + ' tokens',
      !!a.fila && a.fila.entidad === 'articulo' && (c.bloques || []).length >= 4 && !!c.titulo, a.mensajes && a.mensajes[a.mensajes.length - 1].cuerpo.text);
    if (a.fila) console.log('       vista previa: ' + a.mensajes[a.mensajes.length - 1].cuerpo.text.replace(/<[^>]+>/g, '').split('\n').slice(0, 8).join(' | ').slice(0, 400));
  }
  try {
    await fetch(OLLAMA + '/api/generate', { method: 'POST', body: JSON.stringify({ model: 'qwen3.5:4b-q4_K_M', keep_alive: 0 }) });
    const ps = await (await fetch(OLLAMA + '/api/ps')).json();
    caso('keep_alive:0 al final: modelo descargado de la VRAM', Array.isArray(ps.models) && !ps.models.some(function (m) { return /qwen3\.5/.test(m.name); }), ps);
  } catch (e) { caso('keep_alive:0 al final', false, e.message); }
}
