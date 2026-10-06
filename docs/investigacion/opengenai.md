## Open Generative AI: hallazgos verificados

**Resumen:** Open Generative AI ya está instalado en tu PC (v1.0.9) y genera imágenes en local, sin API keys. Pero no se puede manejar desde un botón web ni desde n8n: no tiene API HTTP, ni protocolo de enlace, ni acepta el prompt por URL. Lo que sí sirve es el **`sd-server.exe` que la misma app ya trae** (stable-diffusion.cpp). Se usa con los mismos modelos y tiene una API HTTP local con CORS. Ese debería ser el motor del botón.

### 1. Qué es (repo verificado)
- **Repo:** `Anil-matcha/Open-Generative-AI`. Licencia MIT, unas 29.7k estrellas, último push el 2026-10-03. Es un "estudio" Electron + Next.js que se presenta como alternativa a Higgsfield.
- **Modo nube (por defecto):** más de 400 modelos a través de **Muapi.ai**. Necesita una API key (`x-api-key`) que se guarda en el `localStorage` de la app.
- **Modo local (solo en la app de escritorio):**
  - Motor **sd.cpp**, incluido en la app: Z-Image Turbo/Base, SD1.5, SDXL.
  - Motor **Wan2GP**, que es un servidor Gradio externo que pones tú.
  - El README dice textualmente: "no API key needed" para los modelos locales.
- **Descargas en GitHub Releases:**
  - Última versión: **v2.0.0** (2026-05-23). Asset de Windows: `Open.Generative.AI.Setup.2.0.0.exe`, 134,225,080 bytes (≈128 MB). URL: https://github.com/Anil-matcha/Open-Generative-AI/releases/download/v2.0.0/Open.Generative.AI.Setup.2.0.0.exe
  - La que tienes instalada es la **1.0.9**: `Open.Generative.AI.Setup.1.0.9.exe`, 134,290,480 bytes. Coincide byte a byte con `%LOCALAPPDATA%\open-generative-ai-updater\installer.exe`.
- **Prompt por URL o API:** **no tiene ninguna de las dos.**
  - Revisé `app.asar` → `electron/main.js` y `preload.js`. Solo usa IPC de Electron (`window.localAI.generate`). No hay servidor HTTP, ni `setAsDefaultProtocolClient`, ni lectura de `URLSearchParams` en el bundle.
  - En la rama `main` actual (v2.x) tampoco aparece.
  - Cada generación lanza `sd-cli.exe` como proceso aparte.

### 2. Lo que ya hay en tu PC
- **App instalada:** `C:\Program Files\Open Generative AI\` (v1.0.9).
- **Modelos ya descargados** en `%APPDATA%\open-generative-ai\local-ai\models\`:
  - `z_image_turbo-Q4_K.gguf` (3.9 GB)
  - `Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf` (3.7 GB)
  - `ae.safetensors`
- **Binarios** en `local-ai\bin\`:
  - `sd-server.exe`, de stable-diffusion.cpp, commit 3f8527a del 2026-09-27.
  - `ggml-cuda.dll` compilado para sm_120a (Blackwell), además de `ggml-vulkan.dll`.
  - Un `sd-cli.exe` de 5 KB que no es el original: es un wrapper .NET que llama a `sd-cli-real.exe` añadiendo `--offload-to-cpu --diffusion-fa --vae-tiling` para que entre en 8 GB.
- **Wan2GP** v13.14 en `C:\AI\Wan2GP`:
  - venv con torch 2.11+cu128 (compatible con la RTX 50xx), gradio 5.29, profile 4, sdpa.
  - Unos 55 GB de checkpoints, todos de **video** (Wan 2.1/2.2, animate). No tiene modelos de imagen descargados.
  - Ya generó videos (en `outputs\`).
  - La app lo tiene apuntado a `http://127.0.0.1:7860`. No está corriendo ahora mismo.
