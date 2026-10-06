# Plan maestro (versión final): tienda de ropa de verano en Tarapoto

La web va en GitHub Pages. Un agente n8n local se maneja desde Telegram y las imágenes se generan con IA local. Este documento es para que lo apruebes antes de escribir código.

**Fecha:** 2026-10-05.

**Estado:** hasta ahora todo fue de solo lectura. No se instaló nada, no se creó ningún repo y no se tocó Docker.

**Convenciones:**
- **[INCIERTO]** = sin verificar; se prueba en la fase indicada.
- **[VERIFICADO HOY]** = lo comprobé en esta última pasada, también de solo lectura.

---

## Cambios respecto al borrador

1. **Publicar ya no puede perder cambios.**
   - Se lee el `ref` y, del mismo commit, se leen los JSON.
   - Ante un 422 se reinicia la cadena completa.
   - Hay idempotencia por `draft_id` y el autor del commit es explícito.
2. **Ningún mensaje se pierde ni se procesa dos veces.**
   - Cada mensaje entra a una cola `inbox` antes de confirmarlo a Telegram (ACK).
   - Un solo *worker* con *lock* procesa la cola en serie, incluida la GPU.
3. **El LLM se llama por HTTP con esquema JSON (`format`)**, sin agente ni memoria, porque es más fiable con un modelo de 4B.
4. **Toda escritura pasa por un borrador con el botón Publicar**: `/precio`, `/stock`, `/ocultar`, el formulario y el cambio de WhatsApp.
   - Se elimina el cron nocturno de commits: "nuevo" se calcula en la web.
5. **Hay forma de deshacer:** `/historial`, `/deshacer`, `/pausa`, un *ruleset* que bloquea force-push y borrado de `main`, y límites de daño en el validador.
6. **Telegram y los tokens están blindados.**
   - Una lista de IDs autorizados.
   - Los callbacks se verifican.
   - El token sale del JSON de los workflows y los avisos de error se censuran.
   - Se aceptan solo fotos comprimidas, sin GPS.
7. **"Todo local", con lo que sale a internet declarado.**
   - Se apagan la telemetría de n8n, la nube de Ollama y Google Fonts.
   - Recrear el contenedor de n8n pasa a **recomendado**, sin descargar la imagen.
8. **CUDA sin descargas:** se usan las DLL que ya están en el venv de Wan2GP. Los parámetros de sd-server se mandan explícitos en cada petición.
9. **Ajuste a las diapositivas:**
   - `index.html` autocontenido y comentado (diapositiva 19), con las secciones "Cómo comprar" y "Evidencia".
   - Matriz de calidad de 9 filas (diapositiva 16).
   - `https_enforced` (diapositiva 22).
   - "Set / Format Data" y conservar el origen (diapositiva 23).
   - La versión v0 se publica antes de montar la IA (diapositiva 17).
10. **Los pedidos explícitos ya no se descartan:** descargar la app (Open Generative AI v2.0.0) y usar skills pasan a ser preguntas con opciones claras.
11. **Correcciones menores:**
    - Se quita `robots.txt`, que no sirve en un sitio de proyecto.
    - `404.html` lleva rutas absolutas.
    - El panel tiene su propia CSP.
    - CORS con dos orígenes.
    - WebP está verificado.
    - R4 y R11 corregidos; R14 resuelto.

---

## 0. Lo que ya existe en tu PC (resumen; el detalle está en la sección 8)

| Recurso | Estado |
|---|---|
| n8n | Contenedor `n8n`, **v2.40.7**. Puerto `5678` en todas las interfaces, `unless-stopped`, datos en `C:\Users\abner\n8n\data`. Sin `WEBHOOK_URL`, sin variables de telemetría y **sin límite de concurrencia** (−1). `host.docker.internal` **sí llega** a servicios en 127.0.0.1. |
| Open Generative AI | **v1.0.9 instalada.** Trae `sd-server.exe` (stable-diffusion.cpp) con API HTTP y CORS, y tiene los modelos Z-Image Turbo Q4, Qwen3-4B y `ae` ya descargados. **La app no tiene API ni protocolo de enlace.** |
| GPU | RTX 5060 Ti **8151 MiB**. En reposo hay **1357 MiB usados** [VERIFICADO HOY]. Hoy sd-server probablemente usa **Vulkan**, porque `ggml-cuda.dll` no encuentra sus DLL. Esas DLL **sí existen** en `C:\AI\Wan2GP\venv\…\torch\lib`. |
| Wan2GP | En `C:\AI\Wan2GP`, ≈55 GB, solo modelos de video. No está corriendo. |
| GitHub | `gh` con la sesión **Abnercayao** (`repo`, `workflow`). Ningún repo tiene Pages. `tienda-tarapoto` está libre [VERIFICADO HOY]. |
| Arranque | Docker Desktop arranca **al iniciar sesión**, no al encender. La suspensión con corriente está en "nunca". |
| No instalado | Ollama, ngrok, ComfyUI. `cloudflared` está instalado sin configurar. |

---

## 1. La solución y su arquitectura

**En una frase:**
- Una web estática: un `index.html` autocontenido, más `data/*.json` y `assets/`. Sin pagos; los pedidos van por WhatsApp.
- El dueño escribe o manda fotos al bot de Telegram.
- n8n, en tu PC, recoge los mensajes cada 10 s sin exponer nada y los guarda en una cola.
- Un único *worker* usa la IA local para armar un **borrador validado**, que el dueño aprueba con un botón.
- Lo aprobado se publica en **un commit agrupado** (máximo ≈10 por hora) y Pages lo muestra en 1–10 min.
- Las imágenes con IA salen del **motor de Open Generative AI** (`sd-server` + Z-Image Turbo), desde un botón que solo existe en tu PC o con `/imagen`.

```
 NUBE (inevitable)                           TU PC (Windows 11): todo lo demás
 ─────────────────                           ──────────────────────────────────────────────────────────────
 Dueño / Abner (Telegram)                    Docker: n8n 2.40.7  →  127.0.0.1:5678 (tras P6)
   │ texto · foto · álbum · botones            WF1 Ingesta (10 s) ─► Data Table inbox ─► WF2 Worker (15 s, lock)
   ▼                                             ├─ WF3 Borrador-IA ───► Ollama :11434  (qwen3.5:4b)
 api.telegram.org ◄── getUpdates + ACK ──────────┤  ├─ WF4 Comandos
   ▲ vista previa · "Publicado"                  ├─ WF5 Publicar (lotes, ≥6 min entre commits)
   └─────────────────────────────────────────────┤  └─ WF6 Imagen-IA ──► sd-server :1234 (Z-Image Turbo,
                                                 │                        modelos de Open Generative AI)
 api.github.com ◄── Git Data API (PAT) ──────────┘  WF7 Form · WF8 Panel-API · WF9 Errores · WF10 Salud
   │ 1 commit por lote (imágenes + JSON)
   ▼                                          Navegador local: http://127.0.0.1:8080/tienda-tarapoto/
 GitHub Pages (main / root)                     index.html (botón IA solo en localhost) · admin.html
 https://abnercayao.github.io/tienda-tarapoto/
   │
   ▼
 Clientes ─► "Pedir por WhatsApp" ─► wa.me/51XXXXXXXXX
```

**Dependencias de nube** (se declaran porque no se pueden evitar):
- `api.telegram.org`, `api.github.com` y GitHub Pages.
- Docker Hub solo si se recrea n8n con otra versión; P6 evita esa descarga.

**El mismo flujo que la diapositiva 23:**

| Diapositiva 23 | Aquí |
|---|---|
| Trigger (manual, formulario, carpeta, correo) | Schedule 10 s + `getUpdates`. En v1.1, además, Form Trigger. |
| Capturar: "conserva nombre del archivo, fecha y origen" | `inbox` y `borradores` guardan `update_id`, `file_id`, `file_unique_id`, fecha y `chat_id`. |
| File / Extract | Telegram Get File + Edit Image (1200 px, WebP) |
| Clean / Code | Code "Normalizar": texto, coma decimal, álbum |
| LLM | HTTP a Ollama `/api/chat` con esquema. Alternativa: Information Extractor. |
| IF / Validation | Code "Validar" (`validar.js`) + IF: completo, incompleto o error |
| Set / Format Data | Code "Formatear vista previa": diff antes → después |
| Sheets / DB / Email | Data Table `borradores`, luego commit a GitHub y aviso por Telegram |

---

## 2. Decisiones técnicas recomendadas

