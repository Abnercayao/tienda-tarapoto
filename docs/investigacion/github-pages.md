# Plan de publicación en GitHub Pages: cuenta Abnercayao, tienda de ropa de Tarapoto

Para preparar este plan solo ejecuté comandos de lectura. No creé repos, no hice push, no modifiqué contenedores y no escribí archivos.

## 1. Lo que verifiqué en la PC y en la cuenta

| Comprobación | Resultado |
|---|---|
| `gh auth status` | Sesión activa como **Abnercayao** (keyring). Scopes del token: `gist, read:org, repo, workflow`. Protocolo git: https |
| `gh api user` | id `297644875`, cuenta creada el 2026-06-28. `plan` aparece como **null** porque el token no tiene el scope `user`, así que **no se puede confirmar si es Free o Pro**. Lo más probable es que sea Free; con un repo **público** funciona en cualquier caso |
| `gh repo list` | Hay 3 repos: `recepcion-ia` (público), `Frima-Emily` (público, unos 9 MB) y `Apuestas-de-Valor` (privado). **Ninguno tiene Pages activo** (la API devuelve 404 en `/pages`) |
| ¿Existe `Abnercayao.github.io`? | No (404) |
| ¿Están libres los nombres? | `tienda-tarapoto`, `ropa-tarapoto` y `tarapoto-moda` están libres (404) |
| `gh api rate_limit` | core 5000/5000 y graphql 5000/5000 (no se ha usado nada) |
| Carpeta de trabajo | Solo contiene `Clase III.pdf` (**44.9 MB**). **No conviene hacer `git init` en la raíz**: GitHub da aviso con archivos de más de 50 MiB y bloquea los de más de 100 MiB, y además el PDF no tiene por qué estar en la web |
| OneDrive | El Escritorio está redirigido a OneDrive (`GetFolderPath('Desktop')` = `C:\Users\abner\OneDrive\Desktop`, carpetas con atributo ReadOnly, que es lo típico de esa redirección). **El proceso de OneDrive no está corriendo ahora mismo** y no hay cuentas en `HKCU:\...\OneDrive\Accounts`, así que la sincronización parece inactiva. Esto es **incierto**: si se vuelve a activar, empezaría a sincronizar todo |
| Repos anteriores | Ya existe `C:\Users\abner\dev\recepcion-ia` con remoto en GitHub, o sea que el usuario ya trabaja repos **fuera de OneDrive** |
| git | 2.53. En la configuración de sistema: `core.autocrlf=true`, `credential.helper=manager`. `user.email` es su hotmail, que ya aparece en los commits públicos de `recepcion-ia`. LongPathsEnabled=1 |
| n8n | Contenedor `n8n` activo en el puerto 5678. Tiene un solo montaje: `C:\Users\abner\n8n\data` → `/home/node/.n8n`. TZ=America/Lima. **No está definida la variable `WEBHOOK_URL`** |
| Git Bash | **Convierte `path=/` en `C:/Program Files/Git/`** (lo comprobé con python). Por eso conviene usar PowerShell, o anteponer `MSYS_NO_PATHCONV=1` en Bash |
| Caché de Pages | Un sitio github.io real devuelve `Cache-Control: max-age=600` (lo comprobé con curl). Los cambios pueden tardar hasta unos 10 minutos en verse por la caché |

## 2. Decisiones recomendadas

