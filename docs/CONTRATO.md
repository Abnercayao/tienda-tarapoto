# Contrato de datos — Palmera Brava (F1, equipo B)

Este documento define **qué forma tienen los datos**, **qué reglas los protegen** y **cómo se comunican** la web, el bot de Telegram (n8n) y el LLM local. Es la referencia para los equipos A (web), C (n8n), D (IA local), E (publicación) y F (QA).

- Contrato **v1.0.0** (`CONTRATO_VERSION` en `tools/validar.js`). Fecha: 2026-10-06.
- Fuente única de verdad: `tools/validar.js`. Los esquemas de `data/schema/` **se generan** desde ahí (`node tools/validar.js --escribir-esquemas`); no se editan a mano.
- Decisiones del usuario que este contrato aplica: tienda **Palmera Brava**, Tarapoto (San Martín); WhatsApp personal **51995542938** (se muestra "+51 995 542 938"); horario **8:00 a. m. – 8:00 p. m.**; varios roles (admin, dueño, marketing); fotos **con personas sin rostro**, y **niños sin personas**; productos de muestra con imágenes IA locales.

## 1. Archivos

| Archivo | Qué es |
|---|---|
| `data/products.json` | Catálogo: 16 productos de muestra (4 por categoría), todos `muestra:true` con imagen `ia_local`. |
| `data/articles.json` | Blog: 3 artículos por bloques (sin HTML ni Markdown). |
| `data/site.json` | Datos de la tienda, horario, envío, mapa, hero, categorías, lookbook, avisos y plantillas de WhatsApp. |
| `data/schema/products.schema.json`, `articles.schema.json`, `site.schema.json` | JSON Schema 2020-12 (`additionalProperties:false`, textos sin `<` ni `>`). |
| `data/schema/ollama-format-producto.json`, `ollama-format-articulo.json` | Esquemas de salida del LLM, listos para el campo `format` de Ollama. |
| `tools/validar.js` | Validador sin dependencias: CLI + bloque para pegar en un nodo Code de n8n + ayudas para WF3/WF4. |
| `tools/test-validar.js` | 55 pruebas (muestras válidas, 15 casos malos de F1 y extras, límites de daño, roles, bloque n8n aislado, LLM, prompts de imagen). |
| `tools/image-prompts.json` | 29 prompts de imagen (`path`, `size`, `seed`, `prompt`, `personas`, `generar`, `recortar_arriba`). |

> **Todo lo que está en `data/` es público** (el repo y Pages son públicos), incluidos los productos ocultos (`activo:false`) y el stock. Nunca se guarda ahí nada privado.

## 2. Cómo validar

```powershell
node tools\validar.js data\products.json data\articles.json data\site.json   # exit 0 = ok, 1 = errores, 2 = uso
node tools\validar.js --anterior C:\ruta\data-anterior --ids prd-0003,site --rol marketing   # con límites de daño
node tools\test-validar.js                                                    # 55 pruebas
node tools\validar.js --escribir-esquemas                                     # regenerar data/schema/*.json
```

En local, el CLI además avisa (`[archivo]`) de las imágenes referenciadas que aún no existen en disco; eso es un aviso, no un error.

**En n8n** (nodo Code, JavaScript, "Run Once for All Items"): copia todo lo que hay entre las líneas `// === COPIAR A N8N ===` y `// === FIN COPIAR A N8N ===` y añade al final, por ejemplo:

```js
const e = $input.first().json;
const r = validar(
  { products: e.products, articles: e.articles, site: e.site },     // objetos o texto JSON tal como llega de GitHub
  { anterior: e.anterior, idsLote: e.idsLote, permitirLimpieza: false, rol: e.rol });
return [{ json: r }];   // { ok, errores[], avisos[], resumen }
```

El bloque no usa `require`, `fs`, `Buffer` ni variables de entorno (la prueba 4 lo ejecuta aislado en un `vm`). Funciones disponibles en el bloque: `validar`, `validarOperacion`, `cuerpoOllama`, `inferirCategoria`, `pideCambio`, `puede`, `slugificar`, `siguienteId`, `colorHex`, `textoSeguro`, `bloquesDesdeLLM` y las constantes `ESQUEMAS`, `ESQUEMA_LLM_PRODUCTO`, `ESQUEMA_LLM_ARTICULO`, `PROMPT_PRODUCTO`, `PROMPT_ARTICULO`, `TALLAS_POR_CATEGORIA`, `CATEGORIAS`, `SUBCATEGORIAS`.

Cada mensaje tiene la forma `[codigo] ruta: texto` (por ejemplo `[precio_oferta] products.productos[0](prd-0001): precio_oferta (S/ 89.90) debe ser menor que precio (S/ 89.90)`). Los mensajes nunca contienen `<` ni `>`, así que se pueden mandar a Telegram sin escapar.

## 3. Envoltura común (los tres JSON)

