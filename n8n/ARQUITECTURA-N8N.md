# Arquitectura n8n v1 — Palmera Brava (F6)

Fuente de verdad para quien arma `n8n/workflows/*.json`. Complementa PLAN.md (D1–D18, F6) y CONTRATO.md (§8 borrador, §9 permisos, §10 LLM).
Todo lo marcado **[V]** se verificó el 2026-10-06 en el contenedor `n8n` (solo lectura) o importando y ejecutando en un contenedor desechable `n8n-arq` (2.40.7, ya borrado).

## 1. Hechos verificados de n8n 2.40.7

Ruta de nodos: `/usr/local/lib/node_modules/n8n/node_modules/n8n-nodes-base/dist/nodes` (descripciones completas en `../dist/types/nodes.json`).

| Nodo (`n8n-nodes-base.*`) | typeVersion a usar (máx.) | Parámetros clave **[V]** |
|---|---|---|
| `scheduleTrigger` | **1.4** | `rule.interval[{field:"seconds", secondsInterval:10}]`; `misfirePolicy` por defecto `skip` (ticks perdidos no se acumulan) |
| `manualTrigger` | 1 | solo para WF0 y pruebas |
| `code` | **2** | `mode` (`runOnceForAllItems`), `language:"javaScript"`, `jsCode` |
| `httpRequest` | **4.5** | `method,url,authentication(none\|predefinedCredentialType),nodeCredentialType,sendQuery/queryParameters.parameters[], sendHeaders/headerParameters.parameters[], sendBody,contentType:"json",specifyBody:"json",jsonBody, options.timeout, options.response.response{fullResponse,neverError,responseFormat:autodetect\|json\|text\|file}` |
| `if` | **2.3** | `conditions` = filtro `{options:{caseSensitive,leftValue:"",typeValidation:"strict",version:3}, conditions:[{id,leftValue,rightValue,operator:{type,operation}}], combinator}` |
| `switch` | **3.4** | `mode:"rules"`, `rules.values[{conditions:<filtro v3>, renameOutput:true, outputKey}]`, `options.fallbackOutput:"extra"` |
| `executeWorkflow` | **1.3** | `source:"database"`, `workflowId:{__rl:true,mode:"id",value:"<id16>"}`, `workflowInputs:{mappingMode:"defineBelow",value:{},schema:[]…}`, `mode:"once"`, `options.waitForSubWorkflow:true` |
| `executeWorkflowTrigger` | **1.2** | `inputSource:"passthrough"` (recibe los ítems tal cual, binarios incluidos) |
| `dataTable` | **1.1** | ver §3; `dataTableId` admite `mode:"name"` **[V]**; `resource:"table"`, `operation:"create"` con `options.createIfNotExists:true` **[V]** |
| `telegram` | **1.2** | ops: message `sendMessage, sendPhoto(binaryData,binaryPropertyName), editMessageText, sendChatAction, deleteMessage…`; callback `answerQuery`; file `get` + `download:true`. **No existe** `editMessageReplyMarkup` ni getUpdates |
| `editImage` | **1.1** | `operation:"resize"`, `width,height,resizeOption:"onlyIfLarger"`, `options.format:"webp"` → `image/webp` **[V]**; `crop` (`width,height,positionX,positionY`); `information`. `gm` 1.3.47 con WEBP rw |
| `webhook` | **2.1** | `httpMethod,path,authentication:"headerAuth",responseMode:"responseNode", options.allowedOrigins` |
| `respondToWebhook` | **1.5** | `respondWith:"binary"` + `responseDataSource:"set"` + `inputFieldName:"data"`; `respondWith:"json"` + `responseBody` |
| `errorTrigger` | 1 | — |
| `wait` | **1.1** | `resume:"timeInterval", amount, unit:"seconds"` (necesita `webhookId`) |
| `noOp` | 1 | — |
| `readWriteFile` | 1.1 | **No usar**: en 2.x el acceso está limitado a `~/.n8n-files` (`N8N_RESTRICT_FILE_ACCESS_TO`), fuera del volumen montado |

Hallazgos que condicionan el diseño:
1. **Credencial `telegramApi` sin `authenticate`** (`TelegramApi.credentials.js`: solo `accessToken`, `baseUrl` y un test a `/bot<token>/getMe`). En un HTTP Request **no inyecta nada**: getUpdates y cualquier llamada HTTP a Telegram necesitan el token en la URL → `BOT_TOKEN` vive también en `pb_config` (D14).
2. **Nodo Telegram fuerza `parse_mode`** (Markdown si se deja vacío) y en `sendMessage` v1.1+ **añade "This message was sent automatically with n8n"** salvo `additionalFields.appendAttribution:false`.
3. **Sub-workflows en producción ejecutan la versión publicada** (`getPublishedWorkflowData`): si WF3–WF6 no están publicados, el padre falla con "Workflow is not active and cannot be executed". Tras cada cambio hay que volver a publicar. Las ejecuciones manuales usan el borrador.
4. **Data Table por nombre** = `LOWER(name) LIKE %valor%` y toma el primero (subcadena). Por eso los nombres llevan prefijo y ninguno contiene a otro. `matchType` por defecto es `anyCondition`: **poner siempre `allConditions`**. `update`/`upsert` devuelven las filas afectadas; con 0 filas y `alwaysOutputData:true` sale `[{}]` **[V]** (se detecta con `$json.id === undefined`). `updateRows` es un único `UPDATE … WHERE` en transacción (D15). Condiciones: `eq, neq, like, ilike, gt, gte, lt, lte, isEmpty, isNotEmpty`. Columnas: `string, number, boolean, date`; las string son TEXT (sin límite práctico). Límite total 200 MB.
5. **Code (task runner)** **[V]**: `require('crypto')` bloqueado y `crypto` global = `undefined`; sí hay `Buffer`, `btoa/atob`, `TextEncoder`, `setTimeout`, `this.helpers.httpRequest` (sin credenciales), `this.helpers.getBinaryDataBuffer`, `this.helpers.prepareBinaryData`. IDs aleatorios con `Math.random()`; el hash de imagen sale del `sha` que devuelve GitHub al crear el blob.
6. **Webhook** **[V]**: sin cabecera o con clave errónea → **403**; preflight `OPTIONS` → 204 con `Access-Control-Allow-Origin` = origen si está en la lista (si no, devuelve el primero permitido y el navegador bloquea); `Allow-Headers` refleja lo pedido. Respuesta binaria `image/*` correcta.
7. **Importación** **[V]**: `import:workflow` conserva los `id` (16 alfanuméricos) y **despublica todo lo importado** (`--activeState` por defecto `false`); `import:credentials` conserva `id`, acepta `data` en texto plano y la cifra; **reimportar credenciales con `data` pisa el secreto**. `publish:workflow --id` requiere reiniciar n8n si está corriendo. `n8n execute --id` no sirve para probar: el módulo Data Table está desactivado en la CLI y choca con el puerto 5679 del broker. Para probar de verdad: `node n8n/tools/probar-contenedor.js` (contenedor desechable, webhooks de prueba; resultados en `docs/N8N-PRUEBAS.md`).
8. Credencial `githubApi` sí tiene `authenticate` (`Authorization: token <PAT>`) → HTTP Request con `predefinedCredentialType`/`githubApi`. `httpHeaderAuth`: campos `name`, `value`.
9. La instancia real tiene 1 workflow previo ("My workflow", `KDAz4EKuKCC7jdC7`); no se toca.

