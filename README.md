# Palmera Brava: ropa fresca para el calor de la selva

Catálogo web de una tienda de ropa de verano en **Tarapoto (San Martín, Perú)**. Los clientes ven las prendas, arman su bolsa y hacen el pedido por **WhatsApp** (no hay pagos en línea). El catálogo se actualiza desde **Telegram**: el dueño o el encargado de marketing manda una foto con los datos, un bot local arma un borrador con IA y lo publica cuando alguien con permiso toca **Publicar**.

- **Sitio publicado:** https://abnercayao.github.io/tienda-tarapoto/
- **Sitio y panel en la PC de la tienda:** http://127.0.0.1:8080/tienda-tarapoto/ y http://127.0.0.1:8080/tienda-tarapoto/admin.html (con `tools\iniciar-todo.bat`)
- **Estado:** v1 con **catálogo de muestra**. Las 16 prendas actuales son de referencia, con imágenes generadas por IA local y la etiqueta "Imagen referencial (IA)". Mientras existan, la web muestra el banner "Catálogo de muestra · precios referenciales" y el botón **Consultar por WhatsApp** (pregunta por prendas similares). Las prendas reales llevan bolsa y **Pedir por WhatsApp** con un solo mensaje.

| Dato | Valor |
|---|---|
| Tienda | Palmera Brava, Tarapoto (San Martín) |
| WhatsApp | +51 995 542 938 (número personal; no hay WhatsApp Business) |
| Horario | Todos los días, de 8:00 a. m. a 8:00 p. m. **(por confirmar: los días no se especificaron)** |
| Entrega | Coordinada por WhatsApp; motocarro dentro de Tarapoto |

> Todo lo que está en `data/` es **público** (el repo y la web lo son), incluidos los productos ocultos y el stock. Nunca se guarda ahí nada privado.

## Cifras del catálogo

<!-- KPIS:INICIO (generado con: node tools/kpis.js --readme; no editar a mano) -->
| Cifra | Valor |
|---|---|
| Productos visibles (`activo: true`) | 16 |
| Hombres / Mujeres / Niños / Accesorios | 4 / 4 / 4 / 4 (suman 16) |
| ¿Las categorías suman el total? | Sí |
| De muestra / reales | 16 / 0 |
| Productos ocultos (`activo: false`) | 0 |
| En oferta (descuento máximo) | 5 (-19 %) |
| Agotados | 0 |
| Unidades en stock | 215 |
| Rango de precios (con la oferta aplicada) | S/ 24.90 a S/ 89.90 |
| Imágenes de productos (IA local / foto / provisional) | 16 / 0 / 0 |
| Artículos del blog publicados | 3 de 3 |
| Looks del lookbook | 4 |
| Testimonios verificados | 0 |
| WhatsApp configurado | Sí |
| Versión de los datos (productos / artículos / tienda) | 1 / 1 / 1 |
| Datos actualizados | 2026-10-06T06:00:00-05:00 |

Cifras calculadas por `tools/kpis.js` sobre `data/*.json` (las mismas que responde `/estado` y muestra el panel local).
<!-- KPIS:FIN -->

## Cómo funciona

```
 Dueño / marketing / admin (Telegram)        PC de la tienda (Windows 11), todo local
   foto + texto, comandos, botones  ──►  n8n (Docker, 127.0.0.1:5678): recoge mensajes cada 10 s (polling)
                                           ├─ Ollama + qwen3.5:4b (127.0.0.1:11434): entiende el mensaje y arma el borrador
                                           ├─ tools/validar.js: valida el borrador (mismas reglas que en local)
                                           ├─ Publicar ► 1 commit agrupado a GitHub (como máximo cada 6 min)
                                           └─ /imagen y panel ► sd-server + Z-Image Turbo (127.0.0.1:1234)
 GitHub (repo público) ──► GitHub Pages ──► clientes ──► "Pedir por WhatsApp" (wa.me/51995542938)
```

- Nada de la PC queda expuesto a internet: el bot **consulta** a Telegram (no recibe conexiones) y n8n, Ollama, sd-server y el sitio local escuchan solo en `127.0.0.1`.
- Toda escritura pasa por un **borrador** y el botón **Publicar**. La IA nunca escribe en GitHub.
- Dependencias de nube inevitables: `api.telegram.org`, `api.github.com` y GitHub Pages.

## Estructura del repo (diapositiva 20)