| Campo | Tipo | Regla |
|---|---|---|
| `$schema` | texto | `./schema/<nombre>.schema.json` (ayuda al editor). |
| `schema_version` | `1` | Versión del contrato. Solo cambia si cambia el esquema. |
| `version` | entero ≥ 1 | **Revisión de los datos.** WF5 la incrementa en cada commit que toca ese archivo. La web repinta si cambia. `/deshacer` también la **incrementa** (restaura contenido, no la versión). |
| `actualizado` | fecha ISO | Con zona: `2026-10-06T06:00:00-05:00` (America/Lima). |
| `borradores_aplicados` | lista de `draft_id` | Los **últimos 100** `draft_id` aplicados a ese archivo (idempotencia de D5: WF5 salta los que ya estén en **cualquiera** de los tres archivos). |

Fechas: siempre ISO 8601 con zona (`-05:00`). Textos: texto plano, sin `<` ni `>`; la web los pinta con `textContent`.

## 4. `products.json`

Envoltura + `moneda: "PEN"` + `productos: [...]` (máximo 1000).

| Campo | Obligatorio | Regla |
|---|---|---|
| `id` | sí | `prd-0001` (4–6 dígitos). Inmutable. Lo asigna el código con `siguienteId()` **al publicar**, nunca el LLM. |
| `slug` | sí | `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–80, único. `slugificar(nombre)`; si ya existe, añadir `-2`, `-3`… |
| `nombre` | sí | 3–70. |
| `categoria` | sí | `hombres` · `mujeres` · `ninos` · `accesorios` (la etiqueta "Niños" la pone la web). |
| `subcategoria` | sí | `polos camisas blusas vestidos faldas shorts bermudas pantalones conjuntos ropa-de-bano pijamas sombreros gorros gorras sandalias lentes bolsos otros`. |
| `precio` | sí | Soles, > 0, ≤ 9999, máximo 2 decimales. La web muestra "S/ 69.90" (`Intl` es-PE, PEN). |
| `precio_oferta` | no | Ausente o `null` = sin oferta. Si existe: > 0, 2 decimales y **menor que `precio`**. El % de descuento se calcula en una sola función compartida. |
| `tallas` | sí | 1–12, sin repetir. Valores y coherencia con la categoría en la tabla siguiente. |
| `stock_por_talla` | sí | Una clave **por cada** talla de `tallas` (ni más ni menos), enteros ≥ 0. |
| `stock` | sí | Entero = **suma** de `stock_por_talla` (lo recalcula el código). |
| `colores` | sí | 1–8 `{nombre, hex}`; `hex` = `#RRGGBB`. `colorHex(nombre)` convierte lo que dice el dueño. |
| `material` | no | 2–60 ("Lino 100%"). |
| `frescura` | no | 1–5 (índice de frescura en hojitas, ver web-design.md). |
| `descripcion` | sí | 0–600 (puede ser ""). |
| `etiquetas` | sí | 0–10 slugs de 2–24 caracteres (`lino`, `tiro-alto`). |
| `imagenes` | sí | 0–6 `{src, alt, origen, ancho?, alto?}`. Ver reglas de imagen. |
| `destacado`, `activo`, `muestra` | sí | Booleanos. `activo:false` = oculto (borrado suave). `muestra:true` = producto de demostración. |
| `fecha_creacion`, `fecha_actualizacion` | sí | ISO con zona; actualización ≥ creación. "Nuevo" lo calcula la web (< 30 días); **no existe** el campo `nuevo`. |

**Tallas por categoría** (`TALLAS_POR_CATEGORIA`):

| Categoría | Tallas permitidas |
|---|---|
| `hombres`, `mujeres` | XS S M L XL XXL · calzado 35–44 · UNICA |
| `ninos` | 2 4 6 8 10 12 14 16 · UNICA |
| `accesorios` | UNICA · calzado 35–44 · S M L (sombreros y gorros) |

**Imágenes de producto:** `src` relativo con patrón `^assets/img/(products|placeholders)/[a-z0-9-]+\.(webp|avif|jpg|jpeg|png|svg)$` (nunca URL externa). `origen`:
- `foto`: foto real llegada por Telegram (`message.photo`), 1200 px WebP q80, nombre `<slug>-<n>-<hash8>.webp` (hash = 8 primeros caracteres del `sha` del blob).
- `ia_local`: generada con IA local. **Solo se permite si `muestra:true`** (ajuste a D11). Un producto real nunca lleva imagen IA. La web muestra la etiqueta de `site.aviso_ia` ("Imagen referencial (IA)").
- `placeholder`: ilustración provisional, solo en `assets/img/placeholders/` (y viceversa).

**Muestras y botones (ajuste a D13):** con `muestra:true` la web muestra "Consultar por WhatsApp" con `site.mensajes.consulta_muestra` (aclara que es referencia) en vez de "Pedir"; mientras exista alguna muestra activa, banner `site.aviso_muestra` ("Catálogo de muestra · precios referenciales"). Productos reales: bolsa + "Pedir por WhatsApp" con **un solo mensaje** (`site.mensajes.pedido` + líneas + total).

## 5. `articles.json`

Envoltura + `articulos: [...]` (máximo 300).