## 2. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| A1 | **Estado en Data Tables creadas por WF0 y referenciadas por nombre** (`mode:"name"`). Sin archivos JSON locales. | Verificado: sobrevive a import y no depende de IDs generados. Read/Write File no llega al volumen. |
| A2 | **Mensajes de texto a Telegram por HTTP** (token de `pb_config`): getUpdates, ACK, sendMessage, editMessageText, editMessageReplyMarkup, answerCallbackQuery, sendChatAction, setMyCommands, deleteWebhook. **Nodo Telegram (credencial) solo para** `file get+download` y `sendPhoto` binario. | Teclados dinámicos (Publicar solo sin faltantes, `ok2`), sin atribución ni Markdown forzado; un único patrón de envío. |
| A3 | Todo texto va con `parse_mode:"HTML"` y pasa por `h()` (escapa `& < >`). Cada mensaje (y cada aviso de callback) termina en `\nSiguiente paso: …`; el helper `msg()` lo exige. Sin emojis. | Un `&` en un nombre rompe Markdown/HTML. |
| A4 | Un solo lock `worker` (lease 15 min) para **GPU y GitHub**: lo toman WF2 y WF8. | WF3 (Ollama), WF6 (sd-server) y WF5 (commit) nunca corren en paralelo. |
| A5 | WF1 **responde los callbacks al instante** (`answerCallbackQuery` "Recibido…") y solo encola; la verificación real la hace WF5. | El botón no queda "cargando" mientras el worker está ocupado. |
| A6 | Ingesta idempotente con **`rowNotExists` + `insert`** (no upsert) por `update_id`. | Un upsert repetido devolvería a `nuevo` un mensaje ya procesado. Duplicados por solapamiento se absorben en WF2 (cambia `nuevo→procesando` por `update_id`). |
| A7 | **Imágenes ya procesadas (WebP base64) en `pb_imagenes`** al crear el borrador (WF3/WF6). WF5 no vuelve a descargar ni a convertir. Se borran al publicar. `file_ids` se siguen guardando (CONTRATO §8). | WF5, el más delicado, queda solo con GitHub. Desvío consciente de CONTRATO §8 ("se vuelven a descargar"). |
| A8 | **WF3 es el único que crea borradores de catálogo y artículos** (`modo:"llm"`, `"completar"` u `"operacion"`); WF4 le pasa operaciones ya armadas. WF6 crea los de imagen. | Validación y vista previa en un solo lugar. |
| A9 | Cada sub-workflow lee `pb_config` por su cuenta (nodo "Leer config" + Code "Config"). | Se pueden probar solos; el token no viaja en la entrada. |
| A10 | Ejecuciones: `saveDataSuccessExecution:"none"` en todos; `saveDataErrorExecution:"all"` salvo WF1 (`"none"`); `saveManualExecutions:false` en WF0 y WF1. Riesgo residual: una ejecución fallida guardada contiene la salida de "Leer config" (token); misma base local que la Data Table. No compartir exportaciones de ejecuciones. | D14. |
| A11 | Código de Code que usa el validador: el JSON del repo lleva la línea `// @incluir validar.js`; `node n8n/tools/construir-nucleo.js`, `construir-negocio-a.js` y `construir-negocio-b.js` la reemplazan por el bloque `COPIAR A N8N … FIN` de `tools/validar.js` al generar `n8n/workflows/*.json`. | Una sola fuente (D9). |

## 3. Identificadores fijos

**Workflows** (16 alfanuméricos; los de `reference/` son solo de prueba):

| WF | id | Nombre en n8n | Disparador | settings extra |
|---|---|---|---|---|
| WF0 | `pbWf00Setup00000` | PB WF0 Setup | Manual | `saveManualExecutions:false` |
| WF1 | `pbWf01Ingesta000` | PB WF1 Ingesta | Schedule 10 s | sin guardar nada; `executionTimeout:60` |
| WF2 | `pbWf02Worker0000` | PB WF2 Worker | Schedule 10 s | `executionTimeout:840` |
| WF3 | `pbWf03Borrador00` | PB WF3 Borrador-IA | Execute Workflow Trigger | sub |
| WF4 | `pbWf04Comandos00` | PB WF4 Comandos | Execute Workflow Trigger | sub |
| WF5 | `pbWf05Publicar00` | PB WF5 Publicar | Execute Workflow Trigger | sub |
| WF6 | `pbWf06Imagen0000` | PB WF6 Imagen-IA | Execute Workflow Trigger | sub |
| WF8 | `pbWf08PanelApi00` | PB WF8 Panel-API | Webhooks (2) | `executionTimeout:1380` |
| WF9 | `pbWf09Errores000` | PB WF9 Errores | Error Trigger | sin `errorWorkflow` |

Comunes: `executionOrder:"v1"`, `timezone:"America/Lima"`, `errorWorkflow:"pbWf09Errores000"` (salvo WF9), subs con `callerPolicy:"workflowsFromSameOwner"`. IDs de nodo: UUID v4 fijos; `webhookId` fijo en Webhook y Wait.

**Credenciales** (plantilla `reference/credenciales.plantilla.json`, valores `PEGAR_EN_LA_UI_DE_N8N`):

| id | Nombre | Tipo | Dónde |
|---|---|---|---|
| `pbCredTelegram01` | Telegram Palmera Brava | `telegramApi` | nodos Telegram de WF3 (descargar fotos) y WF6 (sendPhoto) |
| `pbCredGithub0001` | GitHub Palmera Brava | `githubApi` | HTTP Request (`authentication:"predefinedCredentialType"`, `nodeCredentialType:"githubApi"`) en WF3, WF4, WF5 y WF12 |
| `pbCredHeader0001` | Header X-Tienda-Key | `httpHeaderAuth` (`name:"X-Tienda-Key"`) | Webhooks de WF8 y WF12 (`chat-url`) |
| `pbCredMercPago01` | Mercado Pago Prueba | `httpHeaderAuth` (`name:"Authorization"`, value `Bearer PEGAR_ACCESS_TOKEN_DE_PRUEBA`) | HTTP Request (`authentication:"genericCredentialType"`, `genericAuthType:"httpHeaderAuth"`) a `MP_API_URL` en WF13 y WF14 (v3, §12). **Solo el usuario** pega su Access Token de PRUEBA en la UI |

En el nodo: `"credentials": {"githubApi": {"id": "pbCredGithub0001", "name": "GitHub Palmera Brava"}}`.

