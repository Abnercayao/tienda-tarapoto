# Especificación de diseño y arquitectura frontend: tienda de ropa de verano en Tarapoto

Esta especificación está lista para pasarla a un equipo de implementación. Todo lo marcado como **[INCIERTO]** está sin confirmar. Lo marcado como **[VERIFICADO]** lo comprobé en esta sesión, ya sea en la web o en la PC con comandos de solo lectura. No instalé, modifiqué ni publiqué nada.

---

## 0. Hallazgos verificados que condicionan la arquitectura

1. **GitHub Pages guarda en caché 10 minutos y su CDN ignora el `?v=`** [VERIFICADO].
   - Toda respuesta trae `Cache-Control: max-age=600`.
   - Hice una prueba sobre `pages.github.com/versions.json` con y sin `?nocache=<aleatorio>`. Las dos peticiones devolvieron el mismo `X-GitHub-Request-Id`, el mismo `Age` y `X-Cache: HIT`.
   - Conclusión: el `?v=` en la URL no evita la caché del CDN. Solo evita la del navegador, y además impide la respuesta 304 barata.
   - Lo comprobé el 2026-10-05; no está documentado oficialmente. Se resuelve como indica el punto 3.4.
2. **Límites de Pages** [VERIFICADO, docs].
   - El sitio puede pesar hasta 1 GB y hay 100 GB de ancho de banda al mes (límite flexible).
   - Hay un **límite flexible de 10 builds por hora** si se publica desde una rama. Ese límite no aplica si se publica con un workflow propio de GitHub Actions.
   - Consecuencia: el agente de n8n debe **agrupar los cambios** y no hacer un commit por cada mensaje.
3. **Las condiciones de GitHub Pages excluyen las tiendas online** [VERIFICADO, docs].
   - Pages no se permite "as a free web-hosting service to run your online business, e-commerce site…".
   - Mitigación: el sitio queda como **catálogo/escaparate, sin checkout ni pagos**. El pedido se hace por WhatsApp.
   - [INCIERTO] Es una interpretación mía. Si el negocio crece, conviene migrar a Cloudflare Pages o Netlify, que admiten el mismo HTML estático.
4. **La API de contenidos de GitHub** [VERIFICADO].
   - Para actualizar un archivo exige el `sha` del blob anterior. Si no coincide, responde 409 Conflict.
   - El contenido va en Base64.
   - Los archivos de 1 MB o menos tienen soporte completo; por encima de 1 MB, solo los media types raw/object.
   - La documentación advierte que, si se crea y se borra en paralelo, las peticiones entran en conflicto. **Las escrituras deben ser en serie.**
   - El nodo GitHub de n8n permite crear, borrar, editar, obtener y listar archivos.
5. **Open Generative AI ya está instalado en la PC** [VERIFICADO, solo lectura].
   - Está en `C:\Program Files\Open Generative AI`, versión 1.0.9. La última release es la v2.0.0 (2026-05-23).
   - El motor local sd.cpp está instalado, con build CUDA, en `C:\Users\abner\AppData\Roaming\open-generative-ai\local-ai\bin\`. Esa carpeta incluye **`sd-server.exe`**.
   - Los modelos ya están descargados: `z_image_turbo-Q4_K.gguf`, `Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf` y `ae.safetensors`. Z-Image-Turbo tiene licencia Apache-2.0.
   - Wan2GP está configurado en `http://127.0.0.1:7860` (`wan2gp.json`), pero ahora mismo no está corriendo.
   - Probablemente esta es la "app de escritorio" que menciona Abner.
   - La app de escritorio es Electron y carga un archivo local (`loadFile`). **No abre ningún puerto HTTP ni registra un protocolo propio.** Revisé `electron/main.js` del repo y una búsqueda de `setAsDefaultProtocolClient` dio 0 resultados.
   - Por eso **una página web no puede abrir ni manejar la app de escritorio**.
   - Según el README, la inferencia local solo existe en la app de escritorio. La versión web o Docker (`docker-compose` publica el puerto 3001 hacia el 3000) usa la nube de Muapi y requiere API key de pago.
6. **`sd-server` de stable-diffusion.cpp** [VERIFICADO en el README del repo upstream].
   - Ofrece una interfaz web y APIs `/v1/...` (compatible con OpenAI, incluido `/v1/images/generations`), `/sdapi/v1/...` y `/sdcpp/v1/...`.
   - Escucha por defecto en `http://127.0.0.1:1234` y se cambia con `--listen-ip/--listen-port`.
   - El código devuelve CORS reflejando el `Origin`.
   - [INCIERTO] Si el `sd-server.exe` instalado (OGA 1.0.9) trae la misma versión, el mismo puerto y la interfaz web integrada.
7. **n8n local** [VERIFICADO].
   - Escucha en `:5678`. `GET /healthz` devuelve `{"status":"ok"}`.
   - No envía cabeceras CORS. Desde otra página solo se puede comprobar si está vivo con `fetch(..., {mode:'no-cors'})`, o con un webhook que tenga "Allowed Origins (CORS)" configurado (opción documentada del nodo Webhook).
8. **Navegador contra localhost** [VERIFICADO, fuentes secundarias].
   - Desde Chrome 142, una página pública que hace peticiones a loopback muestra un aviso de permiso (Local Network Access). Desde Chrome 145 se separa en "Apps on device" y "Local network".
   - Safari bloquea como mixed content las peticiones a `http://localhost` desde una página HTTPS.
   - Por eso **el sitio público nunca debe llamar a localhost**.
9. **Abrir el sitio con doble clic (`file://`), como pide la diapositiva 20, rompe dos cosas.**
   - En Chrome, `fetch()` no funciona sobre `file://` y los `<script type="module">` quedan bloqueados por CORS. Es conocimiento estándar; no lo probé.
   - Solución: scripts clásicos con `defer`, más un catálogo semilla en línea como respaldo. Para la prueba completa: `python -m http.server`.

---

## 1. Concepto y marca

**Concepto: "Selva pop editorial".** Calor de selva alta con un acabado de revista moderna, sin plantilla genérica.