- **Nombre del repo:** `tienda-tarapoto`, en minúsculas, sin espacios y está libre.
- **URL final:** `https://abnercayao.github.io/tienda-tarapoto/`. El host siempre va en minúsculas. Uso un nombre de repo en minúsculas para evitar problemas de mayúsculas en la ruta.
- **Tipo de sitio:** sitio de proyecto, no un sitio de usuario `Abnercayao.github.io`. Esto deja libre la raíz para un portafolio y coincide con las diapositivas (fuente `main /(root)`).
- **Visibilidad:** el repo tiene que ser **público**. Con GitHub Free, Pages solo funciona en repos públicos; en privados hace falta Pro, Team o Enterprise. El sitio publicado es público siempre, aunque el repo sea privado.
- **Fuente de publicación:** `main` en `/`, con `build_type=legacy`, como piden las diapositivas 21-22. Hay que añadir un archivo **`.nojekyll`** vacío en la raíz para desactivar Jekyll: el build es más rápido y no se ignoran carpetas que empiecen por `_`.
- **Rutas relativas obligatorias:** como el sitio vive en `/tienda-tarapoto/`, cualquier ruta que empiece por `/assets/...` se rompe. Hay que usar `assets/...` o `./data/products.json`.
- **Estructura sugerida:**

  ```
  tienda-tarapoto/
    index.html
    README.md
    .nojekyll
    .gitignore
    .gitattributes
    assets/css/  assets/js/  assets/img/
    assets/img/productos/   ← solo lo escribe n8n
    data/products.json      ← solo lo escribe n8n
    data/posts.json         ← solo lo escribe n8n
  ```

  La web lee los JSON con `fetch(..., {cache:'no-cache'})` más `?v=<timestamp>`.
- **Política de GitHub (zona gris, importante):** Pages no permite usarse como hosting de un negocio online o tienda dedicada sobre todo a transacciones comerciales, ni manejar contraseñas o números de tarjeta. Por eso la web debe ser un **catálogo/vitrina sin carrito ni pagos** (contacto por WhatsApp o Telegram) y mencionar que es un proyecto del curso. Si esto alcanza para cumplir la política es **incierto**.
- **Privacidad (opcional):** en este repo se puede usar el correo noreply `297644875+Abnercayao@users.noreply.github.com` como `user.email` local para no exponer el hotmail.

## 3. ¿Dentro de OneDrive o fuera?

**Opción A, recomendada: `C:\Users\abner\dev\tienda-tarapoto`.**
- No tiene ningún riesgo de OneDrive y sigue lo que el usuario ya hace con `recepcion-ia`.
- La ruta no tiene espacios.
- n8n no necesita esta carpeta, porque va a hacer los commits por la API de GitHub, no con git local ni montajes de Docker.

**Opción B, aceptable: `"C:\Users\abner\OneDrive\Desktop\Vanguard\Paginas Ropa\tienda-tarapoto"`.**
- Es más cómoda para el agente, que trabaja en esa carpeta, y para entregar el curso.
- Es viable porque OneDrive no está corriendo ahora.
- Medidas para reducir el riesgo:
  - Nunca hacer `git init` en la raíz de "Paginas Ropa", por el PDF de 44.9 MB.
  - Sitio estático puro, sin `node_modules` ni build. Si alguna vez se usa npm, poner `node_modules/` en `.gitignore`.
  - Si OneDrive se activa, pausar la sincronización durante las operaciones de git.
  - Si el `.git` se corrompe (`index.lock`, duplicados tipo "-PC"), volver a clonar desde GitHub.
  - **No** usar "Elegir carpetas" de OneDrive para excluirla: esa opción borra la copia local.
  - Poner siempre la ruta entre comillas, porque tiene espacio.
  - **No** montar esta carpeta en Docker.

## 4. Comandos propuestos (PowerShell 5.1; no los ejecuté)

