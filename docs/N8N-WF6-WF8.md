# WF6 Imagen-IA y WF8 Panel-API (n8n v1) — Palmera Brava

Complementa `n8n/ARQUITECTURA-N8N.md` (§6 WF6/WF8), `docs/CONTRATO.md` §12 (imágenes con IA) y `docs/IMAGENES.md`.

## Archivos

| Archivo | Qué es |
|---|---|
| `n8n/workflows/WF6-imagen-ia.json`, `WF8-panel-api.json` | Generados (no editar a mano). |
| `n8n/tools/construir-negocio-b.js` | Generador: `node n8n/tools/construir-negocio-b.js`. |
| `n8n/src/negocio/wf6.js`, `wf8.js` | Código de cada nodo Code (secciones `//// <Nodo>`; incluyen `comun.js` y, en "Preparar", el bloque de `tools/validar.js`). |
| `n8n/tools/probar-negocio-b.js` | Pruebas de los nodos Code reales con datos simulados (+ integración con WF4 y WF5). |

Flujo de cambio: editar `src/negocio/wf6.js|wf8.js` → `node n8n/tools/construir-negocio-b.js` → `node n8n/validar-workflows.js` → `node n8n/tools/probar-negocio-b.js` → reimportar y **volver a publicar** WF6 y WF8.

## WF6 Imagen-IA (sub-workflow; no toma el lock)

Lo llaman WF4 (`/imagen [art-0001|look-1] descripción`, dentro del lock de WF2) y WF8 (panel, con su propio lock).

`Entrada → config → Preparar → (Telegram: "Genero la imagen…") → Ollama /api/ps → keep_alive:0 a cada modelo cargado (y al configurado) → sd-server POST /v1/images/generations (timeout 10 min) → Imagen → [Edit Image crop] → Imagen final → sendPhoto (pbCredTelegram01) con Hero/Portada/Lookbook/Descartar → insert pb_borradores + pb_imagenes → Salida`.

- **Prompt** (mismas frases que `admin.html` y `tools/image-prompts.json`): texto del usuario + "cropped at the neck, no face…" (persona adulta) o "No people, no mannequin, no hands, product only" + estilo de marca + "No text, no letters, no logos, no watermark". sd-server: `<sd_cpp_extra_args>{"seed":N,"sample_params":{"sample_steps":8,"sample_method":"euler","scheduler":"simple","guidance":{"txt_cfg":1.0}}}</sd_cpp_extra_args>`, `n:1`, `output_format:"webp"`, `output_compression:80`.
- **Niños**: si el texto menciona niños/bebés/kids, **siempre sin personas** (aunque el panel pida persona): prefijo "Product photo of children's clothing only… nobody is wearing it" y "No people, no children…". Aviso en el caption.
- **Persona adulta** (palabras como mujer, hombre, modelo, persona, o `personas:"adultos"` del panel): se genera más alta y se **recorta arriba** con Edit Image `crop` (gravedad Sur, como CONTRATO §12): 768×1024←768×1216 (−192), 1344×768←1344×1024 (−256), 1216×832←1216×1088 (−256), 1024×1024←1024×1216 (−192). Si el recorte no da la medida exacta, la imagen **no se envía**.
- **Tamaño final**: el del panel (`tamano_final`), o por objetivo en Telegram: `art-` → 1216×832 (portada), `look-` → 768×1024, sin objetivo → 1344×768 (hero).
- **Rol** recalculado desde `AUTORIZADOS` y `puede(rol,'imagen')`; un autor no autorizado no llega a la GPU.
- **Borrador** (`op:"agregar_imagen"`, `entidad:"sitio"`, `faltantes:["destino"]`, `preview_message_id` = la foto): se crea **después** de que Telegram acepta la foto (desvío consciente del orden de ARQUITECTURA: sin borradores huérfanos; el botón no puede adelantarse porque el lock lo tiene quien llamó). WF5 hace el resto: `dst:<draft>:hero|portada|look` fija el destino y manda la vista previa con Publicar/Cancelar; `no:<draft>` descarta.
- **Fallos** (pedido inválido, sd-server caído/500, recorte, sendPhoto): un mensaje con "Siguiente paso" solo si el pedido vino de Telegram, y `{ok:false, reintentar:false}` (cada reintento costaría ~1 min de GPU).
- **Salida**: `{ok, draft_id, telegram, seed, tamano, recorte_arriba, personas, avisos}` + binario `data`; para el panel también `b64` (WF8 rehace el binario en su propia ejecución: no depende del binario de otra ejecución).

## WF8 Panel-API (webhooks de `admin.html`)

