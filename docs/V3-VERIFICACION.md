# Verificación final v3 — Palmera Brava (2026-10-08)

Revisión adversarial de los 8 pedidos v3 (Vale, transiciones, envíos a todo el Perú, Mercado Pago en modo prueba,
menú con subcategorías y +20 productos, 38°, pedidos con seguimiento y cuenta ligera, comandos de Telegram).
Sin commits, sin tocar el contenedor `n8n` real ni sus credenciales, sin tokens reales.

## 1. Pruebas automáticas (resultados reales)

| Comando | Resultado |
|---|---|
| `node tools/test-validar.js` | 80 pruebas OK, 0 fallidas |
| `node tools/validar.js data/products.json data/articles.json data/site.json` | OK, contrato 3.0.0, 37 productos, 3 artículos |
| `node tools/qa.js` | 33 OK, 0 FALLA, 0 AVISO, 4 MANUAL (Lighthouse y revisión humana) |
| `node tools/csp.js --check` | OK index.html y admin.html (hash del script en línea al día) |
| `node tools/semilla.js --check` | OK, la semilla de index.html coincide con data/*.json |
| `node tools/limpiar-workflows.js --check` | OK, 15 workflows sin `pinData`, sin id de credencial ni secretos |
| `node n8n/validar-workflows.js --estricto` | 15 archivos, 0 errores, 0 avisos |
| `node n8n/tools/probar-nucleo.js` | 76 ok, 0 fallos |
| `node n8n/tools/probar-negocio.js` | 108 ok, 0 fallos |
| `node n8n/tools/probar-negocio-b.js` | 68 ok, 0 fallos |
| `node n8n/src/chat/probar-wf11.js` | 63 ok, 0 fallas |
| `node n8n/src/pedidos/probar-pedidos.js` | 96 ok, 0 fallos |
| Reconstrucción (6 constructores + `limpiar-workflows.js`) | Los 15 JSON salen **idénticos byte a byte** a los del repo: no hay JSON editado a mano |

Las pruebas con contenedor (`probar-contenedor*.js`) no se repitieron en esta revisión; su última corrida está en `docs/PEDIDOS.md` §8 (32 ok en n8n 2.40.7 desechable).

## 2. Textos públicos (index.html, 404.html, data/*.json)

- "motocarro", "Valeria", "32°": **0** coincidencias. 38° en la portada, la franja del clima y `site.json`.
- "muestra": solo la clave interna `"muestra": true` del JSON y el verbo ("se muestra"), nunca visible como "producto de muestra".
- "referencial": 0. "IA": solo el botón "Crear imagen con IA", que la web pinta **solo en localhost** (panel de la tienda).
- Avisos honestos que sí se ven: "Modo de prueba: paga con las tarjetas de prueba de Mercado Pago…" en el pago, y "Pago simulado (demo)" **solo** si la credencial de Mercado Pago sigue con el placeholder.
- Corregido en esta revisión: quedaban "motocarro" en `docs/PLAN.md` (línea 300) y "motocarro"/"32 °C" en `docs/investigacion/web-design.md`; ahora dicen "Envíos a todo el Perú…" y "38°".

## 3. Navegador (python tools/serve.py en 8091 y 8080; backend simulado con un `fetch` falso, sin tocar n8n real)

- **Escritorio 1366 px**: portada con el polo de punto calado (old money) en el hero y "¿38°? te tenemos cubierto"; mega menú Hombres con Camisas 3, Polos 3, Pantalones 1, Shorts y bermudas 1, Zapatillas y mocasines 2, Old money 5 y tarjetas de colección; transiciones por View Transitions (salida 0,18 s, entrada 0,34 s, foto compartida tarjeta → ficha) y cada ruta es una "vista" propia (12 `.vista`, una visible a la vez, título de pestaña distinto).
- **Ficha** `#/p/polo-punto-calado-hombre`: colores con stock, tallas, guía de tallas, "Envíos a todo el Perú desde S/ 7.00". Agregar → cajón de bolsa → `#/carrito` → `#/checkout`.
- **Checkout** en 3 pasos (datos → envío → pago). Paso 2 con Lima: Shalom S/ 15 · 2–3 días, Olva S/ 22 · 2–3 días, bus S/ 12 · 1–2 días (entrega local solo para Tarapoto, Morales y La Banda). Paso 3: resumen, total S/ 144.90, "Pagar con Mercado Pago". El POST a `/pedido` lleva **solo id, color, talla y cantidad** (más `total_visto`), nunca precios.
- **Pedido** `#/pedido/PB-000123` con línea de tiempo, agencia y código; **vuelta de Mercado Pago** simulada (`pb:mp:retorno`) → POST `/pedido/pago {numero, payment_id}` → "¡Gracias! Recibimos tu pago".
- **Seguimiento** `#/seguimiento` (número + correo): datos errados → "No encontramos un pedido con ese número y correo". **Mi cuenta**: lista PB-000123 con estado y "Seguir pedido", datos de envío opcionales, sin contraseña.
- **Móvil 375 px**: sin scroll horizontal en 12 rutas (`scrollWidth` = 375; solo desbordan la cinta animada y el carrusel de fotos, que tienen su propio recorte); menú en acordeón (Mujeres → Vestidos, Blusas, Pantalones, Shorts, Faldas, Sandalias, Old money).
- **Chat Vale** (móvil): saludo con 38° y envíos; chip "Hacer seguimiento de mi pedido" → formulario dentro del chat (número + correo) → tarjeta con historial y "Shalom · código SH12345678"; el correo no se repite en la burbuja del cliente. Pregunta libre → POST `/chat` con `{sessionId, mensaje, pagina}`.
- **Consola**: 0 errores de CSP o JS. Únicos errores: el CORS esperado del proxy real con el puerto 8091 (no está en la lista blanca) y el 404 a propósito de `/no-existe` (404.html se ve bien).
- Nota: el panel del navegador estaba minimizado y congelaba los fotogramas a mitad de la transición; no ocurre con la ventana visible.

## 4. Seguridad

- **Proxy** (`tools/chat-proxy.py`, probado en el puerto 8799 contra un n8n inexistente): pasan `/chat`, `/pedido`, `/seguimiento` (+ alias `/pedido/consultar`), `/pedido/pago` (vuelta de Mercado Pago, WF14) y `/mp-notificacion` (+ alias `/mp/notificacion`) → 502 sin n8n; `GET /salud` 200. Rechaza `/webhook/chat-url`, `/chat-url`, `/rest/workflows`, `/webhook/pedido-crear`, `/` y `/pedido/../chat-url` (404). Origin ajeno → 403; `/mp-notificacion` con Origin de navegador → 403.
- **WF13** recalcula todo con el `products.json` y `site.json` publicados (`crearPedido` de validar.js); `total_visto` solo sirve para avisar "el total se actualizó". Probado en `probar-pedidos.js` con `precio_unit:1` y `total_visto:1`.
- **WF15** devuelve `vistaPublicaPedido`: solo el primer nombre, prendas, montos, departamento, distrito, agencia, código e historial. Sin correo, celular, DNI, dirección ni apellidos; misma respuesta si falla el número o el correo; límite por IP.
- **WF14** solo cree en `GET /v1/payments/{id}` con el token de la credencial (y valida `x-signature` si hay `MP_WEBHOOK_SECRET`).
- **/autorizar**: "admin" se rechaza siempre; `puedeAsignarRol` solo permite dueno|marketing y solo a admin/dueño; nadie se cambia a sí mismo ni toca a un admin; el botón vuelve a comprobar el rol y vence en 10 min.
- **Secretos**: ningún token real en el repo (solo los falsos de `tools/test-validar.js`); la plantilla de credenciales trae placeholders (`Bearer PEGAR_ACCESS_TOKEN_DE_PRUEBA`).

