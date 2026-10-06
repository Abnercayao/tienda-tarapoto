# Runbook de Palmera Brava

Guía de operación de la PC de la tienda: qué hacer cada día, cuando algo falla y cuando hay que rotar un secreto. Cada tarea tiene **responsable** (diapositiva 16: "cada recomendación tiene responsable o siguiente paso").

| Rol | Quién | Responde por |
|---|---|---|
| **admin** | Abner (demo y soporte técnico) | PC, Docker/n8n, Ollama, sd-server, GitHub, tokens, copias de seguridad |
| **dueño** | Dueño de la tienda | Catálogo, precios, stock, WhatsApp, `/borrar`, `/limpiar_muestras`, `/deshacer`, `/pausa` |
| **marketing** | Encargado de marketing | Fotos, productos, artículos e imágenes (todo como borrador). **No** puede `/whatsapp`, `/limpiar_muestras`, `/borrar`, `/deshacer` ni `/pausa` |

Direcciones locales (solo responden en la PC, nunca desde la red):

| Servicio | Dirección | Arranca |
|---|---|---|
| n8n (bot y webhooks del panel) | http://127.0.0.1:5678 | Solo, con Docker Desktop al iniciar sesión |
| Ollama (IA de texto e imagen) | http://127.0.0.1:11434 | Solo, al iniciar sesión |
| sd-server (imágenes, motor de Open Generative AI) | http://127.0.0.1:1234 | Bajo demanda: `tools\iniciar-sd-server.bat` |
| Sitio y panel local | http://127.0.0.1:8080/tienda-tarapoto/ y `admin.html` | Bajo demanda: `python tools\serve.py` o `tools\iniciar-todo.bat` |

---

## 1. Arranque y parada

### Arranque diario (responsable: dueño; soporte: admin)

1. Enciende la PC e **inicia sesión** en Windows. Déjala con la sesión iniciada y **bloqueada** (Win + L): si se cierra la sesión, Docker Desktop y Ollama se detienen y el bot no responde.
2. Espera 1–2 min a que Docker Desktop levante el contenedor `n8n`.
3. Si vas a crear imágenes: doble clic en `tools\iniciar-todo.bat`. Arranca sd-server minimizado (tarda 1–2 min en cargar el modelo), abre el sitio local y el panel. En el panel, los tres servicios deben decir **En línea**.
4. Prueba rápida: escribe `/estado` al bot. Debe responder con las cifras del catálogo.

### Parada (responsable: admin)

| Qué | Cómo | Efecto |
|---|---|---|
| sd-server | `tools\detener-sd-server.bat` | Libera la GPU y unos 8 GB de RAM. Si había una imagen en curso, ese pedido falla y el bot avisa. |
| Sitio local | Cierra la ventana "Sitio local - serve.py" o Ctrl+C | Solo afecta a la prueba local; la web pública sigue. |
| Ollama | Icono de Ollama en la bandeja → **Quit** | El bot sigue, pero arma los borradores con una **plantilla manual**. |
| n8n | Docker Desktop → contenedor `n8n` → **Stop** (o `docker stop n8n`) | El bot deja de responder; Telegram guarda los mensajes 24 h. |

