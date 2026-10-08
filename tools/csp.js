#!/usr/bin/env node
/*
 * tools/csp.js — Mantiene el hash del <script> en línea dentro de la CSP de index.html y admin.html.
 *
 *   node tools/csp.js                 calcula el sha256 del script en línea y lo escribe en script-src
 *   node tools/csp.js --check         solo comprueba (exit 1 si falta, sobra o no coincide)
 *   node tools/csp.js [--check] a.html b.html   otros archivos
 *
 * Qué hace:
 *  - Busca los <script> EJECUTABLES en línea (sin src; sin type, o type JavaScript/module). Ignora los de datos
 *    (application/json, application/ld+json), los que están dentro de comentarios y los externos (src=...).
 *  - Calcula sha256 en base64 del texto del script tal como lo ve el navegador (saltos CRLF/CR → LF, como el
 *    parser HTML), sobre sus bytes UTF-8.
 *  - v3 (docs/PEDIDOS.md): si la página hace pedidos (/pedido, /seguimiento, /pedido/pago) exige los mismos orígenes del
 *    proxy en connect-src, rechaza un connect-src abierto (*, https:, http:) y que la página llame a api.mercadopago.com
 *    (la preferencia de pago la crea n8n con la credencial "Mercado Pago Prueba"; el token nunca va a la web).
 *  - Si la página usa el chat (lee data/chat.json), exige que connect-src permita https://*.trycloudflare.com,
 *    http://127.0.0.1:8787 y http://localhost:8787 (contrato v2, sección 0.6).
 *  - En el <meta http-equiv="Content-Security-Policy">, reescribe la directiva script-src: quita los hashes
 *    anteriores y el marcador CSP_HASH_PLACEHOLDER (con o sin 'sha256-') y añade los hashes actuales.
 * Lo ideal es UN script en línea por página (PLAN D10); si hay más, se añaden todos y se avisa.
 * Ejecútalo SIEMPRE después de editar el script en línea; el hook pre-commit corre --check.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MARCADOR = 'CSP_HASH_PLACEHOLDER';
// Contrato v2: la página que usa el chat del agente (lee data/chat.json) debe permitir en connect-src el túnel
// rápido de Cloudflare y el proxy local tools/chat-proxy.py.
const ORIGENES_CHAT = ['https://*.trycloudflare.com', 'http://127.0.0.1:8787', 'http://localhost:8787'];
const TIPOS_JS = ['', 'module', 'text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript',
  'application/x-javascript', 'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript', 'text/javascript1.0',
  'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5'];

function atributo(attrs, nombre) {
  const m = new RegExp('(?:^|\\s)' + nombre + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'=<>`]+))', 'i').exec(attrs);
  if (!m) return new RegExp('(?:^|\\s)' + nombre + '(?=\\s|$)', 'i').test(attrs) ? '' : null;
  return m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
}

// Recorre el HTML en orden: salta comentarios y extrae los <script> con su texto.
function scripts(html) {
  const salida = [];
  let i = 0;
  const bajo = html.toLowerCase();
  while (i < html.length) {
    const c = bajo.indexOf('<!--', i);
    const s = bajo.indexOf('<script', i);
    if (s < 0) break;
    if (c >= 0 && c < s) {
      const fin = bajo.indexOf('-->', c + 4);
      if (fin < 0) break;
      i = fin + 3;
      continue;
    }
    const sig = bajo.charAt(s + 7);
    if (sig && !/[\s>/]/.test(sig)) { i = s + 7; continue; } // p. ej. <scripts
    const cierreTag = html.indexOf('>', s);
    if (cierreTag < 0) break;
    const attrs = html.slice(s + 7, cierreTag).replace(/\/$/, '');
    const fin = bajo.indexOf('</script', cierreTag + 1);
    if (fin < 0) break;
    const texto = html.slice(cierreTag + 1, fin);
    const finTag = html.indexOf('>', fin);
    i = finTag < 0 ? html.length : finTag + 1;
    const src = atributo(attrs, 'src');
    const tipo = (atributo(attrs, 'type') || '').trim().toLowerCase();
    const ejecutable = src === null && TIPOS_JS.indexOf(tipo) >= 0;
    salida.push({ inicio: s, attrs: attrs.trim(), tipo: tipo, externo: src !== null, ejecutable: ejecutable, texto: texto });
  }
  return salida;
}

function hashScript(texto) {
  const normal = texto.replace(/\r\n?/g, '\n');
  return "'sha256-" + crypto.createHash('sha256').update(normal, 'utf8').digest('base64') + "'";
}

function buscarMetaCsp(html) {
  const re = /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/ig;
  const metas = [];
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const c = /\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    if (!c) continue;
    const valor = c[2] !== undefined ? c[2] : c[3];
    metas.push({ inicio: m.index, tag: tag, valor: valor, inicioValor: m.index + c.index + c[0].indexOf(c[1]) + 1 });
  }
  return metas;
}

function directivas(valor) {
  return valor.split(';').map(function (d) { return d.trim(); }).filter(Boolean).map(function (d) {
    const partes = d.split(/\s+/);
    return { nombre: partes[0].toLowerCase(), fuentes: partes.slice(1) };
  });
}
function esHash(f) { return /^'sha(256|384|512)-[A-Za-z0-9+/=_-]+'$/.test(f); }
function esMarcador(f) { return f.indexOf(MARCADOR) >= 0; }

function analizar(html) {
  const todos = scripts(html);
  const enLinea = todos.filter(function (s) { return s.ejecutable; });
  const hashes = enLinea.map(function (s) { return hashScript(s.texto); });
  const metas = buscarMetaCsp(html);
  const r = { scripts: enLinea.length, hashes: hashes, metas: metas.length, problemas: [], avisos: [], hashesCsp: [], marcador: false };
  if (!metas.length) { r.problemas.push('no hay <meta http-equiv="Content-Security-Policy">'); return r; }
  if (metas.length > 1) r.avisos.push('hay ' + metas.length + ' metas CSP; el navegador aplica TODAS (la más estricta gana)');
  const dir = directivas(metas[0].valor);
  const ss = dir.filter(function (d) { return d.nombre === 'script-src'; })[0];
  if (!ss) { r.problemas.push('la CSP no tiene script-src'); return r; }
  r.hashesCsp = ss.fuentes.filter(function (f) { return esHash(f) && !esMarcador(f); });
  r.marcador = ss.fuentes.some(esMarcador) || metas[0].valor.indexOf(MARCADOR) >= 0;
  if (html.indexOf('data/chat.json') >= 0) {
    const cs = dir.filter(function (d) { return d.nombre === 'connect-src'; })[0];
    const faltanC = ORIGENES_CHAT.filter(function (o) { return !cs || cs.fuentes.indexOf(o) < 0; });
    if (faltanC.length) r.problemas.push('connect-src no permite el chat del agente (falta ' + faltanC.join(' ') + ')');
  }
  if (/["']\/pedido\/pago["']|["']\/seguimiento["']/.test(html)) {
    const cs = dir.filter(function (d) { return d.nombre === 'connect-src'; })[0];
    const faltanP = ORIGENES_CHAT.filter(function (o) { return !cs || cs.fuentes.indexOf(o) < 0; });
    if (faltanP.length) r.problemas.push('connect-src no permite los pedidos por el proxy (falta ' + faltanP.join(' ') + ')');
    if (cs && cs.fuentes.some(function (x) { return x === '*' || x === 'https:' || x === 'http:'; })) r.problemas.push('connect-src demasiado abierto para una página que envía datos de pedidos');
  }
  if (/api\.mercadopago\.com/i.test(html)) r.problemas.push('la página menciona api.mercadopago.com: el pago lo crea n8n (WF13) y el Access Token nunca va a la web');
  if (enLinea.length > 1) r.avisos.push('hay ' + enLinea.length + ' scripts en línea ejecutables; el PLAN pide uno solo');
  if (r.marcador) r.problemas.push('la CSP aún tiene ' + MARCADOR + '; ejecuta: node tools/csp.js');
  const faltan = hashes.filter(function (h) { return r.hashesCsp.indexOf(h) < 0; });
  const sobran = r.hashesCsp.filter(function (h) { return hashes.indexOf(h) < 0; });
  if (faltan.length) r.problemas.push('script-src no autoriza el script en línea actual (' + faltan.join(' ') + '); ejecuta: node tools/csp.js');
  if (sobran.length) r.problemas.push('script-src tiene hashes que ya no corresponden a ningún script (' + sobran.join(' ') + ')');
  if (/'unsafe-inline'/.test(ss.fuentes.join(' '))) r.avisos.push("script-src tiene 'unsafe-inline' (con un hash presente, los navegadores modernos lo ignoran)");
  return r;
}

function actualizarHtml(html) {
  const r = analizar(html);
  const metas = buscarMetaCsp(html);
  if (!metas.length) return { html: html, cambiado: false, analisis: r };
  const meta = metas[0];
  const partes = meta.valor.split(';');
  let tocado = false;
  const nuevas = partes.map(function (p) {
    const t = p.trim();
    if (!t) return p;
    const tokens = t.split(/\s+/);
    if (tokens[0].toLowerCase() !== 'script-src') return p;
    tocado = true;
    const resto = tokens.slice(1).filter(function (f) { return !esHash(f) && !esMarcador(f); });
    const lead = /^\s*/.exec(p)[0];
    return lead + ['script-src'].concat(resto, r.hashes).join(' ');
  });
  let valor = nuevas.join(';');
  if (!tocado) return { html: html, cambiado: false, analisis: r };
  if (valor.indexOf(MARCADOR) >= 0) valor = valor.split("'sha256-" + MARCADOR + "'").join('').split(MARCADOR).join('').replace(/ {2,}/g, ' ');
  const nuevoHtml = html.slice(0, meta.inicioValor) + valor + html.slice(meta.inicioValor + meta.valor.length);
  return { html: nuevoHtml, cambiado: nuevoHtml !== html, analisis: analizar(nuevoHtml) };
}