- **Motivos:**
  - Palmeras, por "Ciudad de las Palmeras".
  - Cataratas Ahuashiyacu y Huacamaillo y la Laguna Azul (en el agua, los bordes ondulados).
  - El cacao de San Martín (el marrón).
  - El motocarro (icono de reparto local).
  - El sol fuerte de 24 a 33 °C.

### Nombres provisionales

Hay que verificar en INDECOPI y en redes sociales antes de usar cualquiera.

1. **Palmera Brava** (recomendado). Lema: "Ropa fresca para el calor de la selva".
2. **Cocha Azul**. "Cocha" significa laguna en el castellano amazónico y evoca la Laguna Azul. Lema: "Fresca como la laguna".
3. **Selva Fresca**. Lema: "Telas que respiran, colores que brillan".

### Paleta (tokens CSS) con contraste WCAG calculado [VERIFICADO con un script]

```css
:root{
  /* Marca */
  --c-sand-50:#FBF6EC; --c-sand-200:#F1E6CF;
  --c-ink:#10231C;     --c-ink-muted:#4A5D55;
  --c-palm:#0F5C46;    --c-palm-700:#0A4535; --c-palm-100:#DCEFE6;
  --c-lagoon:#14A3A0;  --c-lagoon-700:#0B7A78; --c-lagoon-100:#D3F1EF;
  --c-mango:#FF8A1F;   --c-mango-700:#A34E00;
  --c-hibiscus:#C41E50; --c-sun:#FFD23F; --c-cacao:#5A3825; --c-wa:#25D366;
  /* Semánticos – claro */
  --bg:var(--c-sand-50); --surface:#FFFFFF; --surface-2:var(--c-sand-200);
  --text:var(--c-ink); --text-muted:var(--c-ink-muted);
  --primary:var(--c-palm); --on-primary:#FFFFFF;
  --accent:var(--c-mango); --on-accent:var(--c-ink);
  --link:var(--c-lagoon-700); --sale:var(--c-hibiscus); --on-sale:#FFFFFF;
  --border:#7A8F86; --border-soft:#E4D9C3; --focus:var(--c-mango-700);
  /* Forma / movimiento / tipo */
  --radius-s:8px; --radius-m:16px; --radius-l:28px; --radius-arch:999px 999px 24px 24px;
  --shadow-1:0 1px 2px rgb(16 35 28/.08),0 4px 12px rgb(16 35 28/.06);
  --shadow-2:0 14px 32px -10px rgb(15 92 70/.30);
  --ease-out:cubic-bezier(.2,.7,.2,1); --dur-1:150ms; --dur-2:300ms; --dur-3:600ms;
  --font-display:"Bricolage Grotesque",system-ui,sans-serif;
  --font-body:"Figtree",system-ui,sans-serif;
  --font-accent:"Instrument Serif",Georgia,serif;
  --step-0:clamp(1rem,.96rem + .2vw,1.125rem);
  --step-5:clamp(2.6rem,1.6rem + 5vw,5.5rem);
  color-scheme:light;
}
:root[data-theme="dark"]{
  --bg:#0B1712; --surface:#13261E; --surface-2:#1B3328;
  --text:#F3EEDF; --text-muted:#A9B8AF;
  --primary:#3FC79A; --on-primary:#0B1712; --accent:#FFA24D; --on-accent:#0B1712;
  --link:#4FD6D2; --sale:#FF6B93; --on-sale:#0B1712; --border:#4E6A5D; --focus:#FFD23F;
  color-scheme:dark;
}
@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){ /* mismos valores que [data-theme="dark"] */ } }
body{background:var(--bg);color:var(--text)}
```

Contrastes calculados (mínimo AA: 4.5 para texto, 3 para UI):

| Combinación (tema claro) | Contraste |
|---|---|
| Tinta sobre arena | 15.24 |
| Texto atenuado sobre arena | 6.52 |
| Blanco sobre palma | 7.96 |
| Tinta sobre mango | 6.96 |
| Enlace lagoon-700 sobre arena | 4.79 |
| Blanco sobre hibisco | 5.76 |
| Hibisco sobre arena | 5.34 |
| Borde sobre arena | 3.20 |
| Foco mango-700 | 5.35 |
| Tinta sobre el verde de WhatsApp | 8.28 |

| Combinación (tema oscuro) | Contraste |
|---|---|
| Texto | 15.81 |
| Texto atenuado | 8.87 |
| Palma | 8.60 |
| Laguna | 10.37 |
| Mango | 9.19 |
| Hibisco | 6.79 |
| Borde | 3.09 |

**Combinaciones prohibidas:**

| Combinación | Contraste | Problema |
|---|---|---|
| Blanco sobre mango | 2.36 | No llega al mínimo |
| Turquesa `#14A3A0` como texto sobre arena | 2.88 | Úsalo solo como decoración o fondo con tinta encima |
| Blanco sobre `#25D366` | 1.98 | El botón de WhatsApp lleva texto oscuro |

### Tipografía (Google Fonts) [VERIFICADO: todas devuelven 200 con esos ejes]

- **Opción A (recomendada):** Bricolage Grotesque (títulos, variable opsz/wght), Figtree (texto) e Instrument Serif *itálica* (solo 1 o 2 palabras de acento por título, por ejemplo "ropa *fresca*").
  `https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Figtree:wght@400..700&family=Instrument+Serif:ital@0;1&display=swap`
- **Opción B (más pop):** Unbounded, Plus Jakarta Sans y Caveat (stickers manuscritos).
- **Opción C (más suave y editorial):** Fraunces (eje SOFT) y Outfit.
- Reglas: como máximo 3 familias, `display=swap` y `preconnect` a fonts.gstatic.com.

### Elementos propios de la marca

