#!/usr/bin/env node
// Palmera Brava — genera las imágenes de muestra con IA local (sd-server de
// Open Generative AI, Z-Image Turbo) a partir de tools/image-prompts.json.
//
// Sin dependencias: Node 18+ (fetch global). Genera EN SERIE (una GPU).
//
// Uso:
//   node tools/generar-imagenes.mjs                 # genera las que faltan
//   node tools/generar-imagenes.mjs --force         # regenera todas
//   node tools/generar-imagenes.mjs --only assets/img/brand/hero-1.webp --force
//   node tools/generar-imagenes.mjs --list          # estado de cada imagen
//   # Probar otra seed sin tocar el repo (candidata para revisar con calma):
//   node tools/generar-imagenes.mjs --only hero-1 --seed 1201 --force --salida %TEMP%\cand
//
// Las imágenes que no pasaron el control de calidad con su seed del JSON se
// regeneran con los AJUSTES_QA de este archivo (ver más abajo y docs/IMAGENES.md).
//
// Opciones:
//   --force              Regenera aunque el archivo exista.
//   --only <ruta|nombre> Solo esa imagen (repetible). Acepta la ruta completa,
//                        el nombre de archivo o el nombre sin extensión.
//   --seed <n>           Sustituye la semilla (solo con un único --only).
//   --extra "<texto>"    Texto añadido al final del prompt (solo con un --only).
//   --prompt "<texto>"   Reemplaza el prompt completo (solo con un --only). Útil
//                        cuando el escenario del prompt original provoca el fallo.
//   --compression <n>    Calidad WebP inicial (por defecto 80).
//   --max-kb <n>         Peso máximo; si se excede baja la calidad (por defecto 250).
//   --retries <n>        Intentos por imagen (por defecto 3).
//   --sd <url>           sd-server (por defecto http://127.0.0.1:1234).
//   --ollama <url>       Ollama (por defecto http://127.0.0.1:11434).
//   --model <nombre>     Modelo de Ollama a descargar de la VRAM (qwen3.5:4b-q4_K_M).
//   --no-unload          No pide a Ollama liberar la VRAM.
//   --container <name>   Contenedor con GraphicsMagick para recortar (n8n).
//   --log <archivo>      Guarda un informe JSON de la ejecución.
//   --salida <carpeta>   Escribe en <carpeta>/<path> en vez de en el repo (para
//                        probar candidatas y revisarlas antes de reemplazar).
//   --sin-ajustes        Usa las seeds/prompts del JSON tal cual (ignora AJUSTES_QA).
//   --dry-run            Muestra lo que haría sin llamar a sd-server.
//   --list               Lista las imágenes y si existen (con su peso).
//
// Recorte: las imágenes con `recortar_arriba > 0` se piden más altas
// (`generar`), en PNG (intermedio sin pérdida), y se recortan por arriba y se
// codifican a WebP con el GraphicsMagick del contenedor n8n, por tubería
// (docker exec -i n8n gm convert png:- ... webp:-). No se escribe nada en el
// volumen del contenedor ni se cambia su configuración. Las demás se piden en
// WebP directo a sd-server (output_format webp, output_compression 80).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROMPTS = path.join(RAIZ, 'tools', 'image-prompts.json');