```
tienda-tarapoto/
├─ index.html        landing + catálogo + blog (#blog/<slug>); CSS y JS en línea, un comentario por sección
├─ admin.html        panel local (noindex, CSP propia, solo funciona en 127.0.0.1/localhost)
├─ 404.html          página de error con rutas ABSOLUTAS /tienda-tarapoto/...
├─ README.md  .nojekyll  .gitignore  .gitattributes  sitemap.xml      (sin robots.txt)
├─ assets/
│  ├─ fonts/         Bricolage Grotesque, Figtree e Instrument Serif (OFL), alojadas aquí
│  └─ img/           brand/ products/ blog/ lookbook/ (WebP < 250 KB)
├─ data/             products.json  articles.json  site.json  schema/ (JSON Schema 2020-12)
├─ n8n/workflows/    workflows exportados y limpios (sin secretos, pinData ni instanceId)
├─ docs/             PLAN.md  CONTRATO.md  RUNBOOK.md  investigacion/
└─ tools/
   ├─ validar.js  test-validar.js   contrato de datos (el mismo código corre en n8n)
   ├─ kpis.js                       cifras únicas (README, /estado y panel)
   ├─ qa.js                         matriz de la diapositiva 16 (parte automatizable)
   ├─ csp.js                        hash del <script> en línea dentro de la CSP
   ├─ limpiar-workflows.js          limpia los exports de n8n antes de cada commit
   ├─ serve.py                      servidor local SOLO en 127.0.0.1:8080, bajo /tienda-tarapoto/
   ├─ iniciar-todo.bat  iniciar-sd-server.bat  detener-sd-server.bat
   ├─ generar-imagenes.mjs  image-prompts.json    imágenes de muestra con IA local
   ├─ ruleset-main.json             protección de main (sin borrado ni force-push)
   └─ hooks/pre-commit              secretos + validador + CSP antes de cada commit
```

## Probar en local (diapositiva 20)

**a) Doble clic en `index.html`** (modo `file://`): se ve el catálogo de la semilla en línea, sin errores de consola. Chrome podría no cargar las fuentes locales en `file://` y usar las del sistema; se acepta, es solo la prueba rápida.

**b) Servidor local, igual que en Pages** (misma subruta `/tienda-tarapoto/`, así se detectan rutas absolutas rotas):

```powershell
python tools\serve.py                      # http://127.0.0.1:8080/tienda-tarapoto/   (Ctrl+C para detener)
```

`serve.py` sirve solo esta carpeta, solo en `127.0.0.1`, no lista carpetas, no entrega archivos ocultos (`.git`, `.env`) y responde `404.html` a las rutas desconocidas, como Pages. Si Windows pregunta "¿Permitir acceso?" para `python.exe`, responde **Cancelar**.

**c) Todo de una vez:** `tools\iniciar-todo.bat` arranca sd-server minimizado, abre `serve.py`, revisa n8n y Ollama y abre el panel.

**d) Verificaciones** (desde la raíz del repo):

```powershell
node tools\validar.js data\products.json data\articles.json data\site.json   # contrato de datos (exit 0 = OK)
node tools\test-validar.js                                                    # pruebas del validador
node tools\qa.js                                                              # matriz de la diapositiva 16
node tools\csp.js --check                                                     # hash del script en línea
node tools\kpis.js --check                                                    # las cifras de este README están al día
```

**Criterios:** ninguna ruta absoluta rota (salvo en `404.html`, a propósito); se ve bien desde 360 px; el modo oscuro funciona; con `http`, si se borra `data/products.json` aparece "Catálogo no disponible" y **no** la semilla.

## Publicar en GitHub Pages (diapositivas 21 y 22)

### Opción A: con comandos (PowerShell)

En PowerShell, no en Git Bash (Git Bash convierte `path=/` en una ruta de Windows).

```powershell
git init -b main
git config user.name "Abner Cayao"
git config user.email "297644875+Abnercayao@users.noreply.github.com"
git config core.hooksPath tools/hooks          # activa el hook pre-commit
git add -A
git commit -m "Sitio inicial: landing + catálogo de muestra"
gh repo create Abnercayao/tienda-tarapoto --public --source . --remote origin --push `
  --description "Catálogo de ropa para el calor - Tarapoto" --homepage "https://abnercayao.github.io/tienda-tarapoto/"