## 4. Tablas (las crea WF0 con `createIfNotExists`)

Sistema: `id`, `createdAt`, `updatedAt` (no se escriben). Tiempos en **ms epoch** (`number`) para poder comparar con `lt/gt`.

| Tabla | Columnas (tipo) |
|---|---|
| `pb_config` | `clave` s, `valor` s (una fila por clave) |
| `pb_locks` | `nombre` s, `holder` s, `hasta` n |
| `pb_inbox` | `update_id` n, `tipo` s, `chat_id` n, `from_id` n, `nombre` s, `rol` s, `message_id` n, `media_group_id` s, `file_id` s, `file_unique_id` s, `texto` s, `callback_id` s, `callback_data` s, `callback_message_id` n, `fecha` n, `recibido` n, `estado` s, `intentos` n, `error` s |
| `pb_borradores` | CONTRATO §8 (`draft_id … commit_sha`) + `texto` s (mensaje original, ≤2000, para completar) + `resumen` s (≤300, commit y avisos) + `fecha_ms` n |
| `pb_imagenes` | `draft_id` s, `n` n, `b64` s (WebP), `mime` s, `ancho` n, `alto` n, `origen` s (`foto`\|`ia_local`), `alt` s, `file_unique_id` s |

`pb_inbox.tipo`: `texto | comando | foto | callback | voz | documento | otro`. `estado`: `nuevo → procesando → hecho | error` (vuelve a `nuevo` si `intentos < 3`).
`pb_borradores.estado`: `pendiente → aprobado → publicando → publicado`; `cancelado`, `expirado` (v1.1), `error`. Cada transición es un `update` con filtro `draft_id eq X` **y** `estado eq <anterior>` (`allConditions`); 0 filas = no hacer nada.

**Claves de `pb_config`** (WF0 inserta solo las que faltan; el usuario edita valores en la UI de Data Tables):
`BOT_TOKEN` (""), `AUTORIZADOS` (CONTRATO §9, ids 0), `REPO` (`Abnercayao/tienda-tarapoto`), `REPO_BRANCH` (`main`), `SITIO_URL` (`https://abnercayao.github.io/tienda-tarapoto/`), `COMMIT_EMAIL` (`297644875+Abnercayao@users.noreply.github.com`), `PAUSA` (`0`), `MIN_ENTRE_COMMITS_MS` (`360000`), `ULTIMO_COMMIT_AT` (`0`), `ULTIMO_POLL_AT` (`0`), `FALLOS_SEGUIDOS` (`0`), `ULTIMA_ALERTA_AT` (`0`), `ALERTAS` (`{}`: clave `wf|nodo` → ms), `DESCONOCIDOS` (`[]`: últimos 10 `{id,nombre,fecha}` que escribieron sin estar autorizados), `OLLAMA_URL` (`http://host.docker.internal:11434`), `OLLAMA_MODELO` (`qwen3.5:4b-q4_K_M`), `SD_URL` (`http://host.docker.internal:1234`). v3 (§12): `PEDIDO_ULTIMO` (`PB-000100`), `MP_MODO` (`auto`), `MP_LINK` (`init_point`), `MP_WEBHOOK_SECRET` (""), `TUNEL_URL` ("", la escribe WF12); solo pruebas: `MP_API_URL`, `CATALOGO_URL`, `TELEGRAM_API_URL`.

v3: `pb_pedidos` (columnas `COLUMNAS_PB_PEDIDOS` de `tools/validar.js`: `numero, correo, estado, pago_estado, total` n, `fecha, actualizado, opcion_envio, departamento, preference_id, payment_id, codigo_seguimiento, pedido_json`) la crean WF13–WF16 con `createIfNotExists`. **Los pedidos nunca van al repo** (datos personales).

## 5. Patrones comunes

- **Config:** Data Table `get` en `pb_config` (`returnAll:true`, sin filtros) → Code "Config" → un ítem `{BOT_TOKEN, AUTORIZADOS:[…], …}` (números ya convertidos). Si `BOT_TOKEN` está vacío, el workflow termina sin error.
- **Enviar a Telegram (HTTP):** Code arma ítems `{metodo, cuerpo}` → HTTP `POST https://api.telegram.org/bot{{ $('Config').first().json.BOT_TOKEN }}/{{ $json.metodo }}`, body JSON `={{ JSON.stringify($json.cuerpo) }}`, `timeout 20000`, `neverError:true`, `onError:"continueRegularOutput"`; un Code posterior revisa `ok`. Teclado: `cuerpo.reply_markup = {inline_keyboard:[[{text:"Publicar",callback_data:"pub:"+id},{text:"Cancelar",callback_data:"no:"+id}]]}`.
- **Lock tomar:** Data Table `update` `pb_locks`, `allConditions`: `nombre eq worker` y `hasta lt {{Date.now()}}` → `holder={{$execution.id}}`, `hasta={{Date.now()+900000}}`, `alwaysOutputData:true` → IF `{{$json.id}}` existe. **Liberar:** `update` `nombre eq worker` y `holder eq {{$execution.id}}` → `hasta=0`. WF9 libera si el `holder` es la ejecución fallida. Patrón probado en `reference/minimo.json` ("Tomar lock").
- **Permisos:** `puede(rol, accion)` de validar.js; el `rol` se recalcula en WF2 desde `AUTORIZADOS` actual (revocar surte efecto al instante).
- **Errores:** HTTP externos con `onError:"continueRegularOutput"` + Code que decide; los Execute Workflow de WF2 también, para marcar `error` en `pb_inbox` sin cortar el tick. Mensajes de error siempre censurados (`bot\d+:[\w-]+`, `\d{8,10}:[\w-]{30,}`, `github_pat_\w+`, `ghp_\w+`).
- **Timeouts HTTP:** Telegram 20 s, GitHub 30 s, Ollama 180 s, sd-server 600 s.

## 6. Workflows

### WF0 Setup (manual; se vuelve a correr al cambiar `AUTORIZADOS`)
1. 5 nodos Data Table `table/create` (`createIfNotExists`): `pb_config`, `pb_locks`, `pb_inbox`, `pb_borradores`, `pb_imagenes` con las columnas de §4.
2. Code "Claves por defecto" → `rowNotExists` (`clave eq`) → `insert` en `pb_config`. Igual para `pb_locks` (`{nombre:"worker",holder:"",hasta:0}`).
3. Leer config → si falta `BOT_TOKEN`: salida "Pega el token en pb_config.BOT_TOKEN y en la credencial; vuelve a ejecutar".
4. HTTP `getMe` → `deleteWebhook` (`drop_pending_updates:false`) → `deleteMyCommands` (scope default: los extraños no ven comandos) → por cada autorizado con `id>0`: `setMyCommands` con `scope:{type:"chat",chat_id:id}` y la lista de su rol (§8) → `setMyDescription` y `setMyShortDescription`: "Bot privado de Palmera Brava. Si no respondo, la PC de la tienda está apagada."
5. Salida: `@usuario` del bot, autorizados activos y `DESCONOCIDOS` (así se obtienen los `from.id`: la persona escribe `/start`, WF1 la anota, el admin copia el id a `AUTORIZADOS` en la UI y vuelve a correr WF0).

