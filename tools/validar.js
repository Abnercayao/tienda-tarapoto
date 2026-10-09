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
const CONTRATO_VERSION = '3.0.0';
// v2 (2026-10-07): frescura, stock_por_color, imagenes[].color, guia_tallas, chat.json; sin avisos de muestra
// v3 (2026-10-07): subcategorías por categoría (menú), colecciones (old money), envíos a todo el Perú, Mercado Pago (prueba),
//                  pedidos PB-000000 con seguimiento (fuera del repo), asistente "Vale", temperatura promedio
// v3.1 (2026-10-08): opción de envío con costo_desde 0 = GRATIS (entrega local en Tarapoto, Morales y La Banda): cotizarEnvio
//                  la marca gratis y los textos dicen "gratis" (nunca "S/ 0.00"); old money es solo una etiqueta (colecciones vacías)
const SCHEMA_VERSION = 3;
const LIMITE_BYTES = 1000000; // cada JSON debe pesar MENOS de 1 MB (límite de la API de contenidos)
const MAX_BORRADORES_APLICADOS = 100;

const CATEGORIAS = ['hombres', 'mujeres', 'ninos', 'accesorios'];
// v3: lista global (enum del esquema y del LLM) + subcategorías PERMITIDAS por categoría. El menú de la web
// (site.categorias[].subcategorias) elige cuáles se muestran, con nombre y orden.
const SUBCATEGORIAS = ['polos', 'camisas', 'blusas', 'vestidos', 'faldas', 'shorts', 'pantalones', 'conjuntos', 'ropa-de-bano', 'pijamas',
  'calzado', 'sandalias', 'sombreros', 'gorros', 'lentes', 'cinturones', 'bolsos', 'otros'];
const SUBCATEGORIAS_POR_CATEGORIA = {
  hombres: ['camisas', 'polos', 'pantalones', 'shorts', 'calzado', 'conjuntos', 'ropa-de-bano', 'pijamas', 'otros'],
  mujeres: ['vestidos', 'blusas', 'polos', 'camisas', 'pantalones', 'shorts', 'faldas', 'conjuntos', 'ropa-de-bano', 'pijamas', 'sandalias', 'calzado', 'otros'],
  ninos: ['polos', 'camisas', 'blusas', 'vestidos', 'faldas', 'shorts', 'pantalones', 'conjuntos', 'ropa-de-bano', 'pijamas', 'gorros', 'sandalias', 'otros'],
  accesorios: ['sombreros', 'lentes', 'cinturones', 'bolsos', 'sandalias', 'otros']
};
// Sinónimos (lo que dice el dueño o traen borradores v2) -> subcategoría v3.
const ALIAS_SUBCATEGORIA = {
  bermuda: 'shorts', bermudas: 'shorts', short: 'shorts', gorra: 'sombreros', gorras: 'sombreros', sombrero: 'sombreros', gorro: 'gorros',
  zapatilla: 'calzado', zapatillas: 'calzado', zapato: 'calzado', zapatos: 'calzado', mocasin: 'calzado', mocasines: 'calzado', loafers: 'calzado',
  sandalia: 'sandalias', lente: 'lentes', gafas: 'lentes', correa: 'cinturones', correas: 'cinturones', cinturon: 'cinturones',
  cartera: 'bolsos', carteras: 'bolsos', bolso: 'bolsos', pantalon: 'pantalones', camisa: 'camisas', guayabera: 'camisas', polo: 'polos',
  blusa: 'blusas', vestido: 'vestidos', falda: 'faldas', conjunto: 'conjuntos', pijama: 'pijamas', banador: 'ropa-de-bano', 'ropa-de-bano-uv': 'ropa-de-bano'
};
// Subcategoría válida en general pero no en esa categoría -> equivalente en la categoría (si no hay, "otros").
const EQUIVALENTE_SUBCATEGORIA = { accesorios: { gorros: 'sombreros', calzado: 'sandalias' }, ninos: { sombreros: 'gorros', calzado: 'sandalias' }, hombres: { sandalias: 'calzado' } };
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
  { nombre: 'clave de API (sk-)', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { nombre: 'Access Token de Mercado Pago', re: /\b(APP_USR|TEST)-\d{6,}-\d{6}-[0-9a-f]{32}-\d{6,}/ }
];
// Roles (decisión del usuario): admin y dueno todo; marketing NO puede estas acciones.
// v3: "pedidos" (datos personales de clientes) y "usuarios" (/desconocidos, /autorizar, /desautorizar) tampoco.
const ROLES = ['admin', 'dueno', 'marketing'];
const PROHIBIDO_MARKETING = ['whatsapp', 'limpiar_muestras', 'borrar', 'deshacer', 'pausa', 'reanudar', 'sitio_datos', 'pedidos', 'usuarios'];
const ROLES_ASIGNABLES = ['dueno', 'marketing']; // v3: /autorizar <id> <rol>; "admin" nunca se asigna por el bot

// ---------- v3: envíos, pedidos y Mercado Pago ----------
const OPCIONES_ENVIO = ['shalom', 'olva', 'bus', 'local'];
const ENTREGAS_ENVIO = ['agencia', 'domicilio']; // agencia = recojo con DNI (agencia_destino); domicilio = direccion
const ZONAS_ENVIO = ['lima', 'costa_norte', 'costa_sur', 'sierra', 'selva', 'tarapoto'];
const DEPARTAMENTOS = ['Amazonas', 'Áncash', 'Apurímac', 'Arequipa', 'Ayacucho', 'Cajamarca', 'Callao', 'Cusco', 'Huancavelica', 'Huánuco', 'Ica',
  'Junín', 'La Libertad', 'Lambayeque', 'Lima', 'Loreto', 'Madre de Dios', 'Moquegua', 'Pasco', 'Piura', 'Puno', 'San Martín', 'Tacna', 'Tumbes', 'Ucayali'];
