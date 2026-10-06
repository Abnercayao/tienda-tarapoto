#!/usr/bin/env node
/*
 * tools/kpis.js — Cifras únicas de "Palmera Brava" (diapositiva 16: "Word y PPT usan los mismos KPIs").
 * README (bloque KPIS), /estado del bot, el panel local (admin.html) y tools/qa.js leen ESTAS cifras,
 * calculadas con ESTAS funciones sobre los mismos data/*.json. Cero dependencias.
 *
 * (a) Línea de comandos (desde la raíz del repo):
 *       node tools/kpis.js             cifras en texto
 *       node tools/kpis.js --json      cifras en JSON
 *       node tools/kpis.js --estado    el texto que responde /estado en Telegram
 *       node tools/kpis.js --readme    reescribe el bloque KPIS de README.md
 *       node tools/kpis.js --check     sale con 1 si el bloque KPIS de README.md no coincide
 * (b) n8n (nodo Code de WF4 para /estado): copia el bloque entre "COPIAR A N8N" y "FIN COPIAR A N8N" y añade
 *       const e = $input.first().json;   // { products, articles, site } como objetos o texto JSON
 *       const k = calcularKpis(e, {});
 *       return [{ json: { kpis: k, texto: textoEstado(k) } }];
 * (c) Navegador (admin.html): <script src="tools/kpis.js"> deja window.PBKpis.
 *
 * Regla única del % de descuento: porcentajeDescuento(precio, oferta) = redondeo de (1 - oferta/precio) * 100.
 */
'use strict';

// === COPIAR A N8N ===
const KPIS_VERSION = 1;
const KPI_CATEGORIAS = ['hombres', 'mujeres', 'ninos', 'accesorios'];
const KPI_ETIQUETAS = { hombres: 'Hombres', mujeres: 'Mujeres', ninos: 'Niños', accesorios: 'Accesorios' };
const KPI_DIAS_NUEVO = 30; // "Nuevo" = fecha_creacion de menos de 30 días (D10)

function kpiDoc(v) {
  if (typeof v === 'string') {
    try { return JSON.parse(v.charCodeAt(0) === 0xfeff ? v.slice(1) : v); } catch (e) { return null; }
  }
  return v && typeof v === 'object' ? v : null;
}
function kpiNumero(n) { return typeof n === 'number' && isFinite(n); }

// Único cálculo del % de descuento (web, bot y README). Devuelve un entero 1–99, o 0 si no hay oferta válida.
function porcentajeDescuento(precio, oferta) {
  if (!kpiNumero(precio) || !kpiNumero(oferta) || precio <= 0 || oferta <= 0 || oferta >= precio) return 0;
  const pct = Math.round((1 - oferta / precio) * 100);
  return Math.min(99, Math.max(1, pct));
}
function tieneOferta(p) { return porcentajeDescuento(p && p.precio, p && p.precio_oferta) > 0; }
function precioEfectivo(p) { return tieneOferta(p) ? p.precio_oferta : p.precio; }

// "S/ 69.90" (Intl es-PE, PEN). Espacio normal para que el texto sea igual en README, Telegram y la web.
function formatoSoles(n) {
  if (!kpiNumero(n)) return '';
  let s = '';
  try { s = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(n).replace(/ /g, ' '); } catch (e) { s = ''; }
  return /^S\/ \d/.test(s) ? s : 'S/ ' + n.toFixed(2);
}

function esNuevo(p, ahora) {
  const t = Date.parse(p && p.fecha_creacion);
  if (!isFinite(t)) return false;
  const ms = (ahora instanceof Date ? ahora.getTime() : Date.now()) - t;
  return ms >= 0 && ms < KPI_DIAS_NUEVO * 86400000;
}