// ---------- argumentos ----------
function leerArgs(argv) {
  const o = {
    force: false, only: [], seed: null, extra: '', prompt: null, compression: 80, maxKb: 250,
    retries: 3, sd: 'http://127.0.0.1:1234', ollama: 'http://127.0.0.1:11434',
    model: 'qwen3.5:4b-q4_K_M', unload: true, container: 'n8n', log: null,
    salida: null, dryRun: false, list: false, ajustes: true,
  };
  const val = (i, n) => {
    if (i + 1 >= argv.length) throw new Error(`Falta el valor de ${n}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--force': o.force = true; break;
      case '--only': o.only.push(val(i, a)); i++; break;
      case '--seed': o.seed = Number.parseInt(val(i, a), 10); i++; break;
      case '--extra': o.extra = val(i, a); i++; break;
      case '--prompt': o.prompt = val(i, a); i++; break;
      case '--compression': o.compression = Number.parseInt(val(i, a), 10); i++; break;
      case '--max-kb': o.maxKb = Number.parseInt(val(i, a), 10); i++; break;
      case '--retries': o.retries = Number.parseInt(val(i, a), 10); i++; break;
      case '--sd': o.sd = val(i, a).replace(/\/+$/, ''); i++; break;
      case '--ollama': o.ollama = val(i, a).replace(/\/+$/, ''); i++; break;
      case '--model': o.model = val(i, a); i++; break;
      case '--no-unload': o.unload = false; break;
      case '--container': o.container = val(i, a); i++; break;
      case '--log': o.log = val(i, a); i++; break;
      case '--salida': o.salida = path.resolve(val(i, a)); i++; break;
      case '--dry-run': o.dryRun = true; break;
      case '--sin-ajustes': o.ajustes = false; break;
      case '--list': o.list = true; break;
      case '-h': case '--help':
        console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
          .split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
        process.exit(0);
        break;
      default: throw new Error(`Opción desconocida: ${a}`);
    }
  }
  if (o.seed !== null && !Number.isInteger(o.seed)) throw new Error('--seed debe ser un entero');
  if (!(o.compression >= 10 && o.compression <= 100)) throw new Error('--compression entre 10 y 100');
  if (!(o.retries >= 1)) throw new Error('--retries >= 1');
  return o;
}

// ---------- utilidades ----------
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const kb = (n) => Math.round(n / 1024);
const dims = (s) => {
  const m = /^(\d+)x(\d+)$/.exec(String(s || ''));
  if (!m) throw new Error(`Tamaño inválido: ${s}`);
  return { w: Number(m[1]), h: Number(m[2]) };
};

/** Lee ancho/alto de un PNG o WebP (VP8, VP8L, VP8X). */
function medirImagen(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { formato: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') {
      return { formato: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { formato: 'webp', w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      return { formato: 'webp', w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
    }
  }
  return null;
}

function ejecutar(cmd, args, entrada) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    const out = []; const err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${cmd} salió con ${code}: ${Buffer.concat(err).toString().trim().slice(0, 400)}`));
    });
    if (entrada) p.stdin.end(entrada); else p.stdin.end();
  });
}

/** Muestrea la VRAM usada (MiB) con nvidia-smi mientras dura una generación. */
function muestrearVram(intervaloMs = 1000) {
  let pico = null; let vivo = true; let timer = null;
  const tomar = () => execFile('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'],
    { windowsHide: true, timeout: 5000 }, (e, so) => {
      if (e || !vivo) return;
      const v = Number.parseInt(String(so).trim().split(/\r?\n/)[0], 10);
      if (Number.isFinite(v)) pico = Math.max(pico ?? 0, v);
    });
  tomar();
  timer = setInterval(tomar, intervaloMs);
  return () => { vivo = false; clearInterval(timer); return pico; };
}

async function vramActual() {
  try {
    const so = await ejecutar('nvidia-smi', ['--query-gpu=name,memory.used,memory.total', '--format=csv,noheader,nounits']);
    const [name, used, total] = so.toString().trim().split(/\r?\n/)[0].split(',').map((s) => s.trim());
    return { gpu: name, usada: Number(used), total: Number(total) };
  } catch { return null; }
}