| Campo | Regla |
|---|---|
| `id` | `art-0001`, único. |
| `slug` | Como en productos (3–90), único. La web abre `#blog/<slug>`. |
| `titulo` / `resumen` | 5–110 / 20–240. |
| `portada` | `{src, alt, origen, ancho?, alto?}` en `assets/img/(blog|lookbook|brand|placeholders)/`. `ia_local` permitido (la web muestra la etiqueta IA). |
| `bloques` | 1–60, cada uno exactamente uno de: `{tipo:"parrafo", texto≤1500}`, `{tipo:"subtitulo", texto≤120}`, `{tipo:"lista", items:[≤300]×1–20, ordenada?}`, `{tipo:"cita", texto≤400, autor?}`, `{tipo:"producto", ids:[prd]×1–4}` (tarjetas enlazadas). |
| `productos_relacionados` | 0–8 ids de producto **existentes**. |
| `autor` | 2–60 ("Equipo Palmera Brava"). |
| `fecha` | Publicación (ISO). `fecha_actualizacion` opcional, ≥ `fecha`. |
| `activo`, `muestra` | Booleanos. Los 3 artículos iniciales son `muestra:true` (contenido de demostración). |

## 6. `site.json`

| Campo | Valor actual / regla |
|---|---|
| `nombre`, `lema` | "Palmera Brava", "Ropa fresca para el calor de la selva". |
| `whatsapp` | `51995542938`: `^51\d{9}$`, sin `+` ni espacios. Vacío = la web oculta los botones (aviso). **Nunca un número de ejemplo** (`51900000000`, etc. → error). |
| `telefono_visible` | "+51 995 542 938": sus dígitos deben coincidir con `whatsapp`. |
| `ciudad`, `region`, `pais`, `direccion` | "Tarapoto", "San Martín", "PE", "Tarapoto, San Martín" (sin dirección exacta hasta que el dueño la confirme). |
| `horario` | `{texto, tramos:[{dias:[lu…do], abre:"08:00", cierra:"20:00"}]}`. **Días por confirmar**: se usó "Todos los días". `abre` < `cierra`. |
| `envio`, `zonas_reparto` | Texto honesto ("se coordina por WhatsApp…") y `["Tarapoto"]`. Morales y La Banda de Shilcayo: por confirmar. |
| `metodos_pago` | `[]` (por confirmar: Yape, Plin, efectivo…). La web oculta lo vacío. |
| `anuncio` | Opcional (barra superior). |
| `redes` | `[]`. Cada una `{red: instagram|facebook|tiktok|youtube|x, url}` con `https://` y dominio de esa red (sin `usuario@dominio`). |
| `mapa` | `{embed, enlace, lat, lng, nota?}`. `embed` solo `www.openstreetmap.org/export/embed.html…` o `www.google.com/maps/embed…` (coincide con `frame-src` de la CSP). Hoy: OSM de Tarapoto **sin marcador** (no hay dirección exacta). |
| `hero.imagenes` | 1–4 imágenes (`assets/img/brand/hero-1.webp`, `hero-2.webp`). |
| `categorias` | Exactamente las 4 categorías, cada una con `nombre`, `descripcion` e `imagen` (`assets/img/brand/cat-<categoria>.webp`). |
| `lookbook` | `{id:"look-1", titulo, descripcion?, imagen, productos:[ids existentes]}`. |
| `testimonios` | Solo reales: `verificado` debe ser `true`. Hoy `[]` (la sección se oculta). |
| `aviso_muestra`, `aviso_ia` | "Catálogo de muestra · precios referenciales", "Imagen referencial (IA)". |
| `mensajes` | Plantillas de WhatsApp: `pedido`, `consulta_muestra` (marcadores `{nombre}`, `{id}`, `{url}`), `consulta`. |

## 7. Reglas del validador (D9 + ajustes)

| Código | Regla |
|---|---|
| `esquema` | JSON Schema: tipos, enums, patrones, longitudes, `additionalProperties:false` (campo inventado = error; `nuevo` ya no existe). |
| `json` | El documento no es JSON válido u objeto. |
| `tamano` | Cada JSON debe pesar **menos de 1 000 000 bytes** (se mide el texto recibido y el serializado con 2 espacios). |
| `html` | Ningún texto (ni nombre de campo) contiene `<` o `>`. |
| `enlace` | Solo `https://` y dominios permitidos (redes y mapa); cualquier `javascript:`, `data:`, `vbscript:` o `file:` es error. |
| `secreto` | Rechaza `bot<dígitos>:`, `<8–10 dígitos>:<35 caracteres>` (token de Telegram), `github_pat_`, `ghp_`, `gho_/ghu_/ghs_/ghr_`, claves privadas, `AKIA…`, `sk-…`. |
| `id_duplicado`, `slug_duplicado` | `id` y `slug` únicos (productos, artículos, lookbook). |
| `precio`, `precio_oferta` | 2 decimales; `precio_oferta < precio`. Aviso si el descuento supera 70 %. |
| `talla_categoria` | Tallas coherentes con la categoría. |
| `stock` | Claves de `stock_por_talla` = `tallas`; `stock` = suma. |
| `fecha` | Fechas válidas; actualización ≥ creación; `fecha_creacion` no cambia (con `anterior`). |
| `imagen_origen` | `ia_local` solo en productos `muestra:true`. |
| `imagen_ruta` | `placeholder` ⇔ `assets/img/placeholders/`. |
| `referencia` | Artículos (`productos_relacionados` y bloques `producto`) y lookbook solo citan productos que existen (si están ocultos: aviso `referencia_inactiva`). |
| `whatsapp` | `^51\d{9}$`, no es número de ejemplo, `telefono_visible` coincide. |
| `horario`, `categorias` | `abre < cierra`; las 4 categorías presentes. |