gh api -X POST repos/Abnercayao/tienda-tarapoto/pages -f "source[branch]=main" -f "source[path]=/" -f build_type=legacy
gh api -X PUT  repos/Abnercayao/tienda-tarapoto/pages -F https_enforced=true
gh api -X POST repos/Abnercayao/tienda-tarapoto/rulesets --input tools\ruleset-main.json
gh api repos/Abnercayao/tienda-tarapoto/pages/builds/latest --jq .status    # repetir hasta "built" (al inicio puede dar 404)
curl.exe -sI https://abnercayao.github.io/tienda-tarapoto/                   # HTTP 200
curl.exe -sI http://abnercayao.github.io/tienda-tarapoto/                    # 301 hacia https
```

### Opción B: por la interfaz de GitHub (evidencia para el curso)

1. Crea el repo en https://github.com/new: nombre `tienda-tarapoto`, **Public**, sin README (ya existe). Sube el código con `git remote add origin https://github.com/Abnercayao/tienda-tarapoto.git` y `git push -u origin main`.
2. En el repo: **Settings → Pages**.
3. En **Build and deployment → Source**, elige **Deploy from a branch**.
4. En **Branch**, elige **main** y la carpeta **/ (root)**; pulsa **Save**.
5. Espera 1–10 min. Arriba aparece "Your site is live at https://abnercayao.github.io/tienda-tarapoto/" con el botón **Visit site**. El avance se ve en la pestaña **Actions** (`pages-build-deployment`).
6. En la misma página marca **Enforce HTTPS** (si aparece desmarcado).
7. Protección de `main`: **Settings → Rules → Rulesets → New ruleset → New branch ruleset**. Nombre `proteger-main`, *Enforcement status* **Active**, *Target branches* → **Include default branch**, y marca **Restrict deletions** y **Block force pushes**. Pulsa **Create**. (Es lo mismo que `tools/ruleset-main.json`.)

### Prueba final (diapositiva 22)

- [ ] Carga en una **ventana privada**.
- [ ] La **navegación** funciona (menú, filtros, vista rápida, blog, 404).
- [ ] Las **imágenes** se ven.
- [ ] En el **móvil real** se lee bien.
- [ ] **Candado HTTPS** activo.

Los cambios publicados tardan hasta 6 min (lote del bot) más 1–10 min (build y caché de Pages).

## Checklist de la diapositiva 16, con evidencia

`node tools/qa.js` revisa las filas automatizables y marca como MANUAL lo que se prueba a mano (`node tools/qa.js --json` deja la evidencia en JSON).

| Ítem | Evidencia | Cómo se verifica |
|---|---|---|
| **Verifica:** los totales coinciden con el dataset | Contador del catálogo = productos `activo:true`; las categorías suman el total; semilla en línea = `products.json`; `/lista` del bot; total de WhatsApp = suma de las líneas | `node tools/qa.js` (filas "Totales"); `/lista` y la bolsa, a mano (F7 y F3) |
| **Verifica:** los filtros alteran las métricas correctamente | Lista escrita de casos por filtro y combinación, incluida la URL | Prueba manual del equipo F |
| **Verifica:** unidades y porcentajes consistentes | Siempre "S/ 69.90" (`Intl` `es-PE`, PEN); el % de descuento sale de `porcentajeDescuento()` de `tools/kpis.js` | `node tools/qa.js` (fila "Unidades") |
| **Verifica:** los hallazgos citan el dato que los sustenta | Cada tarjeta tiene `data-id`; "Nuevo" sale de `fecha_creacion`; envío y horario de `site.json`; cada commit cita `id`, origen y borrador | `node tools/qa.js`; `git log` (`data(products): actualizar prd-0007 precio 69.90 [telegram draft:ab12]`) |
| **Revisa:** Word y PPT usan los mismos KPIs | Este README, `/estado` y el panel toman las cifras de `tools/kpis.js` sobre los mismos JSON | `node tools/kpis.js --check` y fila "README usa las mismas cifras" de `qa.js` |
| **Revisa:** cada recomendación tiene responsable o siguiente paso | Toda respuesta del bot y todo aviso de error terminan en "Siguiente paso: …"; el runbook asigna un responsable a cada tarea | `docs/RUNBOOK.md`; pruebas del bot (F7) |
| **Revisa:** los datos sensibles se manejan según las políticas | Cero tokens en el repo (hook, `qa.js` y validador); imágenes sin EXIF/GPS; fotos sin rostro y niños sin personas; aviso de que `data/` es público | `node tools/qa.js` (filas "Datos sensibles"); hook `pre-commit` |
| **Revisa:** las decisiones de impacto alto pasan por revisión humana | Toda escritura es borrador + Publicar; doble confirmación en `/borrar`, `/limpiar_muestras` y `/whatsapp`; roles | Pruebas 4–6, 9, 17 y 18 de F7 |
| **Regla de cierre:** lo atractivo también es verificable | Lighthouse ≥ 90 en rendimiento y ≥ 95 en accesibilidad, buenas prácticas y SEO, más las filas anteriores | Chrome DevTools → Lighthouse en local y en Pages |

