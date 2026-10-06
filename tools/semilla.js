#!/usr/bin/env node
// Inserta en index.html la semilla en línea (<script type="application/json" id="semilla">)
// con los mismos data/*.json, para que la prueba con doble clic (file://) muestre el catálogo.
// La semilla NUNCA se usa en http(s): ahí manda data/*.json (ver JS 3 en index.html).
// Uso: node tools/semilla.js          → actualiza index.html
//      node tools/semilla.js --check  → sale con 1 si la semilla no coincide con data/
'use strict';
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const html = path.join(raiz, 'index.html');
const leer = (n) => JSON.parse(fs.readFileSync(path.join(raiz, 'data', n + '.json'), 'utf8'));

const semilla = { products: leer('products'), articles: leer('articles'), site: leer('site') };
// "</" escapado para que el contenido no pueda cerrar la etiqueta <script>.
const json = JSON.stringify(semilla).replace(/<\//g, '<\\/');

const re = /(<script type="application\/json" id="semilla">)([\s\S]*?)(<\/script>)/;
const actual = fs.readFileSync(html, 'utf8');
const m = actual.match(re);
if (!m) {
  console.error('FALLA: index.html no tiene <script type="application/json" id="semilla">');
  process.exit(1);
}

if (process.argv.includes('--check')) {
  if (m[2] === json) { console.log('OK: la semilla de index.html coincide con data/*.json'); process.exit(0); }
  console.error('FALLA: la semilla está desactualizada; ejecuta: node tools/semilla.js');
  process.exit(1);
}

fs.writeFileSync(html, actual.replace(re, (_, a, __, c) => a + json + c));
console.log('Semilla actualizada (' + json.length + ' bytes).');
