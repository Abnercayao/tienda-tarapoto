# Pruebas n8n v1 — contenedor desechable + revisión adversarial

Fecha: 2026-10-07. n8n 2.40.7 (`docker.n8n.io/n8nio/n8n:2.40.7`, imagen local). Contenedor de prueba `n8n-prueba` en `127.0.0.1:5699`, **borrado al terminar**. El contenedor real `n8n` no se tocó.
Sin bot real: `BOT_TOKEN` falso con formato válido (Telegram responde 401/404) y credenciales = `n8n/reference/credenciales.plantilla.json` (GitHub responde 401 → **nada se publica**). Ollama real (`host.docker.internal:11434`, `qwen3.5:4b-q4_K_M`). sd-server estaba apagado.

## Cómo repetirlas

```
node n8n/validar-workflows.js --estricto      # estático
node n8n/tools/probar-nucleo.js               # Code nodes reales, datos simulados (WF0,1,2,5,9)
node n8n/tools/probar-negocio.js              # ídem WF3, WF4 (+ --ollama para 5 llamadas reales)
node n8n/tools/probar-negocio-b.js            # ídem WF6, WF8
node n8n/tools/probar-contenedor.js           # n8n REAL en contenedor desechable (~5 min; --dejar para inspeccionar)
```

`probar-contenedor.js` importa los 9 workflows + 4 de prueba (`pbTest…`, solo existen en el contenedor desechable):
WF0 con webhook `t-setup` (en vez del disparador manual), WF3 con webhook `t-wf3` y los GET de GitHub sin credencial (repo público, solo lectura),
un workflow para sembrar/leer tablas (`t-config`, `t-inbox`, `t-borrador`, `t-dump`) y uno que falla a propósito con el lock tomado (errorWorkflow = WF9).
Publica con `n8n publish:workflow --id` + `docker restart` (WF1/WF2 al final, cuando ya hay tablas y filas sembradas) y deja correr los schedules de 10 s.

## Resultados reales (última corrida)

| Prueba | Resultado |
|---|---|
| `validar-workflows.js` (normal y `--estricto`) | 9 archivos, 0 errores, 0 avisos |
| `probar-nucleo.js` / `probar-negocio.js` / `probar-negocio-b.js` | 76 / 86 / 68 ok, 0 fallos |
| `probar-contenedor.js` | **44 ok, 0 fallos** |

Detalle de `probar-contenedor.js`:

- **Importación**: credenciales (3) e `import:workflow --separate` de los 9 a la primera, ids fijos conservados; `publish:workflow` + reinicio sin errores de activación (webhooks de WF8 y schedules de WF1/WF2 registrados).
- **WF0**: crea las 5 tablas, 17 claves en `pb_config` y el lock `worker`; 2.ª corrida idempotente; sin token → "Falta token"; con token falso → `getMe` falla y lo informa sin romperse.
- **WF8**: `/estado` sin clave 403, clave errónea 403, con clave 200 JSON + `Access-Control-Allow-Origin: http://localhost:8080` + `Cache-Control: no-store`; preflight `OPTIONS` 204 para `http://127.0.0.1:8080`; `crear-imagen` sin clave 403, pedido inválido 400 con `siguiente_paso`, válido con sd-server apagado → 502 JSON y **lock liberado**.
- **WF3 + Ollama real (desde el contenedor)**: "Polo de lino blanco para hombre, 59.90 soles, tallas S M L" → borrador `crear producto` con precio 59.9, `hombres`, S/M/L en **8 s**. "Elimina el producto prd-0001" (marketing) → nunca `eliminar` (solo existe por `/borrar`); propone `desactivar` reversible que igual exige Publicar (4 s).
- **WF9**: ejecución que falla con el lock tomado → WF9 libera el lock (`holder` = id de la ejecución fallida) y anota `ALERTAS["<nombre del workflow>|<nodo>"]`.
- **WF1 + WF2 en vivo** con 12 filas sembradas en `pb_inbox` (procesadas una por tick, todas terminan):

| update_id | Caso | Estado final |
|---|---|---|
| 1001 | `/ayuda` admin → WF4 | hecho |
| 1002 | `/borrar` marketing → "sin permiso", sin borrador | hecho |
| 1003 | autor que ya no está en `AUTORIZADOS` | error "no autorizado" (sin responder) |
| 1004 | nota de voz → mensaje fijo | hecho |
| 1005 | botón Publicar de un borrador ajeno | hecho (rechazado; borrador intacto) |
| 1006 | botón de una vista previa vieja (`message_id` distinto) | hecho (rechazado) |
| 1007 | botón Publicar válido → `aprobado` → lote | hecho; el lote falla en `GET ref` (401) y tras 3 intentos el borrador queda `error`, **nunca** `publicado` |
| 1008 | `/pausa` marketing | hecho (sin permiso; `PAUSA` sigue en 0) |
| 1009 | `/estado` dueño | hecho |
| 1010 | texto libre → WF3 real sin acceso a GitHub | `reintentar` ×3 → error + aviso |
| 1011 | Publicar en borrador de doble confirmación (`eliminar`) | `confirmaciones=1`, sigue `pendiente` (pide Confirmar) |
| 1012 | `callback_data` inválido | hecho (rechazado) |

  Además: WF1 con token falso suma `FALLOS_SEGUIDOS` sin romperse; lock `worker` libre al final; **0 ejecuciones con error** guardadas en todo el recorrido (salvo la de prueba de WF9).