const ESTADOS_PEDIDO = ['pendiente_pago', 'pagado', 'preparando', 'enviado', 'listo_recojo', 'entregado', 'cancelado'];
const TRANSICIONES_PEDIDO = {
  pendiente_pago: ['pagado', 'cancelado'], pagado: ['preparando', 'enviado', 'cancelado'], preparando: ['enviado', 'cancelado'],
  enviado: ['listo_recojo', 'entregado'], listo_recojo: ['entregado'], entregado: [], cancelado: []
};
const ESTADO_PEDIDO_TEXTO = {
  pendiente_pago: 'Pendiente de pago', pagado: 'Pagado', preparando: 'Preparando tu pedido', enviado: 'Enviado',
  listo_recojo: 'Listo para recoger', entregado: 'Entregado', cancelado: 'Cancelado'
};
const ESTADOS_PAGO = ['pendiente', 'en_proceso', 'aprobado', 'rechazado', 'cancelado', 'reembolsado'];
// status de GET /v1/payments/{id} -> pago.estado
const MAPA_PAGO_MP = {
  approved: 'aprobado', authorized: 'en_proceso', in_process: 'en_proceso', in_mediation: 'en_proceso', pending: 'en_proceso',
  rejected: 'rechazado', cancelled: 'cancelado', refunded: 'reembolsado', charged_back: 'reembolsado'
};
const MAX_ITEMS_PEDIDO = 20;
const MAX_CANTIDAD_LINEA = 10;
const PRIMER_PEDIDO = 101; // la numeración empieza en PB-000101
// Formato del código de seguimiento por agencia (/enviar <num> <agencia> <codigo>). Ejemplos en CONTRATO.md.
const RE_SEGUIMIENTO = {
  shalom: '^[0-9]{5,12}[-/ ][A-Za-z0-9]{3,10}$',
  olva: '^[A-Za-z0-9-]{5,25}$',
  bus: '^[A-Za-z0-9ÁÉÍÓÚÑáéíóúñ .:/-]{3,40}$',
  local: '^[A-Za-z0-9 .:-]{0,40}$'
};
// Data Table de n8n "pb_pedidos" (los pedidos NO se guardan en el repo: tienen datos personales).
const COLUMNAS_PB_PEDIDOS = [
  { nombre: 'numero', tipo: 'string' }, { nombre: 'correo', tipo: 'string' }, { nombre: 'estado', tipo: 'string' },
  { nombre: 'pago_estado', tipo: 'string' }, { nombre: 'total', tipo: 'number' }, { nombre: 'fecha', tipo: 'string' },
  { nombre: 'actualizado', tipo: 'string' }, { nombre: 'opcion_envio', tipo: 'string' }, { nombre: 'departamento', tipo: 'string' },
  { nombre: 'preference_id', tipo: 'string' }, { nombre: 'payment_id', tipo: 'string' }, { nombre: 'codigo_seguimiento', tipo: 'string' },
  { nombre: 'pedido_json', tipo: 'string' }
];

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
  chat_url: '^(https://[a-z0-9]+(-[a-z0-9]+)*\\.trycloudflare\\.com)?$',
  // v3
  pedido: '^PB-\\d{6}$',
  correo: '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,24}$',
  telefono: '^519\\d{8}$',
  dni: '^\\d{8}$',
  temperatura: '^\\d{1,2}°$',
  mp_id: '^[A-Za-z0-9_-]{1,80}$',
  mp_public_key: '^((APP_USR|TEST)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
};
RE.fecha_o_vacio = '^(' + RE.fecha.slice(1, -1) + ')?$';
function dineroEsq(desc) { return { type: 'number', minimum: 0, maximum: 99999, description: desc || 'Soles (PEN), máximo 2 decimales.' }; }
// Objeto de textos de interfaz: todas las claves obligatorias, texto plano.
function textosEsq(claves, max, desc) {
  const props = {};
  claves.forEach(function (k) { props[k] = txt(2, max); });
  const e = { type: 'object', additionalProperties: false, required: claves.slice(), properties: props };
  if (desc) e.description = desc;
  return e;
}
const TIEMPOS_ENVIO_ESQ = { type: 'object', additionalProperties: false, required: ZONAS_ENVIO.slice(), properties: {}, description: 'Tiempo promedio por zona (texto, p. ej. "2–3 días hábiles"); null = esta opción no llega a esa zona.' };
ZONAS_ENVIO.forEach(function (z) { TIEMPOS_ENVIO_ESQ.properties[z] = { type: ['string', 'null'], minLength: 2, maxLength: 80, pattern: RE.texto }; });
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
      'guia_tallas', 'mensajes', 'temperatura_promedio', 'asistente', 'colecciones', 'envios', 'pagos', 'textos']),
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
        properties: {
          imagenes: { type: 'array', minItems: 1, maxItems: 4, items: { $ref: '#/$defs/imagen' } },
          producto_destacado: { type: 'string', pattern: RE.prd, description: 'v3, opcional: producto de la portada (debe existir y estar activo).' },
          etiqueta_destacado: txt(0, 40, 'v3, opcional: etiqueta corta junto al producto de la portada.')
        }
      },
      categorias: {
        type: 'array', minItems: 4, maxItems: 4,
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'nombre', 'descripcion', 'imagen', 'subcategorias'],
          properties: {
            id: { enum: CATEGORIAS }, nombre: txt(2, 30), descripcion: txt(0, 140), imagen: { $ref: '#/$defs/imagen' },
            subcategorias: {
              type: 'array', minItems: 1, maxItems: 12, items: { $ref: '#/$defs/entrada_menu' },
              description: 'v3: menú de la categoría en orden. Sin "etiqueta" = subcategoría (filtra por producto.subcategoria = id); con "etiqueta" = colección (filtra por esa etiqueta dentro de la categoría). Ruta web: #/c/<categoria>/<id>.'
            }
          }
        }
      },
      colecciones: {
        type: 'array', maxItems: 8, items: { $ref: '#/$defs/coleccion' },
        description: 'v3: colecciones transversales (p. ej. "old money"): agrupan productos por etiqueta. Ruta web: #/coleccion/<id>.'
      },
      temperatura_promedio: { type: 'string', pattern: RE.temperatura, description: 'v3: temperatura promedio de Tarapoto que muestra la web (p. ej. "38°").' },
      asistente: {
        type: 'object', additionalProperties: false, required: ['nombre', 'rol', 'saludo', 'acciones'],
        description: 'v3: asistente virtual del chat de la web.',
        properties: {
          nombre: txt(2, 20), rol: txt(2, 60), saludo: txt(10, 300),
          acciones: { type: 'array', maxItems: 6, uniqueItems: true, items: txt(2, 48), description: 'Chips de acción rápida del chat; la primera es "Hacer seguimiento de mi pedido".' }
        }
      },
      envios: { $ref: '#/$defs/envios' },
      pagos: {
        type: 'object', additionalProperties: false, required: ['mercadopago'],
        properties: {
          mercadopago: {
            type: 'object', additionalProperties: false, required: ['activo', 'modo', 'public_key'],
            properties: {
              activo: { type: 'boolean', description: 'false = la web vuelve al pedido por WhatsApp.' },
              modo: { enum: ['prueba', 'produccion'], description: 'Demo: "prueba" (Checkout Pro con cuentas y tarjetas de prueba).' },
              public_key: { type: 'string', pattern: RE.mp_public_key, description: 'Opcional (vacío): no se usa al redirigir a init_point. NUNCA el Access Token: vive solo en la credencial n8n pbCredMercPago01.' },
              nota: txt(0, 200)
            }
          }
        }
      },
      textos: {
        type: 'object', additionalProperties: false, required: ['checkout', 'pedido', 'seguimiento', 'cuenta', 'estados_pedido'],
        description: 'v3: textos de las vistas de compra, seguimiento y cuenta.',
        properties: {
          checkout: textosEsq(['titulo', 'paso_contacto', 'paso_envio', 'paso_pago', 'nota_envio', 'boton_pagar', 'aviso_prueba', 'guardar_datos', 'privacidad'], 240),
          pedido: textosEsq(['titulo_pagado', 'texto_pagado', 'titulo_pendiente', 'texto_pendiente', 'titulo_rechazado', 'texto_rechazado'], 240),
          seguimiento: textosEsq(['titulo', 'intro', 'boton', 'no_encontrado', 'ayuda'], 240),
          cuenta: textosEsq(['titulo', 'intro', 'vacio', 'olvidar'], 240),
          estados_pedido: textosEsq(ESTADOS_PEDIDO, 40, 'Nombre visible de cada estado del pedido.')
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
      imagen: imagenEsq(RE.img_sitio, 'Imagen de sitio: assets/img/brand|lookbook|blog|placeholders/. ia_local permitido.'),
      entrada_menu: {
        type: 'object', additionalProperties: false, required: ['id', 'nombre', 'orden'],
        properties: {
          id: { type: 'string', minLength: 2, maxLength: 30, pattern: RE.slug, description: 'Slug: una subcategoría permitida para la categoría o el id de una colección.' },
          nombre: txt(2, 40),
          orden: { type: 'integer', minimum: 1, maximum: 99 },
          etiqueta: { type: 'string', minLength: 2, maxLength: 24, pattern: RE.slug, description: 'Solo en colecciones: etiqueta de producto que filtra (igual a la de site.colecciones).' }
        }
      },
      coleccion: {
        type: 'object', additionalProperties: false, required: ['id', 'nombre', 'descripcion', 'etiqueta', 'categorias'],
        properties: {
          id: { type: 'string', minLength: 2, maxLength: 30, pattern: RE.slug },
          nombre: txt(2, 40),
          descripcion: txt(0, 240),
          etiqueta: { type: 'string', minLength: 2, maxLength: 24, pattern: RE.slug, description: 'Los productos con esta etiqueta forman la colección.' },
          categorias: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { enum: CATEGORIAS }, description: 'Categorías en cuyo menú aparece.' },
          imagen: { $ref: '#/$defs/imagen' }
        }
      },
      envios: {
        type: 'object', additionalProperties: false, required: ['cobertura', 'resumen', 'despacho', 'nota', 'gratis_desde', 'zonas', 'opciones'],
        description: 'v3: envíos a todo el Perú desde Tarapoto (web, chat Vale y bot usan estos datos).',
        properties: {
          cobertura: txt(2, 40),
          resumen: txt(5, 200),
          despacho: txt(5, 240),
          nota: txt(0, 240),
          gratis_desde: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 9999, description: 'Envío gratis cuando el subtotal llega a este monto (S/); null = nunca.' },
          zonas: { type: 'array', minItems: ZONAS_ENVIO.length, maxItems: ZONAS_ENVIO.length, items: { $ref: '#/$defs/zona_envio' } },
          opciones: { type: 'array', minItems: 1, maxItems: OPCIONES_ENVIO.length, items: { $ref: '#/$defs/opcion_envio' } }
        }
      },
      zona_envio: {
        type: 'object', additionalProperties: false, required: ['id', 'nombre', 'departamentos'],
        properties: {
          id: { enum: ZONAS_ENVIO },
          nombre: txt(2, 60),
          departamentos: { type: 'array', minItems: 1, maxItems: DEPARTAMENTOS.length, uniqueItems: true, items: { enum: DEPARTAMENTOS } },
          distritos: { type: 'array', minItems: 1, maxItems: 12, uniqueItems: true, items: txt(2, 40), description: 'Solo zonas locales: la zona aplica a ESTOS distritos de sus departamentos (tiene prioridad).' }
        }
      },
      opcion_envio: {
        type: 'object', additionalProperties: false, required: ['id', 'nombre', 'descripcion', 'entrega', 'costo_desde', 'tiempo_promedio', 'tiempos', 'activa'],
        properties: {
          id: { enum: OPCIONES_ENVIO },
          nombre: txt(2, 40),
          descripcion: txt(5, 240),
          entrega: { enum: ENTREGAS_ENVIO, description: 'agencia = el cliente recoge con DNI (pide agencia_destino); domicilio = pide direccion.' },
          costo_desde: { type: 'number', minimum: 0, maximum: 999, description: 'Tarifa plana nacional que se cobra en la demo (S/), salvo envío gratis.' },
          tiempo_promedio: txt(2, 60, 'Resumen corto para el chat y el bot.'),
          tiempos: TIEMPOS_ENVIO_ESQ,
          rastreo_url: { type: 'string', maxLength: 200, pattern: RE.https, description: 'Opcional. {codigo} se reemplaza por el código de seguimiento.' },
          activa: { type: 'boolean' }
        }
      }
    }
  },

  // v3: un PEDIDO. No es un archivo del repo: vive en la Data Table pb_pedidos de n8n (columna pedido_json).
  pedido: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Palmera Brava — pedido (n8n Data Table pb_pedidos, columna pedido_json)',
    description: 'v3. NUNCA se guarda en el repo (datos personales). Reglas entre campos: validarPedido() de tools/validar.js y docs/CONTRATO.md.',
    type: 'object', additionalProperties: false,
    required: ['numero', 'fecha', 'cliente', 'envio', 'items', 'subtotal', 'envio_costo', 'total', 'moneda', 'pago', 'estado', 'seguimiento', 'historial'],
    properties: {
      $schema: { type: 'string', pattern: RE.ref_esquema },
      numero: { type: 'string', pattern: RE.pedido, description: 'PB- + 6 dígitos (PB-000101 en adelante).' },
      fecha: fechaEsq('Creación del pedido.'),
      actualizado: fechaEsq('Último cambio.'),
      origen: { enum: ['web', 'chat', 'telegram'] },
      cliente: {
        type: 'object', additionalProperties: false, required: ['nombre', 'correo', 'telefono'],
        properties: {
          nombre: txt(2, 80),
          correo: { type: 'string', minLength: 5, maxLength: 120, description: 'En minúsculas; con el número de pedido sirve para el seguimiento.' },
          telefono: { type: 'string', maxLength: 20, description: '51 + 9 dígitos (formato wa.me), p. ej. 51987654321.' },
          dni: { type: 'string', maxLength: 12, description: '8 dígitos. Obligatorio si la entrega es en agencia (recojo con DNI).' }
        }
      },
      envio: {
        type: 'object', additionalProperties: false, required: ['opcion', 'zona', 'departamento', 'provincia', 'distrito', 'costo', 'tiempo_estimado'],
        properties: {
          opcion: { enum: OPCIONES_ENVIO },
          zona: { enum: ZONAS_ENVIO },
          departamento: { enum: DEPARTAMENTOS },
          provincia: txt(2, 60),
          distrito: txt(2, 60),
          direccion: txt(5, 160, 'Entrega a domicilio (olva, local).'),
          referencia: txt(0, 160),
          agencia_destino: txt(3, 120, 'Entrega en agencia (shalom, bus): agencia o terminal donde recoge.'),
          costo: dineroEsq(),
          tiempo_estimado: txt(2, 80)
        }
      },
      items: { type: 'array', minItems: 1, maxItems: MAX_ITEMS_PEDIDO, items: { $ref: '#/$defs/item' } },
      subtotal: dineroEsq('Suma de cantidad x precio_unit.'),
      envio_costo: dineroEsq('Igual a envio.costo.'),
      total: dineroEsq('subtotal + envio_costo.'),
      moneda: { const: 'PEN' },
      pago: {
        type: 'object', additionalProperties: false, required: ['proveedor', 'estado'],
        properties: {
          proveedor: { const: 'mercadopago' },
          estado: { enum: ESTADOS_PAGO },
          preference_id: { type: 'string', pattern: RE.mp_id },
          payment_id: { type: 'string', pattern: RE.mp_id },
          init_point: { type: 'string', maxLength: 400, pattern: RE.https },
          detalle: txt(0, 80, 'status_detail de Mercado Pago.'),
          actualizado: fechaEsq()
        }
      },
      estado: { enum: ESTADOS_PEDIDO },
      seguimiento: {
        type: ['object', 'null'], additionalProperties: false, required: ['agencia', 'codigo'],
        description: 'null hasta que se envía. Nunca guarda la clave de recojo de Shalom.',
        properties: { agencia: { enum: OPCIONES_ENVIO }, codigo: txt(0, 40), url: { type: 'string', maxLength: 300, pattern: RE.https } }
      },
      historial: {
        type: 'array', minItems: 1, maxItems: 50,
        items: { type: 'object', additionalProperties: false, required: ['estado', 'fecha'], properties: { estado: { enum: ESTADOS_PEDIDO }, fecha: fechaEsq(), nota: txt(0, 200) } }
      }
    },
    $defs: {
      item: {
        type: 'object', additionalProperties: false, required: ['id', 'nombre', 'color', 'talla', 'cantidad', 'precio_unit'],
        properties: {
          id: { type: 'string', pattern: RE.prd }, nombre: txt(3, 70), color: txt(2, 24), talla: { enum: TALLAS },
          cantidad: { type: 'integer', minimum: 1, maximum: MAX_CANTIDAD_LINEA },
          precio_unit: dineroEsq('Precio vigente del catálogo al crear el pedido: precio_oferta si hay oferta, si no precio.')
        }
      }
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
    // v3: la subcategoría debe pertenecer a la categoría (taxonomía del menú).
    const subs = SUBCATEGORIAS_POR_CATEGORIA[p.categoria];
    if (subs && typeof p.subcategoria === 'string' && SUBCATEGORIAS.indexOf(p.subcategoria) >= 0 && subs.indexOf(p.subcategoria) < 0) {
      err('subcategoria', r + '.subcategoria', 'la subcategoría ' + corto(p.subcategoria) + ' no corresponde a la categoría "' + p.categoria + '" (permitidas: ' + subs.join(' ') + ')');
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
  if (Array.isArray(S.categorias)) reglasTaxonomia(S, err, avi);
  if (esObjeto(S.envios)) reglasEnvios(S.envios, err, avi);
  if (esObjeto(S.pagos) && esObjeto(S.pagos.mercadopago) && S.pagos.mercadopago.modo === 'produccion') {
    avi('pagos', 'site.pagos.mercadopago.modo', 'modo producción: los cobros serían reales (la demo usa "prueba")');
  }
}
// v3: menú por categoría (subcategorías y colecciones).
function reglasTaxonomia(S, err, avi) {
  const cols = Array.isArray(S.colecciones) ? S.colecciones.filter(esObjeto) : [];
  if (Array.isArray(S.colecciones)) {
    revisarUnicos(S.colecciones, 'id', 'id_duplicado', 'site.colecciones', err);
    S.colecciones.forEach(function (c, i) {
      if (!esObjeto(c)) return;
      const r = 'site.colecciones[' + i + ']';
      if (SUBCATEGORIAS.indexOf(c.id) >= 0) err('taxonomia', r + '.id', 'el id ' + corto(c.id) + ' choca con una subcategoría (comparten la ruta #/c/categoria/id)');
      if (esObjeto(c.imagen)) revisarImagen(c.imagen, r + '.imagen', false, null, err, avi);
    });
  }
  S.categorias.forEach(function (cat, i) {
    if (!esObjeto(cat) || !Array.isArray(cat.subcategorias)) return;
    const r = 'site.categorias[' + i + '].subcategorias';
    const permitidas = SUBCATEGORIAS_POR_CATEGORIA[cat.id] || [];
    revisarUnicos(cat.subcategorias, 'id', 'id_duplicado', r, err);
    const ordenes = {};
    cat.subcategorias.forEach(function (e, j) {
      if (!esObjeto(e) || typeof e.id !== 'string') return;
      const rr = r + '[' + j + ']';
      if (e.etiqueta === undefined) {
        if (permitidas.indexOf(e.id) < 0) err('taxonomia', rr, 'la subcategoría ' + corto(e.id) + ' no está permitida en "' + cat.id + '" (permitidas: ' + permitidas.join(' ') + ')');
      } else {
        const col = cols.find(function (c) { return c.id === e.id; });
        if (!col) err('taxonomia', rr, 'la entrada ' + corto(e.id) + ' tiene etiqueta pero no hay una colección con ese id en site.colecciones');
        else {
          if (col.etiqueta !== e.etiqueta) err('taxonomia', rr, 'la etiqueta ' + corto(e.etiqueta) + ' no coincide con la de la colección (' + corto(col.etiqueta) + ')');
          if (Array.isArray(col.categorias) && col.categorias.indexOf(cat.id) < 0) err('taxonomia', rr, 'la colección ' + corto(col.id) + ' no incluye la categoría "' + cat.id + '"');
        }
      }
      if (Number.isInteger(e.orden)) { if (ordenes[e.orden]) avi('taxonomia', rr, 'orden ' + e.orden + ' repetido: el menú usará el orden del archivo'); ordenes[e.orden] = true; }
    });
  });
}
// v3: zonas y opciones de envío.
function reglasEnvios(E, err, avi) {
  const base = 'site.envios';
  const zonas = Array.isArray(E.zonas) ? E.zonas.filter(esObjeto) : [];
  const opciones = Array.isArray(E.opciones) ? E.opciones.filter(esObjeto) : [];
  if (Array.isArray(E.zonas)) revisarUnicos(E.zonas, 'id', 'id_duplicado', base + '.zonas', err);
  if (Array.isArray(E.opciones)) revisarUnicos(E.opciones, 'id', 'id_duplicado', base + '.opciones', err);
  // Cada departamento del Perú está en UNA sola zona general (sin "distritos").
  const veces = {};
  zonas.forEach(function (z) { if (!Array.isArray(z.distritos) && Array.isArray(z.departamentos)) z.departamentos.forEach(function (d) { veces[d] = (veces[d] || 0) + 1; }); });
  DEPARTAMENTOS.forEach(function (d) {
    if (!veces[d]) err('envios', base + '.zonas', 'el departamento ' + corto(d) + ' no está en ninguna zona general');
    else if (veces[d] > 1) err('envios', base + '.zonas', 'el departamento ' + corto(d) + ' está en ' + veces[d] + ' zonas generales');
  });
  const locales = zonas.filter(function (z) { return Array.isArray(z.distritos); }).map(function (z) { return z.id; });
  if (typeof E.gratis_desde === 'number' && !dosDecimales(E.gratis_desde)) err('precio', base + '.gratis_desde', 'máximo 2 decimales');
  opciones.forEach(function (o, i) {
    const r = base + '.opciones[' + i + ']';
    if (typeof o.costo_desde === 'number' && !dosDecimales(o.costo_desde)) err('precio', r + '.costo_desde', 'máximo 2 decimales');
    const t = esObjeto(o.tiempos) ? o.tiempos : {};
    const llega = ZONAS_ENVIO.filter(function (z) { return typeof t[z] === 'string'; });
    if (!llega.length) err('envios', r + '.tiempos', 'la opción ' + corto(o.id) + ' no llega a ninguna zona');
    if (o.id === 'local') {
      llega.forEach(function (z) { if (locales.indexOf(z) < 0) err('envios', r + '.tiempos.' + z, 'la entrega local solo puede llegar a zonas locales (con distritos)'); });
      if (o.entrega !== 'domicilio') err('envios', r + '.entrega', 'la entrega local es a domicilio');
    }
    if (typeof o.rastreo_url === 'string' && o.id === 'local') avi('envios', r + '.rastreo_url', 'la entrega local no tiene rastreo externo');
  });
  ZONAS_ENVIO.forEach(function (z) {
    if (!opciones.some(function (o) { return o.activa === true && esObjeto(o.tiempos) && typeof o.tiempos[z] === 'string'; })) avi('envios', base, 'ninguna opción activa llega a la zona "' + z + '"');
  });
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
  if (!S) return;
  // v3: producto de la portada y cobertura del menú.
  if (esObjeto(S.hero) && typeof S.hero.producto_destacado === 'string') revisar(S.hero.producto_destacado, 'site.hero.producto_destacado', 'la portada');
  const activos = P.filter(function (p) { return esObjeto(p) && p.activo === true; });
  const cols = Array.isArray(S.colecciones) ? S.colecciones.filter(esObjeto) : [];
  cols.forEach(function (c, i) {
    if (!activos.some(function (p) { return Array.isArray(p.etiquetas) && p.etiquetas.indexOf(c.etiqueta) >= 0; })) avi('menu_vacio', 'site.colecciones[' + i + ']', 'ningún producto activo tiene la etiqueta ' + corto(c.etiqueta));
  });
  if (Array.isArray(S.categorias)) S.categorias.forEach(function (cat, i) {
    if (!esObjeto(cat) || !Array.isArray(cat.subcategorias)) return;
    const enMenu = cat.subcategorias.filter(function (e) { return esObjeto(e) && e.etiqueta === undefined; }).map(function (e) { return e.id; });
    cat.subcategorias.forEach(function (e, j) {
      if (!esObjeto(e)) return;
      const hay = activos.some(function (p) {
        return p.categoria === cat.id && (e.etiqueta === undefined ? p.subcategoria === e.id : Array.isArray(p.etiquetas) && p.etiquetas.indexOf(e.etiqueta) >= 0);
      });
      if (!hay) avi('menu_vacio', 'site.categorias[' + i + '].subcategorias[' + j + ']', corto(e.id) + ' no tiene productos activos: la web la ocultará');
    });
    activos.forEach(function (p) {
      if (p.categoria === cat.id && enMenu.indexOf(p.subcategoria) < 0) avi('menu', idSeguro(p.id) || 'producto', 'su subcategoría ' + corto(p.subcategoria) + ' no está en el menú de "' + cat.id + '": solo se ve en "Ver todo"');
    });
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
      const deDatos = ['nombre', 'lema', 'ciudad', 'region', 'pais', 'direccion', 'horario', 'envio', 'zonas_reparto', 'metodos_pago', 'redes', 'mapa', 'testimonios', 'guia_tallas', 'mensajes',
        'temperatura_promedio', 'asistente', 'envios', 'pagos', 'textos'];
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
    // v3: la subcategoría debe pertenecer a la categoría (sinónimos y equivalentes con normalizarSubcategoria).
    const catFinal = c.categoria || (actual ? actual.categoria : null);
    if (SUBCATEGORIAS_POR_CATEGORIA[catFinal]) {
      if (c.subcategoria !== null) {
        const s = normalizarSubcategoria(catFinal, c.subcategoria);
        if (s !== c.subcategoria) { avisos.push('[subcategoria] ' + corto(c.subcategoria) + ' no corresponde a "' + catFinal + '": se usa "' + s + '"'); c.subcategoria = s; }
      } else if (op.op === 'actualizar' && actual && c.categoria && SUBCATEGORIAS_POR_CATEGORIA[c.categoria].indexOf(actual.subcategoria) < 0) {
        c.subcategoria = normalizarSubcategoria(c.categoria, actual.subcategoria);
        avisos.push('[subcategoria] cambia la categoría: la subcategoría pasa de ' + corto(actual.subcategoria) + ' a "' + c.subcategoria + '"');
      }
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
// v3: /autorizar <id> <rol> y /desautorizar <id>. Solo admin y dueno; rolObjetivo = rol que se asigna o el rol actual
// de quien se desautoriza. "admin" nunca se asigna ni se quita por el bot.
function puedeAsignarRol(rolQuien, rolObjetivo) {
  return (rolQuien === 'admin' || rolQuien === 'dueno') && ROLES_ASIGNABLES.indexOf(rolObjetivo) >= 0;
}
// v3: subcategoría válida para la categoría: igual, sinónimo, equivalente o "otros". null si la categoría no existe.
function normalizarSubcategoria(categoria, sub) {
  const permitidas = SUBCATEGORIAS_POR_CATEGORIA[categoria];
  if (!permitidas) return null;
  let s = slugificar(sub);
  if (!s) return 'otros';
  if (ALIAS_SUBCATEGORIA[s]) s = ALIAS_SUBCATEGORIA[s];
  if (permitidas.indexOf(s) >= 0) return s;
  const eq = EQUIVALENTE_SUBCATEGORIA[categoria] ? EQUIVALENTE_SUBCATEGORIA[categoria][s] : null;
  return eq || 'otros';
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
// ---------- v3: envíos, pedidos, seguimiento y Mercado Pago (mismas reglas en n8n y en la web) ----------
function aCentimos(n) { return Math.round(Number(n) * 100); }
function deCentimos(c) { return Math.round(c) / 100; }
function esNumero(v) { return typeof v === 'number' && Number.isFinite(v); }
function normalizarTexto(s) { return quitarTildes(String(s === null || s === undefined ? '' : s)).toLowerCase().replace(/\s+/g, ' ').trim(); }
// Fecha ISO con zona de Lima (-05:00, sin horario de verano).
function fechaLima(ms) {
  const t = esNumero(ms) ? ms : Date.now();
  return new Date(t - 5 * 3600000).toISOString().slice(0, 19) + '-05:00';
}
// "san martin", "SAN MARTÍN" -> "San Martín"; null si no es un departamento del Perú.
function departamentoValido(nombre) {
  const k = normalizarTexto(nombre);
  return DEPARTAMENTOS.find(function (d) { return normalizarTexto(d) === k; }) || null;
}
// "+51 987-654-321", "987654321" -> "51987654321" (formato wa.me); null si no es un celular peruano.
function normalizarTelefono(t) {
  let d = String(t === null || t === undefined ? '' : t).replace(/[\s().-]/g, '');
  if (/^\+?51\d{9}$/.test(d)) d = d.replace(/^\+?51/, '');
  return /^9\d{8}$/.test(d) ? '51' + d : null;
}
function correoValido(c) { return typeof c === 'string' && largo(c) <= 120 && regex(RE.correo).test(c.trim()); }
function mismoCorreo(a, b) { return typeof a === 'string' && typeof b === 'string' && a.trim() !== '' && a.trim().toLowerCase() === b.trim().toLowerCase(); }
// Talla escrita por la web o el cliente -> valor del contrato ("única" -> "UNICA", "m" -> "M").
function normalizarTalla(t) { const s = quitarTildes(String(t === null || t === undefined ? '' : t)).trim().toUpperCase(); return s === 'TALLA UNICA' ? 'UNICA' : s; }
// Precio vigente: la oferta si es válida; si no, el precio. (La web muestra y cobra el mismo.)
function precioVigente(p) { return esObjeto(p) && esNumero(p.precio_oferta) && p.precio_oferta > 0 && p.precio_oferta < p.precio ? p.precio_oferta : esObjeto(p) ? p.precio : null; }
function opcionEnvio(site, id, inclusoInactiva) {
  const ops = esObjeto(site) && esObjeto(site.envios) && Array.isArray(site.envios.opciones) ? site.envios.opciones : [];
  return ops.find(function (o) { return esObjeto(o) && o.id === id && (inclusoInactiva || o.activa === true); }) || null;
}
// Zona de envío (site.envios.zonas) de un destino: primero las zonas locales (con distritos), luego la del departamento.
function zonaEnvio(site, departamento, distrito) {
  const zonas = esObjeto(site) && esObjeto(site.envios) && Array.isArray(site.envios.zonas) ? site.envios.zonas.filter(esObjeto) : [];
  const dep = departamentoValido(departamento);
  if (!dep) return null;
  const dist = normalizarTexto(distrito);
  const enDep = function (z) { return Array.isArray(z.departamentos) && z.departamentos.indexOf(dep) >= 0; };
  const local = zonas.find(function (z) { return Array.isArray(z.distritos) && enDep(z) && z.distritos.some(function (d) { return normalizarTexto(d) === dist; }); });
  if (local) return local.id;
  const z = zonas.find(function (x) { return !Array.isArray(x.distritos) && enDep(x); });
  return z ? z.id : null;
}
// Costo y tiempo de UNA opción para un destino. subtotal (S/) activa el envío gratis (site.envios.gratis_desde).
// -> { ok, error, opcion, nombre, entrega, zona, costo, tiempo_estimado, gratis } (gratis: por monto de compra o porque la opción cuesta 0)
function cotizarEnvio(site, opcionId, departamento, distrito, subtotal) {
  const o = opcionEnvio(site, opcionId);
  if (!o) return { ok: false, error: '[envio] envio.opcion: la opción de envío ' + corto(opcionId) + ' no existe o no está activa' };
  if (!departamentoValido(departamento)) return { ok: false, error: '[envio] envio.departamento: ' + corto(departamento) + ' no es un departamento del Perú' };
  const zona = zonaEnvio(site, departamento, distrito);
  if (!zona) return { ok: false, error: '[envio] envio: no hay una zona de envío para ' + corto(departamento) };
  const tiempo = esObjeto(o.tiempos) ? o.tiempos[zona] : null;
  if (typeof tiempo !== 'string') return { ok: false, error: '[envio] envio.opcion: ' + o.nombre + ' no llega a ' + corto(distrito || departamento) + ' (zona ' + zona + ')' };
  const gratis = site.envios.gratis_desde;
  const esGratis = esNumero(gratis) && esNumero(subtotal) && aCentimos(subtotal) >= aCentimos(gratis) && o.costo_desde > 0;
  return { ok: true, error: null, opcion: o.id, nombre: o.nombre, entrega: o.entrega, zona: zona, costo: esGratis ? 0 : o.costo_desde, tiempo_estimado: tiempo, gratis: esGratis || aCentimos(o.costo_desde) === 0 };
}
// Costo de envío para mostrar: 0 = "gratis" (nunca "S/ 0.00"); desde = true antepone "desde" a los montos.
function costoEnvioTexto(n, desde) { return aCentimos(n) === 0 ? 'gratis' : (desde ? 'desde ' : '') + soles(n); }
// Todas las opciones activas que llegan a un destino (paso "Envío" del checkout, chat Vale y bot).
function opcionesDeEnvio(site, departamento, distrito, subtotal) {
  const ops = esObjeto(site) && esObjeto(site.envios) && Array.isArray(site.envios.opciones) ? site.envios.opciones : [];
  return ops.filter(function (o) { return esObjeto(o) && o.activa === true; })
    .map(function (o) { return cotizarEnvio(site, o.id, departamento, distrito, subtotal); })
    .filter(function (c) { return c.ok; });
}
// Texto plano (sin HTML) de las opciones de envío para el chat y el bot. zona opcional ("lima", "selva"...).
function textoOpcionesEnvio(site, zona) {
  const E = esObjeto(site) && esObjeto(site.envios) ? site.envios : null;
  if (!E || !Array.isArray(E.opciones)) return '';
  const lineas = E.opciones.filter(function (o) { return esObjeto(o) && o.activa === true; }).map(function (o) {
    const t = zona ? (esObjeto(o.tiempos) ? o.tiempos[zona] : null) : o.tiempo_promedio;
    if (typeof t !== 'string') return null;
    return '- ' + o.nombre + ': ' + costoEnvioTexto(o.costo_desde) + ', ' + t + '.';
  }).filter(Boolean);
  if (esNumero(E.gratis_desde)) lineas.push('Envío gratis desde ' + soles(E.gratis_desde) + ' de compra.');
  return (E.resumen ? E.resumen + '\n' : '') + lineas.join('\n');
}
// Recalcula un carrito con el CATÁLOGO (nunca con los precios que manda el navegador).
// items: [{id, color, talla, cantidad}]; envio: {opcion, departamento, distrito} o null; opciones: {verificarStock (true por defecto)}.
// -> { ok, errores[], avisos[], items[{id,nombre,color,talla,cantidad,precio_unit}], subtotal, envio_costo, total, moneda, envio }
function calcularTotales(items, envio, productos, site, opciones) {
  opciones = opciones || {};
  const errores = [], avisos = [];
  const catalogo = porId(productos);
  const lineas = [], indice = {};
  if (!Array.isArray(items) || !items.length) errores.push('[items] items: el pedido no tiene productos');
  else if (items.length > MAX_ITEMS_PEDIDO) errores.push('[items] items: máximo ' + MAX_ITEMS_PEDIDO + ' líneas por pedido');
  (Array.isArray(items) ? items.slice(0, MAX_ITEMS_PEDIDO) : []).forEach(function (it, i) {
    const r = 'items[' + i + ']';
    if (!esObjeto(it)) { errores.push('[items] ' + r + ': debe ser un objeto'); return; }
    const p = typeof it.id === 'string' ? catalogo[it.id] : null;
    if (!p) { errores.push('[producto] ' + r + ': el producto ' + corto(it.id) + ' no existe'); return; }
    if (p.activo !== true) { errores.push('[producto] ' + r + ': ' + p.id + ' ya no está disponible'); return; }
    const color = (Array.isArray(p.colores) ? p.colores : []).map(function (c) { return esObjeto(c) ? c.nombre : null; })
      .find(function (n) { return typeof n === 'string' && claveColor(n) === claveColor(it.color); });
    if (!color) { errores.push('[color] ' + r + ': ' + p.nombre + ' no tiene el color ' + corto(it.color)); return; }
    const talla = normalizarTalla(it.talla);
    if (!Array.isArray(p.tallas) || p.tallas.indexOf(talla) < 0) { errores.push('[talla] ' + r + ': ' + p.nombre + ' no tiene la talla ' + corto(it.talla)); return; }
    if (!Number.isInteger(it.cantidad) || it.cantidad < 1 || it.cantidad > MAX_CANTIDAD_LINEA) { errores.push('[cantidad] ' + r + ': la cantidad debe ser un entero de 1 a ' + MAX_CANTIDAD_LINEA); return; }
    const clave = p.id + '|' + color + '|' + talla;
    if (indice[clave] !== undefined) {
      const l = lineas[indice[clave]];
      l.cantidad = Math.min(MAX_CANTIDAD_LINEA, l.cantidad + it.cantidad);
      avisos.push('[items] ' + r + ': línea repetida, se suma a la anterior');
      return;
    }
    indice[clave] = lineas.length;
    lineas.push({ id: p.id, nombre: p.nombre, color: color, talla: talla, cantidad: it.cantidad, precio_unit: precioVigente(p) });
  });
  if (opciones.verificarStock !== false) {
    const pide = {};
    lineas.forEach(function (l) { const k = l.id + '|' + l.color; pide[k] = (pide[k] || 0) + l.cantidad; });
    lineas.forEach(function (l) {
      const p = catalogo[l.id];
      const k = l.id + '|' + l.color;
      const hay = esObjeto(p.stock_por_color) ? p.stock_por_color[l.color] : esObjeto(p.stock_por_talla) ? p.stock_por_talla[l.talla] : p.stock;
      if (Number.isInteger(hay) && pide[k] > hay) {
        errores.push('[stock] ' + l.id + ': no hay suficiente stock de ' + l.nombre + ' en ' + l.color + ' (pides ' + pide[k] + ', quedan ' + hay + ')');
        pide[k] = -1; // un solo mensaje por producto y color
      }
      if (esObjeto(p.stock_por_color) && esObjeto(p.stock_por_talla) && p.stock_por_talla[l.talla] === 0) errores.push('[stock] ' + l.id + ': la talla ' + l.talla + ' de ' + l.nombre + ' está agotada');
    });
  }
  const subC = lineas.reduce(function (s, l) { return s + aCentimos(l.precio_unit) * l.cantidad; }, 0);
  let env = null;
  if (esObjeto(envio)) {
    const c = cotizarEnvio(site, envio.opcion, envio.departamento, envio.distrito, deCentimos(subC));
    if (!c.ok) errores.push(c.error);
    else env = { opcion: c.opcion, entrega: c.entrega, zona: c.zona, costo: c.costo, tiempo_estimado: c.tiempo_estimado, gratis: c.gratis };
  }
  const envC = env ? aCentimos(env.costo) : 0;
  return {
    ok: errores.length === 0, errores: errores, avisos: avisos, items: lineas,
    subtotal: deCentimos(subC), envio_costo: deCentimos(envC), total: deCentimos(subC + envC), moneda: 'PEN', envio: env
  };
}
// Datos del cliente y del envío (reglas comunes de crearPedido y validarPedido).
function revisarClienteEnvio(cliente, envio, site, err) {
  const c = esObjeto(cliente) ? cliente : {};
  const e = esObjeto(envio) ? envio : {};
  if (typeof c.nombre !== 'string' || largo(c.nombre.trim()) < 2 || /^\d+$/.test(c.nombre.trim())) err('cliente', 'cliente.nombre', 'escribe nombre y apellido');
  if (!correoValido(c.correo)) err('correo', 'cliente.correo', 'correo no válido ' + corto(c.correo));
  if (typeof c.telefono !== 'string' || !regex(RE.telefono).test(c.telefono)) err('telefono', 'cliente.telefono', 'celular no válido ' + corto(c.telefono) + ' (9 dígitos que empiezan con 9)');
  if (c.dni !== undefined && (typeof c.dni !== 'string' || !regex(RE.dni).test(c.dni))) err('dni', 'cliente.dni', 'el DNI tiene 8 dígitos');
  if (!departamentoValido(e.departamento)) err('envio', 'envio.departamento', corto(e.departamento) + ' no es un departamento del Perú');
  if (typeof e.provincia !== 'string' || largo(e.provincia.trim()) < 2) err('envio', 'envio.provincia', 'falta la provincia');
  if (typeof e.distrito !== 'string' || largo(e.distrito.trim()) < 2) err('envio', 'envio.distrito', 'falta el distrito');
  const o = site ? opcionEnvio(site, e.opcion, true) : null;
  if (site && !o) { err('envio', 'envio.opcion', 'la opción de envío ' + corto(e.opcion) + ' no existe'); return; }
  const entrega = o ? o.entrega : e.opcion === 'shalom' || e.opcion === 'bus' ? 'agencia' : 'domicilio';
  if (entrega === 'agencia') {
    if (typeof e.agencia_destino !== 'string' || largo(e.agencia_destino.trim()) < 3) err('envio', 'envio.agencia_destino', 'indica la agencia o el terminal donde recogerás el pedido');
    if (c.dni === undefined) err('dni', 'cliente.dni', 'para recoger en agencia se necesita el DNI de quien recoge');
  } else if (typeof e.direccion !== 'string' || largo(e.direccion.trim()) < 5) err('envio', 'envio.direccion', 'falta la dirección de entrega');
}
// Crea un pedido NUEVO con lo que manda la web (o el chat). n8n le da el número; los precios salen del catálogo.
// solicitud: { cliente{nombre,correo,telefono,dni?}, envio{opcion,departamento,provincia,distrito,direccion?,referencia?,agencia_destino?},
//              items[{id,color,talla,cantidad}], total_visto?, origen? }
// contexto: { productos, site, numero (siguienteNumeroPedido), fecha? } -> { ok, errores[], avisos[], pedido|null }
function crearPedido(solicitud, contexto) {
  contexto = contexto || {};
  const errores = [], avisos = [];
  const err = function (cod, ruta, msg) { const m = '[' + cod + '] ' + ruta + ': ' + msg; if (errores.indexOf(m) < 0) errores.push(m); };
  const s = esObjeto(solicitud) ? solicitud : {};
  const ci = esObjeto(s.cliente) ? s.cliente : {};
  const en = esObjeto(s.envio) ? s.envio : {};
  if (typeof contexto.numero !== 'string' || !regex(RE.pedido).test(contexto.numero)) err('numero', 'contexto.numero', 'falta un número PB-000000 (usa siguienteNumeroPedido)');
  const tel = normalizarTelefono(ci.telefono);
  const cliente = {
    nombre: textoSeguro(ci.nombre, 80),
    correo: String(ci.correo === undefined || ci.correo === null ? '' : ci.correo).trim().toLowerCase(),
    telefono: tel || String(ci.telefono === undefined || ci.telefono === null ? '' : ci.telefono)
  };
  if (ci.dni !== undefined && ci.dni !== null && String(ci.dni).trim() !== '') cliente.dni = String(ci.dni).replace(/\s/g, '');
  const envio = {
    opcion: en.opcion, departamento: departamentoValido(en.departamento) || String(en.departamento === undefined || en.departamento === null ? '' : en.departamento),
    provincia: textoSeguro(en.provincia, 60), distrito: textoSeguro(en.distrito, 60)
  };
  ['direccion', 'referencia', 'agencia_destino'].forEach(function (k) { const v = textoSeguro(en[k], k === 'agencia_destino' ? 120 : 160); if (v) envio[k] = v; });
  revisarClienteEnvio(cliente, envio, contexto.site, err);
  const t = calcularTotales(s.items, envio, contexto.productos, contexto.site, { verificarStock: true });
  t.errores.forEach(function (e) { if (errores.indexOf(e) < 0) errores.push(e); });
  t.avisos.forEach(function (a) { avisos.push(a); });
  if (esNumero(s.total_visto) && t.ok && aCentimos(s.total_visto) !== aCentimos(t.total)) {
    avisos.push('[total_web] la web mostró ' + soles(s.total_visto) + ' y el total con los precios vigentes es ' + soles(t.total) + ': se cobra ' + soles(t.total));
  }
  if (errores.length) return { ok: false, errores: errores, avisos: avisos, pedido: null };
  const fecha = typeof contexto.fecha === 'string' ? contexto.fecha : fechaLima();
  const origen = ['web', 'chat', 'telegram'].indexOf(s.origen) >= 0 ? s.origen : 'web';
  const pedido = {
    numero: contexto.numero, fecha: fecha, actualizado: fecha, origen: origen, cliente: cliente,
    envio: { opcion: envio.opcion, zona: t.envio.zona, departamento: envio.departamento, provincia: envio.provincia, distrito: envio.distrito },
    items: t.items, subtotal: t.subtotal, envio_costo: t.envio_costo, total: t.total, moneda: 'PEN',
    pago: { proveedor: 'mercadopago', estado: 'pendiente' }, estado: 'pendiente_pago', seguimiento: null,
    historial: [{ estado: 'pendiente_pago', fecha: fecha, nota: 'Pedido creado desde ' + (origen === 'chat' ? 'el chat' : origen === 'telegram' ? 'Telegram' : 'la web') }]
  };
  ['direccion', 'referencia', 'agencia_destino'].forEach(function (k) { if (envio[k]) pedido.envio[k] = envio[k]; });
  pedido.envio.costo = t.envio_costo;
  pedido.envio.tiempo_estimado = t.envio.tiempo_estimado;
  const v = validarPedido(pedido, { productos: contexto.productos, site: contexto.site, verificarStock: true });
  v.errores.forEach(function (e) { errores.push(e); });
  v.avisos.forEach(function (a) { avisos.push(a); });
  return { ok: errores.length === 0, errores: errores, avisos: avisos, pedido: errores.length ? null : pedido };
}
// Valida un pedido completo (al crearlo, al leerlo de pb_pedidos o antes de guardarlo).
// contexto: { site, productos, verificarPrecios (true por defecto si hay productos), verificarStock (false por defecto) }
// -> { ok, errores[], avisos[], resumen{numero, estado, total} }
function validarPedido(pedido, contexto) {
  contexto = contexto || {};
  const errores = [], avisos = [];
  const err = function (cod, ruta, msg) { const m = '[' + cod + '] ' + ruta + ': ' + msg; if (errores.indexOf(m) < 0) errores.push(m); };
  const avi = function (cod, ruta, msg) { avisos.push('[' + cod + '] ' + ruta + ': ' + msg); };
  let p = pedido;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { return { ok: false, errores: ['[json] pedido: no es JSON válido'], avisos: avisos, resumen: null }; } }
  if (!esObjeto(p)) return { ok: false, errores: ['[json] pedido: debe ser un objeto'], avisos: avisos, resumen: null };
  revisarSecretos(JSON.stringify(p), 'pedido', err);
  revisarCadenas(p, 'pedido', err);
  const eEsq = [];
  validarEsquema(p, ESQUEMAS.pedido, ESQUEMAS.pedido, 'pedido', eEsq);
  eEsq.forEach(function (m) { errores.push('[esquema] ' + m); });
  const resumen = { numero: typeof p.numero === 'string' && regex(RE.pedido).test(p.numero) ? p.numero : null, estado: p.estado, total: p.total };
  if (eEsq.length) return { ok: false, errores: errores, avisos: avisos, resumen: resumen };
  const site = esObjeto(contexto.site) ? contexto.site : null;
  const productos = Array.isArray(contexto.productos) ? contexto.productos : null;
  const verificarPrecios = !!productos && contexto.verificarPrecios !== false;
  revisarClienteEnvio(p.cliente, p.envio, site, function (cod, ruta, msg) { err(cod, 'pedido.' + ruta, msg); });
  if (p.cliente.correo !== p.cliente.correo.trim().toLowerCase()) err('correo', 'pedido.cliente.correo', 'se guarda en minúsculas y sin espacios');
  if (site) {
    const zona = zonaEnvio(site, p.envio.departamento, p.envio.distrito);
    if (zona !== p.envio.zona) err('envio', 'pedido.envio.zona', 'la zona de ' + corto(p.envio.distrito) + ' es ' + corto(zona) + ', no ' + corto(p.envio.zona));
  }
  // Dinero: 2 decimales y sumas exactas en céntimos.
  ['subtotal', 'envio_costo', 'total'].forEach(function (k) { if (!dosDecimales(p[k])) err('precio', 'pedido.' + k, 'máximo 2 decimales'); });
  p.items.forEach(function (it, i) { if (!dosDecimales(it.precio_unit)) err('precio', 'pedido.items[' + i + '].precio_unit', 'máximo 2 decimales'); });
  const subC = p.items.reduce(function (s, it) { return s + aCentimos(it.precio_unit) * it.cantidad; }, 0);
  if (subC !== aCentimos(p.subtotal)) err('total', 'pedido.subtotal', soles(p.subtotal) + ' no es la suma de las líneas (' + soles(deCentimos(subC)) + ')');
  if (aCentimos(p.envio.costo) !== aCentimos(p.envio_costo)) err('total', 'pedido.envio_costo', 'no coincide con envio.costo');
  if (aCentimos(p.subtotal) + aCentimos(p.envio_costo) !== aCentimos(p.total)) err('total', 'pedido.total', soles(p.total) + ' no es subtotal + envío (' + soles(deCentimos(aCentimos(p.subtotal) + aCentimos(p.envio_costo))) + ')');
  const vistos = {};
  p.items.forEach(function (it, i) {
    const k = it.id + '|' + it.color + '|' + it.talla;
    if (vistos[k]) err('items', 'pedido.items[' + i + ']', 'línea repetida (mismo producto, color y talla)');
    vistos[k] = true;
  });
  if (verificarPrecios) {
    const envio = site ? { opcion: p.envio.opcion, departamento: p.envio.departamento, distrito: p.envio.distrito } : null;
    const t = calcularTotales(p.items.map(function (it) { return { id: it.id, color: it.color, talla: it.talla, cantidad: it.cantidad }; }), envio, productos, site, { verificarStock: contexto.verificarStock === true });
    t.errores.forEach(function (e) { if (errores.indexOf(e) < 0) errores.push(e); });
    if (t.ok && t.items.length === p.items.length) {
      t.items.forEach(function (l, i) {
        if (aCentimos(l.precio_unit) !== aCentimos(p.items[i].precio_unit)) err('precio', 'pedido.items[' + i + '].precio_unit', soles(p.items[i].precio_unit) + ' no es el precio vigente de ' + l.id + ' (' + soles(l.precio_unit) + ')');
      });
      if (site && aCentimos(t.envio_costo) !== aCentimos(p.envio_costo)) err('total', 'pedido.envio_costo', soles(p.envio_costo) + ' no es la tarifa de ' + p.envio.opcion + ' (' + soles(t.envio_costo) + ')');
    }
  } else if (contexto.verificarStock === true) avi('stock', 'pedido', 'no se recibió el catálogo: no se comprobó el stock');
  // Estado, pago, seguimiento e historial.
  const posteriores = ['pagado', 'preparando', 'enviado', 'listo_recojo', 'entregado'];
  if (posteriores.indexOf(p.estado) >= 0 && p.pago.estado !== 'aprobado') err('pago', 'pedido.pago.estado', 'un pedido "' + p.estado + '" necesita el pago aprobado (es ' + corto(p.pago.estado) + ')');
  if (p.estado === 'pendiente_pago' && p.pago.estado === 'aprobado') avi('pago', 'pedido', 'el pago está aprobado pero el pedido sigue pendiente de pago');
  if (p.estado === 'listo_recojo' && p.envio.opcion === 'local') err('estado', 'pedido.estado', 'la entrega local no tiene recojo en agencia');
  if (['enviado', 'listo_recojo', 'entregado'].indexOf(p.estado) >= 0 && p.envio.opcion !== 'local' && p.seguimiento === null) err('seguimiento', 'pedido.seguimiento', 'un pedido "' + p.estado + '" necesita la agencia y el código de seguimiento');
  if (p.seguimiento) {
    const v = validarCodigoSeguimiento(p.seguimiento.agencia, p.seguimiento.codigo, site);
    if (!v.ok) errores.push(v.error);
    if (p.seguimiento.agencia !== p.envio.opcion) avi('seguimiento', 'pedido.seguimiento.agencia', 'se envió con ' + p.seguimiento.agencia + ' y el cliente eligió ' + p.envio.opcion);
  }
  const H = p.historial;
  if (H[0].estado !== 'pendiente_pago') err('historial', 'pedido.historial[0]', 'el primer estado es "pendiente_pago"');
  if (H[H.length - 1].estado !== p.estado) err('historial', 'pedido.historial', 'el último estado (' + H[H.length - 1].estado + ') no es el estado del pedido (' + p.estado + ')');
  for (let i = 1; i < H.length; i++) {
    if ((TRANSICIONES_PEDIDO[H[i - 1].estado] || []).indexOf(H[i].estado) < 0) err('historial', 'pedido.historial[' + i + ']', 'no se puede pasar de "' + H[i - 1].estado + '" a "' + H[i].estado + '"');
    if (Date.parse(H[i].fecha) < Date.parse(H[i - 1].fecha)) err('historial', 'pedido.historial[' + i + ']', 'la fecha es anterior a la del paso previo');
  }
  if (Date.parse(H[0].fecha) < Date.parse(p.fecha)) err('historial', 'pedido.historial[0]', 'la fecha es anterior a la del pedido');
  return { ok: errores.length === 0, errores: errores, avisos: avisos, resumen: resumen };
}
// Código de seguimiento de /enviar <num> <shalom|olva|bus|local> <codigo>. -> { ok, error, codigo, url }
function validarCodigoSeguimiento(agencia, codigo, site) {
  if (OPCIONES_ENVIO.indexOf(agencia) < 0) return { ok: false, error: '[seguimiento] agencia: ' + corto(agencia) + ' no es una agencia (usa shalom, olva, bus o local)', codigo: null, url: null };
  const c = String(codigo === null || codigo === undefined ? '' : codigo).replace(/\s+/g, ' ').trim();
  const ejemplo = { shalom: '12345678-ABCD (orden-código)', olva: '26-0123456', bus: 'Movil Bus:0012345 (empresa:guía)', local: 'opcional' }[agencia];
  if (agencia !== 'local' && !c) return { ok: false, error: '[seguimiento] codigo: falta el código de ' + agencia + ' (ejemplo: ' + ejemplo + ')', codigo: null, url: null };
  if (!regex(RE_SEGUIMIENTO[agencia]).test(c)) return { ok: false, error: '[seguimiento] codigo: ' + corto(c) + ' no tiene el formato de ' + agencia + ' (ejemplo: ' + ejemplo + ')', codigo: null, url: null };
  const o = opcionEnvio(site, agencia, true);
  const url = o && typeof o.rastreo_url === 'string' && c ? o.rastreo_url.replace('{codigo}', encodeURIComponent(c)) : null;
  return { ok: true, error: null, codigo: c, url: url };
}
// Cambia el estado de un pedido SIN modificar el original (bot: /preparando, /enviar, /entregado, /cancelar_pedido; pago de MP).
// datos: { fecha?, nota?, agencia?, codigo? (enviado), pago? {estado, payment_id, preference_id, detalle} }
// -> { ok, errores[], avisos[], pedido, cambio }
function transicionPedido(pedido, nuevo, datos, site) {
  datos = datos || {};
  const errores = [], avisos = [];
  if (!esObjeto(pedido) || !Array.isArray(pedido.historial) || !esObjeto(pedido.pago) || !esObjeto(pedido.envio)) return { ok: false, errores: ['[pedido] pedido: no es un pedido válido'], avisos: avisos, pedido: pedido, cambio: false };
  if (ESTADOS_PEDIDO.indexOf(nuevo) < 0) return { ok: false, errores: ['[estado] estado: ' + corto(nuevo) + ' no existe (' + ESTADOS_PEDIDO.join(', ') + ')'], avisos: avisos, pedido: pedido, cambio: false };
  const p = JSON.parse(JSON.stringify(pedido));
  const fecha = typeof datos.fecha === 'string' ? datos.fecha : fechaLima();
  if (esObjeto(datos.pago)) {
    ['estado', 'payment_id', 'preference_id', 'detalle'].forEach(function (k) {
      if (datos.pago[k] !== undefined && datos.pago[k] !== null && datos.pago[k] !== '') p.pago[k] = k === 'detalle' ? textoSeguro(datos.pago[k], 80) : String(datos.pago[k]);
    });
    if (!igual(p.pago, pedido.pago)) p.pago.actualizado = fecha;
  }
  if (p.estado === nuevo) {
    avisos.push('[sin_cambio] ' + p.numero + ' ya está en "' + nuevo + '"');
    const cambio = !igual(p, pedido);
    if (cambio) p.actualizado = fecha;
    return { ok: true, errores: errores, avisos: avisos, pedido: p, cambio: cambio };
  }
  const permitidos = TRANSICIONES_PEDIDO[p.estado] || [];
  if (permitidos.indexOf(nuevo) < 0) errores.push('[transicion] ' + p.numero + ': no se puede pasar de "' + p.estado + '" a "' + nuevo + '"' + (permitidos.length ? ' (siguiente: ' + permitidos.join(' o ') + ')' : ' (estado final)'));
  if (nuevo === 'pagado' && p.pago.estado !== 'aprobado') errores.push('[pago] ' + p.numero + ': solo pasa a "pagado" con el pago aprobado por Mercado Pago');
  if (nuevo === 'listo_recojo' && p.envio.opcion === 'local') errores.push('[estado] ' + p.numero + ': la entrega local no tiene recojo en agencia');
  let nota = typeof datos.nota === 'string' ? datos.nota : '';
  if (nuevo === 'enviado') {
    const agencia = datos.agencia || p.envio.opcion;
    const v = validarCodigoSeguimiento(agencia, datos.codigo, site);
    if (!v.ok) errores.push(v.error);
    else {
      p.seguimiento = { agencia: agencia, codigo: v.codigo };
      if (v.url) p.seguimiento.url = v.url;
      const o = opcionEnvio(site, agencia, true);
      if (!nota) nota = 'Enviado con ' + (o ? o.nombre : agencia) + (v.codigo ? '. Código: ' + v.codigo : '');
      if (agencia !== p.envio.opcion) avisos.push('[seguimiento] el cliente eligió ' + p.envio.opcion + ' y se envía con ' + agencia);
    }
  }
  if (nuevo === 'cancelado' && p.pago.estado === 'aprobado') avisos.push('[reembolso] ' + p.numero + ' estaba pagado: haz la devolución desde Mercado Pago');
  if (errores.length) return { ok: false, errores: errores, avisos: avisos, pedido: pedido, cambio: false };
  const notas = { pagado: 'Pago aprobado por Mercado Pago', preparando: 'Estamos preparando tu pedido', listo_recojo: 'Tu pedido llegó a la agencia de destino: recógelo con tu DNI', entregado: 'Pedido entregado', cancelado: 'Pedido cancelado' };
  p.estado = nuevo;
  p.actualizado = fecha;
  p.historial.push({ estado: nuevo, fecha: fecha, nota: textoSeguro(nota || notas[nuevo] || ESTADO_PEDIDO_TEXTO[nuevo], 200) });
  return { ok: true, errores: errores, avisos: avisos, pedido: p, cambio: true };
}
// status de Mercado Pago -> { pago_estado, estado_pedido (null si el pedido no cambia de estado) }
function mapearPagoMP(status) {
  const pago = MAPA_PAGO_MP[String(status === null || status === undefined ? '' : status).toLowerCase()] || 'pendiente';
  return { pago_estado: pago, estado_pedido: pago === 'aprobado' ? 'pagado' : pago === 'reembolsado' ? 'cancelado' : null };
}
// Compara la respuesta de GET /v1/payments/{id} con el pedido (referencia, moneda y monto). Solo se cree ESTO;
// nunca el cuerpo del aviso (webhook) ni el ?status= de la URL de vuelta.
function verificarPagoMP(pedido, pagoMP) {
  const errores = [];
  const m = esObjeto(pagoMP) ? pagoMP : {};
  if (!esObjeto(pedido)) return { ok: false, errores: ['[pago_mp] pedido: no es un objeto'], pago_estado: null, estado_pedido: null, payment_id: null, detalle: '' };
  if (m.external_reference !== pedido.numero) errores.push('[pago_mp] external_reference: ' + corto(m.external_reference) + ' no es ' + pedido.numero);
  if (m.currency_id !== 'PEN') errores.push('[pago_mp] currency_id: ' + corto(m.currency_id) + ' (debe ser PEN)');
  if (!esNumero(m.transaction_amount) || aCentimos(m.transaction_amount) !== aCentimos(pedido.total)) errores.push('[pago_mp] transaction_amount: ' + corto(m.transaction_amount) + ' no es el total ' + soles(pedido.total));
  const id = m.id === undefined || m.id === null ? '' : String(m.id);
  if (!regex(RE.mp_id).test(id)) errores.push('[pago_mp] id: falta el id del pago');
  const map = mapearPagoMP(m.status);
  return { ok: errores.length === 0, errores: errores, pago_estado: map.pago_estado, estado_pedido: map.estado_pedido, payment_id: id || null, detalle: textoSeguro(m.status_detail, 80) };
}
// Aplica un pago de Mercado Pago (ya consultado con GET /v1/payments/{id}) al pedido. Idempotente (avisos repetidos no duplican el historial).
// opciones: { fecha?, site? } -> { ok, errores[], avisos[], pedido, cambio, notificar ("pagado" | "cancelado" | "rechazado" | null) }
function aplicarPagoMP(pedido, pagoMP, opciones) {
  opciones = opciones || {};
  const v = verificarPagoMP(pedido, pagoMP);
  if (!v.ok) return { ok: false, errores: v.errores, avisos: [], pedido: pedido, cambio: false, notificar: null };
  const fecha = typeof opciones.fecha === 'string' ? opciones.fecha : fechaLima();
  const pago = { estado: v.pago_estado, payment_id: v.payment_id, detalle: v.detalle };
  const avisos = [];
  if (pedido.pago && pedido.pago.estado === 'aprobado' && v.pago_estado !== 'aprobado' && v.pago_estado !== 'reembolsado') {
    return { ok: true, errores: [], avisos: ['[pago] se ignora un pago ' + v.pago_estado + ': ' + pedido.numero + ' ya tiene un pago aprobado'], pedido: pedido, cambio: false, notificar: null };
  }
  let r;
  if (v.estado_pedido === 'pagado' && pedido.estado === 'pendiente_pago') r = transicionPedido(pedido, 'pagado', { fecha: fecha, pago: pago, nota: 'Pago aprobado por Mercado Pago (operación ' + v.payment_id + ')' }, opciones.site);
  else if (v.estado_pedido === 'cancelado' && (TRANSICIONES_PEDIDO[pedido.estado] || []).indexOf('cancelado') >= 0) r = transicionPedido(pedido, 'cancelado', { fecha: fecha, pago: pago, nota: 'Pago devuelto en Mercado Pago' }, opciones.site);
  else {
    if (v.estado_pedido === 'cancelado') avisos.push('[pago] ' + pedido.numero + ' está en "' + pedido.estado + '" y Mercado Pago informa una devolución: revísalo');
    r = transicionPedido(pedido, pedido.estado, { fecha: fecha, pago: pago }, opciones.site);
  }
  if (!r.ok) return { ok: false, errores: r.errores, avisos: avisos.concat(r.avisos), pedido: pedido, cambio: false, notificar: null };
  const cambioEstado = r.pedido.estado !== pedido.estado;
  const notificar = cambioEstado ? r.pedido.estado : r.cambio && (v.pago_estado === 'rechazado' || v.pago_estado === 'cancelado') ? 'rechazado' : null;
  return { ok: true, errores: [], avisos: avisos.concat(r.avisos.filter(function (a) { return a.indexOf('[sin_cambio]') !== 0; })), pedido: r.pedido, cambio: r.cambio, notificar: notificar };
}
// Cuerpo de POST https://api.mercadopago.com/checkout/preferences (Checkout Pro). El Access Token va SOLO en la credencial de n8n.
// opciones: { urlBase (GitHub Pages, con "/" final), notificationUrl (https del túnel), vence (ISO con zona), nombreEnvio }
function preferenciaMercadoPago(pedido, opciones) {
  const o = opciones || {};
  const base = typeof o.urlBase === 'string' && /^https:\/\/[^\s<>"'?#]+\/$/.test(o.urlBase) ? o.urlBase : 'https://abnercayao.github.io/tienda-tarapoto/';
  const vuelta = function (estado) { return base + '?mp=' + estado + '&pedido=' + encodeURIComponent(pedido.numero); };
  const items = pedido.items.map(function (it) {
    return { id: it.id, title: textoSeguro(it.nombre + ' - ' + it.color + ' - talla ' + (it.talla === 'UNICA' ? 'única' : it.talla), 250), quantity: it.cantidad, currency_id: 'PEN', unit_price: it.precio_unit };
  });
  if (pedido.envio_costo > 0) items.push({ id: 'ENVIO-' + String(pedido.envio.opcion).toUpperCase(), title: textoSeguro('Envío ' + (o.nombreEnvio || pedido.envio.opcion), 250), quantity: 1, currency_id: 'PEN', unit_price: pedido.envio_costo });
  const partes = String(esObjeto(pedido.cliente) && pedido.cliente.nombre || '').trim().split(/\s+/);
  const cuerpo = {
    items: items,
    payer: { name: partes[0] || 'Cliente', surname: partes.slice(1).join(' ') || 'Palmera Brava' }, // sin correo real en modo prueba
    external_reference: pedido.numero,
    back_urls: { success: vuelta('ok'), pending: vuelta('pend'), failure: vuelta('err') },
    auto_return: 'approved',
    statement_descriptor: 'PALMERABRAVA',
    binary_mode: false,
    metadata: { pedido: pedido.numero }
  };
  if (typeof o.notificationUrl === 'string' && /^https:\/\/[^\s<>"']+$/.test(o.notificationUrl)) cuerpo.notification_url = o.notificationUrl;
  if (typeof o.vence === 'string' && regex(RE.fecha).test(o.vence)) { cuerpo.expires = true; cuerpo.expiration_date_to = o.vence; }
  return cuerpo;
}
// Lo que ve el cliente en #/seguimiento, #/pedido/<num> y en el chat Vale: SIN correo, teléfono, DNI ni dirección.
function vistaPublicaPedido(pedido, site) {
  if (!esObjeto(pedido)) return null;
  const textos = esObjeto(site) && esObjeto(site.textos) && esObjeto(site.textos.estados_pedido) ? site.textos.estados_pedido : {};
  const etiqueta = function (e) { return textos[e] || ESTADO_PEDIDO_TEXTO[e] || e; };
  const envio = esObjeto(pedido.envio) ? pedido.envio : {};
  const o = opcionEnvio(site, envio.opcion, true);
  const seg = esObjeto(pedido.seguimiento) ? pedido.seguimiento : null;
  const oSeg = seg ? opcionEnvio(site, seg.agencia, true) : null;
  return {
    numero: pedido.numero, fecha: pedido.fecha, estado: pedido.estado, estado_texto: etiqueta(pedido.estado),
    cliente: { nombre: String(esObjeto(pedido.cliente) && pedido.cliente.nombre || '').trim().split(/\s+/)[0] || '' },
    items: (Array.isArray(pedido.items) ? pedido.items : []).map(function (it) { return { id: it.id, nombre: it.nombre, color: it.color, talla: it.talla, cantidad: it.cantidad, precio_unit: it.precio_unit }; }),
    subtotal: pedido.subtotal, envio_costo: pedido.envio_costo, total: pedido.total, moneda: pedido.moneda,
    envio: { opcion: envio.opcion, opcion_nombre: o ? o.nombre : envio.opcion, departamento: envio.departamento, distrito: envio.distrito, tiempo_estimado: envio.tiempo_estimado },
    pago: { estado: esObjeto(pedido.pago) ? pedido.pago.estado : null, init_point: esObjeto(pedido.pago) && pedido.estado === 'pendiente_pago' && pedido.pago.init_point ? pedido.pago.init_point : null },
    seguimiento: seg ? { agencia: seg.agencia, agencia_nombre: oSeg ? oSeg.nombre : seg.agencia, codigo: seg.codigo, url: seg.url || null } : null,
    historial: (Array.isArray(pedido.historial) ? pedido.historial : []).map(function (h) { return { estado: h.estado, estado_texto: etiqueta(h.estado), fecha: h.fecha, nota: h.nota || '' }; })
  };
}
function numeroPedido(n) { return 'PB-' + String(n).padStart(6, '0'); }
// Siguiente número a partir del último usado ("PB-000123" o vacío). El primero es PB-000101.
function siguienteNumeroPedido(ultimo) {
  const m = typeof ultimo === 'string' ? /^PB-(\d{6})$/.exec(ultimo.trim()) : null;
  return numeroPedido(Math.max(m ? parseInt(m[1], 10) + 1 : PRIMER_PEDIDO, PRIMER_PEDIDO));
}
// Fila de la Data Table pb_pedidos (COLUMNAS_PB_PEDIDOS) y vuelta.
function filaPedido(pedido) {
  const seg = esObjeto(pedido.seguimiento) ? pedido.seguimiento : {};
  return {
    numero: pedido.numero, correo: pedido.cliente.correo, estado: pedido.estado, pago_estado: pedido.pago.estado, total: pedido.total,
    fecha: pedido.fecha, actualizado: pedido.actualizado || pedido.fecha, opcion_envio: pedido.envio.opcion, departamento: pedido.envio.departamento,
    preference_id: pedido.pago.preference_id || '', payment_id: pedido.pago.payment_id || '', codigo_seguimiento: seg.codigo || '',
    pedido_json: JSON.stringify(pedido)
  };
}
function pedidoDesdeFila(fila) {
  if (!esObjeto(fila) || typeof fila.pedido_json !== 'string') return null;
  try { return JSON.parse(fila.pedido_json); } catch (e) { return null; }
}
// Stock tras un pedido pagado (opcional, se publica con WF5): resta las cantidades por color. -> { ok, errores[], cambios[{id, stock_por_color, stock}] }
function stockTrasPedido(productos, pedido) {
  const catalogo = porId(productos);
  const errores = [], cambios = [], porProducto = {};
  (esObjeto(pedido) && Array.isArray(pedido.items) ? pedido.items : []).forEach(function (it) { (porProducto[it.id] = porProducto[it.id] || []).push({ color: it.color, cantidad: it.cantidad }); });
  Object.keys(porProducto).forEach(function (id) {
    if (!catalogo[id]) { errores.push('[producto] ' + corto(id) + ' no existe'); return; }
    const r = aplicarStockColor(catalogo[id], porProducto[id], 'restar');
    if (!r.ok) r.errores.forEach(function (e) { errores.push(e); });
    else cambios.push({ id: id, stock_por_color: r.stock_por_color, stock: r.stock });
  });
  return { ok: errores.length === 0, errores: errores, cambios: cambios };
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
2. gorra, gorro, sombrero, bolso, cartera, lentes, gafas, mochila, correa, cinturón -> "accesorios".
3. dama, damas, mujer, señora, señorita, femenino -> "mujeres".
4. caballero, hombre, varón, masculino -> "hombres".
5. sandalias sin género o "unisex" -> "accesorios".
6. Si no hay ninguna de esas palabras, deduce por la prenda (vestido, blusa, falda -> "mujeres"; guayabera -> "hombres") y añade "categoria" a campos_inferidos. Si no se puede saber, null y "categoria" en faltantes.
Ejemplos: "polo para dama" -> mujeres. "polo de caballero" -> hombres. "vestido para niña" -> ninos. "gorro UV para niños" -> ninos. "gorra de dama" -> accesorios. "sandalias de cuero unisex" -> accesorios. "camisa de lino para hombre" -> hombres.

SUBCATEGORÍA, según la categoría (si ninguna encaja, "otros"):
- hombres: camisas, polos, pantalones, shorts (también bermudas), calzado (zapatillas, mocasines, zapatos), conjuntos, ropa-de-bano, pijamas.
- mujeres: vestidos, blusas, polos, camisas, pantalones, shorts, faldas, conjuntos, ropa-de-bano, pijamas, sandalias, calzado.
- ninos: polos, camisas, blusas, vestidos, faldas, shorts (también bermudas), pantalones, conjuntos, ropa-de-bano, pijamas, gorros (también sombreros y gorras), sandalias.
- accesorios: sombreros (también gorras y gorros), lentes, cinturones, bolsos, sandalias.
La guayabera es "camisas". Una línea elegante "old money" se marca con la etiqueta "old-money", no con la subcategoría.

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
  frescuraPorMaterial, inferirFrescura, claveColor, stockTotal, aplicarStockColor, tablaDeTallas,
  // v3
  SUBCATEGORIAS_POR_CATEGORIA, ALIAS_SUBCATEGORIA, normalizarSubcategoria, ROLES_ASIGNABLES, puedeAsignarRol,
  OPCIONES_ENVIO, ENTREGAS_ENVIO, ZONAS_ENVIO, DEPARTAMENTOS, ESTADOS_PEDIDO, TRANSICIONES_PEDIDO, ESTADO_PEDIDO_TEXTO, ESTADOS_PAGO, MAPA_PAGO_MP,
  MAX_ITEMS_PEDIDO, MAX_CANTIDAD_LINEA, PRIMER_PEDIDO, RE_SEGUIMIENTO, COLUMNAS_PB_PEDIDOS,
  fechaLima, departamentoValido, normalizarTelefono, correoValido, mismoCorreo, normalizarTalla, precioVigente, opcionEnvio, zonaEnvio, cotizarEnvio,
  opcionesDeEnvio, textoOpcionesEnvio, costoEnvioTexto, calcularTotales, crearPedido, validarPedido, validarCodigoSeguimiento, transicionPedido, mapearPagoMP,
  verificarPagoMP, aplicarPagoMP, preferenciaMercadoPago, vistaPublicaPedido, numeroPedido, siguienteNumeroPedido, filaPedido, pedidoDesdeFila, stockTrasPedido
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
    else if (a === '--pedido') opt.pedido = args.shift();
    else if (a === '-h' || a === '--help') { console.log('Uso: node tools/validar.js data/products.json data/articles.json data/site.json data/chat.json [--anterior carpeta] [--ids a,b] [--limpieza] [--rol r] [--json]\n     node tools/validar.js --escribir-esquemas\n     node tools/validar.js --pedido pedido.json [--json]'); return 0; }
    else if (a.indexOf('--') === 0) { console.error('Opción desconocida: ' + a); return 2; }
    else opt.archivos.push(a);
  }
  if (opt.escribir) {
    const dir = path.join(raiz, 'data', 'schema');
    fs.mkdirSync(dir, { recursive: true });
    const salida = {
      'products.schema.json': ESQUEMAS.products, 'articles.schema.json': ESQUEMAS.articles, 'site.schema.json': ESQUEMAS.site,
      'chat.schema.json': ESQUEMAS.chat, 'pedido.schema.json': ESQUEMAS.pedido, 'frescura-materiales.json': FRESCURA_PUBLICA,
      'ollama-format-producto.json': ESQUEMA_LLM_PRODUCTO, 'ollama-format-articulo.json': ESQUEMA_LLM_ARTICULO
    };
    for (const f of Object.keys(salida)) { fs.writeFileSync(path.join(dir, f), serializar(salida[f])); console.log('escrito data/schema/' + f); }
    if (!opt.archivos.length && !opt.pedido) return 0;
  }
  if (opt.pedido) {
    // v3: valida un pedido (JSON) contra data/products.json y data/site.json. Los pedidos NO se guardan en el repo.
    let ped, prods, sitio;
    try {
      ped = fs.readFileSync(opt.pedido, 'utf8');
      prods = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'products.json'), 'utf8')).productos;
      sitio = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'site.json'), 'utf8'));
    } catch (e) { console.error('No se puede leer: ' + e.message); return 2; }
    const rp = validarPedido(ped, { productos: prods, site: sitio });
    if (opt.json) console.log(JSON.stringify(rp, null, 2));
    else { rp.errores.forEach(function (e) { console.log('ERROR ' + e); }); rp.avisos.forEach(function (a) { console.log('aviso ' + a); }); console.log(rp.ok ? 'OK: el pedido cumple el contrato.' : 'FALLA: ' + rp.errores.length + ' error(es).'); }
    return rp.ok ? 0 : 1;
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
      (s.colecciones || []).forEach(function (c) { if (c.imagen) revisarSrc(c.imagen.src); });
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
