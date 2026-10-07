# n8n: pasos para dejar el bot funcionando (Palmera Brava)

Estado al empezar: los 9 workflows **PB WF0 … PB WF9** ya están importados en tu n8n (sin publicar) y las 3 credenciales
ya existen con valores de relleno (`PEGAR_EN_LA_UI_DE_N8N`). Respaldo previo: `C:\Users\abner\backups\n8n-pre-import-20261007-0007\`.
Tú pegas los secretos; nadie más los ve. **Nunca** los escribas en el repo, en un chat ni en una captura.

Antes de empezar: Docker Desktop abierto (n8n) y Ollama abierto (modelo `qwen3.5:4b-q4_K_M`).

## 1. Abrir n8n
1. Abre **http://localhost:5678** e inicia sesión con tu cuenta de dueño de n8n.

## 2. Token de Telegram (va en DOS lugares)
El bot habla con Telegram por HTTP y ese nodo necesita el token en la tabla `pb_config`; la credencial la usan los nodos de fotos.
1. Menú izquierdo → **Overview** → pestaña **Credentials** → abre **Telegram Palmera Brava**.
2. En **Access Token** borra `PEGAR_EN_LA_UI_DE_N8N` y pega el token de BotFather → **Save**. Debe decir *Connection tested successfully*.
3. El segundo lugar (`pb_config.BOT_TOKEN`) se llena en el paso 5, cuando la tabla ya exista.

## 3. GitHub: token de acceso (PAT) de 90 días
1. Abre **https://github.com/settings/personal-access-tokens/new** (sesión de `Abnercayao`).
2. Token name: `n8n Palmera Brava` · Expiration: **90 days** · Resource owner: `Abnercayao`.
3. Repository access: **Only select repositories** → `tienda-tarapoto`.
4. Permissions → Repository permissions → **Contents: Read and write** (Metadata queda en Read-only solo). Nada más.
5. **Generate token** y cópialo (solo se muestra una vez).
6. En n8n → Credentials → **GitHub Palmera Brava** → **Access Token**: pégalo (no cambies Server `https://api.github.com` ni User `Abnercayao`) → **Save**.
7. Pon un recordatorio en ~85 días: crear otro PAT igual y pegarlo aquí.

## 4. Clave del panel (X-Tienda-Key)
1. Genera una clave larga en PowerShell:
   `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})`
2. Credentials → **Header X-Tienda-Key** → deja **Name** = `X-Tienda-Key` y en **Value** pega la clave → **Save**.
3. Guárdala en tu gestor de contraseñas: la escribirás en `admin.html` (paso 9).

## 5. Ejecutar WF0 (crea las tablas) y pegar el token en pb_config
1. Overview → Workflows → abre **PB WF0 Setup** → **Execute workflow**. La 1.ª vez crea las 5 tablas y avisa que falta `BOT_TOKEN`.
2. Overview → pestaña **Data tables** → abre **pb_config** → fila `clave = BOT_TOKEN` → en **valor** pega el mismo token del paso 2.
3. Vuelve a **PB WF0 Setup** → **Execute workflow**. En la salida verás el **@usuario** del bot (anótalo).

## 6. Publicar los workflows (en este orden)
Abre cada uno y pulsa **Publish** (arriba a la derecha):
**WF9 Errores → WF3 Borrador-IA → WF4 Comandos → WF5 Publicar → WF6 Imagen-IA → WF8 Panel-API → WF2 Worker → WF1 Ingesta.**
WF0 **no** se publica (es manual). "My workflow" no es de la tienda; no lo toques.
Si alguna vez se reimportan los workflows o editas uno, hay que volver a pulsar **Publish** (en ese mismo orden).

## 7. Dar de alta a Abner, dueño y marketing
1. Cada persona abre `t.me/<usuario_del_bot>` desde **su** Telegram y pulsa **Iniciar** (`/start`). El bot no responde todavía: es lo correcto (ignora a desconocidos).
2. Espera 20 s. Data tables → **pb_config** → fila **DESCONOCIDOS**: ahí están `id`, nombre y fecha de cada uno.
3. En la fila **AUTORIZADOS**, cambia los `0` por esos `id` (números, sin comillas) y guarda. Ejemplo:
   ```json
   [{"id":111111111,"rol":"admin","nombre":"Abner (demo y soporte)"},
    {"id":222222222,"rol":"dueno","nombre":"Dueño de la tienda"},
    {"id":333333333,"rol":"marketing","nombre":"Encargado de marketing"}]
   ```
4. Ejecuta **PB WF0 Setup** otra vez (carga a cada uno los comandos de su rol).
   Marketing **no** puede usar `/whatsapp`, `/limpiar_muestras`, `/borrar`, `/deshacer`, `/pausa` ni `/reanudar`.
   Para quitar a alguien: pon su `id` en `0` y vuelve a ejecutar WF0. Solo funcionan chats privados con el bot.

## 8. Prueba real
1. Escribe **/ayuda** → debe llegar la lista de comandos y terminar con "Siguiente paso: …".
2. Envía una **foto** de la prenda con el texto **polo de lino para dama, tallas S M L, 49.90**.
   Llega "Recibido, preparo el borrador…" y luego (≈1 min) la vista previa con botones **Publicar** / **Cancelar**.
3. Revisa los datos y pulsa **Publicar** → "Aprobado…" → en ≤ 6 min "Publicado: … (commit xxxxxxx)".
4. Mira **https://abnercayao.github.io/tienda-tarapoto/** (tarda 1–10 min). Si era solo prueba: `/deshacer` (admin/dueño) u `/ocultar <id>`.

## 9. Panel admin.html
1. Doble clic en `C:\Users\abner\dev\tienda-tarapoto\tools\iniciar-todo.bat` (arranca sd-server y el sitio local y abre el panel),
   o en una terminal dentro del repo: `python tools/serve.py` y abre **http://127.0.0.1:8080/tienda-tarapoto/admin.html**.
   Usa exactamente `127.0.0.1:8080` o `localhost:8080` (son los únicos orígenes que n8n acepta).
2. En **Crear imagen con IA** escribe la clave del paso 4 (se borra al cerrar la pestaña). "Estado del bot" debe mostrar n8n, Ollama y sd-server.
3. Cada imagen tarda ≈35 s; llega a Telegram del admin: elige destino (hero/portada/look) y pulsa **Publicar** allí.

## Si algo falla
- El bot no contesta: ¿Docker abierto? ¿WF1 y WF2 publicados? ¿`BOT_TOKEN` pegado en pb_config? Revisa **Executions** del workflow.
- "Workflow is not active": falta publicar WF3–WF6 (paso 6).
- Panel con error 403: la clave no coincide con la credencial **Header X-Tienda-Key**. Error 404: publica WF8.
- Publicar falla con 401/403 de GitHub: el PAT venció o no tiene Contents: Read and write → paso 3.
- Si el token del bot se filtra: BotFather → `/revoke`, y pega el nuevo en la credencial **y** en `pb_config.BOT_TOKEN`.
- Volver atrás todo: `docker stop n8n`, copia los `database.sqlite*` del respaldo a `C:\Users\abner\n8n\data\`, `docker start n8n`.

Pendiente para v1.1 (no incluido): WF7 Formulario de productos (el enlace "Formulario de productos (n8n)" del panel aún no funciona) y WF10 Salud (avisos de PAT por vencer, borradores viejos).
