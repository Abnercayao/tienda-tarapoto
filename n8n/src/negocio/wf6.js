//// Config
// @incluir comun
// WF6 sigue aunque falte BOT_TOKEN: la foto va por el nodo Telegram (credencial); el token de pb_config solo se usa para avisos de texto.
return [{ json: armarConfig($input.all().map(function (i) { return i.json; })) }];

//// Preparar
// @incluir validar.js
// @incluir comun
// Entrada: {prompt, objetivo?, chat_id, from_id, rol, origen:"telegram"|"panel", seed?, size? (tamaño FINAL), personas? ("adultos"|"ninguna")}.
// Arma el prompt (mismas frases que admin.html y tools/image-prompts.json, CONTRATO §12) y decide tamaño y recorte:
//   - niños (en el texto) => SIEMPRE sin personas (regla de la tienda), aunque pidan personas;
//   - personas adultas => se genera más alto y se recorta ARRIBA (Edit Image crop) para que no quede ningún rostro.
const cfg = $('Config').first().json;
const e = $('Entrada').first().json || {};
const origen = e.origen === 'panel' ? 'panel' : 'telegram';
const ESTILO = 'Editorial fashion photography for a summer clothing store in Tarapoto, in the Peruvian Amazon. Warm tropical golden light, soft dappled shadows of palm fronds, natural fabric texture clearly visible, color palette of warm sand, palm green, lagoon turquoise, terracotta and mango orange. Sharp focus on the garment, 50mm lens, shallow depth of field, subtle film grain. No text, no letters, no logos, no watermark.';
const SIN_ROSTRO = 'The photo is cropped at the neck, no face, no head visible, adults only: the top edge of the frame cuts across the collarbones, so the chin, mouth and face are completely outside the picture.';
const SIN_PERSONAS = 'No people, no mannequin, no hands, product only.';
const SOLO_PRENDA_NINOS = "Product photo of children's clothing only, laid flat or on a hanger, nobody is wearing it.";
const SIN_NINOS = 'No people, no children, no mannequin, no hands, product only.';
const RE_NINOS = /(ni[ñn][oa]s?\b|infantil|beb[ée]s?\b|\bchild|\bkids?\b|\bboys?\b|\bgirls?\b|toddler|\bbaby\b|escolar|colegial|menor(es)? de edad)/i;
const RE_PERSONAS = /(persona|gente|modelo|mujer|hombre|se[ñn]or|dama|caballero|chic[oa]s?\b|joven|pareja|alguien|adult[oa]|\bwom[ae]n\b|\bm[ae]n\b|\bperson|\bpeople\b|\bmodel\b|\bcouple\b|\blady\b|\bguy\b|\badult)/i;
const RE_ROSTRO = /(\bface\b|portrait|smil|\beyes\b|rostro|\bcara\b|retrato|sonr[ií]|\bojos\b)/i;
// tamaño final -> tamaño a generar con personas y píxeles a recortar arriba (múltiplos de 64)
const ALTO = { '768x1024': ['768x1216', 192], '1344x768': ['1344x1024', 256], '1216x832': ['1216x1088', 256], '1024x1024': ['1024x1216', 192] };
const draftId = 'drf-' + Date.now().toString(36) + (Math.random().toString(36).slice(2) + '00').slice(0, 2);
const base = { valido: false, origen: origen, draft_id: draftId, chat_id: Number(e.chat_id) || 0, from_id: Number(e.from_id) || 0, rol: '', avisar_inicio: false };
const malo = function (motivo) { return [{ json: Object.assign(base, { error: motivo }) }]; };