### WF1 Ingesta (Schedule 10 s; no guarda ejecuciones)
1. Leer config → Config.
2. HTTP `GET …/getUpdates?timeout=0&limit=20&allowed_updates=["message","callback_query"]` (`onError:"continueErrorOutput"`). Salida de error → Code "Fallo" → `FALLOS_SEGUIDOS+1`; si llega a 30 y `ULTIMA_ALERTA_AT` > 1 h: aviso al admin (best effort).
3. Code "Normalizar": por update → fila de `pb_inbox` (`estado:"nuevo"`, `intentos:0`, `recibido:Date.now()`, foto = último `photo[]`, `texto` = text o caption ≤4096, callback → `callback_*` y `chat_id` de `callback_query.message.chat`). Filtro D2: `from.id` ∈ `AUTORIZADOS` con `id>0` **y** chat `private`; lo demás se descarta en silencio (solo se anota en `DESCONOCIDOS` si es chat privado). Calcula `maxUpdateId` de **todos** los updates. Si no queda ninguna fila devuelve un único ítem `{noop:true}`.
4. IF `noop` → (falso) Data Table `rowNotExists` (`update_id eq`) → `insert` (`autoMapInputData`, el ítem trae exactamente las columnas). **Sin `continueOnFail`: si falla la inserción no hay ACK.** Ambas ramas llegan a…
5. Code "Preparar ACK" (una sola salida si `maxUpdateId>0`) → HTTP `getUpdates?offset=<max+1>&limit=1&timeout=0`.
6. Code "Avisos": callbacks → `answerCallbackQuery` "Recibido. Siguiente paso: espera la respuesta."; foto/texto libre → `sendChatAction typing` + "Recibido, preparo el borrador…"; si `ULTIMO_POLL_AT` > 5 min → "Volví…". → HTTP enviar.
7. `update` `pb_config`: `ULTIMO_POLL_AT=now` (y `FALLOS_SEGUIDOS=0` si no lo era; `DESCONOCIDOS` si cambió).

### WF2 Worker (Schedule 10 s)
1. Tomar lock (si no, fin). Leer config.
2. `get` `pb_inbox` `estado eq nuevo`, orden `id ASC`, `limit 20` → Code "Elegir" → **un** trabajo: el más antiguo; si tiene `media_group_id`, junta todo el álbum solo cuando la foto más nueva del grupo tiene `recibido` de hace ≥ 20 s (si no, salta a otro). Rol recalculado; si ya no está autorizado → `estado:"error"`, `error:"no autorizado"`.
3. `update` `pb_inbox` por cada `update_id` del trabajo: `estado eq nuevo` → `procesando` (absorbe duplicados).
4. Switch `tipo`: `callback` → WF5 (`modo:"callback"`); `comando` (texto que empieza por `/`, o foto con caption `/foto <id>`) → WF4; `foto`/`texto` → WF3 (`modo:"llm"`, o `"completar"` si el autor tiene un `pendiente` con faltantes de < 24 h y el texto no trae foto); `voz`/`documento`/`otro` → mensaje fijo (§8).
5. Marcar `hecho`, o `error` con `intentos+1` (vuelve a `nuevo` si `intentos<3`) y `error` censurado.
6. Si `PAUSA≠1` y existe algún `aprobado` (o `publicando` huérfano) y `now-ULTIMO_COMMIT_AT ≥ MIN_ENTRE_COMMITS_MS` → WF5 (`modo:"lote"`).
7. Liberar lock.

**Entrada común a WF3/WF4/WF5-callback** (`trabajo`): `{tipo, update_ids[], chat_id, from_id, nombre, rol, message_id, texto, comando, args[], fotos:[{file_id,file_unique_id}], callback:{id,data,message_id}, origen:"telegram"}`. **Salida común:** un ítem `{ok:boolean, error?:string, draft_id?:string}`.

### WF3 Borrador-IA (sub)
Entrada: `trabajo` + `modo` (`llm` | `completar` | `operacion`) + `tipo_entidad` (`producto` | `articulo`) + `operacion?` (para `operacion`: `{op, entidad, id, campos, confirmaciones_requeridas}` armada por WF4) + `draft_id?` (para `completar`).
1. Leer config. HTTP GitHub `GET /repos/{REPO}/contents/data/products.json?ref={REPO_BRANCH}` y `articles.json` (cabecera `Accept: application/vnd.github.raw+json`, `responseFormat:"text"`) → catálogo.
2. Si hay fotos (máx. 6): Telegram `file get` + `download` → Code base64 del JPEG original para Ollama (máx. 3) → Edit Image `resize` 1200×1200 `onlyIfLarger` + `format:webp` → Edit Image `information` (ancho/alto) → Code base64. (La calidad WebP no se puede fijar en la UI: gm usa 75 por defecto **[INCIERTO]** si se respeta `quality` oculto.)
3. `llm`/`completar`: Code `cuerpoOllama({tipo, texto, imagenesBase64, productos})` → HTTP `POST {OLLAMA_URL}/api/chat` (`onError:"continueErrorOutput"`) → Code `validarOperacion(message.content, {texto, productos, articulos, hayFoto, rol})`; si `reintentar==="crear"` → **un** reintento con `reintento:true` y se vuelve a validar (la corrección determinista ya quedó aplicada). Ollama caído → plantilla manual (§8) y `ok:true`.
   `operacion`: se valida con las mismas reglas (sin LLM).
4. Permiso `puede(rol, op)`; si no → mensaje y fin.
5. `insert` en `pb_borradores` (`estado:"pendiente"`, `expira` = +24 h, `confirmaciones_requeridas` 2 para `eliminar|limpiar_muestras|deshacer|whatsapp`) y en `pb_imagenes` (una fila por foto). En `completar` se hace `update` del mismo `draft_id` y se quitan los botones de la vista previa anterior.
6. Code "Vista previa" (diff antes→después, "(sugerido por IA)", avisos) → HTTP `sendMessage` con Publicar/Cancelar **solo si `faltantes` está vacío**; si no, pide solo lo que falta → `update` `preview_message_id`. Si la vista previa de un borrador **nuevo** no se pudo enviar, ese borrador pasa a `error` (WF2 reintenta y crea otro): no quedan `pendiente` sin botones.

