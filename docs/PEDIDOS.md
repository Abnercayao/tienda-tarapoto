# Pedidos, Mercado Pago (modo prueba) y seguimiento — Palmera Brava v3

Cómo funciona el checkout de la demo: la web arma el carrito, **n8n** crea el pedido `PB-000101…` con los precios y el stock **publicados**, cobra con **Mercado Pago Checkout Pro en modo prueba**, confirma el pago, avisa por Telegram, descuenta el stock y deja seguir el pedido desde la web, desde el chat con **Vale** y desde el bot.
Reglas de datos: `docs/CONTRATO.md` §00.4–00.9 (funciones `crearPedido`, `preferenciaMercadoPago`, `aplicarPagoMP`, `transicionPedido`, `vistaPublicaPedido` de `tools/validar.js`). Arquitectura: `n8n/ARQUITECTURA-N8N.md` §12. Investigación: `docs/investigacion/mercadopago-envios.md`.

## 1. Piezas

| Pieza | Qué hace |
|---|---|
| **WF13 Pedido-Crear** (`pbWf13PedCrear00`) | `POST /webhook/pedido-crear`. Valida, recalcula con el catálogo publicado, reserva el número, guarda en `pb_pedidos`, crea la preferencia de MP y avisa "Nuevo pedido". |
| **WF14 MP-Notificacion** (`pbWf14MpNotif000`) | `POST /webhook/mp-notificacion` (aviso de MP), `POST /webhook/pedido-pago` (la web al volver de MP) y sub-workflow (bot). Consulta `GET /v1/payments/{id}`, aplica el pago, avisa y crea los borradores de stock. |
| **WF15 Pedido-Seguimiento** (`pbWf15PedSegui00`) | `POST /webhook/pedido-seguimiento` y sub-workflow (chat Vale): número + correo → estado e historial públicos. |
| **WF16 Pedidos-Bot** (`pbWf16PedBot0000`) | Sub-workflow de WF4: `/pedidos`, `/pedido`, `/preparando`, `/enviar`, `/recojo`, `/entregado`, `/cancelar_pedido`, `/envios`, `/desconocidos`, `/autorizar`, `/desautorizar`. |
| `pb_pedidos` (Data Table) | Una fila por pedido (`COLUMNAS_PB_PEDIDOS`); el pedido completo en `pedido_json`. **Nunca va al repo.** |
| `tools/chat-proxy.py` | Única puerta pública (túnel Cloudflare): solo las rutas de la tabla 2. |
| Credencial **Mercado Pago Prueba** (`pbCredMercPago01`) | Header Auth `Authorization: Bearer <Access Token de PRUEBA>`. Solo la rellena el usuario en la UI de n8n. |

Código: `n8n/src/pedidos/` (`construir-pedidos.js`, `wf13.js`…`wf16.js`, `comun-pedidos.js`). Los JSON de `n8n/workflows/` se generan: `node n8n/src/pedidos/construir-pedidos.js`.

## 2. Rutas para la web (todas POST JSON, por el proxy; `https://<túnel>.trycloudflare.com` o `http://127.0.0.1:8787` en esta PC)

| Ruta pública | Webhook | Cuerpo | Respuesta (HTTP 200 salvo que se indique) |
|---|---|---|---|
| `/pedido` | `pedido-crear` | `{cliente{nombre, correo, telefono, dni?}, envio{opcion, departamento, provincia, distrito, direccion?, referencia?, agencia_destino?}, items[{id, color, talla, cantidad}], total_visto?, origen:"web"\|"chat"}` | `{ok:true, numero, total, moneda, init_point, modo_pago:"prueba"\|"simulado", simulado, pedido:<vista pública>, aviso?, aviso_total?}` · `{ok:false, errores:[texto]}` (datos, precio, stock, envío) · 429 límite · 503 `{reintentar:true}` · 502 MP caído (con `numero`) |
| `/seguimiento` y `/pedido/consultar` | `pedido-seguimiento` | `{numero, correo}` | `{ok:true, pedido:<vista pública>}` · `{ok:false, motivo:"no_encontrado"}` (igual si falla el número o el correo) · 400 `datos_invalidos` · 429 `limite` |
| `/pedido/pago` | `pedido-pago` | `{numero, payment_id?}` (`payment_id` de la URL de vuelta; `"SIMULADO"` en modo simulado; sin él se busca por número) | `{ok:true, numero, estado, estado_texto, pago_estado, simulado?}` · `{ok:false, motivo}` |
| `/mp-notificacion` (y `/mp/notificacion`) | `mp-notificacion` | aviso de Mercado Pago | 200 `{ok:true}` al instante (solo servidor a servidor: con `Origin` de navegador → 403) |

