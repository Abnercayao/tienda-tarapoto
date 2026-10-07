#!/usr/bin/env node
/*
 * n8n/tools/preparar-importacion.js — Copia n8n/workflows/*.json a una carpeta de importación y vuelve a poner
 * el id fijo de cada credencial (pbCredTelegram01, pbCredGithub0001, pbCredHeader0001) según
 * n8n/reference/credenciales.plantilla.json, buscando por tipo + nombre.
 *
 *   node n8n/tools/preparar-importacion.js <carpeta-destino>
 *
 * Por qué: el repo es público y tools/limpiar-workflows.js quita los id de credencial (PLAN D14). Para que
 * `n8n import:workflow` enlace cada nodo con la credencial que YA existe (y su token), las copias que se
 * importan llevan el id exacto. No toca n8n/workflows/ ni escribe secretos (la plantilla solo trae placeholders
 * y de ella se usan id/nombre/tipo, nunca `data`).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR_N8N = path.resolve(__dirname, '..');
const DIR_WF = path.join(DIR_N8N, 'workflows');
const destino = process.argv[2];
if (!destino) { console.error('Uso: node n8n/tools/preparar-importacion.js <carpeta-destino>'); process.exit(2); }

const plantilla = JSON.parse(fs.readFileSync(path.join(DIR_N8N, 'reference', 'credenciales.plantilla.json'), 'utf8'));
fs.mkdirSync(destino, { recursive: true });

let errores = 0;
fs.readdirSync(DIR_WF).filter(function (f) { return /\.json$/i.test(f); }).sort().forEach(function (f) {
  const wf = JSON.parse(fs.readFileSync(path.join(DIR_WF, f), 'utf8'));
  let puestos = 0;
  (wf.nodes || []).forEach(function (n) {
    Object.keys(n.credentials || {}).forEach(function (tipo) {
      const c = n.credentials[tipo];
      const pl = plantilla.filter(function (x) { return x.type === tipo && x.name === c.name; })[0];
      if (!pl) { errores++; console.log('ERROR ' + f + ' nodo "' + n.name + '": credencial "' + c.name + '" (' + tipo + ') no está en la plantilla'); return; }
      if (c.id !== undefined && c.id !== pl.id) { errores++; console.log('ERROR ' + f + ' nodo "' + n.name + '": id ' + c.id + ' distinto de ' + pl.id); return; }
      if (c.id === undefined) puestos++;
      n.credentials[tipo] = { id: pl.id, name: pl.name };
    });
  });
  if (wf.active) wf.active = false; // nunca se importa publicado
  fs.writeFileSync(path.join(destino, f), JSON.stringify(wf, null, 2) + '\n');
  console.log('copiado ' + f + (puestos ? ' (' + puestos + ' id de credencial)' : ''));
});
process.exit(errores ? 1 : 0);