### WF4 Comandos (sub)
Entrada: `trabajo`. Parsea `comando`/`args`, verifica `puede(rol, accion)` y:
- Consulta (sin borrador): `/start`, `/ayuda`, `/lista [categoria]`, `/ver <id>` (catálogo vía GitHub raw), `/estado` (cola, aprobados, pausa, último commit), `/historial` (`GET /repos/{REPO}/commits?sha={BRANCH}&per_page=20`, filtra autor "Tienda Bot", muestra 5), `/ids` (solo admin: `DESCONOCIDOS`).
- Escritura → arma `operacion` y llama a WF3 (`modo:"operacion"`): `/precio <id> <n> [oferta <n>|sin oferta]`, `/stock <id> <talla> <n|+n|-n>`, `/ocultar <id>`, `/mostrar <id>`, `/foto <id>` (en el caption de una foto; `agregar_imagen`), `/borrar <id>` (`eliminar`), `/whatsapp <51XXXXXXXXX>`, `/limpiar_muestras` (cuenta exacta en `campos.cantidad`), `/deshacer` (guarda `campos.head_sha`), `/articulo <tema>` (WF3 `modo:"llm"`, `tipo_entidad:"articulo"`), `/articulo_ocultar <art-id>`.
- `/imagen [art-NNNN|look-N] <prompt>` → WF6.
- Control inmediato (sin borrador): `/pausa`, `/reanudar` (`PAUSA` en `pb_config`), `/cancelar` (sus `pendiente` → `cancelado`).
- Desconocido → "No conozco ese comando…".

### WF5 Publicar (sub; solo lo llama WF2, ya con el lock)
**`modo:"callback"`** (`callback.data`: `pub:<draft>`, `no:<draft>`, `ok2:<draft>`, `dst:<draft>:hero|portada|look`):
1. `get` borrador por `draft_id` → Code "Verificar" (D2): `owner_id == from_id`, `preview_message_id == callback.message_id`, `estado == pendiente`, `puede(rol,'publicar')` y el permiso de la op. Falla → `answerCallbackQuery` con `show_alert` ("Este borrador no es tuyo…", "Ya no está pendiente…") y fin.
2. `no` → `pendiente→cancelado`, `editMessageReplyMarkup` sin teclado + "Cancelado…".
3. `pub` con `confirmaciones_requeridas=2` y `confirmaciones=0` → `confirmaciones=1`, nuevo mensaje con la acción exacta y botón `ok2:` (su `message_id` pasa a `preview_message_id`). `pub` (1 confirmación) u `ok2` (con `confirmaciones=1`) → `pendiente→aprobado` (filtro también `faltantes eq "[]"`), quitar botones, "Aprobado…" (o "En pausa…" si `PAUSA=1`).
4. `dst` (borrador de imagen): guarda `campos.destino`, `faltantes:"[]"` y envía vista previa con Publicar/Cancelar. `portada`/`look` sin id en `campos.objetivo` → "Usa /imagen art-0001 … ".

**`modo:"lote"`:** `get` `aprobado` **o** `publicando` (orden `id`, máx. 20; si hay un `deshacer`, va solo) → `aprobado→publicando` (un `publicando` es huérfano de un WF5 que murió a mitad —apagón/reinicio—: se reintenta con `intentos+1`, con 3 → `error`; Aplicar lote salta lo que ya llegó al repo) → **cadena D5 (§7)** → éxito: `publicando→publicado` + `commit_sha`, `deleteRows` en `pb_imagenes` de esos borradores, `ULTIMO_COMMIT_AT=now`, "Publicado…" a cada autor. Falla: `publicando→aprobado`, `intentos+1` (con 3 → `error`) y aviso censurado. Un borrador que no se puede aplicar o rompe `validar()` se marca `error` y se excluye; el resto sigue.

### WF6 Imagen-IA (sub)
Entrada: `{prompt, objetivo?: "art-0002"|"look-1", chat_id, from_id, rol, origen:"telegram"|"panel", seed?, size?}`.
1. Leer config. Code "Prompt": inglés + "No text, no logos, no watermark"; si menciona niños/kids → "No people, no mannequin, no hands, product only"; si hay personas → "cropped at the neck, no face, no head visible, adults only", generar más alto (768×1216 o 1344×1024) y `recortar_arriba` 192/256 (CONTRATO §12, `tools/image-prompts.json`). `seed` aleatoria si no viene.
2. HTTP `POST {OLLAMA_URL}/api/generate` `{"model":OLLAMA_MODELO,"keep_alive":0}` (descarga la VRAM; `continueRegularOutput`).
3. HTTP `POST {SD_URL}/v1/images/generations` `{"prompt":"<p> <sd_cpp_extra_args>{\"seed\":N,\"sample_params\":{\"sample_steps\":8,\"sample_method\":\"euler\",\"scheduler\":\"simple\",\"guidance\":{\"txt_cfg\":1.0}}}</sd_cpp_extra_args>","n":1,"size":"WxH","output_format":"webp","output_compression":80}` (timeout 600 s) → Code `data[0].b64_json` → binario.
4. Edit Image `crop` (`positionY = recortar_arriba`) si corresponde.
5. Telegram `sendPhoto` (binario, `appendAttribution` no aplica) con caption "Imagen referencial generada con IA…" y teclado fijo Hero / Portada / Lookbook / Descartar (`dst:…`, `no:…`).
6. Recién con el `message_id` de la foto: `insert` `pb_borradores` (`entidad:"sitio"`, `op:"agregar_imagen"`, `preview_message_id`, `campos:{prompt,seed,size,objetivo,destino:null,alt}`, `faltantes:["destino"]`) + `pb_imagenes` (`origen:"ia_local"`). (Implementado así: sin borradores huérfanos si Telegram falla; el botón no puede llegar antes porque el lock lo tiene quien llamó a WF6.)
Salida: `{ok, draft_id}` + binario `data` (lo usa WF8).

### WF8 Panel-API (webhooks; ambos con `headerAuth` `pbCredHeader0001`, `allowedOrigins:"http://localhost:8080,http://127.0.0.1:8080"`, `responseMode:"responseNode"`)
- `POST /webhook/crear-imagen` body de admin.html `{prompt, prompt_usuario, tipo, personas, size, tamano_final, recortar_arriba, seed, objetivo?}` → Code valida (`prompt_usuario` 3–1200, se quitan `<>`; destinatario = primer `admin` con `id>0`, si no `dueno`) → bucle lock: tomar → IF no → Wait 5 s → hasta 10 min → si se agota: Respond **423** `{"ok":false,"error":"ocupado"}` → Execute WF6 (`origen:"panel"`; WF6 rehace el prompt y decide el recorte) → liberar lock → Respond `binary` (`image/webp`, ya recortada) con `X-Draft-Id`, `X-Telegram`, `X-Seed` (+ `Access-Control-Expose-Headers`). Error de WF6 → liberar + 502 (400 si el pedido es inválido) JSON con `siguiente_paso`. Detalle: `docs/N8N-WF6-WF8.md`.
- `GET /webhook/estado` → `{ok, ocupado (lock vigente), cola (inbox nuevo), aprobados, pausa, ultimo_commit_at, fallos_poller}`.
CORS no es autenticación: la clave sí. Patrón verificado en `reference/webhook-panel.json`.

