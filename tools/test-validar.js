#!/usr/bin/env node
/*
 * tools/test-validar.js — Pruebas del contrato de datos (F1). Cero dependencias.
 *   node tools/test-validar.js
 * Comprueba que:
 *   1. las muestras de data/ pasan;
 *   2. se RECHAZAN los 15 casos malos de F1 (+ extras); v2: ia_local en un producto real ya se permite (demo);
 *   3. los cambios legítimos (editar 1 producto, /limpiar_muestras, foto real) pasan;
 *   4. el bloque "COPIAR A N8N" funciona aislado (sin require/module), como en un nodo Code;
 *   5. data/schema/*.json está sincronizado con tools/validar.js;
 *   6. las ayudas del LLM (categoría, permisos, operación) se comportan como dice docs/CONTRATO.md;
 *   9. contrato v2: frescura, stock_por_color, imagenes[].color, guia_tallas, chat.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const V = require('./validar.js');
const leer = (f) => JSON.parse(fs.readFileSync(path.join(RAIZ, f), 'utf8'));
const BASE = { products: leer('data/products.json'), articles: leer('data/articles.json'), site: leer('data/site.json'), chat: leer('data/chat.json') };
const copia = () => JSON.parse(JSON.stringify(BASE));
const prd = (d, id) => d.products.productos.find((p) => p.id === id);

let pasan = 0, fallan = 0;
function caso(nombre, fn) {
  try { fn(); pasan++; console.log('  ok   ' + nombre); } catch (e) { fallan++; console.log('  FALLA ' + nombre + '\n         ' + e.message); }
}
function afirmar(cond, msg) { if (!cond) throw new Error(msg); }
function sinMayorMenor(r) {
  for (const m of r.errores.concat(r.avisos)) afirmar(!/[<>]/.test(m), 'un mensaje contiene < o >: ' + m);
}
function debePasar(docs, opciones) {
  const r = V.validar(docs, opciones);
  sinMayorMenor(r);
  afirmar(r.ok, 'debía pasar y dio errores:\n         ' + r.errores.join('\n         '));
  return r;
}
// Rechaza y además exige que algún error tenga el código y (opcional) el fragmento de ruta/mensaje esperado.
function debeRechazar(docs, opciones, codigo, fragmento) {
  const r = V.validar(docs, opciones);
  sinMayorMenor(r);
  afirmar(!r.ok, 'debía rechazarse y pasó');
  const hit = r.errores.some((e) => e.indexOf('[' + codigo + ']') === 0 && (!fragmento || e.indexOf(fragmento) >= 0));
  afirmar(hit, 'se rechazó, pero no por [' + codigo + ']' + (fragmento ? ' con "' + fragmento + '"' : '') + ':\n         ' + r.errores.join('\n         '));
  return r;
}

console.log('1) Muestras');
caso('las muestras de data/ pasan sin errores', () => {
  const r = debePasar(copia(), {});
  afirmar(r.resumen.productos === 17 && r.resumen.productos_muestra === 16, 'deben ser 16 productos de muestra + prd-0017 (real, creado por el bot)');
  afirmar(r.resumen.articulos === 3, 'deben ser 3 artículos');
  afirmar(r.resumen.chat_activo === false, 'chat.json empieza inactivo');
  const porCat = {};
  BASE.products.productos.filter((p) => p.muestra).forEach((p) => { porCat[p.categoria] = (porCat[p.categoria] || 0) + 1; });
  afirmar(V.CATEGORIAS.every((c) => porCat[c] === 4), '4 productos de muestra por categoría: ' + JSON.stringify(porCat));
  afirmar(BASE.site.whatsapp === '51995542938', 'site.whatsapp debe ser el número real');
});
caso('las muestras también pasan como texto JSON (como llegan de la API de GitHub)', () => {
  debePasar({ products: JSON.stringify(BASE.products), articles: JSON.stringify(BASE.articles), site: JSON.stringify(BASE.site), chat: JSON.stringify(BASE.chat) }, {});
});

console.log('2) Los 15 casos malos de F1 (+ extras)');
caso('F1-01 <script> en el nombre', () => {
  const d = copia(); prd(d, 'prd-0001').nombre = 'Camisa <script>alert(1)</script>';
  debeRechazar(d, {}, 'esquema', '.nombre'); debeRechazar(d, {}, 'html', '.nombre');
});
caso('F1-02 precio negativo', () => { const d = copia(); prd(d, 'prd-0002').precio = -10; debeRechazar(d, {}, 'esquema', '.precio'); });
caso('F1-03 talla inválida (XXXL)', () => { const d = copia(); const p = prd(d, 'prd-0003'); p.tallas.push('XXXL'); debeRechazar(d, {}, 'esquema', '.tallas'); });
caso('F1-04 URL de imagen externa', () => { const d = copia(); prd(d, 'prd-0004').imagenes[0].src = 'https://evil.example.com/x.webp'; debeRechazar(d, {}, 'esquema', '.imagenes[0].src'); });
caso('F1-05 id duplicado', () => { const d = copia(); prd(d, 'prd-0006').id = 'prd-0005'; debeRechazar(d, {}, 'id_duplicado', 'prd-0005'); });
caso('F1-06 campo inventado', () => { const d = copia(); prd(d, 'prd-0007').color_favorito = 'rojo'; debeRechazar(d, {}, 'esquema', 'campo no permitido "color_favorito"'); });
caso('F1-07 cadena con forma de token (Telegram)', () => {
  const d = copia(); prd(d, 'prd-0008').descripcion = 'Contacto 123456789:AAHk9xQwErTyUiOpAsDfGhJkLzXcVbNm123';
  debeRechazar(d, {}, 'secreto', 'products');
});
caso('F1-08 javascript: en las redes', () => {
  const d = copia(); d.site.redes = [{ red: 'instagram', url: 'javascript:alert(1)' }];
  debeRechazar(d, {}, 'enlace', 'site.redes[0]'); debeRechazar(d, {}, 'esquema', 'site.redes[0].url');
});
caso('F1-09 WhatsApp mal formado', () => { const d = copia(); d.site.whatsapp = '+51 995 542 938'; debeRechazar(d, {}, 'whatsapp', 'site.whatsapp'); });
caso('F1-10 (v2) ia_local en un producto real ya se permite: la web es una demo privada', () => { const d = copia(); prd(d, 'prd-0009').muestra = false; debePasar(d, {}); });
caso('F1-11 referencia rota (artículo cita un producto que no existe)', () => {
  const d = copia(); d.articles.articulos[0].productos_relacionados.push('prd-0099'); debeRechazar(d, {}, 'referencia', 'prd-0099');
});
caso('F1-12 borrado masivo (16 a 10 productos)', () => {
  const d = copia(); d.products.productos = d.products.productos.filter((p) => ['prd-0008', 'prd-0011', 'prd-0014', 'prd-0002', 'prd-0003', 'prd-0010'].indexOf(p.id) < 0);
  // quitamos también las referencias para que el único motivo sea el borrado masivo
  d.articles.articulos.forEach((a) => { a.productos_relacionados = a.productos_relacionados.filter((id) => prd(d, id)); a.bloques.forEach((b) => { if (b.ids) b.ids = b.ids.filter((id) => prd(d, id)); }); });
  const r = debeRechazar(d, { anterior: copia() }, 'borrado_masivo', 'de 17 a 11');
  afirmar(!r.errores.some((e) => e.indexOf('[referencia]') === 0), 'no debía haber errores de referencia');
});
caso('F1-13 JSON de más de 1 MB', () => {
  const d = copia(); const base = prd(d, 'prd-0014'); const largo = 'Tela fresca de algodón para el calor de la selva, cómoda y ligera. '.repeat(9).slice(0, 600);
  for (let i = 18; i <= 1000; i++) {
    const p = JSON.parse(JSON.stringify(base)); p.id = 'prd-' + String(i).padStart(4, '0'); p.slug = 'gorro-muestra-' + i; p.descripcion = largo;
    d.products.productos.push(p);
  }
  debeRechazar(d, {}, 'tamano', 'products');
});
caso('F1-14 precio_oferta >= precio', () => { const d = copia(); prd(d, 'prd-0001').precio_oferta = 89.90; debeRechazar(d, {}, 'precio_oferta', 'prd-0001'); });
caso('F1-15 stock incoherente (stock distinto de la suma)', () => { const d = copia(); prd(d, 'prd-0005').stock = 99; debeRechazar(d, {}, 'stock', 'prd-0005'); });
caso('F1-16 (v2) ia_local en producto real con imagen nueva también pasa', () => {
  const d = copia(); const p = prd(d, 'prd-0013'); p.muestra = false; p.imagenes = [{ src: 'assets/img/products/sombrero-ia.webp', alt: 'Sombrero de palma natural', origen: 'ia_local' }];
  const r = debePasar(d, {}); afirmar(!r.errores.some((e) => e.indexOf('[imagen_origen]') === 0), 'imagen_origen ya no existe');
});
caso('extra: talla de adulto en la categoría niños', () => { const d = copia(); const p = prd(d, 'prd-0009'); p.tallas.push('M'); debeRechazar(d, {}, 'talla_categoria', 'prd-0009'); });
caso('extra: stock_por_talla con una talla que no está en tallas', () => { const d = copia(); prd(d, 'prd-0003').stock_por_talla = { S: 1, M: 1, L: 1, XL: 0, XXL: 0 }; debeRechazar(d, {}, 'stock', 'XXL'); });
caso('extra: slug duplicado', () => { const d = copia(); prd(d, 'prd-0002').slug = prd(d, 'prd-0001').slug; debeRechazar(d, {}, 'slug_duplicado'); });
caso('extra: token de GitHub (github_pat_ y ghp_) en artículo y sitio', () => {
  const d = copia(); d.articles.articulos[1].bloques[0].texto += ' github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz';
  debeRechazar(d, {}, 'secreto', 'articles');
  const d2 = copia(); d2.site.anuncio = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB'; debeRechazar(d2, {}, 'secreto', 'site');
  const d3 = copia(); d3.site.envio += ' https://api.telegram.org/bot123456789:ABC/getUpdates'; debeRechazar(d3, {}, 'secreto', 'site');
});
caso('extra: número de WhatsApp de ejemplo (D13)', () => { const d = copia(); d.site.whatsapp = '51900000000'; d.site.telefono_visible = '+51 900 000 000'; debeRechazar(d, {}, 'whatsapp', 'ejemplo'); });
caso('extra: telefono_visible no coincide con whatsapp', () => { const d = copia(); d.site.telefono_visible = '+51 999 111 222'; debeRechazar(d, {}, 'whatsapp', 'telefono_visible'); });
caso('extra: red social con dominio ajeno o userinfo engañoso', () => {
  const d = copia(); d.site.redes = [{ red: 'instagram', url: 'https://instagram.com@evil.example/x' }]; debeRechazar(d, {}, 'enlace', 'site.redes[0]');
  const d2 = copia(); d2.site.redes = [{ red: 'facebook', url: 'https://evil.example/palmera' }]; debeRechazar(d2, {}, 'enlace', 'no corresponde a facebook');
  const d3 = copia(); d3.site.redes = [{ red: 'tiktok', url: 'http://www.tiktok.com/@palmerabrava' }]; debeRechazar(d3, {}, 'enlace', 'site.redes[0]');
});
caso('extra: mapa embebido de un dominio no permitido', () => { const d = copia(); d.site.mapa.embed = 'https://evil.example/export/embed.html'; debeRechazar(d, {}, 'enlace', 'site.mapa.embed'); });
caso('extra: lookbook cita un producto inexistente', () => { const d = copia(); d.site.lookbook[0].productos.push('prd-0777'); debeRechazar(d, {}, 'referencia', 'prd-0777'); });
caso('extra: bloque de artículo con tipo inventado o HTML', () => {
  const d = copia(); d.articles.articulos[0].bloques.push({ tipo: 'html', texto: 'hola' }); debeRechazar(d, {}, 'esquema', 'no coincide con ningún tipo');
  const d2 = copia(); d2.articles.articulos[0].bloques.push({ tipo: 'parrafo', texto: 'x', extra: 1 }); debeRechazar(d2, {}, 'esquema', 'campo no permitido "extra"');
});
caso('extra: el campo "nuevo" ya no existe en el esquema', () => { const d = copia(); prd(d, 'prd-0001').nuevo = true; debeRechazar(d, {}, 'esquema', '"nuevo"'); });
caso('extra: fecha con formato inválido y fecha_actualizacion anterior a creación', () => {
  const d = copia(); prd(d, 'prd-0001').fecha_creacion = '06/10/2026'; debeRechazar(d, {}, 'esquema', '.fecha_creacion');
  const d2 = copia(); prd(d2, 'prd-0002').fecha_actualizacion = '2026-01-01T00:00:00-05:00'; debeRechazar(d2, {}, 'fecha', 'prd-0002');
});
caso('extra: más de 100 borradores_aplicados', () => {
  const d = copia(); d.products.borradores_aplicados = Array.from({ length: 101 }, (_, i) => 'drf-' + String(100000 + i)); debeRechazar(d, {}, 'esquema', 'borradores_aplicados');
});
caso('extra: horario que abre después de cerrar', () => { const d = copia(); d.site.horario.tramos[0].abre = '21:00'; debeRechazar(d, {}, 'horario'); });
caso('extra: imagen en placeholders con origen distinto de placeholder', () => {
  const d = copia(); prd(d, 'prd-0001').imagenes[0].src = 'assets/img/placeholders/camisa.svg'; debeRechazar(d, {}, 'imagen_ruta', 'prd-0001');
});
caso('extra: JSON corrupto (texto) se rechaza sin lanzar excepción', () => {
  const r = V.validar({ products: '{"productos": [ {"id": "prd-0001", ', articles: BASE.articles, site: BASE.site }, {});
  afirmar(!r.ok && r.errores.some((e) => e.indexOf('[json] products') === 0), 'debía dar [json]: ' + r.errores.join(' | '));
});
caso('extra: sin documentos', () => { const r = V.validar({}, {}); afirmar(!r.ok && r.errores[0].indexOf('[entrada]') === 0, 'debía dar [entrada]'); });

console.log('3) Límites de daño, lotes y roles (con "anterior")');
caso('editar el precio de 1 producto dentro del lote pasa', () => {
  const d = copia(); const p = prd(d, 'prd-0003'); p.precio = 45.90; p.fecha_actualizacion = '2026-10-06T07:00:00-05:00';
  d.products.version = 2; d.products.borradores_aplicados = ['drf-mg2x9k3l7f'];
  debePasar(d, { anterior: copia(), idsLote: ['prd-0003'], rol: 'marketing' });
});
caso('un cambio fuera del lote se rechaza', () => {
  const d = copia(); prd(d, 'prd-0003').precio = 45.90; prd(d, 'prd-0004').precio = 10;
  debeRechazar(d, { anterior: copia(), idsLote: ['prd-0003'] }, 'fuera_de_lote', 'prd-0004');
});
caso('cambiar site.json sin "site" en el lote se rechaza', () => { const d = copia(); d.site.lema = 'Otro lema'; debeRechazar(d, { anterior: copia(), idsLote: ['prd-0001'] }, 'fuera_de_lote', 'site'); });
caso('borrar 1 producto (admin) pasa; ocultar 2 de golpe se rechaza', () => {
  const d = copia(); d.products.productos = d.products.productos.filter((p) => p.id !== 'prd-0014');
  debePasar(d, { anterior: copia(), idsLote: ['prd-0014'], rol: 'admin' });
  const d2 = copia(); prd(d2, 'prd-0014').activo = false; prd(d2, 'prd-0011').activo = false;
  debeRechazar(d2, { anterior: copia(), idsLote: ['prd-0014', 'prd-0011'] }, 'borrado_masivo', 'activos');
});
caso('marketing no puede borrar, cambiar WhatsApp ni ejecutar /limpiar_muestras', () => {
  const d = copia(); d.products.productos = d.products.productos.filter((p) => p.id !== 'prd-0014');
  debeRechazar(d, { anterior: copia(), idsLote: ['prd-0014'], rol: 'marketing' }, 'permiso', 'no puede borrar');
  const d2 = copia(); d2.site.whatsapp = '51987000111'; d2.site.telefono_visible = '+51 987 000 111';
  debeRechazar(d2, { anterior: copia(), idsLote: ['site'], rol: 'marketing' }, 'permiso', 'WhatsApp');
  debeRechazar(copia(), { anterior: copia(), permitirLimpieza: true, rol: 'marketing' }, 'permiso', 'limpiar_muestras');
  const d3 = copia(); d3.site.lookbook[0].titulo = 'Nuevo título';
  debePasar(d3, { anterior: copia(), idsLote: ['site'], rol: 'marketing' });
});
caso('el dueño sí puede cambiar el WhatsApp (queda aviso de confirmación especial)', () => {
  const d = copia(); d.site.whatsapp = '51987000111'; d.site.telefono_visible = '+51 987 000 111';
  const r = debePasar(d, { anterior: copia(), idsLote: ['site'], rol: 'dueno' });
  afirmar(r.avisos.some((a) => a.indexOf('[whatsapp_cambio]') === 0), 'debía avisar del cambio de WhatsApp');
});
caso('/limpiar_muestras legítimo: quita las 16 muestras (deja prd-0017, real) y limpia las referencias', () => {
  const d = copia(); const ids = d.products.productos.filter((p) => p.muestra).map((p) => p.id);
  d.products.productos = d.products.productos.filter((p) => !p.muestra);
  d.articles.articulos.forEach((a) => { a.productos_relacionados = []; a.bloques = a.bloques.filter((b) => b.tipo !== 'producto'); });
  d.site.lookbook.forEach((l) => { l.productos = []; });
  debeRechazar(d, { anterior: copia(), idsLote: ids.concat(['art-0001', 'art-0002', 'art-0003', 'site']) }, 'borrado_masivo');
  debePasar(d, { anterior: copia(), idsLote: ids.concat(['art-0001', 'art-0002', 'art-0003', 'site']), permitirLimpieza: true, rol: 'dueno' });
});
caso('/limpiar_muestras no puede quitar un producto real', () => {
  const ant = copia(); const p = prd(ant, 'prd-0014'); p.muestra = false; p.imagenes = [{ src: 'assets/img/products/gorro-pescador-1-a1b2c3d4.webp', alt: 'Foto real del gorro pescador', origen: 'foto' }];
  const d = JSON.parse(JSON.stringify(ant)); d.products.productos = d.products.productos.filter((x) => x.id !== 'prd-0014' && x.id !== 'prd-0008');
  debeRechazar(d, { anterior: ant, permitirLimpieza: true, rol: 'admin' }, 'limpieza', 'prd-0014');
});
caso('un producto real no puede volver a ser muestra, ni cambiar su fecha_creacion', () => {
  const ant = copia(); const p = prd(ant, 'prd-0014'); p.muestra = false; p.imagenes = [];
  const d = JSON.parse(JSON.stringify(ant)); prd(d, 'prd-0014').muestra = true;
  debeRechazar(d, { anterior: ant, idsLote: ['prd-0014'] }, 'muestra', 'prd-0014');
  const d2 = JSON.parse(JSON.stringify(ant)); prd(d2, 'prd-0014').fecha_creacion = '2026-10-01T10:00:00-05:00';
  debeRechazar(d2, { anterior: ant, idsLote: ['prd-0014'] }, 'fecha', 'fecha_creacion');
});
caso('un producto real con foto propia pasa (y sin imagen solo deja aviso)', () => {
  const d = copia(); const nuevo = JSON.parse(JSON.stringify(prd(d, 'prd-0014')));
  Object.assign(nuevo, { id: 'prd-0018', slug: 'polo-real-de-prueba', nombre: 'Polo real de prueba', muestra: false, imagenes: [{ src: 'assets/img/products/polo-real-de-prueba-1-0a1b2c3d.webp', alt: 'Foto real del polo de prueba', origen: 'foto', ancho: 1200, alto: 1500 }] });
  d.products.productos.push(nuevo);
  debePasar(d, { anterior: copia(), idsLote: ['prd-0018'], rol: 'marketing' });
  nuevo.imagenes = [];
  const r = debePasar(d, {});
  afirmar(r.avisos.some((a) => a.indexOf('[sin_imagen]') === 0), 'debía avisar sin_imagen');
});

console.log('4) Bloque "COPIAR A N8N" aislado (como un nodo Code)');
caso('el bloque corre sin require/module/process y valida', () => {
  const src = fs.readFileSync(path.join(__dirname, 'validar.js'), 'utf8');
  const fuente = src.replace(/\r\n/g, '\n');
  const ini = fuente.indexOf('\n// === COPIAR A N8N ===\n');
  const fin = fuente.indexOf('\n// === FIN COPIAR A N8N ===\n');
  afirmar(src.split('// === COPIAR A N8N ===').length === 2, 'el marcador de inicio debe aparecer una sola vez');
  afirmar(ini > 0 && fin > ini, 'no se encontraron los marcadores');
  const bloque = fuente.slice(ini, fin);
  afirmar(!/\brequire\s*\(|\bprocess\.|\bBuffer\b|module\.exports/.test(bloque), 'el bloque usa require/process/Buffer/module');
  const n8n = 'const $json = { products: DOCS.products, articles: DOCS.articles, site: DOCS.site };\n' +
    'const r = validar({ products: $json.products, articles: $json.articles, site: $json.site }, {});\n' +
    'const r2 = validarOperacion(OP, { texto: "Polo para dama talla M a 39.90", productos: $json.products.productos });\n' +
    '[{ json: r }, { json: r2 }];';
  const ctx = { DOCS: copia(), OP: { op: 'crear', entidad: 'producto', id: null, campos: { nombre: 'Polo de algodón', categoria: 'hombres', subcategoria: 'polos', precio: 39.9, precio_oferta: null, tallas: ['M'], stock_tallas: [], colores: ['blanco'], material: null, descripcion: null, etiquetas: [], alt_imagen: null, destacado: null }, campos_inferidos: ['categoria'], faltantes: [] } };
  const salida = vm.runInNewContext(bloque + '\n' + n8n, ctx, { timeout: 5000 });
  afirmar(salida[0].json.ok === true, 'validar() falló dentro del sandbox: ' + JSON.stringify(salida[0].json.errores));
  afirmar(salida[1].json.operacion.campos.categoria === 'mujeres', 'validarOperacion debía corregir la categoría a mujeres');
});

console.log('5) Esquemas publicados sincronizados');
caso('data/schema/*.json coincide con tools/validar.js', () => {
  const pares = { 'products.schema.json': V.ESQUEMAS.products, 'articles.schema.json': V.ESQUEMAS.articles, 'site.schema.json': V.ESQUEMAS.site, 'chat.schema.json': V.ESQUEMAS.chat,
    'frescura-materiales.json': V.FRESCURA_PUBLICA, 'ollama-format-producto.json': V.ESQUEMA_LLM_PRODUCTO, 'ollama-format-articulo.json': V.ESQUEMA_LLM_ARTICULO };
  for (const f of Object.keys(pares)) {
    const disco = fs.readFileSync(path.join(RAIZ, 'data', 'schema', f), 'utf8').replace(/\r\n/g, '\n');
    afirmar(disco === V.serializar(pares[f]), f + ' está desactualizado: ejecuta node tools/validar.js --escribir-esquemas');
  }
});
caso('cada JSON de data/ apunta a su esquema y pesa menos de 1 MB', () => {
  for (const n of ['products', 'articles', 'site']) {
    afirmar(BASE[n].$schema === './schema/' + n + '.schema.json', n + '.$schema incorrecto');
    afirmar(fs.statSync(path.join(RAIZ, 'data', n + '.json')).size < V.LIMITE_BYTES, n + '.json pesa 1 MB o más');
    afirmar(BASE[n].schema_version === V.SCHEMA_VERSION, n + '.schema_version debe ser ' + V.SCHEMA_VERSION);
  }
  afirmar(fs.statSync(path.join(RAIZ, 'data', 'chat.json')).size < 4096, 'chat.json debe ser pequeño');
});

console.log('6) Ayudas para WF3/WF4 (LLM, categorías, permisos)');
caso('inferirCategoria aplica las reglas de CONTRATO.md', () => {
  const tabla = {
    'Polo para dama talla M': 'mujeres', 'blusa de señora': 'mujeres', 'Camisa de lino para caballero': 'hombres', 'bermuda de varón': 'hombres',
    'vestido para niña talla 6': 'ninos', 'enterizo de bebé': 'ninos', 'polo infantil UV': 'ninos', 'gorro UV para niños': 'ninos',
    'gorra de dama': 'accesorios', 'sombrero de palma': 'accesorios', 'lentes de sol': 'accesorios', 'sandalias de cuero unisex': 'accesorios',
    'bolso de yute': 'accesorios', 'sandalias para dama': 'mujeres', 'polo para el calor': null, 'camisa de lino': null, 'polo unisex hombre y mujer': null
  };
  for (const t of Object.keys(tabla)) afirmar(V.inferirCategoria(t) === tabla[t], '"' + t + '" dio ' + V.inferirCategoria(t) + ', se esperaba ' + tabla[t]);
});
caso('permisos por rol', () => {
  afirmar(V.puede('admin', 'whatsapp') && V.puede('dueno', 'limpiar_muestras'), 'admin/dueno lo pueden todo');
  for (const a of ['whatsapp', 'limpiar_muestras', 'borrar', 'deshacer', 'pausa']) afirmar(!V.puede('marketing', a), 'marketing no debe poder ' + a);
  for (const a of ['crear', 'actualizar', 'stock', 'agregar_imagen', 'publicar', 'imagen', 'articulo', 'desactivar']) afirmar(V.puede('marketing', a), 'marketing debe poder ' + a);
  afirmar(!V.puede('desconocido', 'consulta') && !V.puede(undefined, 'crear'), 'un rol desconocido no puede nada');
});
caso('validarOperacion: faltantes, ids y oferta', () => {
  const base = { op: 'crear', entidad: 'producto', id: null, campos: { nombre: 'Vestido de lino', categoria: 'mujeres', subcategoria: 'vestidos', precio: null, precio_oferta: null, tallas: [], stock_tallas: [], colores: [], material: 'Lino', descripcion: null, etiquetas: [], alt_imagen: null, destacado: null }, campos_inferidos: [], faltantes: [] };
  const r = V.validarOperacion(base, { texto: 'vestido de lino', hayFoto: true });
  afirmar(r.ok && ['precio', 'tallas', 'colores'].every((f) => r.faltantes.indexOf(f) >= 0), 'debía pedir precio, tallas y colores: ' + JSON.stringify(r));
  const r2 = V.validarOperacion(Object.assign({}, base, { op: 'actualizar', id: 'prd-0999', campos: Object.assign({}, base.campos, { precio: 50 }) }), { productos: BASE.products.productos });
  afirmar(!r2.ok && r2.errores.some((e) => e.indexOf('no existe') >= 0), 'debía rechazar un id inexistente');
  const r3 = V.validarOperacion(Object.assign({}, base, { campos: Object.assign({}, base.campos, { precio: 50, precio_oferta: 60 }) }), {});
  afirmar(!r3.ok && r3.errores.some((e) => e.indexOf('[precio_oferta]') === 0), 'debía rechazar oferta >= precio');
  const r4 = V.validarOperacion(Object.assign({}, base, { op: 'eliminar_definitivo' }), {});
  afirmar(!r4.ok && r4.errores[0].indexOf('[llm]') === 0, 'eliminar_definitivo no es una op del LLM');
  const r5 = V.validarOperacion('{no es json', {});
  afirmar(!r5.ok, 'texto no JSON debía fallar');
});

caso('validarOperacion: normaliza por op, corrige "actualizar" sin id y fija stock_modo', () => {
  const vacios = { nombre: null, categoria: null, subcategoria: null, precio: null, precio_oferta: null, tallas: [], stock_tallas: [], stock_modo: null, colores: [], material: null, descripcion: null, etiquetas: [], alt_imagen: null, destacado: null };
  const mk = (op, id, campos, extra) => Object.assign({ op, entidad: 'producto', id, campos: Object.assign({}, vacios, campos), campos_inferidos: [], faltantes: [] }, extra || {});
  const P = BASE.products.productos;
  // desactivar: el LLM rellenó campos del catálogo -> se vacían
  const r1 = V.validarOperacion(mk('desactivar', 'prd-0014', { nombre: 'Gorro pescador de algodón', precio: 29.9, categoria: 'accesorios' }), { texto: 'oculta el prd-0014', productos: P });
  afirmar(r1.ok && r1.operacion.campos.precio === null && r1.operacion.campos.nombre === null, 'desactivar debía vaciar los campos');
  // stock sin modo -> fijar + aviso
  const r2 = V.validarOperacion(mk('stock', 'prd-0005', { stock_tallas: [{ talla: 'L', cantidad: 2 }], precio: 109.9 }), { texto: 'quedan 2 de la L del prd-0005', productos: P });
  afirmar(r2.ok && r2.operacion.campos.stock_modo === 'fijar' && r2.operacion.campos.precio === null, 'stock debía fijar modo y vaciar precio');
  // actualizar sin id ni verbo en el texto -> crear + reintentar
  const r3 = V.validarOperacion(mk('actualizar', 'prd-0005', { precio: 120, precio_oferta: 99 }, { faltantes: ['id'] }), { texto: 'Vestido de lino a 120 con oferta a 99', productos: P });
  afirmar(r3.operacion.op === 'crear' && r3.operacion.id === null && r3.reintentar === 'crear', 'debía corregirse a crear');
  afirmar(r3.avisos.some((a) => a.indexOf('[op_corregida]') === 0) && r3.faltantes.indexOf('id') < 0, 'aviso op_corregida y sin "id" en faltantes');
  // actualizar con verbo: se queda, y se quitan los campos que no cambian
  const r4 = V.validarOperacion(mk('actualizar', 'prd-0003', { precio: 45, nombre: 'Polo de algodón pima', categoria: 'hombres' }), { texto: 'cambia el precio del polo pima a 45', productos: P });
  afirmar(r4.operacion.op === 'actualizar' && r4.operacion.campos.precio === 45 && r4.operacion.campos.nombre === null && r4.operacion.campos.categoria === null, 'actualizar debía conservar solo el precio');
  afirmar(r4.avisos.some((a) => a.indexOf('[id_inferido]') === 0), 'debía avisar que el id no se mencionó');
  afirmar(V.pideCambio('llegaron 5 de la M') && V.pideCambio('ya no hay el gorro') && !V.pideCambio('Polo para dama S M L a 35'), 'pideCambio');
});

caso('cuerpoOllama arma la petición D4 (format, think:false, catálogo, keep_alive 0, reintento)', () => {
  const b = V.cuerpoOllama({ texto: 'Polo para dama a 35', productos: BASE.products.productos, imagenesBase64: ['AAAA'], keepAlive: 0 });
  afirmar(b.think === false && b.stream === false && b.keep_alive === 0 && b.options.num_ctx === 8192, 'opciones D3/D4');
  afirmar(b.format === V.ESQUEMA_LLM_PRODUCTO, 'format de producto');
  afirmar(b.messages[0].content.indexOf('prd-0016 | Bolso de yute tejido | accesorios | 39.9') >= 0 && b.messages[0].content.indexOf('{{CATALOGO}}') < 0, 'catálogo en el prompt');
  afirmar(b.messages[1].images[0] === 'AAAA', 'imágenes en el mensaje de usuario');
  const r = V.cuerpoOllama({ tipo: 'articulo', texto: '/articulo calor', reintento: true });
  afirmar(r.format === V.ESQUEMA_LLM_ARTICULO && r.keep_alive === '2m' && /NUEVO/.test(r.messages[1].content), 'artículo y nota de reintento');
  const art = V.bloquesDesdeLLM([{ tipo: 'parrafo', texto: 'Hola', items: [] }, { tipo: 'lista', texto: '', items: ['a', ''] }, { tipo: 'subtitulo', texto: '', items: [] }]);
  afirmar(art.length === 2 && art[1].items.length === 1 && art[0].texto === 'Hola', 'bloquesDesdeLLM');
  afirmar(V.colorHex('Marrón').hex === '#6B4226' && V.colorHex('tornasol').conocido === false, 'colorHex');
});

console.log('7) Línea de comandos');
caso('CLI: data/ pasa (exit 0) y un archivo corrupto falla (exit 1)', () => {
  const ok = spawnSync(process.execPath, [path.join(__dirname, 'validar.js'), 'data/products.json', 'data/articles.json', 'data/site.json', 'data/chat.json'], { cwd: RAIZ, encoding: 'utf8' });
  afirmar(ok.status === 0, 'exit ' + ok.status + '\n' + ok.stdout + ok.stderr);
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pb-'));
  const f = path.join(tmp, 'products.json');
  fs.writeFileSync(f, '{"schema_version": 2, "productos": [');
  const mal = spawnSync(process.execPath, [path.join(__dirname, 'validar.js'), f], { cwd: RAIZ, encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });
  afirmar(mal.status === 1 && mal.stdout.indexOf('[json]') >= 0, 'exit ' + mal.status + '\n' + mal.stdout + mal.stderr);
});

console.log('8) tools/image-prompts.json');
caso('hay un prompt por cada imagen de data/, con el mismo tamaño y reglas de personas', () => {
  const L = JSON.parse(fs.readFileSync(path.join(__dirname, 'image-prompts.json'), 'utf8'));
  afirmar(Array.isArray(L), 'debe ser una lista');
  const usados = [];
  BASE.products.productos.forEach((p) => p.imagenes.forEach((i) => { if (i.origen !== 'foto') usados.push(i); }));
  BASE.articles.articulos.forEach((a) => usados.push(a.portada));
  BASE.site.hero.imagenes.forEach((i) => usados.push(i));
  BASE.site.categorias.forEach((c) => usados.push(c.imagen));
  BASE.site.lookbook.forEach((l) => usados.push(l.imagen));
  const porPath = {};
  L.forEach((x) => { afirmar(!porPath[x.path], 'ruta repetida ' + x.path); porPath[x.path] = x; });
  for (const i of usados) {
    const x = porPath[i.src];
    afirmar(x, 'sin prompt: ' + i.src);
    afirmar(x.size === i.ancho + 'x' + i.alto, 'tamaño distinto en ' + i.src);
  }
  afirmar(L.length === usados.length, 'hay prompts que no usa ningún JSON');
  const seeds = new Set();
  for (const x of L) {
    afirmar(['path', 'size', 'seed', 'prompt'].every((k) => x[k] !== undefined), 'faltan campos en ' + x.path);
    afirmar(Number.isInteger(x.seed) && !seeds.has(x.seed), 'seed repetida o inválida en ' + x.path); seeds.add(x.seed);
    for (const t of [x.size, x.generar]) { const [w, h] = t.split('x').map(Number); afirmar(w % 64 === 0 && h % 64 === 0, 'no múltiplo de 64: ' + x.path); }
    const personas = /adults only/.test(x.prompt);
    afirmar(x.personas === personas, 'marca "personas" incoherente en ' + x.path);
    if (personas) {
      afirmar(/cropped at the neck, no face, no head visible/.test(x.prompt), 'falta "cropped at the neck, no face, no head visible" en ' + x.path);
      afirmar(x.recortar_arriba > 0, 'una imagen con personas debe generarse más alta y recortarse: ' + x.path);
    }
    if (/children|child's|girl's|boy's|kids/i.test(x.prompt)) afirmar(!personas && /No people/.test(x.prompt), 'imagen infantil con personas: ' + x.path);
    if (x.path.indexOf('/products/') > 0) {
      const p = BASE.products.productos.find((q) => q.imagenes.some((i) => i.src === x.path));
      if (p.categoria === 'ninos' || p.categoria === 'accesorios') afirmar(!personas, 'niños y accesorios van sin personas: ' + x.path);
      const img = p.imagenes.find((i) => i.src === x.path);
      if (x.variante_de) {
        const b = porPath[x.variante_de];
        afirmar(b && !b.variante_de, 'variante sin imagen base: ' + x.path);
        afirmar(x.color === img.color && img.color !== p.imagenes[0].color, 'color de la variante incoherente: ' + x.path);
        afirmar(x.size === b.size && x.generar === b.generar && x.recortar_arriba === b.recortar_arriba && x.personas === b.personas, 'la variante debe mantener tamaño, recorte y personas: ' + x.path);
        afirmar(x.seed > 10000 && Math.floor(x.seed / 100) === b.seed, 'seed de variante = seed base x 100 + n: ' + x.path);
        afirmar(x.path === 'assets/img/products/' + p.id + '-' + V.slugificar(x.color) + '.webp', 'ruta de variante: ' + x.path);
      }
    }
  }
});

console.log('9) Contrato v2 (frescura, stock por color, imágenes por color, guía de tallas, chat)');
caso('v2: datos completos (frescura, stock_por_color 0..20, una foto por color, 2–3 colores en referencias)', () => {
  let agotados = 0;
  for (const p of BASE.products.productos) {
    afirmar(Number.isInteger(p.frescura) && p.frescura >= 1 && p.frescura <= 5, p.id + ' sin frescura');
    afirmar(p.stock_por_color && p.stock_por_talla === undefined, p.id + ': stock_por_color es la fuente de verdad (sin stock_por_talla)');
    const nombres = p.colores.map((c) => c.nombre);
    afirmar(Object.keys(p.stock_por_color).join('|') === nombres.join('|'), p.id + ': claves de stock_por_color = colores');
    Object.values(p.stock_por_color).forEach((n) => { afirmar(Number.isInteger(n) && n >= 0 && n <= 20, p.id + ': stock fuera de 0..20'); if (n === 0) agotados++; });
    afirmar(p.stock === V.stockTotal(p), p.id + ': stock = suma');
    afirmar(p.imagenes.every((i) => nombres.indexOf(i.color) >= 0), p.id + ': cada imagen con color');
    afirmar(nombres.every((n) => p.imagenes.some((i) => i.color === n)), p.id + ': una imagen por color');
    if (p.muestra) afirmar(nombres.length >= 2 && nombres.length <= 3, p.id + ': un producto de referencia debe tener 2–3 colores');
  }
  afirmar(agotados >= 3, 'al menos 3 colores agotados (hay ' + agotados + ')');
  const p17 = prd(BASE, 'prd-0017');
  afirmar(p17.frescura === 5 && p17.stock_por_color.Blanco >= 0, 'prd-0017: frescura 5 (lino) y stock de Blanco');
});
caso('v2: frescura fuera de rango o no entera se rechaza', () => {
  for (const v of [0, 6, 3.5, '4']) { const d = copia(); prd(d, 'prd-0001').frescura = v; debeRechazar(d, {}, 'esquema', '.frescura'); }
});
caso('v2: stock_por_color mayor que 20, negativo o decimal se rechaza', () => {
  for (const v of [21, -1, 2.5]) { const d = copia(); const p = prd(d, 'prd-0001'); p.stock_por_color.Arena = v; debeRechazar(d, {}, 'esquema', 'stock_por_color'); }
});
caso('v2: stock_por_color con un color que no existe, o sin un color, se rechaza', () => {
  const d = copia(); const p = prd(d, 'prd-0001'); p.stock_por_color.Negro = 1; p.stock += 1; debeRechazar(d, {}, 'stock', '"Negro"');
  const d2 = copia(); const p2 = prd(d2, 'prd-0001'); p2.stock -= p2.stock_por_color.Arena; delete p2.stock_por_color.Arena; debeRechazar(d2, {}, 'stock', 'falta el color "Arena"');
  const d3 = copia(); prd(d3, 'prd-0001').stock = 99; debeRechazar(d3, {}, 'stock', 'suma de stock_por_color');
  const d4 = copia(); delete prd(d4, 'prd-0001').stock_por_color; debeRechazar(d4, {}, 'stock', 'falta stock_por_color');
});
caso('v2: regla de stock coherente (v1 sigue valiendo; con ambos manda stock_por_color)', () => {
  const d = copia(); const p = prd(d, 'prd-0001'); delete p.stock_por_color; p.stock_por_talla = { S: 3, M: 5, L: 4, XL: 2 }; p.stock = 14;
  const r = debePasar(d, {}); afirmar(r.avisos.some((a) => a.indexOf('[stock_color]') === 0), 'aviso de formato v1');
  const d2 = copia(); const p2 = prd(d2, 'prd-0001'); p2.stock_por_talla = { S: 1, M: 1, L: 0, XL: 0 }; debePasar(d2, {});
  afirmar(V.stockTotal(p2) === p2.stock && p2.stock === 19, 'stockTotal usa stock_por_color');
});
caso('v2: imagenes[].color que no está en colores se rechaza; color sin foto solo avisa', () => {
  const d = copia(); prd(d, 'prd-0001').imagenes[0].color = 'Rojo'; debeRechazar(d, {}, 'imagen_color', 'prd-0001');
  const d2 = copia(); const p = prd(d2, 'prd-0001'); p.imagenes = p.imagenes.slice(0, 1);
  const r = debePasar(d2, {}); afirmar(r.avisos.some((a) => a.indexOf('[imagen_color]') === 0 && a.indexOf('Blanco hueso') > 0), 'aviso color sin foto');
  const d3 = copia(); prd(d3, 'prd-0001').colores[1].nombre = 'ARENA'; debeRechazar(d3, {}, 'color_duplicado', 'prd-0001');
});
caso('v2: chat.json solo acepta https://*.trycloudflare.com o vacío', () => {
  const bien = copia(); bien.chat = { url: 'https://seasonal-deck-organisms-sf.trycloudflare.com', activo: true, actualizado: '2026-10-07T06:00:00-05:00' }; debePasar(bien, {});
  for (const u of ['https://evil.example.com', 'http://abc.trycloudflare.com', 'https://abc.trycloudflare.com.evil.io', 'https://a.b.trycloudflare.com',
    'https://abc.trycloudflare.com/chat', 'javascript:alert(1)', 'https://ABC.trycloudflare.com']) {
    const d = copia(); d.chat = { url: u, activo: true, actualizado: '2026-10-07T06:00:00-05:00' }; debeRechazar(d, {}, 'esquema', 'chat.url');
  }
  const d2 = copia(); d2.chat = { url: '', activo: true, actualizado: '' }; debeRechazar(d2, {}, 'chat', 'chat.url');
  const d3 = copia(); d3.chat = { url: '', activo: false, actualizado: 'ayer' }; debeRechazar(d3, {}, 'esquema', 'chat.actualizado');
  const d4 = copia(); d4.chat = { url: '', activo: false, actualizado: '', extra: 1 }; debeRechazar(d4, {}, 'esquema', 'campo no permitido');
  const d5 = copia(); d5.chat = { url: 'https://abc.trycloudflare.com', activo: true, actualizado: '2026-10-07T06:00:00-05:00' };
  debeRechazar(d5, { anterior: copia(), idsLote: ['site'] }, 'fuera_de_lote', 'chat');
  debePasar(d5, { anterior: copia(), idsLote: ['chat'] });
  debeRechazar(d5, { anterior: copia(), idsLote: ['chat'], rol: 'marketing' }, 'permiso', 'chat');
});
caso('v2: site sin avisos de muestra y con guía de tallas válida', () => {
  afirmar(BASE.site.aviso_muestra === undefined && BASE.site.aviso_ia === undefined && BASE.site.mensajes.consulta_muestra === undefined, 'quedan avisos de muestra en site.json');
  const d = copia(); d.site.aviso_muestra = 'Catálogo de muestra'; debeRechazar(d, {}, 'esquema', 'aviso_muestra');
  const d2 = copia(); d2.site.guia_tallas.tablas[0].filas[0].push('extra'); debeRechazar(d2, {}, 'guia_tallas', 'celdas');
  const d3 = copia(); d3.site.guia_tallas.tablas[0].medidas.push('pie'); d3.site.guia_tallas.como_medir = d3.site.guia_tallas.como_medir.filter((c) => c.id !== 'pie');
  debeRechazar(d3, {}, 'guia_tallas', 'como_medir');
  const d4 = copia(); delete d4.site.guia_tallas; debeRechazar(d4, {}, 'esquema', 'guia_tallas');
  const d5 = copia(); d5.site.guia_tallas.tablas[1].id = d5.site.guia_tallas.tablas[0].id; debeRechazar(d5, {}, 'id_duplicado', 'guia_tallas');
  const d6 = copia(); d6.site.guia_tallas.consejo_calor = 'Usa ropa holgada'; debeRechazar(d6, { anterior: copia(), idsLote: ['site'], rol: 'marketing' }, 'permiso', 'site');
  const G = BASE.site.guia_tallas;
  const tabla = (id) => V.tablaDeTallas(G, prd(BASE, id)).id;
  afirmar(tabla('prd-0001') === 'hombres-polos-camisas' && tabla('prd-0004') === 'hombres-shorts-pantalones' && tabla('prd-0005') === 'mujeres-blusas-vestidos' &&
    tabla('prd-0007') === 'mujeres-shorts-pantalones' && tabla('prd-0012') === 'ninos-por-edad' && tabla('prd-0013') === 'accesorios-sombreros' &&
    tabla('prd-0015') === 'accesorios-sandalias' && tabla('prd-0016') === 'accesorios-sombreros', 'tablaDeTallas elige la tabla correcta');
  for (const c of V.CATEGORIAS) afirmar(G.tablas.some((t) => t.categoria === c), 'falta tabla para ' + c);
  const ninos = G.tablas.find((t) => t.categoria === 'ninos');
  afirmar(['2', '4', '6', '8', '10', '12', '14'].every((t) => ninos.filas.some((f) => f[0] === t)), 'niños por edad de 2 a 14');
});
caso('v2: tabla única de frescura por material (frescuraPorMaterial / inferirFrescura)', () => {
  const tabla = {
    'Lino 100%': 5, 'lino': 5, 'Lino 55%, algodón 45%': 5, 'lino-algodón': 5, 'Gasa de algodón 100%': 5, 'Fibra de palma natural': 5,
    'Algodón pima 100%': 4, 'Algodón 100%': 4, 'bambú': 4, 'Viscosa 100%': 4, 'rayón': 4,
    'Algodón 60% poliéster 40%': 3, 'dri-fit': 3, 'Poliéster con UPF 50+': 3, 'Poliéster 85%, elastano 15% (UPF 50+)': 3, 'Drill de algodón 100%': 3,
    'Denim': 2, 'drill grueso': 2, 'Poliéster pesado': 1, 'Cuero y planta de caucho': 1, 'felino': null, '': null
  };
  for (const t of Object.keys(tabla)) afirmar(V.frescuraPorMaterial(t) === tabla[t], '"' + t + '" dio ' + V.frescuraPorMaterial(t) + ', se esperaba ' + tabla[t]);
  afirmar(V.frescuraPorMaterial(null) === null, 'null');
  const i1 = V.inferirFrescura({ material: null, nombre: 'Polo de lino para hombre' });
  afirmar(i1.valor === 5 && i1.fuente === 'nombre', 'inferirFrescura por nombre');
  afirmar(V.inferirFrescura({ frescura: 2, material: 'Lino' }).fuente === 'dato', 'el dato guardado manda');
  const pub = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data', 'schema', 'frescura-materiales.json'), 'utf8'));
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const web = (s) => { for (const f of pub.tabla) if (new RegExp(f.patron).test(norm(s))) return f.valor; return null; };
  for (const t of Object.keys(tabla)) if (t) afirmar(web(t) === tabla[t], 'la tabla publicada para la web no coincide en "' + t + '"');
});
caso('v2: formato del LLM con frescura y stock_por_color; validarOperacion infiere la frescura y revisa el stock', () => {
  const props = V.ESQUEMA_LLM_PRODUCTO.properties.campos.properties;
  afirmar(props.frescura && props.stock_por_color && V.ESQUEMA_LLM_PRODUCTO.properties.campos.required.indexOf('frescura') >= 0, 'faltan campos en el format');
  const vacios = { nombre: null, categoria: null, subcategoria: null, precio: null, precio_oferta: null, tallas: [], stock_tallas: [], stock_por_color: [], stock_modo: null, colores: [], material: null, frescura: null, descripcion: null, etiquetas: [], alt_imagen: null, destacado: null };
  const mk = (op, id, campos, extra) => Object.assign({ op, entidad: 'producto', id, campos: Object.assign({}, vacios, campos), campos_inferidos: [], faltantes: [] }, extra || {});
  const P = BASE.products.productos;
  // el caso real de prd-0017: lino sin frescura -> 5 (sugerido)
  const r1 = V.validarOperacion(mk('crear', null, { nombre: 'Polo de lino para hombre', categoria: 'hombres', subcategoria: 'polos', precio: 58.9, tallas: ['S', 'M', 'L', 'XL'], colores: ['blanco'], material: 'lino', stock_por_color: [{ color: 'blanco', cantidad: 10 }] }), { texto: 'Polo de lino para hombre S M L XL blanco 10 por color a 58.90', productos: P, hayFoto: true });
  afirmar(r1.ok && r1.operacion.campos.frescura === 5 && r1.operacion.campos_inferidos.indexOf('frescura') >= 0, 'frescura 5 sugerida: ' + JSON.stringify(r1));
  // el LLM propone 2 para lino: manda la tabla
  const r2 = V.validarOperacion(mk('crear', null, { nombre: 'Camisa', categoria: 'hombres', precio: 50, tallas: ['M'], colores: ['blanco'], material: 'Lino 100%', frescura: 2 }, { campos_inferidos: ['frescura'] }), { texto: 'camisa de lino para hombre', productos: P });
  afirmar(r2.operacion.campos.frescura === 5 && r2.avisos.some((a) => a.indexOf('[frescura]') === 0), 'la tabla corrige al LLM');
  // el dueño la dice: se respeta
  const r3 = V.validarOperacion(mk('crear', null, { nombre: 'Camisa', categoria: 'hombres', precio: 50, tallas: ['M'], colores: ['blanco'], material: 'Lino 100%', frescura: 3 }), { texto: 'camisa de lino para hombre frescura 3', productos: P });
  afirmar(r3.operacion.campos.frescura === 3 && r3.operacion.campos_inferidos.indexOf('frescura') < 0, 'frescura dicha por el dueño');
  // stock por color: cantidad > 20 es error; color nuevo en el stock se añade
  const r4 = V.validarOperacion(mk('crear', null, { nombre: 'Polo', categoria: 'hombres', precio: 30, tallas: ['M'], colores: ['blanco'], stock_por_color: [{ color: 'blanco', cantidad: 25 }] }), { texto: 'polo hombre', productos: P });
  afirmar(!r4.ok && r4.errores.some((e) => e.indexOf('0 a 20') > 0), 'stock > 20 por color');
  const r5 = V.validarOperacion(mk('crear', null, { nombre: 'Polo', categoria: 'hombres', precio: 30, tallas: ['M'], colores: ['blanco'], stock_por_color: [{ color: 'blanco', cantidad: 10 }, { color: 'negro', cantidad: 10 }] }), { texto: 'polo hombre', productos: P });
  afirmar(r5.ok && r5.operacion.campos.colores.indexOf('negro') >= 0, 'color del stock añadido a colores');
  // op stock por color sobre un producto existente
  const r6 = V.validarOperacion(mk('stock', 'prd-0001', { stock_por_color: [{ color: 'arena', cantidad: 3 }] }), { texto: 'quedan 3 del arena del prd-0001', productos: P });
  afirmar(r6.ok && r6.operacion.campos.stock_modo === 'fijar', 'stock por color con modo fijar');
  const r7 = V.validarOperacion(mk('stock', 'prd-0001', { stock_por_color: [{ color: 'negro', cantidad: 3 }] }), { texto: 'quedan 3 del negro del prd-0001', productos: P });
  afirmar(!r7.ok && r7.errores.some((e) => e.indexOf('no tiene el color') > 0), 'color inexistente en op stock');
  const r8 = V.validarOperacion(mk('stock', 'prd-0001', {}), { texto: 'cambia el stock del prd-0001', productos: P });
  afirmar(r8.faltantes.indexOf('stock_por_color') >= 0, 'op stock sin cantidades pide stock_por_color');
  // actualizar material: se sugiere la frescura de la tabla
  const r9 = V.validarOperacion(mk('actualizar', 'prd-0003', { material: 'Denim' }), { texto: 'cambia el material del prd-0003 a denim', productos: P });
  afirmar(r9.operacion.campos.frescura === 2 && r9.operacion.campos_inferidos.indexOf('frescura') >= 0, 'actualizar material sugiere frescura');
});
caso('v2: aplicarStockColor (para WF5 y /stock <id> <color> <n>)', () => {
  const p = prd(BASE, 'prd-0001');
  const antes = p.stock_por_color['Blanco hueso'];
  const a = V.aplicarStockColor(p, [{ color: 'blanco hueso', cantidad: 3 }], 'sumar');
  afirmar(a.ok && a.stock_por_color['Blanco hueso'] === antes + 3 && a.stock === p.stock + 3 && a.cambios[0] === 'Blanco hueso=' + (antes + 3), 'sumar');
  afirmar(p.stock_por_color['Blanco hueso'] === antes, 'no modifica el producto');
  afirmar(V.aplicarStockColor(p, [{ color: 'Blanca Hueso', cantidad: 0 }], 'fijar').stock_por_color['Blanco hueso'] === 0, 'femenino y mayúsculas');
  afirmar(!V.aplicarStockColor(p, [{ color: 'Arena', cantidad: 99 }], 'restar').ok, 'restar de más');
  afirmar(!V.aplicarStockColor(p, [{ color: 'Arena', cantidad: 15 }], 'sumar').ok, 'pasar de 20');
  afirmar(!V.aplicarStockColor(p, [{ color: 'Arena', cantidad: 21 }], 'fijar').ok, 'fijar más de 20');
  const nuevo = V.aplicarStockColor({ colores: [{ nombre: 'Blanco' }, { nombre: 'Negro' }] }, [{ color: 'blanco', cantidad: 10 }], 'fijar');
  afirmar(nuevo.ok && nuevo.stock_por_color.Blanco === 10 && nuevo.stock_por_color.Negro === 0 && nuevo.stock === 10, 'producto nuevo: colores sin cantidad en 0');
});
caso('v2: el bloque COPIAR A N8N incluye las ayudas nuevas', () => {
  const fuente = fs.readFileSync(path.join(__dirname, 'validar.js'), 'utf8').replace(/\r\n/g, '\n');
  const bloque = fuente.slice(fuente.indexOf('\n// === COPIAR A N8N ===\n'), fuente.indexOf('\n// === FIN COPIAR A N8N ===\n'));
  const ctx = { DOCS: copia() };
  const salida = vm.runInNewContext(bloque + '\n[validar({ chat: DOCS.chat, site: DOCS.site }, {}), frescuraPorMaterial("Lino 100%"), aplicarStockColor(DOCS.products.productos[0], [{ color: "Arena", cantidad: 1 }], "fijar").stock, TABLA_FRESCURA.length, MAX_STOCK_COLOR];', ctx, { timeout: 5000 });
  afirmar(salida[0].ok && salida[1] === 5 && salida[2] === 1 + BASE.products.productos[0].stock_por_color['Blanco hueso'] && salida[3] >= 5 && salida[4] === 20, 'ayudas v2 en el bloque: ' + JSON.stringify(salida[0].errores));
});

console.log('\n' + pasan + ' pruebas OK, ' + fallan + ' fallidas.');
process.exitCode = fallan ? 1 : 0;
