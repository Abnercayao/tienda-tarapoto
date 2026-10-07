#!/usr/bin/env node
/*
 * tools/qa.js — Matriz de la diapositiva 16, parte AUTOMATIZABLE (PLAN F2 "Criterio de aceptación" y F3).
 *
 *   node tools/qa.js            tabla de resultados; sale con 1 si hay alguna FALLA
 *   node tools/qa.js --json     el mismo resultado en JSON (para evidencia del README o del curso)
 *
 * Revisa, sin dependencias y sin red:
 *   1. Totales: activos de products.json = cifra de tools/kpis.js; las categorías suman el total;
 *      la semilla en línea de index.html (si existe) tiene los mismos productos activos; el bloque KPIS del README está al día.
 *   2. Unidades: precios con 2 decimales y formato "S/ 69.90" (Intl es-PE); index.html usa es-PE/PEN.
 *   3. Datos que citan su fuente: las tarjetas llevan data-id.
 *   4. Datos sensibles: sin secretos con forma de token en el repo; imágenes sin EXIF/GPS; validador de datos;
 *      contrato v2: sin avisos de "muestra" ni de "IA" (la demo debe parecer una tienda real).
 *   5. Rutas: las imágenes citadas por los JSON existen; sin rutas absolutas "/..." (salvo 404.html, que usa
 *      /tienda-tarapoto/... a propósito y deben existir); enlaces internos (#ancla y archivos) válidos;
 *      demo privada: sin sitemap.xml y con <meta name="robots" content="noindex, nofollow"> en cada página.
 *   6. Tamaños: cada JSON de data/ < 1 MB; cada imagen < 250 KB (aviso desde 200 KB).
 *   7. CSP: hash del script en línea de index.html y admin.html (tools/csp.js).
 *   8. Pages y n8n: .nojekyll y 404.html presentes; n8n/workflows limpios (tools/limpiar-workflows.js).
 * Lo que no se puede automatizar aquí (bot /lista, total de WhatsApp en el navegador, Lighthouse, móvil real)
 * se lista como MANUAL, con dónde se verifica.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const BASE = '/tienda-tarapoto/';
const SITIO = 'https://abnercayao.github.io/tienda-tarapoto/';
const LIMITE_JSON = 1000000;          // bytes (límite de la API de contenidos; D9)
const LIMITE_IMAGEN = 250 * 1024;     // bytes (tarea A4/E)
const AVISO_IMAGEN = 200 * 1024;      // R15: WebP de 1200 px y < 200 KB
const HTMLS = ['index.html', 'admin.html', '404.html'];
const BINARIOS = /\.(webp|woff2?|png|jpe?g|gif|ico|avif|pdf|zip|exe|dll|gguf|safetensors)$/i;

// Secretos con la forma COMPLETA del token (la palabra suelta "ghp_" aparece en la documentación).
const SECRETOS = [
  { nombre: 'token de Telegram', re: /\d{8,10}:[A-Za-z0-9_-]{35}/ },
  { nombre: 'token de bot en URL', re: /bot\d{6,10}:[A-Za-z0-9_-]{30,}/ },
  { nombre: 'PAT clásico de GitHub', re: /ghp_[A-Za-z0-9]{36}/ },
  { nombre: 'PAT fine-grained de GitHub', re: /github_pat_[A-Za-z0-9_]{22,}/ },
  { nombre: 'otro token de GitHub', re: /gh[ousr]_[A-Za-z0-9]{36}/ },
  { nombre: 'clave privada', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nombre: 'API key de n8n (JWT)', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/ }
];
// Valores FALSOS de tools/test-validar.js (prueban que el validador rechaza tokens). Se quitan antes de buscar.
// Partidos en trozos para que este archivo no tenga la forma de un token.
const FALSOS = ['AAHk9xQwErTyUiOpAsDfGh' + 'JkLzXcVbNm123', 'github_pat_11ABCDEFG0123456789' + '_abcdefghijklmnopqrstuvwxyz',
  'ghp_0123456789abcdefghij' + 'klmnopqrstuvwxyzAB'];

const resultados = [];
function anotar(matriz, estado, titulo, detalle) { resultados.push({ matriz: matriz, estado: estado, titulo: titulo, detalle: detalle || '' }); }
const rel = function (f) { return path.relative(RAIZ, f).split(path.sep).join('/'); };
const existe = function (r) { return fs.existsSync(path.join(RAIZ, r)); };
function leer(r) { try { return fs.readFileSync(path.join(RAIZ, r), 'utf8'); } catch (e) { return null; } }
function json(txt) { if (txt === null) return null; try { return JSON.parse(txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt); } catch (e) { return undefined; } }
function lista(arr, n) { n = n || 6; arr = arr.filter(function (x, i) { return arr.indexOf(x) === i; }); return arr.slice(0, n).join(', ') + (arr.length > n ? ' y ' + (arr.length - n) + ' más' : ''); }

// Archivos del repo: los que git versionaría (tracked + no ignorados); si no hay git, recorrido simple.
function archivosDelRepo() {
  try {
    const out = childProcess.execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
    const l = out.split('\0').filter(Boolean);
    if (l.length) return { archivos: l.filter(function (f) { return existe(f); }), fuente: 'git ls-files' };
  } catch (e) { /* no es repo git todavía */ }
  const salida = [];
  const saltar = ['.git', 'node_modules', 'backups', 'originales'];
  (function recorrer(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
      if (saltar.indexOf(d.name) >= 0) return;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) recorrer(p); else if (d.isFile()) salida.push(rel(p));
    });
  })(RAIZ);
  return { archivos: salida, fuente: 'recorrido de carpetas (aún no es repo git)' };
}