- **Vista pública** (`vistaPublicaPedido`): número, fechas, estado y textos, **solo el primer nombre**, ítems, totales, opción y tiempo de envío, departamento y distrito, agencia, código y URL de rastreo, historial; `pago.init_point` solo si sigue pendiente de pago. **Nunca** correo, celular, DNI, dirección ni apellidos.
- **Vuelta de Mercado Pago**: `back_urls` sin `#`: `https://abnercayao.github.io/tienda-tarapoto/?mp=ok|pend|err&pedido=PB-000101` (MP añade `payment_id`, `status`, `external_reference`…). La web lee `location.search`, llama a `/pedido/pago {numero, payment_id}`, limpia la URL (`history.replaceState`) y navega a `#/pedido/PB-000101`. **El `?status=` de la URL nunca prueba un pago**: manda la respuesta de n8n.
- **Modo pago simulado** (credencial aún con el placeholder o `MP_MODO=simulado`): `init_point` = `…/tienda-tarapoto/?mp=ok&pedido=PB-…&payment_id=SIMULADO&status=approved&simulado=1`. La web lo trata igual que la vuelta de MP (llama a `/pedido/pago` con `SIMULADO`) y debe mostrar `aviso` ("Pago simulado (demo)… No se cobra nada"). Solo los pedidos creados en modo simulado (`preference_id` `SIM-…`) aceptan `SIMULADO`.
- Proxy: JSON ≤ 8 KB (`/pedido`, `/mp-notificacion`) o ≤ 2 KB; por IP y minuto: 5 pedidos, 15 seguimientos, 15 pagos; CORS solo `https://abnercayao.github.io`, `http://127.0.0.1:8080`, `http://localhost:8080`. En n8n: 6 pedidos por IP y 60 en total cada 10 min; seguimiento 20 consultas y 8 fallos por IP cada 10 min.

## 3. Estados y bot

`pendiente_pago → pagado → preparando → enviado → listo_recojo → entregado`, o `cancelado` (transiciones de `TRANSICIONES_PEDIDO`; cada paso queda en `historial`).

| Comando (Telegram) | Quién | Efecto |
|---|---|---|
| `/pedidos` | todos (marketing sin datos de contacto) | abiertos: por pagar, pagados, en preparación (máx. 15) |
| `/pedido PB-000101` | todos (marketing sin contacto) | detalle + siguiente paso; si sigue pendiente con MP real, **reconsulta el pago** (WF14, por si el aviso no llegó) |
| `/preparando PB-000101` | admin, dueño | → preparando |
| `/enviar PB-000101 shalom 12345678-ABCD` · `olva 26-0123456` · `bus Movil Bus:0012345` · `local` | admin, dueño | → enviado con agencia, código (formato validado) y URL de rastreo (Shalom: `shalom.com.pe/rastrea`; Olva: `tracking.olvacourier.com/?q=<código>`). La clave de 4 dígitos de Shalom **nunca** se guarda: se envía al cliente por privado |
| `/recojo PB-000101` | admin, dueño | → listo para recoger (no en entrega local) |
| `/entregado PB-000101` | admin, dueño | → entregado |
| `/cancelar_pedido PB-000101` | admin, dueño | pide confirmación con botón (10 min); si estaba pagado recuerda devolver el dinero en Mercado Pago |
| `/envios` | todos | opciones, costo desde, tiempos y envío gratis (de `site.json`, lo mismo que web y Vale) |
| `/desconocidos` | admin, dueño | últimos 10 que escribieron `/start` sin estar autorizados (id, nombre, fecha) |
| `/autorizar 123456789 dueno\|marketing` | admin, dueño | botón Confirmar → entra a `AUTORIZADOS` al instante, recibe su menú y una bienvenida. **`admin` nunca se asigna por el bot**; nadie se cambia a sí mismo |
| `/desautorizar 123456789` | admin, dueño | botón Confirmar → sale de `AUTORIZADOS` al instante (se borra su menú). Nunca a un admin |

