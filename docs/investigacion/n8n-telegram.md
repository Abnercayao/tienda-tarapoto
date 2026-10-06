**Integración n8n (Docker local) + Telegram + GitHub Pages para la tienda de ropa de Tarapoto**

Recomiendo **polling (consulta periódica) con Schedule Trigger + getUpdates**: no necesita dominio, ni túnel, ni abrir puertos. Las publicaciones van por la **GitHub Contents API** con un token fine-grained limitado al repo. Para la IA, **Ollama local con qwen3.5:4b** (lee texto y fotos). La IA solo arma un borrador en JSON. Nada se publica sin que el dueño toque el botón "Publicar" en Telegram.

---

## (a) Estado actual (todo verificado en solo lectura)

| Elemento | Valor |
|---|---|
| Imagen | `docker.n8n.io/n8nio/n8n` (tag latest), **n8n 2.40.7**, Node v26.7.0, imagen del 2026-09-25 |
| Variables de entorno | Solo `GENERIC_TIMEZONE` y `TZ=America/Lima`. **No hay `WEBHOOK_URL`** ni otras `N8N_*` |
| Volumen | bind `C:\Users\abner\n8n\data` → `/home/node/.n8n` (SQLite `database.sqlite` + WAL; el archivo `config` guarda la clave de cifrado) |
| Restart / puerto | `unless-stopped` / `0.0.0.0:5678`, o sea, **visible desde la red local** |
| Salud | `/healthz` y `/healthz/readiness` → `{"status":"ok"}`. El contenedor llevaba "Up 8 minutes", así que se reinició hace poco |
| Workflows | 1 workflow: "My workflow" (id `KDAz4EKuKCC7jdC7`) |
| Dentro del contenedor | Están `git` y `gm` (GraphicsMagick, así que el nodo Edit Image funciona). Nodos instalados: Telegram (con aprobación desde el chat), Github, DataTable, EditImage, HttpRequest, Ollama (con "Analyze Image"), LMChatOllama (con opciones `think`, `numCtx`, `keepAlive`). El AI Agent puede pasarle imágenes al modelo directamente |
| PC | RTX 5060 Ti **8 GB** (driver 617.14), 32 GB de RAM, 270 GB libres en C:. `cloudflared` 2026.7.3 está instalado pero nunca se configuró (no hay servicio ni `~/.cloudflared`). Ollama y ngrok **no** están instalados |
| Red | Desde el contenedor, `http://host.docker.internal:<puerto>` **sí llega a servicios del PC que solo escuchan en 127.0.0.1**. Lo probé con un servidor temporal. Ollama funcionaría con su configuración por defecto, sin `OLLAMA_HOST=0.0.0.0` |

Sin `WEBHOOK_URL` en HTTPS, el nodo Telegram Trigger falla con "bad webhook: An HTTPS URL must be provided".

## (b) Cómo recibir los mensajes de Telegram con n8n local

| Opción | URL estable | Requisitos | Problemas |
|---|---|---|---|
| `n8n --tunnel` | — | — | **Eliminado en n8n 2.0.** Tu versión es 2.40.7, así que no existe |
| Cloudflare quick tunnel | No, cambia en cada arranque | Ninguno | Sin garantía de funcionamiento, "solo para pruebas". Habría que recrear el contenedor con un `WEBHOOK_URL` nuevo cada vez. Expone toda la interfaz de n8n |
| Cloudflare named tunnel | Sí | Cuenta de Cloudflare y **un dominio propio** en Cloudflare | La más sólida si se usa webhook. Se instala como servicio de Windows y se puede limitar a las rutas `/webhook*`. Cuesta el dominio |
| ngrok, dominio estático gratis | Sí (`*.ngrok-free.app`/`.dev`) | Cuenta gratis y el agente ngrok corriendo | Límite de 20 000 peticiones y 1 GB al mes. El aviso que ngrok muestra a navegadores no afecta las llamadas de la API. Expone n8n salvo que se configure una política de tráfico |
| **Polling con getUpdates (recomendada)** | No hace falta | Ninguno | Solo hay conexiones salientes a api.telegram.org: nada expuesto y funciona aunque cambie la IP. Tarda lo que dure el intervalo (unos 10 s). **No se pueden usar** el Telegram Trigger ni "Send and Wait / Approve Within Chat": la aprobación dentro del chat de n8n hace `setWebhook` y necesita HTTPS (lo verifiqué en el código `hitl/setup.ts`). Webhook y getUpdates son excluyentes, así que ningún nodo debe registrar un webhook. Telegram guarda los mensajes pendientes **24 h**: si el PC está apagado menos de eso, se procesan al volver |

