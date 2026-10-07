#!/usr/bin/env node
/*
 * n8n/tools/probar-negocio-b.js — Ejecuta los nodos Code REALES de n8n/workflows/WF6-imagen-ia.json y WF8-panel-api.json con
 * datos simulados (sin Telegram, sd-server ni n8n), en el mismo mini-runtime que probar-negocio.js ($input, $('Nodo'), this.helpers).
 *   node n8n/tools/probar-negocio-b.js
 * Integración: WF4 "Interpretar" (/imagen) -> WF6 "Preparar"; borrador de WF6 -> WF5 "Parsear callback" + "Verificar" (botones dst:/no:)
 * -> WF5 "Aplicar lote" (aplicador real) sobre data/*.json; WF8 "Pedido" -> WF6 "Preparar"; admin.html llama a las URLs/cabeceras de WF8.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..');
const WF = function (f) { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'n8n', 'workflows', f), 'utf8')); };
const W4 = WF('WF4-comandos.json'), W5 = WF('WF5-publicar.json'), W6 = WF('WF6-imagen-ia.json'), W8 = WF('WF8-panel-api.json');
const DATA = function (f) { return fs.readFileSync(path.join(RAIZ, 'data', f), 'utf8'); };
const DOCS = { products: DATA('products.json'), articles: DATA('articles.json'), site: DATA('site.json') };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TOKEN_FALSO = '123456789:' + 'X'.repeat(35);

let ok = 0, fallos = 0;
function caso(nombre, cond, detalle) {
  if (cond) { ok++; console.log('  ok   ' + nombre); }
  else { fallos++; console.log('  FALLA ' + nombre + (detalle !== undefined ? ' -> ' + JSON.stringify(detalle).slice(0, 600) : '')); }
}
const items = function (l) { return (l || []).map(function (j) { return j && (j.json || j.binary) ? j : { json: j }; }); };
// Corre un nodo Code; devuelve los ítems completos ({json, binary}).
async function correr(wf, nodo, input, nodos) {
  const n = wf.nodes.find(function (x) { return x.name === nodo; });
  if (!n) throw new Error(wf.name + ': no existe el nodo ' + nodo);
  const inp = items(input);
  const $ = function (nombre) {
    if (!(nombre in (nodos || {}))) return { isExecuted: false, first: function () { throw new Error('nodo no ejecutado: ' + nombre); }, all: function () { throw new Error('nodo no ejecutado: ' + nombre); } };
    const l = items(nodos[nombre]);
    return { isExecuted: true, first: function () { return l[0]; }, last: function () { return l[l.length - 1]; }, all: function () { return l; } };
  };
  const $input = { all: function () { return inp; }, first: function () { return inp[0]; }, last: function () { return inp[inp.length - 1]; } };
  const helpers = {
    prepareBinaryData: async function (buf, fileName, mimeType) { return { data: Buffer.from(buf).toString('base64'), fileName: fileName, mimeType: mimeType, fileExtension: String(fileName).split('.').pop() }; },
    getBinaryDataBuffer: async function (i, prop) { const b = inp[i] && inp[i].binary && inp[i].binary[prop]; if (!b) throw new Error('sin binario'); return Buffer.from(b.data, 'base64'); }
  };
  const f = new AsyncFunction('$', '$input', '$json', '$execution', n.parameters.jsCode);
  const r = await f.call({ helpers: helpers }, $, $input, inp[0] ? inp[0].json : {}, { id: '900' });
  return items(r || []);
}
const J = function (l) { return l.map(function (i) { return i.json; }); };
const nodo = function (wf, n) { return wf.nodes.find(function (x) { return x.name === n; }); };
const sale = function (wf, de) { return ((wf.connections[de] || {}).main || []).map(function (l) { return (l || []).map(function (x) { return x.node; }); }); };
function camino(wf, de, a, evitar) {
  const vistos = new Set([de]);
  const pila = [de];
  while (pila.length) {
    const x = pila.pop();
    if (x === a) return true;
    if (x === evitar) continue;
    ((wf.connections[x] || {}).main || []).forEach(function (l) { (l || []).forEach(function (y) { if (!vistos.has(y.node)) { vistos.add(y.node); pila.push(y.node); } }); });
  }
  return false;
}
// WebP/PNG mínimos con cabecera real (VP8X / IHDR): bastan para medir.
function webp(w, h) {
  const b = Buffer.alloc(260);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(b.length - 8, 4); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii'); b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}
function png(w, h) {
  const b = Buffer.alloc(260);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
const bin = function (buf, mime) { return { data: buf.toString('base64'), mimeType: mime || 'image/webp', fileName: 'x.webp' }; };
const sdResp = function (buf) { return { statusCode: 200, headers: {}, body: { created: 1, data: [{ b64_json: buf.toString('base64') }] } }; };
const terminaBien = function (t) { return /\nSiguiente paso: \S[^\n]*$/.test(String(t || '')); };
const AUT = [{ id: 111, rol: 'admin', nombre: 'Abner' }, { id: 222, rol: 'dueno', nombre: 'Dueño' }, { id: 333, rol: 'marketing', nombre: 'Mkt' }];
const config = function (o) {
  o = o || {};
  return [{ clave: 'BOT_TOKEN', valor: o.token === undefined ? TOKEN_FALSO : o.token }, { clave: 'AUTORIZADOS', valor: JSON.stringify(o.aut || AUT) }, { clave: 'PAUSA', valor: '0' },
    { clave: 'ULTIMO_COMMIT_AT', valor: String(Date.now() - 3600000) }, { clave: 'ULTIMO_POLL_AT', valor: String(o.poll === undefined ? Date.now() - 4000 : o.poll) },
    { clave: 'FALLOS_SEGUIDOS', valor: '0' }];
};
const COLS_BORRADOR = ['draft_id', 'owner_id', 'rol', 'chat_id', 'preview_message_id', 'origen', 'op', 'entidad', 'entidad_id', 'campos', 'campos_inferidos',
  'faltantes', 'avisos', 'update_ids', 'file_ids', 'file_unique_ids', 'fecha', 'expira', 'estado', 'confirmaciones', 'confirmaciones_requeridas',
  'intentos', 'error', 'commit_sha', 'texto', 'resumen', 'fecha_ms'];
const COLS_IMAGEN = ['draft_id', 'n', 'b64', 'mime', 'ancho', 'alto', 'origen', 'alt', 'file_unique_id'];
const mismas = function (o, cols) { return Object.keys(o).sort().join(',') === cols.slice().sort().join(','); };

// Recorre WF6 como n8n (mismas ramas). o: {sd, ps, telegram, editImage, config}
async function flujoWF6(entrada, o) {
  o = o || {};
  const N = { Entrada: [entrada] };
  N['Config'] = await correr(W6, 'Config', config(o.config), N);
  N['Preparar'] = await correr(W6, 'Preparar', [{}], N);
  const p = N['Preparar'][0].json;
  const errorYSalida = async function () {
    N['Error'] = await correr(W6, 'Error', [{}], N);
    if (N['Error'][0].json.avisar) { N['Enviar error'] = [{ ok: true, result: { message_id: 1 } }]; }
    N['Salida'] = await correr(W6, 'Salida', [{}], N);
    return N;
  };
  if (!p.valido) return errorYSalida();
  if (p.avisar_inicio) { N['Aviso generando'] = await correr(W6, 'Aviso generando', [{}], N); N['Enviar aviso'] = [{ ok: true }]; }
  N['Ollama ps'] = [o.ps || { models: [{ name: 'qwen3.5:4b-q4_K_M' }] }];
  N['Modelos a liberar'] = await correr(W6, 'Modelos a liberar', N['Ollama ps'], N);
  N['Liberar VRAM'] = N['Modelos a liberar'].map(function () { return { done: true, done_reason: 'unload' }; });
  N['sd-server'] = [o.sd || sdResp(webp(Number(p.generar.split('x')[0]), Number(p.generar.split('x')[1])))];
  N['Imagen'] = await correr(W6, 'Imagen', N['sd-server'], N);
  const im = N['Imagen'][0];
  if (im.json.ok !== true) return errorYSalida();
  let entradaFinal = [im];
  if (im.json.convertir) {
    N['Recortar arriba'] = o.editImage ? o.editImage(im) : [{ json: im.json, binary: { data: bin(webp(im.json.crop_ancho, im.json.crop_alto)) } }];
    entradaFinal = N['Recortar arriba'];
  }
  N['Imagen final'] = await correr(W6, 'Imagen final', entradaFinal, N);
  if (N['Imagen final'][0].json.ok !== true) return errorYSalida();
  if (!(p.chat_id > 0)) { N['Salida'] = await correr(W6, 'Salida', N['Imagen final'], N); return N; }
  N['Enviar foto'] = [o.telegram || { ok: true, result: { message_id: 555, photo: [] } }];
  N['Foto enviada'] = await correr(W6, 'Foto enviada', N['Enviar foto'], N);
  if (N['Foto enviada'][0].json.ok !== true) return errorYSalida();
  N['Fila borrador'] = await correr(W6, 'Fila borrador', [{}], N);
  N['Insertar borrador'] = [Object.assign({ id: 71 }, N['Fila borrador'][0].json)];
  N['Fila imagen'] = await correr(W6, 'Fila imagen', N['Insertar borrador'], N);
  N['Insertar imagen'] = [Object.assign({ id: 72 }, N['Fila imagen'][0].json)];
  N['Salida'] = await correr(W6, 'Salida', N['Insertar imagen'], N);
  return N;
}
const medir = function (b64) {
  const b = Buffer.from(b64, 'base64');
  return b.toString('ascii', 12, 16) === 'VP8X' ? (1 + b.readUIntLE(24, 3)) + 'x' + (1 + b.readUIntLE(27, 3)) : '?';
};
// Botón de Telegram sobre el borrador (WF5 "Parsear callback" + "Verificar" reales).
async function boton(fila, data, desde, messageId) {
  const rol = (AUT.find(function (a) { return a.id === desde; }) || {}).rol || '';
  const N = { Entrada: [{ trabajo: { tipo: 'callback', chat_id: desde, from_id: desde, rol: rol, callback: { id: 'cb1', data: data, message_id: messageId } } }] };
  N['Config'] = await correr(W5, 'Config', config(), N);
  N['Parsear callback'] = await correr(W5, 'Parsear callback', [{}], N);
  return J(await correr(W5, 'Verificar', [Object.assign({ id: 71 }, fila)], N))[0];
}
async function aplicarEnWF5(fila, imagenes) {
  const lote = [Object.assign({}, fila, { estado: 'publicando' })];
  const head = 'a'.repeat(40);
  const pedidos = ['products', 'articles', 'site'].map(function (n) { return { nombre: n, cual: 'actual', ref: head, head: head, tree: 'b'.repeat(40), padre: 'c'.repeat(40), autor: 'Abner' }; });
  const out = J(await correr(W5, 'Aplicar lote', pedidos.map(function (p) { return { statusCode: 200, body: DOCS[p.nombre], headers: {} }; }),
    { Tomados: [{ draft_id: fila.draft_id, lote: lote }], 'Leer imagenes': imagenes, 'Pedir archivos': pedidos }));
  const j = out[0] || {};
  const res = (j.arbol && j.arbol.resultados) || j.resultados || {};
  return { r: res[fila.draft_id] || { estado: '?', paso: j.paso, motivo: j.motivo }, j: j };
}

(async function () {
  // ======================= WF6 =======================
  console.log('WF6 Imagen-IA');
  // 1) /imagen desde Telegram (WF4 real -> WF6), marketing, persona adulta, look-1
  const t = { tipo: 'comando', update_ids: [801], chat_id: 333, from_id: 333, nombre: 'Mkt', rol: 'marketing', message_id: 9, texto: '/imagen look-1 mujer con blusa de lino blanca en el mercado de frutas',
    comando: 'imagen', args: ['look-1', 'mujer', 'con', 'blusa', 'de', 'lino', 'blanca', 'en', 'el', 'mercado', 'de', 'frutas'], fotos: [], callback: null, origen: 'telegram' };
  const N4 = { Entrada: [{ trabajo: t }] };
  N4['Config'] = await correr(W4, 'Config', config(), N4);
  const i4 = J(await correr(W4, 'Interpretar', [{}], N4))[0];
  caso('WF4 /imagen -> ruta imagen con prompt y objetivo', i4.ruta === 'imagen' && i4.objetivo === 'look-1' && i4.chat_id === 333, i4);
  caso('WF4: la ruta "imagen" va al nodo "WF6 Imagen" (pbWf06Imagen0000)', nodo(W4, 'WF6 Imagen').parameters.workflowId.value === 'pbWf06Imagen0000');
  let N = await flujoWF6(i4);
  let p = N['Preparar'][0].json;
  caso('Preparar: persona adulta -> 768x1216 y recorte 192 para quedar en 768x1024', p.valido && p.personas === 'adultos' && p.final === '768x1024' && p.generar === '768x1216' && p.recorte === 192, p);
  caso('Preparar: prompt con "cropped at the neck, no face" + estilo + "No text"', /cropped at the neck, no face, no head visible, adults only/.test(p.prompt) && /No text, no letters, no logos, no watermark\.$/.test(p.prompt));
  const extra = JSON.parse(/<sd_cpp_extra_args>(.*)<\/sd_cpp_extra_args>$/.exec(p.cuerpo_sd.prompt)[1]);
  caso('Cuerpo sd-server: seed + 8 pasos euler/simple + txt_cfg 1.0, size generar, webp', extra.seed === p.seed && extra.sample_params.sample_steps === 8 && extra.sample_params.sample_method === 'euler' &&
    extra.sample_params.scheduler === 'simple' && extra.sample_params.guidance.txt_cfg === 1 && p.cuerpo_sd.size === '768x1216' && p.cuerpo_sd.output_format === 'webp' && p.cuerpo_sd.n === 1, p.cuerpo_sd);
  caso('Aviso "genero la imagen" (Telegram) termina en Siguiente paso', N['Aviso generando'] && terminaBien(N['Aviso generando'][0].json.cuerpo.text));
  caso('Ollama: se libera el modelo configurado (keep_alive:0)', N['Modelos a liberar'].length === 1 && N['Modelos a liberar'][0].json.cuerpo.keep_alive === 0 && N['Modelos a liberar'][0].json.cuerpo.model === 'qwen3.5:4b-q4_K_M');
  const im = N['Imagen'][0].json;
  caso('Imagen: recorte arriba 192 px (crop 768x1024 desde y=192)', im.ok && im.convertir && im.crop_ancho === 768 && im.crop_alto === 1024 && im.crop_y === 192, im);
  caso('Imagen final: WebP 768x1024', N['Imagen final'][0].json.ok && N['Imagen final'][0].json.ancho === 768 && N['Imagen final'][0].json.alto === 1024);
  caso('Caption: ≤ 1024, HTML escapado y termina en Siguiente paso', p.caption.length <= 1024 && terminaBien(p.caption) && !/<(?!\/?b>)/.test(p.caption));
  const fila = N['Fila borrador'][0].json;
  const campos = JSON.parse(fila.campos);
  caso('Fila de pb_borradores: columnas exactas, pendiente, falta destino, vista previa = foto', mismas(fila, COLS_BORRADOR) && fila.estado === 'pendiente' && fila.faltantes === '["destino"]' &&
    fila.preview_message_id === 555 && fila.owner_id === 333 && fila.op === 'agregar_imagen' && fila.entidad === 'sitio' && campos.objetivo === 'look-1' && campos.destino === null, fila);
  const filaImg = N['Fila imagen'][0].json;
  caso('Fila de pb_imagenes: columnas exactas, ia_local, WebP 768x1024', mismas(filaImg, COLS_IMAGEN) && filaImg.origen === 'ia_local' && filaImg.mime === 'image/webp' && medir(filaImg.b64) === '768x1024', filaImg);
  let s = N['Salida'][0];
  caso('Salida (Telegram): ok + draft_id + binario, sin b64', s.json.ok === true && s.json.draft_id === p.draft_id && !s.json.b64 && s.binary && s.binary.data, s.json);
  const w4s = J(await correr(W4, 'Salida', [s], N4))[0];
  caso('WF4 Salida acepta la salida de WF6', w4s.ok === true && w4s.draft_id === p.draft_id, w4s);
  // Botones (WF5 real)
  const cb = function (d) { return 'dst:' + p.draft_id + ':' + d; };
  caso('callback_data ≤ 64 bytes', Buffer.byteLength(cb('portada')) <= 64);
  let v = await boton(fila, cb('look'), 333, 555);
  caso('WF5: Lookbook del autor -> destino look (sitio)', v.accion === 'destino' && v.entidad_nueva === 'sitio' && JSON.parse(v.campos_nuevos).destino === 'look', v);
  v = await boton(fila, cb('portada'), 333, 555);
  caso('WF5: Portada sin art-NNNN -> pide /imagen art-0001', v.accion === 'alerta' && /art-0001/.test(v.texto), v);
  v = await boton(fila, cb('hero'), 111, 555);
  caso('WF5: botón de otra persona -> rechazado', v.accion === 'alerta' && /no es tuyo/.test(v.texto), v);
  v = await boton(fila, cb('hero'), 333, 554);
  caso('WF5: botón de otro mensaje -> rechazado', v.accion === 'alerta' && /anterior/.test(v.texto), v);
  v = await boton(fila, 'no:' + p.draft_id, 333, 555);
  caso('WF5: Descartar -> cancelado', v.accion === 'cerrar' && v.nuevo_estado === 'cancelado', v);
  v = await boton(fila, 'pub:' + p.draft_id, 333, 555);
  caso('WF5: Publicar antes de elegir destino -> "Aún falta: destino"', v.accion === 'alerta' && /destino/.test(v.texto), v);
  // Publicación (aplicador real de WF5) con cada destino
  const aprobada = function (destino, entidad, entidadId) {
    return Object.assign({}, fila, { entidad: entidad, entidad_id: entidadId, faltantes: '[]', estado: 'aprobado', campos: JSON.stringify(Object.assign({}, campos, { destino: destino })) });
  };
  let a = await aplicarEnWF5(aprobada('look', 'sitio', 'site'), [filaImg]);
  caso('WF5 Aplicar lote: look-1 con la imagen IA', a.r.estado === 'publicado' && a.r.entidad_id === 'look-1', a.r);
  a = await aplicarEnWF5(aprobada('hero', 'sitio', 'site'), [filaImg]);
  caso('WF5 Aplicar lote: hero con la imagen IA', a.r.estado === 'publicado', a.r);

  // 2) niños: siempre sin personas (aunque el texto pida una niña)
  N = await flujoWF6({ prompt: 'polo de niño naranja con una niña sonriendo', objetivo: '', chat_id: 111, from_id: 111, rol: 'admin', origen: 'telegram' });
  p = N['Preparar'][0].json;
  caso('Niños: sin personas, sin recorte, tamaño hero 1344x768', p.personas === 'ninguna' && p.recorte === 0 && p.generar === '1344x768' && p.final === '1344x768', p);
  caso('Niños: prompt "children\'s clothing only" + "No people, no children" y sin "cropped at the neck"', /^Product photo of children's clothing only/.test(p.prompt) && /No people, no children, no mannequin/.test(p.prompt) && !/cropped at the neck/.test(p.prompt));
  caso('Niños: WebP sin recorte pasa directo (sin Edit Image)', !N['Recortar arriba'] && N['Imagen final'][0].json.ok === true && N['Salida'][0].json.ok === true);
  N = await flujoWF6({ prompt: "Flat lay product photo of a children's UV t-shirt", chat_id: 111, from_id: 111, rol: 'admin', origen: 'panel', personas: 'adultos', size: '768x1024', seed: 77 });
  p = N['Preparar'][0].json;
  caso('Panel pide personas con ropa de niños -> se fuerza sin personas + aviso', p.personas === 'ninguna' && p.recorte === 0 && p.seed === 77 && p.avisos.some(function (x) { return /niños/.test(x); }), p);
  caso('Panel: no manda "genero la imagen" a Telegram', !N['Aviso generando']);
  // 3) objetivo art -> tamaño blog; panel con persona adulta -> 1216x1088 y recorte 256
  N = await flujoWF6({ prompt: 'An adult man wearing a sand linen shirt next to a lagoon', objetivo: 'art-0001', chat_id: 111, from_id: 111, rol: 'admin', origen: 'panel', seed: 123 });
  p = N['Preparar'][0].json;
  caso('art-0001 + persona -> final 1216x832, genera 1216x1088, recorta 256', p.final === '1216x832' && p.generar === '1216x1088' && p.recorte === 256, p);
  s = N['Salida'][0].json;
  caso('Salida (panel): ok + b64 del WebP final + telegram:true', s.ok && s.telegram === true && medir(s.b64) === '1216x832' && s.draft_id === p.draft_id, s);
  // 4) PNG de sd-server sin personas -> Edit Image lo convierte a WebP (crop de la imagen completa)
  N = await flujoWF6({ prompt: 'sombrero de palma sobre una mesa de madera', chat_id: 222, from_id: 222, rol: 'dueno', origen: 'telegram' }, { sd: sdResp(png(1344, 768)) });
  caso('PNG -> convertir a WebP sin recortar (crop 1344x768+0+0)', N['Imagen'][0].json.convertir === true && N['Imagen'][0].json.crop_y === 0 && N['Imagen'][0].json.crop_alto === 768 && N['Salida'][0].json.ok === true, N['Imagen'][0].json);
  // 5) Fallos
  N = await flujoWF6({ prompt: 'mujer con vestido', chat_id: 222, from_id: 222, rol: 'dueno', origen: 'telegram' }, { editImage: function (im) { return [{ json: Object.assign({}, im.json, { error: 'gm: crop falló' }) }]; } });
  caso('Recorte fallido con persona -> NO se envía (ni Telegram ni borrador)', N['Imagen final'][0].json.ok === false && !N['Enviar foto'] && !N['Fila borrador'] && N['Salida'][0].json.ok === false && N['Error'][0].json.etapa === 'recorte');
  N = await flujoWF6({ prompt: 'mujer con vestido', chat_id: 222, from_id: 222, rol: 'dueno', origen: 'telegram' }, { editImage: function (im) { return [{ json: im.json, binary: { data: bin(webp(768, 1216)) } }]; } });
  caso('Salida del recorte con la altura original -> rechazada (podría tener rostro)', N['Imagen final'][0].json.ok === false && !N['Enviar foto']);
  N = await flujoWF6({ prompt: 'sombrero de palma', chat_id: 222, from_id: 222, rol: 'dueno', origen: 'telegram' }, { sd: { error: { message: 'connect ECONNREFUSED 192.168.65.254:1234' } } });
  let er = N['Error'][0].json;
  caso('sd-server caído -> aviso con tools\\iniciar-sd-server.bat y ok:false sin reintento', er.etapa === 'sd' && er.avisar && /iniciar-sd-server/.test(er.cuerpo.text) && terminaBien(er.cuerpo.text) &&
    N['Salida'][0].json.ok === false && N['Salida'][0].json.reintentar === false, er);
  N = await flujoWF6({ prompt: 'sombrero de palma', chat_id: 222, from_id: 222, rol: 'dueno', origen: 'telegram' }, { sd: { statusCode: 500, body: { error: { message: 'CUDA out of memory' } } } });
  caso('sd-server 500 -> mensaje con el motivo', N['Error'][0].json.etapa === 'sd' && /out of memory/.test(N['Error'][0].json.cuerpo.text));
  N = await flujoWF6({ prompt: 'sombrero de palma', chat_id: 222, from_id: 222, rol: 'dueno', origen: 'telegram' }, { telegram: { error: 'Unauthorized bot' + TOKEN_FALSO } });
  er = N['Error'][0].json;
  caso('sendPhoto falla -> aviso (sin token) y sin borrador', er.etapa === 'telegram' && !N['Fila borrador'] && er.cuerpo.text.indexOf(TOKEN_FALSO) < 0 && /credencial/.test(er.cuerpo.text) && N['Salida'][0].json.ok === false, er);
  N = await flujoWF6({ prompt: 'sombrero de palma', chat_id: 111, from_id: 111, rol: 'admin', origen: 'panel' }, { telegram: { error: 'Bad Request: chat not found' } });
  s = N['Salida'][0].json;
  caso('Panel + Telegram caído -> igual devuelve la imagen (telegram:false) y no avisa', s.ok === true && s.telegram === false && s.b64 && N['Error'][0].json.avisar === false && !N['Enviar error'], s);
  N = await flujoWF6({ prompt: 'sombrero de palma', chat_id: 0, from_id: 0, rol: '', origen: 'panel' }, { config: { aut: [{ id: 0, rol: 'admin', nombre: 'Abner' }] } });
  s = N['Salida'][0].json;
  caso('Panel sin destinatario (AUTORIZADOS en 0) -> imagen sí, Telegram/borrador no', s.ok === true && s.telegram === false && s.draft_id === '' && !N['Enviar foto'] && /AUTORIZADOS/.test(s.aviso), s);
  N = await flujoWF6({ prompt: 'ab', chat_id: 222, from_id: 222, rol: 'dueno', origen: 'telegram' });
  caso('Texto muy corto -> inválido, aviso con el uso de /imagen', N['Preparar'][0].json.valido === false && N['Error'][0].json.avisar && /\/imagen/.test(N['Error'][0].json.cuerpo.text) && !N['sd-server']);
  N = await flujoWF6({ prompt: 'sombrero de palma', chat_id: 999, from_id: 999, rol: 'admin', origen: 'telegram' });
  caso('Autor no autorizado (rol recalculado) -> nada a la GPU ni a Telegram', N['Preparar'][0].json.valido === false && N['Error'][0].json.avisar === false && !N['sd-server']);
  N = await flujoWF6({ prompt: 'camisa <b>lino</b> & palmeras', chat_id: 222, from_id: 222, rol: 'dueno', origen: 'telegram' });
  p = N['Preparar'][0].json;
  caso('Texto con < > & -> sin etiquetas en el prompt y escapado en el caption', !/[<>]/.test(p.prompt) && /&amp;/.test(p.caption), p.caption);
  N = await flujoWF6({ prompt: 'sombrero de palma', chat_id: 222, from_id: 222, rol: 'dueno', origen: 'telegram' }, { ps: { models: [{ name: 'qwen3.5:4b-q4_K_M' }, { name: 'llava:7b' }] } });
  caso('Ollama con 2 modelos cargados -> se liberan los 2', N['Modelos a liberar'].length === 2);

  // ======================= WF8 =======================
  console.log('WF8 Panel-API');
  const cuerpoPanel = { prompt: 'An adult wearing a terracotta linen shirt. The photo is cropped...', prompt_usuario: 'An adult wearing a terracotta linen shirt, framed from the shoulders to the hips.',
    tipo: 'producto-muestra', personas: 'adultos', size: '768x1216', tamano_final: '768x1024', recortar_arriba: 192, seed: 4242, origen: 'panel' };
  const flujo8 = async function (body, o) {
    o = o || {};
    const M = { 'POST crear-imagen': [{ headers: {}, params: {}, query: {}, body: body }] };
    M['Config'] = await correr(W8, 'Config', config(o.config), M);
    M['Validar pedido'] = await correr(W8, 'Validar pedido', [{}], M);
    return M;
  };
  let M = await flujo8(cuerpoPanel);
  let vp = M['Validar pedido'][0].json;
  caso('Validar pedido (cuerpo real de admin.html) -> pedido para WF6 al primer admin', vp.valido && vp.pedido.prompt === cuerpoPanel.prompt_usuario && vp.pedido.size === '768x1024' && vp.pedido.personas === 'adultos' &&
    vp.pedido.seed === 4242 && vp.pedido.chat_id === 111 && vp.pedido.rol === 'admin' && vp.pedido.origen === 'panel', vp);
  M['Pedido'] = await correr(W8, 'Pedido', [{}], M);
  N = await flujoWF6(M['Pedido'][0].json);
  p = N['Preparar'][0].json;
  const SIN_ROSTRO = 'The photo is cropped at the neck, no face, no head visible, adults only: the top edge of the frame cuts across the collarbones, so the chin, mouth and face are completely outside the picture.';
  caso('WF8 -> WF6: mismo prompt que arma admin.html (usuario + sin rostro + estilo) y recorte 192', p.prompt.indexOf(cuerpoPanel.prompt_usuario + ' ' + SIN_ROSTRO + ' Editorial fashion photography') === 0 && p.recorte === 192, p.prompt.slice(0, 200));
  M['WF6 Imagen'] = N['Salida'];
  M['Liberar lock'] = [{ id: 1, nombre: 'worker', holder: '', hasta: 0 }];
  let rsp = await correr(W8, 'Respuesta', M['Liberar lock'], M);
  caso('Respuesta: binario image/webp 768x1024 + cabeceras (draft, telegram, seed)', rsp[0].json.ok && rsp[0].binary.data.mimeType === 'image/webp' && medir(rsp[0].binary.data.data) === '768x1024' &&
    rsp[0].json.telegram === 'si' && rsp[0].json.seed === '4242' && rsp[0].json.draft_id === p.draft_id, rsp[0].json);
  M['WF6 Imagen'] = [{ ok: false, reintentar: false, etapa: 'sd', error: 'sd-server: no responde' }];
  rsp = J(await correr(W8, 'Respuesta', [{}], M))[0];
  caso('Respuesta: WF6 sin imagen -> 502 con siguiente_paso (sd-server)', rsp.ok === false && rsp.status === 502 && /sd-server/.test(rsp.cuerpo.siguiente_paso), rsp);
  M['WF6 Imagen'] = [{ error: { message: 'Workflow is not active and cannot be executed.' } }];
  rsp = J(await correr(W8, 'Respuesta', [{}], M))[0];
  caso('Respuesta: WF6 sin publicar -> 502 "WF6 esté publicado"', rsp.status === 502 && /publicado/.test(rsp.cuerpo.siguiente_paso) && /not active/.test(rsp.cuerpo.error), rsp);
  M = await flujo8({ prompt_usuario: 'x' });
  vp = M['Validar pedido'][0].json;
  caso('Pedido inválido -> 400 con siguiente_paso', vp.valido === false && vp.status === 400 && vp.cuerpo.siguiente_paso, vp);
  M = await flujo8({ prompt: 'camisa <script>alert(1)</script> lino', tamano_final: '999x999', seed: 'abc' }, { config: { aut: [{ id: 0, rol: 'admin', nombre: 'A' }, { id: 222, rol: 'dueno', nombre: 'D' }] } });
  vp = M['Validar pedido'][0].json;
  caso('Sin admin con id -> dueño; sin < >; tamaño y seed raros se ignoran', vp.pedido.chat_id === 222 && !/[<>]/.test(vp.pedido.prompt) && vp.pedido.size === '' && vp.pedido.seed === 0, vp.pedido);
  M['Validar pedido'] = [{ valido: true, inicio: Date.now() - 1000, pedido: {} }];
  caso('Esperar turno: a 1 s sigue esperando', J(await correr(W8, 'Esperar turno', [{}], M))[0].agotado === false);
  M['Validar pedido'] = [{ valido: true, inicio: Date.now() - 600001, pedido: {} }];
  caso('Esperar turno: a 10 min se rinde', J(await correr(W8, 'Esperar turno', [{}], M))[0].agotado === true);
  rsp = J(await correr(W8, 'Ocupado', [{}], M))[0];
  caso('Ocupado -> 423 (admin.html lo muestra como GPU ocupada)', rsp.status === 423 && rsp.cuerpo.ok === false);
  // GET estado
  const E = { 'GET estado': [{}] };
  E['Config estado'] = await correr(W8, 'Config estado', config(), E);
  E['Leer lock'] = [{ id: 1, nombre: 'worker', holder: '55', hasta: Date.now() + 60000 }];
  E['Inbox nuevo'] = [{ id: 1 }, { id: 2 }, { id: 3 }];
  E['Aprobados'] = [{ id: 9 }];
  E['Pendientes'] = [{}];
  E['Ollama version'] = [{ version: '0.12.3' }];
  E['Ollama ps'] = [{ models: [{ name: 'qwen3.5:4b-q4_K_M' }] }];
  E['sd-server salud'] = [{ statusCode: 200, body: '{}', headers: {} }];
  let es = J(await correr(W8, 'Estado', [{}], E))[0];
  caso('Estado: ocupado, cola 3, aprobados 1, pendientes 0, servicios en línea', es.ocupado && es.cola === 3 && es.aprobados === 1 && es.pendientes === 0 && es.ollama.ok && es.sd_server.ok && es.autorizados === 3, es);
  caso('Estado: texto para el panel termina en Siguiente paso y no expone token ni ids', terminaBien(es.texto) && JSON.stringify(es).indexOf(TOKEN_FALSO) < 0 && JSON.stringify(es).indexOf('111') < 0, es.texto);
  E['sd-server salud'] = [{ error: { message: 'connect ECONNREFUSED' } }];
  E['Ollama version'] = [{ error: { message: 'timeout' } }];
  es = J(await correr(W8, 'Estado', [{}], E))[0];
  caso('Estado: sd-server caído -> "no responde" y paso iniciar-sd-server', !es.sd_server.ok && !es.ollama.ok && /iniciar-sd-server/.test(es.texto), es.texto);

  // ======================= Estructura =======================
  console.log('Estructura');
  const post = nodo(W8, 'POST crear-imagen'), get = nodo(W8, 'GET estado');
  const ORI = 'http://localhost:8080,http://127.0.0.1:8080';
  caso('WF8 webhooks: POST crear-imagen y GET estado, Header Auth pbCredHeader0001, origins exactos, responseNode',
    post.parameters.httpMethod === 'POST' && post.parameters.path === 'crear-imagen' && get.parameters.httpMethod === 'GET' && get.parameters.path === 'estado' &&
    [post, get].every(function (n) { return n.parameters.authentication === 'headerAuth' && n.credentials.httpHeaderAuth.id === 'pbCredHeader0001' && n.parameters.options.allowedOrigins === ORI && n.parameters.responseMode === 'responseNode' && n.webhookId; }));
  caso('WF8: bucle de lock Wait 5 s -> Tomar lock', sale(W8, 'Esperar 5 s')[0].indexOf('Tomar lock') >= 0 && nodo(W8, 'Esperar 5 s').parameters.amount === 5);
  caso('WF8: WF6 -> Liberar lock antes de responder (no hay camino que lo evite)', sale(W8, 'WF6 Imagen')[0].join() === 'Liberar lock' &&
    !camino(W8, 'WF6 Imagen', 'Responder imagen', 'Liberar lock') && !camino(W8, 'WF6 Imagen', 'Responder JSON', 'Liberar lock'));
  const respImg = nodo(W8, 'Responder imagen').parameters;
  caso('WF8: responde binario con cabeceras expuestas (CORS)', respImg.respondWith === 'binary' && respImg.inputFieldName === 'data' &&
    respImg.options.responseHeaders.entries.some(function (e) { return e.name === 'Access-Control-Expose-Headers' && /X-Telegram/.test(e.value); }));
  caso('WF8: lease del lock 15 min y executionTimeout ≥ espera + sd-server', /900000/.test(nodo(W8, 'Tomar lock').parameters.columns.value.hasta) && W8.settings.executionTimeout >= 1200);
  const sd = nodo(W6, 'sd-server').parameters;
  caso('WF6: sd-server POST /v1/images/generations, timeout 10 min', sd.method === 'POST' && /\/v1\/images\/generations$/.test(sd.url) && sd.options.timeout === 600000 && /cuerpo_sd/.test(sd.jsonBody));
  caso('WF6: Ollama keep_alive:0 antes de sd-server', camino(W6, 'Liberar VRAM', 'sd-server') && /\/api\/generate$/.test(nodo(W6, 'Liberar VRAM').parameters.url) && camino(W6, 'Ollama ps', 'Liberar VRAM'));
  const crop = nodo(W6, 'Recortar arriba').parameters;
  caso('WF6: Edit Image crop con positionY = recorte y salida WebP', crop.operation === 'crop' && /crop_y/.test(crop.positionY) && crop.positionX === 0 && crop.options.format === 'webp');
  const foto = nodo(W6, 'Enviar foto');
  const btn = foto.parameters.inlineKeyboard.rows.map(function (r) { return r.row.buttons.map(function (b) { return b.text + '=' + b.additionalFields.callback_data.replace(/\{\{.*?\}\}/, 'D'); }); });
  caso('WF6: sendPhoto con pbCredTelegram01 y botones Hero/Portada/Lookbook/Descartar', foto.credentials.telegramApi.id === 'pbCredTelegram01' && foto.parameters.binaryData === true &&
    JSON.stringify(btn) === JSON.stringify([['Hero==dst:D:hero', 'Portada==dst:D:portada', 'Lookbook==dst:D:look'], ['Descartar==no:D']]), btn);
  caso('WF6: la foto se envía antes de crear el borrador (sin borradores huérfanos)', camino(W6, 'Enviar foto', 'Insertar borrador') && !camino(W6, 'Insertar borrador', 'Enviar foto'));
  caso('WF6: no toma el lock (lo tiene WF2 o WF8)', !W6.nodes.some(function (n) { return n.type === 'n8n-nodes-base.dataTable' && n.parameters.dataTableId && n.parameters.dataTableId.value === 'pb_locks'; }));
  const html = fs.readFileSync(path.join(RAIZ, 'admin.html'), 'utf8');
  caso('admin.html: POST ' + "N8N + '/webhook/crear-imagen'" + ' con X-Tienda-Key y GET /webhook/estado con X-Tienda-Key', /var N8N = 'http:\/\/127\.0\.0\.1:5678';/.test(html) && html.indexOf("URL_CREAR = N8N + '/webhook/crear-imagen'") >= 0 &&
    html.indexOf("URL_ESTADO_BOT = N8N + '/webhook/estado'") >= 0 && /fetch\(URL_CREAR, \{\s*method: 'POST'[\s\S]{0,120}'X-Tienda-Key': clave/.test(html) && /fetch\(URL_ESTADO_BOT, \{[^}]*headers: \{ 'X-Tienda-Key': clave \}/.test(html));
  caso('admin.html: no recorta dos veces la imagen que ya llega recortada de n8n', /img\.naturalHeight <= \+m\[2\]/.test(html));

  console.log('\n' + ok + ' ok, ' + fallos + ' fallo(s)');
  process.exit(fallos ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
