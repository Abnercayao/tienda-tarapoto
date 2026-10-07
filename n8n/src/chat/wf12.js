//// Validar URL
// Cuerpo que manda tools/iniciar-chat.ps1 (solo desde esta PC, con la clave X-Tienda-Key):
//   {"url": "https://<subdominio>.trycloudflare.com"}  -> chat activo con esa URL
//   {"activo": false}                                  -> chat apagado (url vacía); lo manda tools/detener-chat.bat
const w = $('POST chat-url').first().json || {};
const b = w.body && typeof w.body === 'object' && !Array.isArray(w.body) ? w.body : {};
const malo = function (error) { return [{ json: { valido: false, status: 400, cuerpo: { ok: false, error: error } } }]; };
if (b.activo === false) return [{ json: { valido: true, url: '', activo: false } }];
if (b.activo !== undefined && b.activo !== true) return malo('"activo" debe ser true o false');
const url = typeof b.url === 'string' ? b.url.trim().toLowerCase().replace(/\/$/, '') : '';
if (url.length > 120 || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url)) return malo('url inválida: debe ser https://<subdominio>.trycloudflare.com, sin ruta');
if (/^https:\/\/api\./.test(url)) return malo('api.trycloudflare.com no es la URL de un túnel');
return [{ json: { valido: true, url: url, activo: true } }];

//// Config
// @incluir comun
// pb_config -> solo lo que necesita este workflow (sin BOT_TOKEN: no viaja por las ejecuciones).
// GITHUB_API_URL es opcional y SOLO para pruebas con un GitHub simulado local; cualquier otro valor se ignora
// (así nadie puede mandar el PAT a otro servidor cambiando pb_config).
const filas = $input.all().map(function (i) { return i.json; });
const cfg = armarConfig(filas);
const fila = filas.find(function (f) { return f && f.clave === 'GITHUB_API_URL'; });
const api = fila ? String(fila.valor || '').trim().replace(/\/$/, '') : '';
const GITHUB_API_URL = /^(https:\/\/api\.github\.com|http:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal):\d{2,5})$/.test(api) ? api : 'https://api.github.com';
return [{ json: { REPO: cfg.REPO, REPO_BRANCH: cfg.REPO_BRANCH, COMMIT_EMAIL: cfg.COMMIT_EMAIL, GITHUB_API_URL: GITHUB_API_URL } }];

//// Comparar
// @incluir validar.js
// @incluir comun
// data/chat.json actual (Contents API) -> ¿cambia? Si no cambia: no hay commit. Si cambia: valida con validar() y arma el PUT.
const v = $('Validar URL').first().json;
const cfg = $('Config').first().json;
const r = $input.first().json || {};
const st = Number(r.statusCode) || 0;
const fallo = function (status, error) { return [{ json: { escribir: false, status: status, cuerpo: { ok: false, error: censurar(error).replace(/[<>]/g, '').slice(0, 300) } } }]; };
const msgGh = function (x) { return x && x.body && typeof x.body === 'object' && x.body.message ? String(x.body.message) : ''; };
let actual = null, sha = '';
if (st === 200 && r.body && typeof r.body.content === 'string') {
  sha = String(r.body.sha || '');
  try { actual = JSON.parse(Buffer.from(r.body.content.replace(/\s/g, ''), 'base64').toString('utf8').replace(/^﻿/, '')); }
  catch (e) { return fallo(502, 'data/chat.json de GitHub no es JSON válido; corrígelo a mano'); }
} else if (st === 404) {
  actual = null; // aún no existe: se crea
} else if (st === 401 || st === 403) {
  return fallo(502, 'GitHub rechazó la credencial (' + st + '): revisa "GitHub Palmera Brava" en n8n. ' + msgGh(r));
} else {
  return fallo(502, 'No pude leer data/chat.json de GitHub (HTTP ' + (st || 'sin respuesta') + '). ' + msgGh(r));
}
const base = actual && typeof actual === 'object' && !Array.isArray(actual) ? actual : { url: '', activo: false, actualizado: '' };
if (base.url === v.url && base.activo === v.activo) {
  return [{ json: { escribir: false, status: 200, cuerpo: { ok: true, cambiado: false, url: v.url, activo: v.activo, actualizado: String(base.actualizado || ''),
    mensaje: 'data/chat.json ya tenía estos datos; no se hizo commit' } } }];
}
const nuevo = {};
if (typeof base.$schema === 'string') nuevo.$schema = base.$schema;
nuevo.url = v.url;
nuevo.activo = v.activo;
nuevo.actualizado = isoLima(Date.now());
const val = validar({ chat: nuevo }, actual ? { anterior: { chat: actual }, idsLote: ['chat'], rol: 'admin' } : {});
if (!val.ok) return [{ json: { escribir: false, status: 422, cuerpo: { ok: false, error: 'validar() rechazó el nuevo data/chat.json', errores: val.errores.slice(0, 10) } } }];
const cuerpoPut = {
  message: v.activo ? 'chat: actualizar URL del túnel' : 'chat: desactivar el chat (túnel detenido)',
  content: Buffer.from(serializar(nuevo), 'utf8').toString('base64'),
  branch: cfg.REPO_BRANCH,
  committer: { name: 'Tienda Chat', email: cfg.COMMIT_EMAIL },
  author: { name: 'Tienda Chat', email: cfg.COMMIT_EMAIL }
};
if (sha) cuerpoPut.sha = sha;
return [{ json: { escribir: true, cuerpoPut: cuerpoPut, nuevo: nuevo, creado: !sha } }];

//// Resultado
// @incluir comun
// Respuesta del PUT (Contents API): 200 actualizado, 201 creado. 409/422 = alguien cambió chat.json o main a la vez (sin force: se reintenta desde el script).
const c = $('Comparar').first().json;
const r = $input.first().json || {};
const st = Number(r.statusCode) || 0;
const msg = censurar(r.body && typeof r.body === 'object' && r.body.message ? String(r.body.message) : '').replace(/[<>]/g, '').slice(0, 200);
if (st === 200 || st === 201) {
  const commit = r.body && r.body.commit && r.body.commit.sha ? String(r.body.commit.sha) : '';
  return [{ json: { status: 200, cuerpo: { ok: true, cambiado: true, creado: st === 201, url: c.nuevo.url, activo: c.nuevo.activo, actualizado: c.nuevo.actualizado,
    commit: commit.slice(0, 7), mensaje: 'data/chat.json actualizado; GitHub Pages lo publica en 1–10 min' } } }];
}
if (st === 409 || st === 422) return [{ json: { status: 409, cuerpo: { ok: false, reintentar: true, error: 'GitHub: conflicto (main o data/chat.json cambió a la vez). Vuelve a intentarlo. ' + msg } } }];
if (st === 401 || st === 403) return [{ json: { status: 502, cuerpo: { ok: false, error: 'GitHub rechazó la escritura (' + st + '): revisa el PAT (permiso Contents: write). ' + msg } } }];
return [{ json: { status: 502, cuerpo: { ok: false, error: 'GitHub no aceptó el cambio (HTTP ' + (st || 'sin respuesta') + '). ' + msg } } }];
