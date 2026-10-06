#!/usr/bin/env node
/*
 * tools/validar.js — Validador del contrato de datos de "Palmera Brava" (D9 del PLAN).
 * CERO dependencias. El MISMO código corre en local y dentro de n8n.
 *
 * (a) Línea de comandos (desde la raíz del repo):
 *       node tools/validar.js data/products.json data/articles.json data/site.json
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
 *              { products: e.products, articles: e.articles, site: e.site },   // objetos o texto JSON
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
const CONTRATO_VERSION = '1.0.0';
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
  ref_esquema: '^\\./schema/[a-z-]+\\.schema\\.json$'
};
function txt(min, max, desc) {
  const s = { type: 'string' };
  if (min) s.minLength = min;
  s.maxLength = max;
  s.pattern = RE.texto;
  if (desc) s.description = desc;
  return s;
}
function fechaEsq(desc) { const s = { type: 'string', pattern: RE.fecha }; if (desc) s.description = desc; return s; }
function imagenEsq(patron, desc) {
  return {
    type: 'object', additionalProperties: false, required: ['src', 'alt', 'origen'], description: desc,
    properties: {
      src: { type: 'string', maxLength: 160, pattern: patron, description: 'Ruta RELATIVA dentro del repo; nunca URL externa.' },
      alt: txt(5, 160, 'Texto alternativo en español que describe la imagen.'),
      origen: { enum: ORIGENES_IMAGEN, description: 'foto = foto real de la tienda; ia_local = generada con IA local (sd-server); placeholder = ilustración provisional.' },
      ancho: { type: 'integer', minimum: 1, maximum: 6000 },
      alto: { type: 'integer', minimum: 1, maximum: 6000 }
    }
  };
}
function envolturaProps(nombreEsquema) {
  return {
    $schema: { type: 'string', pattern: RE.ref_esquema },
    schema_version: { const: 1, description: 'Versión del contrato (cambia solo si cambia el esquema).' },
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
        required: ['id', 'slug', 'nombre', 'categoria', 'subcategoria', 'precio', 'tallas', 'stock_por_talla', 'stock', 'colores',
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
            description: 'Una clave por cada talla de "tallas" (ni más ni menos).'
          },
          stock: { type: 'integer', minimum: 0, maximum: 99999, description: 'Suma de stock_por_talla (lo recalcula el código).' },
          colores: { type: 'array', minItems: 1, maxItems: 8, items: { $ref: '#/$defs/color' } },
          material: txt(2, 60),
          frescura: { type: 'integer', minimum: 1, maximum: 5, description: 'Opcional: índice de frescura (1–5 hojitas).' },
          descripcion: txt(0, 600),
          etiquetas: { type: 'array', maxItems: 10, uniqueItems: true, items: { type: 'string', minLength: 2, maxLength: 24, pattern: RE.slug } },
          imagenes: { type: 'array', maxItems: 6, items: { $ref: '#/$defs/imagen' } },
          destacado: { type: 'boolean' },
          activo: { type: 'boolean', description: 'false = oculto (borrado suave). Ojo: sigue siendo público en el JSON.' },
          muestra: { type: 'boolean', description: 'true = producto de demostración (imagen IA permitida, botón "Consultar").' },
          fecha_creacion: fechaEsq(),
          fecha_actualizacion: fechaEsq()
        }
      },
      color: {
        type: 'object', additionalProperties: false, required: ['nombre', 'hex'],
        properties: { nombre: txt(2, 24), hex: { type: 'string', pattern: RE.hex } }
      },
      imagen: imagenEsq(RE.img_producto, 'Imagen de producto: assets/img/products/ o assets/img/placeholders/. origen "ia_local" solo si muestra:true.')
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
      imagen: imagenEsq(RE.img_sitio, 'Portada: assets/img/blog/ (o placeholders). ia_local permitido; la web muestra la etiqueta de IA.')
    }
  },

  site: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Palmera Brava — data/site.json',
    description: 'Datos de la tienda, hero, categorías, lookbook y textos de aviso. Generado desde tools/validar.js.',
    type: 'object', additionalProperties: false,
    required: ENVOLTURA_REQ.concat(['nombre', 'lema', 'whatsapp', 'telefono_visible', 'ciudad', 'region', 'pais', 'direccion', 'horario',
      'envio', 'zonas_reparto', 'metodos_pago', 'redes', 'mapa', 'hero', 'categorias', 'lookbook', 'testimonios',
      'aviso_muestra', 'aviso_ia', 'mensajes']),
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
      aviso_muestra: txt(5, 120),
      aviso_ia: txt(5, 80),
      mensajes: {
        type: 'object', additionalProperties: false, required: ['pedido', 'consulta_muestra', 'consulta'],
        description: 'Plantillas de WhatsApp. Marcadores: {nombre} {id} {url}.',
        properties: { pedido: txt(5, 300), consulta_muestra: txt(5, 400), consulta: txt(5, 300) }
      }
    }),
    $defs: {
      imagen: imagenEsq(RE.img_sitio, 'Imagen de sitio: assets/img/brand|lookbook|blog|placeholders/. ia_local permitido.')
    }
  }
};

// ---------- Formato de salida del LLM (D4) para Ollama /api/chat "format" ----------
const OPS_LLM = ['crear', 'actualizar', 'desactivar', 'reactivar', 'stock', 'agregar_imagen'];
const CAMPOS_LLM_PRODUCTO = ['nombre', 'categoria', 'subcategoria', 'precio', 'precio_oferta', 'tallas', 'stock_tallas', 'stock_modo', 'colores',
  'material', 'descripcion', 'etiquetas', 'alt_imagen', 'destacado'];
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
        stock_modo: { type: ['string', 'null'], enum: ['fijar', 'sumar', 'restar', null], description: 'fijar = cantidad total nueva; sumar = llegaron N más; restar = se vendieron N' },
        colores: { type: 'array', items: { type: 'string' } },
        material: { type: ['string', 'null'] },
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
  const NOMBRES = ['products', 'articles', 'site'];
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
  if (!recibidos) err('entrada', 'docs', 'no se recibió ningún documento (products, articles o site)');

  const P = datos.products && Array.isArray(datos.products.productos) ? datos.products.productos : null;
  const AR = datos.articles && Array.isArray(datos.articles.articulos) ? datos.articles.articulos : null;
  const S = datos.site || null;
  if (P) reglasProductos(P, err, avi);
  if (AR) reglasArticulos(AR, err, avi);
  if (S) reglasSitio(S, err, avi);
  reglasReferencias(P, AR, S, err, avi);
  if (opciones.anterior) limitesDeDano(datos, opciones, err, avi);

  const resumen = {
    contrato: CONTRATO_VERSION,
    productos: P ? P.length : null,
    productos_activos: P ? P.filter(function (p) { return esObjeto(p) && p.activo === true; }).length : null,
    productos_muestra: P ? P.filter(function (p) { return esObjeto(p) && p.muestra === true; }).length : null,
    articulos: AR ? AR.length : null,
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
  if (esProducto && img.origen === 'ia_local' && muestra !== true) {
    err('imagen_origen', ruta, 'origen "ia_local" solo se permite en productos de muestra (muestra:true); un producto real necesita una foto real');
  }
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
    if (tallas && esObjeto(p.stock_por_talla)) {
      const claves = Object.keys(p.stock_por_talla);
      for (const t of tallas) if (claves.indexOf(t) < 0) err('stock', r + '.stock_por_talla', 'falta la talla ' + corto(t));
      for (const k of claves) if (tallas.indexOf(k) < 0) err('stock', r + '.stock_por_talla', 'tiene la talla ' + corto(k) + ', que no está en tallas');
      let suma = 0, valido = true;
      for (const k of claves) { const v = p.stock_por_talla[k]; if (Number.isInteger(v) && v >= 0) suma += v; else valido = false; }
      if (valido && Number.isInteger(p.stock) && suma !== p.stock) err('stock', r + '.stock', 'stock (' + p.stock + ') no coincide con la suma de stock_por_talla (' + suma + ')');
      if (valido && p.activo === true && suma === 0) avi('agotado', r, 'producto activo sin stock: la web lo mostrará "Agotado"');
    }
    const fc = Date.parse(p.fecha_creacion), fa = Date.parse(p.fecha_actualizacion);
    if (typeof p.fecha_creacion === 'string' && isNaN(fc)) err('fecha', r + '.fecha_creacion', 'fecha no válida');
    if (typeof p.fecha_actualizacion === 'string' && isNaN(fa)) err('fecha', r + '.fecha_actualizacion', 'fecha no válida');
    if (!isNaN(fc) && !isNaN(fa) && fa < fc) err('fecha', r, 'fecha_actualizacion es anterior a fecha_creacion');
    if (!isNaN(fc) && fc > ahora + 86400000) avi('fecha', r + '.fecha_creacion', 'está en el futuro');
    if (Array.isArray(p.imagenes)) {
      p.imagenes.forEach(function (img, j) { revisarImagen(img, r + '.imagenes[' + j + ']', true, p.muestra, err, avi); });
      if (p.activo === true && p.imagenes.length === 0) avi('sin_imagen', r, 'producto activo sin imagen: la web usará un marcador');
    }
    if (Array.isArray(p.colores)) {
      const nombres = p.colores.map(function (c) { return esObjeto(c) && typeof c.nombre === 'string' ? quitarTildes(c.nombre).toLowerCase() : null; }).filter(Boolean);
      if (new Set(nombres).size !== nombres.length) avi('colores', r + '.colores', 'hay nombres de color repetidos');
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
  for (const n of ['products', 'articles', 'site']) {
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
      const deDatos = ['nombre', 'lema', 'ciudad', 'region', 'pais', 'direccion', 'horario', 'envio', 'zonas_reparto', 'metodos_pago', 'redes', 'mapa', 'testimonios', 'mensajes'];
      if (rol === 'marketing' && deDatos.some(cambia)) err('permiso', 'site', 'el rol marketing solo puede cambiar imágenes del sitio (hero, categorías, lookbook)');
    }
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
    const conservar = { desactivar: [], reactivar: [], stock: ['stock_tallas', 'stock_modo'], agregar_imagen: ['alt_imagen'] }[op.op];
    if (conservar) for (const k of CAMPOS_LLM_PRODUCTO) if (conservar.indexOf(k) < 0 && !vacio(c[k])) vaciar(k);
    const actual = typeof op.id === 'string' && Array.isArray(lista) ? lista.find(function (x) { return esObjeto(x) && x.id === op.id; }) : null;
    if (op.op === 'actualizar' && actual) {
      for (const k of ['nombre', 'categoria', 'subcategoria', 'precio', 'precio_oferta', 'tallas', 'material', 'descripcion', 'etiquetas', 'destacado']) {
        if (!vacio(c[k]) && igual(c[k], actual[k])) vaciar(k);
      }
      const nombresColor = function (l) { return (l || []).map(function (x) { return quitarTildes(esObjeto(x) ? x.nombre : x).toLowerCase(); }).sort().join('|'); };
      if (!vacio(c.colores) && nombresColor(c.colores) === nombresColor(actual.colores)) vaciar('colores');
      if (!vacio(c.stock_tallas)) vaciar('stock_tallas');
      if (c.stock_modo !== null) vaciar('stock_modo');
    }
    if (op.op === 'crear' && c.stock_modo !== null) vaciar('stock_modo');
    if (op.op === 'stock' && !vacio(c.stock_tallas) && c.stock_modo === null) {
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
    if (op.op === 'crear') {
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
    if (op.op === 'stock' && vacio(c.stock_tallas)) faltantes.add('stock_tallas');
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
- desactivar / reactivar / stock / agregar_imagen: todos los campos en null o [], salvo stock_tallas (en stock) y alt_imagen (en agregar_imagen).
- stock: cambiar cantidades por talla. stock_tallas lleva las cantidades que dice el mensaje y stock_modo dice cómo aplicarlas: "fijar" si dice cuántas hay en total ("quedan 2 de la L", "hay 10"), "sumar" si llegaron más ("llegaron 5 más de la M"), "restar" si se vendieron ("vendí 1 de la S"). En las demás operaciones stock_modo es null.
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
- stock_tallas: una entrada {talla, cantidad} por talla. "3 de cada una" -> cantidad 3 en todas. Si no dice cantidades, [] (no lo pongas en faltantes).

OTROS CAMPOS
- colores: nombres en español tal como los dice el dueño o como se ven en la foto ("blanco", "verde palma").
- material: solo si lo dice o se reconoce con seguridad; si lo deduces, márcalo en campos_inferidos.
- descripcion: 1 o 2 frases breves y honestas sobre la prenda para el calor; márcala en campos_inferidos.
- etiquetas: 2 a 5 palabras en minúsculas sin tildes ("lino", "fresca").
- alt_imagen: si hay foto, una frase que la describa para personas ciegas; si no, null.
- destacado: true solo si el dueño lo pide; si no, null.
- faltantes solo puede incluir: nombre, categoria, subcategoria, precio, precio_oferta, tallas, stock_tallas, stock_modo, colores, material, descripcion, etiquetas, alt_imagen, destacado, id, foto.

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
  CONTRATO_VERSION, LIMITE_BYTES, CATEGORIAS, SUBCATEGORIAS, TALLAS, TALLAS_POR_CATEGORIA, ORIGENES_IMAGEN, ROLES,
  PROHIBIDO_MARKETING, ESQUEMAS, ESQUEMA_LLM_PRODUCTO, ESQUEMA_LLM_ARTICULO, OPS_LLM, WHATSAPP_EJEMPLO,
  validar, validarEsquema, validarOperacion, inferirCategoria, pideCambio, puede, slugificar, siguienteId, colorHex, COLORES, textoSeguro, bloquesDesdeLLM, PROMPT_PRODUCTO, PROMPT_ARTICULO, cuerpoOllama, serializar, bytesUtf8
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
    else if (a === '-h' || a === '--help') { console.log('Uso: node tools/validar.js data/products.json data/articles.json data/site.json [--anterior carpeta] [--ids a,b] [--limpieza] [--rol r] [--json]\n     node tools/validar.js --escribir-esquemas'); return 0; }
    else if (a.indexOf('--') === 0) { console.error('Opción desconocida: ' + a); return 2; }
    else opt.archivos.push(a);
  }
  if (opt.escribir) {
    const dir = path.join(raiz, 'data', 'schema');
    fs.mkdirSync(dir, { recursive: true });
    const salida = {
      'products.schema.json': ESQUEMAS.products, 'articles.schema.json': ESQUEMAS.articles, 'site.schema.json': ESQUEMAS.site,
      'ollama-format-producto.json': ESQUEMA_LLM_PRODUCTO, 'ollama-format-articulo.json': ESQUEMA_LLM_ARTICULO
    };
    for (const f of Object.keys(salida)) { fs.writeFileSync(path.join(dir, f), serializar(salida[f])); console.log('escrito data/schema/' + f); }
    if (!opt.archivos.length) return 0;
  }
  if (!opt.archivos.length) opt.archivos = ['data/products.json', 'data/articles.json', 'data/site.json'].map(function (f) { return path.join(raiz, f); });
  const leer = function (archivo) {
    const txt = fs.readFileSync(archivo, 'utf8');
    return txt;
  };
  const clasificar = function (archivo, texto) {
    const b = path.basename(archivo).toLowerCase();
    if (b.indexOf('product') >= 0) return 'products';
    if (b.indexOf('article') >= 0) return 'articles';
    if (b.indexOf('site') >= 0) return 'site';
    try { const d = JSON.parse(texto); if (d.productos) return 'products'; if (d.articulos) return 'articles'; if (d.whatsapp !== undefined) return 'site'; } catch (e) { /* se informa al validar */ }
    return null;
  };
  const docs = {};
  for (const f of opt.archivos) {
    let texto;
    try { texto = leer(f); } catch (e) { console.error('No se puede leer ' + f + ': ' + e.message); return 2; }
    const tipo = clasificar(f, texto);
    if (!tipo) { console.error('No sé si ' + f + ' es products, articles o site (usa ese nombre de archivo).'); return 2; }
    docs[tipo] = texto;
  }
  const opciones = { idsLote: opt.ids, permitirLimpieza: !!opt.limpieza, rol: opt.rol };
  if (opt.anterior) {
    opciones.anterior = {};
    for (const n of ['products', 'articles', 'site']) {
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
  console.log('Contrato ' + res.contrato + ' | productos: ' + res.productos + ' (activos ' + res.productos_activos + ', muestra ' + res.productos_muestra + ') | artículos: ' + res.articulos);
  console.log('Tamaños (bytes): ' + Object.keys(res.bytes).map(function (k) { return k + '=' + res.bytes[k]; }).join(', '));
  r.errores.forEach(function (e) { console.log('ERROR ' + e); });
  r.avisos.forEach(function (a) { console.log('aviso ' + a); });
  console.log(r.ok ? 'OK: los datos cumplen el contrato.' : 'FALLA: ' + r.errores.length + ' error(es).');
  return r.ok ? 0 : 1;
}
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  process.exitCode = cli(process.argv.slice(2));
}
