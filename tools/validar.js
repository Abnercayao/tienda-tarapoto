#!/usr/bin/env node
/*
 * tools/validar.js — Validador del contrato de datos de "Palmera Brava" (D9 del PLAN).
 * CERO dependencias. El MISMO código corre en local y dentro de n8n.
 *
 * (a) Línea de comandos (desde la raíz del repo):
 *       node tools/validar.js data/products.json data/articles.json data/site.json data/chat.json
 *     Opciones:
 *       --anterior <carpeta>        compara contra otra copia de data/ (límites de daño)
 *       --ids prd-0001,art-0002,site  ids autorizados en el lote (con --anterior)
 *       --limpieza                  permite /limpiar_muestras (solo quita productos de muestra)
 *       --rol admin|dueno|marketing quién origina el cambio (con --anterior)
 *       --json                      imprime el resultado como JSON
 *       --escribir-esquemas         regenera data/schema/*.json a partir de este archivo
 *     Código de salida: 0 = ok, 1 = hay errores, 2 = uso incorrecto o archivo ilegible.
 *
 * (b) n8n (nodo Code, "Run Once for All Items", JavaScript):
 *       1. Copia TODO el bloque entre las dos líneas marcadoras "COPIAR A N8N" y "FIN COPIAR A N8N" (más abajo).
 *       2. Debajo, añade por ejemplo:
 *            const e = $input.first().json;
 *            const r = validar(
 *              { products: e.products, articles: e.articles, site: e.site, chat: e.chat },   // objetos o texto JSON (los que haya)
 *              { anterior: e.anterior, idsLote: e.idsLote, permitirLimpieza: false, rol: e.rol });
 *            return [{ json: r }];
 *     El bloque no usa require, fs, Buffer ni variables de entorno.
 *
 * Resultado: { ok, errores[], avisos[], resumen }. Cada mensaje es "[codigo] ruta: texto".
 * Los mensajes nunca contienen los signos menor/mayor que (se pueden mandar a Telegram sin escapar).
 * Si cambias reglas o esquemas: node tools/validar.js --escribir-esquemas && node tools/test-validar.js
 */
'use strict';

// === COPIAR A N8N ===
const CONTRATO_VERSION = '2.0.0';
const SCHEMA_VERSION = 2; // v2 (2026-10-07): frescura, stock_por_color, imagenes[].color, guia_tallas, chat.json; sin avisos de muestra
const LIMITE_BYTES = 1000000; // cada JSON debe pesar MENOS de 1 MB (límite de la API de contenidos)
const MAX_BORRADORES_APLICADOS = 100;

const CATEGORIAS = ['hombres', 'mujeres', 'ninos', 'accesorios'];
const SUBCATEGORIAS = ['polos', 'camisas', 'blusas', 'vestidos', 'faldas', 'shorts', 'bermudas', 'pantalones',
  'conjuntos', 'ropa-de-bano', 'pijamas', 'sombreros', 'gorros', 'gorras', 'sandalias', 'lentes', 'bolsos', 'otros'];
