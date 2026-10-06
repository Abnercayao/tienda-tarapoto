**Resumen:** casi seguro el usuario se refiere a la **app de escritorio de Open Generative AI**, y **ya la tiene instalada y configurada**. No hace falta descargar nada nuevo. Lo único pendiente sería, si quiere, actualizarla de v1.0.9 a v2.0.0. No descargué ni instalé nada y no toqué contenedores.

## 1. Lo que ya hay en la PC (comprobado con lectura de solo lectura)

- **Open Generative AI v1.0.9** está instalada en `C:\Program Files\Open Generative AI\Open Generative AI.exe` y tiene acceso directo en el menú Inicio.
  - El instalador sigue en `%LOCALAPPDATA%\open-generative-ai-updater\installer.exe`. Pesa 134.290.480 bytes, el mismo tamaño que el `.exe` oficial de v1.0.9.
  - Tiene datos de uso de hoy (05/10/2026).
- **Generación local de imágenes ya preparada** en `%APPDATA%\open-generative-ai\local-ai\`:
  - Hay binarios del motor sd.cpp con soporte CUDA, entre ellos `sd-server.exe`.
  - Están descargados los modelos `z_image_turbo-Q4_K.gguf` (3,9 GB), `Qwen3-4B…gguf` (3,7 GB) y `ae.safetensors`.
  - Existe una carpeta `bin-backup` y `sd-cli.exe` pesa solo 5 KB (un intermediario; el motor real es `sd-cli-real.exe`). Parece que alguien ya estuvo resolviendo problemas ahí.
- **Wan2GP está instalado en `C:\AI\Wan2GP`**, con su entorno de Python, 55,6 GB de modelos y 2 videos de prueba del 28/09.
  - La app ya está configurada para usarlo: `wan2gp.json` apunta a `http://127.0.0.1:7860`.
  - Ahora mismo **no está corriendo**: el puerto 7860 no escucha.
  - `Desktop\wan2gp-pip.txt` es el registro de `pip install` de Wan2GP. El final del archivo se corta mientras desinstalaba numpy, así que **no sé si esa instalación terminó bien**.
- **Hardware:** tarjeta RTX 5060 Ti con 8 GB de VRAM y 32 GB de RAM.
- **Otras herramientas:**
  - `cloudflared` 2026.7.3 está instalado. Sirve para crear un túnel HTTPS hacia n8n, que Telegram necesita.
  - Claude Desktop está instalado.
  - No están instalados Telegram Desktop, GitHub Desktop, Pinokio ni Antigravity.
- **n8n** escucha en el puerto 5678.

## 2. Candidatos

| Candidato | Qué hace | Descarga oficial | Tamaño | ¿Gratis? | Relevancia |
|---|---|---|---|---|---|
| **Open Generative AI (Windows)** | Estudio de imagen, video y lip-sync. Usa la nube (Muapi.ai, pago por generación) o motores locales (sd.cpp incluido; Wan2GP como servidor aparte). | github.com/Anil-matcha/Open-Generative-AI/releases (última: **v2.0.0, 23/05/2026**, `Open.Generative.AI.Setup.2.0.0.exe`) | 134 MB | Sí, licencia MIT. La API key de Muapi es opcional si solo se usan modelos locales. | **Muy alta, y ya está instalada (v1.0.9).** v2.0.0 añade Audio Studio, Design Agent, carpeta de modelos configurable y mejoras para Wan2GP. No documenta API HTTP, enlaces profundos ni línea de comandos para dispararla desde fuera. |
| **n8n Desktop** | Antes permitía correr n8n sin Docker. | github.com/n8n-io/n8n-desktop-app | n/d | Sí | **Ninguna.** Quedó obsoleta en mayo de 2023 y el repositorio está archivado desde el 15/08/2025. Docker, que el usuario ya usa, es la vía recomendada. |
| **Google Antigravity 2.0** | App de escritorio de Google para orquestar agentes en paralelo y tareas programadas. Desde la v2.0 (I/O, 19/05/2026) ya no es un editor de código; trae además el CLI `agy`. Sigue habiendo un "Antigravity IDE" aparte. | antigravity.google/download (v2.19.1, x64 y ARM64) | ~229 MB según fuentes no oficiales (**no verificado**) | Hay plan gratuito con límites semanales. Los planes Google AI Pro y Ultra son de pago. | **Media-baja.** Es otro agente de programación como Claude Code. Funciona con modelos de Google en la nube, así que **no es "todo local"**. No conecta n8n con Telegram. |
| **antigravity-awesome-skills** | Catálogo de más de 2.400 "skills" (archivos `SKILL.md`) para Claude Code, Antigravity, Cursor, Gemini CLI y otros. **Cambió de nombre a `sickn33/agentic-awesome-skills`**. | github.com/sickn33/agentic-awesome-skills. Se instala con `npx agentic-awesome-skills --<herramienta>`. | Repositorio de ~255 MB; se instala solo lo elegido. | Sí, MIT (unas 47 mil estrellas). | **Media.** Incluye paquetes "Web App Builder", "Product Design Studio" y otro de SEO que sirven para el diseño de la web. No es una app de escritorio. El propio repositorio dice que su validación no garantiza calidad ni seguridad, así que conviene revisar cada skill antes de instalarla. |
| Telegram Desktop (extra) | Cliente oficial de Telegram. | desktop.telegram.org / GitHub tdesktop v7.2.9 | 55,7 MB | Sí | Baja. El bot se crea con @BotFather también desde el móvil. |
| Pinokio (extra) | "Navegador" que instala apps de IA locales con un clic (Wan2GP, ComfyUI…). | pinokio.co / GitHub v8.2.0 | 131 MB | Sí | Baja. Wan2GP ya está instalado a mano. |