- **Índice de frescura** en cada producto: de 1 a 5 hojitas, según el campo `frescura`. Comunica "apto para el calor" y diferencia la tienda.
- Fotos con **marco de arco**, como un dosel de palmera o una ventana colonial, y etiquetas tipo "etiqueta cosida" con el material ("Lino 100 %", "Algodón pima").
- Stickers rotados (-6°) para "Nuevo", "-20 %" y "Muestra".
- Separadores de sección con **borde ondulado SVG**, como río o cascada.
- Textura de grano SVG al 3 % sobre el fondo arena.
- Icono de **motocarro** para el reparto en Tarapoto, Morales y La Banda de Shilcayo.
- Evitar: degradados morados, una sola tipografía Inter y un hero de stock con "Shop now".

### Microinteracciones

Todas se desactivan con `prefers-reduced-motion: reduce`.

- **Aparición al hacer scroll:** IntersectionObserver añade `.is-visible` (opacidad de 0 a 1 y desplazamiento de 16 px a 0, 600 ms, `--ease-out`), con escalonado `--i` de 60 ms.
  - Mejora progresiva: en el hero, parallax de hojas con `animation-timeline: view()` dentro de `@supports`. Funciona en Chrome/Edge 115+ y Safari 26+. En Firefox estable sigue detrás de un flag y se ve estático.
- **Marquee:** "Telas frescas · Envío en motocarro · Pide por WhatsApp · Tallas para toda la familia". Se anima con `translateX(-50%)` sobre contenido duplicado con `aria-hidden`, se pausa con hover/focus y tiene un botón de pausa.
- **Tarjeta de producto:**
  - Al pasar el cursor, cambio con fundido a la segunda imagen, elevación de 4 px y `--shadow-2`. El botón "Vista rápida" sube desde abajo.
  - En pantallas táctiles el botón queda siempre visible.
- **Hojas del hero:** balanceo de 6 s `ease-in-out alternate` con el `transform-origin` en el tallo, y una "sombra de palmera" que se desplaza lentamente.
- **Filtros:** si existe `document.startViewTransition`, se anima el reacomodo de la grilla (Chrome 111+, Safari 18+, Firefox 144+). Si no, el cambio es instantáneo.
- **"Agregado a la bolsa":** el icono rebota y aparece un toast con `aria-live="polite"`.
- **Botones:** al presionar se reducen a escala .97. El botón flotante de WhatsApp tiene un anillo de pulso cada 8 s.
- **Modo claro/oscuro:** un script en línea en `<head>` lee `localStorage['pb:theme']` antes del primer render, para evitar el parpadeo. El interruptor tiene 3 estados: sistema, claro y oscuro.

---

## 2. Mapa de secciones (`index.html`, una página)

| # | Sección | Contenido y comportamiento | Datos |
|---|---|---|---|
| 0 | Barra de anuncio | "Envío gratis en Tarapoto desde S/ 120" (texto de ejemplo), con botón para cerrar | site.json |
| 1 | Header fijo | Logo, menú (Hombres, Mujeres, Niños, Accesorios, Novedades, Lookbook, Contacto), buscar, tema, bolsa con contador. En móvil, menú lateral con `<dialog>` | — |
| 2 | Hero `#inicio` | H1 "Ropa fresca para el calor de la selva". Botones: "Ver catálogo" (mango) y "Pedir por WhatsApp". Collage de 3 fotos con marco de arco, hojas SVG y sticker "¿32 °C? Te tenemos cubierto". Imagen principal con `fetchpriority="high"` | site.json + destacados |
| 3 | Marquee | Banda de mensajes | site.json |
| 4 | Categorías `#categorias` | 4 tarjetas con imagen y contador calculado. Al hacer clic se aplica el filtro y se baja a `#catalogo` | products.json |
| 5 | Novedades y destacados | Carrusel horizontal con scroll-snap y botones anterior/siguiente | `nuevo` / `destacado` |
| 6 | Catálogo `#catalogo` | Búsqueda (ignora tildes), filtros de categoría, subcategoría, talla, color, precio (rangos o mínimo y máximo), "solo ofertas" y orden (destacados, nuevos, precio ↑ y ↓). Chips de filtros activos, contador con `aria-live`, grilla de 2, 3 o 4 columnas y botón "Cargar más" de 12 en 12 (sin scroll infinito). Estado vacío con botón de WhatsApp. Filtros sincronizados con la URL (`?cat=mujeres&talla=M&q=vestido`) | products.json |
| 7 | Vista rápida | `<dialog>` modal con enlace `#p/<slug>`. Galería con scroll-snap, tallas (radio), colores con nombre visible, cantidad, frescura, material, precio/oferta. Botones "Agregar a la bolsa" y "Pedir por WhatsApp". Si `stock=0` aparece "Agotado" y el pedido se desactiva | products.json |
| 8 | Beneficios `#beneficios` | Telas frescas (lino/algodón), entrega en motocarro, cambios (política por confirmar), medios de pago (por confirmar con el dueño, p. ej. Yape/Plin/efectivo) | site.json |
| 9 | Lookbook `#lookbook` | Galería editorial con puntos que enlazan a productos ("comprar el look") | site.json.lookbook |
| 10 | Novedades/Blog `#blog` | Las 3 últimas publicaciones, que llevan a `articulo.html?slug=` | articles.json |
| 11 | Testimonios | **Solo reales** (`verificado:true`). Si no hay ninguno, la sección se oculta. Nunca se publican reseñas inventadas como reales ni `AggregateRating` falso | site.json |
| 12 | Ubicación `#ubicacion` | Dirección, horarios, mapa con fachada "Cargar mapa" (el iframe de OSM o Google se carga al hacer clic) y enlace "Cómo llegar" | site.json |
| 13 | Contacto `#contacto` | Formulario que **solo arma un mensaje de WhatsApp**: no tiene backend ni guarda datos. También teléfono y redes | site.json |
| 14 | Footer | Menú, horarios, redes, "Precios en S/", Libro de Reclamaciones virtual y política de privacidad (Ley 29733). Las obligaciones legales están **[INCIERTO], por verificar** con un asesor | site.json |
| 15 | Botón flotante de WhatsApp | Abajo a la derecha, respeta `safe-area-inset`, se oculta con un dialog abierto | site.json |

**Bolsa de pedido** (no es checkout):