> No uses a la vez la app Open Generative AI, Wan2GP y sd-server: comparten los 8 GB de VRAM y la generación falla. No pulses "reparar" ni "actualizar" en Open Generative AI: su descargador reescribe `bin\` (de ahí sale sd-server).

### Comprobaciones de salud (responsable: admin)

```powershell
curl.exe -s http://127.0.0.1:5678/healthz                  # {"status":"ok"}
curl.exe -s http://127.0.0.1:11434/api/version             # {"version":"0.35.1"}
curl.exe -s http://127.0.0.1:1234/sdcpp/v1/capabilities    # JSON con "model" y "output_formats_by_mode"
Get-Content "$env:LOCALAPPDATA\tienda\sd-server.log" -Tail 30   # log de sd-server (busca "CUDA" o "Vulkan")
nvidia-smi                                                  # VRAM usada
```

---

## 2. La PC estuvo apagada o se reinició (responsable: admin)

- Telegram guarda los mensajes pendientes **24 horas**. Al volver, WF1 los recoge solo y el bot dice "Volví; tengo N mensajes pendientes". No hay duplicados: la cola usa el `update_id`.
- Lo enviado hace **más de 24 h se pierde**: pide que lo reenvíen.
- Si Windows Update reinició la PC, la sesión quedó cerrada: inicia sesión para que arranquen Docker Desktop y Ollama.
- Los borradores sin publicar caducan a las 24 h (WF10). Si alguno caducó, se vuelve a enviar.
- La web pública **no** depende de la PC: sigue funcionando aunque la PC esté apagada. Solo se detienen las actualizaciones y el bot.

---

## 3. Fallos frecuentes

| Síntoma | Causa probable | Qué hacer | Responsable |
|---|---|---|---|
| El bot no contesta nada | PC apagada, sesión cerrada o n8n detenido | Revisa el panel o `curl.exe -s http://127.0.0.1:5678/healthz`; inicia sesión o abre Docker Desktop. En n8n, confirma que WF1 Ingesta esté publicado. | admin |
| Contesta a unos y a otros no | El `from.id` de esa persona no está en `AUTORIZADOS`, o escribe desde un grupo | Agrega su `from.id` (sale en WF0) con su rol en la fila `AUTORIZADOS` de `config`. Solo chats privados. | admin |
| "Recibido" pero llega una plantilla para rellenar | Ollama no responde | Abre Ollama desde el menú Inicio; mientras tanto, completa la plantilla. | dueño / admin |
| `/imagen` o el panel fallan | sd-server apagado o sin VRAM | `tools\iniciar-sd-server.bat`; cierra Open Generative AI y Wan2GP. El panel muestra el siguiente paso. | admin |
| El panel dice "n8n no respondió o bloqueó la petición (CORS)" | WF8 sin publicar, o el panel no está en el puerto 8080 | Publica WF8 Panel-API con Allowed Origins `http://localhost:8080,http://127.0.0.1:8080` (sin espacios). Abre el panel con `tools\iniciar-todo.bat`. | admin |
| El panel dice "la clave no coincide" (401/403) | El valor de `X-Tienda-Key` cambió | En el panel, "Olvidar clave" y escríbela de nuevo. | admin |
| "Publicado" pero la web no cambia | Caché de Pages (hasta 10 min) o el build sigue en curso | Espera; `/historial` muestra el commit; en GitHub, pestaña **Actions** (`pages-build-deployment`). | dueño |
| El bot avisa que no puede publicar | PAT caducado o revocado (401), o conflicto (422) | El 422 se reintenta solo. Con 401: crea un PAT nuevo (sección 5). El borrador queda `aprobado` y se publica al arreglarlo. | admin |
| El bot se niega a publicar por "validación" | Un dato rompe el contrato (precio, tallas, referencia a un producto inexistente) | El mensaje dice qué campo y el siguiente paso; corrige y vuelve a enviar. | dueño / marketing |
| La web muestra "Catálogo no disponible" | `data/products.json` no carga | Revisa `/historial` y usa `/deshacer`. La web usa la última copia buena guardada en cada navegador. | admin |
| Muchos avisos de error seguidos | Falla repetida de un nodo | WF9 manda como máximo 1 aviso por hora y por nodo. Revisa la ejecución en n8n → Executions. | admin |

---

## 4. Deshacer y pausar (responsable: dueño; soporte: admin)

- `/historial`: últimos 5 commits del bot, con el `id`, el origen y el borrador.
- `/deshacer` (con confirmación): crea un **commit nuevo** que restaura `data/*` del commit anterior. Solo funciona si el último commit de `main` es del bot. No borra historia.
- `/pausa` y `/reanudar`: bloquean o reanudan las escrituras en GitHub (los borradores se siguen creando).
- **A mano** (admin), si el último commit no es del bot:

  ```powershell
  git pull --rebase
  git log --oneline -5
  git revert <sha>          # commit nuevo que deshace ese cambio
  node tools\qa.js
  git push
  ```

  El ruleset de `main` impide `push --force` y borrar la rama: deshacer siempre es un commit nuevo.

---

## 5. Rotación de secretos (responsable: admin)

Haz esto **si un token se filtró** (o se pegó en un chat, un correo o el repo) y, de forma preventiva, el PAT cada 90 días.

| Secreto | Dónde vive | Cómo rotarlo |
|---|---|---|
| Token del bot de Telegram | Credencial "Telegram Tienda" (`telegramApi`) **y** fila `BOT_TOKEN` de la Data Table `config` | En @BotFather: `/revoke` → elige el bot → copia el token nuevo. Pégalo en **los dos sitios**. Escribe `/estado` al bot para comprobar. |
| PAT de GitHub (fine-grained) | Credencial `githubApi` de n8n | En https://github.com/settings/personal-access-tokens revoca el actual y crea otro igual: solo `tienda-tarapoto`, Contents: Read and write, 90 días. Pégalo en la credencial. WF10 avisa 14 días antes de que caduque. |
| Clave del panel `X-Tienda-Key` | Credencial Header Auth de n8n; `sessionStorage` del navegador | Cambia el valor en la credencial. En el panel: "Olvidar clave" y escribe la nueva. |
| API key de n8n (solo si usaste `tools\n8n-deploy.ps1`) | Archivo tuyo fuera del repo | n8n → Settings → n8n API → borra la clave y crea otra si hace falta. |