Por qué recomiendo el polling: cumple "todo local", no expone la interfaz de n8n y no exige cambiar el contenedor. Si más adelante quieren el Trigger nativo o la aprobación nativa dentro del chat, pasaría a ngrok con dominio estático o a un named tunnel con dominio, más `WEBHOOK_URL=https://...` y `N8N_PROXY_HOPS=1`.

### Workflow "TG-Poller"

1. **Schedule Trigger**: cada 10 segundos.
2. **HTTP Request** `getUpdates`:
   - `GET https://api.telegram.org/bot<TOKEN>/getUpdates?timeout=0&limit=20&allowed_updates=["message","callback_query"]`
   - El token va en la URL. La credencial `telegramApi` no tiene `authenticate` (lo verifiqué en el código) y `$vars` no existe en la edición Community.
3. **IF**: continúa solo si `{{$json.result.length > 0}}`.
4. **HTTP Request** de confirmación (ACK), **antes** de procesar nada:
   - `getUpdates?offset={{ $json.result.at(-1).update_id + 1 }}&limit=1&timeout=0`
   - Esto marca como leídos todos los mensajes ≤ N sin guardar ningún estado. Así se evitan duplicados aunque dos ejecuciones se solapen.
   - Regla de la API: "An update is considered confirmed as soon as getUpdates is called with an offset higher than its update_id."
5. **Split Out** sobre `result`, y luego un **filtro de dueño**: `{{ ($json.message?.from?.id ?? $json.callback_query?.from?.id) == OWNER_ID }}`. Lo demás se ignora en silencio.
6. **Switch**:
   - `callback_query` → Execute Workflow "Publicar"
   - texto que empieza con `/` → "Comandos" (`/lista`, `/borrar <id>`, `/precio <id> <n>`, `/limpiar_muestras`)
   - foto o texto libre → "Agente"
7. Ajustes del workflow:
   - "Save successful production executions: Do not save" (a 10 s son 8 640 ejecuciones al día).
   - Un Error Workflow que avise al dueño por Telegram.

Configuración única:
- En @BotFather: `/newbot`, y `/setjoingroups` → Disable.
- Llamar una vez a `deleteWebhook`.
- El dueño escribe `/start` al bot y se lee su `from.id` con `getUpdates`.
- Como alternativa con menos espera: Schedule cada 30 s con `timeout=25` (long polling).

## (c) Cómo se actualiza la web estática

Estructura del repo:
- `data/products.json` y `data/posts.json`
- `assets/products/<id>.jpg`
- `.nojekyll`
- El JS de la web hace `fetch('data/products.json?v='+Date.now())` y pinta todo con `textContent`, nunca `innerHTML`, para evitar inyección de código.

Usar el **nodo GitHub** (credencial `githubApi`). Lo verifiqué en el código:
- File Create/Edit aceptan **binario** (`binaryData`).
- **Edit y Delete obtienen el `sha` solos** (`getFileSha`).

Workflow "Publicar" (lo dispara el callback `pub:<draftId>`):
1. `answerCallbackQuery`. Leer el borrador en la **Data Table** "borradores" y comprobar que su estado sea `pendiente` (si ya está publicado, no hace nada).
2. Si hay foto: Telegram **Get File** (Download activado, con el `file_id` guardado) → **Edit Image** (redimensionar a 1200 px, JPEG con calidad 80) → GitHub **File Create** `assets/products/{{id}}.jpg` (Binary).
3. GitHub **File Get** `data/products.json` (como binario) → **Extract from File (JSON)** → Code: agregar, modificar o borrar el producto y validar → GitHub **File Edit** con contenido `{{JSON.stringify($json.catalog,null,2)}}` y mensaje de commit `bot: crear <nombre>`. Activar Retry On Fail ×3.
4. Marcar el borrador como `publicado` y editar el mensaje en Telegram: "Publicado, se verá en 1–10 min: https://abnercayao.github.io/<repo>/".

Equivalente sin el nodo GitHub:
- `PUT https://api.github.com/repos/Abnercayao/<repo>/contents/data/products.json`
- Cabeceras: `Authorization: Bearer <PAT>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`
- Cuerpo: `{message, content(base64), sha, branch:"main"}`
- El `sha` es obligatorio al modificar. PUT y DELETE deben ir **en serie**: en paralelo dan conflicto.

Tiempos y límites de GitHub Pages:
- La documentación dice que un cambio tarda "**up to 10 minutes**" en publicarse.
- Comprobé la cabecera `Cache-Control: max-age=600` en GitHub Pages; por eso hay que pedir el JSON con `?v=` para saltarse la caché.
- Límite blando de **10 builds por hora** cuando se publica desde una rama, y cada commit dispara un build. Para cargas grandes conviene:
  - un comando `/publicar` que junte varios borradores en un solo commit con la Git Data API (blobs → tree → commit → ref), o
  - un workflow propio de GitHub Actions para Pages, al que ese límite no aplica.

