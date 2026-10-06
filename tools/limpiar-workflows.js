#!/usr/bin/env node
/*
 * tools/limpiar-workflows.js — Deja los workflows exportados de n8n listos para un repo PÚBLICO (PLAN D14).
 *
 *   node tools/limpiar-workflows.js            limpia n8n/workflows/*.json en el sitio
 *   node tools/limpiar-workflows.js --check    no escribe; exit 1 si algo está sucio o hay un secreto
 *   node tools/limpiar-workflows.js [--check] archivo.json carpeta/ ...
 *
 * Quita:
 *  - pinData (datos fijados de pruebas: pueden traer mensajes, chat_id o fotos reales),
 *  - el "id" de cada credencial en nodes[].credentials (se conserva el nombre: al importar, n8n la busca por nombre),
 *  - meta.instanceId (identifica tu instalación de n8n),
 *  - shared / homeProject / ownedBy / sharedWithProjects (datos del dueño de la cuenta, si el export los trae).
 * Además busca secretos con forma de token (Telegram, GitHub, claves privadas): si encuentra uno, NO lo borra
 * por ti (habría que revisar el workflow y rotar el token) y sale con 1.
 * Formato de salida estable: JSON con 2 espacios y salto de línea final.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SECRETOS = [
  { nombre: 'token de bot de Telegram en una URL', re: /\bbot\d{5,}:[A-Za-z0-9_-]{10,}/ },
  { nombre: 'token de Telegram', re: /\d{8,10}:[A-Za-z0-9_-]{35}/ },
  { nombre: 'PAT clásico de GitHub', re: /ghp_[A-Za-z0-9]{20,}/ },
  { nombre: 'PAT fine-grained de GitHub', re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { nombre: 'otro token de GitHub', re: /\bgh[ousr]_[A-Za-z0-9]{20,}/ },
  { nombre: 'clave privada', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nombre: 'clave de API de n8n (JWT)', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ }
];
const CLAVES_DUENO = ['shared', 'homeProject', 'ownedBy', 'sharedWithProjects'];

function limpiarWorkflow(wf) {
  const cambios = [];
  const visitar = function (w, etiqueta) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) return;
    if (Object.prototype.hasOwnProperty.call(w, 'pinData')) {
      const vacio = !w.pinData || (typeof w.pinData === 'object' && Object.keys(w.pinData).length === 0);
      delete w.pinData;
      cambios.push(etiqueta + 'pinData' + (vacio ? ' (vacío)' : ''));
    }
    if (w.meta && typeof w.meta === 'object' && Object.prototype.hasOwnProperty.call(w.meta, 'instanceId')) {
      delete w.meta.instanceId;
      cambios.push(etiqueta + 'meta.instanceId');
      if (!Object.keys(w.meta).length) delete w.meta;
    }
    CLAVES_DUENO.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(w, k)) { delete w[k]; cambios.push(etiqueta + k); }
    });
    (Array.isArray(w.nodes) ? w.nodes : []).forEach(function (n) {
      if (!n || typeof n.credentials !== 'object' || !n.credentials) return;
      Object.keys(n.credentials).forEach(function (tipo) {
        const c = n.credentials[tipo];
        if (c && typeof c === 'object' && Object.prototype.hasOwnProperty.call(c, 'id')) {
          delete c.id;
          cambios.push(etiqueta + 'credencial ' + tipo + ' del nodo "' + n.name + '"');
        }
      });
    });
  };
  if (Array.isArray(wf)) wf.forEach(function (w, i) { visitar(w, '[' + i + '] '); });
  else visitar(wf, '');
  return cambios;
}

function buscarSecretos(texto) {
  const hallados = [];
  const lineas = texto.split('\n');
  SECRETOS.forEach(function (s) {
    lineas.forEach(function (l, i) { if (s.re.test(l)) hallados.push(s.nombre + ' (línea ' + (i + 1) + ')'); });
  });
  return hallados;
}

function procesar(archivo, soloRevisar) {
  const r = { archivo: archivo, cambios: [], secretos: [], error: null, escrito: false };
  let texto;
  try { texto = fs.readFileSync(archivo, 'utf8'); } catch (e) { r.error = 'no se puede leer: ' + e.message; return r; }
  let wf;
  try { wf = JSON.parse(texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto); } catch (e) { r.error = 'no es JSON válido: ' + e.message; return r; }
  r.cambios = limpiarWorkflow(wf);
  const salida = JSON.stringify(wf, null, 2) + '\n';
  r.secretos = buscarSecretos(salida);
  const formatoDistinto = salida !== texto.replace(/\r\n/g, '\n');
  if (formatoDistinto && !r.cambios.length) r.cambios.push('formato (2 espacios, LF, salto final)');
  if (!soloRevisar && formatoDistinto) { fs.writeFileSync(archivo, salida); r.escrito = true; }
  return r;
}

function listar(entradas, raiz) {
  const archivos = [];
  const lista = entradas.length ? entradas : [path.join(raiz, 'n8n', 'workflows')];
  lista.forEach(function (e) {
    if (!fs.existsSync(e)) return;
    if (fs.statSync(e).isDirectory()) {
      fs.readdirSync(e).filter(function (f) { return /\.json$/i.test(f); }).sort().forEach(function (f) { archivos.push(path.join(e, f)); });
    } else archivos.push(e);
  });
  return archivos;
}

module.exports = { limpiarWorkflow, buscarSecretos, procesar, listar, SECRETOS };

function cli(argv) {
  const raiz = path.resolve(__dirname, '..');
  const soloRevisar = argv.indexOf('--check') >= 0;
  const malas = argv.filter(function (a) { return a.indexOf('--') === 0 && a !== '--check'; });
  if (malas.length) { console.error('Opción desconocida: ' + malas.join(' ') + '. Uso: node tools/limpiar-workflows.js [--check] [archivos o carpetas]'); return 2; }
  const archivos = listar(argv.filter(function (a) { return a.indexOf('--') !== 0; }), raiz);
  if (!archivos.length) { console.log('No hay workflows que revisar (n8n/workflows/*.json todavía no existe).'); return 0; }
  let fallas = 0;
  archivos.forEach(function (f) {
    const r = procesar(f, soloRevisar);
    const nombre = path.relative(raiz, f) || f;
    if (r.error) { fallas++; console.log('FALLA ' + nombre + ': ' + r.error); return; }
    if (r.secretos.length) { fallas++; console.log('FALLA ' + nombre + ': posible secreto: ' + r.secretos.join(', ') + '. Quítalo en n8n, vuelve a exportar y rota ese token.'); }
    if (soloRevisar && r.cambios.length) { fallas++; console.log('FALLA ' + nombre + ': falta limpiar: ' + r.cambios.join(', ') + '. Ejecuta: node tools/limpiar-workflows.js'); }
    else if (!soloRevisar && r.cambios.length) console.log('limpiado ' + nombre + ': ' + r.cambios.join(', '));
    else if (!r.secretos.length) console.log('OK ' + nombre);
  });
  return fallas ? 1 : 0;
}
if (require.main === module) process.exitCode = cli(process.argv.slice(2));