Observación: con `saveDataSuccessExecution:"none"` n8n 2.40.7 deja la fila de la ejecución con `status:"running"` y `deletedAt` puesto (borrado lógico); no son ejecuciones colgadas.

## Revisión adversarial

| Punto | Veredicto |
|---|---|
| WF1: inbox antes del ACK | OK. `rowNotExists`+`insert` (A6, idempotente por `update_id`) **sin** `continueOnFail`: si la inserción falla no hay ACK y Telegram reentrega. Duplicados por solapamiento de ticks se absorben en WF2. |
| WF1: AUTORIZADOS + chat privado | OK. Solo `chat.type=private`, `chat.id == from.id`, `from.id` en `AUTORIZADOS` con id > 0 y rol válido; bots fuera; extraños solo se anotan en `DESCONOCIDOS`. WF2 recalcula el rol (probado: 1003). |
| WF2: lock | OK. `UPDATE … WHERE nombre=worker AND hasta<now` (atómico) + IF `holder === $execution.id`; lease 15 min > `executionTimeout` 14 min; se libera solo con `holder` propio; WF9 libera el de una ejecución caída (probado). |
| Callbacks | OK. Autor = `from_id`, `preview_message_id` vigente, `estado=pendiente`, permiso del rol actual, formato estricto de `callback_data`; cada transición con filtro de estado previo (0 filas = nada). Probado en vivo (1005–1007, 1011, 1012). |
| Permisos por rol | OK. `puede()` de validar.js en WF4 (comandos), WF3 (operación) y WF5 (al aprobar). Marketing sin `/whatsapp /limpiar_muestras /borrar /deshacer /pausa /reanudar` (probado `/borrar`, `/pausa`). El LLM no puede producir `eliminar`/`limpiar_muestras`/`deshacer`/`whatsapp`. |
| Borrador obligatorio | OK. Toda escritura al repo pasa por `pb_borradores` + botón; WF8 solo crea borradores. Control inmediato sin repo: `/pausa`, `/reanudar`, `/cancelar`. |
| D5 y 422 | OK (simulado): 422 en PATCH → espera 2–5 s y reinicia desde GET ref (máx. 3); 422 en tree/commit no reintenta; idempotencia por `borradores_aplicados`. En vivo solo el camino 401. |
| Expresiones n8n | OK. Solo `$json`, `$execution.id`, `$('Nodo').first()/.all()` (sin `.item`, sin problemas de pairedItem) y `isExecuted` protegido con try; nada falló en vivo. |
| Secretos | OK. Sin tokens en `n8n/**` ni `docs/N8N*.md` (credenciales = `PEGAR_EN_LA_UI_DE_N8N`; el token falso de las pruebas se arma en memoria). Mensajes de error censurados. Fuera de alcance: `tools/test-validar.js` tiene tokens de ejemplo obviamente falsos (prueba del detector). |

### Corregido en esta revisión

1. **WF3 — borradores huérfanos si Telegram no entrega la vista previa** (visto en vivo: quedaba `pendiente` sin botones; WF2 reintenta y creaba otro, hasta 3 por mensaje, y "completar" podía tomar uno de esos). Ahora "Preview enviado" + "Guardar preview id" pasan ese borrador nuevo a `error` ("vista previa no enviada"). Probado en vivo y en `probar-negocio.js`.
2. **WF5 — borradores atascados en `publicando`** si n8n se detiene a mitad de la cadena D5 (apagón de la PC, reinicio): nunca se volvían a intentar ni se avisaba. Ahora el lote lee `aprobado` **o** `publicando` (WF2 también, para dispararlo); el huérfano se reintenta con `intentos+1` (con 3 → `error`) y, si el commit ya había llegado, Aplicar lote lo da por publicado. Probado en vivo (`drf-prueba03`) y en `probar-nucleo.js`.
3. `validar-workflows.js`: admite `anyCondition` solo en lecturas tipo "IN" (todas `eq` sobre la misma columna); update/delete siguen exigiendo `allConditions`.
4. `ARQUITECTURA-N8N.md`: los generadores reales son `construir-nucleo.js`, `construir-negocio-a.js`, `construir-negocio-b.js` (no existe `ensamblar.js`); documentados los dos cambios y `probar-contenedor.js`.

Los cambios se hicieron en `n8n/src/**` y `n8n/tools/construir-*.js` y se regeneraron los JSON (diff: solo los nodos tocados).

## Pendiente (no probado sin credenciales reales)

- Con token real: getUpdates→inbox→ACK de punta a punta, descarga de fotos (`file get`), `sendPhoto` de WF6, botones reales.
- Con PAT real y sobre una rama/repo de prueba: la cadena D5 completa (blobs, tree, commit, PATCH, 422 real).
- sd-server encendido: generación + recorte "sin rostro" de WF6 desde Telegram y desde el panel.
- Sin limpieza en v1 de las imágenes (`pb_imagenes`) de borradores en `error`; queda para WF10 (v1.1), junto con expirar borradores > 24 h y el inbox atascado (`procesando` con 2 intentos).
- Residual: si un WF2 supera su `executionTimeout` (14 min) mientras un sub-workflow sigue corriendo, n8n no garantiza cortar el sub; el siguiente lote lo absorbe por idempotencia (PATCH `force:false` + `borradores_aplicados`).