```powershell
# 0) Ubicación (A recomendada; para la opción B cambiar $Repo)
$Repo = "C:\Users\abner\dev\tienda-tarapoto"
# $Repo = "C:\Users\abner\OneDrive\Desktop\Vanguard\Paginas Ropa\tienda-tarapoto"
New-Item -ItemType Directory -Force $Repo | Out-Null
Set-Location $Repo

# 1) (El agente crea index.html, assets/, data/, README.md)
if (-not (Test-Path .nojekyll)) { New-Item -ItemType File .nojekyll | Out-Null }
# .gitignore sugerido: node_modules/  .env  *.log  Thumbs.db  desktop.ini  .DS_Store  originales/
# .gitattributes sugerido:
#   * text=auto eol=lf
#   *.jpg binary
#   *.jpeg binary
#   *.png binary
#   *.webp binary
#   *.gif binary
#   *.ico binary
#   *.pdf binary

# 2) Repo local
git init -b main
git config user.name "Abner Cayao"
git config user.email "297644875+Abnercayao@users.noreply.github.com"   # opcional (privacidad)
git add -A
git status --short   # revisar que no entra nada pesado ni secreto
git commit -m "Sitio inicial: landing + catalogo de muestra (Tarapoto)"

# 3) Prueba local simulando la subruta /tienda-tarapoto/ (detecta rutas absolutas rotas)
python -m http.server 8080 --directory (Split-Path $Repo -Parent)
#   abrir http://localhost:8080/tienda-tarapoto/   (Ctrl+C para detener)

# 4) Crear el repo público y hacer push (el primer push lo hace la cuenta admin; los docs lo exigen para el primer build)
gh repo create Abnercayao/tienda-tarapoto --public --description "Catalogo de ropa para el calor - Tarapoto, Peru" --homepage "https://abnercayao.github.io/tienda-tarapoto/" --source . --remote origin --push
gh repo edit Abnercayao/tienda-tarapoto --add-topic github-pages --add-topic n8n --add-topic tarapoto

# 5) Activar Pages desde main /(root)
gh api -X POST repos/Abnercayao/tienda-tarapoto/pages -f "source[branch]=main" -f "source[path]=/" -f build_type=legacy
#   (en Git Bash: MSYS_NO_PATHCONV=1 gh api -X POST ... )
#   Si no arranca ningún build: gh api -X POST repos/Abnercayao/tienda-tarapoto/pages/builds

# 6) Verificar
gh api repos/Abnercayao/tienda-tarapoto/pages --jq "{status: .status, url: .html_url, build_type: .build_type, https: .https_enforced, source: .source}"
do { $s = gh api repos/Abnercayao/tienda-tarapoto/pages/builds/latest --jq .status; "build: $s"; if ($s -notin 'built','errored') { Start-Sleep 10 } } while ($s -notin 'built','errored')
gh api repos/Abnercayao/tienda-tarapoto/pages/builds/latest --jq "{status: .status, commit: .commit, error: .error.message, ms: .duration}"
gh run list -R Abnercayao/tienda-tarapoto --limit 5          # workflow dinámico "pages-build-deployment" (nombre observado, no documentado)
curl.exe -sI https://abnercayao.github.io/tienda-tarapoto/   # esperar HTTP 200
curl.exe -sI http://abnercayao.github.io/tienda-tarapoto/    # esperar 301 a https
#   Si https_enforced=false (los sitios github.io nuevos ya sirven HTTPS automáticamente):
gh api -X PUT repos/Abnercayao/tienda-tarapoto/pages -F https_enforced=true
#   Validación manual (diapositiva 22): ventana privada, móvil, candado HTTPS, rutas e imágenes cargan.
```

Justo después del POST, `builds/latest` puede devolver 404 durante unos segundos. Hay que reintentar.

## 5. Qué cambia cuando n8n haga commits frecuentes

1. **Límite de builds.** Pages tiene un límite blando de **10 builds por hora**. Cada push o commit a `main` dispara un build. Con el nodo GitHub de n8n ("Create/Edit file", que usa la Contents API), cada archivo es un commit: un producto con foto son 2 commits y 2 builds.
   - **Mitigación 1:** hacer **un solo commit por cada mensaje de Telegram** con la Git Data API, en 5 llamadas HTTP:
     - `GET /repos/Abnercayao/tienda-tarapoto/git/ref/heads/main`
     - `POST .../git/blobs` (la imagen en base64)
     - `POST .../git/trees` (con `base_tree`)
     - `POST .../git/commits`
     - `PATCH .../git/refs/heads/main`
   - **Mitigación 2, si se pasa de unos 10 por hora:** cambiar a `build_type=workflow` con un workflow propio (`actions/checkout` → `configure-pages` → `upload-pages-artifact` → `deploy-pages`, con `concurrency: pages`). A los workflows propios el límite de 10 por hora **no se les aplica**, y Actions es gratis en repos públicos. El comando es `gh api -X PUT repos/Abnercayao/tienda-tarapoto/pages -f build_type=workflow`. Subir `.github/workflows` necesita el scope `workflow`; el gh actual lo tiene.