Token (https://github.com/settings/personal-access-tokens/new):
- Fine-grained, "Only select repositories" con solo el repo de la tienda.
- **Contents: Read and write**. Metadata: Read-only se añade sola. Opcional: Pages: Read, para consultar `pages/builds/latest`.
- En la credencial de n8n: Server `https://api.github.com`, User `Abnercayao`, Access Token.
- La documentación de n8n recomienda el token *classic*, pero las operaciones de archivos solo necesitan Contents, así que el fine-grained alcanza.

## (d) Modelo de IA: local con Ollama

Con 8 GB de VRAM (versiones según ollama.com, octubre 2026):

| Modelo | Tamaño | Visión | Llamada a herramientas | Notas |
|---|---|---|---|---|
| **qwen3.5:4b** (recomendado) | 3,3–4,0 GB | Sí | Sí | Un solo modelo para texto y fotos. Deja VRAM libre para generar imágenes |
| qwen3.5:9b | 6,6–7,6 GB | Sí | Sí | Mejor calidad, pero llena casi toda la VRAM |
| qwen3-vl:8b | 6,1 GB | Sí | Sí | Requiere Ollama ≥ 0.12.7 |
| ministral-3:8b | 6,0 GB | Sí | Sí | Buen español |
| gemma4:e4b | 6,6–9,5 GB | Sí | Sí | |
| qwen3:8b | 5,2 GB | No (solo texto) | Sí | |

Configuración en n8n:
- Credencial Ollama: `baseUrl = http://host.docker.internal:11434`.
- En el nodo Ollama Chat Model: `think: false`, `numCtx: 8192` (Ollama usa 4096 por defecto) y `keepAlive` corto, o `0` antes de generar imágenes, porque la GPU se comparte con Open Generative AI o Wan2GP.

Flujo del "Agente":
1. Si llega una foto: tomar el `photo[]` más grande (el último) → Telegram Get File → AI Agent con "Automatically Passthrough Binary Images". Otra opción es el nodo Ollama → Analyze Image.
2. AI Agent (Ollama Chat Model, Simple Memory con el chat_id como clave, Max Iterations 5) con **Structured Output Parser**. Devuelve `{accion, id?, nombre, categoria: hombres|mujeres|ninos, tipo, precio_pen, tallas[], colores[], material, descripcion, etiquetas[]}`. Su única herramienta es "leer catálogo" (de solo lectura).
3. Un Code node valida los datos → se inserta el borrador en la Data Table → Telegram envía la vista previa con botones "Publicar" (`pub:<id>`) y "Cancelar" (`no:<id>`). El `callback_data` admite como máximo 64 bytes.

El LLM **nunca** escribe en GitHub: eso lo hacen nodos fijos del workflow. Así un modelo pequeño no puede romper el catálogo. Los artículos del blog siguen el mismo esquema (`/articulo <tema>` → borrador → confirmar → `posts.json`). Si se prefiere la nube (Gemini, OpenAI o Anthropic) basta cambiar el sub-nodo de modelo, pero ya no sería todo local.

Instalación de Ollama (pendiente, **no la hice**): https://ollama.com/download/windows (pide driver NVIDIA ≥ 551.61; el tuyo cumple) → `ollama pull qwen3.5:4b` → comprobar con `docker exec n8n wget -qO- http://host.docker.internal:11434/api/tags`.

## (e) Seguridad

- Filtrar **siempre** por el `from.id` del dueño, en los mensajes y también en los callbacks. El bot es público aunque nadie lo anuncie.
- Confirmación obligatoria con botón, borradores que solo se publican una vez, y validación de precio, tamaño de los textos y categorías permitidas.
- Los secretos solo van en credenciales de n8n, cifradas con la clave del archivo `config`. La excepción es el token de Telegram en la URL del poller: no compartir ese workflow exportado. Desde n8n 2.0, `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` impide leer variables de entorno desde los nodos.
- El repo tiene que ser público para usar Pages gratis, así que nunca se suben secretos.
- Al próximo recreado del contenedor (no lo hice), conviene:
  - fijar la versión `:2.40.7`
  - usar `-p 127.0.0.1:5678:5678`
  - hacer antes una copia de `C:\Users\abner\n8n\data` con el contenedor detenido
  - recrearlo con `docker rename n8n n8n-old` + `docker run ... -v C:\Users\abner\n8n\data:/home/node/.n8n`, para poder volver atrás.

## (f) Importar workflows y crear credenciales

- **Desde la interfaz:** en el editor, menú "…" → Import from File o Import from URL, o pegar el JSON con Ctrl+V. Luego asignar las credenciales en cada nodo y pulsar **Publish** (en n8n 2.x "activar" se llama "publicar").
- **Por línea de comandos**, usando la carpeta montada:
  ```
  New-Item -ItemType Directory -Force C:\Users\abner\n8n\data\import
  docker exec -u node n8n n8n import:workflow --separate --input=/home/node/.n8n/import/
  docker exec -u node n8n n8n list:workflow
  ```
  Lo importado queda sin publicar. Según la documentación, `publish:workflow --id=<ID>` con n8n en marcha necesita reiniciar, así que es mejor publicar desde la interfaz o con la API. Si el ID ya existe, se sobrescribe.
- **Credenciales con la API pública** (en esta instancia confirmé `/api/v1/credentials`, `/credentials/schema/{tipo}`, `/workflows` y `/workflows/{id}/publish`):
  1. Crear una API key en Settings → n8n API.
  2. `GET /api/v1/credentials/schema/telegramApi` para ver qué campos pide.
  3. `POST /api/v1/credentials` con cabecera `X-N8N-API-KEY`:
     - `{"name":"Telegram Tienda","type":"telegramApi","data":{"accessToken":"…","baseUrl":"https://api.telegram.org"}}`
     - `{"type":"githubApi","data":{"server":"https://api.github.com","user":"Abnercayao","accessToken":"github_pat_…"}}`
     - `{"type":"ollamaApi","data":{"baseUrl":"http://host.docker.internal:11434"}}`
  4. Poner esos IDs de credencial en el JSON del workflow → `POST /api/v1/workflows` → `POST /api/v1/workflows/{id}/publish`. Así todo queda automatizado.
- Otra vía de automatización: el servidor MCP propio de n8n (desde 2.13 permite crear y editar workflows) para que Claude Code arme los workflows directamente. No verifiqué la ruta del endpoint ni el tipo de token.

## Pendiente de confirmar

- Qué tan bien llama herramientas y escribe en español qwen3.5:4b dentro de n8n: hay que probarlo con 10–20 mensajes reales.
- El tiempo real de despliegue en Pages: la documentación dice hasta 10 min; no medí ninguno.
- Si el límite blando de 10 builds por hora descarta builds o solo los pone en cola.
- Si `import:credentials` cifra datos en texto plano: no lo verifiqué, mejor usar la interfaz o la API.
- Las condiciones de GitHub Pages prohíben sitios "primarily directed at facilitating commercial transactions". Un catálogo con botón de WhatsApp, sin pago en el sitio, probablemente es aceptable, pero no es seguro. Netlify o Cloudflare Pages son alternativas.
- Si "Open Generative AI" tiene una API local que n8n pueda llamar por `host.docker.internal`: no lo investigué.

**Fuentes:**
- https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.telegramtrigger/common-issues/
- https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.telegramtrigger/
- https://docs.n8n.io/changelog/v20-breaking-changes
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/
- https://ngrok.com/docs/pricing-limits/free-plan-limits.md
- https://core.telegram.org/bots/api#getupdates
- https://core.telegram.org/bots/api#getting-updates
- https://docs.github.com/en/rest/repos/contents
- https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
- https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.github/
- https://docs.n8n.io/integrations/builtin/credentials/github/
- https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Github/Github.node.ts
- https://github.com/n8n-io/n8n/tree/master/packages/nodes-base/nodes/Telegram/hitl
- https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.telegram/message-operations.md
- https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.telegram/file-operations.md
- https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools.md
- https://docs.n8n.io/build/work-with-data/data-tables.md
- https://docs.n8n.io/deploy/host-n8n/configure-n8n/use-the-command-line.md
- https://docs.n8n.io/build/manage-workflows/export-and-import.md
- https://docs.n8n.io/build/ways-of-building-workflows/connect-to-n8n-mcp-server.md
- https://docs.n8n.io/integrations/builtin/credentials/ollama/
- https://docs.ollama.com/faq
- https://docs.ollama.com/windows
- https://ollama.com/library/qwen3.5
- https://ollama.com/library/qwen3-vl
- https://ollama.com/library/gemma4
- https://ollama.com/library/ministral-3
- https://ollama.com/search?c=tools&c=vision
- https://community.n8n.io/t/telegram-without-webhook-by-polling/107101
- https://docs.n8n.io/deploy/host-n8n/community-edition-features/

No escribí archivos fuera del scratchpad. Los únicos temporales (`/tmp/oa.yml` y `/tmp/apiref.md`) ya están borrados.