function revisarArchivo(archivo) {
  if (!fs.existsSync(archivo)) return { archivo: archivo, existe: false, problemas: ['no existe'], avisos: [], hashes: [], hashesCsp: [], scripts: 0 };
  const r = analizar(fs.readFileSync(archivo, 'utf8'));
  r.archivo = archivo;
  r.existe = true;
  return r;
}
function actualizarArchivo(archivo) {
  if (!fs.existsSync(archivo)) return { archivo: archivo, existe: false, cambiado: false, analisis: { problemas: ['no existe'], avisos: [], hashes: [] } };
  const html = fs.readFileSync(archivo, 'utf8');
  const r = actualizarHtml(html);
  if (r.cambiado) fs.writeFileSync(archivo, r.html);
  r.archivo = archivo;
  r.existe = true;
  delete r.html;
  return r;
}

module.exports = { MARCADOR, ORIGENES_CHAT, scripts, hashScript, analizar, actualizarHtml, revisarArchivo, actualizarArchivo, ARCHIVOS: ['index.html', 'admin.html'] };

function cli(argv) {
  const raiz = path.resolve(__dirname, '..');
  const check = argv.indexOf('--check') >= 0;
  const desconocidas = argv.filter(function (a) { return a.indexOf('--') === 0 && a !== '--check'; });
  if (desconocidas.length) { console.error('Opción desconocida: ' + desconocidas.join(' ') + '. Uso: node tools/csp.js [--check] [archivos.html]'); return 2; }
  let archivos = argv.filter(function (a) { return a.indexOf('--') !== 0; });
  if (!archivos.length) archivos = module.exports.ARCHIVOS.map(function (f) { return path.join(raiz, f); });
  let fallas = 0;
  for (const f of archivos) {
    const nombre = path.relative(raiz, path.resolve(f)) || f;
    if (check) {
      const r = revisarArchivo(f);
      r.avisos.forEach(function (a) { console.log('aviso ' + nombre + ': ' + a); });
      if (r.problemas.length) { fallas++; r.problemas.forEach(function (p) { console.log('FALLA ' + nombre + ': ' + p); }); }
      else console.log('OK ' + nombre + ': ' + r.scripts + ' script(s) en línea, CSP ' + r.hashesCsp.join(' '));
    } else {
      const r = actualizarArchivo(f);
      const a = r.analisis;
      (a.avisos || []).forEach(function (x) { console.log('aviso ' + nombre + ': ' + x); });
      if (!r.existe || a.problemas.length) { fallas++; (a.problemas || []).forEach(function (p) { console.log('FALLA ' + nombre + ': ' + p); }); continue; }
      console.log((r.cambiado ? 'actualizado ' : 'sin cambios ') + nombre + ': script-src ' + a.hashes.join(' '));
    }
  }
  return fallas ? 1 : 0;
}
if (require.main === module) process.exitCode = cli(process.argv.slice(2));