- Se guarda en `localStorage['pb:bag:v1']` y se envía como **un solo mensaje** por WhatsApp.
- Formato: `https://wa.me/<51XXXXXXXXX>?text=<encodeURIComponent>`. Va sin "+", sin ceros, espacios ni guiones.
- Plantilla del mensaje:

```
Hola Palmera Brava, quiero hacer un pedido:
• Camisa de lino Palmeras (prd-0001) – Talla M – Arena – x1 – S/ 69.90
Total referencial: S/ 69.90
Entrega en: ____
Visto en: https://abnercayao.github.io/<repo>/#p/camisa-lino-palmeras-hombre
```

- La URL completa debe quedar por debajo de unos 1800 caracteres. Si se pasa, se recorta y se añade "y N productos más".
- Precios con `new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'})`, que produce "S/ 89.90" [VERIFICADO].

**`articulo.html?slug=`**: lectura de un artículo, construida a partir de bloques con `textContent`. Si un bloque es de tipo `productos`, muestra tarjetas enlazadas.

---

## 3. Datos: esquemas para que el agente de n8n edite sin riesgo

### 3.1 Reglas generales

- Las claves van en snake_case ASCII. Las categorías usan valores sin tildes: `ninos`, y la etiqueta "Niños" se resuelve en el JS.
- Fechas en ISO 8601 con `-05:00` (America/Lima, sin horario de verano).
- `additionalProperties:false`: así el modelo no puede inventar campos.
- Los textos son **texto plano**: el patrón `^[^<>]*$` rechaza `<` y `>`, y el frontend los pinta solo con `textContent`.
- Las rutas de imagen son relativas y siguen un patrón cerrado: nada de URLs externas ni `javascript:`.

### 3.2 `data/products.json`

```json
{
  "$schema": "./schema/products.schema.json",
  "schema_version": 1,
  "revision": 1,
  "actualizado": "2026-10-05T20:00:00-05:00",
  "moneda": "PEN",
  "productos": [
    {
      "id": "prd-0001",
      "slug": "camisa-lino-palmeras-hombre",
      "nombre": "Camisa de lino Palmeras",
      "categoria": "hombres",
      "subcategoria": "camisas",
      "precio": 89.90,
      "precio_oferta": 69.90,
      "tallas": ["S","M","L","XL"],
      "stock_por_talla": {"S":3,"M":5,"L":4,"XL":0},
      "stock": 12,
      "colores": [{"nombre":"Arena","hex":"#E8DCC4"},{"nombre":"Verde palma","hex":"#0F5C46"}],
      "material": "Lino 100%",
      "frescura": 5,
      "imagenes": [
        {"src":"assets/img/products/camisa-lino-palmeras-hombre-1-a1b2c3d4.webp",
         "alt":"Camisa de lino color arena con estampado de palmeras, vista frontal",
         "ancho":1200,"alto":1500,"origen":"placeholder_svg","credito":null}
      ],
      "descripcion": "Camisa fresca de lino, ideal para el calor de Tarapoto.",
      "etiquetas": ["lino","fresca","verano"],
      "destacado": true,
      "nuevo": true,
      "muestra": true,
      "activo": true,
      "orden": 10,
      "fecha_creacion": "2026-10-05T20:00:00-05:00",
      "fecha_actualizacion": "2026-10-05T20:00:00-05:00",
      "origen_registro": "manual"
    }
  ]
}
```

`data/schema/products.schema.json` (JSON Schema 2020-12, versión resumida):

```json
{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false,
 "required":["schema_version","revision","actualizado","moneda","productos"],
 "properties":{"$schema":{"type":"string"},"schema_version":{"const":1},"revision":{"type":"integer","minimum":1},
  "actualizado":{"type":"string","format":"date-time"},"moneda":{"const":"PEN"},
  "productos":{"type":"array","maxItems":1000,"items":{"$ref":"#/$defs/producto"}}},
 "$defs":{
  "producto":{"type":"object","additionalProperties":false,
   "required":["id","slug","nombre","categoria","subcategoria","precio","precio_oferta","tallas","colores","stock","imagenes","descripcion","etiquetas","destacado","nuevo","fecha_creacion","activo"],
   "properties":{
    "id":{"type":"string","pattern":"^prd-[0-9]{4,6}$"},
    "slug":{"type":"string","maxLength":80,"pattern":"^[a-z0-9]+(-[a-z0-9]+)*$"},
    "nombre":{"type":"string","minLength":3,"maxLength":70,"pattern":"^[^<>]*$"},
    "categoria":{"enum":["hombres","mujeres","ninos","accesorios"]},
    "subcategoria":{"enum":["polos","camisas","blusas","vestidos","faldas","shorts","bermudas","pantalones","conjuntos","ropa-de-bano","pijamas","sombreros","gorras","sandalias","lentes","bolsos","otros"]},
    "precio":{"type":"number","exclusiveMinimum":0,"maximum":9999},
    "precio_oferta":{"type":["number","null"],"exclusiveMinimum":0},
    "tallas":{"type":"array","minItems":1,"uniqueItems":true,"items":{"enum":["XS","S","M","L","XL","XXL","2","4","6","8","10","12","14","16","35","36","37","38","39","40","41","42","43","44","UNICA"]}},
    "stock_por_talla":{"type":"object","additionalProperties":{"type":"integer","minimum":0}},
    "stock":{"type":"integer","minimum":0},
    "colores":{"type":"array","minItems":1,"maxItems":8,"items":{"type":"object","additionalProperties":false,"required":["nombre","hex"],
      "properties":{"nombre":{"type":"string","maxLength":24,"pattern":"^[^<>]*$"},"hex":{"type":"string","pattern":"^#[0-9A-Fa-f]{6}$"}}}},
    "material":{"type":"string","maxLength":60,"pattern":"^[^<>]*$"},
    "frescura":{"type":"integer","minimum":1,"maximum":5},
    "imagenes":{"type":"array","maxItems":6,"items":{"$ref":"#/$defs/imagen"}},
    "descripcion":{"type":"string","maxLength":600,"pattern":"^[^<>]*$"},
    "etiquetas":{"type":"array","maxItems":10,"uniqueItems":true,"items":{"type":"string","pattern":"^[a-z0-9-]{2,24}$"}},
    "destacado":{"type":"boolean"},"nuevo":{"type":"boolean"},"muestra":{"type":"boolean"},"activo":{"type":"boolean"},
    "orden":{"type":"integer"},
    "fecha_creacion":{"type":"string","format":"date-time"},"fecha_actualizacion":{"type":"string","format":"date-time"},
    "origen_registro":{"enum":["manual","telegram","admin"]}}},
  "imagen":{"type":"object","additionalProperties":false,"required":["src","alt","ancho","alto","origen"],
   "properties":{"src":{"type":"string","pattern":"^assets/img/(products|placeholders)/[a-z0-9-]+\\.(webp|avif|jpg|png|svg)$"},
    "alt":{"type":"string","minLength":5,"maxLength":140,"pattern":"^[^<>]*$"},
    "ancho":{"type":"integer","minimum":1},"alto":{"type":"integer","minimum":1},
    "origen":{"enum":["placeholder_svg","foto_propia","ia_local","unsplash"]},
    "credito":{"type":["string","null"],"maxLength":120}}}}}
```