2. **Escrituras en serie.** Los docs dicen que si se usan en paralelo los endpoints de crear/actualizar y de borrar archivos, hay conflicto y dan error. En n8n hay que procesar los mensajes uno por uno y reintentar ante 409/422. Para actualizar hace falta el `sha` del blob, y el contenido va en base64.
3. **Token para n8n.** Un PAT guardado **solo en las credenciales de n8n**, nunca en el repo público. n8n recomienda el classic con scope `repo`. Lo más seguro es uno fine-grained limitado a `tienda-tarapoto` con Contents de lectura y escritura, aunque n8n advierte que tiene "limitaciones" (incierto cuáles). Ponerle fecha de caducidad. El token de Telegram tampoco va en el repo.
4. **Tamaño del repo.** Lo recomendado es menos de 1 GB por repo y por sitio publicado. Hay aviso con archivos de 50 MiB y bloqueo con más de 100 MiB.
   - Las imágenes deberían ser WebP de 1200 px como máximo y unos 100–200 KB. Así, 1000 productos ocupan unos 150–200 MB.
   - Las imágenes borradas **siguen ocupando espacio en el historial**.
   - Mantener `products.json` por debajo de 1 MB: con más de 1 MB, la Contents API devuelve el contenido vacío en modo object.
   - Las fotos originales no se suben.
   - Para la API sobra margen: 5000 peticiones por hora.
5. **Retraso visible.** Hay que sumar el tiempo del build (no lo medí) a la caché de hasta 10 minutos (`max-age=600`). En la web se puede indicar "los cambios pueden tardar unos minutos".
6. **Sincronizar la copia local.** n8n solo escribe en `data/` y `assets/img/productos/`. Los cambios de diseño se hacen en local, y siempre conviene hacer `git pull --rebase` antes de editar.
7. **Riesgo fuera de este alcance (incierto, verificar en la tarea de n8n).** El nodo Telegram Trigger usa webhooks, y Telegram exige una URL **HTTPS pública**. El n8n local no tiene `WEBHOOK_URL` configurada. Para mantener "todo local" sin túnel, la alternativa sería hacer polling con un Schedule Trigger y llamadas HTTP a `getUpdates`; si no, haría falta un túnel tipo cloudflared o ngrok.

## Fuentes

- Límites de Pages (1 GB, 10 builds por hora, workflow propio exento, 429, sin e-commerce): https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- API REST de Pages (POST, PUT, `builds/latest`, `pages/builds`, `build_type`): https://docs.github.com/en/rest/pages/pages
- Fuente de publicación por rama, los pushes publican, `GITHUB_TOKEN` no dispara builds: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Pages en planes Free/Pro, Jekyll por defecto, `.nojekyll`, URL de proyecto (leído de la fuente en github/docs: `data/reusables/gated-features/pages.md` y `content/pages/.../about-github-pages.md`): https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages
- HTTPS automático en github.io desde 2016: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- Actions gratis en repos públicos (fuente en github/docs: `content/billing/concepts/product-billing/github-actions.md`): https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Archivos grandes (50/100 MiB, menos de 1 GB recomendado): https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
- Contents API (no usar en paralelo, `sha` obligatorio, base64, límite de 1 MB): https://docs.github.com/en/rest/repos/contents
- Nodo y credenciales GitHub en n8n: https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.github/ y https://docs.n8n.io/integrations/builtin/credentials/github/
- git dentro de OneDrive: https://techcommunity.microsoft.com/t5/onedrive/onedrive-is-corrupting-my-git-repositories/td-p/3898283 y https://help.copia.io/knowledge/resolving-git-lock-file-errors-in-copia-desktop