Si el token llegó al repo público: **primero rótalo** (el token viejo deja de servir) y después quita el archivo con un commit nuevo. No reescribas la historia (el ruleset lo impide y el token ya se considera público). GitHub *push protection* detecta los PAT, pero **no** el token de Telegram.

Antes de cada commit hecho en la PC, el hook `tools/hooks/pre-commit` busca secretos, valida los datos y la CSP. Actívalo una vez con `git config core.hooksPath tools/hooks`. No uses `git commit --no-verify`.

---

## 6. Copia de seguridad de n8n (responsable: admin; mensual y antes de recrear el contenedor)

La carpeta `C:\Users\abner\n8n\data` contiene la base de datos, la **clave de cifrado** y los tokens. Va **fuera del repo, de OneDrive y de Google Drive**.

```powershell
docker stop n8n
$d = "C:\Users\abner\backups\n8n-$(Get-Date -Format yyyyMMdd)"
New-Item -ItemType Directory -Force $d | Out-Null
Copy-Item -Recurse C:\Users\abner\n8n\data\* $d
docker start n8n
```

El bot no responde durante el minuto que dura la copia; los mensajes no se pierden (Telegram los guarda).

---

## 7. Cambios de diseño o de código en la PC (responsable: admin)

El bot escribe en `data/` y `assets/img/` directamente en GitHub. Para no pisar sus cambios:

```powershell
git pull --rebase                 # siempre antes de editar
# (opcional) /pausa en Telegram mientras editas data/ a mano
# ... editar ...
node tools\csp.js                 # si tocaste el <script> en línea de index.html o admin.html
node tools\kpis.js --readme       # si cambiaron los datos
node tools\qa.js                  # matriz de la diapositiva 16
git add -A; git commit -m "..."   # el hook pre-commit revisa secretos, datos y CSP
git push
# /reanudar si pausaste
```

- Workflows de n8n: exporta, luego `node tools\limpiar-workflows.js` (quita `pinData`, ids de credenciales y `meta.instanceId`) y revisa el diff antes de commitear.
- Pruebas del bot: usa la rama `pruebas` (fila `REPO_BRANCH` de `config`); no dispara builds de Pages.
- Pages admite unos 10 builds por hora: el bot agrupa los cambios (un commit cada 6 min como mínimo).

---

## 8. Contrato del panel con n8n (WF8 Panel-API; referencia para el equipo C)

`admin.html` llama, con la cabecera `X-Tienda-Key` y desde el origen `http://127.0.0.1:8080` o `http://localhost:8080`:

**`POST http://127.0.0.1:5678/webhook/crear-imagen`** con JSON:

| Campo | Ejemplo | Nota |
|---|---|---|
| `prompt` | "An adult wearing … No text, no logos, no watermark." | Prompt **completo**: ya incluye el estilo de la marca y la regla de encuadre (sin rostro / sin personas). No hay que añadirlo de nuevo. |
| `prompt_usuario` | "An adult wearing a lagoon-turquoise linen shirt…" | Solo lo que escribió la persona (para el mensaje de Telegram). |
| `tipo` | `hero` · `lookbook` · `blog` · `producto-muestra` | Botones sugeridos en Telegram. |
| `personas` | `adultos` · `ninguna` | Con texto de niños, el panel ya fuerza `ninguna`. |
| `size` | `768x1216` | Tamaño a pedir a sd-server (con personas, más alto que el final). |
| `tamano_final` | `768x1024` | Tamaño final tras el recorte. |
| `recortar_arriba` | `192` | Píxeles a recortar arriba (0 si no hay personas). El panel también recorta su copia en el navegador. |
| `seed` | `4242` | Semilla para `<sd_cpp_extra_args>`. |
| `origen` | `panel` | |

Respuesta esperada: `200` con `Content-Type: image/webp` (la imagen en binario). También se acepta JSON con `b64_json`, `imagen_b64` o `data[0].b64_json`. En error: JSON `{ "error": "...", "siguiente_paso": "..." }` con 4xx/5xx (`401/403` clave, `409/423/429` GPU ocupada).

**`GET http://127.0.0.1:5678/webhook/estado`**: JSON con `texto` (el mismo de `/estado`) o cualquier JSON; el panel lo muestra tal cual.