// ---------- ajustes del control de calidad (QA) ----------
// Imágenes que no pasaron el QA con la seed de tools/image-prompts.json y se
// regeneraron. Se aplican solo si la entrada del JSON conserva su seed original
// (`seed_original`); si alguien actualiza el JSON, manda el JSON. Así
// `--force` reproduce exactamente las imágenes aprobadas (comprobado byte a byte).
// Se ignoran con --sin-ajustes. Detalle en docs/IMAGENES.md.
const AJUSTES_QA = {
  "assets/img/products/prd-0002-1.webp": {
    seed_original: 102,
    seed: 1102,
    motivo: "intento anterior: reforzar los detalles de guayabera (4 bolsillos y alforzas)",
    extra: "Traditional Latin American guayabera details: four patch pockets (two on the chest and two at the hips) and two vertical rows of fine pintuck pleats running down each side of the front, straight hem worn untucked."
  },
  "assets/img/products/prd-0011-1.webp": {
    seed_original: 111,
    seed: 1111,
    motivo: "objetos de colores raros dentro de la pretina",
    extra: "Plain clean inner waistband with nothing tucked inside, no tags, no labels."
  },
  "assets/img/products/prd-0016-1.webp": {
    seed_original: 116,
    seed: 1116,
    motivo: "intento anterior: limitar los colores del bolso a la paleta",
    extra: "The bag is natural jute color with only one thin mango-orange stripe and no other colors."
  },
  "assets/img/brand/hero-2.webp": {
    seed_original: 202,
    seed: 1202,
    motivo: "intento anterior: camisas lisas, sin etiquetas",
    extra: "Each shirt is a single solid color. No tags or labels visible."
  },
  "assets/img/lookbook/look-1.webp": {
    seed_original: 401,
    seed: 3401,
    motivo: "otras personas al fondo del mercado (con seeds 401, 1401, 2401 y solo con --extra)",
    prompt: "An adult woman wearing a loose off-white cotton gauze blouse and high-waisted palm-green linen shorts, a woven jute tote bag on her shoulder, standing in front of a rustic wooden market stand piled high with mangoes, papayas and bananas, with a sunlit terracotta plaster wall directly behind the stand closing off the background, morning light, framed from the shoulders to mid-thigh. She is the only person in the picture. The photo is cropped at the neck, no face, no head visible, adults only, a single adult model: the top edge of the frame cuts across the collarbones, so the chin, mouth and face are completely outside the picture. Editorial fashion photography for a summer clothing store in Tarapoto, in the Peruvian Amazon. Warm tropical golden light, soft dappled shadows of palm fronds, natural fabric texture clearly visible, color palette of warm sand, palm green, lagoon turquoise, terracotta and mango orange. Sharp focus on the garment, 50mm lens, shallow depth of field, subtle film grain. No text, no letters, no logos, no watermark."
  },
  "assets/img/lookbook/look-2.webp": {
    seed_original: 402,
    seed: 1402,
    motivo: "el texto alternativo y el lookbook citan sandalias que no salían en cuadro",
    extra: "Wider shot showing the whole outfit from the collarbones down to the feet, including brown leather sandals on the wooden pier."
  },
  "assets/img/blog/proteccion-solar-para-ninos-en-la-selva.webp": {
    seed_original: 503,
    seed: 1503,
    motivo: "intento anterior: frasco de bloqueador sin etiqueta ni texto",
    extra: "The sunscreen bottle is plain and completely blank: pure white plastic with no label, no printing, no letters, no symbols. The garments have no tags or labels."
  }
};

function aplicarAjustes(e) {
  const a = AJUSTES_QA[e.path];
  if (!a || e.seed !== a.seed_original) return e;
  return { ...e, seed: a.seed, prompt: a.prompt ?? e.prompt, extra_qa: a.extra || '', ajuste_qa: a.motivo };
}

// ---------- servicios ----------
async function liberarOllama(o) {
  try {
    const r = await fetch(`${o.ollama}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: o.model, keep_alive: 0 }),
      signal: AbortSignal.timeout(30000),
    });
    await r.text();
    console.log(`Ollama: pedido liberar "${o.model}" de la VRAM (HTTP ${r.status}).`);
    // Espera (máx. 15 s) a que /api/ps ya no liste ningún modelo cargado.
    for (let i = 0; i < 15; i++) {
      const ps = await fetch(`${o.ollama}/api/ps`, { signal: AbortSignal.timeout(5000) })
        .then((x) => x.json()).catch(() => null);
      const cargados = (ps?.models || []).map((m) => m.name);
      if (!cargados.length) { console.log('Ollama: sin modelos en memoria.'); break; }
      if (i === 14) console.log(`AVISO: Ollama sigue con ${cargados.join(', ')} en memoria; puede faltar VRAM.`);
      else await espera(1000);
    }
  } catch (e) {
    console.log(`Ollama: no respondió (${e.cause?.code || e.message}); se continúa.`);
  }
}

async function comprobarSd(o) {
  const r = await fetch(`${o.sd}/v1/models`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`sd-server respondió HTTP ${r.status}`);
  return r.json();
}

function construirPrompt(entrada, seed, extra) {
  const args = {
    seed,
    sample_params: { sample_steps: 8, sample_method: 'euler', scheduler: 'simple', guidance: { txt_cfg: 1.0 } },
  };
  const texto = extra ? `${entrada.prompt} ${extra}` : entrada.prompt;
  return `${texto} <sd_cpp_extra_args>${JSON.stringify(args)}</sd_cpp_extra_args>`;
}

async function pedirImagen(o, prompt, size, formato, compresion) {
  const cuerpo = { prompt, n: 1, size, output_format: formato };
  if (formato !== 'png') cuerpo.output_compression = compresion;
  const r = await fetch(`${o.sd}/v1/images/generations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`sd-server HTTP ${r.status}: ${txt.slice(0, 300)}`);
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error(`Respuesta no JSON: ${txt.slice(0, 200)}`); }
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`Respuesta sin data[0].b64_json: ${txt.slice(0, 200)}`);
  return Buffer.from(b64, 'base64');
}

/** Recorta por arriba y codifica a WebP con gm del contenedor (por tubería). */
function recortarWebp(o, png, w, h, arriba, calidad) {
  return ejecutar('docker', ['exec', '-i', o.container, 'gm', 'convert', 'png:-',
    '-crop', `${w}x${h}+0+${arriba}`, '+repage', '-strip', '-quality', String(calidad), 'webp:-'], png);
}