### WF9 Errores
Error Trigger → Code: workflow, nodo y mensaje (≤200 chars) **censurados** → Leer config → límite 1 aviso/hora por `wf|nodo` (`ALERTAS`) → HTTP `sendMessage` a los `admin`: "Error en <WF> (nodo <nodo>): <msg>.\nSiguiente paso: si se repite, abre http://localhost:5678 → Executions." → `update` `pb_locks` `holder eq <execution.id fallida>` → `hasta=0`.

### v1.1 (no entran en v1)
WF7 Form-Admin (formulario de producto/artículo), WF10 Salud (expirar borradores > 24 h, reintentar inbox atascado, aviso de vencimiento del PAT con `GitHub-Authentication-Token-Expiration`, salud de Ollama/sd-server), `/articulo_editar`, comandos `sitio_datos` (horario, envío, redes, dirección), nuevos looks del lookbook, notas de voz, borrar imágenes huérfanas del repo.

## 7. Cadena D5 (GitHub Git Data API)

Cabeceras en todas: `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`; credencial `githubApi`. `REPO=Abnercayao/tienda-tarapoto`, `BRANCH=main`.

| # | Llamada | Uso |
|---|---|---|
| 1 | `GET https://api.github.com/repos/{REPO}/git/ref/heads/{BRANCH}` | `object.sha` = HEAD |
| 2 | `GET https://api.github.com/repos/{REPO}/git/commits/{HEAD}` | `tree.sha`; para `/deshacer`: `author.name=="Tienda Bot"` y `parents[0].sha` |
| 3 | `GET https://api.github.com/repos/{REPO}/contents/data/{products,articles,site}.json?ref={HEAD}` con `Accept: application/vnd.github.raw+json`, `responseFormat:"text"` | documentos actuales (en `/deshacer`, `?ref={parent}`) |
| 4 | Code "Aplicar lote" (bloque validar.js + aplicador CONTRATO §8) | salta `draft_id` ya en `borradores_aplicados`; `validar(docs,{anterior, idsLote, permitirLimpieza, rol})` |
| 5 | `POST https://api.github.com/repos/{REPO}/git/blobs` `{"content":"<b64 de pb_imagenes>","encoding":"base64"}` | `sha` → nombre `…-<sha[0:8]>.webp` (productos `assets/img/products/<slug>-<n>-<sha8>.webp`; hero `assets/img/brand/hero-<sha8>.webp`; portada `assets/img/blog/<slug>-<sha8>.webp`; look `assets/img/lookbook/<look-id>-<sha8>.webp`) |
| 6 | `POST https://api.github.com/repos/{REPO}/git/trees` `{"base_tree":TREE,"tree":[{"path":"data/products.json","mode":"100644","type":"blob","content":"<serializar(doc)>"},{"path":"<img>","mode":"100644","type":"blob","sha":"<blob>"}]}` | solo los JSON que cambiaron |
| 7 | `POST https://api.github.com/repos/{REPO}/git/commits` `{"message":"data(products): actualizar prd-0007 precio 69.90 [telegram draft:drf-…]","tree":NEW_TREE,"parents":[HEAD],"author":{"name":"Tienda Bot","email":COMMIT_EMAIL}}` | lote: primera línea resumen, una línea por borrador |
| 8 | `PATCH https://api.github.com/repos/{REPO}/git/refs/heads/{BRANCH}` `{"sha":NEW_COMMIT,"force":false}` | **422** (no fast-forward) → Wait 2–5 s aleatorio y volver a 1 (máx. 3) |

HTTP 3–8 con `fullResponse:true`, `neverError:true` y un Code que mira `statusCode`. Publicado = 200 en el paso 8; recién entonces se marcan los borradores.

## 8. Bot: comandos y textos

`setMyCommands` por rol (scope chat; lista única en `comandosDeRol()` de `n8n/src/nucleo/comun.js`, la usan WF0 y WF16). Todos: `ayuda, lista, ver, estado, historial, precio, stock, frescura, ocultar, mostrar, foto, articulo, articulo_ocultar, imagen, cancelar` y (v3) `envios, pedidos, pedido` (marketing sin datos de contacto). **admin y dueno** además: (v3) `preparando, enviar, recojo, entregado, cancelar_pedido, desconocidos, autorizar, desautorizar` y `borrar, whatsapp, limpiar_muestras, deshacer, pausa, reanudar`. **admin**: `ids`. Detalle v3: §12 y `docs/PEDIDOS.md`. Marketing que intenta uno prohibido recibe el texto de permiso (validar.js `PROHIBIDO_MARKETING`).

Textos base (HTML escapado; `<…>` = dato):

| Caso | Texto |
|---|---|
| Recibido | "Recibido, preparo el borrador (puede tardar hasta 1 min).\nSiguiente paso: espera la vista previa." |
| Vista previa | "Borrador <draft>: <op> <entidad> <id o 'nuevo'>\n<campo>: <antes> → <después> (sugerido por IA)\nAvisos: …\nSiguiente paso: toca Publicar si todo está bien, o Cancelar." |
| Faltan datos | "Me falta: <campos>. Respóndeme solo con eso (ej.: precio 59.90, tallas S M L).\nSiguiente paso: envía los datos que faltan." |
| Doble confirmación | "Vas a <acción exacta, p. ej. ELIMINAR prd-0007 'Camisa lino arena'>.\nSiguiente paso: toca Confirmar para aprobarlo o ignora este mensaje." |
| Aprobado | "Aprobado. Se publica en el próximo lote (máx. 6 min) y la web cambia 1–10 min después.\nSiguiente paso: nada; te aviso cuando esté publicado." |
| En pausa | "Aprobado, pero la publicación está en pausa.\nSiguiente paso: usa /reanudar para publicar." |
| Publicado | "Publicado: <resumen> (commit <sha7>). Se verá en 1–10 min: <SITIO_URL>\nSiguiente paso: revisa la web; si algo salió mal, usa /deshacer." |
| Cancelado | "Borrador cancelado; no se publicó nada.\nSiguiente paso: envía otro mensaje cuando quieras." |
| Sin permiso | "Tu rol (<rol>) no puede usar /<cmd>.\nSiguiente paso: pídeselo al dueño o al admin." |
| Borrador ajeno / no pendiente (alerta) | "Este borrador no es tuyo o ya no está pendiente. Siguiente paso: usa tus propios borradores." |
| Voz | "Aún no entiendo audios.\nSiguiente paso: escríbeme el mensaje o envía una foto." |
| Documento | "Recibí la imagen como archivo. Reenvíala como foto (así se borran los datos de ubicación).\nSiguiente paso: reenvíala como foto." |
| IA caída | "La IA local no responde. Copia y completa: nombre; categoria (hombres/mujeres/ninos/accesorios); precio; tallas; colores.\nSiguiente paso: envíame la plantilla llena." |
| Volví | "Volví (la PC estuvo apagada o sin internet). Tengo <N> mensajes pendientes y los proceso en orden.\nSiguiente paso: espera mis respuestas." |
| Comando desconocido | "No conozco ese comando.\nSiguiente paso: escribe /ayuda para ver la lista." |
| Error (WF9) | "Error en <WF> (nodo <nodo>): <mensaje corto>.\nSiguiente paso: si se repite, abre http://localhost:5678 → Executions." |