## 5. Pendientes y riesgos (no corregidos: son cambios de diseño)

1. **Pago SIMULADO sin correo**: mientras "Mercado Pago Prueba" tenga el placeholder, cualquiera puede POSTear `/pedido/pago {numero, payment_id:"SIMULADO"}` y marcar como pagado un pedido simulado (los números son correlativos). No hay cobro real y solo afecta a los pedidos `SIM-`, pero el dueño recibiría "Pago confirmado (SIMULADO)". Arreglo propuesto: exigir el correo en ese camino (web + WF14 + pruebas). Desaparece al pegar el token de prueba.
2. `/pedido/pago` sin `payment_id` informa estado y estado de pago de cualquier número (sin datos personales).
3. 36 textos alternativos de fotos dicen "encuadre sin rostro"; no es visible, pero un lector de pantalla lo lee. Conviene quitarlo de `data/products.json` y regenerar la semilla.
4. No probado: pago real en el sandbox de Mercado Pago (requiere el Access Token de prueba del usuario) ni el túnel real.
5. El proxy que corre ahora en 127.0.0.1:8787 es la versión vieja (`OPTIONS /pedido` → 404): hay que reiniciarlo.

## 6. Pasos para el orquestador (instancia real)

1. `node n8n/tools/preparar-importacion.js <carpeta>`: copia los 15 JSON y repone los id de credencial (WF13 y WF14 quedan con `pbCredMercPago01`, "Mercado Pago Prueba").
2. **Credencial nueva, solo si no existe** "Mercado Pago Prueba" (`pbCredMercPago01`, httpHeaderAuth, Name `Authorization`, Value `Bearer PEGAR_ACCESS_TOKEN_DE_PRUEBA`): importa **solo esa entrada** de `n8n/reference/credenciales.plantilla.json` (archivo temporal con un solo elemento, y bórralo al terminar). **No** reimportes Telegram, GitHub ni X-Tienda-Key (pisaría sus secretos). El token lo pega el usuario en la UI.
3. Importar WF0, WF4, WF11, WF12, WF13, WF14, WF15, WF16 y los demás regenerados (WF1, WF2, WF3, WF5, WF6, WF8, WF9: todos llevan el `validar.js` v3). `import:workflow` conserva los id y deja todo despublicado.
4. Ejecutar **WF0** una vez: solo agrega las claves que faltan (`PEDIDO_ULTIMO`, `MP_MODO`, `MP_LINK`, `MP_WEBHOOK_SECRET`, `TUNEL_URL`) y publica el menú de comandos por rol; no pisa `AUTORIZADOS` (Emily como dueña queda como esté).
5. Publicar primero los sub-workflows y luego quienes los llaman: WF9, WF3, WF5, WF6, WF14, WF15, WF16, WF4, WF8, WF13, WF11, WF12, WF2, WF1. Luego `docker restart n8n`.
6. Reiniciar proxy y túnel: `tools\detener-chat.bat` y `tools\iniciar-chat.bat` (el proxy nuevo trae las rutas de pedidos; WF12 registra la URL en `data/chat.json` y `TUNEL_URL`). Comprobar: `OPTIONS http://127.0.0.1:8787/pedido` con Origin `http://127.0.0.1:8080` → 204.
7. Primera prueba real: compra desde la web en incógnito; sin token sale "Pago simulado (demo)"; con el token, pagar con la tarjeta de prueba `APRO` y revisar Executions de WF13 y WF14 y los avisos de Telegram.