**Avisos** (no bloquean): `agotado`, `sin_imagen`, `descuento`, `colores`, `bloques`, `referencia_inactiva`, `slug`, `version`, `whatsapp_cambio`, `archivo` (solo CLI).

### Límites de daño (requieren `opciones.anterior`)

| Código | Regla |
|---|---|
| `fuera_de_lote` | Con `idsLote`, solo pueden cambiar (crearse, borrarse o modificarse) los `id` del lote; para tocar `site.json` el lote debe incluir `"site"`. La envoltura (`version`, `actualizado`, `borradores_aplicados`) no cuenta. |
| `borrado_masivo` | El total de productos (o de artículos) no puede bajar en más de 1, y los activos tampoco, salvo `permitirLimpieza:true`. |
| `limpieza` | Con `permitirLimpieza`, todo lo que se quita u oculta debe ser `muestra:true` en `anterior`. |
| `muestra` | Un registro real (`muestra:false`) no puede volver a ser muestra (evita colar imágenes IA en productos reales). |
| `permiso` | Con `rol:"marketing"`: no puede borrar, ni cambiar `whatsapp`/`telefono_visible`, ni otros datos de la tienda (horario, envío, redes…), ni `/limpiar_muestras`. Sí puede imágenes de hero, categorías y lookbook. |

**Cómo debe llamarlo WF5 (lotes):** el commit agrupa varios borradores, pero los límites de daño se comprueban **por borrador**: para cada borrador aprobado, `validar(estadoTrasEsteBorrador, {anterior: estadoAntesDeEsteBorrador, idsLote: idsQueTocaEsteBorrador, rol: borrador.rol, permitirLimpieza: borrador.op === 'limpiar_muestras'})`. Al final, `validar(estadoFinal, {})` sobre el documento completo. Si un borrador falla, se marca `error` (con los mensajes) y el resto del lote sigue.

## 8. Borrador (Data Table `borradores`)

Toda escritura (texto o foto libre, `/precio`, `/stock`, `/ocultar`, `/mostrar`, `/foto`, `/borrar`, `/whatsapp`, `/limpiar_muestras`, `/deshacer`, artículos, imagen de `/imagen`) crea **un borrador**; nada se publica sin el botón **Publicar**.

| Columna | Tipo Data Table | Contenido |
|---|---|---|
| `draft_id` | string | `drf-` + `Date.now().toString(36)` + 2 caracteres aleatorios `[a-z0-9]` (ej. `drf-mg2x9k3lq7`). Patrón `^drf-[a-z0-9]{6,20}$`. |
| `owner_id` | number | `from.id` de quien lo creó (solo él puede pulsar Publicar/Cancelar). |
| `rol` | string | `admin` · `dueno` · `marketing` (copiado de `AUTORIZADOS` al crear). |
| `chat_id` | number | Chat privado del autor. |
| `preview_message_id` | number | `message_id` de la vista previa con botones (se verifica en el callback). |
| `origen` | string | `telegram` · `form` · `panel`. |
| `op` | string | `crear` · `actualizar` · `desactivar` · `reactivar` · `stock` · `agregar_imagen` (las del LLM) + `eliminar` · `limpiar_muestras` · `deshacer` (solo por comando, nunca del LLM). |
| `entidad` | string | `producto` · `articulo` · `sitio`. |
| `entidad_id` | string | `prd-0007`, `art-0002`, `site`; vacío si `op=crear` (el id se asigna **al publicar** con `siguienteId()` y se guarda aquí). |
| `campos` | string (JSON) | La operación ya normalizada por `validarOperacion()` (o construida por el comando). |
| `campos_inferidos` | string (JSON) | Campos que puso la IA sin que el dueño los dijera: la vista previa los marca "(sugerido por IA)". |
| `faltantes` | string (JSON) | Lo que hay que pedir. **El botón Publicar solo aparece si está vacío.** |
| `avisos` | string (JSON) | Avisos de `validarOperacion()`/`validar()` para la vista previa. |
| `update_ids` | string (JSON) | `update_id` de Telegram que originaron el borrador (álbum = varios). |
| `file_ids` | string (JSON) | `file_id` de la foto más grande de cada `message.photo`. Las fotos se vuelven a descargar al publicar (la Data Table no guarda binarios). |
| `file_unique_ids` | string (JSON) | Para detectar la misma foto reenviada. |
| `fecha` | string ISO | Creación (`-05:00`). |
| `expira` | string ISO | `fecha` + 24 h. WF10 pasa a `expirado` lo pendiente vencido. |
| `estado` | string | Ver transiciones. |
| `confirmaciones` | number | Toques de confirmación recibidos (0, 1, 2). |
| `confirmaciones_requeridas` | number | 1; **2** para `eliminar`, `limpiar_muestras`, cambio de `whatsapp` y `deshacer`. |
| `intentos` | number | Reintentos de publicación (máximo 3). |
| `error` | string | Último error **censurado** (sin tokens; mismo filtro que WF9). |
| `commit_sha` | string | SHA del commit que lo publicó. |