## 9. Importación y puesta en marcha (instancia real; fase P7)

1. Generar `n8n/workflows/*.json` (`node n8n/tools/construir-nucleo.js`, `construir-negocio-a.js`, `construir-negocio-b.js`; luego `node n8n/validar-workflows.js --estricto` y `node n8n/tools/probar-contenedor.js`) y comprobar: sin `pinData`, sin `meta.instanceId`, sin tokens (`git grep -nE "bot[0-9]+:|github_pat_|ghp_"`).
2. `node tools/limpiar-workflows.js` (quita los `id` de credencial del repo público, D14) y `node n8n/tools/preparar-importacion.js C:\Users\abner\n8n\data\import` (copias con el `id` fijo de la plantilla por tipo+nombre; montado como `/home/node/.n8n/import/`) → `node n8n/validar-workflows.js <copias> --estricto --con-id`.
3. **Solo la primera vez:** `docker exec -u node n8n n8n import:credentials --input=/home/node/.n8n/import/credenciales.plantilla.json` (nunca reimportar: pisaría los secretos).
4. `docker exec -u node n8n n8n import:workflow --separate --input=/home/node/.n8n/import/` → `n8n list:workflow`. Hecho el 2026-10-07 (9 workflows, sin publicar, credenciales enlazadas; respaldo `C:\Users\abner\backups\n8n-pre-import-20261007-0007\`). Pasos del usuario: `docs/N8N-PASOS-USUARIO.md`.
5. El usuario pega en la UI: token (credencial Telegram), PAT (credencial GitHub), clave del panel (credencial Header). Ejecuta WF0 una vez (crea tablas) y pega el token también en `pb_config.BOT_TOKEN`; vuelve a correr WF0.
6. Publicar en este orden: WF9, WF3, WF16, WF4, WF5, WF6, WF8, WF14, WF15, WF13, WF11, WF12, WF2, WF1 (UI, o `publish:workflow --id=…` + `docker restart n8n`). **Tras cada reimportación hay que volver a publicar todo.** v3: los sub-workflows (WF14, WF15, WF16) se publican antes que quien los llama.
7. Alta de usuarios: cada persona escribe `/start` → (v3) un admin o dueño usa `/desconocidos` y `/autorizar <id> dueno|marketing` + botón (efecto inmediato y menú publicado). `admin` solo a mano: `AUTORIZADOS` en `pb_config` → WF0.
8. Borrar `C:\Users\abner\n8n\data\import\`.

## 10. Referencias verificadas (`n8n/reference/`)

| Archivo | Qué prueba | Resultado real (contenedor desechable `n8n-arq`, 2.40.7) |
|---|---|---|
| `minimo.json` | Schedule 1.4 + Manual + Code 2 + HTTP 4.5 + Data Table (crear por nombre, upsert, lock con `lt`) + Telegram 1.2 (credencial `pbCredTelegram01`, teclado con expresiones) + Execute Workflow 1.3 → sub (trigger 1.2) | Importa con ids fijos; corriendo vía webhook: Code `{cryptoGlobal:"undefined", requireCrypto:"bloqueado", helpersHttp:{status:"ok"}}`, HTTP ok, tabla creada y reutilizada (mismo id en la 2.ª corrida), lock tomado (`holder`=id de ejecución), Telegram con token falso → `{"error":"Not Found"}` y sigue, sub → `{ok:true, recibidos:1}` |
| `patrones.json` | `rowNotExists`+`insert` (autoMap), IF 2.3, Switch 3.4 con fallback, Wait 1.1, Execute Workflow | 1.ª corrida inserta 3 filas; 2.ª no inserta nada; IF/Switch enrutan solo `texto` 102 al sub |
| `webhook-panel.json` | Webhook 2.1 headerAuth + allowedOrigins, Respond binario y JSON | sin clave 403, clave errónea 403, correcta 200 `image/png`; preflight 204 con origen permitido |
| `credenciales.plantilla.json` | Import de credenciales con ids fijos | 3 credenciales importadas, ids conservados, `data` cifrada |
| — | Lock ocupado y Edit Image | `update` sin coincidencias + `alwaysOutputData` → `[{}]`; PNG → `image/webp` (`magic WEBP`) |

Pendientes / incierto: calidad WebP real del Edit Image (oculta en UI); `sendPhoto` y `file get` con token real (no probado sin token); tiempos reales de Ollama con fotos; `answerCallbackQuery` tardío si WF1 se atrasa > 15 s.

## 11. Chat vendedor (WF11 + WF12, v2)

Detalle completo, contrato HTTP, reglas y pruebas: `docs/CHAT-VENDEDOR.md`. Generadores `node n8n/src/chat/construir-wf11.js` (código en `n8n/src/chat/wf11.js` + `comun-chat.js`, prompt en `n8n/prompts/vendedor.md`) y `node n8n/src/chat/construir-wf12.js` (código en `n8n/src/chat/wf12.js`).

| WF | id | Nombre en n8n | Disparador | settings extra |
|---|---|---|---|---|
| WF11 | `pbWf11ChatVend00` | PB WF11 Chat-Vendedor | Webhook `POST /webhook/chat-tienda` (sin clave; solo 127.0.0.1, lo llama `tools/chat-proxy.py`) | `executionTimeout:300` |
| WF12 | `pbWf12ChatUrl000` | PB WF12 Chat-URL | Webhook `POST /webhook/chat-url` (**headerAuth** `pbCredHeader0001`; lo llama `tools/iniciar-chat.ps1` desde esta PC) | `executionTimeout:120` |

- **Acceso público** (sin abrir n8n a internet): `tools/iniciar-chat.bat` → `tools/chat-proxy.py` (127.0.0.1:8787; solo `POST`/`OPTIONS /chat` → `/webhook/chat-tienda` y `GET /salud`; CORS, 4 KB, límites por IP) → `cloudflared tunnel --url http://127.0.0.1:8787` (quick tunnel, URL nueva cada vez) → WF12 escribe `data/chat.json` en GitHub. El túnel nunca apunta a 5678.
- **WF12**: `{url}` validada (`^https://[a-z0-9-]+\.trycloudflare\.com$` + `validar({chat})`) o `{activo:false}`; Contents API `GET` → si `url`/`activo` no cambiaron, **no hay commit**; si cambiaron, `PUT` con `sha` (404 = crear), autor **"Tienda Chat"** (no "Tienda Bot": `/historial` no lo lista), mensaje "chat: actualizar URL del túnel"; nunca force (ruleset). Sin lock `worker` (PUT atómico; un PATCH concurrente de WF5 recibe 422 y reintenta, D5). 409 de GitHub → 409 `{reintentar:true}` (el script reintenta 3 veces). Clave opcional de `pb_config`: `GITHUB_API_URL` (solo `api.github.com` o un simulador local en 127.0.0.1/localhost/host.docker.internal; pruebas). Efecto lateral: si el último commit de `main` es del chat, `/deshacer` no está disponible (solo revierte el HEAD del bot).

- **Tablas propias** (las crea WF11 con `createIfNotExists` en cada llamada; nombres sin subcadenas comunes con las de §4): `pb_citas`, `pb_chat_mensajes`, `pb_chat_aprendizaje` (columnas en `docs/CHAT-VENDEDOR.md`). Claves opcionales de `pb_config`: `CHAT_MODELO` (`llama3.1:8b`), `TELEGRAM_API_URL` (solo pruebas).
- **Sin lock `worker`**: el chat no espera a la GPU; Ollama se turna entre `qwen3.5:4b` (bot) y `llama3.1:8b` (chat). WF6 descarga ambos antes de sd-server. Timeout del chat 45 s → respaldo con WhatsApp (la web corta a los 60 s).
- **Patrones nuevos verificados [V]** (n8n 2.40.7 desechable, 2026-10-07): `respondToWebhook` deja pasar el ítem y los nodos siguientes corren DESPUÉS de responder (aprendizaje y aviso no demoran al visitante); `$getWorkflowStaticData('global')` en un Code persiste entre ejecuciones de producción (caché del catálogo 10 min); Telegram 1.2 `sendDocument` con `binaryData` envía multipart con nombre y `text/calendar` (`.ics`); la credencial `telegramApi` respeta `baseUrl` (Telegram simulado en pruebas); Data Table `upsert` con expresiones por ítem; `get` con `orderBy` `DESC` + `limit`.
- Errores → WF9 (`errorWorkflow`). Las ejecuciones con error guardan mensajes del visitante (igual que A10).

## 12. Pedidos y Mercado Pago (WF13–WF16, v3)

Detalle, flujo de pago, pasos del usuario y pruebas: `docs/PEDIDOS.md`. Generador `node n8n/src/pedidos/construir-pedidos.js` (código en `n8n/src/pedidos/wf13.js … wf16.js` + `comun-pedidos.js`; reglas del contrato v3 en el bloque de `tools/validar.js`: `crearPedido`, `preferenciaMercadoPago`, `aplicarPagoMP`, `transicionPedido`, `vistaPublicaPedido`).

| WF | id | Nombre en n8n | Disparador | settings extra |
|---|---|---|---|---|
| WF13 | `pbWf13PedCrear00` | PB WF13 Pedido-Crear | Webhook `POST /webhook/pedido-crear` (proxy `/pedido`) | `executionTimeout:90` |
| WF14 | `pbWf14MpNotif000` | PB WF14 MP-Notificacion | Webhooks `POST /webhook/mp-notificacion` (proxy `/mp-notificacion`) y `POST /webhook/pedido-pago` (proxy `/pedido/pago`) + Execute Workflow Trigger (WF16) | sub; `executionTimeout:120` |
| WF15 | `pbWf15PedSegui00` | PB WF15 Pedido-Seguimiento | Webhook `POST /webhook/pedido-seguimiento` (proxy `/seguimiento` y `/pedido/consultar`) + Execute Workflow Trigger (WF11) | sub; `executionTimeout:30` |
| WF16 | `pbWf16PedBot0000` | PB WF16 Pedidos-Bot | Execute Workflow Trigger (WF4) | sub; `executionTimeout:120` |

- **Número correlativo atómico**: `UPDATE pb_config SET valor=<siguiente> WHERE clave=PEDIDO_ULTIMO AND valor=<actual>` (si otro pedido ganó, 503 "vuelve a intentarlo"); además nunca por debajo del último de `pb_pedidos`. El primero es `PB-000101` (`siguienteNumeroPedido`).
- **Precios y stock**: WF13 lee `data/products.json` y `site.json` **publicados** (`CATALOGO_URL`, por defecto `SITIO_URL`; caché 60 s) y recalcula todo con `crearPedido` (revisión con el número de prueba `PB-999999` para no gastar números). El precio del navegador se ignora (`total_visto` distinto → aviso `aviso_total`).
- **Mercado Pago**: `POST {MP_API_URL}/checkout/preferences` con `X-Idempotency-Key` = número; `MP_API_URL` solo acepta `https://api.mercadopago.com` o un simulador local (el token no puede salir a otro host; `n8n/validar-workflows.js` además exige que la credencial solo se use con esa URL). 401/403 o token inválido = credencial con placeholder → **pago simulado** marcado (`simulado:true`, `preference_id` `SIM-…`, `init_point` = vuelta a la web con `payment_id=SIMULADO`). `MP_MODO=simulado` lo fuerza.
- **Confirmación**: solo `GET /v1/payments/{id}` (o `/v1/payments/search?external_reference=`) con la credencial. `x-signature` (HMAC-SHA256 en JS puro, probado contra Node crypto) solo si `pb_config.MP_WEBHOOK_SECRET`. Guardado con `UPDATE … WHERE numero AND actualizado=<previo>`: aviso y vuelta de la web simultáneos → un solo Telegram y un solo descuento de stock.
- **Stock**: al pagarse, un borrador `stock` (modo `restar`, rol `dueno`, origen `pedido`, estado `aprobado`) por producto en `pb_borradores`; WF2 → WF5 lo publica en el siguiente lote como cualquier cambio aprobado (commit `data(products): stock … [pedido draft:…]`). Si el stock ya no alcanza, WF5 lo marca `error` y avisa al primer admin/dueño (`chat_id` del borrador).
- **Webhooks y Respond to Webhook [V]**: un Webhook en `onReceived` que alcanza un Respond to Webhook hace fallar la ejecución ("Unused Respond to Webhook node"); por eso el aviso de MP usa `responseNode` y su propio `Responder MP` (200 inmediato) antes de procesar. `n8n/validar-workflows.js` lo comprueba. También admite Webhook(s) + **un** Execute Workflow Trigger en el mismo workflow (WF14, WF15).
- **Bot**: WF2 manda los botones `ped:`/`usr:` como comando `boton_pedidos` a WF4 → WF16 (el resto de botones sigue yendo a WF5). WF16 recalcula el rol de quien toca; `/autorizar` y `/desautorizar` cambian `AUTORIZADOS` con `UPDATE … WHERE valor=<previo>` y publican el menú (`setMyCommands`/`deleteMyCommands`) de esa persona; nunca `admin`, nunca uno mismo.
- **Proxy** (`tools/chat-proxy.py`): allowlist exacta `/chat`, `/pedido`, `/seguimiento`, `/pedido/consultar`, `/pedido/pago` (CORS de la web), `/mp-notificacion` y `/mp/notificacion` (sin CORS: Origin de navegador → 403; solo pasan `data.id/type/topic/id/source_news` y `x-signature/x-request-id`). JSON ≤ 8 KB, límites por IP y cupos separados del chat (la GPU no frena los pedidos).