**Reglas entre campos**, que JSON Schema no puede expresar y valida un nodo Code determinista:

- `precio_oferta < precio`.
- `id` y `slug` únicos.
- Las claves de `stock_por_talla` deben estar incluidas en `tallas`, y `stock` es igual a su suma (lo recalcula el código).
- Tallas coherentes con la categoría: `ninos` lleva 2 a 16; `accesorios` lleva UNICA o calzado.
- Si `origen=unsplash`, `credito` es obligatorio.
- `fecha_actualizacion` debe ser mayor o igual que `fecha_creacion`.
- **El archivo debe pesar menos de 1 MB**, por el límite de la API de contenidos.

### 3.3 `data/articles.json` y `data/site.json`

```json
{"$schema":"./schema/articles.schema.json","schema_version":1,"revision":1,"actualizado":"2026-10-05T20:00:00-05:00",
 "articulos":[{
  "id":"art-0001","slug":"como-vestir-fresco-en-tarapoto",
  "titulo":"Cómo vestir fresco en Tarapoto","resumen":"5 telas y colores para el calor (≤200 caracteres)",
  "portada":{"src":"assets/img/blog/como-vestir-fresco-1-9f8e7d6c.webp","alt":"Prendas de lino sobre hojas de palmera","ancho":1200,"alto":675,"origen":"ia_local","credito":null},
  "bloques":[
    {"tipo":"parrafo","texto":"..."},{"tipo":"subtitulo","texto":"..."},
    {"tipo":"lista","items":["Lino","Algodón pima"]},
    {"tipo":"imagen","src":"assets/img/blog/....webp","alt":"...","leyenda":"..."},
    {"tipo":"cita","texto":"..."},{"tipo":"productos","ids":["prd-0001","prd-0004"]}],
  "categoria":"consejos","etiquetas":["calor","lino"],"autor":"Equipo Palmera Brava",
  "estado":"publicado","destacado":false,"muestra":true,
  "fecha_publicacion":"2026-10-05T20:00:00-05:00","fecha_creacion":"...","fecha_actualizacion":"...",
  "tiempo_lectura_min":3,"origen_registro":"telegram"}]}
```

- `categoria` admite: `consejos`, `novedades`, `tendencias` y `tienda`.
- `estado` admite: `borrador`, `publicado` y `archivado`.
- `id` sigue `^art-[0-9]{4,6}$`.
- `bloques[].tipo` es un enum cerrado. **No se usa Markdown ni HTML**, para evitar XSS y no depender de librerías.
- `tiempo_lectura_min` lo calcula el código.

`data/site.json` concentra los datos de la tienda que el agente también puede editar:

- `nombre`, `eslogan` y `whatsapp` (`"51900000000"` de ejemplo).
- `telefono_visible` y `direccion{calle,distrito,ciudad,region,pais,codigo_postal}`. El código postal de Tarapoto (22201) está **[INCIERTO]**.
- `geo{lat,lng}`: aproximadamente -6.49, -76.36; **lo confirma el dueño**.
- `horarios[{dias:["Mo",…],abre,cierra}]`, `redes{}` y `envio{zonas:["Tarapoto","Morales","La Banda de Shilcayo"],costo,gratis_desde}`.
- `anuncio`, `metodos_pago[]` y `testimonios[{nombre,texto,estrellas,verificado,fuente}]`.
- `lookbook[{src,alt,puntos:[{x_pct,y_pct,producto_id}]}]`.

### 3.4 Contrato con el agente de n8n (seguridad en la edición)

- El modelo de lenguaje **nunca reescribe el archivo**. Solo devuelve una operación:

  ```json
  {"op":"crear|actualizar|desactivar|reactivar|eliminar_definitivo|stock","entidad":"producto|articulo","id":null,"campos":{...parcial...}}
  ```

- Un nodo Code determinista hace el resto, en este orden:
  1. GitHub Get obtiene el contenido y el `sha`.
  2. Aplica la operación por `id`, nunca por índice.
  3. Calcula `id` (máximo + 1), `slug`, `stock`, las fechas, `revision+1` y `actualizado`.
  4. Valida el documento completo contra el esquema y las reglas entre campos.
  5. Lo serializa con 2 espacios y un orden de claves estable, para que los diffs sean limpios.
  6. Hace el PUT con el `sha`. Si recibe un 409, vuelve a leer y reintenta hasta 3 veces.
  7. Las escrituras son en serie: una sola ejecución a la vez y nunca en paralelo.