## El bot de Telegram

**Uso diario:** manda al bot una **foto** de la prenda (como foto, no como archivo) con el nombre, precio, tallas y colores en el texto. El bot responde "Recibido", arma un borrador con IA (los campos que dedujo llevan "(sugerido por IA)") y muestra los botones **Publicar** / **Cancelar**. Si falta algo, pide solo eso. Al tocar Publicar, el cambio sale en el siguiente lote.

**Fotos:** personas adultas **sin mostrar el rostro** (de hombros o cuello hacia abajo). Ropa de **niños: sin personas** (prenda extendida o en percha). Siempre como foto, nunca como documento (los documentos pueden traer GPS).

| Comando | Qué hace | admin | dueño | marketing |
|---|---|:-:|:-:|:-:|
| `/ayuda`, `/lista`, `/ver <id>`, `/estado`, `/historial` | Consultas (el `/estado` usa las cifras de `tools/kpis.js`) | sí | sí | sí |
| foto o texto libre, `/precio <id> <n>`, `/stock <id> <talla> <n>`, `/ocultar <id>`, `/mostrar <id>`, `/foto <id>` | Crear y editar productos (siempre como borrador) | sí | sí | sí |
| `/articulo <tema>`, `/articulo_editar <id>`, `/articulo_ocultar <id>` | Artículos del blog | sí | sí | sí |
| `/imagen <prompt>` y botones Portada / Hero / Lookbook / Descartar | Imagen con la IA local | sí | sí | sí |
| Publicar / Cancelar | Confirma o descarta **sus** borradores | sí | sí | sí |
| `/borrar <id>` (doble confirmación) | Quita un producto | sí | sí | no |
| `/whatsapp <número>` (confirmación especial) | Cambia el número de pedidos | sí | sí | no |
| `/limpiar_muestras` (confirma el número exacto) | Quita los productos de muestra | sí | sí | no |
| `/deshacer`, `/pausa`, `/reanudar` | Revierte el último commit del bot; pausa o reanuda las publicaciones | sí | sí | no |

Roles: **admin** (Abner, demo y soporte), **dueño** y **marketing**. La lista vive en la fila `AUTORIZADOS` de la Data Table `config` de n8n: `[{"id": <from.id>, "rol": "admin|dueno|marketing", "nombre": "..."}]`. Un `id` en `0` no autoriza a nadie. Los mensajes de cualquier otra persona, o de grupos, se ignoran.

## Panel local (`admin.html`)

Solo funciona en la PC de la tienda (`127.0.0.1`/`localhost`); en GitHub Pages muestra "Panel solo disponible en la PC de la tienda" y no hace ninguna petición.

- Estado en vivo de **n8n**, **Ollama** y **sd-server**, con el siguiente paso si alguno no responde.
- **Crear imagen con IA:** tipo (hero, lookbook, blog, producto de muestra), plantillas de la marca, tamaño y semilla. "Crear imagen" pasa por n8n (`POST /webhook/crear-imagen` con la cabecera `X-Tienda-Key`, que se pide al usarla y vive solo en `sessionStorage`), respeta el turno de la GPU y manda la imagen a Telegram. "Generar sin n8n" llama directo a sd-server. Con personas, genera más alto y recorta arriba para que no asome el mentón. Botones Descargar y Copiar prompt.
- Atajos: **Abrir Open Generative AI** (copia el prompt y explica cómo abrir la app desde el menú Inicio; no se registra ningún protocolo), **Abrir UI de sd-server**, el formulario de n8n (`/form/tienda`) y el editor de n8n.
- **Cifras del catálogo** (las mismas de este README) y **Estado del bot** (`GET /webhook/estado`).

## Pasos que solo puedes hacer tú

El equipo no introduce tokens, contraseñas ni ajustes de seguridad. Haz esto en orden:

