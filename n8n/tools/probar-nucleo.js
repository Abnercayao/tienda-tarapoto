#!/usr/bin/env node
/*
 * n8n/tools/probar-nucleo.js — Ejecuta los nodos Code REALES de n8n/workflows/WF0,1,2,5,9 con datos simulados
 * (y data/*.json reales del repo) en un mini-runtime que imita $input / $('Nodo') / $execution del Code node 2.
 *   node n8n/tools/probar-nucleo.js
 * No llama a Telegram, GitHub ni n8n. El token de prueba se arma en memoria (no es real).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..');
const WF = function (f) { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'n8n', 'workflows', f), 'utf8')); };
const W0 = WF('WF0-setup.json'), W1 = WF('WF1-ingesta.json'), W2 = WF('WF2-worker.json'), W5 = WF('WF5-publicar.json'), W9 = WF('WF9-errores.json');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TOKEN_FALSO = '123456789:' + 'X'.repeat(35);

let ok = 0, fallos = 0;
function caso(nombre, cond, detalle) {
  if (cond) { ok++; console.log('  ok   ' + nombre); }
  else { fallos++; console.log('  FALLA ' + nombre + (detalle !== undefined ? ' -> ' + JSON.stringify(detalle).slice(0, 400) : '')); }
}
const items = function (l) { return (l || []).map(function (j) { return j && j.json ? j : { json: j }; }); };
async function correr(wf, nodo, input, nodos, execId) {
  const n = wf.nodes.find(function (x) { return x.name === nodo; });
  if (!n) throw new Error(wf.name + ': no existe el nodo ' + nodo);
  const inp = items(input);
  const $ = function (nombre) {
    if (!(nombre in (nodos || {}))) return { isExecuted: false, first: function () { throw new Error('nodo no ejecutado: ' + nombre); }, all: function () { throw new Error('nodo no ejecutado: ' + nombre); } };
    const l = items(nodos[nombre]);
    return { isExecuted: true, first: function () { return l[0]; }, last: function () { return l[l.length - 1]; }, all: function () { return l; } };
  };
  const $input = { all: function () { return inp; }, first: function () { return inp[0]; }, last: function () { return inp[inp.length - 1]; } };
  // Como en el task runner: el código va dentro de una función; "items" no es parámetro (el código puede declararlo).
  const f = new AsyncFunction('$', '$input', '$json', '$execution', n.parameters.jsCode);
  const r = await f.call({ helpers: {} }, $, $input, inp[0] ? inp[0].json : {}, { id: execId || '900' });
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

const AUT = JSON.stringify([{ id: 111, rol: 'admin', nombre: 'Abner' }, { id: 222, rol: 'dueno', nombre: 'Dueño' }, { id: 333, rol: 'marketing', nombre: 'Mkt' }, { id: 0, rol: 'dueno', nombre: 'sin id' }]);
const CONFIG_FILAS = [{ clave: 'BOT_TOKEN', valor: TOKEN_FALSO }, { clave: 'AUTORIZADOS', valor: AUT }, { clave: 'PAUSA', valor: '0' },
  { clave: 'ULTIMO_POLL_AT', valor: String(Date.now() - 600000) }, { clave: 'FALLOS_SEGUIDOS', valor: '3' }, { clave: 'DESCONOCIDOS', valor: '[]' },
  { clave: 'ULTIMO_COMMIT_AT', valor: '0' }, { clave: 'MIN_ENTRE_COMMITS_MS', valor: '360000' }];

(async function () {
  // ------------------------------------------------------------------ WF0
  console.log('WF0 Setup');
  const def = await correr(W0, 'Claves por defecto', [{ clave: 'BOT_TOKEN', valor: '' }, { clave: 'REPO', valor: 'x/y' }]);
  caso('inserta solo las claves que faltan (no pisa BOT_TOKEN ni REPO)', def.length === 15 && !def.some(function (d) { return d.clave === 'BOT_TOKEN' || d.clave === 'REPO'; }), def.map(function (d) { return d.clave; }));
  const cfg0 = (await correr(W0, 'Config', CONFIG_FILAS))[0];
  caso('Config: AUTORIZADOS sin ids 0 y token aceptado', cfg0.AUTORIZADOS.length === 3 && cfg0.hayToken === true);
  const cfgSin = (await correr(W0, 'Config', [{ clave: 'BOT_TOKEN', valor: 'PEGAR_AQUI' }]))[0];
  caso('Config: token con formato inválido = sin token', cfgSin.hayToken === false);
  const cmds = await correr(W0, 'Comandos por rol', [{}], { Config: [cfg0] });
  const deRol = function (id) { const c = cmds.find(function (x) { return x.metodo === 'setMyCommands' && x.cuerpo.scope.chat_id === id; }); return c ? c.cuerpo.commands.map(function (k) { return k.command; }) : []; };
  caso('setMyCommands: marketing sin /borrar /whatsapp /limpiar_muestras /deshacer /pausa', ['borrar', 'whatsapp', 'limpiar_muestras', 'deshacer', 'pausa'].every(function (k) { return deRol(333).indexOf(k) < 0; }) && deRol(333).indexOf('precio') >= 0);
  caso('setMyCommands: dueño con /borrar y sin /ids; admin con /ids', deRol(222).indexOf('borrar') >= 0 && deRol(222).indexOf('ids') < 0 && deRol(111).indexOf('ids') >= 0);
  caso('deleteMyCommands en scope default (extraños no ven comandos)', cmds[0].metodo === 'deleteMyCommands');

  // ------------------------------------------------------------------ WF1
  console.log('WF1 Ingesta');
  const cfg1 = (await correr(W1, 'Config', CONFIG_FILAS))[0];
  const priv = function (id) { return { id: id, type: 'private' }; };
  const upd = { ok: true, result: [
    { update_id: 501, message: { message_id: 10, from: { id: 111, first_name: 'Abner' }, chat: priv(111), date: 1700000000, text: 'Polo azul 39.90 tallas S M' } },
    { update_id: 502, message: { message_id: 11, from: { id: 999, first_name: 'Extraño <b>' }, chat: priv(999), date: 1700000001, text: '/start' } },
    { update_id: 503, message: { message_id: 12, from: { id: 111, first_name: 'Abner' }, chat: { id: -100, type: 'group' }, date: 1700000002, text: 'hola grupo' } },
    { update_id: 504, callback_query: { id: 'cbq1', from: { id: 222, first_name: 'Dueño' }, data: 'pub:drf-abc123', message: { message_id: 50, chat: priv(222) } } },
    { update_id: 505, message: { message_id: 13, from: { id: 111 }, chat: priv(111), date: 1700000003, media_group_id: 'g1', caption: 'Vestido', photo: [{ file_id: 'p', file_unique_id: 'u' }, { file_id: 'GRANDE1', file_unique_id: 'U1' }] } },
    { update_id: 506, message: { message_id: 14, from: { id: 111 }, chat: priv(111), date: 1700000003, media_group_id: 'g1', photo: [{ file_id: 'GRANDE2', file_unique_id: 'U2' }] } }
  ] };
  const norm = (await correr(W1, 'Normalizar', [upd], { Config: [cfg1] }))[0];
  caso('D2: solo privados de AUTORIZADOS (4 de 6)', norm.filas.length === 4 && norm.filas.every(function (f) { return [111, 222].indexOf(f.from_id) >= 0; }), norm.filas.map(function (f) { return f.update_id; }));
  caso('maxUpdateId cuenta TODOS los updates (506)', norm.maxUpdateId === 506);
  caso('extraño anotado en DESCONOCIDOS sin < >', norm.desconocidos && norm.desconocidos[0].id === 999 && !/[<>]/.test(norm.desconocidos[0].nombre));
  const foto = norm.filas.find(function (f) { return f.update_id === 505; });
  caso('foto = la más grande, álbum con media_group_id', foto.tipo === 'foto' && foto.file_id === 'GRANDE1' && foto.media_group_id === 'g1' && foto.texto === 'Vestido');
  caso('callback normalizado', norm.filas.some(function (f) { return f.tipo === 'callback' && f.callback_data === 'pub:drf-abc123' && f.callback_message_id === 50; }));
  const nuevos = await correr(W1, 'Solo nuevos', [{ id: 1, update_id: 501 }], { Normalizar: [norm] });
  caso('idempotencia: no reinserta update_id ya guardado', nuevos.length === 3 && !nuevos.some(function (f) { return f.update_id === 501; }));
  const ack = (await correr(W1, 'Preparar ACK', [{}], { Normalizar: [norm] }))[0];
  caso('ACK con offset = max+1', ack.ack === true && ack.offset === 507);
  caso('ACK solo después de Insertar inbox, e Insertar sin continuar en error', camino(W1, 'Insertar inbox', 'ACK getUpdates') && !nodo(W1, 'Insertar inbox').onError && !nodo(W1, 'Insertar inbox').continueOnFail);
  const avisos = await correr(W1, 'Avisos', [{}], { Normalizar: [norm], 'Solo nuevos': nuevos });
  caso('callback respondido al instante', avisos.some(function (a) { return a.metodo === 'answerCallbackQuery' && a.cuerpo.callback_query_id === 'cbq1'; }));
  caso('"Volví" por chat tras > 5 min sin sondear (reemplaza al "Recibido")', avisos.filter(function (a) { return /^Volví/.test(a.cuerpo.text || ''); }).length === 2 &&
    avisos.filter(function (a) { return /^Recibido, preparo/.test(a.cuerpo.text || ''); }).length === 0);
  const avisos2 = await correr(W1, 'Avisos', [{}], { Normalizar: [Object.assign({}, norm, { volvi: false })], 'Solo nuevos': nuevos });
  caso('sin apagón: un solo "Recibido" por chat aunque sea un álbum', avisos2.filter(function (a) { return /^Recibido, preparo/.test(a.cuerpo.text || ''); }).length === 1);
  caso('todo mensaje termina con "Siguiente paso:"', avisos.concat(avisos2).filter(function (a) { return a.metodo === 'sendMessage'; }).every(function (a) { return /\nSiguiente paso: \S/.test(a.cuerpo.text); }));
  const poll = await correr(W1, 'Estado poll', [{}], { Config: [cfg1], Normalizar: [norm] });
  caso('Estado poll: ULTIMO_POLL_AT, reinicia FALLOS_SEGUIDOS y guarda DESCONOCIDOS', poll.map(function (p) { return p.clave; }).join() === 'ULTIMO_POLL_AT,FALLOS_SEGUIDOS,DESCONOCIDOS');
  const fallo = await correr(W1, 'Fallo', [{ error: { message: 'Unauthorized https://api.telegram.org/bot' + TOKEN_FALSO + '/getUpdates' } }], { Config: [Object.assign({}, cfg1, { FALLOS_SEGUIDOS: 29 })] });
  caso('Fallo: alerta al llegar a 30 y detalle censurado', fallo[0].alerta === true && fallo.length === 2 && fallo[0].detalle.indexOf('XXXXXXXX') < 0, fallo[0]);

  // ------------------------------------------------------------------ WF2
  console.log('WF2 Worker');
  const cfg2 = (await correr(W2, 'Config', CONFIG_FILAS))[0];
  const ahora = Date.now();
  const fila = function (o) { return Object.assign({ estado: 'nuevo', intentos: 0, media_group_id: '', texto: '', file_id: '', chat_id: o.from_id, message_id: o.id, recibido: ahora - 60000, tipo: 'texto' }, o); };
  const album = [fila({ id: 1, update_id: 601, from_id: 111, tipo: 'foto', media_group_id: 'g1', file_id: 'F1', recibido: ahora - 5000, texto: 'Vestido' }),
    fila({ id: 2, update_id: 602, from_id: 111, tipo: 'foto', media_group_id: 'g1', file_id: 'F2', recibido: ahora - 4000 })];
  const texto333 = fila({ id: 3, update_id: 603, from_id: 333, texto: 'Short playero 45 soles' });
  let el = (await correr(W2, 'Elegir', [{}], { Config: [cfg2], 'Leer inbox': album.concat([texto333]) }))[0];
  caso('álbum reciente (< 20 s) espera; toma el siguiente', el.hay && el.trabajo.update_ids.join() === '603' && el.ruta === 'borrador' && el.trabajo.rol === 'marketing');
  album.forEach(function (a) { a.recibido = ahora - 30000; });
  el = (await correr(W2, 'Elegir', [{}], { Config: [cfg2], 'Leer inbox': album.concat([texto333]) }))[0];
  caso('álbum completo como UN trabajo con 2 fotos y su leyenda', el.trabajo.update_ids.join() === '601,602' && el.trabajo.fotos.length === 2 && el.trabajo.texto === 'Vestido' && el.trabajo.tipo === 'foto');
  el = (await correr(W2, 'Elegir', [{}], { Config: [cfg2], 'Leer inbox': [fila({ id: 9, update_id: 609, from_id: 333, tipo: 'comando', texto: '/borrar@PalmeraBot prd-0001' })] }))[0];
  caso('comando parseado (sin @bot) y enrutado a WF4', el.ruta === 'comando' && el.trabajo.comando === 'borrar' && el.trabajo.args[0] === 'prd-0001');
  el = (await correr(W2, 'Elegir', [{}], { Config: [cfg2], 'Leer inbox': [fila({ id: 9, update_id: 610, from_id: 444, texto: 'hola' })] }))[0];
  caso('autor ya no autorizado -> rechazado (rol recalculado)', el.ruta === 'rechazado');
  el = (await correr(W2, 'Elegir', [{}], { Config: [cfg2], 'Leer inbox': [fila({ id: 9, update_id: 611, from_id: 222, tipo: 'callback', callback_data: 'pub:drf-abc123', callback_message_id: 50, callback_id: 'c' })] }))[0];
  const prep = (await correr(W2, 'Preparar trabajo', [{}], { Elegir: [el] }))[0];
  caso('callback -> WF5 modo callback', el.ruta === 'callback' && prep.entrada.modo === 'callback' && prep.entrada.callback.data === 'pub:drf-abc123');
  const tex = (await correr(W2, 'Elegir', [{}], { Config: [cfg2], 'Leer inbox': [texto333] }))[0];
  const prep2 = (await correr(W2, 'Preparar trabajo', [{ draft_id: 'drf-falta01', estado: 'pendiente', owner_id: 333, fecha_ms: ahora - 1000, faltantes: '["precio"]', entidad: 'producto' }], { Elegir: [tex] }))[0];
  caso('texto con borrador pendiente con faltantes -> modo completar', prep2.entrada.modo === 'completar' && prep2.entrada.draft_id === 'drf-falta01');
  const reun = (await correr(W2, 'Reunir', [{ id: 77 }], { 'Preparar trabajo': [prep2] }))[0];
  let res = await correr(W2, 'Resultado', [{ error: 'Workflow is not active and cannot be executed' }], { 'Preparar trabajo': [prep2], Reunir: [reun] });
  caso('sub-workflow falló -> vuelve a "nuevo" con intentos+1', res[0].estado === 'nuevo' && res[0].intentos === 1 && !res[0].aviso);
  prep2.filas[0].intentos = 2;
  res = await correr(W2, 'Resultado', [{ error: 'otra vez' }], { 'Preparar trabajo': [prep2], Reunir: [reun] });
  caso('3.er fallo -> error definitivo y aviso al autor', res[0].estado === 'error' && res[0].aviso && /Siguiente paso:/.test(res[0].aviso.cuerpo.text));
  let dl = (await correr(W2, 'Decidir lote', [{ draft_id: 'drf-x' }], { Config: [Object.assign({}, cfg2, { ULTIMO_COMMIT_AT: ahora - 60000 })] }))[0];
  caso('< 6 min desde el último commit -> no publica', dl.lote === false);
  dl = (await correr(W2, 'Decidir lote', [{ draft_id: 'drf-x' }], { Config: [Object.assign({}, cfg2, { ULTIMO_COMMIT_AT: ahora - 400000 })] }))[0];
  caso('>= 6 min y hay aprobados -> WF5 lote', dl.lote === true && dl.modo === 'lote');
  caso('lock: Liberar lock al final de ambas ramas', camino(W2, 'WF5 lote', 'Liberar lock') && (W2.connections['¿Publicar lote?'].main[1] || []).some(function (c) { return c.node === 'Liberar lock'; }));

  // ------------------------------------------------------------------ WF5 callback
  console.log('WF5 Publicar · callback');
  const cfg5 = (await correr(W5, 'Config', CONFIG_FILAS))[0];
  const futuro = new Date(Date.now() + 3600000).toISOString();
  const borr = function (o) { return Object.assign({ draft_id: 'drf-abc123', owner_id: 222, chat_id: 222, preview_message_id: 50, estado: 'pendiente', op: 'actualizar', entidad: 'producto', entidad_id: 'prd-0001', campos: '{"precio":79.9}', faltantes: '[]', confirmaciones: 0, confirmaciones_requeridas: 1, expira: futuro }, o || {}); };
  const entrada = function (from, rol, data, msg) { return { modo: 'callback', trabajo: { chat_id: from, from_id: from, rol: rol, callback: { id: 'c', data: data, message_id: msg } } }; };
  async function verificar(b, ent) {
    const p = (await correr(W5, 'Parsear callback', [{}], { Entrada: [ent] }))[0];
    return (await correr(W5, 'Verificar', [b || {}], { Config: [cfg5], Entrada: [ent], 'Parsear callback': [p] }))[0];
  }
  caso('autor + vista previa vigente + pendiente -> aprobar', (await verificar(borr(), entrada(222, 'dueno', 'pub:drf-abc123', 50))).accion === 'aprobar');
  caso('otro usuario toca el botón -> alerta', (await verificar(borr(), entrada(333, 'marketing', 'pub:drf-abc123', 50))).accion === 'alerta');
  caso('botón de una vista previa anterior -> alerta', (await verificar(borr(), entrada(222, 'dueno', 'pub:drf-abc123', 49))).accion === 'alerta');
  caso('borrador ya aprobado -> alerta', (await verificar(borr({ estado: 'aprobado' }), entrada(222, 'dueno', 'pub:drf-abc123', 50))).accion === 'alerta');
  caso('con faltantes no se aprueba', (await verificar(borr({ faltantes: '["precio"]' }), entrada(222, 'dueno', 'pub:drf-abc123', 50))).accion === 'alerta');
  caso('eliminar: 1.er toque pide doble confirmación', (await verificar(borr({ op: 'eliminar', confirmaciones_requeridas: 2 }), entrada(222, 'dueno', 'pub:drf-abc123', 50))).accion === 'confirmar1');
  const ap2 = await verificar(borr({ op: 'eliminar', confirmaciones_requeridas: 2, confirmaciones: 1 }), entrada(222, 'dueno', 'ok2:drf-abc123', 50));
  caso('eliminar: Confirmar (ok2) -> aprobar con confirmaciones 2', ap2.accion === 'aprobar' && ap2.conf_previa === 1 && ap2.conf_nueva === 2);
  const mk = await verificar(borr({ owner_id: 333, chat_id: 333, op: 'eliminar', confirmaciones_requeridas: 2 }), entrada(333, 'marketing', 'pub:drf-abc123', 50));
  caso('marketing no puede publicar un /borrar', mk.accion === 'alerta' && /no puede publicar/.test(mk.texto));
  caso('Cancelar -> cerrar/cancelado', (await verificar(borr(), entrada(222, 'dueno', 'no:drf-abc123', 50))).nuevo_estado === 'cancelado');
  caso('callback_data malformado -> alerta', (await verificar(null, entrada(222, 'dueno', 'pub:../x', 50))).accion === 'alerta');
  const v = await verificar(borr({ op: 'eliminar', confirmaciones_requeridas: 2 }), entrada(222, 'dueno', 'pub:drf-abc123', 50));
  const rsp = await correr(W5, 'Respuestas', [{ id: 5 }], { Verificar: [v] });
  caso('doble confirmación: quita teclado y envía "Vas a ELIMINAR …" con botón ok2', rsp[0].metodo === 'editMessageReplyMarkup' && /^Vas a ELIMINAR prd-0001/.test(rsp[1].cuerpo.text) && rsp[1].cuerpo.reply_markup.inline_keyboard[0][0].callback_data === 'ok2:drf-abc123');
  const rsp0 = await correr(W5, 'Respuestas', [{}], { Verificar: [Object.assign({}, v, { accion: 'confirmar1' })] });
  caso('UPDATE con 0 filas (alguien llegó antes) -> solo aviso, sin cambios', rsp0.length === 1 && /no es tuyo/.test(rsp0[0].cuerpo.text));

  // ------------------------------------------------------------------ WF5 lote (cadena D5)
  console.log('WF5 Publicar · lote D5 (data/*.json reales)');
  const HEAD = 'a'.repeat(40), TREE = 'b'.repeat(40), PADRE = 'c'.repeat(40);
  const leer = function (n) { return fs.readFileSync(path.join(RAIZ, 'data', n + '.json'), 'utf8'); };
  const nProd = JSON.parse(leer('products')).productos.length;
  const pedidosDe = function (autor, conPadre) {
    const l = ['products', 'articles', 'site'].map(function (n) { return { nombre: n, cual: 'actual', ref: HEAD, head: HEAD, tree: TREE, padre: PADRE, autor: autor }; });
    return conPadre ? l.concat(['products', 'articles', 'site'].map(function (n) { return { nombre: n, cual: 'padre', ref: PADRE, head: HEAD, tree: TREE, padre: PADRE, autor: autor }; })) : l;
  };
  const respDe = function (ped, mod) { return ped.map(function (p) { let t = leer(p.nombre); if (mod) t = mod(p, t); return { statusCode: 200, body: t }; }); };
  const b1 = { draft_id: 'drf-precio01', op: 'actualizar', entidad: 'producto', entidad_id: 'prd-0001', campos: '{"precio":79.9}', rol: 'dueno', chat_id: 222, origen: 'telegram', intentos: 0 };
  const b2 = { draft_id: 'drf-crear001', op: 'crear', entidad: 'producto', entidad_id: '', rol: 'marketing', chat_id: 333, origen: 'telegram', intentos: 0,
    campos: JSON.stringify({ nombre: 'Polo piqué azul marino', categoria: 'hombres', subcategoria: 'polos', precio: 39.9, tallas: ['M', 'S', 'L'], stock_tallas: [{ talla: 'S', cantidad: 2 }, { talla: 'M', cantidad: 3 }],
      colores: ['azul'], descripcion: 'Polo de algodón piqué, fresco para el calor de Tarapoto.', etiquetas: ['polo', 'algodón'] }) };
  const b3 = { draft_id: 'drf-stockmal', op: 'stock', entidad: 'producto', entidad_id: 'prd-0001', campos: '{"stock_tallas":[{"talla":"14","cantidad":2}]}', rol: 'dueno', chat_id: 222, intentos: 0 };
  const b4 = { draft_id: 'drf-yaaplic1', op: 'actualizar', entidad: 'producto', entidad_id: 'prd-0002', campos: '{"precio":10}', rol: 'dueno', chat_id: 222, intentos: 0 };
  const img = { draft_id: 'drf-crear001', n: 1, b64: 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=', mime: 'image/webp', ancho: 900, alto: 1200, origen: 'foto', alt: 'Polo azul marino doblado sobre una mesa' };
  const ped = pedidosDe('Abner Cayao', false);
  const conB4 = function (p, t) { if (p.nombre !== 'products') return t; const d = JSON.parse(t); d.borradores_aplicados = (d.borradores_aplicados || []).concat(['drf-yaaplic1']); return JSON.stringify(d, null, 2); };
  const lote = [b1, b2, b3, b4];
  const apl = await correr(W5, 'Aplicar lote', respDe(ped, conB4), { Tomados: [{ draft_id: b1.draft_id, lote: lote }], 'Leer imagenes': [img], 'Pedir archivos': ped });
  const arb = apl[0].arbol || {};
  caso('hay imagen -> paso "blobs" (1 ítem) con el árbol pendiente', apl.length === 1 && apl[0].paso === 'blobs' && apl[0].content === img.b64, apl[0].paso === 'fin' ? apl[0] : undefined);
  const res5 = arb.resultados || {};
  caso('2 borradores válidos publicados; stock con talla ajena -> error; draft ya aplicado -> se salta', res5['drf-precio01'] && res5['drf-precio01'].estado === 'publicado' && res5['drf-crear001'].estado === 'publicado' && res5['drf-stockmal'].estado === 'error' && res5['drf-yaaplic1'].nota === 'ya estaba aplicado', res5);
  const nuevoId = 'prd-' + String(nProd + 1).padStart(4, '0');
  caso('id nuevo = ' + nuevoId + ' y mensaje de commit de lote con [telegram draft:…]', res5['drf-crear001'] && res5['drf-crear001'].entidad_id === nuevoId && /^data\(products\): lote de 2 cambios \[telegram\]\n\n- actualizar prd-0001 precio 79\.90 \[telegram draft:drf-precio01\]\n- crear prd-\d{4} Polo piqué azul marino \[telegram draft:drf-crear001\]$/.test(arb.mensaje), arb.mensaje);
  const prods = arb.textos ? JSON.parse(arb.textos.products) : { productos: [], borradores_aplicados: [] };
  const nuevo = prods.productos.find(function (p) { return p.id === nuevoId; });
  caso('producto nuevo: tallas ordenadas, stock 2+3+0, imagen temporal, borradores_aplicados, version+1', !!nuevo && nuevo.tallas.join() === 'S,M,L' && nuevo.stock === 5 && /-pbimg0001\.webp$/.test(nuevo.imagenes[0].src) &&
    prods.borradores_aplicados.slice(-2).join() === 'drf-precio01,drf-crear001' && prods.version === JSON.parse(leer('products')).version + 1, nuevo);
  caso('solo cambia products.json (articles/site intactos)', arb.textos && Object.keys(arb.textos).join() === 'products' && arb.head === HEAD && arb.tree === TREE);
  // paso 6: nombre por sha del blob
  const SHA = '0123abcd' + 'e'.repeat(32);
  const ar = (await correr(W5, 'Arbol', [{ statusCode: 201, body: { sha: SHA } }], { 'Aplicar lote': apl }))[0];
  const rutaImg = 'assets/img/products/polo-pique-azul-marino-1-0123abcd.webp';
  caso('Arbol: imagen nombrada por sha8, JSON apunta a ella, base_tree = tree de HEAD', ar.fallo === false && ar.base_tree === TREE && ar.tree.some(function (t) { return t.path === rutaImg && t.sha === SHA && t.mode === '100644'; }) &&
    ar.tree.some(function (t) { return t.path === 'data/products.json' && t.content.indexOf(rutaImg) > 0 && t.content.indexOf('pbimg') < 0; }), ar.tree && ar.tree.map(function (t) { return t.path; }));
  const arF = (await correr(W5, 'Arbol', [{ statusCode: 500, body: {} }], { 'Aplicar lote': apl }))[0];
  caso('Arbol: blob 5xx -> fallo reintentable', arF.fallo === true && arF.reintentable === true);
  // un solo borrador: mensaje "data(products): crear prd-00NN … [telegram draft:…]"
  const solo = await correr(W5, 'Aplicar lote', respDe(ped), { Tomados: [{ draft_id: b2.draft_id, lote: [b2] }], 'Leer imagenes': [img], 'Pedir archivos': ped });
  caso('mensaje de 1 borrador: "data(products): crear ' + nuevoId + ' … [telegram draft:drf-crear001]"', !!solo[0].arbol && new RegExp('^data\\(products\\): crear ' + nuevoId + ' Polo piqué azul marino \\[telegram draft:drf-crear001\\]$').test(solo[0].arbol.mensaje), solo[0].arbol ? solo[0].arbol.mensaje : solo[0]);
  const soloErr = await correr(W5, 'Aplicar lote', respDe(ped), { Tomados: [{ draft_id: b3.draft_id, lote: [b3] }], 'Leer imagenes': [], 'Pedir archivos': ped });
  caso('lote sin nada válido -> fin sin commit', soloErr[0].paso === 'fin' && soloErr[0].resultados['drf-stockmal'].estado === 'error');
  const malJson = await correr(W5, 'Aplicar lote', [{ statusCode: 200, body: '{roto' }, { statusCode: 200, body: leer('articles') }, { statusCode: 200, body: leer('site') }], { Tomados: [{ draft_id: b1.draft_id, lote: [b1] }], 'Leer imagenes': [], 'Pedir archivos': ped });
  caso('JSON del repo corrupto -> fin sin commit (no reintenta)', malJson[0].paso === 'fin' && malJson[0].resuelto === false);
  const bw = { draft_id: 'drf-whats001', op: 'whatsapp', entidad: 'sitio', entidad_id: 'site', campos: '{"whatsapp":"51995542938"}', rol: 'dueno', chat_id: 222, intentos: 0 };
  const wapp = await correr(W5, 'Aplicar lote', respDe(ped), { Tomados: [{ draft_id: bw.draft_id, lote: [bw] }], 'Leer imagenes': [], 'Pedir archivos': ped });
  caso('/whatsapp 51995542938 aplicado en site.json (o ya era ese número)', wapp[0].paso === 'arbol' ? JSON.parse(wapp[0].arbol.textos.site).whatsapp === '51995542938' : wapp[0].paso === 'fin' && /nada nuevo/.test(wapp[0].motivo), wapp[0].paso === 'fin' ? wapp[0] : undefined);
  // /deshacer (D17)
  const bd = { draft_id: 'drf-deshace1', op: 'deshacer', entidad: 'sitio', entidad_id: '', campos: JSON.stringify({ head_sha: HEAD }), rol: 'dueno', chat_id: 222, intentos: 0 };
  const pedD = pedidosDe('Tienda Bot', true);
  const modPadre = function (p, t) { if (p.cual !== 'padre' || p.nombre !== 'products') return t; const d = JSON.parse(t); d.productos[0].precio = 99.9; return JSON.stringify(d); };
  const des = await correr(W5, 'Aplicar lote', respDe(pedD, modPadre), { Tomados: [{ draft_id: bd.draft_id, lote: [bd] }], 'Leer imagenes': [], 'Pedir archivos': pedD });
  caso('/deshacer: commit NUEVO que restaura data/ del padre', des[0].paso === 'arbol' && JSON.parse(des[0].arbol.textos.products).productos[0].precio === 99.9 && /^data\(products\): deshacer aaaaaaa \(vuelve a ccccccc\)/.test(des[0].arbol.mensaje), des[0]);
  const pedNo = pedidosDe('Abner Cayao', true);
  const desNo = await correr(W5, 'Aplicar lote', respDe(pedNo, modPadre), { Tomados: [{ draft_id: bd.draft_id, lote: [bd] }], 'Leer imagenes': [], 'Pedir archivos': pedNo });
  caso('/deshacer rechazado si HEAD no es del bot', desNo[0].paso === 'fin' && desNo[0].resultados['drf-deshace1'].estado === 'error');
  const desMov = await correr(W5, 'Aplicar lote', respDe(pedD, modPadre), { Tomados: [{ draft_id: bd.draft_id, lote: [Object.assign({}, bd, { campos: JSON.stringify({ head_sha: 'f'.repeat(40) }) })] }], 'Leer imagenes': [], 'Pedir archivos': pedD });
  caso('/deshacer rechazado si main cambió desde que se pidió', desMov[0].resultados['drf-deshace1'].estado === 'error');
  // paso 8: PATCH ref y reintentos
  const okT = { statusCode: 201, body: { sha: 'd'.repeat(40) } }, okC = { statusCode: 201, body: { sha: 'e'.repeat(40) } };
  const rev = function (intento, patch) { return correr(W5, 'Revisar', [patch], { Intento: [{ intento: intento }], 'POST tree': [okT], 'POST commit': [okC], 'Aplicar lote': apl }); };
  let r = (await rev(1, { statusCode: 422, body: { message: 'Update is not a fast forward' } }))[0];
  caso('PATCH 422 -> reintento completo (intento 2)', r.reintentar === true && r.intento === 2);
  r = (await rev(3, { statusCode: 422, body: {} }))[0];
  caso('PATCH 422 en el 3.er intento -> se rinde', r.reintentar === false && r.exito === false);
  r = (await rev(1, { statusCode: 200, body: { object: { sha: 'e'.repeat(40) } } }))[0];
  caso('PATCH 200 -> publicado con commit_sha', r.exito === true && r.commit_sha === 'e'.repeat(40) && r.resultados['drf-crear001'].estado === 'publicado');
  r = (await correr(W5, 'Revisar', [{ statusCode: 422 }], { Intento: [{ intento: 1 }], 'POST tree': [{ statusCode: 422, body: { message: 'tree inválido' } }], 'POST commit': [{ statusCode: 422 }], 'Aplicar lote': apl }))[0];
  caso('POST tree 422 -> no reintenta (error de datos)', r.reintentar === false && /POST tree HTTP 422/.test(r.motivo));
  caso('cadena D5 conectada: GET ref→GET commit→GET contenidos→Aplicar→blobs→Arbol→tree→commit→PATCH→Revisar→Esperar→Intento→GET ref',
    ['GET ref', 'GET commit', 'GET contenidos', 'Aplicar lote', 'POST blobs', 'Arbol', 'POST tree', 'POST commit', 'PATCH ref', 'Revisar', 'Esperar', 'Intento', 'GET ref']
      .every(function (x, i, l) { return i === 0 || camino(W5, l[i - 1], x); }));
  const patch = nodo(W5, 'PATCH ref').parameters, cont = nodo(W5, 'GET contenidos').parameters, com = nodo(W5, 'POST commit').parameters;
  caso('PATCH force:false · contents ?ref=sha · autor "Tienda Bot"', /force: false/.test(patch.jsonBody) && cont.queryParameters.parameters.some(function (q) { return q.name === 'ref'; }) && /'Tienda Bot'/.test(com.jsonBody));
  // cierre
  const rOk = (await rev(1, { statusCode: 200, body: {} }))[0];
  const loteT = lote.map(function (b) { return Object.assign({}, b, { estado: 'publicando' }); });
  const cie = await correr(W5, 'Cierre', [rOk], { Tomados: [{ draft_id: b1.draft_id, lote: loteT }] });
  const est = function (id) { return cie.find(function (c) { return c.draft_id === id; }) || {}; };
  caso('Cierre: publicados con commit, el inválido en error', est('drf-precio01').estado === 'publicado' && est('drf-precio01').commit_sha === 'e'.repeat(40) && est('drf-crear001').entidad_id === nuevoId && est('drf-stockmal').estado === 'error' && cie[0].commit_hecho === true, cie);
  const cieF = await correr(W5, 'Cierre', [{ reintentar: false, resuelto: false, exito: false, motivo: 'PATCH ref HTTP 422 (intento 3)' }], { Tomados: [{ draft_id: b1.draft_id, lote: [Object.assign({}, b1, { intentos: 2 }), b2] }] });
  caso('Cierre: GitHub falló -> vuelve a aprobado (intentos+1); con 3 -> error', cieF[0].estado === 'error' && cieF[1].estado === 'aprobado' && cieF[1].intentos === 1);
  const av = await correr(W5, 'Avisos lote', [{}], { Config: [cfg5], Tomados: [{ lote: loteT }], Cierre: cie });
  caso('avisos por autor: "Publicado: … (commit eeeeeee)" y error al de stock', av.some(function (a) { return a.cuerpo.chat_id === 333 && /^Publicado: .*\(commit eeeeeee\)/.test(a.cuerpo.text); }) && av.some(function (a) { return a.cuerpo.chat_id === 222 && /No se publicó el borrador drf-stockmal/.test(a.cuerpo.text); }) && av.every(function (a) { return /\nSiguiente paso: /.test(a.cuerpo.text); }), av.map(function (a) { return a.cuerpo.text; }));
  const hora = (await correr(W5, 'Hora del commit', [{}], { Cierre: cie }))[0];
  caso('ULTIMO_COMMIT_AT se guarda solo si hubo commit', hora.clave === 'ULTIMO_COMMIT_AT' && (await correr(W5, 'Hora del commit', [{}], { Cierre: cieF }))[0].clave === '__ninguna__');
  const el5 = await correr(W5, 'Elegir lote', [{ draft_id: 'a1', estado: 'aprobado', op: 'actualizar' }, { draft_id: 'a2', estado: 'aprobado', op: 'deshacer' }], { Config: [cfg5] });
  caso('Elegir lote: /deshacer va solo', el5.length === 1 && el5[0].draft_id === 'a2');
  const el6 = await correr(W5, 'Elegir lote', [{ draft_id: 'a1', estado: 'aprobado', op: 'actualizar' }], { Config: [Object.assign({}, cfg5, { PAUSA: 1 })] });
  caso('Elegir lote: PAUSA=1 -> nada', el6[0].nada === true && el6[0].motivo === 'pausa');
  const el7 = await correr(W5, 'Elegir lote', [{ draft_id: 'a1', estado: 'aprobado', op: 'actualizar', intentos: 0 }, { draft_id: 'h1', estado: 'publicando', op: 'actualizar', intentos: 0 }, { draft_id: 'h2', estado: 'publicando', op: 'stock', intentos: 2 }], { Config: [cfg5] });
  caso('Elegir lote: huérfanos "publicando" se reintentan (intentos+1) y con 3 pasan a error', el7.length === 3 && el7[0].estado_previo === 'aprobado' && el7[0].estado_nuevo === 'publicando' && el7[0].intentos === 0 &&
    el7[1].estado_previo === 'publicando' && el7[1].estado_nuevo === 'publicando' && el7[1].intentos === 1 && el7[2].estado_nuevo === 'error' && el7[2].intentos === 3, el7);
  const tom = await correr(W5, 'Tomados', [{ id: 1, draft_id: 'a1', estado: 'publicando', intentos: 0 }, { id: 2, draft_id: 'h1', estado: 'publicando', intentos: 1 }, { id: 3, draft_id: 'h2', estado: 'error', intentos: 3 }],
    { 'Leer aprobados': [{ draft_id: 'a1', estado: 'aprobado', intentos: 0 }, { draft_id: 'h1', estado: 'publicando', intentos: 0 }, { draft_id: 'h2', estado: 'publicando', intentos: 2 }] });
  caso('Tomados: entra lo pasado a "publicando" con los intentos nuevos; el huérfano rendido no', tom[0].lote.length === 2 && tom[0].lote[1].draft_id === 'h1' && tom[0].lote[1].intentos === 1, tom);
  // historial
  const commits = [{ sha: 'e'.repeat(40), parents: [{ sha: 'c'.repeat(40) }], commit: { message: 'data(products): crear prd-0017 Polo [telegram draft:drf-x]\n\nmás', author: { name: 'Tienda Bot', date: '2026-10-06T20:00:00Z' } } },
    { sha: 'c'.repeat(40), parents: [], commit: { message: 'feat: web', author: { name: 'Abner', date: '2026-10-05T20:00:00Z' } } }];
  const hi = (await correr(W5, 'Historial', [{ statusCode: 200, body: commits }], { Config: [cfg5], Entrada: [{ modo: 'historial', trabajo: { chat_id: 222 } }] }))[0];
  caso('/historial: solo commits del bot, head_es_bot y parent_sha para /deshacer', hi.resultado.ok && hi.resultado.commits.length === 1 && hi.resultado.head_es_bot === true && hi.resultado.parent_sha === 'c'.repeat(40) && /\/deshacer/.test(hi.cuerpo.text));

  // ------------------------------------------------------------------ WF9
  console.log('WF9 Errores');
  const re = (await correr(W9, 'Resumir error', [{ execution: { id: '321', lastNodeExecuted: 'GET ref', error: { message: 'fallo con https://api.telegram.org/bot' + TOKEN_FALSO + '/x y ghp_' + 'a'.repeat(36) } }, workflow: { id: 'pbWf05Publicar00', name: 'PB WF5 Publicar' } }]))[0];
  caso('mensaje de error censurado (token y PAT)', re.mensaje.indexOf('XXXXXXXX') < 0 && re.mensaje.indexOf('aaaaaaaaaa') < 0 && re.execution_id === '321', re.mensaje);
  const cfg9 = (await correr(W9, 'Config', CONFIG_FILAS))[0];
  const lim = (await correr(W9, 'Limitar alertas', [{}], { Config: [cfg9], 'Resumir error': [re] }))[0];
  caso('alerta a admin con "Siguiente paso"', lim.enviar === true && lim.mensajes.length === 1 && lim.mensajes[0].cuerpo.chat_id === 111 && /Siguiente paso:/.test(lim.mensajes[0].cuerpo.text));
  const lim2 = (await correr(W9, 'Limitar alertas', [{}], { Config: [Object.assign({}, cfg9, { ALERTAS: JSON.parse(lim.alertas) })], 'Resumir error': [re] }))[0];
  caso('misma alerta dentro de 1 h -> silenciada', lim2.enviar === false && lim2.mensajes.length === 0);
  caso('libera el lock de la ejecución fallida antes de leer config', camino(W9, 'Liberar lock (fallo)', 'Leer config'));

  console.log('\n' + ok + ' ok, ' + fallos + ' fallo(s)');
  process.exit(fallos ? 1 : 0);
})().catch(function (e) { console.error('ERROR del arnés: ' + (e && e.stack || e)); process.exit(2); });