/** Ruta donde se escribe la imagen: el repo o la carpeta de --salida. */
const rutaDestino = (o, e) => path.join(o.salida || RAIZ, e.path);

// ---------- una imagen ----------
async function generarUna(o, e, seed, extra) {
  const final = dims(e.size);
  const gen = dims(e.generar || e.size);
  const arriba = Number(e.recortar_arriba || 0);
  if (gen.w !== final.w || gen.h - arriba !== final.h) {
    throw new Error(`generar (${e.generar}) - recortar_arriba (${arriba}) no da size (${e.size})`);
  }
  const prompt = construirPrompt(e, seed, extra);
  const recorta = arriba > 0;
  let calidad = o.compression;
  let ultimoError = null;

  for (let intento = 1; intento <= o.retries; intento++) {
    const t0 = Date.now();
    const parar = muestrearVram();
    try {
      let crudo = await pedirImagen(o, prompt, `${gen.w}x${gen.h}`, recorta ? 'png' : 'webp', calidad);
      const tGen = (Date.now() - t0) / 1000;
      const vramPico = parar();
      let m = medirImagen(crudo);
      if (!m) throw new Error('sd-server devolvió algo que no es PNG ni WebP');
      if (m.w !== gen.w || m.h !== gen.h) throw new Error(`sd-server devolvió ${m.w}x${m.h}, se pidió ${gen.w}x${gen.h}`);

      let salida;
      if (recorta) {
        salida = await recortarWebp(o, crudo, final.w, final.h, arriba, calidad);
        while (salida.length > o.maxKb * 1024 && calidad > 40) {
          calidad -= 8;
          salida = await recortarWebp(o, crudo, final.w, final.h, arriba, calidad);
        }
      } else {
        salida = crudo;
        while (salida.length > o.maxKb * 1024 && calidad > 40) {
          calidad -= 8; // misma seed => misma imagen con menos calidad
          console.log(`   ${kb(salida.length)} KB > ${o.maxKb} KB: se repite con output_compression ${calidad}`);
          salida = await pedirImagen(o, prompt, `${gen.w}x${gen.h}`, 'webp', calidad);
        }
      }
      m = medirImagen(salida);
      if (!m || m.formato !== 'webp') throw new Error('La salida final no es WebP');
      if (m.w !== final.w || m.h !== final.h) throw new Error(`Salida ${m.w}x${m.h}, se esperaba ${e.size}`);
      if (salida.length > o.maxKb * 1024) console.log(`   AVISO: ${kb(salida.length)} KB sigue por encima de ${o.maxKb} KB`);

      const destino = rutaDestino(o, e);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      const tmp = `${destino}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, salida);
      fs.renameSync(tmp, destino);
      return {
        path: e.path, destino, seed, extra: extra || null,
        prompt: e.prompt_reemplazado ? e.prompt : undefined, ajuste_qa: e.ajuste_qa || undefined, size: e.size, generar: `${gen.w}x${gen.h}`,
        recortar_arriba: arriba, calidad, bytes: salida.length, kb: kb(salida.length),
        segundos_generacion: Number(tGen.toFixed(1)), segundos_total: Number(((Date.now() - t0) / 1000).toFixed(1)),
        vram_pico_mib: vramPico, intentos: intento,
      };
    } catch (err) {
      parar();
      ultimoError = err;
      console.log(`   intento ${intento}/${o.retries} falló: ${err.message}`);
      if (intento < o.retries) await espera(5000 * intento);
    }
  }
  throw ultimoError;
}

// ---------- principal ----------
async function main() {
  const o = leerArgs(process.argv.slice(2));
  const crudas = JSON.parse(fs.readFileSync(PROMPTS, 'utf8'));
  if (!Array.isArray(crudas)) throw new Error('image-prompts.json debe ser una lista');
  const todas = o.ajustes ? crudas.map(aplicarAjustes) : crudas;

  const coincide = (e, q) => {
    const n = q.replace(/\\/g, '/');
    const base = path.posix.basename(e.path);
    return e.path === n || e.path.endsWith(`/${n}`) || base === n || base.replace(/\.[^.]+$/, '') === n;
  };
  let lista = o.only.length ? todas.filter((e) => o.only.some((q) => coincide(e, q))) : todas;
  if (o.only.length) {
    const sin = o.only.filter((q) => !todas.some((e) => coincide(e, q)));
    if (sin.length) throw new Error(`--only sin coincidencias: ${sin.join(', ')}`);
  }
  if ((o.seed !== null || o.extra || o.prompt) && lista.length !== 1) {
    throw new Error('--seed, --extra y --prompt solo se aceptan con un único --only');
  }
  if (o.prompt) lista = lista.map((e) => ({ ...e, prompt: o.prompt, prompt_reemplazado: true }));

  if (o.list) {
    for (const e of lista) {
      const f = rutaDestino(o, e);
      const s = fs.existsSync(f) ? `${kb(fs.statSync(f).size)} KB` : 'FALTA';
      console.log(`${s.padStart(7)}  seed ${String(e.seed).padStart(4)}  ${e.personas ? 'personas' : 'sin pers.'}  ${e.path}${e.ajuste_qa ? '  [ajuste QA]' : ''}`);
    }
    return;
  }

  const pendientes = lista.filter((e) => o.force || !fs.existsSync(rutaDestino(o, e)));
  const saltadas = lista.length - pendientes.length;
  console.log(`Imágenes: ${lista.length} seleccionadas, ${pendientes.length} a generar, ${saltadas} ya existen (usa --force para regenerarlas).`);
  if (!pendientes.length) return;

  if (o.dryRun) {
    for (const e of pendientes) {
      const seed = o.seed ?? e.seed;
      console.log(`- ${e.path}  seed ${seed}${e.ajuste_qa && o.seed === null ? ' [ajuste QA]' : ''}  pedir ${e.generar || e.size}${e.recortar_arriba ? ` -> recortar ${e.recortar_arriba}px arriba` : ''} -> ${e.size}`);
    }
    return;
  }

  if (o.unload) await liberarOllama(o);
  await comprobarSd(o);
  if (pendientes.some((e) => Number(e.recortar_arriba || 0) > 0)) {
    await ejecutar('docker', ['exec', o.container, 'gm', 'version']).catch((err) => {
      throw new Error(`Hace falta GraphicsMagick en el contenedor "${o.container}" para recortar: ${err.message}`);
    });
  }
  const vram0 = await vramActual();
  if (vram0) console.log(`GPU: ${vram0.gpu} · VRAM usada antes de empezar: ${vram0.usada}/${vram0.total} MiB`);

  const resultados = []; const fallos = [];
  const tInicio = Date.now();
  for (const [i, e] of pendientes.entries()) {
    const seed = o.seed ?? e.seed;
    console.log(`[${i + 1}/${pendientes.length}] ${e.path} (seed ${seed}, ${e.generar || e.size}${e.recortar_arriba ? `, recorte ${e.recortar_arriba}px` : ''})`);
    try {
      const r = await generarUna(o, e, seed, o.extra || (o.prompt ? '' : e.extra_qa) || '');
      resultados.push(r);
      console.log(`   OK ${r.kb} KB · q${r.calidad} · ${r.segundos_generacion} s generación · ${r.segundos_total} s total · VRAM pico ${r.vram_pico_mib ?? '?'} MiB`);
    } catch (err) {
      fallos.push({ path: e.path, seed, error: err.message });
      console.log(`   FALLÓ: ${err.message}`);
    }
  }
  const total = (Date.now() - tInicio) / 1000;

  console.log('\n| Imagen | Seed | KB | q | s gen | VRAM pico MiB |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const r of resultados) {
    console.log(`| ${r.path} | ${r.seed} | ${r.kb} | ${r.calidad} | ${r.segundos_generacion} | ${r.vram_pico_mib ?? '?'} |`);
  }
  const gens = resultados.map((r) => r.segundos_generacion);
  if (gens.length) {
    const media = gens.reduce((a, b) => a + b, 0) / gens.length;
    console.log(`\nGeneradas ${resultados.length}, fallidas ${fallos.length}. Total ${total.toFixed(0)} s; generación media ${media.toFixed(1)} s (mín ${Math.min(...gens)} s, máx ${Math.max(...gens)} s).`);
  }
  for (const f of fallos) console.log(`FALLÓ ${f.path} (seed ${f.seed}): ${f.error}`);

  if (o.log) {
    fs.mkdirSync(path.dirname(path.resolve(o.log)), { recursive: true });
    fs.writeFileSync(path.resolve(o.log), JSON.stringify({
      fecha: new Date().toISOString(), sd: o.sd, gpu: vram0, total_segundos: Number(total.toFixed(1)),
      resultados, fallos,
    }, null, 2));
    console.log(`Informe JSON: ${path.resolve(o.log)}`);
  }
  if (fallos.length) process.exitCode = 1;
}

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