// Rol recalculado desde AUTORIZADOS (revocar surte efecto al instante). Sin autor válido no hay borrador ni Telegram.
const rol = base.from_id > 0 ? rolDe(cfg, base.from_id) : null;
base.rol = rol || '';
if (origen === 'telegram' && (!rol || base.chat_id <= 0)) return malo('autor no autorizado');
if (rol && !puede(rol, 'imagen')) return malo('tu rol (' + rol + ') no puede usar /imagen');
if (!rol) { base.chat_id = 0; base.from_id = 0; }
const texto = String(e.prompt || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
const nCar = Array.from(texto).length;
if (nCar < 3 || nCar > 1200) return malo('la descripción debe tener entre 3 y 1200 caracteres');

const obj = String(e.objetivo || '').trim().toLowerCase();
const objetivo = /^(art-\d{4,6}|look-\d{1,3})$/.test(obj) ? obj : '';
const final = ALTO[e.size] ? e.size : (/^art-/.test(objetivo) ? '1216x832' : /^look-/.test(objetivo) ? '768x1024' : '1344x768');
const ninos = RE_NINOS.test(texto);
let personas = e.personas === 'adultos' || e.personas === 'ninguna' ? e.personas : (RE_PERSONAS.test(texto) ? 'adultos' : 'ninguna');
const avisos = [];
if (ninos) {
  if (personas === 'adultos') avisos.push('Mencionas niños: se generó solo la prenda, sin personas (regla de la tienda).');
  personas = 'ninguna';
}
if (personas === 'adultos') {
  avisos.push('Persona adulta sin rostro: se generó más alta y se recortó la parte de arriba.');
  if (RE_ROSTRO.test(texto)) avisos.push('La tienda no muestra rostros: se ignoró lo que pedía cara, ojos, sonrisa o retrato.');
}
const generar = personas === 'adultos' ? ALTO[final][0] : final;
const recorte = personas === 'adultos' ? ALTO[final][1] : 0;
const s0 = Number(e.seed);
const seed = Number.isInteger(s0) && s0 >= 1 && s0 <= 2147483646 ? s0 : 1 + Math.floor(Math.random() * 2147483000);
const frase = /[.!?]$/.test(texto) ? texto : texto + '.';
const prompt = (ninos ? [SOLO_PRENDA_NINOS, frase, SIN_NINOS, ESTILO] : [frase, personas === 'adultos' ? SIN_ROSTRO : SIN_PERSONAS, ESTILO]).join(' ');
const extra = { seed: seed, sample_params: { sample_steps: 8, sample_method: 'euler', scheduler: 'simple', guidance: { txt_cfg: 1.0 } } };
const resumido = Array.from(texto).length > 300 ? Array.from(texto).slice(0, 297).join('') + '...' : texto;
const destinos = objetivo ? (/^art-/.test(objetivo) ? 'Hero o Portada de ' + objetivo : 'Hero o Lookbook ' + objetivo) : 'Hero (para Portada usa /imagen art-0001 …; para Lookbook, /imagen look-1 …)';
const caption = 'Imagen referencial generada con IA' + (origen === 'panel' ? ' desde el panel' : '') + ' (borrador ' + draftId + ').\n' +
  'Pedido: ' + h(resumido) + '\n' +
  'Puede ir a: ' + h(destinos) + '\n' +
  (avisos.length ? 'Avisos: ' + h(avisos.join(' ')) + '\n' : '') +
  'Revisa que no haya rostros, niños con personas, texto ni logos.\n' +
  'Siguiente paso: elige dónde usarla (Hero, Portada o Lookbook) o toca Descartar.';
return [{ json: Object.assign(base, {
  valido: true, error: '', texto: texto, objetivo: objetivo, final: final, generar: generar, recorte: recorte, personas: personas, ninos: ninos,
  seed: seed, prompt: prompt, avisos: avisos, caption: caption,
  alt: textoSeguro('Imagen referencial generada con IA: ' + texto, 160),
  avisar_inicio: origen === 'telegram' && base.chat_id > 0 && cfg.BOT_TOKEN !== '',
  cuerpo_sd: { prompt: prompt + ' <sd_cpp_extra_args>' + JSON.stringify(extra) + '</sd_cpp_extra_args>', n: 1, size: generar, output_format: 'webp', output_compression: 80 }
}) }];

//// Aviso generando
// @incluir comun
const p = $('Preparar').first().json;
return [{ json: enviar(p.chat_id, 'Genero la imagen con la IA local (tarda alrededor de 1 min)' + (p.recorte ? '; con persona adulta, sin rostro' : '') + '.\nSiguiente paso: espera la foto y elige Hero, Portada o Lookbook, o toca Descartar.') }];

//// Modelos a liberar
// Ollama y sd-server comparten la GPU: se descargan TODOS los modelos que Ollama tenga cargados (keep_alive:0) y siempre el configurado.
const cfg = $('Config').first().json;
const r = $input.first() ? $input.first().json || {} : {};
const nombres = (Array.isArray(r.models) ? r.models : []).map(function (m) { return String((m && (m.name || m.model)) || ''); })
  .filter(function (n) { return /^[\w.:\/-]{1,120}$/.test(n); });
if (nombres.indexOf(cfg.OLLAMA_MODELO) < 0) nombres.push(cfg.OLLAMA_MODELO);
return nombres.slice(0, 6).map(function (n) { return { json: { cuerpo: { model: n, keep_alive: 0 } } }; });

//// Imagen
// @incluir comun
// Respuesta de sd-server (fullResponse) -> binario. Acepta WebP o PNG (si el servidor ignora output_format, Edit Image lo pasa a WebP).
const p = $('Preparar').first().json;
const r = $input.first() ? $input.first().json || {} : {};
function medidas(b) {
  if (!b || b.length < 30) return null;
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const f = b.toString('ascii', 12, 16);
    if (f === 'VP8X') return { formato: 'webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (f === 'VP8 ') return { formato: 'webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (f === 'VP8L') { const bits = b.readUInt32LE(21); return { formato: 'webp', w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 }; }
    return null;
  }
  if (b.toString('ascii', 1, 4) === 'PNG') return { formato: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  return null;
}
let j = r.body !== undefined ? r.body : r;
if (typeof j === 'string') { try { j = JSON.parse(j); } catch (x) { j = null; } }
const st = Number(r.statusCode) || (j && j.data ? 200 : 0);
const d0 = j && Array.isArray(j.data) && j.data[0] ? j.data[0] : null;
const b64 = d0 && typeof d0.b64_json === 'string' ? d0.b64_json.replace(/^data:[^,]+,/, '') : '';
if (st !== 200 || b64.length < 100) {
  const e = (j && j.error) || r.error || '';
  const det = typeof e === 'string' ? e : (e && (e.message || e.description)) || (st ? 'HTTP ' + st + ' sin imagen' : 'no responde');
  return [{ json: { ok: false, etapa: 'sd', error: censurar('sd-server: ' + det).replace(/\s+/g, ' ').slice(0, 200) } }];
}
const buf = Buffer.from(b64, 'base64');
const m = medidas(buf);
if (!m || buf.length > 8000000) return [{ json: { ok: false, etapa: 'sd', error: 'sd-server devolvió un archivo que no es WebP ni PNG' } }];
const fh = Number(p.final.split('x')[1]);
// Gravedad Sur (igual que admin.html y CONTRATO §12): se conserva la parte de ABAJO; arriba se quitan al menos "recorte" px.
const altoFinal = p.recorte > 0 ? Math.min(fh, m.h - p.recorte) : m.h;
if (altoFinal < 64) return [{ json: { ok: false, etapa: 'recorte', error: 'imagen demasiado baja para recortarla (' + m.w + 'x' + m.h + ')' } }];
const bin = await this.helpers.prepareBinaryData(buf, 'palmera-brava-ia-' + p.seed + '.' + m.formato, 'image/' + m.formato);
return [{ json: {
  ok: true, formato: m.formato, ancho: m.w, alto: m.h, convertir: p.recorte > 0 || m.formato !== 'webp',
  crop_ancho: m.w, crop_alto: altoFinal, crop_y: m.h - altoFinal
}, binary: { data: bin } }];

//// Imagen final
// Comprueba el resultado (WebP y medidas exactas). Con personas, si el recorte no salió, NO se envía la imagen (podría tener rostro).
const p = $('Preparar').first().json;
const im = $('Imagen').first().json;
function medidas(b) {
  if (!b || b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const f = b.toString('ascii', 12, 16);
  if (f === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (f === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (f === 'VP8L') { const bits = b.readUInt32LE(21); return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 }; }
  return null;
}
let buf = null;
try { const it = $input.first(); if (it && it.binary && it.binary.data) buf = await this.helpers.getBinaryDataBuffer(0, 'data'); } catch (x) { buf = null; }
const d = medidas(buf);
const w = im.convertir ? im.crop_ancho : im.ancho;
const hh = im.convertir ? im.crop_alto : im.alto;
if (!d || d.w !== w || d.h !== hh || buf.length > 4000000) {
  return [{ json: { ok: false, etapa: 'recorte', error: 'el recorte o la conversión a WebP no salió (' + (d ? d.w + 'x' + d.h : 'sin imagen') + ', esperaba ' + w + 'x' + hh + ')' } }];
}
const bin = await this.helpers.prepareBinaryData(buf, 'palmera-brava-ia-' + p.seed + '.webp', 'image/webp');
return [{ json: { ok: true, ancho: d.w, alto: d.h, bytes: buf.length, b64: buf.toString('base64') }, binary: { data: bin } }];

//// Foto enviada
// @incluir comun
// Respuesta del nodo Telegram sendPhoto: {ok, result:{message_id}} o {error} (onError: continuar). Su message_id es la vista previa (D2).
const r = $input.first() ? $input.first().json || {} : {};
const mid = r.ok === true && r.result ? Number(r.result.message_id) || 0 : 0;
if (mid > 0) return [{ json: { ok: true, message_id: mid } }];
const e = r.error || r.description || 'sin respuesta';
return [{ json: { ok: false, etapa: 'telegram', error: censurar('Telegram sendPhoto: ' + (typeof e === 'string' ? e : (e.message || e.description || JSON.stringify(e)))).slice(0, 200) } }];

//// Fila borrador
// @incluir comun
// Exactamente las columnas de pb_borradores (Insert con autoMap). destino = null => faltantes ["destino"]: WF5 solo publica
// tras el botón Hero / Portada / Lookbook (dst:) y luego Publicar, del mismo autor y desde esta foto (preview_message_id).
const p = $('Preparar').first().json;
const f = $('Foto enviada').first().json;
const ahora = Date.now();
const campos = { prompt: p.texto, seed: p.seed, size: p.final, generado: p.generar, recorte_arriba: p.recorte, personas: p.personas,
  objetivo: p.objetivo, destino: null, alt: p.alt };
return [{ json: {
  draft_id: p.draft_id, owner_id: p.from_id, rol: p.rol, chat_id: p.chat_id, preview_message_id: f.message_id, origen: p.origen,
  op: 'agregar_imagen', entidad: 'sitio', entidad_id: p.objetivo || 'site', campos: JSON.stringify(campos), campos_inferidos: '[]',
  faltantes: JSON.stringify(['destino']), avisos: JSON.stringify(p.avisos.slice(0, 10)), update_ids: '[]', file_ids: '[]', file_unique_ids: '[]',
  fecha: isoLima(ahora), expira: isoLima(ahora + 86400000), estado: 'pendiente', confirmaciones: 0, confirmaciones_requeridas: 1,
  intentos: 0, error: '', commit_sha: '', texto: p.texto.slice(0, 2000),
  resumen: ('imagen IA ' + (p.objetivo || 'sin objetivo') + ': ' + p.texto).slice(0, 300), fecha_ms: ahora
} }];

//// Fila imagen
// Una fila de pb_imagenes (WebP ya final, A7): WF5 la sube tal cual al elegir el destino y publicar.
const p = $('Preparar').first().json;
const fin = $('Imagen final').first().json;
return [{ json: { draft_id: p.draft_id, n: 1, b64: fin.b64, mime: 'image/webp', ancho: fin.ancho, alto: fin.alto, origen: 'ia_local', alt: p.alt, file_unique_id: '' } }];

//// Error
// @incluir comun
// Un solo lugar para los fallos: pedido inválido, sd-server, recorte y Telegram. Avisa por Telegram (token de pb_config)
// solo si el pedido vino de Telegram; el panel recibe el error en la respuesta de WF8.
const cfg = $('Config').first().json;
const p = $('Preparar').first().json;
const corrio = function (n) { try { return $(n).isExecuted === true; } catch (x) { return false; } };
const de = function (n) { const j = corrio(n) ? $(n).first().json : null; return j && j.ok === false ? j : null; };
const f = de('Foto enviada') || de('Imagen final') || de('Imagen') || { etapa: 'pedido', error: p.error || 'pedido inválido' };
const TEXTOS = {
  pedido: 'No puedo generar esa imagen: ' + h(f.error) + '.\nSiguiente paso: usa /imagen [art-0001|look-1] descripción (3 a 500 caracteres).',
  sd: 'No pude generar la imagen (' + h(f.error) + ').\nSiguiente paso: en la PC de la tienda ejecuta tools\\iniciar-sd-server.bat, espera 1-2 min y repite /imagen.',
  recorte: 'La imagen no se pudo recortar para ocultar rostros, así que no la envío.\nSiguiente paso: repite /imagen (sale con otra semilla).',
  telegram: 'Generé la imagen pero no pude enviarte la foto (' + h(f.error) + ').\nSiguiente paso: revisa en n8n la credencial "Telegram Palmera Brava" (mismo token que pb_config) y repite /imagen.'
};
const avisar = p.origen === 'telegram' && p.chat_id > 0 && cfg.BOT_TOKEN !== '' && (f.etapa !== 'pedido' || p.rol !== '');
return [{ json: Object.assign(enviar(p.chat_id, TEXTOS[f.etapa] || TEXTOS.sd), { etapa: f.etapa, error: f.error, avisar: avisar }) }];

//// Salida
// @incluir comun
// Salida común {ok, draft_id, ...} + binario "data" (WebP final). Para el panel (WF8) va también b64: WF8 rehace el binario en su
// propia ejecución. ok:false nunca pide reintento (cada intento ocupa la GPU ~1 min; el usuario ya recibió el aviso).
const p = $('Preparar').first().json;
const corrio = function (n) { try { return $(n).isExecuted === true; } catch (x) { return false; } };
const fin = corrio('Imagen final') ? $('Imagen final').first() : null;
const err = corrio('Error') ? $('Error').first().json : null;
if (!fin || !fin.json || fin.json.ok !== true) {
  return [{ json: { ok: false, reintentar: false, etapa: err ? err.etapa : 'sd', error: censurar(err ? err.error : 'sin imagen').slice(0, 300) } }];
}
const guardado = corrio('Insertar imagen');
const out = { ok: guardado || p.origen === 'panel', draft_id: guardado ? p.draft_id : '', telegram: guardado, seed: p.seed, tamano: fin.json.ancho + 'x' + fin.json.alto,
  recorte_arriba: p.recorte, personas: p.personas, avisos: p.avisos };
if (!guardado) {
  out.aviso = err ? err.error : 'sin destinatario: nadie en AUTORIZADOS (admin o dueño con id) para recibir la foto en Telegram';
  if (!out.ok) { out.reintentar = false; out.etapa = err ? err.etapa : 'telegram'; out.error = censurar(out.aviso).slice(0, 300); }
}
if (p.origen === 'panel') out.b64 = fin.json.b64;
return [{ json: out, binary: fin.binary }];