function calcularKpis(docs, opciones) {
  docs = docs || {};
  opciones = opciones || {};
  const ahora = opciones.ahora instanceof Date ? opciones.ahora : new Date();
  const P = kpiDoc(docs.products) || {};
  const A = kpiDoc(docs.articles) || {};
  const S = kpiDoc(docs.site) || {};
  const productos = Array.isArray(P.productos) ? P.productos.filter(function (p) { return p && typeof p === 'object'; }) : [];
  const articulos = Array.isArray(A.articulos) ? A.articulos.filter(function (a) { return a && typeof a === 'object'; }) : [];
  const activos = productos.filter(function (p) { return p.activo === true; });

  const porCategoria = {};
  KPI_CATEGORIAS.forEach(function (c) { porCategoria[c] = 0; });
  let fueraDeCategoria = 0;
  activos.forEach(function (p) {
    if (Object.prototype.hasOwnProperty.call(porCategoria, p.categoria)) porCategoria[p.categoria]++;
    else fueraDeCategoria++;
  });
  const sumaCategorias = KPI_CATEGORIAS.reduce(function (s, c) { return s + porCategoria[c]; }, 0);

  const precios = activos.map(precioEfectivo).filter(kpiNumero);
  const descuentos = activos.map(function (p) { return porcentajeDescuento(p.precio, p.precio_oferta); }).filter(function (d) { return d > 0; });

  const imagenes = { total: 0, ia_local: 0, foto: 0, placeholder: 0, otro: 0 };
  const contarImagen = function (img) {
    if (!img || typeof img !== 'object') return;
    imagenes.total++;
    if (Object.prototype.hasOwnProperty.call(imagenes, img.origen) && img.origen !== 'total' && img.origen !== 'otro') imagenes[img.origen]++;
    else imagenes.otro++;
  };
  activos.forEach(function (p) { (Array.isArray(p.imagenes) ? p.imagenes : []).forEach(contarImagen); });

  const articulosActivos = articulos.filter(function (a) { return a.activo === true; });
  const fechas = [P.actualizado, A.actualizado, S.actualizado].filter(function (f) { return typeof f === 'string' && isFinite(Date.parse(f)); });
  fechas.sort(function (x, y) { return Date.parse(y) - Date.parse(x); });

  return {
    kpis_version: KPIS_VERSION,
    tienda: typeof S.nombre === 'string' ? S.nombre : '',
    productos_total: productos.length,
    productos_activos: activos.length,
    productos_ocultos: productos.length - activos.length,
    por_categoria: porCategoria,
    suma_categorias: sumaCategorias,
    fuera_de_categoria: fueraDeCategoria,
    categorias_cuadran: sumaCategorias === activos.length && fueraDeCategoria === 0,
    muestras_activas: activos.filter(function (p) { return p.muestra === true; }).length,
    reales_activos: activos.filter(function (p) { return p.muestra !== true; }).length,
    destacados: activos.filter(function (p) { return p.destacado === true; }).length,
    en_oferta: descuentos.length,
    descuento_max_pct: descuentos.length ? Math.max.apply(null, descuentos) : 0,
    agotados: activos.filter(function (p) { return p.stock === 0; }).length,
    unidades_stock: activos.reduce(function (s, p) { return s + (Number.isInteger(p.stock) && p.stock > 0 ? p.stock : 0); }, 0),
    nuevos_30_dias: activos.filter(function (p) { return esNuevo(p, ahora); }).length,
    precio_min: precios.length ? Math.min.apply(null, precios) : null,
    precio_max: precios.length ? Math.max.apply(null, precios) : null,
    imagenes_productos: imagenes,
    articulos_total: articulos.length,
    articulos_activos: articulosActivos.length,
    looks: Array.isArray(S.lookbook) ? S.lookbook.length : 0,
    testimonios_verificados: Array.isArray(S.testimonios) ? S.testimonios.filter(function (t) { return t && t.verificado === true; }).length : 0,
    whatsapp_configurado: typeof S.whatsapp === 'string' && /^51\d{9}$/.test(S.whatsapp),
    versiones: {
      products: kpiNumero(P.version) ? P.version : null,
      articles: kpiNumero(A.version) ? A.version : null,
      site: kpiNumero(S.version) ? S.version : null
    },
    actualizado: fechas.length ? fechas[0] : null,
    calculado: ahora.toISOString()
  };
}