// ---------------------------------------------------------------------------------------------
// Utilidades HTML (sin dependencias): quitar comentarios y scripts; extraer atributos, url() e ids.
// ---------------------------------------------------------------------------------------------
function sinComentariosNiScripts(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '<script></script>');
}
function atributosUrl(html) {
  const limpio = sinComentariosNiScripts(html);
  const out = [];
  const re = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(limpio))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const ra = /\s(src|href|poster|action|data-src|srcset)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+))/gi;
    let a;
    while ((a = ra.exec(attrs))) {
      const nombre = a[1].toLowerCase();
      const valor = a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : a[5];
      if (nombre === 'srcset') valor.split(',').forEach(function (p) { const u = p.trim().split(/\s+/)[0]; if (u) out.push({ tag: tag, attr: nombre, url: u }); });
      else out.push({ tag: tag, attr: nombre, url: valor });
    }
  }
  // url(...) en <style> y en style=""
  const estilos = [];
  limpio.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, function (x, css) { estilos.push(css); return x; });
  limpio.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, function (x, y, a1, a2) { estilos.push(a1 || a2 || ''); return x; });
  estilos.forEach(function (css) {
    css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (x, q, u) { out.push({ tag: 'css', attr: 'url()', url: u.trim() }); return x; });
  });
  return out;
}
function ids(html) {
  const s = new Set();
  html.replace(/<!--[\s\S]*?-->/g, '').replace(/\sid\s*=\s*("([^"]*)"|'([^']*)')/gi, function (x, y, a, b) { s.add(a !== undefined ? a : b); return x; });
  return s;
}
function textoScripts(html) {
  const out = [];
  html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, function (x, attrs, t) { out.push({ attrs: attrs, texto: t }); return x; });
  return out;
}
// Busca recursivamente arreglos "productos" / "articulos" dentro de un JSON (semilla en línea).
function buscarArreglo(obj, clave, prof) {
  if (!obj || typeof obj !== 'object' || (prof || 0) > 4) return null;
  if (Array.isArray(obj[clave])) return obj[clave];
  for (const k of Object.keys(obj)) { const r = buscarArreglo(obj[k], clave, (prof || 0) + 1); if (r) return r; }
  return null;
}