const T_ADULTO = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const T_NINOS = ['2', '4', '6', '8', '10', '12', '14', '16'];
const T_CALZADO = ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44'];
const T_UNICA = ['UNICA'];
const TALLAS = [].concat(T_ADULTO, T_NINOS, T_CALZADO, T_UNICA);
const TALLAS_POR_CATEGORIA = {
  hombres: [].concat(T_ADULTO, T_CALZADO, T_UNICA),
  mujeres: [].concat(T_ADULTO, T_CALZADO, T_UNICA),
  ninos: [].concat(T_NINOS, T_UNICA),
  accesorios: [].concat(T_UNICA, T_CALZADO, ['S', 'M', 'L'])
};
const ORIGENES_IMAGEN = ['foto', 'ia_local', 'placeholder'];
// v2: stock por color. Fuente de verdad de la disponibilidad: stock = suma de stock_por_color.
const MAX_STOCK_COLOR = 20;
const STOCK_COLOR_ASUMIDO = 1; // al crear sin cantidades, cada color empieza con 1 (la vista previa lo avisa)
// Zonas de "cómo medir" de la guía de tallas (site.guia_tallas.como_medir[].id y tablas[].medidas).
const ZONAS_MEDIDA = ['pecho', 'busto', 'cintura', 'cadera', 'largo', 'entrepierna', 'estatura', 'cabeza', 'pie'];
// v2: índice de frescura (1–5 hojitas) por material. TABLA ÚNICA para web y bot (data/schema/frescura-materiales.json
// se genera desde aquí). Se aplica la PRIMERA fila cuyo patrón coincide con el texto en minúsculas y sin tildes.
const TABLA_FRESCURA = [
  { valor: 2, materiales: 'denim, jean, mezclilla, drill grueso, lona, pana', patron: '\\b(denim|jeans?|mezclilla|lona|pana|corduroy)\\b|\\bdrill grues' },
  { valor: 1, materiales: 'poliéster pesado o grueso, cuero, cuerina, vinil, lana, polar, franela, neopreno', patron: '\\b(cuero|cuerina|ecocuero|vinil|vinilo|charol|lana|polar|franela|fleece|neopreno)\\b|\\bpoliester (pesado|grueso)' },
  { valor: 5, materiales: 'lino (y lino-algodón), gasa, voile, muselina, fibras vegetales tejidas (palma, paja, rafia, yute)', patron: '\\b(lino|linen|gasa|voile|muselina|bambula|plumetis|rafia|yute|mimbre|junco|toquilla|paja)\\b|fibra de palma|palma tejida' },
  { valor: 3, materiales: 'algodón-poliéster, dri-fit, telas UV/UPF, microfibra, elastano, drill, gabardina', patron: 'algodon.*poliester|poliester.*algodon|\\b(dri|dry)[ -]?fit\\b|\\buv\\b|\\bupf\\b|microfibra|elastano|lycra|licra|spandex|\\bdrill\\b|gabardina' },
  { valor: 4, materiales: 'algodón pima, algodón, bambú, viscosa, rayón, modal, lyocell, seda', patron: '\\b(algodon|pima|cotton|bambu|bamboo|viscosa|rayon|modal|lyocell|tencel|seda)\\b' },
  { valor: 2, materiales: 'poliéster, nylon, acrílico (sin tecnología de frescura)', patron: '\\b(poliester|polyester|nylon|nailon|acrilico|poliamida)\\b' }
];
const DIAS = ['lu', 'ma', 'mi', 'ju', 'vi', 'sa', 'do'];
const REDES = ['instagram', 'facebook', 'tiktok', 'youtube', 'x'];
const DOMINIOS_REDES = {
  instagram: ['instagram.com', 'www.instagram.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.me'],
  tiktok: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
  x: ['x.com', 'twitter.com']
};
// host -> prefijo de ruta obligatorio para el iframe del mapa (coincide con frame-src de la CSP)
const DOMINIOS_MAPA_EMBED = { 'www.openstreetmap.org': '/export/embed.html', 'www.google.com': '/maps/embed' };
const DOMINIOS_MAPA_ENLACE = ['www.openstreetmap.org', 'openstreetmap.org', 'osm.org', 'www.google.com', 'maps.google.com', 'maps.app.goo.gl'];
// D13: nunca se publica un número de ejemplo
const WHATSAPP_EJEMPLO = ['51900000000', '51999999999', '51987654321', '51912345678', '51911111111', '51999888777', '51123456789'];
const PATRONES_SECRETO = [
  { nombre: 'token de bot de Telegram (botNNN:)', re: /\bbot\d+:/i },
  { nombre: 'token de Telegram', re: /\d{8,10}:[A-Za-z0-9_-]{35}/ },
  { nombre: 'token de GitHub (github_pat_)', re: /github_pat_/i },
  { nombre: 'token de GitHub (ghp_)', re: /ghp_/ },
  { nombre: 'token de GitHub (gho_/ghu_/ghs_/ghr_)', re: /\bgh[ousr]_[A-Za-z0-9]{16,}/ },
  { nombre: 'clave privada', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nombre: 'clave de AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { nombre: 'clave de API (sk-)', re: /\bsk-[A-Za-z0-9_-]{20,}/ }
];
// Roles (decisión del usuario): admin y dueno todo; marketing NO puede estas acciones.
const ROLES = ['admin', 'dueno', 'marketing'];
const PROHIBIDO_MARKETING = ['whatsapp', 'limpiar_muestras', 'borrar', 'deshacer', 'pausa', 'reanudar', 'sitio_datos'];

// ---------- Esquemas (JSON Schema 2020-12). data/schema/*.json se genera desde aquí. ----------
const RE = {
  texto: '^[^<>]*$',
  fecha: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(\\.\\d{1,3})?(Z|[+-]([01]\\d|2[0-3]):[0-5]\\d)$',
  slug: '^[a-z0-9]+(-[a-z0-9]+)*$',
  prd: '^prd-\\d{4,6}$',
  art: '^art-\\d{4,6}$',
  look: '^look-\\d{1,3}$',
  draft: '^drf-[a-z0-9]{6,20}$',
  hex: '^#[0-9A-Fa-f]{6}$',
  hora: '^([01]\\d|2[0-3]):[0-5]\\d$',
  https: "^https://[^\\s<>\"'`]+$",
  whatsapp: '^(51\\d{9})?$',
  img_producto: '^assets/img/(products|placeholders)/[a-z0-9]+(-[a-z0-9]+)*\\.(webp|avif|jpg|jpeg|png|svg)$',
  img_sitio: '^assets/img/(blog|lookbook|brand|placeholders)/[a-z0-9]+(-[a-z0-9]+)*\\.(webp|avif|jpg|jpeg|png|svg)$',
  ref_esquema: '^\\./schema/[a-z-]+\\.schema\\.json$',
  chat_url: '^(https://[a-z0-9]+(-[a-z0-9]+)*\\.trycloudflare\\.com)?$'
};
RE.fecha_o_vacio = '^(' + RE.fecha.slice(1, -1) + ')?$';
function txt(min, max, desc) {
  const s = { type: 'string' };
  if (min) s.minLength = min;
  s.maxLength = max;
  s.pattern = RE.texto;
  if (desc) s.description = desc;
  return s;
}
function fechaEsq(desc) { const s = { type: 'string', pattern: RE.fecha }; if (desc) s.description = desc; return s; }
function imagenEsq(patron, desc, conColor) {
  const e = {
    type: 'object', additionalProperties: false, required: ['src', 'alt', 'origen'], description: desc,
    properties: {
      src: { type: 'string', maxLength: 160, pattern: patron, description: 'Ruta RELATIVA dentro del repo; nunca URL externa.' },
      alt: txt(5, 160, 'Texto alternativo en español que describe la imagen.'),
      origen: { enum: ORIGENES_IMAGEN, description: 'Metadato interno (la web no lo muestra): foto = foto real; ia_local = generada con IA local (sd-server); placeholder = ilustración provisional.' },
      ancho: { type: 'integer', minimum: 1, maximum: 6000 },
      alto: { type: 'integer', minimum: 1, maximum: 6000 }
    }
  };
  if (conColor) e.properties.color = txt(2, 24, 'v2, opcional: nombre EXACTO de un color de "colores". Al elegir ese color, la web muestra esta foto.');
  return e;
}
function envolturaProps(nombreEsquema) {
  return {
    $schema: { type: 'string', pattern: RE.ref_esquema },
    schema_version: { const: SCHEMA_VERSION, description: 'Versión del contrato (cambia solo si cambia el esquema). v2 desde 2026-10-07.' },
    version: { type: 'integer', minimum: 1, description: 'Revisión de los datos: WF5 la incrementa en cada commit. La web repinta si cambia.' },
    actualizado: fechaEsq('Fecha ISO 8601 con zona (-05:00) del último cambio publicado.'),
    borradores_aplicados: {
      type: 'array', maxItems: MAX_BORRADORES_APLICADOS, uniqueItems: true, items: { type: 'string', pattern: RE.draft },
      description: 'Últimos ' + MAX_BORRADORES_APLICADOS + ' draft_id aplicados a ' + nombreEsquema + ' (idempotencia de WF5, D5).'
    }
  };
}
const ENVOLTURA_REQ = ['schema_version', 'version', 'actualizado', 'borradores_aplicados'];

const ESQUEMAS = {
  products: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Palmera Brava — data/products.json',
    description: 'Catálogo. Generado desde tools/validar.js (no editar a mano). Reglas entre campos: ver docs/CONTRATO.md.',
    type: 'object', additionalProperties: false,
    required: ENVOLTURA_REQ.concat(['moneda', 'productos']),
    properties: Object.assign(envolturaProps('products.json'), {
      moneda: { const: 'PEN' },
      productos: { type: 'array', maxItems: 1000, items: { $ref: '#/$defs/producto' } }
    }),
    $defs: {
      producto: {
        type: 'object', additionalProperties: false,
        required: ['id', 'slug', 'nombre', 'categoria', 'subcategoria', 'precio', 'tallas', 'stock', 'colores',
          'descripcion', 'etiquetas', 'imagenes', 'destacado', 'activo', 'muestra', 'fecha_creacion', 'fecha_actualizacion'],
        properties: {
          id: { type: 'string', pattern: RE.prd, description: 'prd-0001; inmutable; lo asigna el código (máximo + 1), nunca el LLM.' },
          slug: { type: 'string', minLength: 3, maxLength: 80, pattern: RE.slug },
          nombre: txt(3, 70),
          categoria: { enum: CATEGORIAS },
          subcategoria: { enum: SUBCATEGORIAS },
          precio: { type: 'number', exclusiveMinimum: 0, maximum: 9999, description: 'Soles (PEN), máximo 2 decimales.' },
          precio_oferta: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 9999, description: 'Opcional. Ausente o null = sin oferta. Debe ser menor que precio.' },
          tallas: { type: 'array', minItems: 1, maxItems: 12, uniqueItems: true, items: { enum: TALLAS } },
          stock_por_talla: {
            type: 'object', propertyNames: { enum: TALLAS }, additionalProperties: { type: 'integer', minimum: 0, maximum: 9999 },
            description: 'Opcional (formato v1). Una clave por cada talla de "tallas". Si existe stock_por_color, solo indica qué tallas hay (0 = agotada en esa talla) y NO se suma.'
          },
          stock_por_color: {
            type: 'object', propertyNames: txt(2, 24), additionalProperties: { type: 'integer', minimum: 0, maximum: MAX_STOCK_COLOR },
            description: 'v2, fuente de verdad del stock: una clave por cada nombre EXACTO de "colores" (ni más ni menos), enteros 0 a ' + MAX_STOCK_COLOR + '. 0 = color agotado.'
          },
          stock: { type: 'integer', minimum: 0, maximum: 99999, description: 'Total: suma de stock_por_color (v2) o, si no existe, de stock_por_talla (v1). Lo recalcula el código.' },
          colores: { type: 'array', minItems: 1, maxItems: 8, items: { $ref: '#/$defs/color' } },
          material: txt(2, 60),
          frescura: { type: 'integer', minimum: 1, maximum: 5, description: 'Índice de frescura (1–5 hojitas). Opcional: si falta, web y bot lo infieren con frescuraPorMaterial (data/schema/frescura-materiales.json).' },
          descripcion: txt(0, 600),
          etiquetas: { type: 'array', maxItems: 10, uniqueItems: true, items: { type: 'string', minLength: 2, maxLength: 24, pattern: RE.slug } },
          imagenes: { type: 'array', maxItems: 6, items: { $ref: '#/$defs/imagen' } },
          destacado: { type: 'boolean' },
          activo: { type: 'boolean', description: 'false = oculto (borrado suave). Ojo: sigue siendo público en el JSON.' },
          muestra: { type: 'boolean', description: 'true = producto de referencia de la demo. Solo lo usa /limpiar_muestras; la web lo ignora (todo se puede pedir).' },
          fecha_creacion: fechaEsq(),
          fecha_actualizacion: fechaEsq()
        }
      },
      color: {
        type: 'object', additionalProperties: false, required: ['nombre', 'hex'],
        properties: { nombre: txt(2, 24), hex: { type: 'string', pattern: RE.hex } }
      },
      imagen: imagenEsq(RE.img_producto, 'Imagen de producto: assets/img/products/ o assets/img/placeholders/. "color" (v2) la asocia a un color.', true)
    }
  },

  articles: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Palmera Brava — data/articles.json',
    description: 'Blog por bloques (sin HTML ni Markdown). Generado desde tools/validar.js.',
    type: 'object', additionalProperties: false,
    required: ENVOLTURA_REQ.concat(['articulos']),
    properties: Object.assign(envolturaProps('articles.json'), {
      articulos: { type: 'array', maxItems: 300, items: { $ref: '#/$defs/articulo' } }
    }),
    $defs: {
      articulo: {
        type: 'object', additionalProperties: false,
        required: ['id', 'slug', 'titulo', 'resumen', 'portada', 'bloques', 'productos_relacionados', 'autor', 'fecha', 'activo', 'muestra'],
        properties: {
          id: { type: 'string', pattern: RE.art },
          slug: { type: 'string', minLength: 3, maxLength: 90, pattern: RE.slug },
          titulo: txt(5, 110),
          resumen: txt(20, 240),
          portada: { $ref: '#/$defs/imagen' },
          bloques: { type: 'array', minItems: 1, maxItems: 60, items: { $ref: '#/$defs/bloque' } },
          productos_relacionados: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string', pattern: RE.prd } },
          autor: txt(2, 60),
          fecha: fechaEsq('Fecha de publicación.'),
          fecha_actualizacion: fechaEsq(),
          activo: { type: 'boolean' },
          muestra: { type: 'boolean' }
        }
      },
      bloque: {
        type: 'object',
        oneOf: [
          { $ref: '#/$defs/bloque_parrafo' }, { $ref: '#/$defs/bloque_subtitulo' }, { $ref: '#/$defs/bloque_lista' },
          { $ref: '#/$defs/bloque_cita' }, { $ref: '#/$defs/bloque_producto' }
        ]
      },
      bloque_parrafo: { type: 'object', additionalProperties: false, required: ['tipo', 'texto'], properties: { tipo: { const: 'parrafo' }, texto: txt(1, 1500) } },
      bloque_subtitulo: { type: 'object', additionalProperties: false, required: ['tipo', 'texto'], properties: { tipo: { const: 'subtitulo' }, texto: txt(1, 120) } },
      bloque_lista: {
        type: 'object', additionalProperties: false, required: ['tipo', 'items'],
        properties: { tipo: { const: 'lista' }, ordenada: { type: 'boolean' }, items: { type: 'array', minItems: 1, maxItems: 20, items: txt(1, 300) } }
      },
      bloque_cita: { type: 'object', additionalProperties: false, required: ['tipo', 'texto'], properties: { tipo: { const: 'cita' }, texto: txt(1, 400), autor: txt(1, 80) } },
      bloque_producto: {
        type: 'object', additionalProperties: false, required: ['tipo', 'ids'],
        properties: { tipo: { const: 'producto' }, ids: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', pattern: RE.prd } } }
      },
      imagen: imagenEsq(RE.img_sitio, 'Portada: assets/img/blog/ (o placeholders). ia_local permitido.')
    }
  },

  site: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Palmera Brava — data/site.json',
    description: 'Datos de la tienda, hero, categorías, lookbook, guía de tallas y plantillas de WhatsApp. Generado desde tools/validar.js.',
    type: 'object', additionalProperties: false,
    required: ENVOLTURA_REQ.concat(['nombre', 'lema', 'whatsapp', 'telefono_visible', 'ciudad', 'region', 'pais', 'direccion', 'horario',
      'envio', 'zonas_reparto', 'metodos_pago', 'redes', 'mapa', 'hero', 'categorias', 'lookbook', 'testimonios',
      'guia_tallas', 'mensajes']),
    properties: Object.assign(envolturaProps('site.json'), {
      nombre: txt(2, 40),
      lema: txt(2, 90),
      whatsapp: { type: 'string', pattern: RE.whatsapp, description: 'Formato wa.me: 51 + 9 dígitos, sin +, espacios ni guiones. Vacío = la web oculta los botones de pedido.' },
      telefono_visible: txt(0, 24, 'Mismo número para mostrar, p. ej. "+51 995 542 938".'),
      ciudad: txt(2, 40),
      region: txt(2, 40),
      pais: { const: 'PE' },
      direccion: txt(2, 120, 'Sin dirección exacta mientras el dueño no la confirme.'),
      horario: {
        type: 'object', additionalProperties: false, required: ['texto', 'tramos'],
        properties: {
          texto: txt(3, 120),
          tramos: {
            type: 'array', minItems: 1, maxItems: 7,
            items: {
              type: 'object', additionalProperties: false, required: ['dias', 'abre', 'cierra'],
              properties: {
                dias: { type: 'array', minItems: 1, maxItems: 7, uniqueItems: true, items: { enum: DIAS } },
                abre: { type: 'string', pattern: RE.hora },
                cierra: { type: 'string', pattern: RE.hora }
              }
            }
          }
        }
      },
      envio: txt(5, 400),
      zonas_reparto: { type: 'array', maxItems: 12, uniqueItems: true, items: txt(2, 60) },
      metodos_pago: { type: 'array', maxItems: 10, uniqueItems: true, items: txt(2, 40) },
      anuncio: txt(0, 140, 'Opcional: barra de anuncio.'),
      redes: {
        type: 'array', maxItems: 8,
        items: {
          type: 'object', additionalProperties: false, required: ['red', 'url'],
          properties: { red: { enum: REDES }, url: { type: 'string', maxLength: 200, pattern: RE.https } }
        }
      },
      mapa: {
        type: 'object', additionalProperties: false, required: ['embed', 'enlace', 'lat', 'lng'],
        properties: {
          embed: { type: 'string', maxLength: 400, pattern: RE.https },
          enlace: { type: 'string', maxLength: 300, pattern: RE.https },
          lat: { type: 'number', minimum: -90, maximum: 90 },
          lng: { type: 'number', minimum: -180, maximum: 180 },
          nota: txt(0, 160)
        }
      },
      hero: {
        type: 'object', additionalProperties: false, required: ['imagenes'],
        properties: { imagenes: { type: 'array', minItems: 1, maxItems: 4, items: { $ref: '#/$defs/imagen' } } }
      },
      categorias: {
        type: 'array', minItems: 4, maxItems: 4,
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'nombre', 'descripcion', 'imagen'],
          properties: { id: { enum: CATEGORIAS }, nombre: txt(2, 30), descripcion: txt(0, 140), imagen: { $ref: '#/$defs/imagen' } }
        }
      },
      lookbook: {
        type: 'array', maxItems: 12,
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'titulo', 'imagen', 'productos'],
          properties: {
            id: { type: 'string', pattern: RE.look },
            titulo: txt(2, 60),
            descripcion: txt(0, 200),
            imagen: { $ref: '#/$defs/imagen' },
            productos: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', pattern: RE.prd } }
          }
        }
      },
      testimonios: {
        type: 'array', maxItems: 20,
        items: {
          type: 'object', additionalProperties: false, required: ['nombre', 'texto', 'fuente', 'fecha', 'verificado'],
          properties: { nombre: txt(2, 40), texto: txt(5, 400), fuente: txt(2, 60), fecha: fechaEsq(), verificado: { const: true } }
        },
        description: 'Solo testimonios REALES y verificados; nunca inventados.'
      },
      guia_tallas: {
        type: 'object', additionalProperties: false, required: ['titulo', 'intro', 'consejo_calor', 'como_medir', 'tablas'],
        description: 'v2: guía de tallas (modal de la web, abierto desde cada prenda). Medidas del CUERPO en cm salvo que la columna diga otra cosa.',
        properties: {
          titulo: txt(3, 60),
          intro: txt(0, 300),
          consejo_calor: txt(5, 400, 'Consejo para el calor (tallas holgadas).'),
          ayuda: txt(0, 200, 'Opcional: texto final (p. ej. "¿Dudas? Escríbenos por WhatsApp").'),
          como_medir: {
            type: 'array', minItems: 1, maxItems: ZONAS_MEDIDA.length,
            items: {
              type: 'object', additionalProperties: false, required: ['id', 'titulo', 'texto'],
              properties: { id: { enum: ZONAS_MEDIDA, description: 'La web dibuja esta zona en la ilustración SVG.' }, titulo: txt(2, 40), texto: txt(5, 300) }
            }
          },
          tablas: {
            type: 'array', minItems: 1, maxItems: 12,
            items: {
              type: 'object', additionalProperties: false, required: ['id', 'categoria', 'subcategorias', 'titulo', 'medidas', 'columnas', 'filas'],
              properties: {
                id: { type: 'string', minLength: 3, maxLength: 40, pattern: RE.slug },
                categoria: { enum: CATEGORIAS },
                subcategorias: { type: 'array', minItems: 1, maxItems: SUBCATEGORIAS.length, uniqueItems: true, items: { enum: SUBCATEGORIAS }, description: 'Subcategorías a las que aplica (ver tablaDeTallas).' },
                titulo: txt(3, 60),
                medidas: { type: 'array', maxItems: ZONAS_MEDIDA.length, uniqueItems: true, items: { enum: ZONAS_MEDIDA }, description: 'Zonas de como_medir que explica esta tabla.' },
                columnas: { type: 'array', minItems: 2, maxItems: 6, items: txt(1, 30) },
                filas: {
                  type: 'array', minItems: 1, maxItems: 16, items: { type: 'array', minItems: 2, maxItems: 6, items: txt(1, 30) },
                  description: 'Cada fila tiene tantas celdas como columnas. La 1.ª celda es la talla como en el producto (UNICA se escribe "Única").'
                },
                nota: txt(0, 240)
              }
            }
          }
        }
      },
      mensajes: {
        type: 'object', additionalProperties: false, required: ['pedido', 'consulta'],
        description: 'Plantillas de WhatsApp. Marcadores: {nombre} {id} {url}.',
        properties: { pedido: txt(5, 300), consulta: txt(5, 300) }
      }
    }),
    $defs: {
      imagen: imagenEsq(RE.img_sitio, 'Imagen de sitio: assets/img/brand|lookbook|blog|placeholders/. ia_local permitido.')
    }
  },

  chat: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Palmera Brava — data/chat.json',
    description: 'v2: dirección pública del chat del agente vendedor (túnel rápido de Cloudflare hacia tools/chat-proxy.py). La escribe el webhook local chat-url de n8n solo si cambia. Generado desde tools/validar.js.',
    type: 'object', additionalProperties: false,
    required: ['url', 'activo', 'actualizado'],
    properties: {
      $schema: { type: 'string', pattern: RE.ref_esquema },
      url: { type: 'string', maxLength: 120, pattern: RE.chat_url, description: 'Vacía o https://<subdominio>.trycloudflare.com (sin ruta ni barra final; la web añade /chat).' },
      activo: { type: 'boolean', description: 'false = la web oculta el chat y muestra "Escríbenos por WhatsApp".' },
      actualizado: { type: 'string', pattern: RE.fecha_o_vacio, description: 'Vacío o fecha ISO 8601 con zona del último cambio.' }
    }
  }
};
// v2: la web y el bot usan la misma tabla de frescura; se publica como data/schema/frescura-materiales.json.
const FRESCURA_PUBLICA = {
  descripcion: 'Índice de frescura (1–5 hojitas) por material. Generado desde tools/validar.js (no editar a mano). Normaliza el texto (minúsculas, sin tildes) y aplica la PRIMERA fila cuyo patrón (RegExp de JavaScript) coincida. Orden: material, nombre, etiquetas. Sin coincidencia = sin índice.',
  normalizar: 'texto.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase()',
  tabla: TABLA_FRESCURA
};