function kpiSiguientePaso(k) {
  if (!k.whatsapp_configurado) return 'el admin o el dueño configura el número con /whatsapp 51XXXXXXXXX.';
  if (!k.categorias_cuadran) return 'revisa los productos sin categoría válida con /lista y corrígelos.';
  if (k.productos_activos === 0) return 'envía al bot la foto y los datos de tu primera prenda para crear su borrador.';
  if (k.muestras_activas > 0 && k.reales_activos === 0) return 'envía al bot la foto de tu primera prenda real; las muestras se quitan después con /limpiar_muestras (admin o dueño).';
  if (k.muestras_activas > 0) return 'cuando tengas suficientes prendas reales, el admin o el dueño usa /limpiar_muestras.';
  if (k.agotados > 0) return 'repón stock con /stock <id> <talla> <n> u oculta lo agotado con /ocultar <id>.';
  return 'todo en orden; si un cambio no se ve en la web, revisa /historial y espera hasta 10 minutos.';
}

// Texto para /estado (Telegram). Sin los signos menor/mayor que, salvo en el ejemplo de comando.
function textoEstado(k) {
  const L = [];
  L.push((k.tienda || 'Tienda') + ': estado del catálogo');
  L.push('Productos visibles: ' + k.productos_activos + ' (ocultos: ' + k.productos_ocultos + ')');
  L.push(KPI_CATEGORIAS.map(function (c) { return KPI_ETIQUETAS[c] + ' ' + k.por_categoria[c]; }).join(', ') +
    ' (suman ' + k.suma_categorias + (k.categorias_cuadran ? '' : ', NO cuadra con ' + k.productos_activos) + ')');
  L.push('De muestra: ' + k.muestras_activas + ', reales: ' + k.reales_activos);
  L.push('En oferta: ' + k.en_oferta + (k.en_oferta ? ' (hasta -' + k.descuento_max_pct + ' %)' : '') + ', agotados: ' + k.agotados + ', nuevos (30 días): ' + k.nuevos_30_dias);
  if (k.precio_min !== null) L.push('Precios (con la oferta aplicada): de ' + formatoSoles(k.precio_min) + ' a ' + formatoSoles(k.precio_max));
  L.push('Artículos publicados: ' + k.articulos_activos + ' de ' + k.articulos_total);
  L.push('Versión de los datos: productos ' + k.versiones.products + ', artículos ' + k.versiones.articles + ', tienda ' + k.versiones.site + (k.actualizado ? ' (actualizado ' + k.actualizado.slice(0, 16).replace('T', ' ') + ')' : ''));
  L.push('Siguiente paso: ' + kpiSiguientePaso(k));
  return L.join('\n');
}
// === FIN COPIAR A N8N ===

// ---------------------------------------------------------------------------
// Solo Node / navegador (README, CLI). Nada de lo que sigue se copia a n8n.
// ---------------------------------------------------------------------------
const README_INICIO = '<!-- KPIS:INICIO (generado con: node tools/kpis.js --readme; no editar a mano) -->';
const README_FIN = '<!-- KPIS:FIN -->';