**Estados y transiciones** (cada cambio es un `UPDATE … WHERE estado = <anterior>`; si afecta 0 filas, no se hace nada):

```
pendiente --Publicar (from.id = owner_id, message_id = preview_message_id, faltantes = [])--> aprobado
pendiente --Cancelar--> cancelado          pendiente --(24 h, WF10)--> expirado
aprobado  --WF5 toma el lote--> publicando --commit OK--> publicado (+commit_sha)
publicando --fallo--> aprobado (intentos+1)   --3 fallos--> error
```

`callback_data` (≤ 64 bytes): `pub:<draft_id>`, `no:<draft_id>`, `ok2:<draft_id>` (segunda confirmación). Tras el primer toque se quitan los botones.

**Mensaje de commit:** `data(products): actualizar prd-0007 precio 69.90 [telegram draft:drf-mg2x9k3lq7]` (entidad, op, id, origen y borrador). Autor: "Tienda Bot" con correo noreply.

**Aplicar un borrador (WF5), resumen del mapeo LLM → producto:**
- `crear`: `id = siguienteId(productos,'prd')`; `slug = slugificar(nombre)` (+ sufijo si existe); `subcategoria` null → `otros`; `tallas` en el orden de `TALLAS`; `stock_por_talla` desde `stock_tallas` (si viene vacío: 1 por talla y aviso "stock asumido"); `stock` = suma; `colores` con `colorHex()`; `descripcion` null → ""; `etiquetas` con `slugificar()` (2–24, máx. 10); imágenes de `file_ids` → `{src:"assets/img/products/<slug>-<n>-<hash8>.webp", alt: textoSeguro(alt_imagen || nombre, 160), origen:"foto", ancho, alto}`; `destacado` null → false; `activo:true`, `muestra:false`; fechas = ahora.
- `actualizar`: solo los campos no vacíos; `precio_oferta: 0` = **quitar la oferta** (se borra la clave).
- `desactivar` / `reactivar`: `activo` false / true.
- `stock`: según `stock_modo` → `fijar` (= cantidad), `sumar` (+), `restar` (−; si queda < 0 es error). Si la talla no está en `tallas` y es válida para la categoría, se añade.
- `agregar_imagen`: añade la foto (máximo 6).
- `eliminar` (solo `/borrar`, doble confirmación): quita el producto; antes avisa si algún artículo o look lo cita (y quita esas referencias en el mismo borrador).
- `limpiar_muestras` (doble confirmación, confirma el número exacto): quita los productos `muestra:true` y sus referencias en artículos y lookbook; se valida con `permitirLimpieza:true`.
- Siempre: `fecha_actualizacion` = ahora; en la envoltura `version+1`, `actualizado` = ahora y `borradores_aplicados` = últimos 100 con este `draft_id`.

## 9. `AUTORIZADOS` y permisos

Fila `AUTORIZADOS` de la Data Table `config` (texto JSON). Los `id` se completan después de ejecutar WF0 (que muestra los `from.id`); `0` = sin asignar y nunca coincide.

```json
[
  { "id": 0, "rol": "admin",     "nombre": "Abner (demo y soporte)" },
  { "id": 0, "rol": "dueno",     "nombre": "Dueño de la tienda" },
  { "id": 0, "rol": "marketing", "nombre": "Encargado de marketing" }
]
```

Filtro (D2): `from.id` ∈ ids con `id > 0` **y** `chat.type == "private"`. Lo demás se ignora en silencio. `puede(rol, accion)` en `validar.js`:

| Acción (comandos) | admin | dueno | marketing |
|---|---|---|---|
| `consulta` (`/ayuda`, `/lista`, `/ver`, `/estado`, `/historial`) | sí | sí | sí |
| `crear`, `actualizar`, `stock`, `desactivar`, `reactivar`, `agregar_imagen` (texto o foto libre, `/precio`, `/stock`, `/ocultar`, `/mostrar`, `/foto`) | sí | sí | sí |
| `articulo` (`/articulo`, `/articulo_editar`, `/articulo_ocultar`), `imagen` (`/imagen`, botones Portada/Hero/Lookbook) | sí | sí | sí |
| `publicar` (Publicar/Cancelar de **sus** borradores) | sí | sí | sí |
| `borrar` (`/borrar`), `whatsapp` (`/whatsapp`), `limpiar_muestras`, `deshacer`, `pausa`, `reanudar`, `sitio_datos` (horario, envío, redes, dirección) | sí | sí | **no** |