// Resuelve una URL de un HTML del repo a un archivo del repo. Devuelve {tipo, ruta, hash} o un error.
function resolver(desde, url) {
  const u = url.trim();
  if (!u) return { tipo: 'vacia' };
  if (/^javascript:/i.test(u)) return { tipo: 'peligrosa' };
  if (/^(https?:|mailto:|tel:|data:|blob:|sms:|whatsapp:)/i.test(u)) return { tipo: 'externa' };
  if (u.indexOf('//') === 0) return { tipo: 'protocolo-relativa' };
  const absoluta = u.charAt(0) === '/';
  let p;
  try { p = new URL(u, 'http://local' + BASE + desde); } catch (e) { return { tipo: 'invalida' }; }
  let ruta = decodeURIComponent(p.pathname);
  if (ruta.indexOf(BASE) !== 0 && ruta + '/' !== BASE) return { tipo: absoluta ? 'absoluta-fuera' : 'fuera', absoluta: absoluta };
  ruta = ruta.slice(BASE.length);
  if (ruta === '' || ruta.slice(-1) === '/') ruta += 'index.html';
  return { tipo: 'interna', absoluta: absoluta, ruta: ruta, hash: p.hash ? decodeURIComponent(p.hash.slice(1)) : '', mismaPagina: u.charAt(0) === '#' };
}

// ---------------------------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------------------------
let kpis = null, validar = null, csp = null, limpiar = null;
try { kpis = require('./kpis.js'); } catch (e) { anotar('Totales', 'FALLA', 'tools/kpis.js no carga', e.message); }
try { validar = require('./validar.js'); } catch (e) { anotar('Datos sensibles', 'FALLA', 'tools/validar.js no carga', e.message); }
try { csp = require('./csp.js'); } catch (e) { anotar('CSP', 'FALLA', 'tools/csp.js no carga', e.message); }
try { limpiar = require('./limpiar-workflows.js'); } catch (e) { limpiar = null; }

const txt = { products: leer('data/products.json'), articles: leer('data/articles.json'), site: leer('data/site.json'), chat: leer('data/chat.json') };
const doc = { products: json(txt.products), articles: json(txt.articles), site: json(txt.site), chat: json(txt.chat) };
const htmlTxt = {};
HTMLS.forEach(function (h) { htmlTxt[h] = leer(h); });