Ambos con Header Auth `X-Tienda-Key` (credencial `pbCredHeader0001`), `allowedOrigins:"http://localhost:8080,http://127.0.0.1:8080"`, `responseMode:"responseNode"`.

- `POST /webhook/crear-imagen` → Validar pedido (`prompt_usuario` 3–1200 caracteres, sin `<>`; destinatario = primer admin con id, si no el dueño) → **lock `worker`** (mismo `UPDATE … WHERE hasta < ahora` que WF2, lease 15 min; si está ocupado, Wait 5 s y otra vez, máx. 10 min → **423**) → WF6 → **Liberar lock** → `image/webp` con `X-Draft-Id`, `X-Telegram` (`si`/`no`), `X-Seed` y `Access-Control-Expose-Headers`. Errores: 400 (pedido) o 502 con `siguiente_paso`. `executionTimeout` 1380 s (10 min de espera + 10 min de sd-server). Si WF8 falla, WF9 libera el lock.
- `GET /webhook/estado` → `{ok, ocupado, cola, pendientes, aprobados, pausa, ultimo_commit_at, ultimo_poll_at, fallos_poller, bot_token (sí/no), autorizados (cantidad), ollama{ok,version,cargados}, sd_server{ok}, texto}`; `texto` es lo que muestra el panel y termina en "Siguiente paso". Sin token ni ids.

`admin.html` ya llamaba a `http://127.0.0.1:5678/webhook/crear-imagen` (POST, `Content-Type` + `X-Tienda-Key`) y `/webhook/estado` (GET, `X-Tienda-Key`). Ajustes mínimos: no vuelve a recortar una imagen que ya llega con la altura final (WF6 la recorta), y si `X-Telegram: no` avisa que no llegó a Telegram. CSP actualizada con `node tools/csp.js`.

`n8n/validar-workflows.js` ahora acepta varios disparadores solo si todos son Webhook con método+ruta distintos (WF8).

## Pruebas (2026-10-06)

- `node n8n/validar-workflows.js --estricto`: 9 archivos, 0 errores, 0 avisos.
- `node n8n/tools/probar-negocio-b.js`: 68/68 (WF4 `/imagen` → WF6; persona adulta 768×1216 → recorte 192; niños sin personas aunque se pida; art → 1216×1088/−256; PNG → WebP; recorte fallido o con la altura original → no se envía; sd-server caído/500, sendPhoto fallido (mensaje sin token), panel sin destinatario; filas con las columnas exactas de `pb_borradores`/`pb_imagenes`; botones con el `Verificar` real de WF5: Lookbook del autor ok, Portada sin art → pide `/imagen art-0001`, otra persona/otro mensaje → rechazado, Descartar → cancelado, Publicar sin destino → "Aún falta"; **"Aplicar lote" real de WF5 publica look-1 y hero** con la imagen IA; WF8: cuerpo real del panel → mismo prompt que arma `admin.html`, 400/423/502, binario + cabeceras, estado sin token).
- `probar-negocio.js` 85/85 y `probar-nucleo.js` 74/74 siguen pasando.
- Contenedor desechable `n8n:2.40.7` (`--rm`): WF6 y WF8 importan con sus ids; los nodos reales "Imagen" → Edit Image `crop` → "Imagen final" corren en el task runner con un WebP real 768×1024 → recorte 768×832+0+192 → WebP 768×832 válido (`prepareBinaryData`/`getBinaryDataBuffer` ok). `$('nodo inexistente').isExecuted` lanza error: por eso `corrio()` usa try/catch.

## Pendientes / riesgos

- **No probado con el token real**: `sendPhoto` con WebP (Telegram suele aceptarlo como foto; si no, el usuario recibe el aviso y habría que pasar a JPEG con Edit Image), webhooks de WF8 en la instancia real (403 sin clave, CORS, bucle de lock con Data Tables reales) y generación real con sd-server (estaba apagado). Se hace en la fase de importación.
- `tools/limpiar-workflows.js --check` (hook pre-commit) marca como "sucios" los ids de credencial de WF3–WF6 y WF8, pero ARQUITECTURA §3 y `validar-workflows.js` exigen ids fijos: hay que decidir una de las dos reglas antes del commit (no se tocó `tools/`).
- El texto de `/imagen` en español va tal cual al modelo (Z-Image entiende español); el estilo y las reglas van en inglés.
- **v1.1 (fuera de v1)**: WF7 Form-Admin y WF10 Salud (expirar borradores > 24 h, reintentar inbox atascado, aviso de vencimiento del PAT, salud periódica de Ollama/sd-server); imágenes de producto desde `/imagen` (hoy solo hero, portada y lookbook).