El validador lo refuerza con `opciones.rol` (código `permiso`).

## 10. Operación del LLM (D4)

**Petición** a `POST http://host.docker.internal:11434/api/chat` (desde n8n). `cuerpoOllama()` la arma así:

```json
{
  "model": "qwen3.5:4b-q4_K_M", "stream": false, "think": false, "keep_alive": "2m",
  "options": { "temperature": 0, "num_ctx": 8192 },
  "format": "<contenido de data/schema/ollama-format-producto.json>",
  "messages": [
    { "role": "system", "content": "<PROMPT_PRODUCTO con {{CATALOGO}} = líneas 'id | nombre | categoria | precio'>" },
    { "role": "user", "content": "<texto del dueño>", "images": ["<foto en base64>"] }
  ]
}
```

Usar `keep_alive: 0` en la última llamada antes de generar imágenes (D3). La respuesta útil es `message.content` (texto JSON).

**Salida** (`format` = `data/schema/ollama-format-producto.json`): `{op, entidad, id, campos, campos_inferidos, faltantes}`.
- `op`: `crear` · `actualizar` · `desactivar` · `reactivar` · `stock` · `agregar_imagen` (**no existe** `eliminar_definitivo`).
- `entidad`: `producto` (o `articulo` con el otro esquema). `id`: `prd-0000` o `null` si `crear`.
- `campos`: `nombre, categoria, subcategoria, precio, precio_oferta, tallas, stock_tallas[{talla,cantidad}], stock_modo (fijar|sumar|restar), colores[nombres], material, descripcion, etiquetas, alt_imagen, destacado`. Lo que no se sabe va en `null` o `[]`.
- `campos_inferidos`: campos deducidos (la vista previa los marca). `faltantes`: lo que hay que pedir al dueño.

Esquema `format` de producto (igual a `data/schema/ollama-format-producto.json`):

```json
{
  "type": "object",
  "properties": {
    "op": {
      "type": "string",
      "enum": ["crear", "actualizar", "desactivar", "reactivar", "stock", "agregar_imagen"]
    },
    "entidad": {
      "type": "string",
      "enum": ["producto"]
    },
    "id": {
      "type": ["string", "null"],
      "description": "prd-0000 del catálogo; null si op=crear"
    },
    "campos": {
      "type": "object",
      "properties": {
        "nombre": {
          "type": ["string", "null"]
        },
        "categoria": {
          "type": ["string", "null"],
          "enum": ["hombres", "mujeres", "ninos", "accesorios", null]
        },
        "subcategoria": {
          "type": ["string", "null"],
          "enum": ["polos", "camisas", "blusas", "vestidos", "faldas", "shorts", "bermudas", "pantalones", "conjuntos", "ropa-de-bano", "pijamas", "sombreros", "gorros", "gorras", "sandalias", "lentes", "bolsos", "otros", null]
        },
        "precio": {
          "type": ["number", "null"]
        },
        "precio_oferta": {
          "type": ["number", "null"]
        },
        "tallas": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["XS", "S", "M", "L", "XL", "XXL", "2", "4", "6", "8", "10", "12", "14", "16", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "UNICA"]
          }
        },
        "stock_tallas": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "talla": {
                "type": "string",
                "enum": ["XS", "S", "M", "L", "XL", "XXL", "2", "4", "6", "8", "10", "12", "14", "16", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "UNICA"]
              },
              "cantidad": {
                "type": "integer"
              }
            },
            "required": ["talla", "cantidad"]
          }
        },
        "stock_modo": {
          "type": ["string", "null"],
          "enum": ["fijar", "sumar", "restar", null],
          "description": "fijar = cantidad total nueva; sumar = llegaron N más; restar = se vendieron N"
        },
        "colores": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "material": {
          "type": ["string", "null"]
        },
        "descripcion": {
          "type": ["string", "null"]
        },
        "etiquetas": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "alt_imagen": {
          "type": ["string", "null"]
        },
        "destacado": {
          "type": ["boolean", "null"]
        }
      },
      "required": ["nombre", "categoria", "subcategoria", "precio", "precio_oferta", "tallas", "stock_tallas", "stock_modo", "colores", "material", "descripcion", "etiquetas", "alt_imagen", "destacado"]
    },
    "campos_inferidos": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["nombre", "categoria", "subcategoria", "precio", "precio_oferta", "tallas", "stock_tallas", "stock_modo", "colores", "material", "descripcion", "etiquetas", "alt_imagen", "destacado"]
      }
    },
    "faltantes": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["nombre", "categoria", "subcategoria", "precio", "precio_oferta", "tallas", "stock_tallas", "stock_modo", "colores", "material", "descripcion", "etiquetas", "alt_imagen", "destacado", "id", "foto"]
      }
    }
  },
  "required": ["op", "entidad", "id", "campos", "campos_inferidos", "faltantes"]
}
```