| # | Tema | Recomendación | Por qué | Alternativa |
|---|---|---|---|---|
| D1 | Recibir Telegram | **Polling.** WF1 (Schedule 10 s) → `getUpdates?timeout=0&limit=20&allowed_updates=["message","callback_query"]` → **upsert en `inbox` por `update_id`** → recién entonces el ACK (`offset=máx+1`). | Telegram exige HTTPS público; no hay `WEBHOOK_URL` y `--tunnel` no existe en 2.x. Guardar antes del ACK evita perder mensajes, y el upsert absorbe duplicados y la posible ráfaga al arrancar. `allowed_updates` se fija siempre, porque Telegram recuerda el último valor. | Webhook con ngrok (dominio estático) o un Cloudflare named tunnel. Obliga a recrear con `WEBHOOK_URL`. |
| D2 | Confirmación y autenticación | Sin Telegram Trigger ni Send-and-Wait, porque registran un webhook (`hitl/setup.ts`). Se usa un inline keyboard `pub:<id>` / `no:<id>`. **Filtro:** `from.id` ∈ `AUTORIZADOS` (lista con rol) y `chat.type=='private'`. **Callback:** se verifican `borrador.owner_id == from.id`, el `message_id` y el estado. Tras el primer toque se quitan los botones (`editMessageReplyMarkup`). `setMyCommands` con *scope* de chat. | El bot es público. `callback_data` lo genera el cliente y no prueba nada. | — |
| D3 | LLM | **Ollama + `qwen3.5:4b-q4_K_M`** (3.3 GB, texto e imagen, modelo "thinking"). Configuración: `OLLAMA_NO_CLOUD=1`, `think:false`, `num_ctx 8192`, `keep_alive` de 2 min. Antes de generar imágenes se descarga de la VRAM con `keep_alive:0`. | Entra en los ≈6.8 GB libres, lee fotos y es 100 % local. | (b) El Qwen3-4B GGUF que ya tienes, importado en Ollama (solo texto). (c) Nube. |
| D4 | Uso del LLM | **HTTP directo a `/api/chat`** con `format: <JSON Schema>` e `images:[base64]`. **Sin memoria:** el borrador parcial vive en la Data Table y el extracto del catálogo va en el prompt. Salida: `{op, entidad, id, campos, campos_inferidos}`, con `op` ∈ `crear`, `actualizar`, `desactivar`, `reactivar`, `stock`, `agregar_imagen` (**sin `eliminar_definitivo`**). Un Code determinista valida y aplica. | Agente + herramientas + Structured Output Parser falla a menudo con un 4B. `format` restringe la salida. El LLM nunca escribe en GitHub (diapositiva 16). | Nodo **Information Extractor** (más "visible" como diapositiva 23). Que admita imágenes no está documentado **[INCIERTO]**. |
| D5 | Escritura en GitHub | **Git Data API con concurrencia optimista** (orden en la tabla siguiente). Si responde **422, se reinicia desde `GET ref`** (máximo 3, con espera aleatoria de 2–5 s). **Lotes:** todo lo aprobado va en un commit, con **al menos 6 min entre commits**. | Elimina el "lost update". La idempotencia evita la doble publicación. 6 min equivalen a ≤10 builds por hora. | Nodo GitHub "Edit file" (2 commits por producto). GitHub Actions si se necesita más. |
| D6 | Hosting | Sitio de **proyecto**, repo **público**, `main` / `(root)`, `.nojekyll`, `https_enforced=true` y un **ruleset en `main`** (sin force-push ni borrado; disponible en Free para repos públicos). | Diapositivas 21–22. Protege el historial ante un PAT filtrado o un bug. | Cloudflare Pages o Netlify (R1). Despliegue con Actions y validación (F8). |
| D7 | Nombre del repo | `tienda-tarapoto` → `https://abnercayao.github.io/tienda-tarapoto/` | Neutro; libre [VERIFICADO HOY]. | El slug de la marca, verificando que esté libre. |
| D8 | Ubicación local | `C:\Users\abner\dev\tienda-tarapoto` (fuera de OneDrive y de Google Drive) | OneDrive corrompe `.git`. El PDF de 44.9 MB no debe entrar. Ya trabajas así con `recepcion-ia`. | Una subcarpeta de `Paginas Ropa\` (nunca `git init` en la raíz). |
| D9 | Datos y validador | `data/{products,articles,site}.json`, `data/schema/*` (JSON Schema 2020-12, `additionalProperties:false`, textos sin `<>`) y **`tools/validar.js`**, el mismo código en n8n y en local. Reglas en la lista siguiente. | Una sola fuente de verdad (diapositiva 16, "mismos KPIs"). | — |
| D10 | Frontend | **`index.html` autocontenido**: HTML, CSS y JS en un archivo, un comentario por sección y los textos de la landing escritos en el HTML (diapositiva 19). Detalle en la lista siguiente. | Cumple las diapositivas 19 y 20 sin una segunda fuente de verdad en producción. | 1 CSS + 2–3 JS externos (pregunta 11). |
| D11 | Imágenes | **v1:** siluetas SVG generadas con la etiqueta "Muestra". **Fotos reales:** solo `message.photo`. Un `document` se rechaza ("reenvíala como foto", por el GPS). Edit Image → 1200 px **WebP q80** (GraphicsMagick del contenedor tiene WEBP de lectura y escritura). **IA:** WebP directo de sd-server, solo para hero, lookbook y blog, con "Imagen referencial generada con IA". **Nunca en productos** (lo impide el esquema). Sin personas en los prompts de `ninos`. | Privacidad, honestidad con el cliente y caché correcta (nombre con hash). | JPEG q80. |
| D12 | Botón "Crear imagen con IA" | Ver la lista siguiente. | La app no tiene API, pero **su motor y sus modelos sí**. Es "el botón de Open Generative AI" usando su motor, no su ventana (pregunta 14). | Form Trigger de n8n (mismo origen, sin CORS). |
| D13 | Pedidos | La bolsa arma **un solo mensaje** `wa.me`. Sin número real, los botones se ocultan; **nunca** se publica el número de ejemplo. Con `muestra:true`, "Pedir" queda desactivado. Mientras quede alguna muestra, se muestra el banner "Catálogo de muestra, precios referenciales". | Política de Pages. Evita pedidos de productos ficticios. | — |
| D14 | Secretos | Ver la lista siguiente. | El repo es público. | — |
| D15 | Ejecución en serie | Ver la lista siguiente. | `N8N_CONCURRENCY_PRODUCTION_LIMIT` no está definido: por defecto vale −1, sin límite [VERIFICADO HOY]. | `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` al recrear (P6): garantía dura, pero también pone en cola al poller y al panel. |
| D16 | "Todo local" | Ver la lista siguiente. | Requisito "todo local". n8n hoy queda visible en la LAN. | No recrear (quedan R10 y R28). |
| D17 | Deshacer | `/historial`: últimos 5 commits del bot. `/deshacer`, con confirmación: un commit **nuevo** que restaura `data/*` del commit padre, y solo si HEAD es del bot. `/pausa` y `/reanudar` bloquean las escrituras. Más el ruleset de D6. | No existía rollback. | Actions con validación previa (F8). |
| D18 | GPU para imágenes | Ver la lista siguiente. | Velocidad, sin descargas. | Vulkan (más lento). Copiar las 3 DLL a una carpeta propia si Wan2GP se borra. |

**D5. Orden de la cadena de publicación:**
1. `GET ref` y luego `GET commit` (para el tree).
2. `GET contents/data/*.json?ref=<sha>`.
3. Aplicar los borradores `aprobado`, **saltando los `draft_id` que ya estén en `borradores_aplicados`** (los últimos 100, dentro del JSON).
4. Validar.
5. `POST blobs`: imágenes primero; el **nombre usa los 8 primeros caracteres del `sha` del blob**.
6. `POST tree` con `base_tree`.
7. `POST commit` con `parents:[sha]` y **`author` = "Tienda Bot" con el correo noreply**.
8. `PATCH ref` con `force:false`.

**D9. Reglas del validador:**
- **Entre campos:** `precio_oferta < precio`; `id` y `slug` únicos; `stock` = suma de `stock_por_talla`; tallas coherentes con la categoría; cada JSON de menos de 1 MB.
- **Límites de daño:** el diff solo toca los `id` del lote; aborta si los productos bajan en más de 1 (salvo `/limpiar_muestras`).
- **Integridad referencial:** artículos y lookbook solo citan productos existentes.
- **Sin secretos:** rechaza `bot\d+:`, `github_pat_` y `ghp_`.
- **WhatsApp:** cumple `^51\d{9}$`.
- **Enlaces:** redes y mapas solo `https://` de dominios permitidos.
- **Imágenes:** los productos no admiten `origen: ia_local`; patrón de ruta por entidad (`products|placeholders` y `blog|lookbook|brand|placeholders`).
- **Esquema:** se quita `nuevo`.

**D10. Detalle del frontend:**
- Solo el catálogo, el blog (`#blog/<slug>` en la misma página) y los datos de contacto salen de JSON.
- Todo se pinta con `textContent`.
- **Carga de datos:** red (`cache:'no-cache'`) → última copia buena en `localStorage` → "Catálogo no disponible, escríbenos por WhatsApp".
- **La semilla en línea solo se usa si `location.protocol==='file:'`.**
- "Nuevo" = `fecha_creacion` de menos de 30 días.
- Fuentes OFL en `assets/fonts/`.

**D12. Cómo funciona el botón:**
- **Dónde está:** solo en tu PC. En `admin.html` y como botón flotante en `index.html`, que **solo aparece si `location.hostname` es `localhost` o `127.0.0.1`**. El sitio público nunca llama a localhost.
- **Flujo:**
  1. `POST http://127.0.0.1:5678/webhook/crear-imagen` (Header Auth).
  2. WF8 toma el **mismo lock de GPU**.
  3. Llama a sd-server con los parámetros explícitos.
  4. Devuelve la imagen al panel y la envía a Telegram con los botones "Portada de artículo / Hero / Lookbook / Descartar".
- Lo mismo funciona con `/imagen <prompt>`.
- **Respaldos:** "Copiar prompt", "Abrir Open Generative AI" (protocolo propio opcional, P13) y "Abrir UI de sd-server".

**D14. Dónde va cada secreto:**
- **PAT:** credencial `githubApi`. Fine-grained, solo este repo, Contents de lectura y escritura, 90 días.
- **Token de Telegram:**
  - Va en la credencial `telegramApi` y en la Data Table `config`, **no en el JSON de los workflows**.
  - Hace falta en `config` porque `getUpdates` exige el token en la URL y la credencial no puede inyectarlo.
- **WF1 no guarda ejecuciones**, ni exitosas ni fallidas.
- `tools/limpiar-workflows.js` quita `pinData`, los IDs de credenciales y `meta.instanceId` antes de cada commit.
- **Barreras del repo:**
  - Un hook `pre-commit` que corre el mismo `git grep` de F3.
  - El validador de D9.
  - **Push protection de GitHub cubre los PAT, pero no el token de Telegram**: con ese token solo genera una alerta cuando ya es público.

**D15. Cómo se garantiza la ejecución en serie:**
- **Un solo worker (WF2)** procesa la cola de a un elemento, y es lo único que usa la GPU y escribe en GitHub.
- **Lease** en la Data Table `locks`: `update … where hasta < ahora` y luego se relee el `holder`.
- Verifiqué en el código de 2.40.7 que `updateRows` es **un único `UPDATE … WHERE` dentro de una transacción** [VERIFICADO HOY].
- El estado cambia de forma atómica: `pendiente → aprobado → publicando`.
- Cada elemento se reintenta hasta 3 veces.
- **Poller:**
  - Las llamadas HTTP llevan `continueOnFail` y hay un contador de fallos.
  - Solo avisa tras 30 fallos seguidos (≈5 min), y como mucho una vez por hora.

**D16. Lo que se apaga y cómo se recrea n8n:**
- **Telemetría de n8n:**
  - `N8N_DIAGNOSTICS_ENABLED=false`
  - `N8N_VERSION_NOTIFICATIONS_ENABLED=false`
  - `N8N_TEMPLATES_ENABLED=false`
- **Nube de Ollama:** `OLLAMA_NO_CLOUD=1`.
- **Google Fonts:** se reemplazan por fuentes locales.
- **Recrear n8n (P6, recomendado)** en una sola operación:
  - Versión fija `2.40.7` **re-etiquetando la imagen local**, sin descargar.
  - `-p 127.0.0.1:5678:5678`.
  - `n8n-old` con `--restart=no`.
- No pulsar "reparar" ni "actualizar" en Open Generative AI: su descargador reescribe `bin\`.

**D18. GPU para sd-server:**
- `iniciar-sd-server.bat` antepone `C:\AI\Wan2GP\venv\Lib\site-packages\torch\lib` al `PATH`.
- Ahí están `cudart64_12`, `cublas64_12` y `cublasLt64_12` (12.8). La build de sd.cpp usa CUDA 12.8.1.
- No se tocan archivos de Open Generative AI ni se descarga nada.
- Cada petición manda `steps 8`, `cfg 1.0` y `euler/simple` dentro de `<sd_cpp_extra_args>`, porque la API OpenAI no expone esos campos [VERIFICADO en `sdcpp_api.md`].
- **[INCIERTO]** hasta ver el log `-v` y `GET /sdcpp/v1/capabilities`.

---

## 3. Fases de implementación

**Equipos de agentes:**

| Equipo | Responsabilidad |
|---|---|
| **B** | Datos y contrato |
| **A** | Frontend: A1 diseño y secciones; A2 catálogo, bolsa y WhatsApp; A3 blog, SEO y accesibilidad; A4 panel admin |
| **C** | Workflows de n8n |
| **D** | IA local |
| **E** | Publicación y DevOps |
| **F** | QA y seguridad independientes |

**Orden** (diapositiva 17: "de idea a URL" rápido):
- **F0 → F1 → F2 → F3 → F4**: la v0 se publica en cuanto el sitio pasa la prueba local.
- **F5 y F6** arrancan tras F1, en paralelo con F2.
- **F7** va después de F4, F5 y F6.
- **F8** es opcional.

### F0. Validación del plan (ahora)

- **Entregable:** tus respuestas a la sección 5 y los permisos de la sección 4.
- **Criterio:** decisiones D1–D18 aprobadas o ajustadas.

### F1. Contrato de datos (equipo B; bloquea al resto, es corta)

**Entregables:**
- Los esquemas de `data/schema/`.
- `tools/validar.js`, con todas las reglas de D9.
- **Datos de muestra:**
  - 16 productos (4 por categoría, `muestra:true`).
  - 3 artículos.
  - `site.json` con `whatsapp` vacío.
- **Formatos:**
  - La operación del LLM (D4).
  - El borrador: `draft_id`, `owner_id`, `chat_id`, `preview_message_id`, `op`, `campos_inferidos`, `update_ids`, `file_ids` y `file_unique_ids`, fecha, `expira` (+24 h), estado y `commit_sha`.

**Criterio de aceptación:**
- Las muestras pasan la validación.
- La validación **rechaza al menos 15 casos malos:**
  - `<script>` en el nombre
  - precio negativo
  - talla inválida
  - URL de imagen externa
  - `id` duplicado
  - campo inventado
  - cadena con forma de token
  - `javascript:` en las redes
  - WhatsApp mal formado
  - `ia_local` en un producto
  - referencia rota
  - borrado masivo
  - JSON de más de 1 MB
  - `precio_oferta ≥ precio`
  - stock incoherente

### F2. Sitio web (equipo A, en paralelo con F5 y F6)

**Estructura** (el repo hace de `mi-sitio/`, como en la diapositiva 19):

```
tienda-tarapoto/
├─ index.html        landing + catálogo + blog (#blog/<slug>); CSS y JS en línea; comentario por sección
├─ admin.html        panel local (noindex, CSP propia, guardia de hostname)
├─ 404.html          rutas ABSOLUTAS /tienda-tarapoto/assets/…
├─ README.md  .nojekyll  .gitignore  .gitattributes  sitemap.xml      (sin robots.txt)
├─ assets/fonts/  assets/img/{brand,products,blog,lookbook,placeholders}/
├─ data/  products.json  articles.json  site.json  schema/
├─ n8n/workflows/*.json   (limpios, sin secretos)
└─ tools/ validar.js qa.js csp.js limpiar-workflows.js make-placeholders.mjs
          serve.py iniciar-sd-server.bat ruleset-main.json hooks/pre-commit
```

**Secciones** (diapositiva 19 + especificación de diseño):
1. Hero (título, subtítulo y botón)
2. Marquee
3. Categorías
4. Beneficios
5. **Cómo comprar** (el "proceso": eliges → bolsa → WhatsApp → entrega en motocarro)
6. Catálogo
7. **Evidencia** (lookbook y testimonios, estos solo si son reales)
8. Blog
9. Ubicación
10. **Contacto**
11. Footer

**Contenido por equipo:**
- **A1:** concepto "Selva pop editorial".
  - Tokens con contraste AA ya calculado.
  - Temas claro, oscuro y sistema, sin parpadeo.
  - Bricolage Grotesque, Figtree e Instrument Serif, alojadas en local.
- **A2:**
  - Búsqueda que ignora tildes.
  - Filtros por categoría, talla, color, precio y ofertas, reflejados en la URL.
  - Vista rápida en `<dialog>` con `#p/slug`.
  - Bolsa y WhatsApp en `S/` (`Intl` `es-PE`).
  - "Pedir" desactivado para las muestras.
- **A3:**
  - Blog por bloques y meta OG.
  - JSON-LD `ClothingStore`.
  - WCAG 2.2 AA y `prefers-reduced-motion`.
  - El `sitemap` se envía por Search Console.
- **A4:** `admin.html`.
  - Guardia de hostname.
  - Estado de n8n, sd-server y Ollama.
  - Botones "Crear imagen con IA", "Copiar prompt", "Abrir Open Generative AI" y "Abrir UI sd-server".
  - Enlace al formulario de n8n (v1.1).

**CSP:**

| Página | Política |
|---|---|
| Sitio | `default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'sha256-…'; connect-src 'self'; frame-src https://www.openstreetmap.org https://www.google.com` |
| `admin.html` | Añade `connect-src http://127.0.0.1:5678 http://localhost:5678 http://127.0.0.1:1234` y `img-src blob:` |

- El hash del script en línea lo calcula `tools/csp.js`.

**Criterio de aceptación: matriz de la diapositiva 16**

| Ítem | Responsable | Evidencia |
|---|---|---|
| **Verifica:** los totales coinciden con el dataset | A2 / F | `tools/qa.js` comprueba cuatro cosas: el contador del catálogo es igual a los `activo:true`; las categorías suman el total; `/lista` del bot muestra el mismo número; y el total de WhatsApp es la suma de las líneas. |
| **Verifica:** los filtros alteran las métricas correctamente | F | Lista escrita de casos por filtro y por combinación, incluida la URL. |
| **Verifica:** unidades y porcentajes consistentes | A2 / B | Siempre "S/ 69.90". El % de descuento sale de una sola función, compartida por la web y el bot. |
| **Verifica:** los hallazgos citan el dato que los sustenta | A / B | Cada tarjeta tiene `data-id`. "Nuevo" sale de `fecha_creacion`; el envío y los horarios, de `site.json`. Cada commit cita el `id`, el origen y el borrador. |
| **Revisa:** Word y PPT usan los mismos KPIs | E / F | README, `/estado` y cualquier entregable del curso toman las cifras de `tools/kpis.js`, que lee los mismos JSON. |
| **Revisa:** cada recomendación tiene responsable o siguiente paso | C / F | Toda respuesta del bot y todo aviso de WF9 terminan en "Siguiente paso: …". El runbook indica un responsable por tarea. |
| **Revisa:** los datos sensibles se manejan según las políticas | E / F | Cero tokens en el repo (hook, `git grep` y validador). Solo fotos sin GPS. Plantillas para la Ley 29733. Aviso de que todo lo que está en `data/` es público. |
| **Revisa:** las decisiones de impacto alto pasan por revisión humana | C / F | Toda escritura pasa por borrador y Publicar. Doble confirmación para `/borrar`, `/limpiar_muestras` y el cambio de WhatsApp. Pruebas en F7. |
| **Regla de cierre:** lo atractivo también debe ser verificable | F | Lighthouse ≥ 90 en rendimiento y ≥ 95 en accesibilidad, buenas prácticas y SEO, más las 8 filas anteriores con su evidencia. |

### F3. Prueba local (equipo F; diapositivas 20 y 22)

**Comandos:**

```powershell
# a) Doble clic en index.html (file://) → catálogo semilla, sin errores de consola/CSP [INCIERTO: CSP 'self' en file://]
# b) Servidor SOLO en 127.0.0.1 y SOLO el repo, bajo la subruta de Pages (404.html para rutas desconocidas):
python tools\serve.py                      # http://127.0.0.1:8080/tienda-tarapoto/
node tools\validar.js data\products.json data\articles.json data\site.json
node tools\qa.js; node tools\csp.js --check
git init -b main; git config user.name "Abner Cayao"; git config user.email "297644875+Abnercayao@users.noreply.github.com"
git config core.hooksPath tools/hooks
git add -A; git grep -nE "ghp_|github_pat_|bot[0-9]{8,10}:|[0-9]{8,10}:[A-Za-z0-9_-]{35}"   # debe salir vacío
git commit -m "Sitio inicial: landing + catálogo de muestra"
```

**Criterio de aceptación:**
- Ninguna ruta absoluta rota (salvo en `404.html`, a propósito).
- Responsive desde 360 px; el modo oscuro funciona.
- Con `http`, si se borra el JSON aparece "Catálogo no disponible", **no** la semilla.
- Si Windows pregunta "¿Permitir acceso?" para `python.exe`, se responde **Cancelar**.
- **[INCIERTO]** En `file://`, Chrome podría bloquear las fuentes locales y caer a la del sistema. Se acepta, porque es solo la prueba local.

### F4. Publicación en GitHub Pages (equipo E; **requiere tu aprobación**: P8 y P9)

En PowerShell. En Git Bash, `path=/` se convierte en una ruta de Windows.

```powershell
gh repo create Abnercayao/tienda-tarapoto --public --source . --remote origin --push `
  --description "Catálogo de ropa para el calor - Tarapoto" --homepage "https://abnercayao.github.io/tienda-tarapoto/"
gh api -X POST repos/Abnercayao/tienda-tarapoto/pages -f "source[branch]=main" -f "source[path]=/" -f build_type=legacy
gh api -X PUT  repos/Abnercayao/tienda-tarapoto/pages -F https_enforced=true
gh api -X POST repos/Abnercayao/tienda-tarapoto/rulesets --input tools\ruleset-main.json   # deletion + non_fast_forward en ~DEFAULT_BRANCH
gh api repos/Abnercayao/tienda-tarapoto/pages/builds/latest --jq .status     # repetir hasta "built" (puede dar 404 unos segundos)
curl.exe -sI https://abnercayao.github.io/tienda-tarapoto/                    # 200
curl.exe -sI http://abnercayao.github.io/tienda-tarapoto/                     # 301 → https
```

**Criterio de aceptación** ("Prueba final" de la diapositiva 22):
- Carga en una ventana privada.
- La navegación funciona y las imágenes se ven.
- La vista en el **móvil real** se lee bien.
- Candado HTTPS activo.
- El README documenta también el camino por la interfaz (Settings → Pages), como evidencia para el curso.

### F5. IA local (equipo D, en paralelo)

**1. sd-server, sin descargas** (`tools\iniciar-sd-server.bat`, P4):

```bat
set D=%APPDATA%\open-generative-ai\local-ai
set PATH=C:\AI\Wan2GP\venv\Lib\site-packages\torch\lib;%PATH%
"%D%\bin\sd-server.exe" --listen-ip 127.0.0.1 --listen-port 1234 -v ^
 --diffusion-model "%D%\models\z_image_turbo-Q4_K.gguf" --llm "%D%\models\Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf" ^
 --vae "%D%\models\ae.safetensors" --offload-to-cpu --diffusion-fa --vae-tiling ^
 --steps 8 --cfg-scale 1.0 --sampling-method euler --scheduler simple -W 1024 -H 1024 > "%LOCALAPPDATA%\tienda\sd-server.log" 2>&1
```

- Leer en el log si usa CUDA o Vulkan.
- `GET http://127.0.0.1:1234/sdcpp/v1/capabilities`: revisar `defaults_by_mode.img_gen` y si `output_formats_by_mode` incluye `webp`.
- Medir:
  - los segundos por imagen;
  - la VRAM y la RAM en reposo y generando (`nvidia-smi`);
  - la RAM con `--offload-to-cpu` (≈8 GB estimados).
- **Nunca usar `--listen-ip 0.0.0.0`.**
- **No usar a la vez** la app de Open Generative AI ni Wan2GP: sin VRAM, falla.

**2. Ollama** (P2 y P3):
- Instalar y definir `OLLAMA_NO_CLOUD=1`.
- `ollama pull qwen3.5:4b-q4_K_M`.
- Comprobar desde el contenedor: `docker exec n8n wget -qO- http://host.docker.internal:11434/api/tags`.

**3. Prueba del LLM:**
- 15 mensajes reales en español: con y sin foto, coma decimal, álbum y datos incompletos.
- Medir el % de JSON válido y de campos correctos.
- Si acierta en menos de 13 de 15, comparar con Information Extractor.

**Criterio de aceptación:**
- Una imagen de 1024×1024 en menos de 90 s (orientativo).
- El LLM acierta en 13 de 15 o más.
- `nvidia-smi` confirma que Ollama se descargó de la VRAM antes de generar.

### F6. Workflows de n8n (equipo C, en paralelo; se arman en JSON y luego se importan)

**Data Tables:** las crea WF0 con el nodo Data Table, operación "Table → Create" (verifiqué que existe).

| Tabla | Contenido |
|---|---|
| `config` | `BOT_TOKEN`, `AUTORIZADOS` (`[{id, rol}]`), `REPO`, `REPO_BRANCH`, `PAUSA`, `ULTIMO_COMMIT_AT`, `FALLOS_SEGUIDOS`, `ULTIMA_ALERTA_AT`, `ULTIMO_POLL_AT` |
| `locks` | `nombre`, `holder`, `hasta` |
| `inbox` | `update_id`, tipo, `chat_id`, `from_id`, `message_id`, `media_group_id`, `file_id`, `file_unique_id`, texto, `callback_data`, fecha, estado, intentos, error |
| `borradores` | Lo definido en F1 |

**Workflows:**

| Workflow | Disparador | Nodos, en orden | Versión |
|---|---|---|---|
| **WF0 Setup** | Manual (no guarda ejecuciones) | Crear las tablas → leer `config` → HTTP `deleteWebhook` → `getUpdates` (para ver `from.id`) → `setMyCommands` (*scope* de chat) → `setMyDescription` ("Si no respondo, la PC de la tienda está apagada") | v1 |
| **WF1 Ingesta** | Schedule 10 s (no guarda ejecuciones) | Ver la lista siguiente | v1 |
| **WF2 Worker** | Schedule 15 s | Ver la lista siguiente | v1 |
| **WF3 Borrador-IA** | Sub-workflow | Ver la lista siguiente | v1 |
| **WF4 Comandos** | Sub-workflow | Ver la lista de comandos siguiente | v1 (núcleo) / v1.1 (artículos) |
| **WF5 Publicar** | Sub-workflow | Ver la lista siguiente | v1 |
| **WF6 Imagen-IA** | Sub-workflow | Constructor de prompt (sin personas en `ninos`) → HTTP Ollama `keep_alive:0` → HTTP sd-server (`size 1024x1024`, `output_format webp`, `<sd_cpp_extra_args>{"sample_params":{"sample_steps":8,"sample_method":"euler","scheduler":"simple","guidance":{"txt_cfg":1.0}}}</sd_cpp_extra_args>`, timeout 10 min) → Convert to File → Telegram Send Photo con Portada / Hero / Lookbook / Descartar (elegir crea un borrador) | v1 |
| **WF7 Form-Admin** | Form Trigger `/form/tienda` | Formulario de producto o artículo con foto → Validar → borrador → vista previa a Telegram (se confirma allí). Reemplaza al antiguo WF6 Admin. | v1.1 |
| **WF8 Panel-API** | Webhook `POST /crear-imagen` (Header Auth; Allowed Origins `http://localhost:8080,http://127.0.0.1:8080`, **sin espacios**) y `GET /estado` | Lock (reintenta cada 5 s, máximo 10 min) → WF6 → Respond to Webhook con la imagen → liberar el lock | v1 |
| **WF9 Errores** | Error Trigger | Censurar `bot\d+:[\w-]+`, `github_pat_\w+` y `ghp_\w+` → solo workflow, nodo y mensaje corto → máximo 1 aviso por hora y por nodo → Telegram con "Siguiente paso" | v1 |
| **WF10 Salud** | Cada hora (sin commits) | Caducar borradores de más de 24 h → reintentar los `inbox` atascados → leer `GitHub-Authentication-Token-Expiration` y avisar a 14 días → avisar si Ollama o sd-server no responden y hay trabajos pendientes | v1.1 |

**WF1 Ingesta, paso a paso:**
1. Leer `config`.
2. HTTP `getUpdates`, con `continueOnFail`. Si falla, se aplica el contador de D15.
3. Split Out.
4. Code "Normalizar".
5. Filtro de autorizados (D2).
6. **Upsert en `inbox`.**
7. HTTP ACK.
8. Para los mensajes nuevos: `sendChatAction typing` y "Recibido, preparando borrador…".
9. Si el último sondeo fue hace más de 5 min: "Volví; tengo N mensajes pendientes".

**WF2 Worker, paso a paso:**
1. Tomar el lock.
2. Elegir el `inbox` `nuevo` más antiguo. Si es un álbum, esperar a que el grupo lleve 20 s sin fotos nuevas y procesarlo junto.
3. Switch según el tipo de mensaje:

   | Tipo | Destino |
   |---|---|
   | callback | WF5 |
   | `/…` | WF4 |
   | foto o texto | WF3 |
   | nota de voz | "Aún no entiendo audios" |
   | documento | "Reenvíala como foto" |

4. Marcar `hecho` o `error` (+`intentos`).
5. Si hay aprobados y pasaron 6 min o más desde el último commit: WF5 en lote.
6. Liberar el lock.

**WF3 Borrador-IA, paso a paso:**
1. Telegram Get File (la foto más grande).
2. Edit Image: 1200 px, WebP q80.
3. HTTP Ollama `/api/chat` (D4). Si Ollama no responde, se envía una **plantilla para rellenar a mano**.
4. Code "Validar".
5. IF: completo, incompleto o error.
6. Data Table `borradores`.
7. Code "Formatear vista previa": diff antes → después, con "(sugerido por IA)" en los campos inferidos.
8. Telegram con Publicar / Cancelar.
9. Si el borrador está incompleto, el bot pide solo lo que falta.

**WF4, comandos disponibles:**
- **Consulta:** `/ayuda`, `/lista`, `/ver <id>`, `/estado`, `/historial`.
- **Productos:** `/precio <id> <n>`, `/stock <id> <talla> <n>`, `/ocultar <id>`, `/mostrar <id>`, `/borrar <id>` (doble confirmación), `/foto <id>` (añadir o reemplazar).
- **Artículos:** `/articulo <tema>`, `/articulo_editar <id>`, `/articulo_ocultar <id>`.
- **Tienda:** `/whatsapp <número>` (confirmación especial antes → después), `/limpiar_muestras` (confirma el número exacto).
- **Imagen y control:** `/imagen <prompt>`, `/deshacer`, `/pausa`, `/reanudar`.
- **Toda escritura crea un borrador.**

**WF5 Publicar, paso a paso:**
1. **Al tocar Publicar:**
   - Answer Query, con `continueOnFail`.
   - Verificar el callback (D2).
   - `pendiente → aprobado`. Si afecta 0 filas, no hace nada.
   - Quitar los botones.
   - Aviso: "Aprobado; se publica en ≤ 6 min + 1–10 min de Pages".
2. **Al publicar el lote:**
   - `aprobado → publicando`.
   - Cadena D5.
   - `publicado` + `commit_sha`.
   - "Publicado: <URL>".

**Importación** (P7; mejor después de P6):

```powershell
New-Item -ItemType Directory -Force C:\Users\abner\n8n\data\import
docker exec -u node n8n n8n import:workflow --separate --input=/home/node/.n8n/import/
docker exec -u node n8n n8n list:workflow
```

- Después, **tú** asignas las credenciales y pulsas **Publish**.
- Opcional: `tools\n8n-deploy.ps1` crea las credenciales y publica por la API pública (`/api/v1/credentials` y `/workflows/{id}/publish`). Lee la API key y los secretos de un archivo que creas tú, fuera del repo. **Lo ejecutas tú.**

**Criterio de aceptación:**
- Los workflows se importan sin errores.
- Un desconocido es ignorado.
- `n8n/workflows/*.json` no tiene secretos, `pinData` ni `instanceId`.
- WF1 no deja ejecuciones guardadas.

### F7. Integración de punta a punta (equipos C, E y F; P10)

La mayoría de pruebas va en la rama **`pruebas`** (`REPO_BRANCH` en `config`), que no dispara builds de Pages.

| # | Prueba | Rama | Esperado |
|---|---|---|---|
| 1 | Crear un producto con foto | pruebas | Borrador → Publicar → 1 commit con WebP y JSON |
| 2 | Álbum de 3 fotos | pruebas | 1 borrador con 3 imágenes |
| 3 | Foto enviada como **archivo** con GPS | pruebas | Rechazada; pide reenviarla como foto |
| 4 | `/precio` con coma decimal | pruebas | Borrador con diff; nada se publica sin el botón |
| 5 | `/ocultar` y `/mostrar` | pruebas | Ídem |
| 6 | `/borrar` de un producto citado por un artículo | pruebas | Aviso de referencia y doble confirmación |
| 7 | Crear, editar y ocultar un artículo | pruebas | Borradores correctos |
| 8 | `/imagen` → "Portada"; botón del panel local | pruebas | Imagen en Telegram y en el panel; lock respetado |
| 9 | Doble toque en Publicar | pruebas | 1 solo commit |
| 10 | Dos mensajes seguidos + commit manual en medio | pruebas | Sin pérdida (reintento desde `ref`) |
| 11 | Un desconocido escribe; callback falsificado | pruebas | Ignorados |
| 12 | Ollama apagado | — | Plantilla manual; nada se pierde |
| 13 | n8n detenido 15 min con mensajes, luego reinicio | pruebas | "Volví…", sin duplicados (absorbe la ráfaga) |
| 14 | PAT revocado | — | Aviso claro; el borrador sigue `aprobado` |
| 15 | `products.json` corrompido a mano | pruebas | El bot se niega a publicar; la web usa la última copia buena |
| 16 | `/deshacer` | pruebas | Commit nuevo que restaura los datos |
| 17 | `/whatsapp` con un número nuevo | pruebas | Validado y con confirmación especial |
| 18 | `/limpiar_muestras` | main | Confirma el número exacto |
| 19 | El cambio aparece en Pages | main | En 10 min o menos |
| 20 | Diapositiva 22 + móvil en la misma Wi-Fi | main | Todo OK; `:5678` y `:8080` **no** responden desde el móvil |

**Entregables:**
- README con un runbook:
  - cómo arrancar y detener sd-server y Ollama;
  - comandos del bot;
  - qué hacer si falla, si la PC estuvo apagada o si se filtra un token (`/revoke` en BotFather + los 2 sitios del token, revocar el PAT, rotar `X-Tienda-Key`).
- Copia de seguridad de n8n (P5).

**Criterio de aceptación:**
- Las 20 pruebas pasan.
- Cada commit cita el `id`, el origen y el borrador (`data(products): actualizar prd-0007 precio 69.90 [telegram draft:ab12]`).
- Las 5 casillas de la diapositiva 22 y las 9 filas de la diapositiva 16 tienen evidencia.

### F8. Opcional

- Despliegue con GitHub Actions: validar y luego desplegar, sin límite de 10 builds por hora. Un JSON inválido nunca llega a publicarse.
- `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` si las pruebas muestran doble procesamiento.
- Open Generative AI v2.0.0 (P14).
- Protocolo `oga-local:` para abrir la app (P13).

---

## 4. Permisos y acciones

### 4a. Las hago yo, pero solo con tu "sí" explícito

| # | Acción | Detalle |
|---|---|---|
| P1 | Crear la carpeta del proyecto, los archivos y el repo **local** (`git init`, hook `pre-commit`) | `C:\Users\abner\dev\tienda-tarapoto` |
| P2 | Descargar e instalar **Ollama** | `OllamaSetup.exe` v0.35.1, **1,580,352,416 bytes (≈1.47 GiB)**, de github.com/ollama/ollama/releases. Arranca con tu sesión. Variable de usuario `OLLAMA_NO_CLOUD=1`. |
| P3 | Descargar el modelo | `ollama pull qwen3.5:4b-q4_K_M`, **3.3 GB** |
| P4 | Crear `iniciar-sd-server.bat`, `serve.py` y accesos directos; tarea programada opcional para sd-server al iniciar sesión | Sin descargas. Con la tarea, sd-server ocuparía ≈8 GB de RAM mientras corre. |
| P5 | Copia de seguridad de los datos de n8n | Contenedor **detenido** (≈1 min). Va a `C:\Users\abner\backups\n8n-AAAAMMDD`, **fuera del repo, de OneDrive y de Google Drive**: contiene la clave de cifrado y el token. |
| P6 | **Recrear el contenedor n8n (recomendado)** | Ver los comandos debajo. Se puede volver atrás. |
| P7 | Importar los workflows | `data\import` + `docker exec … import:workflow`. Escribe en la base de datos de n8n. |
| P8 | Crear el repo **público** y hacer push | `gh repo create …` (el contenido será público) |
| P9 | Configurar el repo | Activar Pages (main / root), `https_enforced`, ruleset en `main` y *topics* |
| P10 | Pruebas de punta a punta | El bot te escribe y se hacen commits reales (casi todos en la rama `pruebas`) |
| P11 *(opcional)* | Descargar las fuentes woff2 | Bricolage Grotesque, Figtree e Instrument Serif (OFL), de Google Fonts. Pocos cientos de KB **[INCIERTO el tamaño exacto]**. |
| P12 *(opcional)* | Instalar la skill oficial `frontend-design` | Desde `anthropics/skills`, en `.claude/skills` del proyecto, tras revisarla (descarga pequeña) |
| P13 *(opcional)* | Registrar el protocolo `oga-local:` | En `HKCU\Software\Classes`, para que un botón abra Open Generative AI. Es configuración persistente; la app **no** recibe el prompt. |
| P14 *(opcional, no recomendado ahora)* | Actualizar Open Generative AI a v2.0.0 | `Open.Generative.AI.Setup.2.0.0.exe`, **134,225,080 bytes**. Primero se copia `local-ai\bin`; luego se reverifican el wrapper, las DLL y sd-server. |

**Comandos de P6:**

```powershell
docker stop n8n; docker rename n8n n8n-old; docker update --restart=no n8n-old
docker tag docker.n8n.io/n8nio/n8n:latest docker.n8n.io/n8nio/n8n:2.40.7   # la imagen local ya es 2.40.7: no se descarga nada
docker run -d --name n8n --restart unless-stopped -p 127.0.0.1:5678:5678 `
  -e GENERIC_TIMEZONE=America/Lima -e TZ=America/Lima `
  -e N8N_DIAGNOSTICS_ENABLED=false -e N8N_VERSION_NOTIFICATIONS_ENABLED=false -e N8N_TEMPLATES_ENABLED=false `
  -v C:\Users\abner\n8n\data:/home/node/.n8n docker.n8n.io/n8nio/n8n:2.40.7
# Volver atrás: docker rm -f n8n; docker rename n8n-old n8n; docker update --restart=unless-stopped n8n; docker start n8n
```

### 4b. Solo puedes hacerlas tú (no puedo introducir tokens, contraseñas ni ajustes de seguridad)

1. **Bot de Telegram.**
   - En @BotFather: `/newbot` y `/setjoingroups` → Disable.
   - Pega el token en dos sitios: la credencial "Telegram Tienda" (`telegramApi`) y la fila `BOT_TOKEN` de la Data Table `config`.
   - Activa la **verificación en dos pasos** de Telegram. Quien controle esa cuenta controla la tienda.
   - No publiques el @usuario del bot.
2. **IDs autorizados:** escribe `/start` al bot, ejecuta WF0 y copia los `from.id` en `AUTORIZADOS`, con su rol. No son secretos; me los puedes decir.
3. **Token de GitHub (fine-grained PAT).** Se crea **después de F4**, porque el repo debe existir. En https://github.com/settings/personal-access-tokens/new :
   - "Only select repositories" → `tienda-tarapoto`.
   - **Contents: Read and write**. Opcional: Pages: Read.
   - Caducidad: 90 días.
   - Credencial `githubApi`: servidor `https://api.github.com`, usuario `Abnercayao`.
   - El bot avisa 14 días antes de que caduque.
4. **Clave de los webhooks locales:** una credencial Header Auth `X-Tienda-Key` con un valor que inventes. El panel la pide y la guarda en `sessionStorage`.
5. **En la interfaz de n8n:** asignar las credenciales y pulsar **Publish**. O bien ejecutar `tools\n8n-deploy.ps1` con tu API key.
6. **Datos de la tienda:**
   - WhatsApp, dirección, horario, medios de pago y política de cambios.
   - Verifica la marca en INDECOPI y en redes.
   - Consulta a un asesor sobre el Libro de Reclamaciones, la Ley 29733 y el consentimiento para fotos de menores.
7. **Pruebas tuyas:**
   - En tu **móvil real** (diapositiva 22).
   - Desde la misma Wi-Fi, confirma que `http://<IP-PC>:5678` no responde.
   - No aceptes avisos del Firewall para `python`, `sd-server` u `ollama`.
8. **Opcionales:**
   - Google Search Console para enviar el `sitemap`.
   - Inicio de sesión automático en Windows, solo si eliges la opción 17-B.

---

## 5. Preguntas

Entre paréntesis va la opción recomendada. Puedes responder "todo lo recomendado" y cambiar solo lo que quieras.

**A. Negocio**

1. **Nombre de la tienda:** A) Palmera Brava; B) Cocha Azul; C) Selva Fresca; D) el nombre real. **(D si existe; si no, A. La v0 puede salir marcada "demo".)**
2. **WhatsApp y contacto:** A) me das ya el número, el distrito y el horario; B) la v0 sale sin botones de pedido y con el banner de muestra, y el número llega después. **(A. Nunca se publica el número de ejemplo.)**
3. **¿Quién publica?** A) solo Abner; B) un dueño distinto (¿quién tiene la PC encendida, a nombre de quién van el repo y el bot, cómo se traspasan?); C) varias personas con roles. **(Dímelo: define `AUTORIZADOS`.)**
4. **¿Hay un WhatsApp Business separado del número personal?** **(Recomendado: sí.)**
5. **Fotos:** A) prendas sin personas; B) con modelos adultos; C) también niños, con consentimiento escrito de los padres. **(A en v1.)**

**B. Técnica**

6. **Repo y carpeta:** A) `tienda-tarapoto` en `C:\Users\abner\dev\`; B) slug de la marca; C) dentro de OneDrive. **(A)**
7. **IA para entender los mensajes:** A) Ollama + `qwen3.5:4b` (lee fotos; ≈1.47 GiB + 3.3 GB); B) Ollama con el Qwen3-4B que ya tienes (solo texto); C) nube (con costo, no es local). **(A)**
8. **Recepción de Telegram:** A) polling; B) ngrok; C) Cloudflare named tunnel (requiere dominio). **(A)**
9. **Automatización al publicar:** A) todo pasa por borrador y Publicar, y la publicación se agrupa sola; B) crear y editar van directo, y solo se confirman borrar, bajadas de precio de más del 30 % y el cambio de WhatsApp; C) todo directo. **(A, como pide la diapositiva 16.)**
10. **Despliegue:** A) `main` / `(root)`, como en el curso; B) GitHub Actions con validación previa. **(A en v1; B si superas 10 builds por hora.)**
11. **Archivo único (diapositiva 19):** A) `index.html` autocontenido; B) 1 CSS + 2–3 JS externos. **(A)**
12. **Recrear el contenedor n8n (P6):** A) sí (versión fija, solo `127.0.0.1`, sin telemetría); B) no por ahora. **(A)**

**C. Apps y skills**

13. **La app de escritorio** (Open Generative AI **ya está instalada**, v1.0.9): A) uso su motor `sd-server` y sus modelos, sin descargar nada; B) además la actualizo a **v2.0.0** (134,225,080 B), con copia previa; C) te referías a otra (¿cuál?). **(A ahora; B después de F5 si quieres sus novedades.)**
14. **El botón "Crear imagen":** A) en tu PC (panel + botón visible solo en localhost) genera con el **motor** de Open Generative AI vía n8n y lo manda a Telegram; B) lo mismo, más un botón que **abre** la app (P13; la app no recibe el prompt); C) solo copiar el prompt y abrir la app a mano. **(A o B. Confírmame que te sirve usar el motor y no la ventana de la app.)**
15. **"Antigravity" / habilidades:** A) leer la skill oficial `frontend-design` y aplicarla, sin instalar; B) instalarla en el proyecto tras revisarla (P12); C) el paquete `sickn33/agentic-awesome-skills` (antes `antigravity-awesome-skills`; enorme, sin garantía de calidad); D) la app Google Antigravity (agente en la nube, no local). **(B)**
16. **Fuentes:** A) descargar los woff2 y alojarlos (P11); B) fuentes del sistema, sin descargas. **(A)**

**D. Operación**

17. **Disponibilidad:** A) PC encendida con la sesión iniciada y bloqueada, y el bot avisa si estuvo caído; B) inicio de sesión automático (lo configuras tú y baja la seguridad); C) el bot solo responde cuando estás. **(A)**
18. **sd-server:** A) bajo demanda (`/imagen` avisa si está apagado); B) arranca siempre al iniciar sesión (≈8 GB de RAM). **(A, y decidimos tras medir en F5.)**

---

## 6. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Las condiciones de Pages prohíben el "e-commerce"; si un catálogo con WhatsApp está permitido es **[INCIERTO]** | Sin carrito ni pagos. Si el negocio crece, migrar a Cloudflare Pages o Netlify. |
| R2 | Límite blando de 10 builds por hora | Lotes con al menos 6 min entre commits. Pruebas en la rama `pruebas`. Actions (F8). |
| R3 | Caché de Pages (`max-age=600`). Que el CDN se purgue al desplegar es **[INCIERTO]**. Que ignore `?v=` se observó una sola vez, en otro sitio. | `no-cache` en el navegador, imágenes con hash y el aviso "1–10 min". |
| R4 | **Docker Desktop arranca al iniciar sesión, no al encender.** `settings-store.json` dice `AutoStart=false`, lo que contradice el registro **[INCIERTO hasta reiniciar]**. Tras un reinicio de Windows Update, el bot no responde. | Pregunta 17. Descripción del bot y aviso "Volví". Telegram guarda los mensajes 24 h; lo de más tiempo se pierde (va en el runbook). |
| R5 | 8 GB de VRAM compartidos (en reposo hay 1357 MiB usados) | Un solo worker con lock. `keep_alive:0` antes de generar. No usar la app ni Wan2GP con sd-server encendido. |
| R6 | sd-server en Vulkan o CPU (lento) | El `PATH` hacia las DLL de Wan2GP (D18). **[INCIERTO hasta ver el log `-v`]**. Depende de que exista el venv de Wan2GP. |
| R7 | El modelo de 4B se equivoca o inventa datos | `format` con esquema, validación determinista y confirmación humana. Los campos inferidos se marcan. Prueba con 15 mensajes. Plantilla manual si Ollama falla. |
| R8 | Se filtra un token | Token en `config`, no en los workflows. WF1 sin ejecuciones guardadas. WF9 censura. Hook, `git grep` y validador (push protection no cubre el token de Telegram). PAT fine-grained con caducidad. Runbook de rotación. **[INCIERTO]** si los errores HTTP incluyen la URL con el token. |
| R9 | El bot es público | Lista de autorizados, chat privado, callbacks verificados, `setMyCommands` con *scope* y verificación en dos pasos de Telegram. |
| R10 | n8n escucha en todas las interfaces | P6 (`127.0.0.1`). Hoy la red está en perfil Público y no hay reglas de entrada, así que lo probable es que el Firewall lo bloquee **[INCIERTO; prueba 20]**. No aceptar avisos del Firewall. `serve.py` solo en `127.0.0.1`. |
| R11 | *(Corregido)* `:latest` **no** se actualiza solo (no hay Watchtower). Solo cambia al hacer pull o recrear. | Fijar 2.40.7 re-etiquetando la imagen local (P6) y copia de seguridad (P5). |
| R12 | Git dentro de OneDrive | Repo en `C:\Users\abner\dev` (D8). |
| R13 | XSS por el contenido que escribe el agente | Esquema sin `<>`, solo `textContent`, CSP y lista de dominios permitidos para los enlaces. |
| R14 | *(Resuelto)* CORS del panel | n8n responde al preflight y refleja las cabeceras pedidas. Los orígenes van **sin espacios** y se incluyen los dos. |
| R15 | El repo crece con las imágenes | WebP de 1200 px y menos de 200 KB; no se suben los originales; JSON de menos de 1 MB. |
| R16 | Imágenes de IA tomadas por reales, o reseñas falsas | El esquema prohíbe `ia_local` en productos; etiqueta visible; testimonios solo verificados. |
| R17 | Obligaciones legales en Perú y consentimiento para fotos de menores **[INCIERTO]** | Plantillas en el footer; sin fotos de niños en v1; que lo valide un asesor. |
| R18 | Actualizar o "reparar" Open Generative AI reescribe `bin\` | No actualizar sin copia previa (P14). |
| R19 | Se pierde un cambio por publicaciones concurrentes | D5: concurrencia optimista, reinicio completo e idempotencia. |
| R20 | Mensajes perdidos o duplicados | D1: `inbox` antes del ACK, upsert por `update_id` y reintentos. |
| R21 | Tormenta de avisos de error | `continueOnFail`, contador y máximo 1 aviso por hora. |
| R22 | Ráfaga de ejecuciones del Schedule al arrancar **[INCIERTO; reportado en 2.21.7]** | Upsert y lock (prueba 13). |
| R23 | "Query is too old" en los botones **[INCIERTO el plazo]** | `continueOnFail` y el resultado en un mensaje nuevo. |
| R24 | GPS o EXIF en el repo público | Solo `message.photo`. **[INCIERTO; fuente secundaria]** que las fotos comprimidas pierdan el EXIF (prueba 3). La vista previa muestra la imagen ya procesada. |
| R25 | El PAT caduca | Aviso a 14 días leyendo la cabecera de caducidad (WF10). |
| R26 | Operaciones destructivas | `/deshacer`, ruleset, `/pausa`, límites de daño, integridad referencial y sin `eliminar_definitivo` en el LLM. |
| R27 | Lo oculto no es privado (`activo:false` y el stock se leen en el JSON público) | Avisarlo al dueño; nada privado en `data/`. |
| R28 | Dependencias de nube no declaradas | D16: telemetría apagada, `OLLAMA_NO_CLOUD` y fuentes locales. Lo inevitable queda declarado en la sección 1. |
| R29 | sd-server ignora los flags del `.bat` en la API **[INCIERTO]** | Parámetros explícitos en `sd_cpp_extra_args` (D18). |
| R30 | Carrera residual en el lock de la Data Table | `UPDATE … WHERE` atómico (verificado). Se relee el `holder`. Idempotencia de D5. Plan B: límite de concurrencia (F8). |

---

## 7. Fuentes principales

- **GitHub:**
  - límites de Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
  - API de Pages: https://docs.github.com/en/rest/pages/pages
  - HTTPS: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
  - Git Data API: https://docs.github.com/en/rest/git
  - autor de commits creados por API: https://docs.github.com/en/rest/git/commits#create-a-commit
  - refs: https://docs.github.com/en/rest/git/refs#update-a-reference
  - Contents API: https://docs.github.com/en/rest/repos/contents
  - disponibilidad de rulesets: https://raw.githubusercontent.com/github/docs/main/data/reusables/gated-features/repo-rules.md
  - patrones de secret scanning: https://docs.github.com/en/code-security/secret-scanning/introduction/supported-secret-scanning-patterns
  - caducidad de PAT: https://github.blog/changelog/2021-07-26-expiration-options-for-personal-access-tokens/
- **Telegram:**
  - `getUpdates`: https://core.telegram.org/bots/api#getupdates
  - `getting-updates`: https://core.telegram.org/bots/api#getting-updates
  - `CallbackQuery`: https://core.telegram.org/bots/api#callbackquery
  - `answerCallbackQuery`: https://core.telegram.org/bots/api#answercallbackquery
- **n8n:**
  - cambios de la 2.0: https://docs.n8n.io/changelog/v20-breaking-changes
  - Telegram Trigger: https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.telegramtrigger/common-issues/
  - CORS de webhooks: https://github.com/n8n-io/n8n/blob/master/packages/cli/src/webhooks/webhook-request-handler.ts
  - Edit Image: https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/EditImage/EditImage.node.ts
  - credencial de GitHub: https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/credentials/GithubApi.credentials.ts
  - telemetría: https://docs.n8n.io/hosting/securing/telemetry-opt-out
  - aislar n8n: https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/isolate-n8n
  - Form: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.form/
  - Information Extractor: https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.information-extractor/
  - Error Trigger: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger/
  - Data Tables: https://docs.n8n.io/build/work-with-data/data-tables.md
  - ráfaga del Schedule: https://community.n8n.io/t/schedule-trigger-fires-dozens-of-concurrent-executions-on-startup-instead-of-oneschedule-trigger-fires-dozens-of-concurrent-executions-on-startup-instead-of-one/296792
- **Ollama:**
  - releases: https://github.com/ollama/ollama/releases
  - etiquetas de qwen3.5: https://ollama.com/library/qwen3.5/tags
  - FAQ (`OLLAMA_NO_CLOUD`): https://docs.ollama.com/faq
- **stable-diffusion.cpp:**
  - API del servidor: https://github.com/leejet/stable-diffusion.cpp/blob/master/examples/server/api.md (copia local: `…\scratchpad\sdcpp_api.md`)
  - CUDA 12.8.1 en la build: https://github.com/leejet/stable-diffusion.cpp/blob/master/.github/workflows/build.yml
- **Open Generative AI:** https://github.com/Anil-matcha/Open-Generative-AI y la v2.0.0: https://github.com/Anil-matcha/Open-Generative-AI/releases/tag/v2.0.0
- **Skills:**
  - oficiales: https://github.com/anthropics/skills (`skills/frontend-design`)
  - de la comunidad: https://github.com/sickn33/agentic-awesome-skills
- **Otros:**
  - robots.txt: https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
  - Python `http.server`: https://docs.python.org/3.11/library/http.server.html
  - Chrome Local Network Access: https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY/m/JWenvGViCAAJ
- **Diapositivas revisadas:** 16, 17, 19, 22 y 23, en `C:\Users\abner\AppData\Local\Temp\claude\C--Users-abner-OneDrive-Desktop-Vanguard-Paginas-Ropa\c7eb6ec5-bd15-490f-bf3c-1129ebf910bd\scratchpad\p16.png`–`p25.png`.

---

## 8. Hechos verificados del entorno

Todo es de solo lectura. "HOY" = comprobado en esta pasada final; el resto viene de los informes y de las críticas.

| Área | Dato | Origen |
|---|---|---|
| GPU | NVIDIA GeForce RTX 5060 Ti, **8151 MiB**, driver 617.14. **En reposo: 1357 MiB usados** (≈6.8 GB libres). | `nvidia-smi` HOY |
| CPU, RAM y disco | Core Ultra 7 265KF (20 núcleos). **31.7 GB** de RAM. C: con ≈270 GB libres. | Informes |
| n8n: imagen y versión | `docker.n8n.io/n8nio/n8n` (tag latest) = **2.40.7**. Node 26.7.0. Imagen del 2026-09-25. | `n8n --version` HOY + informe |
| n8n: variables | Solo `GENERIC_TIMEZONE` y `TZ=America/Lima`, más las de la imagen. **Sin** `WEBHOOK_URL`, sin variables de telemetría y sin `N8N_CONCURRENCY_PRODUCTION_LIMIT` (por defecto **−1**, según el código de configuración). | `docker inspect` y código HOY |
| n8n: red y arranque | Puerto `5678` con `HostIp:""` (todas las interfaces). `restart=unless-stopped`. Arrancó el 2026-10-05 a las 22:48 (hora de Lima). Volumen `C:\Users\abner\n8n\data` → `/home/node/.n8n`. | `docker inspect` HOY |
| n8n: internos | SQLite con *pool* de 3 por defecto. 1 workflow ("My workflow"). Tiene `git` y `gm`. GraphicsMagick 1.3.47 con **WEBP de lectura y escritura**. ExecuteCommand desactivado (2.0). `/healthz` OK. API pública con `/credentials`, `/workflows` y `/workflows/{id}/publish`. | Informes y críticas |
| n8n: Data Tables | Fila: `insert`, `get`, `update`, `upsert`, `delete`, `rowExists`, `rowNotExists`. Tabla: `create`, `list`, `update`, `delete`, `clear`. `updateRows` es un único `UPDATE … WHERE` dentro de una transacción; en SQLite, con `returnData`, lee antes las filas afectadas en esa misma transacción. | Código del contenedor HOY |
| n8n: red hacia el host | `host.docker.internal` llega a servicios que escuchan solo en 127.0.0.1 de Windows (probado con un servidor temporal). Responde por IPv4 y por `[::1]` (wslrelay). | Informe n8n-telegram, crítica 3 |
| Docker | Único contenedor: `n8n` (no hay Watchtower). Docker Desktop arranca desde `HKCU\…\Run`, al iniciar sesión, pero `settings-store.json` dice `AutoStart=false`. No hay `AutoAdminLogon`. Suspensión con corriente: nunca. | Críticas |
| Red y Firewall | Perfil **Público**. Sin reglas de entrada para 5678, 8080, 1234, Docker ni Python. Puertos 1234, 8080, 11434 y 7860 libres. | Críticas |
| Open Generative AI | **v1.0.9** en `C:\Program Files\Open Generative AI\`. Instalador en caché de 134,290,480 B. La última versión es **v2.0.0** (2026-05-23, 134,225,080 B). Sin API HTTP, sin `setAsDefaultProtocolClient` y sin prompt por URL (solo IPC de Electron). | Informes (`app.asar`) |
| Motor local | `%APPDATA%\open-generative-ai\local-ai\`. Modelos: `z_image_turbo-Q4_K.gguf` (3.9 GB), `Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf` (3.7 GB) y `ae.safetensors`. En `bin\`: `sd-server.exe` (sd.cpp `master-929-3f8527a`, 2026-09-27), `ggml-cuda.dll` (sm_120a) y `ggml-vulkan.dll`. `sd-cli.exe` es un wrapper .NET de 5 KB que añade `--offload-to-cpu --diffusion-fa --vae-tiling`. Existe `bin-backup`. | Informes |
| API de sd-server | `/v1/images/generations` acepta `prompt`, `n`, `size`, `output_format` (png/jpeg/webp) y `output_compression`, más `<sd_cpp_extra_args>` (`sample_params.sample_steps`, `guidance.txt_cfg`, etc.). También `/sdapi/v1/txt2img`, `/sdcpp/v1/*` y `GET /sdcpp/v1/capabilities` (`defaults_by_mode`). UI propia, CORS y 127.0.0.1:1234 por defecto. | `sdcpp_api.md` HOY + informes |
| CUDA | `ggml-cuda.dll` importa `cudart64_12`, `cublas64_12` y `cublasLt64_12`, que **faltan** en `bin` y en System32. Están en `C:\AI\Wan2GP\venv\Lib\site-packages\torch\lib\` (12.8 y 12.8.4). `vulkan-1.dll` está en System32. Hoy, casi seguro, usa Vulkan. | Críticas 1 y 3 |
| Wan2GP | v13.14 en `C:\AI\Wan2GP`. Torch 2.11+cu128. ≈55 GB de modelos de video. No está corriendo. `Desktop\wan2gp-pip.txt` (157 KB) con el log cortado **[INCIERTO que la instalación terminara bien]**. | Informes |
| No instalado / instalado | No: Ollama, ngrok, ComfyUI, Telegram Desktop, GitHub Desktop, Pinokio, Antigravity. Sí: `cloudflared` 2026.7.3 (sin configurar), Claude Desktop, Python 3.11, Node.js y git 2.53. | Informes |
| GitHub | `gh` como **Abnercayao** (id 297644875, creada el 2026-06-28). Scopes `gist`, `read:org`, `repo` y `workflow`. Plan desconocido (`null`). Repos: `recepcion-ia` (público), `Frima-Emily` (público) y `Apuestas-de-Valor` (privado). Ninguno tiene Pages. **`tienda-tarapoto` da 404 (libre)**. No existe `Abnercayao.github.io`. | `gh` HOY + informe |
| git | `core.autocrlf=true`, `credential.helper=manager`, LongPathsEnabled=1. `user.email` = hotmail, que ya aparece en commits públicos. Git Bash convierte `path=/`. | Informe github-pages |
| Carpetas | La carpeta de trabajo solo contiene `Clase III.pdf` (44.9 MB). El Escritorio está redirigido a OneDrive. El proceso de OneDrive no corre y no tiene cuentas **[INCIERTO que siga inactivo]**. `GoogleDriveFS` arranca con Windows. | Informes y críticas |
| Pages | Un sitio github.io real devuelve `Cache-Control: max-age=600`. En `pages.github.com` el CDN ignoró un *query string* (una sola observación). | Informes |
| Descargas candidatas | `OllamaSetup.exe` v0.35.1 (2026-09-29): **1,580,352,416 B**. `qwen3.5:4b-q4_K_M`: **3.3 GB**, texto e imagen, modelo "thinking". | Críticas (API de GitHub y ollama.com) |
| Skills | `sickn33/antigravity-awesome-skills` redirige a `sickn33/agentic-awesome-skills` (≈47.3k estrellas, MIT). `anthropics/skills` incluye `frontend-design`. | Críticas |