- "Eliminar" equivale a **`activo:false`** (borrado suave). Para `eliminar_definitivo` y para cambios de precio grandes, el bot de Telegram pide confirmación con botones Confirmar/Cancelar, porque la diapositiva 16 exige revisión humana en decisiones de alto impacto.
- Solo se aceptan mensajes de los `chat_id` autorizados del dueño.
- **Agrupar cambios** para respetar el límite de 10 builds por hora: una cola con un "publicar" explícito, o un debounce de unos 2 minutos.
- Mensaje de commit: `data(products): actualizar prd-0007 precio 69.90 [telegram]`.
- Las imágenes tienen un **nombre inmutable con hash**: `<slug>-<n>-<hash8>.webp`. Si una imagen cambia, cambia su nombre, así que la caché nunca muestra una imagen vieja.
- Automatización extra: un cron de n8n diario pone `nuevo:false` a los productos con más de 30 días.
- Opcional (fase 2): pasar Pages a publicar con GitHub Actions, con los pasos validar y luego desplegar. Así los datos inválidos no se publican y desaparece el límite de 10 builds por hora. La fase 1 se queda con "Deploy from branch main / (root)", como en el curso.

### 3.5 Cómo carga los datos el frontend (`assets/js/data.js`)

```js
async function loadData(name, seedId){            // name: 'products.json'
  const url = new URL('data/' + name, document.baseURI);   // ruta relativa (sitio de proyecto)
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { cache: 'no-cache', signal: ctrl.signal }); // revalida con ETag → 304
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const doc = sanitize(await res.json());          // valida forma mínima; descarta ítems inválidos (console.warn)
    try { localStorage.setItem('pb:data:' + name, JSON.stringify(doc)); } catch {}
    return { doc, source: 'network' };
  } catch (e) {
    try { const c = JSON.parse(localStorage.getItem('pb:data:' + name)); if (c) return { doc: c, source: 'cache' }; } catch {}
    const seed = document.getElementById(seedId);    // <script type="application/json" id="seed-products">
    if (seed) return { doc: sanitize(JSON.parse(seed.textContent)), source: 'seed' };
    return { doc: null, source: 'none' };            // estado vacío + CTA WhatsApp
  } finally { clearTimeout(t); }
}
```

- **Caché:** usar `cache:'no-cache'` y **no** `?v=Date.now()`, porque el CDN ignora el query string (punto 0.1). La demora real tras un commit es el build de Pages, de 1 a 2 minutos según la diapositiva 22.
  - [INCIERTO] Que Pages purgue el CDN en cada despliegue: es el comportamiento habitual que se observa, pero no está documentado.
- **Respaldos:** si la fuente es `cache` o `seed`, aparece un aviso discreto: "Mostrando catálogo guardado/de muestra".
- **Revalidación:** al volver a la pestaña (`visibilitychange`) después de más de 10 minutos, se recargan los datos y se repinta solo si cambió `revision`.
- **Filtrado en el frontend:** `activo===true`, y `estado==='publicado'` en los artículos. Si `muestra:true`, aparece un sticker "Muestra".

---

## 4. Estructura, rendimiento, SEO, accesibilidad y responsive

### Estructura de carpetas

Repo sugerido: `palmera-brava` → `https://abnercayao.github.io/palmera-brava/`.

```
palmera-brava/
├─ index.html  articulo.html  admin.html  404.html
├─ .nojekyll   robots.txt  sitemap.xml  site.webmanifest  README.md
├─ assets/
│  ├─ css/  tokens.css  base.css  components.css  sections.css  admin.css
│  ├─ js/   config.js utils.js data.js state.js catalog.js filters.js quickview.js
│  │        bag.js whatsapp.js articles.js motion.js theme.js main.js admin.js
│  └─ img/  brand/(logo.svg, favicon.svg, og-cover.jpg 1200x630)  products/  blog/
│           lookbook/  placeholders/(*.svg)  icons/sprite.svg
├─ data/    products.json  articles.json  site.json
│  └─ schema/ products.schema.json  articles.schema.json  site.schema.json
└─ tools/   make-placeholders.mjs (genera SVG)  serve.bat (python -m http.server 8080)
```

- **JS clásico con `defer`** y un namespace `window.PB`, sin módulos ES, para que funcione en `file://`. No hay frameworks ni dependencias obligatorias, como pide la diapositiva 19.
- Cada sección lleva un comentario que la identifica.
- `.nojekyll` evita que Jekyll procese el sitio.
- **Rutas siempre relativas** (`assets/...`, nunca `/assets/...`), porque es un sitio de proyecto bajo `/<repo>/`.

### Rendimiento

- **Presupuesto de peso:** JS total minificado ≤ 60 KB, CSS ≤ 40 KB. Imágenes WebP (AVIF opcional): tarjeta de 600×750 ≤ 60 KB, detalle de 1200×1500 ≤ 180 KB, hero ≤ 150 KB.
- **Carga de imágenes:** `srcset` con 600w y 1200w, más `width`/`height` para evitar saltos de diseño (CLS). En todo lo que esté bajo el primer pantallazo, `loading="lazy"` y `decoding="async"`. El hero va con `fetchpriority="high"` y sin lazy.
- **Contenido diferido:** `content-visibility:auto` en las secciones de abajo. El mapa usa una fachada y se carga con un clic.
- **Sin service worker en la v1**, para evitar datos rancios.
- **Metas:** LCP < 2.5 s en 4G y Lighthouse ≥ 90 en rendimiento y ≥ 95 en accesibilidad, SEO y buenas prácticas.

### SEO local

- `<html lang="es-PE">`.
- `title`: "Palmera Brava | Ropa de verano en Tarapoto para hombres, mujeres y niños".
- `meta description` de 155 caracteres o menos y `canonical` absoluto.
- Open Graph: `og:locale es_PE` y `og:image` **absoluta** de 1200×630. Twitter: `summary_large_image`.
- `robots.txt` con `Disallow: /admin.html` y `sitemap.xml`.
- **JSON-LD `ClothingStore`** (Thing → LocalBusiness → Store → ClothingStore, verificado en schema.org) con:
  - `name`, `image`, `url`, `telephone` y `address` (PostalAddress: Tarapoto, San Martín, PE).
  - `geo`, `openingHoursSpecification`, `priceRange` ("S/ 30 – S/ 150"), `currenciesAccepted` ("PEN") y `paymentAccepted`.
  - `areaServed` (Tarapoto, Morales, La Banda de Shilcayo), `hasMap` y `sameAs`.