- **Archivo `wan2gp-pip.txt`:** está en `C:\Users\abner\Desktop\` (157 KB).
- **No instalados:** Ollama (no está en PATH ni en el puerto 11434) y ComfyUI.
- **Instalado:** `cloudflared`, en `C:\Program Files (x86)\cloudflared` y en el PATH.
- **n8n:** red bridge, puerto 5678, datos en `C:\Users\abner\n8n\data`, **sin `WEBHOOK_URL`**. El Telegram Trigger necesita una URL HTTPS pública, y eso se puede resolver con un túnel cloudflared.

### 3. Hardware
| Componente | Dato |
|---|---|
| GPU | **RTX 5060 Ti 8 GB** (8151 MiB), driver 617.14 |
| RAM | **31.7 GB** |
| CPU | Core Ultra 7 265KF, 20 núcleos |
| Disco C: | **≈270 GB libres** |

Con 8 GB de VRAM, Z-Image Turbo Q4 funciona con offload, que es justo lo que ya hace el wrapper. Los modelos grandes (Flux dev, Qwen-Image 20B) solo irían en Wan2GP con perfiles de poca VRAM y bastante RAM.

### 4. API de `sd-server.exe` (verificada en el binario y en los docs)
- **Endpoints:**
  - `POST /v1/images/generations` (compatible con OpenAI). Recibe `{prompt, n, size:"1024x1024", output_format}` y devuelve `data[0].b64_json`.
  - `POST /sdapi/v1/txt2img` (compatible con A1111). Recibe `steps`, `cfg_scale`, `sampler_name`, `scheduler`, `width`, `height` y `seed`, y devuelve `images[0]` en base64.
  - `/sdcpp/v1/img_gen` (asíncrono, con jobs).
- **Extras:** trae una UI web integrada en `/` y CORS permisivo (`Access-Control-Allow-Origin`). El puerto por defecto es 1234 y escucha en 127.0.0.1.
- **Comando sugerido**, con los mismos parámetros que usa la app para Z-Image Turbo (8 pasos, cfg 1, euler/simple). Sería un `.bat`:
  ```bat
  set D=%APPDATA%\open-generative-ai\local-ai
  "%D%\bin\sd-server.exe" --listen-ip 127.0.0.1 --listen-port 1234 ^
   --diffusion-model "%D%\models\z_image_turbo-Q4_K.gguf" --llm "%D%\models\Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf" ^
   --vae "%D%\models\ae.safetensors" --offload-to-cpu --diffusion-fa --vae-tiling ^
   --steps 8 --cfg-scale 1.0 --sampling-method euler --scheduler simple -W 1024 -H 1024
  ```

### 5. Alternativas 100% locales
| Herramienta | API local | Comentario |
|---|---|---|
| **sd-server (ya instalado)** | `:1234`, OpenAI, sdapi y sdcpp | **La recomendada**: no hay que descargar nada |
| Wan2GP (ya instalado) | Gradio en `:7860`; MCP con `python wgp.py --mcp --mcp-transport streamable-http --mcp-port N`; API Python `shared/api.py` | Sirve para video y para imagen (Z-Image/Qwen/Flux), pero habría que descargar los modelos de imagen. Los nombres de endpoint Gradio que usa la app son tentativos (lo dice su propio código) |
| ComfyUI Desktop | `:8000` (portable: 8188); `POST /prompt` + `/history` + `/view`; opción "Enable CORS header" | El más flexible, pero hay que instalarlo |
| SD WebUI Forge | `--api` → `/sdapi/v1/txt2img` | Hay que instalarlo |
| Fooocus | No tiene API REST integrada | Está en "limited LTS, bug fixes only". **No recomendado** |

### 6. Recomendación para el botón "Crear imagen"
1. **Motor:** `sd-server.exe` en `127.0.0.1:1234`, arrancado con un `.bat` o una tarea programada al iniciar sesión.
2. **Orquestación en n8n** (es lo más automatizable):
   - Un Webhook `POST /webhook/crear-imagen` y, en paralelo, un comando de Telegram `/imagen <prompt>`.
   - Opcionalmente, un LLM local para mejorar el prompt ("ropa de verano, Tarapoto, foto de producto…").
   - Un HTTP Request a `http://host.docker.internal:1234/v1/images/generations`.
   - Convertir la respuesta base64 a binario.
   - Guardar en `assets/img/` y hacer commit con el nodo GitHub (o la API), con lo que GitHub Pages se actualiza solo.
   - Responder por Telegram con la imagen.
3. **El botón en la web:** debe ir en una página **solo para el dueño** (`admin.html` con `noindex` y sin enlace público), porque solo funciona en su PC. Hace `fetch('http://localhost:5678/webhook/crear-imagen', {method:'POST', body: JSON.stringify({prompt})})`. Como respaldo sin código, puede ser un simple enlace a `http://127.0.0.1:1234/` (la UI integrada de sd-server).
4. **Lo que hace hoy la app de Open Generative AI:** solo se puede usar a mano. Un botón no puede abrirla con el prompt ya escrito.

### 7. Puntos inciertos (verificar)
- **Si se usa la GPU o no:**
  - `ggml-cuda.dll` necesita `cudart64_12.dll`, `cublas64_12.dll` y `cublasLt64_12.dll`. **No están** ni en `bin` ni en el PATH.
  - Lo probable es que sd.cpp esté usando **Vulkan** (o CPU) en lugar de CUDA.
  - Para confirmarlo, mira el log `-v` del primer arranque de sd-server ("CUDA" frente a "Vulkan").
  - No medí la velocidad.
- **Acceso desde n8n:** que `host.docker.internal` llegue a un servicio que escucha solo en 127.0.0.1 de Windows suele funcionar en Docker Desktop (es el mismo patrón que se usa con Ollama), pero no lo probé. Si da *connection refused*, usa `--listen-ip 0.0.0.0` y restríngelo con el Firewall.
- **Navegadores:** Chrome, Edge y Opera GX 142 o superior muestran un aviso de permiso de "Local Network Access" cuando una página pública (github.io) llama a localhost.
- **CORS en n8n:** el nodo Webhook tiene una opción "Allowed Origins (CORS)" en las versiones recientes; confírmalo en tu versión.
- **Actualizar a v2.0.0:** podría sobrescribir el wrapper `sd-cli.exe` o la DLL de CUDA personalizada, porque la rama `main` copia los binarios incluidos con `force`.

**Fuentes:**
- https://github.com/Anil-matcha/Open-Generative-AI y su README
- https://github.com/Anil-matcha/Open-Generative-AI/releases/tag/v2.0.0
- https://github.com/leejet/stable-diffusion.cpp/blob/master/examples/server/api.md y `examples/server/main.cpp` (CORS)
- https://comfyui-wiki.com/en/interface/settings/server-config
- https://github.com/lllyasviel/Fooocus
- https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY/m/JWenvGViCAAJ
- https://www.dynamsoft.com/web-twain/docs/faq/chromium-142-local-network-access-issue.md
- Locales: `C:\AI\Wan2GP\docs\API.md` y `CLI.md`

Lo que saqué de `app.asar` y la salida de `sd-server --help` están en `C:\Users\abner\AppData\Local\Temp\claude\C--Users-abner-OneDrive-Desktop-Vanguard-Paginas-Ropa\c7eb6ec5-bd15-490f-bf3c-1129ebf910bd\scratchpad\` (carpeta `asar\` y `sdserver_help.txt`).