Avisos automáticos a admin y dueño: **Nuevo pedido** (con datos del cliente, por privado), **Pago confirmado** (real o SIMULADO), **Pago rechazado** y devolución informada por MP.
Alta de Emily (dueña): ella escribe `/start` al bot → un admin usa `/desconocidos` y `/autorizar <su id> dueno` → Confirmar. (O como antes: `AUTORIZADOS` en `pb_config` + WF0.)

## 4. Stock

Al confirmarse el pago, WF14 crea **un borrador `stock` por producto** (modo `restar`, por color y talla, rol `dueno`, origen `pedido`) en `pb_borradores` con estado **aprobado**. WF2 llama a WF5 en el siguiente lote (respeta `PAUSA` y los 6 min entre commits) y queda un commit `data(products): stock prd-0019 … [pedido draft:drf-…]`; el primer admin/dueño recibe "Publicado". Si el stock ya no alcanza (dos ventas casi juntas), WF5 marca el borrador `error` y avisa: hay que corregir con `/stock`.
Límite conocido: entre el pago y la publicación (≈ 6–15 min + GitHub Pages) la web todavía muestra el stock anterior; WF13 vuelve a revisar el stock publicado en cada pedido, pero no "reserva" unidades de pedidos pagados sin publicar.

## 5. Mercado Pago: lo que hace el usuario (una sola vez)