**Reglas de categoría** (en el prompt y, además, aplicadas de forma determinista por `inferirCategoria()` sobre el texto del dueño, que **corrige** al LLM; así se resuelve el caso real "polo para dama" → `hombres`):
1. niño, niña, niños, infantil, bebé, nene, nena, escolar → `ninos` (aunque sea gorro o sandalia).
2. gorra, gorro, sombrero, bolso, cartera, lentes, gafas, mochila, correa → `accesorios`.
3. dama, mujer, señora, señorita, femenino → `mujeres`.
4. caballero, hombre, varón, masculino → `hombres`.
5. sandalias sin género o "unisex" → `accesorios`.
6. Sin palabra clave: el LLM deduce por la prenda y lo marca como inferido.

**Después de Ollama, siempre `validarOperacion(content, {texto, hayFoto, productos})`**, que devuelve `{ok, errores, avisos, faltantes, operacion, reintentar}`:
- Rellena campos ausentes, valida contra el esquema y rechaza `<`/`>` y secretos.
- **Corrige la categoría** según las reglas de arriba (aviso `[categoria]`).
- **Normaliza por operación**: `desactivar`/`reactivar` sin campos; `stock` solo `stock_tallas`+`stock_modo` (sin modo → `fijar` con aviso); `agregar_imagen` solo `alt_imagen`; en `actualizar` quita los campos que no cambian respecto del catálogo.
- **Crear vs. actualizar:** un 4B tiende a "actualizar" un producto parecido cuando el dueño describe uno nuevo. Si el texto no menciona ningún id ni pide un cambio (`pideCambio()`), se fuerza `crear` y devuelve `reintentar:"crear"`: **WF3 repite una vez** la llamada con `cuerpoOllama({..., reintento:true})` (añade "es un producto NUEVO") y vuelve a validar. Si el id no aparece en el texto pero sí hay un verbo de cambio, queda el aviso `[id_inferido]` para que el dueño lo confirme en la vista previa.
- Calcula `faltantes` para `crear` (nombre, categoría, precio, tallas, colores; accesorios como bolsos/lentes/gorras/sombreros sin tallas → `UNICA` inferido) y avisa si no hay foto.

**Prueba real (2026-10-06, Ollama 0.35.1, `qwen3.5:4b-q4_K_M`, sin foto, 15 mensajes en español):** JSON válido **15/15**; operación e id correctos **15/15** (3 necesitaron el reintento "crear"; sin ese paso eran 12/15); categoría correcta **9/9** (incluido "Polo para dama…" → `mujeres`, "Gorro UV para niños" → `ninos`, "bolso tejido para dama" → `accesorios`); "89,90" → 89.9, "de la 38 a la 42" → 38–42, "llegaron 5 más" → `sumar`, "quedan 2" → `fijar`, "quita la oferta" → `precio_oferta 0`. Tiempo: 2–3 s por llamada con el modelo cargado (≈ 5,5 s la primera; ≈ 5–7 s con reintento). **No probado aún con fotos** (F5).

Prompt del sistema para productos (`PROMPT_PRODUCTO` en `tools/validar.js`; `{{CATALOGO}}` lo reemplaza `cuerpoOllama()`):

```text
Eres el asistente de catálogo de la tienda de ropa "Palmera Brava" (Tarapoto, Perú). Conviertes UN mensaje del dueño (texto y, a veces, una foto) en UNA operación JSON. No publicas nada: un programa revisa tu respuesta y el dueño la aprueba.

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
{{CATALOGO}}
```

## 11. Artículos con el LLM (`/articulo <tema>`)

Mismo flujo con `cuerpoOllama({tipo:'articulo', texto, productos})` (temperatura 0.3) y `format` = `data/schema/ollama-format-articulo.json`: `campos = {titulo, resumen, bloques[{tipo: parrafo|subtitulo|lista|cita, texto, items}], productos_relacionados, alt_portada}`. Después: `validarOperacion()` (quita ids inexistentes), `bloquesDesdeLLM()` (convierte y recorta a los límites del esquema), `textoSeguro(titulo,110)`, `textoSeguro(resumen,240)`, `textoSeguro(alt_portada,160)`, y el código añade un bloque `{tipo:"producto", ids}` con hasta 4 relacionados. Portada: imagen de `/imagen` (botón "Portada") o `placeholder`.

Prueba real: "Qué ropa llevar para visitar las cataratas de Ahuashiyacu" → JSON válido, 15 bloques, 4 productos existentes, ≈ 14 s; convertido con las ayudas pasa `validar()` como `art-0004` con rol `marketing`. La redacción de un 4B necesita revisión humana (por eso hay borrador).

Esquema `format` de artículo (igual a `data/schema/ollama-format-articulo.json`):