// ---------- Formato de salida del LLM (D4) para Ollama /api/chat "format" ----------
const OPS_LLM = ['crear', 'actualizar', 'desactivar', 'reactivar', 'stock', 'agregar_imagen'];
const CAMPOS_LLM_PRODUCTO = ['nombre', 'categoria', 'subcategoria', 'precio', 'precio_oferta', 'tallas', 'stock_tallas', 'stock_por_color', 'stock_modo', 'colores',
  'material', 'frescura', 'descripcion', 'etiquetas', 'alt_imagen', 'destacado'];
const CAMPOS_LLM_ARTICULO = ['titulo', 'resumen', 'bloques', 'productos_relacionados', 'alt_portada'];
const ESQUEMA_LLM_PRODUCTO = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: OPS_LLM },
    entidad: { type: 'string', enum: ['producto'] },
    id: { type: ['string', 'null'], description: 'prd-0000 del catálogo; null si op=crear' },
    campos: {
      type: 'object',
      properties: {
        nombre: { type: ['string', 'null'] },
        categoria: { type: ['string', 'null'], enum: CATEGORIAS.concat([null]) },
        subcategoria: { type: ['string', 'null'], enum: SUBCATEGORIAS.concat([null]) },
        precio: { type: ['number', 'null'] },
        precio_oferta: { type: ['number', 'null'] },
        tallas: { type: 'array', items: { type: 'string', enum: TALLAS } },
        stock_tallas: {
          type: 'array',
          items: { type: 'object', properties: { talla: { type: 'string', enum: TALLAS }, cantidad: { type: 'integer' } }, required: ['talla', 'cantidad'] }
        },
        stock_por_color: {
          type: 'array', description: 'v2: cantidad por color, de 0 a ' + MAX_STOCK_COLOR + '. "10 por color" -> 10 en cada color',
          items: { type: 'object', properties: { color: { type: 'string' }, cantidad: { type: 'integer' } }, required: ['color', 'cantidad'] }
        },
        stock_modo: { type: ['string', 'null'], enum: ['fijar', 'sumar', 'restar', null], description: 'fijar = cantidad total nueva; sumar = llegaron N más; restar = se vendieron N' },
        colores: { type: 'array', items: { type: 'string' } },
        material: { type: ['string', 'null'] },
        frescura: { type: ['integer', 'null'], enum: [1, 2, 3, 4, 5, null], description: 'v2: índice de frescura 1 a 5 hojitas según la tela' },
        descripcion: { type: ['string', 'null'] },
        etiquetas: { type: 'array', items: { type: 'string' } },
        alt_imagen: { type: ['string', 'null'] },
        destacado: { type: ['boolean', 'null'] }
      },
      required: CAMPOS_LLM_PRODUCTO.slice()
    },
    campos_inferidos: { type: 'array', items: { type: 'string', enum: CAMPOS_LLM_PRODUCTO } },
    faltantes: { type: 'array', items: { type: 'string', enum: CAMPOS_LLM_PRODUCTO.concat(['id', 'foto']) } }
  },
  required: ['op', 'entidad', 'id', 'campos', 'campos_inferidos', 'faltantes']
};
const ESQUEMA_LLM_ARTICULO = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['crear', 'actualizar', 'desactivar', 'reactivar'] },
    entidad: { type: 'string', enum: ['articulo'] },
    id: { type: ['string', 'null'], description: 'art-0000; null si op=crear' },
    campos: {
      type: 'object',
      properties: {
        titulo: { type: ['string', 'null'] },
        resumen: { type: ['string', 'null'] },
        bloques: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tipo: { type: 'string', enum: ['parrafo', 'subtitulo', 'lista', 'cita'] },
              texto: { type: 'string' },
              items: { type: 'array', items: { type: 'string' } }
            },
            required: ['tipo', 'texto', 'items']
          }
        },
        productos_relacionados: { type: 'array', items: { type: 'string' } },
        alt_portada: { type: ['string', 'null'] }
      },
      required: CAMPOS_LLM_ARTICULO.slice()
    },
    campos_inferidos: { type: 'array', items: { type: 'string', enum: CAMPOS_LLM_ARTICULO } },
    faltantes: { type: 'array', items: { type: 'string', enum: CAMPOS_LLM_ARTICULO.concat(['id', 'tema']) } }
  },
  required: ['op', 'entidad', 'id', 'campos', 'campos_inferidos', 'faltantes']
};