1. Entra con tu cuenta de Mercado Pago **Perú** a https://www.mercadopago.com.pe/developers/panel/app → **Crear aplicación**: nombre "Palmera Brava Demo", tipo **Pagos online → Checkout Pro**. Acepta las condiciones.
2. En la app: **Pruebas → Credenciales de prueba** → copia el **Access Token** (empieza con `APP_USR-`). La Public Key no hace falta.
3. **Cuentas de prueba**: anota usuario y contraseña del **Comprador** (si no existe, crea uno de tipo Comprador, país Perú).
4. En n8n (http://localhost:5678) → **Credentials** → "**Mercado Pago Prueba**" → en **Value** escribe `Bearer ` (con espacio) y pega el token → Save. **Nadie más escribe esa credencial** (ni en el repo, ni en `pb_config`, ni en el chat).
5. (Opcional, recomendado) Webhooks → Configurar notificaciones → URL `https://<túnel>.trycloudflare.com/mp-notificacion`, evento **Pagos** → Guardar → revela la **clave secreta** y pégala en `pb_config.MP_WEBHOOK_SECRET` (Data Tables). Con ella n8n valida `x-signature`. Sin ella también funciona: n8n solo cree lo que responde `GET /v1/payments/{id}`. Cada pedido además manda su `notification_url` con la URL del túnel vigente (`pb_config.TUNEL_URL`, la guarda WF12 al encender el chat).
6. Prueba: abre la tienda en una **ventana de incógnito**, compra, y en Mercado Pago **inicia sesión como el comprador de prueba**. Paga con una tarjeta de la tabla. Mientras la credencial tenga el placeholder, la tienda funciona en **pago simulado** (marcado como tal en la web, en Telegram y en el historial).

**Tarjetas de prueba (Perú)** — vencimiento **11/30**, documento `123456789`:

| Tarjeta | Número | CVV |
|---|---|---|
| Visa crédito | 4009 1753 3280 6176 | 123 |
| Mastercard crédito | 5031 7557 3453 0604 | 123 |
| American Express | 3711 803032 57522 | 1234 |
| Mastercard débito | 5178 7816 2220 2455 | 123 |

**Nombre del titular = resultado**: `APRO` aprobado · `CONT` pendiente · `FUND` fondos insuficientes · `SECU` CVV inválido · `EXPI` vencida · `OTHE` rechazo general · `CALL` llamar para autorizar · `FORM` error de formulario.
No mezcles cuentas reales con las de prueba (falla). En modo prueba no se envía el correo real del cliente a Mercado Pago (solo nombre y apellido).

Claves de `pb_config` (WF0 las crea si faltan): `PEDIDO_ULTIMO` (`PB-000100`; el primero es PB-000101), `MP_MODO` (`auto` \| `simulado`), `MP_LINK` (`init_point`; `sandbox_init_point` solo con tokens antiguos `TEST-`), `MP_WEBHOOK_SECRET`, `TUNEL_URL`. Solo pruebas: `MP_API_URL`, `CATALOGO_URL`, `TELEGRAM_API_URL` (simuladores locales; el token de MP solo puede ir a `api.mercadopago.com` o a un simulador local).

## 6. Envíos (lo que dicen la web, Vale y el bot)

"**Envíos a todo el Perú**" desde Tarapoto (datos en `site.json` → `envios`; costos y tiempos estimados, ver la investigación):

| Opción | Entrega | Desde | Tiempo promedio (días hábiles desde el despacho) |
|---|---|---|---|
| Shalom | agencia (DNI + clave de 4 dígitos por privado) | S/ 15 | 2 a 6 según el destino (Lima 2–3, costa norte 2–4, sur y sierra 4–6, San Martín 1–2) |
| Olva Courier | domicilio | S/ 22 | 2 a 5 según el destino (Lima 2–3) |
| Agencia de bus de tu preferencia | terminal (DNI y guía) | S/ 12 | 1 a 5 según la ruta (Lima y costa norte 1–2) |
| Entrega local en Tarapoto, Morales y La Banda de Shilcayo | domicilio | Gratis | el mismo día si se paga antes de las 3 p. m.; si no, 24 h |

Envío gratis desde S/ 299. El envío se cobra como un ítem más en Mercado Pago (`ENVIO-SHALOM`…), así los ítems suman exactamente el total.

## 7. Puesta en marcha (instancia real)

1. Generar y revisar: `node n8n/src/pedidos/construir-pedidos.js` (y los demás constructores) → `node n8n/validar-workflows.js --estricto` → `node n8n/src/pedidos/probar-pedidos.js`.
2. `node tools/limpiar-workflows.js` → `node n8n/tools/preparar-importacion.js <carpeta de import>`.
3. Importar la credencial nueva **solo si no existe** (no reimportes las otras: pisaría sus secretos): crea a mano en la UI una credencial **Header Auth** llamada exactamente "Mercado Pago Prueba" (Name `Authorization`, Value `Bearer PEGAR_ACCESS_TOKEN_DE_PRUEBA`) o importa solo esa entrada de `n8n/reference/credenciales.plantilla.json` (id fijo `pbCredMercPago01`).
4. Importar WF0, WF2, WF4, WF5, WF11, WF12, WF13, WF14, WF15, WF16 (y los demás regenerados) y **publicar** en orden: WF9, WF3, WF16, WF4, WF5, WF6, WF8, WF14, WF15, WF13, WF11, WF12, WF2, WF1. Ejecutar WF0 una vez (claves nuevas de `pb_config` y menú de comandos por rol).
5. `tools\iniciar-chat.bat`: el proxy ya trae las rutas de pedidos; WF12 guarda `TUNEL_URL`.

## 8. Pruebas (2026-10-08)

- `node n8n/src/pedidos/probar-pedidos.js` → **96 ok, 0 fallos** (nodos Code reales de WF13–WF16 + cambios v3 de WF2, WF4 y WF11; tablas en memoria, MP y Telegram simulados): HMAC-SHA256 en JS puro = Node crypto (5 vectores) y `x-signature` válida/alterada/otro id/sin cabecera; pedido válido PB-000101 con el total del catálogo aunque el navegador mande `precio_unit:1` y `total_visto:1` (aviso "se actualizó"); preferencia (ítems + envío = total, PEN, `external_reference`, `back_urls` sin `#`, `notification_url` del túnel, sin correo del pagador, vence `-05:00`); fila de `pb_pedidos` válida con `validarPedido`; vista sin datos personales; "Nuevo pedido" solo a admin y dueño; stock insuficiente y color agotado rechazados sin gastar número; producto inexistente; DNI obligatorio en agencia; entrega local fuera de Tarapoto; 429 al 7.º intento; placeholder (401) → simulado marcado; MP 500 → 502 con el número; carrera por el número → 503; `MP_MODO=simulado`. WF14: aprobado → pagado + historial + aviso + 1 borrador de stock (aplicado como WF5 descuenta 2); aviso repetido sin duplicados; firma inválida o ausente con clave → sin consultar; monto distinto → no paga; rechazado; `merchant_order` ignorado; pago de otro pedido ignorado; vuelta de la web pagando; rechazo tardío no pisa el aprobado; carrera perdida sin duplicados; SIMULADO solo en pedidos simulados. WF15: estado/historial/tiempo, sin datos personales, misma respuesta para correo o número malos, 400, 429 tras 8 fallos, sub-workflow. WF16: `/pedidos`, `/pedido` (marketing sin contacto), `/preparando`, `/enviar` (código malo / Shalom con URL), `/recojo`, `/entregado`, transición prohibida, `/cancelar_pedido` con botón (vencido / confirmado + devolución), `/envios`, `/desconocidos` (nombre saneado), `/autorizar` (admin no, uno mismo no, a un admin no, botón tocado por marketing no, confirmado → menú + bienvenida, repetido sin duplicar), `/desautorizar` (admin no; marketing sí + `deleteMyCommands`; efecto inmediato). WF2 manda `usr:`/`ped:` a WF4 y `pub:` a WF5; WF4 enruta y bloquea a marketing; WF11 seguimiento sin IA (pide datos con `accion`, consulta WF15 con número y correo de dos mensajes, responde "Pagado" + historial) y "¿Cómo hago un pedido?" sigue a la IA con el prompt de Vale.
- `node n8n/src/pedidos/probar-contenedor-pedidos.js` → **32 ok** en n8n 2.40.7 **desechable** (`n8n-prueba-pedidos`, puerto 5694, borrado al final; nunca el contenedor `n8n`): import de 4 credenciales falsas (incluida "Mercado Pago Prueba") y de WF0, WF9, WF11, WF13, WF14, WF15; activación sin errores; **por el proxy real**: `OPTIONS/POST /pedido` con CORS → PB-000101 con total real e `init_point`; MP simulado recibió `Bearer <token de la credencial>` y `X-Idempotency-Key`; Telegram simulado recibió "Nuevo pedido" ×2 con el token de `pb_config`; cantidad y stock inválidos; `/mp-notificacion` con Origin → 403; firma inválida → 200 sin consultar; firma válida → `GET /v1/payments/5550001` → **pagado**, borrador de stock aprobado en `pb_borradores` y "Pago confirmado" ×2; aviso repetido sin duplicados; `/seguimiento` y `/pedido/consultar`; **chat**: chip → pide número y correo (`accion`) → "Tu pedido PB-000101 está: Pagado…" con la tarjeta `pedido` (WF11 → WF15); placeholder (401) → PB-000102 simulado → `/pedido/pago SIMULADO` → pagado; SIMULADO sobre un pedido real no cambia nada; allowlist (405/404), Origin ajeno 403, 9 KB → 413, 6.º pedido/min → 429; todas las ejecuciones de WF11/13/14/15 en `success`.
- `node n8n/src/chat/probar-wf11.js` → **63 ok** (+ respuesta fija de envíos: Morales = local el mismo día / Shalom y Olva 1 día; Chiclayo = costa norte; sin destino = 4 opciones y pregunta la ciudad). Núcleo y negocio sin regresiones: `probar-nucleo.js` 76 ok, `probar-negocio.js` 108 ok, `probar-negocio-b.js` 68 ok.
- `node n8n/validar-workflows.js --estricto` → 15 archivos, 0 errores (conoce WF13–WF16, `pb_pedidos`, la credencial de MP, Webhook + Execute Workflow Trigger y la regla de Respond to Webhook).
- **No probado** (a propósito): un pago real en el sandbox de Mercado Pago (requiere el Access Token de prueba del usuario) ni el túnel real. Primera vez: crear un pedido desde la web, pagar con `APRO` y mirar Executions de WF13 y WF14.

## 9. Límites y pendientes

- La web (otro equipo) debe: llamar a `/pedido`, redirigir a `init_point`, manejar la vuelta (`?mp=…&pedido=…&payment_id=…` → `/pedido/pago`), mostrar `aviso` en modo simulado, usar `/seguimiento` (o `/pedido/consultar`) y, en el chat, mostrar el formulario cuando llegue `accion:"formulario_seguimiento"` y la tarjeta cuando llegue `pedido`.
- Quick tunnel: la URL cambia en cada encendido; los pedidos creados antes siguen con la `notification_url` vieja → la confirmación llega por la vuelta de la web o por `/pedido <num>` en el bot (reconsulta MP).
- Sin correo al cliente: el cliente ve su pedido en "Seguimiento de pedido", en "Mi cuenta" (navegador) y con Vale.
- Devoluciones: se hacen a mano en Mercado Pago (`/cancelar_pedido` lo recuerda); si MP informa `refunded`, el pedido pasa a cancelado.