// ---------------------------------------------------------------------------------------------
// 1. Totales coinciden con el dataset
// ---------------------------------------------------------------------------------------------
(function totales() {
  const M = 'Totales coinciden con el dataset';
  const P = doc.products;
  if (!P || !Array.isArray(P.productos)) { anotar(M, 'FALLA', 'data/products.json no se puede leer', P === null ? 'no existe' : 'JSON inválido'); return; }
  const activosDirecto = P.productos.filter(function (p) { return p && p.activo === true; });
  if (kpis) {
    const k = kpis.calcularKpis({ products: txt.products, articles: txt.articles, site: txt.site }, {});
    anotar(M, k.productos_activos === activosDirecto.length ? 'OK' : 'FALLA', 'Activos según kpis.js = productos con activo:true',
      k.productos_activos + ' = ' + activosDirecto.length);
    const cats = kpis.KPI_CATEGORIAS.map(function (c) { return kpis.KPI_ETIQUETAS[c] + ' ' + k.por_categoria[c]; }).join(', ');
    anotar(M, k.categorias_cuadran ? 'OK' : 'FALLA', 'Las categorías suman el total', cats + ' = ' + k.suma_categorias + ' de ' + k.productos_activos +
      (k.fuera_de_categoria ? ' (' + k.fuera_de_categoria + ' sin categoría válida)' : ''));
    const readme = leer('README.md');
    if (readme === null) anotar(M, 'AVISO', 'README.md con las cifras de kpis.js', 'README.md no existe todavía');
    else {
      const i = readme.indexOf(kpis.README_INICIO), j = readme.indexOf(kpis.README_FIN);
      if (i < 0 || j < i) anotar(M, 'FALLA', 'README.md con las cifras de kpis.js', 'falta el bloque KPIS; ejecuta: node tools/kpis.js --readme');
      else {
        const actual = readme.slice(i, j + kpis.README_FIN.length).replace(/\r\n/g, '\n');
        anotar(M, actual === kpis.bloqueReadme(k) ? 'OK' : 'FALLA', 'README.md usa las mismas cifras que kpis.js (/estado)',
          actual === kpis.bloqueReadme(k) ? 'bloque KPIS al día' : 'desactualizado; ejecuta: node tools/kpis.js --readme');
      }
    }
  }
  // Semilla en línea de index.html (solo se usa en file://; D10): debe coincidir con products.json.
  const index = htmlTxt['index.html'];
  if (index === null) { anotar(M, 'FALLA', 'Semilla en línea de index.html = products.json', 'index.html no existe todavía'); return; }
  let semilla = null, semillaArt = null;
  textoScripts(index).forEach(function (s) {
    if (!/type\s*=\s*["']?application\/json/i.test(s.attrs)) return;
    const j = json(s.texto.trim());
    if (!j) return;
    semilla = semilla || buscarArreglo(j, 'productos');
    semillaArt = semillaArt || buscarArreglo(j, 'articulos');
  });
  if (!semilla) { anotar(M, 'AVISO', 'Semilla en línea de index.html = products.json', 'no encontré un <script type="application/json"> con "productos" (el modo file:// mostraría "Catálogo no disponible")'); return; }
  const idsA = activosDirecto.map(function (p) { return p.id; }).sort();
  const idsS = semilla.filter(function (p) { return p && p.activo === true; }).map(function (p) { return p.id; }).sort();
  const faltan = idsA.filter(function (x) { return idsS.indexOf(x) < 0; });
  const sobran = idsS.filter(function (x) { return idsA.indexOf(x) < 0; });
  anotar(M, !faltan.length && !sobran.length ? 'OK' : 'FALLA', 'Semilla en línea de index.html = products.json (activos)',
    idsS.length + ' en la semilla, ' + idsA.length + ' en products.json' + (faltan.length ? '; faltan ' + lista(faltan) : '') + (sobran.length ? '; sobran ' + lista(sobran) : ''));
  if (semillaArt && doc.articles && Array.isArray(doc.articles.articulos)) {
    const a1 = doc.articles.articulos.filter(function (a) { return a.activo === true; }).length;
    const a2 = semillaArt.filter(function (a) { return a && a.activo === true; }).length;
    anotar(M, a1 === a2 ? 'OK' : 'FALLA', 'Semilla en línea de index.html = articles.json (activos)', a2 + ' en la semilla, ' + a1 + ' en articles.json');
  }
})();
anotar('Totales coinciden con el dataset', 'MANUAL', '/lista del bot y total del mensaje de WhatsApp',
  '/lista muestra el mismo número que kpis.js (F7, prueba con el bot); el total de la bolsa = suma de las líneas (prueba en el navegador, F3).');
anotar('Filtros alteran las métricas correctamente', 'MANUAL', 'Casos por filtro y combinación, incluida la URL', 'Lista escrita del equipo F (categoría, talla, color, precio, ofertas y búsqueda sin tildes).');

// ---------------------------------------------------------------------------------------------
// 2. Unidades y porcentajes consistentes
// ---------------------------------------------------------------------------------------------
(function unidades() {
  const M = 'Unidades y porcentajes consistentes';
  const P = doc.products;
  if (!P || !Array.isArray(P.productos) || !kpis) return;
  const malos = [];
  P.productos.forEach(function (p) {
    ['precio', 'precio_oferta'].forEach(function (c) {
      if (p[c] === undefined || p[c] === null) return;
      const n = p[c];
      if (typeof n !== 'number' || Math.abs(Math.round(n * 100) - n * 100) > 1e-6) malos.push(p.id + '.' + c + ' (no tiene 2 decimales)');
      else if (!/^S\/ \d+(,\d{3})*\.\d{2}$/.test(kpis.formatoSoles(n))) malos.push(p.id + '.' + c + ' -> ' + kpis.formatoSoles(n));
    });
  });
  const ejemplo = kpis.formatoSoles(69.9);
  anotar(M, !malos.length && ejemplo === 'S/ 69.90' ? 'OK' : 'FALLA', 'Precios con 2 decimales y formato "S/ 69.90"',
    malos.length ? 'revisar: ' + lista(malos) : 'formatoSoles(69.9) = "' + ejemplo + '"; % de descuento con porcentajeDescuento() de kpis.js');
  const index = htmlTxt['index.html'];
  if (index !== null) {
    const usaIntl = /es-PE/.test(index) && /PEN/.test(index);
    anotar(M, usaIntl ? 'OK' : 'AVISO', 'index.html formatea con Intl es-PE / PEN', usaIntl ? 'encontrado' : 'no encontré "es-PE" y "PEN" en index.html');
  }
})();

// ---------------------------------------------------------------------------------------------
// 3. Los hallazgos citan el dato que los sustenta
// ---------------------------------------------------------------------------------------------
(function citan() {
  const M = 'Los hallazgos citan el dato';
  const index = htmlTxt['index.html'];
  if (index === null) { anotar(M, 'AVISO', 'Tarjetas con data-id', 'index.html no existe todavía'); return; }
  anotar(M, /data-id|dataset\.id/.test(index) ? 'OK' : 'AVISO', 'Tarjetas con data-id', /data-id|dataset\.id/.test(index) ? 'index.html asigna data-id' : 'no encontré data-id en index.html');
  anotar(M, /fecha_creacion/.test(index) ? 'OK' : 'AVISO', '"Nuevo" sale de fecha_creacion', /fecha_creacion/.test(index) ? 'index.html usa fecha_creacion' : 'no encontré fecha_creacion en index.html');
})();

// ---------------------------------------------------------------------------------------------
// 4. Datos sensibles: secretos, EXIF/GPS y validador
// ---------------------------------------------------------------------------------------------
const repo = archivosDelRepo();
(function secretos() {
  const M = 'Datos sensibles según políticas';
  const hallados = [];
  let revisados = 0;
  repo.archivos.forEach(function (f) {
    if (BINARIOS.test(f)) return;
    let t;
    try {
      const st = fs.statSync(path.join(RAIZ, f));
      if (st.size > 5 * 1024 * 1024) return;
      t = fs.readFileSync(path.join(RAIZ, f), 'utf8');
    } catch (e) { return; }
    revisados++;
    t.split('\n').forEach(function (linea, i) {
      let l = linea;
      FALSOS.forEach(function (x) { l = l.split(x).join(''); });
      SECRETOS.forEach(function (s) { if (s.re.test(l)) hallados.push(f + ':' + (i + 1) + ' (' + s.nombre + ')'); });
    });
  });
  anotar(M, hallados.length ? 'FALLA' : 'OK', 'Cero secretos con forma de token en el repo',
    hallados.length ? lista(hallados) + '. Quítalo y ROTA ese token (docs/RUNBOOK.md).' : revisados + ' archivos de texto revisados (' + repo.fuente + ')');
})();

// EXIF/GPS: WebP (chunk "EXIF"), JPEG (APP1 "Exif"), PNG ("eXIf").
function tieneExif(buf, ext) {
  if (ext === '.webp') {
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return false;
    let o = 12;
    while (o + 8 <= buf.length) {
      const id = buf.toString('ascii', o, o + 4);
      const tam = buf.readUInt32LE(o + 4);
      if (id === 'EXIF') return true;
      o += 8 + tam + (tam % 2);
    }
    return false;
  }
  if (ext === '.jpg' || ext === '.jpeg') return buf.indexOf(Buffer.from('Exif\0\0', 'binary')) >= 0;
  if (ext === '.png') return buf.indexOf(Buffer.from('eXIf', 'ascii')) >= 0;
  return false;
}
const imagenes = repo.archivos.filter(function (f) { return /^assets\/img\//.test(f) && /\.(webp|png|jpe?g|avif|gif|svg)$/i.test(f); });
(function exifYTamanos() {
  const conExif = [], grandes = [], medianas = [];
  let mayor = { f: '', b: 0 };
  imagenes.forEach(function (f) {
    const buf = fs.readFileSync(path.join(RAIZ, f));
    if (tieneExif(buf, path.extname(f).toLowerCase())) conExif.push(f);
    if (buf.length > mayor.b) mayor = { f: f, b: buf.length };
    if (buf.length >= LIMITE_IMAGEN) grandes.push(f + ' (' + Math.round(buf.length / 1024) + ' KB)');
    else if (buf.length > AVISO_IMAGEN) medianas.push(f + ' (' + Math.round(buf.length / 1024) + ' KB)');
  });
  anotar('Datos sensibles según políticas', conExif.length ? 'FALLA' : 'OK', 'Imágenes sin EXIF/GPS',
    conExif.length ? lista(conExif) : imagenes.length + ' imágenes revisadas');
  anotar('Tamaños', grandes.length ? 'FALLA' : medianas.length ? 'AVISO' : 'OK', 'Cada imagen pesa menos de 250 KB',
    grandes.length ? lista(grandes) : (medianas.length ? 'entre 200 y 250 KB: ' + lista(medianas) + '. ' : '') +
      imagenes.length + ' imágenes; la mayor: ' + (mayor.f || '—') + ' (' + Math.round(mayor.b / 1024) + ' KB)');
})();

(function validador() {
  const M = 'Datos sensibles según políticas';
  if (!validar) return;
  const r = validar.validar({ products: txt.products, articles: txt.articles, site: txt.site, chat: txt.chat }, {});
  anotar(M, r.ok ? 'OK' : 'FALLA', 'Validador del contrato ' + validar.CONTRATO_VERSION + ' (tools/validar.js)', r.ok ? 'sin errores; ' + r.avisos.length + ' aviso(s)' : lista(r.errores, 4));
  if (txt.chat === null) anotar(M, 'FALLA', 'data/chat.json (URL del chat del agente)', 'no existe');
  // Contrato v2: la web es una demo privada que debe parecer una tienda real (sin avisos de muestra ni de IA).
  const S = doc.site || {};
  const enSitio = ['aviso_muestra', 'aviso_ia'].filter(function (k) { return S[k] !== undefined; })
    .concat(S.mensajes && S.mensajes.consulta_muestra !== undefined ? ['mensajes.consulta_muestra'] : []);
  const RE_AVISO = /cat[aá]logo de muestra|precios? referencial|imagen(es)? referencial|generad[ao]s? (con|por) (la )?(ia|inteligencia artificial)|\(IA\)/i;
  const PUBLICAS = ['index.html', '404.html']; // admin.html es interna (noindex + guardia de hostname): puede hablar de IA
  const enHtml = PUBLICAS.filter(function (h) { return htmlTxt[h] !== null && RE_AVISO.test(htmlTxt[h]); });
  anotar(M, enSitio.length || enHtml.length ? 'FALLA' : 'OK', 'Sin avisos de "muestra" ni de "IA" en las páginas públicas (la demo parece una tienda real)',
    enSitio.length || enHtml.length ? (enSitio.length ? 'site.json: ' + enSitio.join(', ') + '. ' : '') + (enHtml.length ? 'textos de aviso en: ' + enHtml.join(', ') : '')
      : 'site.json y ' + PUBLICAS.join(', ') + ' sin avisos');
})();

// ---------------------------------------------------------------------------------------------
// 5. Rutas: imágenes de los JSON, absolutas, enlaces internos y sitemap
// ---------------------------------------------------------------------------------------------
(function rutasJson() {
  const M = 'Rutas e imágenes';
  const rutas = [];
  const juntar = function (o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(juntar); return; }
    Object.keys(o).forEach(function (k) {
      const v = o[k];
      if (k === 'src' && typeof v === 'string') rutas.push(v);
      else juntar(v);
    });
  };
  juntar(doc.products); juntar(doc.articles); juntar(doc.site);
  const faltan = rutas.filter(function (r) { return !/^assets\//.test(r) || !existe(r); });
  anotar(M, faltan.length ? 'FALLA' : 'OK', 'Las imágenes citadas por data/*.json existen',
    faltan.length ? faltan.length + ' de ' + rutas.length + ' no existen: ' + lista(faltan) : rutas.length + ' rutas, todas en disco');
})();

(function rutasHtml() {
  const M = 'Rutas e imágenes';
  HTMLS.forEach(function (h) {
    const html = htmlTxt[h];
    if (html === null) { anotar(M, 'FALLA', h + ': enlaces y rutas', h + ' no existe todavía'); return; }
    const es404 = h === '404.html';
    const absolutas = [], rotas = [], anclas = [], peligrosas = [], otras = [];
    let internas = 0;
    atributosUrl(html).forEach(function (a) {
      // url(%23g) dentro de un SVG en data: (textura de grano) es un fragmento del propio SVG, no un archivo.
      if (/^%23/.test(a.url)) return;
      const r = resolver(h, a.url);
      if (r.tipo === 'externa' || r.tipo === 'vacia') return;
      if (r.tipo === 'peligrosa') { peligrosas.push(a.url); return; }
      if (r.tipo === 'protocolo-relativa' || r.tipo === 'invalida') { otras.push(a.url); return; }
      if (r.absoluta && !es404) { absolutas.push(a.url); return; }
      if (es404 && !r.absoluta && !/^#/.test(a.url)) { absolutas.push(a.url + ' (relativa en 404.html)'); return; }
      if (r.tipo !== 'interna') { rotas.push(a.url + ' (fuera de ' + BASE + ')'); return; }
      internas++;
      if (!existe(r.ruta)) { rotas.push(a.url); return; }
      if (r.hash && /\.html$/.test(r.ruta) && HTMLS.indexOf(r.ruta) >= 0) {
        if (r.hash === 'top' || /[/=]/.test(r.hash)) return; // rutas del router (#p/slug, #blog/slug)
        const destino = leer(r.ruta);
        if (destino !== null && !ids(destino).has(r.hash)) anclas.push(a.url);
      }
    });
    // Rutas absolutas escondidas en el JS/CSS en línea (fetch('/data/...'), url(/assets/...)).
    if (!es404) {
      textoScripts(html).forEach(function (s) {
        s.texto.replace(/['"`](\/(?:assets|data|tools|index\.html|admin\.html|articulo)[^'"`\s]*)['"`]/g, function (x, u) { absolutas.push(u + ' (en <script>)'); return x; });
      });
    }
    if (peligrosas.length) anotar(M, 'FALLA', h + ': sin enlaces javascript:', lista(peligrosas));
    anotar(M, absolutas.length ? 'FALLA' : 'OK', h + (es404 ? ': rutas absolutas /tienda-tarapoto/... (a propósito)' : ': sin rutas absolutas rotas'),
      absolutas.length ? lista(absolutas) : (es404 ? 'todas empiezan por ' + BASE : 'todas relativas'));
    anotar(M, rotas.length || anclas.length ? 'FALLA' : otras.length ? 'AVISO' : 'OK', h + ': enlaces internos válidos',
      (rotas.length ? 'no existen: ' + lista(rotas) + '. ' : '') + (anclas.length ? 'anclas sin id: ' + lista(anclas) + '. ' : '') +
      (otras.length ? 'revisar: ' + lista(otras) + '. ' : '') + (!rotas.length && !anclas.length ? internas + ' enlaces/recursos internos verificados' : ''));
  });
})();

(function demoPrivada() {
  // Contrato v2: la demo solo se muestra a dueños de negocios; los buscadores no deben indexarla.
  const M = 'Rutas e imágenes';
  anotar(M, existe('sitemap.xml') ? 'FALLA' : 'OK', 'Demo privada: sin sitemap.xml', existe('sitemap.xml') ? 'sitemap.xml todavía existe: bórralo' : 'no hay sitemap.xml en ' + SITIO);
  const sinMeta = HTMLS.filter(function (h) {
    const html = htmlTxt[h];
    if (html === null) return true;
    const metas = html.match(/<meta\b[^>]*>/gi) || [];
    return !metas.some(function (m) { return /name=["']robots["']/i.test(m) && /noindex/i.test(m) && /nofollow/i.test(m); });
  });
  anotar(M, sinMeta.length ? 'FALLA' : 'OK', 'Demo privada: meta robots "noindex, nofollow" en cada página',
    sinMeta.length ? 'falta en: ' + sinMeta.join(', ') : HTMLS.join(', '));
})();

// ---------------------------------------------------------------------------------------------
// 6. Tamaño de los JSON
// ---------------------------------------------------------------------------------------------
(function tamanosJson() {
  const det = [], malos = [];
  ['products', 'articles', 'site', 'chat'].forEach(function (n) {
    const f = 'data/' + n + '.json';
    if (!existe(f)) { malos.push(f + ' no existe'); return; }
    const b = fs.statSync(path.join(RAIZ, f)).size;
    det.push(n + '=' + b);
    if (b >= LIMITE_JSON) malos.push(f + ' (' + b + ' bytes)');
  });
  anotar('Tamaños', malos.length ? 'FALLA' : 'OK', 'Cada JSON de data/ pesa menos de 1 MB', malos.length ? lista(malos) : det.join(', ') + ' bytes');
})();

// ---------------------------------------------------------------------------------------------
// 7. CSP y 8. Pages / n8n
// ---------------------------------------------------------------------------------------------
(function revisarCsp() {
  if (!csp) return;
  ['index.html', 'admin.html'].forEach(function (h) {
    const r = csp.revisarArchivo(path.join(RAIZ, h));
    anotar('CSP', r.problemas.length ? 'FALLA' : 'OK', h + ': hash del script en línea en la CSP',
      r.problemas.length ? r.problemas.join('; ') : r.scripts + ' script(s) en línea autorizados' + (r.avisos.length ? ' (aviso: ' + r.avisos.join('; ') + ')' : ''));
  });
})();

(function pages() {
  const M = 'Publicación';
  anotar(M, existe('.nojekyll') ? 'OK' : 'FALLA', '.nojekyll en la raíz', existe('.nojekyll') ? 'presente (Pages no pasa el sitio por Jekyll)' : 'falta');
  anotar(M, existe('404.html') ? 'OK' : 'FALLA', '404.html en la raíz', existe('404.html') ? 'presente' : 'falta');
  const adm = htmlTxt['admin.html'];
  if (adm !== null) {
    const ok = /name=["']robots["'][^>]*noindex/i.test(adm) && /HOSTS_LOCALES|location\.hostname/.test(adm);
    anotar(M, ok ? 'OK' : 'FALLA', 'admin.html con noindex y guardia de hostname', ok ? 'presentes' : 'falta noindex o la guardia');
  }
  if (limpiar) {
    const archivos = limpiar.listar([], RAIZ);
    if (!archivos.length) anotar(M, 'AVISO', 'n8n/workflows limpios (sin pinData, ids de credenciales ni instanceId)', 'aún no hay n8n/workflows/*.json');
    else {
      const malos = [];
      archivos.forEach(function (f) {
        const r = limpiar.procesar(f, true);
        if (r.error || r.secretos.length || r.cambios.length) malos.push(rel(f) + ': ' + (r.error || r.secretos.join(', ') || r.cambios.join(', ')));
      });
      anotar(M, malos.length ? 'FALLA' : 'OK', 'n8n/workflows limpios (sin pinData, ids de credenciales ni instanceId)',
        malos.length ? lista(malos, 3) + '. Ejecuta: node tools/limpiar-workflows.js' : archivos.length + ' workflow(s) limpios');
    }
  }
})();
anotar('Revisión humana en decisiones de impacto', 'MANUAL', 'Borrador + Publicar; doble confirmación en /borrar, /limpiar_muestras y /whatsapp', 'Pruebas 4-6, 9, 17 y 18 de F7.');
anotar('Regla de cierre', 'MANUAL', 'Lighthouse >= 90 rendimiento y >= 95 accesibilidad, buenas prácticas y SEO; móvil real', 'Chrome DevTools > Lighthouse sobre http://127.0.0.1:8080/tienda-tarapoto/ y luego sobre Pages (diapositiva 22).');

// ---------------------------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------------------------
const cuenta = { OK: 0, FALLA: 0, AVISO: 0, MANUAL: 0 };
resultados.forEach(function (r) { cuenta[r.estado]++; });
if (process.argv.indexOf('--json') >= 0) {
  console.log(JSON.stringify({ fecha: new Date().toISOString(), resumen: cuenta, resultados: resultados }, null, 2));
} else {
  console.log('QA de Palmera Brava: matriz de la diapositiva 16 (parte automatizable)');
  const grupos = [];
  resultados.forEach(function (r) { if (grupos.indexOf(r.matriz) < 0) grupos.push(r.matriz); });
  grupos.forEach(function (g) {
    console.log('\n' + g);
    resultados.filter(function (r) { return r.matriz === g; }).forEach(function (r) {
      console.log('  [' + r.estado + ']' + ' '.repeat(7 - r.estado.length) + r.titulo + (r.detalle ? ': ' + r.detalle : ''));
    });
  });
  console.log('\nResumen: ' + cuenta.OK + ' OK, ' + cuenta.FALLA + ' FALLA, ' + cuenta.AVISO + ' AVISO, ' + cuenta.MANUAL + ' MANUAL.');
  if (cuenta.FALLA) console.log('Siguiente paso: corrige las filas FALLA y vuelve a ejecutar node tools/qa.js.');
}
process.exitCode = cuenta.FALLA ? 1 : 0;