// ---------- Utilidades puras ----------
function tipoDe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function esObjeto(v) { return tipoDe(v) === 'object'; }
function cumpleTipo(v, t) {
  const r = tipoDe(v);
  if (t === 'number') return r === 'number' || r === 'integer';
  return r === t;
}
function igual(a, b) {
  if (a === b) return true;
  const ta = tipoDe(a), tb = tipoDe(b);
  if (ta !== tb && !(cumpleTipo(a, 'number') && cumpleTipo(b, 'number'))) return false;
  if (ta === 'array') { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!igual(a[i], b[i])) return false; return true; }
  if (ta === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) { if (!Object.prototype.hasOwnProperty.call(b, k) || !igual(a[k], b[k])) return false; }
    return true;
  }
  return false;
}
function bytesUtf8(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; } else n += 3;
  }
  return n;
}
function serializar(doc) { return JSON.stringify(doc, null, 2) + '\n'; }
function largo(s) { return Array.from(s).length; }
const CACHE_RE = {};
function regex(p) { return CACHE_RE[p] || (CACHE_RE[p] = new RegExp(p, 'u')); }
function idSeguro(v) { return typeof v === 'string' && /^[a-z]{3,4}-\d{1,6}$/.test(v) ? v : null; }
function corto(v) {
  let s;
  try { s = JSON.stringify(v); } catch (e) { s = String(v); }
  if (s === undefined) s = String(v);
  s = s.replace(/[<>]/g, '?');
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
}
function quitarTildes(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function hostHttps(url) {
  if (typeof url !== 'string') return null;
  const m = /^https:\/\/([a-z0-9.-]+)(?::\d{1,5})?([/?#][^\s<>"'`]*)?$/i.exec(url);
  if (!m) return null;
  return { host: m[1].toLowerCase(), ruta: (m[2] || '/') };
}
function soles(n) { return 'S/ ' + Number(n).toFixed(2); }

// ---------- Mini validador de JSON Schema (subconjunto usado por estos esquemas) ----------
function resolverRef(raiz, ref) {
  if (typeof ref !== 'string' || ref.indexOf('#/') !== 0) throw new Error('$ref no soportado: ' + ref);
  return ref.slice(2).split('/').reduce(function (o, k) { return o ? o[k] : undefined; }, raiz);
}
function segmento(ruta, i, item) {
  const id = esObjeto(item) ? idSeguro(item.id) : null;
  return ruta + '[' + i + ']' + (id ? '(' + id + ')' : '');
}
function validarEsquema(valor, esq, raiz, ruta, salida) {
  if (esq && esq.$ref) esq = resolverRef(raiz, esq.$ref);
  if (!esq) return;
  const push = function (m) { salida.push(ruta + ': ' + m); };
  if (esq.type !== undefined) {
    const tipos = Array.isArray(esq.type) ? esq.type : [esq.type];
    if (!tipos.some(function (t) { return cumpleTipo(valor, t); })) { push('debe ser ' + tipos.join(' o ') + ' (es ' + tipoDe(valor) + ')'); return; }
  }
  if (Object.prototype.hasOwnProperty.call(esq, 'const') && !igual(valor, esq.const)) { push('debe ser ' + corto(esq.const) + ' (es ' + corto(valor) + ')'); return; }
  if (esq.enum && !esq.enum.some(function (e) { return igual(e, valor); })) {
    const lista = esq.enum.length > 12 ? esq.enum.slice(0, 12).map(corto).join(', ') + '...' : esq.enum.map(corto).join(', ');
    push('valor no permitido ' + corto(valor) + ' (permitidos: ' + lista + ')'); return;
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) { push('número no válido'); return; }
    if (esq.minimum !== undefined && valor < esq.minimum) push('debe ser mayor o igual que ' + esq.minimum + ' (es ' + valor + ')');
    if (esq.maximum !== undefined && valor > esq.maximum) push('debe ser menor o igual que ' + esq.maximum + ' (es ' + valor + ')');
    if (esq.exclusiveMinimum !== undefined && valor <= esq.exclusiveMinimum) push('debe ser mayor que ' + esq.exclusiveMinimum + ' (es ' + valor + ')');
    if (esq.exclusiveMaximum !== undefined && valor >= esq.exclusiveMaximum) push('debe ser menor que ' + esq.exclusiveMaximum + ' (es ' + valor + ')');
  }
  if (typeof valor === 'string') {
    const n = largo(valor);
    if (esq.minLength !== undefined && n < esq.minLength) push('texto demasiado corto (mínimo ' + esq.minLength + ', tiene ' + n + ')');
    if (esq.maxLength !== undefined && n > esq.maxLength) push('texto demasiado largo (máximo ' + esq.maxLength + ', tiene ' + n + ')');
    if (esq.pattern !== undefined && !regex(esq.pattern).test(valor)) {
      push(esq.pattern === RE.texto ? 'no puede contener los signos menor que ni mayor que (texto plano)' : 'formato no válido ' + corto(valor));
    }
  }
  if (Array.isArray(valor)) {
    if (esq.minItems !== undefined && valor.length < esq.minItems) push('debe tener al menos ' + esq.minItems + ' elemento(s)');
    if (esq.maxItems !== undefined && valor.length > esq.maxItems) push('debe tener como máximo ' + esq.maxItems + ' elementos (tiene ' + valor.length + ')');
    if (esq.uniqueItems) {
      for (let i = 0; i < valor.length; i++) for (let j = 0; j < i; j++) {
        if (igual(valor[i], valor[j])) { push('elementos repetidos: [' + j + '] y [' + i + '] ' + corto(valor[i])); i = valor.length; break; }
      }
    }
    if (esq.items) for (let i = 0; i < valor.length; i++) validarEsquema(valor[i], esq.items, raiz, segmento(ruta, i, valor[i]), salida);
  }
  if (esObjeto(valor)) {
    const props = esq.properties || {};
    if (esq.required) for (const k of esq.required) if (!Object.prototype.hasOwnProperty.call(valor, k)) push('falta el campo obligatorio "' + k + '"');
    for (const k of Object.keys(valor)) {
      if (esq.propertyNames) {
        const e2 = [];
        validarEsquema(k, esq.propertyNames, raiz, ruta, e2);
        if (e2.length) { push('nombre de campo no permitido ' + corto(k)); continue; }
      }
      if (Object.prototype.hasOwnProperty.call(props, k)) validarEsquema(valor[k], props[k], raiz, ruta + '.' + k, salida);
      else if (esq.additionalProperties === false) push('campo no permitido ' + corto(k));
      else if (esObjeto(esq.additionalProperties)) validarEsquema(valor[k], esq.additionalProperties, raiz, ruta + '.' + k, salida);
    }
  }
  if (esq.oneOf) {
    const res = esq.oneOf.map(function (s) { const e = []; validarEsquema(valor, s, raiz, ruta, e); return e; });
    const validos = res.filter(function (r) { return r.length === 0; }).length;
    if (validos === 0) {
      let idx = -1;
      if (esObjeto(valor)) {
        idx = esq.oneOf.findIndex(function (s0) {
          const s = s0.$ref ? resolverRef(raiz, s0.$ref) : s0;
          const p = (s && s.properties) || {};
          return Object.keys(p).some(function (k) { return Object.prototype.hasOwnProperty.call(p[k], 'const') && igual(valor[k], p[k].const); });
        });
      }
      if (idx >= 0) res[idx].forEach(function (m) { salida.push(m); });
      else push('no coincide con ningún tipo permitido ' + corto(valor && valor.tipo !== undefined ? valor.tipo : valor));
    } else if (validos > 1) push('coincide con más de un tipo');
  }
}

// ---------- Validador principal ----------
function validar(docs, opciones) {
  docs = docs || {};
  opciones = opciones || {};
  const errores = [], avisos = [];
  const err = function (cod, ruta, msg) { errores.push('[' + cod + '] ' + ruta + ': ' + msg); };
  const avi = function (cod, ruta, msg) { avisos.push('[' + cod + '] ' + ruta + ': ' + msg); };
  const datos = {};
  const bytes = {};
  const NOMBRES = ['products', 'articles', 'site', 'chat'];
  let recibidos = 0;

  for (const nombre of NOMBRES) {
    let doc = docs[nombre];
    if (doc === undefined || doc === null) continue;
    recibidos++;
    let texto = null;
    if (typeof doc === 'string') {
      texto = doc;
      try { doc = JSON.parse(texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto); } catch (e) { err('json', nombre, 'no es JSON válido (' + String(e.message || e).replace(/[<>]/g, '?').slice(0, 120) + ')'); continue; }
    }
    if (!esObjeto(doc)) { err('json', nombre, 'debe ser un objeto JSON (es ' + tipoDe(doc) + ')'); continue; }
    const serial = serializar(doc);
    bytes[nombre] = Math.max(bytesUtf8(serial), texto !== null ? bytesUtf8(texto) : 0);
    if (bytes[nombre] >= LIMITE_BYTES) err('tamano', nombre, 'pesa ' + bytes[nombre] + ' bytes; debe pesar menos de ' + LIMITE_BYTES + ' (1 MB)');
    revisarSecretos(texto !== null ? texto + '\n' + serial : serial, nombre, err);
    revisarCadenas(doc, nombre, err);
    const eEsq = [];
    validarEsquema(doc, ESQUEMAS[nombre], ESQUEMAS[nombre], nombre, eEsq);
    for (const m of eEsq) errores.push('[esquema] ' + m);
    datos[nombre] = doc;
  }
  if (!recibidos) err('entrada', 'docs', 'no se recibió ningún documento (products, articles, site o chat)');

  const P = datos.products && Array.isArray(datos.products.productos) ? datos.products.productos : null;
  const AR = datos.articles && Array.isArray(datos.articles.articulos) ? datos.articles.articulos : null;
  const S = datos.site || null;
  if (P) reglasProductos(P, err, avi);
  if (AR) reglasArticulos(AR, err, avi);
  if (S) reglasSitio(S, err, avi);
  if (datos.chat) reglasChat(datos.chat, err, avi);
  reglasReferencias(P, AR, S, err, avi);
  if (opciones.anterior) limitesDeDano(datos, opciones, err, avi);

  const resumen = {
    contrato: CONTRATO_VERSION,
    productos: P ? P.length : null,
    productos_activos: P ? P.filter(function (p) { return esObjeto(p) && p.activo === true; }).length : null,
    productos_muestra: P ? P.filter(function (p) { return esObjeto(p) && p.muestra === true; }).length : null,
    articulos: AR ? AR.length : null,
    chat_activo: datos.chat ? datos.chat.activo === true : null,
    bytes: bytes
  };
  return { ok: errores.length === 0, errores: errores, avisos: avisos, resumen: resumen };
}

function revisarSecretos(texto, nombre, err) {
  for (const p of PATRONES_SECRETO) if (p.re.test(texto)) err('secreto', nombre, 'contiene algo con forma de ' + p.nombre + '; nunca se publica un secreto');
}
function revisarCadenas(v, ruta, err) {
  if (typeof v === 'string') {
    if (/[<>]/.test(v)) err('html', ruta, 'contiene signos menor/mayor que; los textos son texto plano');
    if (/^\s*(javascript|vbscript|data|file):/i.test(v)) err('enlace', ruta, 'esquema de URL no permitido ' + corto(v.slice(0, 20)));
    return;
  }
  if (Array.isArray(v)) { v.forEach(function (x, i) { revisarCadenas(x, segmento(ruta, i, x), err); }); return; }
  if (esObjeto(v)) for (const k of Object.keys(v)) {
    if (/[<>]/.test(k)) err('html', ruta, 'un nombre de campo contiene signos menor/mayor que');
    revisarCadenas(v[k], ruta + '.' + k.replace(/[<>]/g, '?').slice(0, 40), err);
  }
}
function dosDecimales(n) { return Math.abs(Math.round(n * 100) - n * 100) < 1e-6; }
function revisarImagen(img, ruta, esProducto, muestra, err, avi) {
  if (!esObjeto(img) || typeof img.src !== 'string') return;
  const enPlaceholders = img.src.indexOf('assets/img/placeholders/') === 0;
  if (img.origen === 'placeholder' && !enPlaceholders) err('imagen_ruta', ruta, 'origen "placeholder" debe estar en assets/img/placeholders/');
  if (img.origen !== 'placeholder' && enPlaceholders) err('imagen_ruta', ruta, 'una imagen en assets/img/placeholders/ debe tener origen "placeholder"');
  // v2: la web es una demo privada; "ia_local" ya no exige muestra:true (se quitó el código imagen_origen).
}
function sumaEnteros(o) {
  let suma = 0;
  for (const k of Object.keys(o)) { const v = o[k]; if (!Number.isInteger(v) || v < 0) return null; suma += v; }
  return suma;
}
function revisarUnicos(lista, campo, codigo, rutaBase, err) {
  const visto = {};
  lista.forEach(function (x, i) {
    if (!esObjeto(x) || typeof x[campo] !== 'string') return;
    const v = x[campo];
    if (Object.prototype.hasOwnProperty.call(visto, v)) err(codigo, segmento(rutaBase, i, x), campo + ' ' + corto(v) + ' repetido (ya está en [' + visto[v] + '])');
    else visto[v] = i;
  });
}
function reglasProductos(P, err, avi) {
  revisarUnicos(P, 'id', 'id_duplicado', 'products.productos', err);
  revisarUnicos(P, 'slug', 'slug_duplicado', 'products.productos', err);
  const ahora = Date.now();
  P.forEach(function (p, i) {
    if (!esObjeto(p)) return;
    const r = segmento('products.productos', i, p);
    const num = function (v) { return typeof v === 'number' && Number.isFinite(v); };
    if (num(p.precio) && !dosDecimales(p.precio)) err('precio', r + '.precio', 'máximo 2 decimales');
    if (num(p.precio_oferta)) {
      if (!dosDecimales(p.precio_oferta)) err('precio', r + '.precio_oferta', 'máximo 2 decimales');
      if (num(p.precio) && p.precio_oferta >= p.precio) err('precio_oferta', r, 'precio_oferta (' + soles(p.precio_oferta) + ') debe ser menor que precio (' + soles(p.precio) + ')');
      else if (num(p.precio) && p.precio_oferta < p.precio * 0.3) avi('descuento', r, 'descuento mayor al 70 %: confirma que no es un error');
    }
    const permitidas = TALLAS_POR_CATEGORIA[p.categoria];
    const tallas = Array.isArray(p.tallas) ? p.tallas.filter(function (t) { return typeof t === 'string'; }) : null;
    if (permitidas && tallas) for (const t of tallas) {
      if (TALLAS.indexOf(t) >= 0 && permitidas.indexOf(t) < 0) err('talla_categoria', r + '.tallas', 'la talla ' + corto(t) + ' no corresponde a la categoría "' + p.categoria + '" (permitidas: ' + permitidas.join(' ') + ')');
    }
    // Colores: nombres únicos (stock_por_color e imagenes[].color se indexan por nombre).
    const nombresColor = Array.isArray(p.colores) ? p.colores.map(function (c) { return esObjeto(c) && typeof c.nombre === 'string' ? c.nombre : null; }).filter(Boolean) : null;
    if (nombresColor) {
      const norm = nombresColor.map(function (n) { return quitarTildes(n).toLowerCase().trim(); });
      if (new Set(norm).size !== norm.length) err('color_duplicado', r + '.colores', 'hay nombres de color repetidos (sin contar mayúsculas ni tildes)');
    }
    // Regla de stock v2: stock_por_color manda (stock = su suma); stock_por_talla es opcional.
    const spc = esObjeto(p.stock_por_color) ? p.stock_por_color : null;
    const spt = esObjeto(p.stock_por_talla) ? p.stock_por_talla : null;
    if (tallas && spt) {
      const claves = Object.keys(spt);
      for (const t of tallas) if (claves.indexOf(t) < 0) err('stock', r + '.stock_por_talla', 'falta la talla ' + corto(t));
      for (const k of claves) if (tallas.indexOf(k) < 0) err('stock', r + '.stock_por_talla', 'tiene la talla ' + corto(k) + ', que no está en tallas');
    }
    if (spc && nombresColor) {
      const claves = Object.keys(spc);
      for (const n of nombresColor) if (claves.indexOf(n) < 0) err('stock', r + '.stock_por_color', 'falta el color ' + corto(n) + ' (una clave por cada color de "colores", con el nombre exacto)');
      for (const k of claves) if (nombresColor.indexOf(k) < 0) err('stock', r + '.stock_por_color', 'tiene el color ' + corto(k) + ', que no está en colores');
    }
    if (!spc && !spt) err('stock', r, 'falta stock_por_color (o stock_por_talla en formato v1)');
    const suma = spc ? sumaEnteros(spc) : spt ? sumaEnteros(spt) : null;
    const fuente = spc ? 'stock_por_color' : 'stock_por_talla';
    if (suma !== null && Number.isInteger(p.stock) && suma !== p.stock) err('stock', r + '.stock', 'stock (' + p.stock + ') no coincide con la suma de ' + fuente + ' (' + suma + ')');
    if (suma !== null && p.activo === true && suma === 0) avi('agotado', r, 'producto activo sin stock: la web lo mostrará "Agotado"');
    if (spc && spt && suma > 0 && sumaEnteros(spt) === 0) avi('stock', r + '.stock_por_talla', 'todas las tallas están en 0 aunque stock_por_color suma ' + suma);
    if (!spc && spt) avi('stock_color', r, 'sin stock_por_color (formato v1): la web no puede mostrar la disponibilidad por color');
    // Frescura: si falta, la web la infiere con la misma tabla (avisa si tampoco se puede inferir).
    if (p.frescura === undefined && p.activo === true) {
      const f = inferirFrescura(p);
      if (f.valor === null) avi('frescura', r, 'sin índice de frescura y el material no está en la tabla: la web no mostrará hojitas');
    }
    const fc = Date.parse(p.fecha_creacion), fa = Date.parse(p.fecha_actualizacion);
    if (typeof p.fecha_creacion === 'string' && isNaN(fc)) err('fecha', r + '.fecha_creacion', 'fecha no válida');
    if (typeof p.fecha_actualizacion === 'string' && isNaN(fa)) err('fecha', r + '.fecha_actualizacion', 'fecha no válida');
    if (!isNaN(fc) && !isNaN(fa) && fa < fc) err('fecha', r, 'fecha_actualizacion es anterior a fecha_creacion');
    if (!isNaN(fc) && fc > ahora + 86400000) avi('fecha', r + '.fecha_creacion', 'está en el futuro');
    if (Array.isArray(p.imagenes)) {
      p.imagenes.forEach(function (img, j) {
        revisarImagen(img, r + '.imagenes[' + j + ']', true, p.muestra, err, avi);
        if (esObjeto(img) && typeof img.color === 'string' && nombresColor && nombresColor.indexOf(img.color) < 0) {
          err('imagen_color', r + '.imagenes[' + j + '].color', 'el color ' + corto(img.color) + ' no está en colores (' + nombresColor.join(', ') + ')');
        }
      });
      if (p.activo === true && p.imagenes.length === 0) avi('sin_imagen', r, 'producto activo sin imagen: la web usará un marcador');
      const conColor = p.imagenes.filter(function (img) { return esObjeto(img) && typeof img.color === 'string'; }).map(function (img) { return img.color; });
      if (conColor.length && nombresColor) nombresColor.forEach(function (n) {
        if (conColor.indexOf(n) < 0) avi('imagen_color', r, 'el color ' + corto(n) + ' no tiene foto: la web mostrará la foto principal');
      });
    }
  });
}
function reglasArticulos(AR, err, avi) {
  revisarUnicos(AR, 'id', 'id_duplicado', 'articles.articulos', err);
  revisarUnicos(AR, 'slug', 'slug_duplicado', 'articles.articulos', err);
  AR.forEach(function (a, i) {
    if (!esObjeto(a)) return;
    const r = segmento('articles.articulos', i, a);
    if (esObjeto(a.portada)) revisarImagen(a.portada, r + '.portada', false, a.muestra, err, avi);
    const f = Date.parse(a.fecha), fa = Date.parse(a.fecha_actualizacion);
    if (typeof a.fecha === 'string' && isNaN(f)) err('fecha', r + '.fecha', 'fecha no válida');
    if (typeof a.fecha_actualizacion === 'string' && !isNaN(f) && !isNaN(fa) && fa < f) err('fecha', r, 'fecha_actualizacion es anterior a fecha');
    if (Array.isArray(a.bloques) && !a.bloques.some(function (b) { return esObjeto(b) && b.tipo === 'parrafo'; })) avi('bloques', r, 'el artículo no tiene ningún párrafo');
  });
}
function reglasSitio(S, err, avi) {
  const w = S.whatsapp;
  if (typeof w === 'string') {
    if (w === '') avi('whatsapp', 'site.whatsapp', 'vacío: la web oculta los botones de pedido');
    else if (!/^51\d{9}$/.test(w)) err('whatsapp', 'site.whatsapp', 'debe cumplir ^51\\d{9}$ (51 + 9 dígitos, sin +, espacios ni guiones) y es ' + corto(w));
    else {
      if (WHATSAPP_EJEMPLO.indexOf(w) >= 0) err('whatsapp', 'site.whatsapp', 'es un número de ejemplo; nunca se publica (D13)');
      if (w.charAt(2) !== '9') avi('whatsapp', 'site.whatsapp', 'los celulares de Perú empiezan con 9 después del 51');
    }
    if (typeof S.telefono_visible === 'string') {
      const dig = S.telefono_visible.replace(/\D/g, '');
      const esperado = w === '' ? '' : w;
      if (dig !== esperado && !(w !== '' && dig === w.slice(2))) err('whatsapp', 'site.telefono_visible', 'no coincide con site.whatsapp (' + corto(S.telefono_visible) + ' vs ' + corto(w) + ')');
    }
  }
  if (Array.isArray(S.redes)) S.redes.forEach(function (red, i) {
    if (!esObjeto(red) || typeof red.url !== 'string') return;
    const h = hostHttps(red.url);
    const ruta = 'site.redes[' + i + ']';
    if (!h) { err('enlace', ruta, 'solo se permiten enlaces https:// válidos ' + corto(red.url.slice(0, 40))); return; }
    const permitidos = DOMINIOS_REDES[red.red];
    if (permitidos && permitidos.indexOf(h.host) < 0) err('enlace', ruta, 'el dominio ' + corto(h.host) + ' no corresponde a ' + red.red + ' (permitidos: ' + permitidos.join(', ') + ')');
  });
  if (esObjeto(S.mapa)) {
    const e = hostHttps(S.mapa.embed);
    if (typeof S.mapa.embed === 'string') {
      if (!e) err('enlace', 'site.mapa.embed', 'solo https:// válido');
      else if (!DOMINIOS_MAPA_EMBED[e.host] || e.ruta.indexOf(DOMINIOS_MAPA_EMBED[e.host]) !== 0) err('enlace', 'site.mapa.embed', 'solo se permite el embed de OpenStreetMap (www.openstreetmap.org/export/embed.html) o Google Maps (www.google.com/maps/embed)');
    }
    const l = hostHttps(S.mapa.enlace);
    if (typeof S.mapa.enlace === 'string') {
      if (!l) err('enlace', 'site.mapa.enlace', 'solo https:// válido');
      else if (DOMINIOS_MAPA_ENLACE.indexOf(l.host) < 0) err('enlace', 'site.mapa.enlace', 'dominio no permitido ' + corto(l.host));
    }
  }
  if (esObjeto(S.horario) && Array.isArray(S.horario.tramos)) S.horario.tramos.forEach(function (t, i) {
    if (esObjeto(t) && /^\d\d:\d\d$/.test(t.abre) && /^\d\d:\d\d$/.test(t.cierra) && t.abre >= t.cierra) err('horario', 'site.horario.tramos[' + i + ']', 'abre (' + t.abre + ') debe ser antes de cierra (' + t.cierra + ')');
  });
  if (Array.isArray(S.categorias)) {
    const ids = S.categorias.map(function (c) { return esObjeto(c) ? c.id : null; });
    for (const c of CATEGORIAS) if (ids.indexOf(c) < 0) err('categorias', 'site.categorias', 'falta la categoría "' + c + '"');
    S.categorias.forEach(function (c, i) { if (esObjeto(c) && esObjeto(c.imagen)) revisarImagen(c.imagen, 'site.categorias[' + i + '].imagen', false, null, err, avi); });
  }
  if (esObjeto(S.hero) && Array.isArray(S.hero.imagenes)) S.hero.imagenes.forEach(function (img, i) { revisarImagen(img, 'site.hero.imagenes[' + i + ']', false, null, err, avi); });
  if (Array.isArray(S.lookbook)) {
    revisarUnicos(S.lookbook, 'id', 'id_duplicado', 'site.lookbook', err);
    S.lookbook.forEach(function (l, i) { if (esObjeto(l) && esObjeto(l.imagen)) revisarImagen(l.imagen, segmento('site.lookbook', i, l) + '.imagen', false, null, err, avi); });
  }
  if (esObjeto(S.guia_tallas)) reglasGuiaTallas(S.guia_tallas, err, avi);
}
function reglasGuiaTallas(G, err, avi) {
  const base = 'site.guia_tallas';
  const zonas = Array.isArray(G.como_medir) ? G.como_medir.map(function (c) { return esObjeto(c) ? c.id : null; }) : [];
  if (Array.isArray(G.como_medir)) revisarUnicos(G.como_medir, 'id', 'id_duplicado', base + '.como_medir', err);
  if (!Array.isArray(G.tablas)) return;
  revisarUnicos(G.tablas, 'id', 'id_duplicado', base + '.tablas', err);
  G.tablas.forEach(function (t, i) {
    if (!esObjeto(t)) return;
    const r = base + '.tablas[' + i + ']';
    const n = Array.isArray(t.columnas) ? t.columnas.length : 0;
    if (n && Array.isArray(t.filas)) t.filas.forEach(function (f, j) {
      if (Array.isArray(f) && f.length !== n) err('guia_tallas', r + '.filas[' + j + ']', 'tiene ' + f.length + ' celdas y la tabla tiene ' + n + ' columnas');
    });
    if (Array.isArray(t.medidas)) t.medidas.forEach(function (m) {
      if (zonas.indexOf(m) < 0) err('guia_tallas', r + '.medidas', 'la medida ' + corto(m) + ' no está explicada en como_medir');
    });
  });
  for (const c of CATEGORIAS) if (!G.tablas.some(function (t) { return esObjeto(t) && t.categoria === c; })) avi('guia_tallas', base, 'la categoría "' + c + '" no tiene tabla de tallas');
}
function reglasChat(C, err, avi) {
  if (C.activo === true && C.url === '') err('chat', 'chat.url', 'activo:true necesita una url https://...trycloudflare.com');
  if (typeof C.url === 'string' && C.url !== '' && C.actualizado === '') avi('chat', 'chat.actualizado', 'hay url pero no fecha de actualización');
}
function reglasReferencias(P, AR, S, err, avi) {
  const citan = (AR && AR.length) || (S && Array.isArray(S.lookbook) && S.lookbook.length);
  if (!P) { if (citan) avi('referencia', 'products', 'no se recibió products.json: no se comprobaron las referencias a productos'); return; }
  const existe = {}, activo = {};
  P.forEach(function (p) { if (esObjeto(p) && typeof p.id === 'string') { existe[p.id] = true; if (p.activo === true) activo[p.id] = true; } });
  const revisar = function (id, ruta, quien) {
    if (typeof id !== 'string') return;
    if (!existe[id]) err('referencia', ruta, quien + ' cita el producto ' + corto(id) + ', que no existe');
    else if (!activo[id]) avi('referencia_inactiva', ruta, quien + ' cita el producto ' + corto(id) + ', que está oculto (activo:false)');
  };
  if (AR) AR.forEach(function (a, i) {
    if (!esObjeto(a)) return;
    const r = segmento('articles.articulos', i, a);
    const quien = idSeguro(a.id) || 'el artículo';
    if (Array.isArray(a.productos_relacionados)) a.productos_relacionados.forEach(function (id) { revisar(id, r + '.productos_relacionados', quien); });
    if (Array.isArray(a.bloques)) a.bloques.forEach(function (b, j) {
      if (esObjeto(b) && b.tipo === 'producto' && Array.isArray(b.ids)) b.ids.forEach(function (id) { revisar(id, r + '.bloques[' + j + ']', quien); });
    });
  });
  if (S && Array.isArray(S.lookbook)) S.lookbook.forEach(function (l, i) {
    if (esObjeto(l) && Array.isArray(l.productos)) l.productos.forEach(function (id) { revisar(id, segmento('site.lookbook', i, l) + '.productos', idSeguro(l.id) || 'el lookbook'); });
  });
}
function sinEnvoltura(doc) {
  const o = {};
  for (const k of Object.keys(doc || {})) if (['$schema', 'version', 'actualizado', 'borradores_aplicados'].indexOf(k) < 0) o[k] = doc[k];
  return o;
}
function porId(lista) {
  const m = {};
  (Array.isArray(lista) ? lista : []).forEach(function (x) { if (esObjeto(x) && typeof x.id === 'string' && !m[x.id]) m[x.id] = x; });
  return m;
}
function limitesDeDano(datos, opciones, err, avi) {
  const ant = {};
  for (const n of ['products', 'articles', 'site', 'chat']) {
    let d = opciones.anterior[n];
    if (typeof d === 'string') { try { d = JSON.parse(d.charCodeAt(0) === 0xfeff ? d.slice(1) : d); } catch (e) { err('anterior', n, 'la versión anterior no es JSON válido'); d = null; } }
    if (esObjeto(d)) ant[n] = d;
  }
  const lote = Array.isArray(opciones.idsLote) ? opciones.idsLote.map(String) : null;
  const limpieza = opciones.permitirLimpieza === true;
  const rol = opciones.rol;
  if (rol !== undefined && rol !== null && ROLES.indexOf(rol) < 0) err('permiso', 'opciones.rol', 'rol desconocido ' + corto(rol));
  if (limpieza && rol === 'marketing') err('permiso', 'opciones', 'el rol marketing no puede ejecutar /limpiar_muestras');

  const diffLista = function (nombre, campoLista, etiqueta) {
    if (!ant[nombre] || !datos[nombre]) return null;
    const a = porId(ant[nombre][campoLista]), b = porId(datos[nombre][campoLista]);
    const quitados = Object.keys(a).filter(function (id) { return !b[id]; });
    const nuevos = Object.keys(b).filter(function (id) { return !a[id]; });
    const cambiados = Object.keys(b).filter(function (id) { return a[id] && !igual(a[id], b[id]); });
    if (lote) for (const id of quitados.concat(nuevos, cambiados)) if (lote.indexOf(id) < 0) {
      err('fuera_de_lote', nombre, 'el cambio toca ' + corto(id) + ', que no está en el lote (' + (lote.join(', ') || 'vacío') + ')');
    }
    const activos = function (m) { return Object.keys(m).filter(function (id) { return m[id].activo === true; }); };
    const totA = Object.keys(a).length, totB = Object.keys(b).length;
    const actA = activos(a), actB = activos(b);
    if (!limpieza) {
      if (totA - totB > 1) err('borrado_masivo', nombre, 'pasa de ' + totA + ' a ' + totB + ' ' + etiqueta + '; máximo 1 menos por operación (salvo /limpiar_muestras)');
      if (actA.length - actB.length > 1) err('borrado_masivo', nombre, etiqueta + ' activos pasan de ' + actA.length + ' a ' + actB.length + '; máximo 1 menos por operación (salvo /limpiar_muestras)');
    } else {
      const afectados = quitados.concat(actA.filter(function (id) { return b[id] && b[id].activo !== true; }));
      for (const id of afectados) if (a[id].muestra !== true) err('limpieza', nombre, '/limpiar_muestras solo puede quitar contenido de muestra; ' + corto(id) + ' es real');
    }
    if (quitados.length && rol === 'marketing') err('permiso', nombre, 'el rol marketing no puede borrar (' + quitados.join(', ') + ')');
    for (const id of cambiados) {
      if (a[id].muestra === false && b[id].muestra === true) err('muestra', nombre + ' ' + id, 'un registro real no puede volver a ser muestra');
      if (campoLista === 'productos' && a[id].fecha_creacion !== b[id].fecha_creacion) err('fecha', nombre + ' ' + id, 'fecha_creacion no se puede cambiar');
      if (a[id].slug !== b[id].slug) avi('slug', nombre + ' ' + id, 'cambiar el slug rompe los enlaces ya compartidos');
    }
    if (Number.isInteger(ant[nombre].version) && Number.isInteger(datos[nombre].version) && datos[nombre].version < ant[nombre].version) {
      avi('version', nombre, 'la versión retrocede (' + ant[nombre].version + ' a ' + datos[nombre].version + ')');
    }
    return { quitados: quitados, nuevos: nuevos, cambiados: cambiados };
  };
  diffLista('products', 'productos', 'productos');
  diffLista('articles', 'articulos', 'artículos');
  if (ant.site && datos.site) {
    const a = sinEnvoltura(ant.site), b = sinEnvoltura(datos.site);
    if (!igual(a, b)) {
      if (lote && lote.indexOf('site') < 0) err('fuera_de_lote', 'site', 'el cambio toca site.json, que no está en el lote (añade "site")');
      const cambia = function (k) { return !igual(a[k], b[k]); };
      if ((cambia('whatsapp') || cambia('telefono_visible')) && rol === 'marketing') err('permiso', 'site.whatsapp', 'el rol marketing no puede cambiar el WhatsApp');
      if (cambia('whatsapp')) avi('whatsapp_cambio', 'site.whatsapp', 'cambia de ' + corto(a.whatsapp) + ' a ' + corto(b.whatsapp) + ': requiere confirmación especial');
      const deDatos = ['nombre', 'lema', 'ciudad', 'region', 'pais', 'direccion', 'horario', 'envio', 'zonas_reparto', 'metodos_pago', 'redes', 'mapa', 'testimonios', 'guia_tallas', 'mensajes'];
      if (rol === 'marketing' && deDatos.some(cambia)) err('permiso', 'site', 'el rol marketing solo puede cambiar imágenes del sitio (hero, categorías, lookbook)');
    }
  }
  if (ant.chat && datos.chat && !igual(ant.chat, datos.chat)) {
    if (lote && lote.indexOf('chat') < 0) err('fuera_de_lote', 'chat', 'el cambio toca chat.json, que no está en el lote (añade "chat")');
    if (rol === 'marketing') err('permiso', 'chat', 'el rol marketing no puede cambiar chat.json');
  }
}

// ---------- Ayudas para WF3/WF4 (operación del LLM, permisos, ids) ----------
// Reglas de categoría (también van en el prompt). Devuelve la categoría que el TEXTO del dueño
// impone sin ambigüedad, o null si no hay palabra clave clara.
function inferirCategoria(texto) {
  const t = ' ' + quitarTildes(String(texto || '')).toLowerCase() + ' ';
  const hay = function (re) { return re.test(t); };
  if (hay(/\b(nin[oa]s?|infantil(es)?|bebes?|nen[ae]s?|kids?|escolar(es)?|junior)\b/)) return 'ninos';
  if (hay(/\b(gorras?|gorros?|sombreros?|bolsos?|carteras?|lentes|gafas|mochilas?|correas?|cinturon(es)?|billeteras?|canguros?)\b/)) return 'accesorios';
  const mujer = hay(/\b(damas?|mujer(es)?|senoras?|senoritas?|femenin[oa]s?)\b/);
  const hombre = hay(/\b(caballeros?|hombres?|varon(es)?|masculin[oa]s?)\b/);
  if (mujer && !hombre) return 'mujeres';
  if (hombre && !mujer) return 'hombres';
  if (!mujer && !hombre && hay(/\b(sandalias?|chancletas?|ojotas?)\b/)) return 'accesorios';
  return null;
}
// Valida la salida del LLM (después de Ollama, antes de crear el borrador). No escribe nada.
// contexto: { texto, hayFoto, productos (lista actual), articulos (lista actual) }
function validarOperacion(salida, contexto) {
  contexto = contexto || {};
  const errores = [], avisos = [];
  let op = salida;
  if (typeof op === 'string') { try { op = JSON.parse(op); } catch (e) { return { ok: false, errores: ['[llm] la salida no es JSON válido'], avisos: avisos, faltantes: [], operacion: null }; } }
  if (!esObjeto(op)) return { ok: false, errores: ['[llm] la salida debe ser un objeto'], avisos: avisos, faltantes: [], operacion: null };
  op = JSON.parse(JSON.stringify(op));
  const esArticulo = op.entidad === 'articulo';
  const esquema = esArticulo ? ESQUEMA_LLM_ARTICULO : ESQUEMA_LLM_PRODUCTO;
  // Tolerancia: campos ausentes = sin dato (útil si la salida viene de otro extractor sin "format").
  if (esObjeto(op.campos)) {
    const props = esquema.properties.campos.properties;
    for (const k of Object.keys(props)) if (!Object.prototype.hasOwnProperty.call(op.campos, k)) op.campos[k] = props[k].type === 'array' ? [] : null;
  }
  if (op.campos_inferidos === undefined) op.campos_inferidos = [];
  if (op.faltantes === undefined) op.faltantes = [];
  const e1 = [];
  validarEsquema(op, esquema, esquema, 'llm', e1);
  e1.forEach(function (m) { errores.push('[llm] ' + m); });
  if (errores.length) return { ok: false, errores: errores, avisos: avisos, faltantes: [], operacion: op };
  const c = op.campos;
  const faltantes = new Set(Array.isArray(op.faltantes) ? op.faltantes : []);
  const inferidos = new Set(Array.isArray(op.campos_inferidos) ? op.campos_inferidos : []);
  const lista = esArticulo ? contexto.articulos : contexto.productos;
  const reId = esArticulo ? /^art-\d{4,6}$/ : /^prd-\d{4,6}$/;
  let reintentar = null;
  // Un 4B tiende a "actualizar" un producto parecido del catálogo cuando el dueño describe uno NUEVO.
  // Si el texto no trae ningún id ni un verbo de cambio, se fuerza "crear" y se pide repetir la llamada.
  if (!esArticulo && op.op !== 'crear' && typeof contexto.texto === 'string' && !pideCambio(contexto.texto)) {
    avisos.push('[op_corregida] el mensaje no menciona un id ni pide un cambio: se trata como producto nuevo (el LLM propuso ' + op.op + ' ' + corto(op.id) + ')');
    op.op = 'crear'; op.id = null; reintentar = 'crear';
  }
  if (op.op === 'crear') {
    if (op.id !== null) { avisos.push('[llm] op=crear no lleva id: se ignora ' + corto(op.id)); op.id = null; }
    faltantes.delete('id'); faltantes.delete('foto');
  } else {
    if (typeof op.id !== 'string' || !reId.test(op.id)) { faltantes.add('id'); }
    else if (Array.isArray(lista) && !lista.some(function (x) { return esObjeto(x) && x.id === op.id; })) errores.push('[llm] el id ' + corto(op.id) + ' no existe en el catálogo');
  }
  const vacio = function (v) { return v === null || v === undefined || (Array.isArray(v) && v.length === 0); };
  const vaciar = function (k) { c[k] = Array.isArray(c[k]) ? [] : null; inferidos.delete(k); };
  if (!esArticulo) {
    // Normalización determinista: cada op solo conserva los campos que le corresponden.
    const conservar = { desactivar: [], reactivar: [], stock: ['stock_tallas', 'stock_por_color', 'stock_modo'], agregar_imagen: ['alt_imagen'] }[op.op];
    if (conservar) for (const k of CAMPOS_LLM_PRODUCTO) if (conservar.indexOf(k) < 0 && !vacio(c[k])) vaciar(k);
    const actual = typeof op.id === 'string' && Array.isArray(lista) ? lista.find(function (x) { return esObjeto(x) && x.id === op.id; }) : null;
    if (op.op === 'actualizar' && actual) {
      for (const k of ['nombre', 'categoria', 'subcategoria', 'precio', 'precio_oferta', 'tallas', 'material', 'frescura', 'descripcion', 'etiquetas', 'destacado']) {
        if (!vacio(c[k]) && igual(c[k], actual[k])) vaciar(k);
      }
      const nombresColor = function (l) { return (l || []).map(function (x) { return quitarTildes(esObjeto(x) ? x.nombre : x).toLowerCase(); }).sort().join('|'); };
      if (!vacio(c.colores) && nombresColor(c.colores) === nombresColor(actual.colores)) vaciar('colores');
      if (!vacio(c.stock_tallas)) vaciar('stock_tallas');
      if (!vacio(c.stock_por_color)) vaciar('stock_por_color');
      if (c.stock_modo !== null) vaciar('stock_modo');
      // v2: si cambia la tela y nadie dijo la frescura, se sugiere con la tabla por material.
      if (!vacio(c.material) && (c.frescura === null || inferidos.has('frescura'))) {
        const f = frescuraPorMaterial(c.material);
        if (f !== null && f !== actual.frescura) { c.frescura = f; inferidos.add('frescura'); avisos.push('[frescura] cambia la tela: se sugiere frescura ' + f + ' (tabla por material)'); }
        else if (f !== null) vaciar('frescura');
      }
    }
    if (op.op === 'crear' && c.stock_modo !== null) vaciar('stock_modo');
    if (op.op === 'stock' && (!vacio(c.stock_tallas) || !vacio(c.stock_por_color)) && c.stock_modo === null) {
      c.stock_modo = 'fijar'; avisos.push('[stock] no queda claro si es la cantidad total o lo que llegó: se asume cantidad total');
    }
    if (op.op !== 'crear' && typeof op.id === 'string' && typeof contexto.texto === 'string' && contexto.texto.indexOf(op.id) < 0) {
      avisos.push('[id_inferido] el mensaje no menciona ' + corto(op.id) + ': confirma que no es un producto nuevo');
    }
    const cat = inferirCategoria(contexto.texto);
    if (cat && c.categoria !== cat && (op.op === 'crear' || c.categoria !== null)) {
      avisos.push('[categoria] el texto indica "' + cat + '" y el LLM propuso ' + corto(c.categoria) + ': se corrige a "' + cat + '"');
      c.categoria = cat; inferidos.delete('categoria');
    }
    const num = function (v) { return typeof v === 'number' && Number.isFinite(v); };
    if (c.precio !== null && (!num(c.precio) || c.precio <= 0 || c.precio > 9999)) errores.push('[llm] precio fuera de rango ' + corto(c.precio));
    // precio_oferta 0 en "actualizar" = quitar la oferta (convención de CONTRATO.md)
    if (c.precio_oferta !== null && (!num(c.precio_oferta) || c.precio_oferta < 0 || (c.precio_oferta === 0 && op.op !== 'actualizar'))) errores.push('[llm] precio_oferta fuera de rango ' + corto(c.precio_oferta));
    if (num(c.precio) && num(c.precio_oferta) && c.precio_oferta > 0 && c.precio_oferta >= c.precio) errores.push('[precio_oferta] la oferta (' + soles(c.precio_oferta) + ') debe ser menor que el precio (' + soles(c.precio) + ')');
    if (c.categoria && Array.isArray(c.tallas)) {
      const malas = c.tallas.filter(function (t) { return TALLAS_POR_CATEGORIA[c.categoria].indexOf(t) < 0; });
      if (malas.length) errores.push('[talla_categoria] tallas ' + malas.join(' ') + ' no corresponden a "' + c.categoria + '"');
    }
    if (Array.isArray(c.stock_tallas)) c.stock_tallas.forEach(function (s) {
      if (!Number.isInteger(s.cantidad) || s.cantidad < 0 || s.cantidad > 9999) errores.push('[stock] cantidad no válida para la talla ' + corto(s.talla));
    });
    if (Array.isArray(c.stock_por_color)) c.stock_por_color.forEach(function (s) {
      if (!Number.isInteger(s.cantidad) || s.cantidad < 0 || s.cantidad > MAX_STOCK_COLOR) errores.push('[stock] cantidad no válida para el color ' + corto(s.color) + ': debe ser un entero de 0 a ' + MAX_STOCK_COLOR);
    });
    if (op.op === 'crear' && !vacio(c.stock_por_color)) {
      // Un color que solo aparece en el stock se añade a colores; un color sin cantidad empieza en 0.
      const claves = c.colores.map(claveColor);
      c.stock_por_color.forEach(function (s) {
        if (claves.indexOf(claveColor(s.color)) < 0 && String(s.color || '').trim()) { c.colores.push(s.color); claves.push(claveColor(s.color)); avisos.push('[colores] se añade el color ' + corto(s.color) + ', que aparece en el stock'); }
      });
      const conStock = c.stock_por_color.map(function (s) { return claveColor(s.color); });
      c.colores.forEach(function (n) { if (conStock.indexOf(claveColor(n)) < 0) avisos.push('[stock] el color ' + corto(n) + ' no tiene cantidad: empezará en 0'); });
    }
    if (op.op === 'stock' && actual && !vacio(c.stock_por_color)) {
      aplicarStockColor(actual, c.stock_por_color, c.stock_modo || 'fijar').errores.forEach(function (e) { errores.push(e); });
    }
    if (op.op === 'crear') {
      // v2: frescura determinista por material (tabla única); si el dueño la dijo, se respeta.
      if (c.frescura === null || inferidos.has('frescura')) {
        const f = inferirFrescura({ material: c.material, nombre: c.nombre, etiquetas: c.etiquetas });
        if (f.valor !== null) {
          if (c.frescura !== null && c.frescura !== f.valor) avisos.push('[frescura] se usa la tabla por material (' + f.valor + ') en vez de ' + c.frescura);
          c.frescura = f.valor; inferidos.add('frescura');
        } else if (c.frescura !== null) inferidos.add('frescura');
        else avisos.push('[frescura] no se reconoce la tela: no se pudo sugerir el índice de frescura (puedes decir "frescura 4")');
      }
      faltantes.delete('frescura'); faltantes.delete('stock_por_color'); faltantes.delete('stock_tallas');
      if (vacio(c.stock_por_color) && vacio(c.stock_tallas)) avisos.push('[stock] sin cantidades: cada color empezará con ' + STOCK_COLOR_ASUMIDO + ' (corrígelo con /stock)');
      if (!c.nombre) faltantes.add('nombre');
      if (!c.categoria) faltantes.add('categoria');
      if (!num(c.precio)) faltantes.add('precio');
      if ((!c.tallas || !c.tallas.length) && c.categoria === 'accesorios' && ['bolsos', 'lentes', 'gorras', 'sombreros', 'otros'].indexOf(c.subcategoria) >= 0) {
        c.tallas = ['UNICA']; inferidos.add('tallas'); avisos.push('[tallas] accesorio sin tallas: se asume talla única');
      }
      if (!c.tallas || !c.tallas.length) faltantes.add('tallas');
      if (!c.colores || !c.colores.length) faltantes.add('colores');
      if (!contexto.hayFoto) avisos.push('[foto] producto sin foto: la web mostrará un marcador hasta que envíes /foto');
    }
    if (op.op === 'stock' && vacio(c.stock_tallas) && vacio(c.stock_por_color)) faltantes.add('stock_por_color');
    if (op.op === 'agregar_imagen' && !contexto.hayFoto) faltantes.add('foto');
    if (op.op === 'actualizar' && CAMPOS_LLM_PRODUCTO.every(function (k) { return vacio(c[k]); })) {
      faltantes.add('campos'); avisos.push('[llm] op=actualizar sin ningún campo que cambiar');
    }
  } else if (op.op === 'crear') {
    if (!c.titulo) faltantes.add('titulo');
    if (!c.bloques || !c.bloques.length) faltantes.add('bloques');
    if (Array.isArray(c.productos_relacionados) && Array.isArray(contexto.productos)) {
      c.productos_relacionados = c.productos_relacionados.filter(function (id) {
        const ok = contexto.productos.some(function (p) { return esObjeto(p) && p.id === id; });
        if (!ok) avisos.push('[referencia] se quita ' + corto(id) + ' de productos_relacionados: no existe');
        return ok;
      });
    }
  }
  for (const k of Object.keys(c)) if (/[<>]/.test(JSON.stringify(c[k]) || '')) errores.push('[html] el campo ' + k + ' contiene signos menor/mayor que');
  revisarSecretos(JSON.stringify(op), 'llm', function (cod, ruta, msg) { errores.push('[' + cod + '] ' + ruta + ': ' + msg); });
  op.faltantes = Array.from(faltantes);
  op.campos_inferidos = Array.from(inferidos);
  return { ok: errores.length === 0, errores: errores, avisos: avisos, faltantes: op.faltantes, operacion: op, reintentar: reintentar };
}
// ¿El texto del dueño menciona un id o pide cambiar algo que ya existe? (si no, es un producto nuevo)
function pideCambio(texto) {
  const t = ' ' + quitarTildes(String(texto || '')).toLowerCase() + ' ';
  if (/\b(prd|art)-\d{4,6}\b/.test(t)) return true;
  return /\b(cambi\w*|actualiz\w*|modific\w*|corrig\w*|edit\w*|sub[ei]\w*|baj[ae]\w*|rebaj\w*|ahora|ocult\w*|quit\w*|retir\w*|reactiv\w*|desactiv\w*|vuelve|volver|llegaron|llego|quedan?|vend\w*|agotad\w*|no hay|agreg\w*|anad\w*|ponle|ponga|pon)\b/.test(t);
}
// Permisos por rol. accion: crear|actualizar|desactivar|reactivar|stock|agregar_imagen|publicar|imagen|articulo|consulta
//   |whatsapp|limpiar_muestras|borrar|deshacer|pausa|reanudar|sitio_datos
function puede(rol, accion) {
  if (rol === 'admin' || rol === 'dueno') return true;
  if (rol === 'marketing') return PROHIBIDO_MARKETING.indexOf(accion) < 0;
  return false;
}
function slugificar(texto) {
  return quitarTildes(String(texto || '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}
function siguienteId(lista, prefijo) {
  const re = new RegExp('^' + prefijo + '-(\\d{4,6})$');
  let max = 0;
  (Array.isArray(lista) ? lista : []).forEach(function (x) { const m = esObjeto(x) && typeof x.id === 'string' ? re.exec(x.id) : null; if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return prefijo + '-' + String(max + 1).padStart(4, '0');
}
// Nombre de color (lo que dice el dueño o el LLM) -> {nombre, hex}. Desconocido: hex neutro y aviso en la vista previa.
const COLORES = {
  'arena': '#E8DCC4', 'beige': '#D9C7A7', 'crema': '#F3E9D2', 'blanco': '#FFFFFF', 'blanco hueso': '#F4F1E8', 'hueso': '#F4F1E8',
  'negro': '#1F1F1F', 'gris': '#8C8C8C', 'plomo': '#6E6E6E', 'verde': '#2E7D4F', 'verde palma': '#0F5C46', 'verde oliva': '#6B7B3A',
  'oliva': '#6B7B3A', 'verde agua': '#7FD1C1', 'turquesa': '#14A3A0', 'azul laguna': '#14A3A0', 'celeste': '#A9D8E8', 'azul': '#1F4E9C',
  'azul marino': '#1B2A4A', 'marino': '#1B2A4A', 'naranja': '#F57C20', 'mango': '#FF8A1F', 'amarillo': '#F7D038', 'amarillo sol': '#FFD23F',
  'mostaza': '#C9A227', 'rojo': '#C62828', 'hibisco': '#C41E50', 'fucsia': '#D81B7A', 'rosado': '#F4A6B8', 'rosa': '#F4A6B8',
  'rosa guayaba': '#F2A7B5', 'lila': '#B8A2D6', 'morado': '#6A3D9A', 'terracota': '#C0603A', 'ladrillo': '#A9442B', 'marron': '#6B4226',
  'cafe': '#6B4226', 'cacao': '#5A3825', 'camel': '#C19A6B', 'natural': '#D8C3A0', 'coral': '#F07C6C', 'vino': '#7B1E3A', 'guinda': '#7B1E3A'
};
function colorHex(nombre) {
  const limpio = quitarTildes(String(nombre || '')).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const base = limpio.replace(/s$/, '').replace(/ (claro|oscuro)$/, '');
  const fem = base.replace(/a$/, 'o');
  const hex = COLORES[limpio] || COLORES[base] || COLORES[fem] || null;
  const visible = String(nombre || '').trim().slice(0, 24).replace(/[<>]/g, '');
  return { nombre: visible ? visible.charAt(0).toUpperCase() + visible.slice(1) : 'Sin color', hex: hex || '#CCCCCC', conocido: !!hex };
}
// ---------- v2: frescura, stock por color y guía de tallas ----------
// Índice de frescura (1–5) de un texto de material con TABLA_FRESCURA; null si no se reconoce.
function frescuraPorMaterial(texto) {
  if (texto === null || texto === undefined) return null;
  const t = quitarTildes(String(texto)).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (const f of TABLA_FRESCURA) if (regex(f.patron).test(t)) return f.valor;
  return null;
}
// Frescura de un producto: la guardada (1–5) o la inferida de material, nombre y etiquetas (en ese orden).
// Devuelve { valor, fuente: 'dato'|'material'|'nombre'|'etiquetas'|null }.
function inferirFrescura(p) {
  if (!esObjeto(p)) return { valor: null, fuente: null };
  if (Number.isInteger(p.frescura) && p.frescura >= 1 && p.frescura <= 5) return { valor: p.frescura, fuente: 'dato' };
  const etiquetas = Array.isArray(p.etiquetas) ? p.etiquetas.join(' ').replace(/-/g, ' ') : '';
  const fuentes = [['material', p.material], ['nombre', p.nombre], ['etiquetas', etiquetas]];
  for (const par of fuentes) { const v = frescuraPorMaterial(par[1]); if (v !== null) return { valor: v, fuente: par[0] }; }
  return { valor: null, fuente: null };
}
// Clave para comparar nombres de color ("Blanco hueso" = "blanco  hueso" = "BLANCO HUESO").
function claveColor(s) { return quitarTildes(String(esObjeto(s) ? s.nombre : s === null || s === undefined ? '' : s)).toLowerCase().replace(/\s+/g, ' ').trim(); }
// Stock total según la regla v2: suma de stock_por_color; si no existe, suma de stock_por_talla (v1); si no, null.
function stockTotal(p) {
  if (!esObjeto(p)) return null;
  if (esObjeto(p.stock_por_color)) return sumaEnteros(p.stock_por_color);
  if (esObjeto(p.stock_por_talla)) return sumaEnteros(p.stock_por_talla);
  return null;
}
// Aplica cambios de stock por color SIN modificar el producto (para WF5 y "/stock <id> <color> <n>").
// p: producto (usa colores y stock_por_color); lista: [{color, cantidad}]; modo: 'fijar' | 'sumar' | 'restar'.
// Devuelve { ok, errores[], stock_por_color (una clave por color, en el orden de colores), stock, cambios[] }.
function aplicarStockColor(p, lista, modo) {
  const errores = [], cambios = [];
  const nombres = (esObjeto(p) && Array.isArray(p.colores) ? p.colores : []).map(function (c) { return esObjeto(c) ? c.nombre : c; }).filter(function (n) { return typeof n === 'string'; });
  const previo = esObjeto(p) && esObjeto(p.stock_por_color) ? p.stock_por_color : {};
  const spc = {};
  nombres.forEach(function (n) { const v = previo[n]; spc[n] = Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_STOCK_COLOR) : 0; });
  const base = function (k) { return k.split(' ').map(function (w) { return w.replace(/s$/, '').replace(/a$/, 'o'); }).join(' '); }; // blanca(s) = blanco
  const buscar = function (color) {
    const k = claveColor(color);
    if (!k) return null;
    return nombres.find(function (n) { return claveColor(n) === k; }) || nombres.find(function (n) { return base(claveColor(n)) === base(k); }) || null;
  };
  (Array.isArray(lista) ? lista : []).forEach(function (s) {
    const nombre = buscar(esObjeto(s) ? s.color : null);
    const q = esObjeto(s) ? s.cantidad : null;
    if (!nombre) { errores.push('[stock] el producto no tiene el color ' + corto(esObjeto(s) ? s.color : s) + ' (colores: ' + (nombres.join(', ') || 'ninguno') + ')'); return; }
    if (!Number.isInteger(q) || q < 0 || q > MAX_STOCK_COLOR) { errores.push('[stock] cantidad no válida para ' + nombre + ': debe ser un entero de 0 a ' + MAX_STOCK_COLOR); return; }
    const antes = spc[nombre];
    const nuevo = modo === 'sumar' ? antes + q : modo === 'restar' ? antes - q : q;
    if (nuevo < 0) errores.push('[stock] no hay suficiente stock de ' + nombre + ' (hay ' + antes + ')');
    else if (nuevo > MAX_STOCK_COLOR) errores.push('[stock] ' + nombre + ' quedaría con ' + nuevo + '; el máximo es ' + MAX_STOCK_COLOR + ' por color');
    else { spc[nombre] = nuevo; cambios.push(nombre + '=' + nuevo); }
  });
  return { ok: errores.length === 0, errores: errores, stock_por_color: spc, stock: sumaEnteros(spc), cambios: cambios };
}
// Tabla de la guía de tallas para un producto: misma categoría y subcategoría incluida; si no, la primera de su categoría.
function tablaDeTallas(guia, p) {
  const tablas = esObjeto(guia) && Array.isArray(guia.tablas) ? guia.tablas.filter(esObjeto) : [];
  if (!esObjeto(p)) return null;
  return tablas.find(function (t) { return t.categoria === p.categoria && Array.isArray(t.subcategorias) && t.subcategorias.indexOf(p.subcategoria) >= 0; }) ||
    tablas.find(function (t) { return t.categoria === p.categoria; }) || null;
}
// Texto plano recortado al máximo del esquema (cuenta caracteres reales, no unidades UTF-16).
function textoSeguro(s, max) {
  const limpio = String(s === null || s === undefined ? '' : s).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  const cp = Array.from(limpio);
  return cp.length <= max ? limpio : cp.slice(0, max - 3).join('').replace(/\s+\S*$/, '') + '...';
}
// Bloques del LLM ({tipo, texto, items}) -> bloques de articles.json (sin campos vacíos, con límites).
function bloquesDesdeLLM(bloques) {
  const out = [];
  (Array.isArray(bloques) ? bloques : []).forEach(function (b) {
    if (!esObjeto(b)) return;
    const t = textoSeguro(b.texto, 1500);
    if (b.tipo === 'lista') {
      const items = (Array.isArray(b.items) ? b.items : []).map(function (x) { return textoSeguro(x, 300); }).filter(Boolean).slice(0, 20);
      if (items.length) out.push({ tipo: 'lista', items: items });
    } else if (b.tipo === 'subtitulo' && t) out.push({ tipo: 'subtitulo', texto: textoSeguro(t, 120) });
    else if (b.tipo === 'cita' && t) out.push({ tipo: 'cita', texto: textoSeguro(t, 400) });
    else if (t) out.push({ tipo: 'parrafo', texto: t });
  });
  return out.slice(0, 60);
}
// ---------- Prompts del LLM (D4) y cuerpo de la petición a Ollama /api/chat ----------
// {{CATALOGO}} se reemplaza por líneas "id | nombre | categoria | precio" (máx. 200 productos activos).
const PROMPT_PRODUCTO = `Eres el asistente de catálogo de la tienda de ropa "Palmera Brava" (Tarapoto, Perú). Conviertes UN mensaje del dueño (texto y, a veces, una foto) en UNA operación JSON. No publicas nada: un programa revisa tu respuesta y el dueño la aprueba.

REGLAS GENERALES
- No inventes datos. Si algo no está en el mensaje ni se ve en la foto, usa null o [] y escribe el nombre del campo en "faltantes".
- Si deduces un dato que el dueño no dijo (por ejemplo, el color o la tela a partir de la foto), ponlo y añade el nombre del campo a "campos_inferidos".
- Textos en español de Perú, sin los signos menor que ni mayor que, sin emojis.
- Precios en soles como número: "89,90" o "S/ 89.90" -> 89.9. "a 45 soles" -> 45.
- "de 120 a 99", "a 120 con oferta a 99" o "rebajado a 99" -> precio 120 y precio_oferta 99. Sin oferta -> precio_oferta null. "Quita la oferta" (op actualizar) -> precio_oferta 0.

OPERACIONES (op)
- REGLA CLAVE: si el mensaje NO menciona un id (prd-0000), la operación es "crear", aunque en el catálogo haya una prenda parecida. Solo usa otra operación si el mensaje trae un id o pide expresamente cambiar algo que ya existe ("cambia", "sube", "baja", "ahora cuesta", "oculta", "llegaron más de...").
- crear: producto nuevo. id = null.
- actualizar: cambiar datos de un producto que ya existe (precio, nombre, descripción...). id obligatorio, tomado del CATÁLOGO. Pon SOLO los campos que cambian; todos los demás van en null o [].
- desactivar: ocultar un producto ("ocultar", "ya no hay", "retirar", "agotado para siempre"). reactivar: volver a mostrarlo.
- desactivar / reactivar / stock / agregar_imagen: todos los campos en null o [], salvo stock_por_color, stock_tallas y stock_modo (en stock) y alt_imagen (en agregar_imagen).
- stock: cambiar cantidades. Si el mensaje habla de COLORES ("quedan 2 del blanco", "llegaron 5 más en arena"), usa stock_por_color; si habla de TALLAS ("quedan 2 de la L"), usa stock_tallas. stock_modo dice cómo aplicarlas: "fijar" si dice cuántas hay en total ("quedan 2", "hay 10"), "sumar" si llegaron más ("llegaron 5 más"), "restar" si se vendieron ("vendí 1"). En las demás operaciones stock_modo es null.
- agregar_imagen: añadir la foto adjunta a un producto existente.
- No existe borrar definitivamente.

CATEGORÍA (categoria). Aplica la PRIMERA regla que coincida:
1. niño, niña, niños, infantil, bebé, nene, nena, escolar -> "ninos" (aunque sea gorro o sandalia).
2. gorra, gorro, sombrero, bolso, cartera, lentes, gafas, mochila, correa -> "accesorios".
3. dama, damas, mujer, señora, señorita, femenino -> "mujeres".
4. caballero, hombre, varón, masculino -> "hombres".
5. sandalias sin género o "unisex" -> "accesorios".
6. Si no hay ninguna de esas palabras, deduce por la prenda (vestido, blusa, falda -> "mujeres"; guayabera -> "hombres") y añade "categoria" a campos_inferidos. Si no se puede saber, null y "categoria" en faltantes.
Ejemplos: "polo para dama" -> mujeres. "polo de caballero" -> hombres. "vestido para niña" -> ninos. "gorro UV para niños" -> ninos. "gorra de dama" -> accesorios. "sandalias de cuero unisex" -> accesorios. "camisa de lino para hombre" -> hombres.

SUBCATEGORÍA: una de polos, camisas, blusas, vestidos, faldas, shorts, bermudas, pantalones, conjuntos, ropa-de-bano, pijamas, sombreros, gorros, gorras, sandalias, lentes, bolsos, otros. La guayabera es "camisas".

TALLAS (tallas): adultos XS S M L XL XXL; niños 2 4 6 8 10 12 14 16; calzado 35 a 44; talla única = "UNICA". "de la 38 a la 42" -> 38 39 40 41 42.
- stock_tallas: una entrada {talla, cantidad} por talla, solo si el dueño da cantidades POR TALLA. Si no, [] (no lo pongas en faltantes).

STOCK POR COLOR (stock_por_color): una entrada {color, cantidad} por color, con cantidades de 0 a 20. "10 por color" o "10 de cada color" -> cantidad 10 en TODOS los colores. "5 blancos y 3 negros" -> blanco 5, negro 3. Si no dice cantidades, [] (no lo pongas en faltantes).

OTROS CAMPOS
- colores: nombres en español tal como los dice el dueño o como se ven en la foto ("blanco", "verde palma").
- material: solo si lo dice o se reconoce con seguridad; si lo deduces, márcalo en campos_inferidos.
- frescura: índice de frescura de 1 a 5 hojitas según la tela: lino, gasa, lino-algodón 5; algodón, algodón pima, bambú, viscosa, rayón 4; algodón-poliéster, dri-fit, telas UV 3; denim, drill grueso 2; poliéster pesado, cuero 1. Si el dueño no lo dice, dedúcelo de la tela y añade "frescura" a campos_inferidos; si no se sabe la tela, null.
- descripcion: 1 o 2 frases breves y honestas sobre la prenda para el calor; márcala en campos_inferidos.
- etiquetas: 2 a 5 palabras en minúsculas sin tildes ("lino", "fresca").
- alt_imagen: si hay foto, una frase que la describa para personas ciegas; si no, null.
- destacado: true solo si el dueño lo pide; si no, null.
- faltantes solo puede incluir: nombre, categoria, subcategoria, precio, precio_oferta, tallas, stock_tallas, stock_por_color, stock_modo, colores, material, frescura, descripcion, etiquetas, alt_imagen, destacado, id, foto.

CATÁLOGO ACTUAL (id | nombre | categoria | precio):
{{CATALOGO}}`;
const PROMPT_ARTICULO = `Eres el redactor del blog de la tienda de ropa "Palmera Brava" (Tarapoto, San Martín, Perú). Con el TEMA que te da el dueño escribes UN artículo útil, honesto y breve (350 a 600 palabras) y lo devuelves como UNA operación JSON. Un programa lo revisa y el dueño lo aprueba antes de publicarlo.

FORMATO
- op = "crear", entidad = "articulo", id = null. (Si el dueño pide editar un artículo y da su id art-0000, op = "actualizar" con ese id y solo los campos que cambian.)
- titulo: claro, máximo 100 caracteres.
- resumen: 1 o 2 frases, entre 20 y 220 caracteres.
- bloques: de 6 a 14 bloques en orden. Cada bloque tiene tipo, texto e items:
  - "parrafo": texto de 2 a 4 frases; items [].
  - "subtitulo": texto corto; items [].
  - "lista": texto ""; items con 3 a 6 frases cortas.
  - "cita": una frase breve en texto; items [].
- productos_relacionados: hasta 4 ids del CATÁLOGO que encajen con el tema. Solo ids que aparezcan en el catálogo.
- alt_portada: una frase que describa una foto de portada adecuada, SIN personas.
- campos_inferidos: los campos que escribiste tú. faltantes: [] (o ["tema"] si el tema no se entiende).

REGLAS
- Español de Perú, tono cercano. Sin Markdown, sin emojis, sin los signos menor que ni mayor que.
- No inventes cifras, estudios, precios ni datos médicos. Si hablas de salud o del sol, recomienda consultar a un profesional.
- No prometas envíos, descuentos ni stock: eso lo decide la tienda.

CATÁLOGO ACTUAL (id | nombre | categoria | precio):
{{CATALOGO}}`;
const NOTA_REINTENTO_CREAR = ' (Nota del sistema: es un producto NUEVO; usa op "crear" e id null.)';
// opciones: { tipo: 'producto'|'articulo', texto, imagenesBase64: [], productos, reintento: bool, modelo, keepAlive }
function cuerpoOllama(opciones) {
  const o = opciones || {};
  const articulo = o.tipo === 'articulo';
  const catalogo = (Array.isArray(o.productos) ? o.productos : []).filter(function (p) { return esObjeto(p) && p.activo !== false; }).slice(0, 200)
    .map(function (p) { return p.id + ' | ' + textoSeguro(p.nombre, 70) + ' | ' + p.categoria + ' | ' + p.precio; }).join('\n') || '(vacío)';
  const usuario = { role: 'user', content: String(o.texto || '') + (o.reintento ? NOTA_REINTENTO_CREAR : '') };
  if (Array.isArray(o.imagenesBase64) && o.imagenesBase64.length) usuario.images = o.imagenesBase64.slice(0, 3);
  return {
    model: o.modelo || 'qwen3.5:4b-q4_K_M', stream: false, think: false,
    keep_alive: o.keepAlive !== undefined && o.keepAlive !== null ? o.keepAlive : '2m', // 0 = descargar de la VRAM al terminar (antes de generar imágenes)
    options: { temperature: articulo ? 0.3 : 0, num_ctx: 8192 },
    format: articulo ? ESQUEMA_LLM_ARTICULO : ESQUEMA_LLM_PRODUCTO,
    messages: [{ role: 'system', content: (articulo ? PROMPT_ARTICULO : PROMPT_PRODUCTO).replace('{{CATALOGO}}', catalogo) }, usuario]
  };
}
// === FIN COPIAR A N8N ===

// ---------------------------------------------------------------------------
// Solo Node (CLI y pruebas). Nada de lo que sigue se copia a n8n.
// ---------------------------------------------------------------------------
const API = {
  CONTRATO_VERSION, SCHEMA_VERSION, LIMITE_BYTES, CATEGORIAS, SUBCATEGORIAS, TALLAS, TALLAS_POR_CATEGORIA, ORIGENES_IMAGEN, ROLES,
  PROHIBIDO_MARKETING, ESQUEMAS, ESQUEMA_LLM_PRODUCTO, ESQUEMA_LLM_ARTICULO, OPS_LLM, WHATSAPP_EJEMPLO,
  MAX_STOCK_COLOR, STOCK_COLOR_ASUMIDO, ZONAS_MEDIDA, TABLA_FRESCURA, FRESCURA_PUBLICA, RE,
  validar, validarEsquema, validarOperacion, inferirCategoria, pideCambio, puede, slugificar, siguienteId, colorHex, COLORES, textoSeguro, bloquesDesdeLLM, PROMPT_PRODUCTO, PROMPT_ARTICULO, cuerpoOllama, serializar, bytesUtf8,
  frescuraPorMaterial, inferirFrescura, claveColor, stockTotal, aplicarStockColor, tablaDeTallas
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;

function cli(argv) {
  const fs = require('fs');
  const path = require('path');
  const raiz = path.resolve(__dirname, '..');
  const args = argv.slice();
  const opt = { archivos: [], json: false };
  while (args.length) {
    const a = args.shift();
    if (a === '--json') opt.json = true;
    else if (a === '--limpieza') opt.limpieza = true;
    else if (a === '--anterior') opt.anterior = args.shift();
    else if (a === '--ids') opt.ids = (args.shift() || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    else if (a === '--rol') opt.rol = args.shift();
    else if (a === '--escribir-esquemas') opt.escribir = true;
    else if (a === '-h' || a === '--help') { console.log('Uso: node tools/validar.js data/products.json data/articles.json data/site.json data/chat.json [--anterior carpeta] [--ids a,b] [--limpieza] [--rol r] [--json]\n     node tools/validar.js --escribir-esquemas'); return 0; }
    else if (a.indexOf('--') === 0) { console.error('Opción desconocida: ' + a); return 2; }
    else opt.archivos.push(a);
  }
  if (opt.escribir) {
    const dir = path.join(raiz, 'data', 'schema');
    fs.mkdirSync(dir, { recursive: true });
    const salida = {
      'products.schema.json': ESQUEMAS.products, 'articles.schema.json': ESQUEMAS.articles, 'site.schema.json': ESQUEMAS.site,
      'chat.schema.json': ESQUEMAS.chat, 'frescura-materiales.json': FRESCURA_PUBLICA,
      'ollama-format-producto.json': ESQUEMA_LLM_PRODUCTO, 'ollama-format-articulo.json': ESQUEMA_LLM_ARTICULO
    };
    for (const f of Object.keys(salida)) { fs.writeFileSync(path.join(dir, f), serializar(salida[f])); console.log('escrito data/schema/' + f); }
    if (!opt.archivos.length) return 0;
  }
  if (!opt.archivos.length) {
    opt.archivos = ['data/products.json', 'data/articles.json', 'data/site.json', 'data/chat.json'].map(function (f) { return path.join(raiz, f); })
      .filter(function (f) { return path.basename(f) !== 'chat.json' || fs.existsSync(f); });
  }
  const leer = function (archivo) {
    const txt = fs.readFileSync(archivo, 'utf8');
    return txt;
  };
  const clasificar = function (archivo, texto) {
    const b = path.basename(archivo).toLowerCase();
    if (b.indexOf('product') >= 0) return 'products';
    if (b.indexOf('article') >= 0) return 'articles';
    if (b.indexOf('site') >= 0) return 'site';
    if (b.indexOf('chat') >= 0) return 'chat';
    try { const d = JSON.parse(texto); if (d.productos) return 'products'; if (d.articulos) return 'articles'; if (d.whatsapp !== undefined) return 'site'; if (d.activo !== undefined && d.url !== undefined) return 'chat'; } catch (e) { /* se informa al validar */ }
    return null;
  };
  const docs = {};
  for (const f of opt.archivos) {
    let texto;
    try { texto = leer(f); } catch (e) { console.error('No se puede leer ' + f + ': ' + e.message); return 2; }
    const tipo = clasificar(f, texto);
    if (!tipo) { console.error('No sé si ' + f + ' es products, articles, site o chat (usa ese nombre de archivo).'); return 2; }
    docs[tipo] = texto;
  }
  const opciones = { idsLote: opt.ids, permitirLimpieza: !!opt.limpieza, rol: opt.rol };
  if (opt.anterior) {
    opciones.anterior = {};
    for (const n of ['products', 'articles', 'site', 'chat']) {
      const f = path.resolve(opt.anterior, n + '.json');
      if (fs.existsSync(f)) opciones.anterior[n] = leer(f);
    }
  }
  const r = validar(docs, opciones);
  // Solo en local: avisa de imágenes referenciadas que aún no existen en disco.
  const faltan = [];
  const revisarSrc = function (src) { if (typeof src === 'string' && /^assets\//.test(src) && !fs.existsSync(path.join(raiz, src))) faltan.push(src); };
  try {
    const p = docs.products ? JSON.parse(docs.products) : null;
    const a = docs.articles ? JSON.parse(docs.articles) : null;
    const s = docs.site ? JSON.parse(docs.site) : null;
    if (p && Array.isArray(p.productos)) p.productos.forEach(function (x) { (x.imagenes || []).forEach(function (i) { revisarSrc(i.src); }); });
    if (a && Array.isArray(a.articulos)) a.articulos.forEach(function (x) { if (x.portada) revisarSrc(x.portada.src); });
    if (s) {
      ((s.hero && s.hero.imagenes) || []).forEach(function (i) { revisarSrc(i.src); });
      (s.categorias || []).forEach(function (c) { if (c.imagen) revisarSrc(c.imagen.src); });
      (s.lookbook || []).forEach(function (l) { if (l.imagen) revisarSrc(l.imagen.src); });
    }
  } catch (e) { /* JSON inválido: ya está en errores */ }
  if (faltan.length) r.avisos.push('[archivo] ' + faltan.length + ' imagen(es) aún no existen en disco: ' + faltan.slice(0, 5).join(', ') + (faltan.length > 5 ? ', ...' : ''));
  if (opt.json) { console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1; }
  const res = r.resumen;
  console.log('Contrato ' + res.contrato + ' | productos: ' + res.productos + ' (activos ' + res.productos_activos + ', muestra ' + res.productos_muestra + ') | artículos: ' + res.articulos +
    (res.chat_activo !== null ? ' | chat activo: ' + (res.chat_activo ? 'sí' : 'no') : ''));
  console.log('Tamaños (bytes): ' + Object.keys(res.bytes).map(function (k) { return k + '=' + res.bytes[k]; }).join(', '));
  r.errores.forEach(function (e) { console.log('ERROR ' + e); });
  r.avisos.forEach(function (a) { console.log('aviso ' + a); });
  console.log(r.ok ? 'OK: los datos cumplen el contrato.' : 'FALLA: ' + r.errores.length + ' error(es).');
  return r.ok ? 0 : 1;
}
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  process.exitCode = cli(process.argv.slice(2));
}