- El JSON-LD de Product/ItemList, inyectado por JS, es opcional.
- Fuera del sitio, lo que más pesa para el SEO local es el **Google Business Profile**.

### Accesibilidad (WCAG 2.2 AA)

- Contrastes verificados (ver sección 1).
- Enlace "Saltar al contenido" y landmarks.
- `:focus-visible` con un contorno de 2 px en `--focus`.
- `<dialog>.showModal()`, que atrapa el foco y cierra con Esc.
- Filtros como `fieldset/legend` con checkboxes y radios. El precio se elige con selects o inputs de número, no con un slider doble.
- `aria-live` para el contador de resultados y los toasts.
- Muestras de color con su nombre en texto.
- Áreas táctiles de 44 px o más.
- Carruseles con botones y pausa.
- `alt` obligatorio en el esquema (mínimo 5 caracteres).
- Respeto de `prefers-reduced-motion`.

### Responsive

- Mobile-first, con cortes en 480, 768, 1024 y 1280 px y contenedor máximo de 1280 px.
- Tipografía fluida con `clamp()`.
- Grilla: 2 columnas desde 360 px, 3 desde 768 px y 4 desde 1024 px.
- Filtros en un cajón lateral en móvil y en una barra lateral en escritorio.

### Seguridad

- CSP en meta: `default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-src https://www.openstreetmap.org https://www.google.com`.
  - El script en línea del tema necesita un hash `sha256-…` en `script-src`.
- Nunca se usa `innerHTML` con datos.
- No hay tokens en el frontend: el token de GitHub vive solo en las credenciales de n8n.

---

## 5. Imágenes provisionales y licencias

1. **v1: SVG generados** por `tools/make-placeholders.mjs`.
   - Siluetas de prendas (polo, vestido, short, sombrero) sobre un degradado tropical teñido con el `hex` del producto, con la leyenda "Imagen de muestra".
   - Pesan menos de 3 KB y no tienen ningún riesgo de licencia. `origen:"placeholder_svg"`.
2. **Hero, lookbook y blog: IA local** con Open Generative AI (sd.cpp con Z-Image-Turbo, que es Apache-2.0 y ya está descargado). `origen:"ia_local"`.
   - Etiquetarlas como "Imagen referencial generada con IA".
   - **No usar imágenes de IA como si fueran fotos de prendas reales que se venden**, porque engañaría al cliente.
3. **Unsplash**, solo para ambientación (paisajes, palmeras, cataratas).
   - La licencia permite el uso comercial sin atribución obligatoria. Prohíbe vender las imágenes sin modificarlas y recopilarlas para replicar un servicio similar.
   - Igual se pone el crédito en `credito`. Se evitan fotos con personas o marcas reconocibles en piezas comerciales, porque la licencia no cubre los derechos de imagen y marca; esto está **[INCIERTO]** y conviene revisarlo caso por caso.
4. **Fotos reales que llegan por Telegram:** reemplazan a las provisionales. `origen:"foto_propia"` y `muestra:false`.
   - Conversión a WebP: el nodo Edit Image de n8n usa GraphicsMagick, que viene en la imagen base. **[INCIERTO]** Que esa compilación exporte WebP.
   - Alternativa: hacer la conversión en `admin.html` con `canvas.toBlob('image/webp')` (Chromium) o publicar JPEG optimizado de 1200 px.

---

## 6. Panel admin local y botón "Crear imagen con IA"

**Regla de oro:** el sitio público en HTTPS **no tiene el botón y nunca hace fetch a localhost**. Así se evitan el aviso de Local Network Access de Chrome 142+ y el bloqueo de mixed content de Safari.

### Dónde vive y cómo se protege

- `admin.html` está en el repo, pero se usa en `http://localhost:8080/admin.html` (`tools/serve.bat` lanza `python -m http.server 8080`, y Python 3.11 ya está instalado).
- Guardia: `const LOCAL=['localhost','127.0.0.1','[::1]'].includes(location.hostname)`. Si no se cumple, solo muestra "Este panel funciona únicamente en la PC de la tienda" y no hace nada más.
- Lleva `<meta name="robots" content="noindex,nofollow">`, no aparece en ningún menú y no contiene secretos.
- El token del webhook (credencial Header Auth de n8n) se escribe al usar el panel y se guarda en `sessionStorage`.
- Alternativa B: servir el panel desde el propio n8n con un webhook más "Respond to Webhook" que devuelve HTML. Así comparte origen con los webhooks y no necesita CORS.

### Funciones

- **a) Estado de servicios:**
  - n8n: `fetch('http://localhost:5678/healthz',{mode:'no-cors'})`. Si resuelve, n8n está vivo.
  - sd-server: `GET http://127.0.0.1:1234/v1/models`.
  - Wan2GP: `:7860`, con `no-cors`.
- **b) Formulario de productos y artículos:** genera **la misma operación JSON** que el agente de Telegram y la envía con `POST http://localhost:5678/webhook/tienda-admin`. El webhook tiene "Allowed Origins" = `http://localhost:8080`. Pasa por el mismo pipeline determinista.
- **c) "Crear imagen con IA", en 3 modos:**
  1. **Abrir Open Generative AI (escritorio):** el navegador no puede lanzarla (punto 0.5). El botón copia el prompt al portapapeles (`navigator.clipboard`, que funciona porque localhost es contexto seguro) y muestra "Abre la app desde el menú Inicio y pega el prompt". Opcional: un acceso directo `.lnk` creado por el usuario.
  2. **Generar aquí (100 % local, automatizable):**
     - `POST http://127.0.0.1:1234/v1/images/generations` a `sd-server.exe`, que Abner arranca con un `.bat` pasando `--diffusion-model …z_image_turbo-Q4_K.gguf --llm …Qwen3-4B…gguf --vae …ae.safetensors --cfg-scale 1.0`, usando las rutas de `C:\Users\abner\AppData\Roaming\open-generative-ai\local-ai\`.
     - **[INCIERTO]** Que esa combinación de argumentos funcione con el binario instalado. Hay que probar `sd-server.exe --help` antes.
     - Después: vista previa del base64, recorte a 4:5 de 1200×1500, WebP con canvas, y el botón "Usar en producto" envía la imagen al webhook de n8n para hacer el commit en `assets/img/products/`.
  3. **Abrir Wan2GP:** enlace con `target="_blank"` a `http://127.0.0.1:7860`, si Abner lo levanta.
  - **Constructor de prompts:** "Foto de producto de moda, {prenda} de {material} color {color}, fondo {arena | hojas de palma | cascada}, luz natural, estilo catálogo, sin texto ni logos". El resultado se guarda con `origen:"ia_local"`.
