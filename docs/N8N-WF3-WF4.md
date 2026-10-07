# WF3 Borrador-IA y WF4 Comandos (n8n v1) — Palmera Brava

Complementa `n8n/ARQUITECTURA-N8N.md` (§6 WF3/WF4, §8 textos) y `docs/CONTRATO.md` (§8 borrador, §9 permisos, §10–11 LLM).

## Archivos

| Archivo | Qué es |
|---|---|
| `n8n/workflows/WF3-borrador-ia.json`, `WF4-comandos.json` | Generados (no editar a mano). |
| `n8n/tools/construir-negocio-a.js` | Generador: `node n8n/tools/construir-negocio-a.js`. |
| `n8n/src/negocio/wf3.js`, `wf4.js` | Código de cada nodo Code (secciones `//// <Nodo>`). |
| `n8n/src/negocio/comun-negocio.js` | Ayudas compartidas (`// @incluir negocio`): vista previa, plantilla manual, operaciones de comandos, permisos. |
| `n8n/prompts/extraccion.md` | Prompts del LLM (producto y artículo), sacados de CONTRATO §10–11. El generador los copia a "Cuerpo Ollama" y avisa si difieren de `tools/validar.js`. |
| `n8n/tools/probar-negocio.js` | Pruebas de los nodos Code reales (`--ollama [--articulo]` = prueba real con Ollama del host). |

Flujo de cambio: editar `src/negocio/*` o `prompts/extraccion.md` → `node n8n/tools/construir-negocio-a.js` → `node n8n/validar-workflows.js` → `node n8n/tools/probar-negocio.js` → reimportar y **volver a publicar** WF3/WF4.

## WF3 (sub-workflow; lo llaman WF2 y WF4)

`Entrada → config → Preparar → borrador previo (completar) → GitHub products/articles/site → ¿fotos? (Telegram file get+download con pbCredTelegram01 → Edit Image 1200 px WebP → base64 + medidas) → ¿IA? (Cuerpo Ollama → /api/chat → validarOperacion → 1 reintento si corrigió a "crear") → Armar borrador → insert/update pb_borradores (+ pb_imagenes) → vista previa → preview_message_id → {ok, draft_id}`.

- Ollama: `format` = `data/schema/ollama-format-*.json`, `think:false`, `num_ctx 8192`, `stream:false`, `keep_alive "2m"`, hasta 3 fotos, timeout 180 s. Prompt de `prompts/extraccion.md` + catálogo `id | nombre | categoria | precio`.
- Corrección determinista (validar.js) + **1 reintento** con la nota "es un producto NUEVO". Si el reintento falla o sale peor, se usa la 1.ª respuesta ya corregida. Si el texto ya dice la categoría, no se marca "(sugerido por IA)".
- **Faltantes bloqueantes** (desvío consciente): el LLM lista también opcionales (material, stock…); solo bloquean Publicar los obligatorios de la operación (crear: nombre, categoría, precio, tallas, colores; stock: id, stock_tallas; agregar_imagen: id, foto; actualizar: id, algún campo). Con faltantes: "Me falta: …" y **solo** botón Cancelar; la respuesta del autor entra como `completar` (mismo draft, se quita el teclado anterior). Lo que dice el dueño pisa lo anterior; lo que la IA deduce de nuevo no pisa lo que ya había.
- **IA caída**: borrador con las fotos ya guardadas + plantilla `nombre/categoria/precio/tallas/colores`; la plantilla llena se completa **sin IA** (parser determinista). Si el texto pedía un cambio, sugiere `/precio`, `/stock`, `/ocultar`. Artículos: mensaje de reintentar.
- Antes de crear el borrador se revisa contra el catálogo lo que WF5 rechazaría (oferta ≥ precio, stock negativo, talla de otra categoría, ya oculto/visible, id inexistente) y se responde con el motivo.
- `campos` guarda los campos internos (WF5 acepta ambos formatos). `confirmaciones_requeridas = 2` para eliminar, limpiar_muestras, deshacer y whatsapp.
- Salida `{ok:false, reintentar:true}` si GitHub no responde o Telegram no entrega la vista previa (WF2 reintenta, máx. 3).

## WF4 (sub-workflow de WF2)