1. **Bot de Telegram.** En @BotFather: `/newbot`, luego `/setjoingroups` → Disable. Pega el token en **dos sitios**: la credencial **"Telegram Tienda"** (`telegramApi`) de n8n y la fila `BOT_TOKEN` de la Data Table `config`. Activa la verificación en dos pasos de tu Telegram. No publiques el @usuario del bot.
2. **Rellenar `AUTORIZADOS`.** Cada persona (admin, dueño, marketing) escribe `/start` al bot; ejecuta **WF0 Setup** en n8n, copia los `from.id` que muestra y ponlos en la fila `AUTORIZADOS` de `config` con su rol. Los `from.id` no son secretos.
3. **Token de GitHub (PAT fine-grained),** después de crear el repo. En https://github.com/settings/personal-access-tokens/new: *Only select repositories* → `tienda-tarapoto`; **Contents: Read and write** (opcional Pages: Read); caducidad **90 días**. En n8n, credencial `githubApi` con servidor `https://api.github.com` y usuario `Abnercayao`. El bot avisa 14 días antes de que caduque.
4. **Clave del panel.** En n8n, crea una credencial **Header Auth** con nombre de cabecera `X-Tienda-Key` y un valor largo que inventes. Es la clave que pide el panel.
5. **Asignar credenciales y publicar los workflows.** En n8n, abre cada workflow importado, asigna las credenciales (Telegram, GitHub, Header Auth) y pulsa **Publish**.
6. **Confirmar los datos de la tienda:** días de atención (hoy dice "Todos los días"), dirección exacta, zonas y costo de reparto, medios de pago, política de cambios y redes. Verifica la marca en INDECOPI y consulta a un asesor sobre el Libro de Reclamaciones y la Ley 29733.
7. **Pruebas tuyas:** la diapositiva 22 en tu móvil real; desde la misma Wi-Fi, confirma que `http://<IP-de-la-PC>:5678` y `:8080` **no** responden. No aceptes avisos del Firewall para `python`, `sd-server` u `ollama`.

## Runbook resumido

Detalle completo, con responsables: **[docs/RUNBOOK.md](docs/RUNBOOK.md)**.

| Situación | Qué hacer |
|---|---|
| Arrancar | Inicia sesión en la PC (Docker Desktop y Ollama arrancan solos). Para imágenes: `tools\iniciar-todo.bat` o `tools\iniciar-sd-server.bat`. |
| Detener | `tools\detener-sd-server.bat` libera la GPU. Ollama: icono de la bandeja → Quit. n8n: Docker Desktop → detener `n8n` (el bot deja de responder). |
| La PC estuvo apagada | Al volver, el bot avisa "Volví; tengo N mensajes pendientes". Telegram guarda los mensajes **24 h**; lo más antiguo hay que reenviarlo. |
| El bot no responde | Revisa el panel: n8n en línea y WF1 publicado. Si Ollama no responde, el bot manda una plantilla para completar a mano. |
| Un cambio no aparece en la web | `/historial` para ver el commit; espera hasta 6 min + 10 min de Pages; recarga sin caché. |
| Algo se publicó mal | `/deshacer` (admin o dueño): crea un commit **nuevo** que restaura los datos anteriores. `/pausa` detiene las publicaciones. |
| Se filtró un token | Telegram: `/revoke` en @BotFather y pega el nuevo en sus **2 sitios**. GitHub: revoca el PAT y crea otro. Panel: cambia el valor de `X-Tienda-Key`. |

## Seguridad y privacidad

- Repo y sitio **públicos**: ningún token en el repo. Barreras: hook `tools/hooks/pre-commit` (activar con `git config core.hooksPath tools/hooks`), `tools/qa.js`, el validador y `tools/limpiar-workflows.js` para los exports de n8n.
- El token del bot vive en la credencial de n8n y en la Data Table `config`; el PAT, solo en la credencial de n8n; la clave del panel, en `sessionStorage` del navegador.
- Imágenes: WebP sin EXIF; personas sin rostro; niños sin personas. Las imágenes de IA solo se usan en hero, lookbook, blog y productos **de muestra**, siempre con "Imagen referencial (IA)"; los productos reales no admiten imágenes de IA (lo impide el validador).
- Testimonios: solo reales y verificados. Si no hay, la sección no aparece.

## Créditos y licencias

- Fuentes Bricolage Grotesque, Figtree e Instrument Serif: SIL Open Font License (`assets/fonts/OFL-*.txt`).
- Imágenes de muestra generadas en local con Z-Image Turbo (Apache-2.0) mediante el motor de Open Generative AI (`sd-server` de stable-diffusion.cpp).
- Skill de diseño `frontend-design` de `anthropics/skills` en `.claude/skills/` (ver su `LICENSE.txt`).