- **Conectividad desde Docker:** n8n corre en Docker. Si algún flujo debe llamar a sd-server desde n8n (y no desde el navegador), tendrá que usar `host.docker.internal` y sd-server tendrá que escuchar más allá de 127.0.0.1. **[INCIERTO]** Hay que probarlo y cuidar el firewall. Por eso se prefiere que sea el navegador el que llame a sd-server y luego envíe la imagen a n8n.

---

## 7. Riesgos e incertidumbres

1. Las condiciones de GitHub Pages sobre comercio. Es una interpretación mía; ver punto 0.3.
2. Que el CDN de Pages se purgue al desplegar. No está documentado.
3. La versión, el puerto y los argumentos del `sd-server` instalado (v1.0.9). Abner podría actualizar a la 2.0.0; esa decisión es suya.
4. Si GraphicsMagick en n8n exporta WebP.
5. Las obligaciones legales en Perú (Libro de Reclamaciones virtual, Ley 29733), el código postal y las coordenadas exactas.
6. Los nombres de marca (INDECOPI).
7. Los medios de pago y la política de cambios: son datos de ejemplo.
8. "Antigravity": existe el repo `sickn33/antigravity-awesome-skills`, que incluye una skill `frontend-design` para interfaces con identidad propia. Puede guiar al equipo, pero no es imprescindible.

---

## 8. Plan para el equipo de agentes (paquetes y criterios de aceptación)

1. **Diseño y tokens:** `tokens.css`, `base.css` y la tipografía. Criterio: el contraste es el de la tabla y los temas claro, oscuro y sistema funcionan sin parpadeo.
2. **Datos:** los 3 JSON de muestra (unos 16 productos: 4 por categoría y `muestra:true`; 3 artículos), los esquemas y la semilla en línea. Criterio: los JSON validan contra el esquema y el archivo pesa menos de 1 MB.
3. **Catálogo:** `catalog.js`, `filters.js`, `state.js` y `quickview.js`. Criterio: los filtros cambian el contador correctamente, la URL refleja los filtros y `#p/slug` abre el diálogo.
4. **Pedido:** `bag.js` y `whatsapp.js`. Criterio: el mensaje lleva bien codificado los productos, las tallas y el total en "S/".
5. **Secciones y movimiento:** hero, marquee, lookbook, blog y `articulo.html`. Criterio: con reduced-motion todo queda estático.
6. **SEO y accesibilidad:** metas, JSON-LD, sitemap y robots. Criterio: Lighthouse ≥ 90/95 y el Rich Results Test sin errores.
7. **Admin local:** `admin.html` y `admin.js`, con la guardia de hostname y los 3 modos de IA.
8. **QA según las diapositivas 16 a 22:**
   - Prueba local: con `file://` usando la semilla y con `http.server` usando los JSON.
   - Rutas relativas y responsive desde 360 px.
   - Ventana privada, móvil y HTTPS en `abnercayao.github.io/<repo>/`.
   - Checklist de la diapositiva 16: totales iguales al dataset, filtros correctos, unidades S/ consistentes y datos sensibles fuera del frontend.

---

**Rutas locales relevantes**

- Diapositivas del curso: `C:\Users\abner\AppData\Local\Temp\claude\C--Users-abner-OneDrive-Desktop-Vanguard-Paginas-Ropa\c7eb6ec5-bd15-490f-bf3c-1129ebf910bd\scratchpad\p16.png` a `p23.png`
- Open Generative AI: `C:\Program Files\Open Generative AI\`
- Motor y modelos locales: `C:\Users\abner\AppData\Roaming\open-generative-ai\local-ai\` (incluye `bin\sd-server.exe` y `models\`)
- Script de contraste: `...\scratchpad\contrast.py`

**Fuentes**
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://docs.github.com/en/rest/repos/contents
- https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.github/
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
- https://github.com/Anil-matcha/Open-Generative-AI (README, `electron/main.js`, `docker-compose.yml`, releases)
- https://github.com/leejet/stable-diffusion.cpp/tree/master/examples/server
- https://huggingface.co/Tongyi-MAI/Z-Image-Turbo
- https://schema.org/ClothingStore
- https://unsplash.com/license
- https://u2l.ai/blog/whatsapp-click-to-chat-link y https://bird.com/explained/whatsapp/what-is-a-whatsapp-click-to-chat-link
- https://blog.openreplay.com/chrome-local-network-access-lna-permission/ y https://support.vertigis.com/hc/en-us/articles/32555952561682-Local-Network-Access-permissions-in-Chrome-and-Edge
- https://bugs.webkit.org/show_bug.cgi?id=171934 (Safari y mixed content hacia localhost)
- https://www.buildmvpfast.com/blog/css-scroll-driven-animations-replace-js-2026
- https://web.dev/blog/web-platform-10-2025 (View Transitions en Firefox 144)
- https://andina.pe/agencia/noticia-feliz-240-aniversario-tarapoto-ciudad-las-palmeras-te-espera-sus-atractivos-904005.aspx
- https://www.infobae.com/peru/2026/04/30/amazonia-peruana-el-pronostico-del-clima-de-tarapoto-de-manana/
- https://vibeindex.ai/skills/sickn33/antigravity-awesome-skills/frontend-design
- Verificación propia: cabeceras de `pages.github.com/versions.json` (2026-10-05), API CSS de Google Fonts (HTTP 200), `localhost:5678/healthz`, `Intl` es-PE en Node.