Permiso con el rol actual (`puede()`); marketing recibe "Tu rol (marketing) no puede usar /x" en `/borrar /whatsapp /limpiar_muestras /deshacer /pausa /reanudar`; `/ids` solo admin.

| Comando | Qué hace |
|---|---|
| `/start`, `/ayuda` | Ayuda según rol. |
| `/lista [hombres\|mujeres\|ninos\|accesorios\|ocultos\|muestras\|articulos]`, `/ver <id>` | Lee GitHub (rama de `pb_config`). |
| `/estado` | Cola de `pb_inbox`, aprobados, pausa, tus pendientes, último commit. |
| `/historial` | WF5 `modo:"historial"`. |
| `/precio <id> <n> [oferta <n> \| sin oferta]`, `/stock <id> <talla> <n\|+n\|-n> …`, `/ocultar`, `/mostrar` (prd o art), `/articulo_ocultar`, `/foto <id>` (leyenda de foto/álbum) | Operación → WF3 (borrador + Publicar). |
| `/borrar <id>`, `/whatsapp <51…>` | Borrador con doble confirmación (WF5). WhatsApp rechaza números de ejemplo. |
| `/limpiar_muestras` | Responde cuántos hay; el borrador solo se crea con `/limpiar_muestras <número exacto>` (+ doble confirmación; WF5 vuelve a comprobar el número). |
| `/deshacer` | WF5 historial (`enviar:false`) → solo si HEAD es del bot → borrador con `head_sha` (WF5 lo verifica al publicar). |
| `/articulo <tema>` | WF3 `modo:"llm"`, artículo (Ollama redacta → borrador). |
| `/imagen [art-0001\|look-1] <prompt>` | WF6 (`pbWf06Imagen0000`) con `{prompt, objetivo, chat_id, from_id, rol, origen:"telegram"}`. |
| `/pausa`, `/reanudar` | `PAUSA` en `pb_config` (sin borrador). |
| `/cancelar` | Tus `pendiente` → `cancelado`, quita teclados y borra sus fotos. |

## Pruebas (2026-10-06)

- `node n8n/validar-workflows.js`: 0 errores (aviso: falta `WF6-imagen-ia.json`, lo genera otra tarea).
- `node n8n/tools/probar-negocio.js`: 85/85 (nodos Code reales con datos simulados; los borradores de WF3 se aplican con el "Aplicar lote" real de WF5: crear con 2 fotos, artículo, /precio, /stock, /foto, /borrar, /whatsapp → publicados).
- `--ollama --articulo` (qwen3.5:4b-q4_K_M en el host, cuerpo exacto de WF3): 5/5 productos correctos (dama → mujeres, gorro niños → ninos, "llegaron 5 más de la M del prd-0003" → stock sumar 8→13, camisa parecida a prd-0001 → crear, foto + texto → crear con color inferido); 2,3–6,4 s por llamada (≈1 780 tokens de prompt; 2 548 con una foto 768×1024). Artículo: 18 bloques, ≈580 palabras, 15 s. Al final `keep_alive:0` y el modelo quedó fuera de la VRAM.
- Contenedor desechable `n8n:2.40.7` (`--rm`): WF3 y WF4 importan; la rama de fotos (Edit Image → "Fotos procesadas") corre en el task runner real: WebP correcto, medidas de la cabecera, ítem fallido → `ok:false`.

## Pendientes / riesgos

- **Calidad WebP**: `options.quality` no tiene efecto en 2.40.7 (mismo tamaño con 20 y 80) → calidad por defecto de GraphicsMagick; se quitó la opción.
- No probado con token real: `file get` + descarga de Telegram, ni la cadena completa dentro de n8n (requiere credenciales y Data Tables reales; fase de importación).
- El LLM a veces inventa `stock_tallas` (1 por talla) cuando hay foto; se ve en la vista previa y se corrige con `/stock`.
- Si Telegram no entrega una vista previa, WF2 reintenta y queda un borrador huérfano `pendiente` sin `preview_message_id` (vence a las 24 h con WF10, v1.1).
- **v1.1 (fuera de v1)**: WF7 Form-Admin y WF10 Salud (expirar borradores, reintentar inbox atascado, aviso de vencimiento del PAT, salud de Ollama/sd-server); `/articulo_editar`, datos de la tienda (horario, envío, redes), notas de voz.