## 3. Notas técnicas que importan para el proyecto

- **Telegram y n8n local:** el disparador de Telegram en n8n funciona por webhook, y Telegram exige una URL **HTTPS pública**.
  - Opción 1: un túnel con `cloudflared`, que ya está instalado. Eso obliga a fijar `WEBHOOK_URL` en el contenedor, lo que significa recrearlo.
  - Opción 2: consultar a Telegram cada cierto tiempo con `getUpdates` desde un nodo HTTP programado, sin túnel.
- **Botón "Crear imágenes" en la web:** una página en GitHub Pages no puede controlar la app de escritorio, porque no tiene API.
  - Una opción realista es un botón que abra `http://127.0.0.1:7860` (Wan2GP) o `sd-server` en el puerto 1234. Solo funciona en la PC del dueño.
  - Otra es que n8n llame directamente a esos servidores locales. `sd-server` ofrece API compatible con OpenAI (`/v1/...`) y con A1111 (`/sdapi/v1/...`).
  - Ninguno de los dos documenta CORS, y no lo probé.

## 4. Interpretación más probable

"Una app de escritorio que permite eso" = la **app de escritorio de Open Generative AI**, para generar imágenes en local. Las pistas lo confirman: está instalada desde el 28/09, Wan2GP quedó conectado y existe `wan2gp-pip.txt`. Lo de "antigravity" probablemente se refiere a las **skills** ("habilidades") del repositorio antigravity-awesome-skills, no a la app de Google. No existe ninguna app de escritorio oficial que una n8n con Telegram; eso se resuelve dentro de n8n.

## 5. Preguntas para el usuario

1. ¿La app que mencionas es **Open Generative AI**? Ya la tienes instalada (v1.0.9). ¿Quieres actualizarla a la v2.0.0 (134 MB)?
2. ¿Usas los modelos **locales** (Z-Image con sd.cpp, Wan2GP) o también la nube de Muapi, que es de pago?
3. ¿Terminó bien la instalación de Wan2GP (el registro se corta) y cómo lo arrancas?
4. El botón de la web, ¿solo debe **abrir** la herramienta en tu PC o debe **generar y publicar** imágenes automáticamente (por ejemplo, Telegram → n8n → sd-server → web)?
5. Con "antigravity", ¿te refieres al **repositorio de skills** o a la **app de Google** (agente en la nube, no 100 % local)?
6. Para Telegram, ¿aceptas un túnel Cloudflare, que implica recrear el contenedor de n8n con `WEBHOOK_URL`, o prefieres el modo de consulta periódica sin túnel?

## Fuentes
- https://github.com/Anil-matcha/Open-Generative-AI y https://api.github.com/repos/Anil-matcha/Open-Generative-AI/releases
- https://github.com/Anil-matcha/Open-Generative-AI/releases/tag/v2.0.0
- https://justbeingresourceful.com/2026/08/25/open-generative-ai-the-self-hosted-studio-with-400-models-flux-midjourney-kling-sora-veo/
- https://github.com/leejet/stable-diffusion.cpp/blob/master/examples/server/README.md
- https://github.com/n8n-io/n8n-desktop-app y https://nordflux.de/en/guides/test-n8n-locally-npm-vs-docker-vs-desktop-app
- https://antigravity.google/download y https://antigravity.google/pricing
- https://mcp.directory/blog/antigravity-2-launch-google-io-2026 y https://www.analyticsvidhya.com/blog/2026/05/google-antigravity-2-0/
- https://itecsonline.com/post/antigravity-setup-guide (tamaño ~229 MB, no oficial)
- https://github.com/sickn33/agentic-awesome-skills (antes antigravity-awesome-skills)
- https://www.ionos.com/digitalguide/server/configuration/n8n-telegram.md y https://pinggy.io/blog/n8n_telegram_integration_with_pinggy/
- https://api.github.com/repos/telegramdesktop/tdesktop/releases/latest y https://api.github.com/repos/pinokiocomputer/pinokio/releases/latest

Archivos y rutas mencionados: `C:\Program Files\Open Generative AI\Open Generative AI.exe`, `C:\Users\abner\AppData\Roaming\open-generative-ai\local-ai\wan2gp.json`, `C:\Users\abner\AppData\Roaming\open-generative-ai\local-ai\bin\sd-server.exe`, `C:\AI\Wan2GP\wgp.py`, `C:\Users\abner\Desktop\wan2gp-pip.txt`, `C:\Program Files (x86)\cloudflared\cloudflared.exe`.