// Tabla para README. No incluye "nuevos" (depende del día) ni la hora de cálculo, para que el bloque sea estable.
function tablaMarkdown(k) {
  const filas = [
    ['Productos visibles (`activo: true`)', String(k.productos_activos)],
    ['Hombres / Mujeres / Niños / Accesorios', KPI_CATEGORIAS.map(function (c) { return k.por_categoria[c]; }).join(' / ') + ' (suman ' + k.suma_categorias + ')'],
    ['¿Las categorías suman el total?', k.categorias_cuadran ? 'Sí' : 'No'],
    ['De muestra / reales', k.muestras_activas + ' / ' + k.reales_activos],
    ['Productos ocultos (`activo: false`)', String(k.productos_ocultos)],
    ['En oferta (descuento máximo)', k.en_oferta + (k.en_oferta ? ' (-' + k.descuento_max_pct + ' %)' : '')],
    ['Agotados', String(k.agotados)],
    ['Unidades en stock', String(k.unidades_stock)],
    ['Rango de precios (con la oferta aplicada)', k.precio_min === null ? '—' : formatoSoles(k.precio_min) + ' a ' + formatoSoles(k.precio_max)],
    ['Imágenes de productos (IA local / foto / provisional)', k.imagenes_productos.ia_local + ' / ' + k.imagenes_productos.foto + ' / ' + k.imagenes_productos.placeholder],
    ['Artículos del blog publicados', k.articulos_activos + ' de ' + k.articulos_total],
    ['Looks del lookbook', String(k.looks)],
    ['Testimonios verificados', String(k.testimonios_verificados)],
    ['WhatsApp configurado', k.whatsapp_configurado ? 'Sí' : 'No'],
    ['Versión de los datos (productos / artículos / tienda)', [k.versiones.products, k.versiones.articles, k.versiones.site].join(' / ')],
    ['Datos actualizados', k.actualizado || '—']
  ];
  return ['| Cifra | Valor |', '|---|---|'].concat(filas.map(function (f) { return '| ' + f[0] + ' | ' + f[1] + ' |'; })).join('\n');
}
function bloqueReadme(k) {
  return README_INICIO + '\n' + tablaMarkdown(k) + '\n\nCifras calculadas por `tools/kpis.js` sobre `data/*.json` (las mismas que responde `/estado` y muestra el panel local).\n' + README_FIN;
}

const API = {
  KPIS_VERSION, KPI_CATEGORIAS, KPI_ETIQUETAS, KPI_DIAS_NUEVO, README_INICIO, README_FIN,
  porcentajeDescuento, tieneOferta, precioEfectivo, formatoSoles, esNuevo, calcularKpis, textoEstado, tablaMarkdown, bloqueReadme
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof window !== 'undefined') window.PBKpis = API;

function leerDatos(raiz) {
  const fs = require('fs');
  const path = require('path');
  const docs = {};
  for (const n of ['products', 'articles', 'site']) {
    const f = path.join(raiz, 'data', n + '.json');
    docs[n] = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  }
  return docs;
}
function cli(argv) {
  const fs = require('fs');
  const path = require('path');
  const raiz = path.resolve(__dirname, '..');
  const modo = argv[0] || '--texto';
  if (['--texto', '--json', '--estado', '--readme', '--check', '-h', '--help'].indexOf(modo) < 0) {
    console.error('Opción desconocida: ' + modo + '. Usa --json, --estado, --readme o --check.');
    return 2;
  }
  if (modo === '-h' || modo === '--help') { console.log('Uso: node tools/kpis.js [--json | --estado | --readme | --check]'); return 0; }
  const k = calcularKpis(leerDatos(raiz), {});
  if (modo === '--json') { console.log(JSON.stringify(k, null, 2)); return 0; }
  if (modo === '--estado') { console.log(textoEstado(k)); return 0; }
  if (modo === '--texto') { console.log(textoEstado(k)); console.log(''); console.log(tablaMarkdown(k)); return 0; }
  const readme = path.join(raiz, 'README.md');
  if (!fs.existsSync(readme)) { console.error('No existe README.md'); return 2; }
  const texto = fs.readFileSync(readme, 'utf8');
  const i = texto.indexOf(README_INICIO);
  const j = texto.indexOf(README_FIN);
  if (i < 0 || j < i) { console.error('README.md no tiene el bloque KPIS (' + README_INICIO + ' ... ' + README_FIN + ').'); return modo === '--check' ? 1 : 2; }
  const actual = texto.slice(i, j + README_FIN.length).replace(/\r\n/g, '\n');
  const nuevo = bloqueReadme(k);
  if (modo === '--check') {
    if (actual === nuevo) { console.log('OK: el bloque KPIS de README.md coincide con tools/kpis.js.'); return 0; }
    console.log('FALLA: el bloque KPIS de README.md está desactualizado. Ejecuta: node tools/kpis.js --readme');
    return 1;
  }
  if (actual === nuevo) { console.log('README.md ya estaba al día.'); return 0; }
  fs.writeFileSync(readme, texto.slice(0, i) + nuevo + texto.slice(j + README_FIN.length));
  console.log('README.md actualizado con las cifras de tools/kpis.js.');
  return 0;
}
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  process.exitCode = cli(process.argv.slice(2));
}