```json
{
  "type": "object",
  "properties": {
    "op": {
      "type": "string",
      "enum": ["crear", "actualizar", "desactivar", "reactivar"]
    },
    "entidad": {
      "type": "string",
      "enum": ["articulo"]
    },
    "id": {
      "type": ["string", "null"],
      "description": "art-0000; null si op=crear"
    },
    "campos": {
      "type": "object",
      "properties": {
        "titulo": {
          "type": ["string", "null"]
        },
        "resumen": {
          "type": ["string", "null"]
        },
        "bloques": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "tipo": {
                "type": "string",
                "enum": ["parrafo", "subtitulo", "lista", "cita"]
              },
              "texto": {
                "type": "string"
              },
              "items": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "required": ["tipo", "texto", "items"]
          }
        },
        "productos_relacionados": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "alt_portada": {
          "type": ["string", "null"]
        }
      },
      "required": ["titulo", "resumen", "bloques", "productos_relacionados", "alt_portada"]
    },
    "campos_inferidos": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["titulo", "resumen", "bloques", "productos_relacionados", "alt_portada"]
      }
    },
    "faltantes": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["titulo", "resumen", "bloques", "productos_relacionados", "alt_portada", "id", "tema"]
      }
    }
  },
  "required": ["op", "entidad", "id", "campos", "campos_inferidos", "faltantes"]
}
```

Prompt del sistema para artículos (`PROMPT_ARTICULO`):

```text
Eres el redactor del blog de la tienda de ropa "Palmera Brava" (Tarapoto, San Martín, Perú). Con el TEMA que te da el dueño escribes UN artículo útil, honesto y breve (350 a 600 palabras) y lo devuelves como UNA operación JSON. Un programa lo revisa y el dueño lo aprueba antes de publicarlo.

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
{{CATALOGO}}
```

## 12. Imágenes con IA local (`tools/image-prompts.json`)

Lista de 29 entradas, una por cada imagen que citan los JSON (la prueba 8 lo verifica):

| Campo | Significado |
|---|---|
| `path` | Ruta final en el repo (`assets/img/...webp`). |
| `size` | Tamaño final: productos, categorías y lookbook 768×1024; hero 1344×768; blog 1216×832 (múltiplos de 64). |
| `seed` | Semilla fija (reproducible). Cambiarla solo para regenerar una imagen mala. |
| `prompt` | En inglés; fotografía editorial de moda, luz cálida tropical, fondos de palmas, paredes cálidas o selva, paleta de web-design.md; "No text, no logos, no watermark". |
| `personas` | `true` en las 14 imágenes con personas: llevan **"cropped at the neck, no face, no head visible"** y "adults only". |
| `generar` | Tamaño que se pide a sd-server: igual a `size`, o más alto si hay personas (768×1216 o 1344×1024). |
| `recortar_arriba` | Píxeles que se recortan **arriba** para llegar a `size` (0, 192 o 256). |

Reglas: niños y accesorios **sin personas** (flat-lay, percha o bodegón: "No people, no mannequin, no hands, product only"); en `ninos` jamás hay personas.

**Por qué se genera más alto y se recorta:** probado hoy con sd-server (Z-Image Turbo): aunque el prompt pida "cropped at the neck", el modelo suele dejar el borde superior a la altura de la boca o el mentón (pasó en 5 de 5 intentos del hero y en 7 de 7 del lookbook; los productos con encuadre cercano salieron bien). Generando más alto y recortando 192–256 px de arriba, las 4 pruebas quedaron sin rostro. Recorte sin descargar nada, con el GraphicsMagick que ya trae el contenedor de n8n (por tubería, sin escribir en su volumen):

```bash
docker exec -i n8n gm convert webp:- -gravity South -crop 768x1024+0+0 +repage -quality 80 webp:- < generada.webp > final.webp
```

Petición a sd-server (`POST http://127.0.0.1:1234/v1/images/generations`): `{"prompt": "<prompt> <sd_cpp_extra_args>{\"seed\":<seed>,\"sample_params\":{\"sample_steps\":8,\"sample_method\":\"euler\",\"scheduler\":\"simple\",\"guidance\":{\"txt_cfg\":1.0}}}</sd_cpp_extra_args>", "n":1, "size":"<generar>", "output_format":"webp", "output_compression":80}`. Medido hoy: 12–17 s por imagen (768×1216 ≈ 15 s; 1344×1024 ≈ 24 s).

**QA obligatorio de cada imagen** (antes de publicar): sin rostro (ni boca ni mentón), sin niños con personas, sin texto ni logos, prenda del color del producto. Si falla: otra `seed` (+1000) y volver a revisar.

## 13. Pendientes y supuestos

- **Por confirmar con el dueño:** días de atención (se puso "Todos los días"), dirección exacta y coordenadas (el mapa es de referencia, sin marcador), zonas de reparto además de Tarapoto, costo de envío, medios de pago, política de cambios y redes sociales.
- **`AUTORIZADOS`:** faltan los `from.id` reales (WF0).
- Las 29 imágenes **aún no existen** en `assets/` (las genera el equipo D con `tools/image-prompts.json`); el CLI lo informa con el aviso `[archivo]`.
- Convertir una muestra en producto real (cambiar `muestra` a `false`) exige quitar antes sus imágenes `ia_local` (el validador lo impide si no). Se sugiere un comando de admin/dueño para eso.
- El LLM no se probó todavía con fotos (visión); queda para F5 con 15 mensajes reales.
