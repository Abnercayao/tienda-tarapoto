# Mercado Pago (modo prueba) y envíos desde Tarapoto

Investigación del 2026-10-07 para la v3 de Palmera Brava. Uso solo fuentes públicas y no hice pagos, registros ni llamadas con credenciales.
Marco con **[E]** lo que es **estimado**: cifras de terceros o deducciones mías. Todo lo demás viene de la documentación oficial o del propio sitio de cada empresa (enlaces en cada sección).

---

## A. Mercado Pago Checkout Pro (Perú) en modo prueba

### A.1 Flujo recomendado para nuestra arquitectura
1. La web (GitHub Pages) envía el carrito a n8n por chat-proxy, con una ruta nueva en la allowlist. n8n **recalcula los precios** con `products.json`, sin fiarse de lo que mande el navegador, y crea el pedido `PB-000123`.
2. n8n llama a `POST https://api.mercadopago.com/checkout/preferences` con la credencial `pbCredMercPago01` (`Authorization: Bearer …`). El token **nunca** llega al navegador.
3. n8n devuelve a la web el enlace de pago y la web redirige al cliente.
4. El cliente paga y Mercado Pago lo devuelve a `back_urls`. Al mismo tiempo envía una notificación a `notification_url`.
5. n8n confirma **siempre** con `GET https://api.mercadopago.com/v1/payments/{id}`. Comprueba que `external_reference`, el monto y `currency_id=PEN` coinciden, pasa el pedido a `pagado` y avisa por Telegram.

### A.2 Crear la preferencia
Fuente: https://www.mercadopago.com.pe/developers/es/reference/online-payments/checkout-pro-preferences/preferences/create-preference/post
- Cabeceras: `Authorization: Bearer <ACCESS_TOKEN>` y `Content-Type: application/json`. El único campo obligatorio es `items`.
- Cuerpo sugerido. Los campos y ejemplos salen de la referencia; los valores son nuestros:
```json
{
  "items": [
    {"id":"PB-H-OM-01","title":"Camisa lino old money","quantity":1,"currency_id":"PEN","unit_price":129.9},
    {"id":"ENVIO","title":"Envío Shalom (agencia)","quantity":1,"currency_id":"PEN","unit_price":15}
  ],
  "payer": {"name":"Ana","surname":"Ríos"},
  "external_reference": "PB-000123",
  "back_urls": {
    "success": "https://abnercayao.github.io/tienda-tarapoto/?mp=ok",
    "pending": "https://abnercayao.github.io/tienda-tarapoto/?mp=pend",
    "failure": "https://abnercayao.github.io/tienda-tarapoto/?mp=err"
  },
  "auto_return": "approved",
  "notification_url": "https://<tunel>.trycloudflare.com/webhook/mp-notificacion?source_news=webhooks",
  "statement_descriptor": "PALMERABRAVA",
  "expires": true,
  "expiration_date_to": "2026-10-08T23:59:59.000-05:00",
  "metadata": {"pedido": "PB-000123"}
}
```
- Respuesta: `id`, `init_point` y `sandbox_init_point` (la referencia de Perú todavía devuelve los dos), además de `collector_id`, `statement_descriptor`, etc.
- Errores 400 documentados: `invalid_items` ("unit_price invalid"), `invalid_back_urls` ("Wrong format"), `invalid_payment_methods` (cuotas fuera de 1–36), `invalid_shipments`, `invalid_binary_mode`, `invalid_access_token`, y `collector_does_not_comply_with_current_regulation` (la cuenta vendedora tiene una validación de identidad pendiente).
- **El envío va como un ítem más.** Es más simple y seguro que `shipments.cost`, que valida tipos y modos.
- `auto_return: "approved"` redirige solo cuando el pago es con tarjeta aprobada, en un máximo de 40 s que no se pueden cambiar. Los demás medios muestran el botón "Volver al sitio". Si se envía `auto_return` sin `back_urls.success`, la API lo rechaza; es un error conocido. **[E]** sobre el texto exacto del error.
  Fuente: https://www.mercadopago.com.ar/developers/en/docs/checkout-pro/configure-back-urls
- `statement_descriptor` es el texto que sale en el estado de cuenta de la tarjeta, según la marca. La referencia no fija un largo máximo, así que conviene un texto corto, de 13 caracteres o menos y sin tildes. **[E]**
- `binary_mode: true` deja solo dos resultados, aprobado o rechazado, sin estado pendiente. Es opcional. Para la demo conviene dejarlo en `false` y manejar `pending`.
- Hay que crear **una preferencia por pedido**. La propia documentación recuerda que la Preferences API sigue soportada, pero las novedades llegan a la Orders API. Para la demo basta con Preferences.

### A.3 `init_point` o `sandbox_init_point`, y cómo se hacen las pruebas
Fuentes: https://www.mercadopago.com.pe/developers/es/docs/checkout-pro-preferences/test-accounts ·
https://www.mercadopago.com.pe/developers/es/docs/checkout-pro-preferences/integration-test/introduction ·
https://www.mercadopago.com.pe/developers/es/docs/checkout-pro-preferences/integration-test/test-purchases ·
https://www.mercadopago.com.mx/developers/es/news/2023/11/16/Questions-on-how-to-test-your-integration--
- Hoy, en Checkout Pro, la **cuenta vendedora de prueba se crea sola al crear la aplicación** y "sus credenciales pasan a ser las de prueba". Por eso el **Access Token de prueba empieza con `APP_USR-`**, no con `TEST-`.
- Con ese token, la guía oficial dice que se use el **`init_point`** y se pague **con la sesión del comprador de prueba**. `sandbox_init_point` es del esquema antiguo con tokens `TEST-`.
  **Decisión:** n8n guarda los dos. La web usa `init_point` por defecto y una clave de `pb_config` (`mp_link=init_point|sandbox_init_point`) permite cambiarlo sin tocar código.
- Las compras de prueba se hacen **en una ventana de incógnito**, con la sesión iniciada como **comprador de prueba**: usuario y contraseña en Tus integraciones → la app → Cuentas de prueba → Comprador. Si pide un código por correo, es el código de 6 dígitos que aparece en esa misma tabla.
- Si se paga con una cuenta real contra un vendedor de prueba, falla porque no se pueden mezclar cuentas reales y de prueba. **[E]**, error muy reportado.
- **Precaución en modo prueba:** no mandar `payer.email` con el correo real del cliente. Basta con nombre y apellido. **[E]**
- Las cuentas de prueba tienen límites: hasta 15, no se pueden borrar, el país no se puede cambiar y comprador y vendedor deben ser del mismo país.

### A.4 Tarjetas de prueba (Perú)
Fuente: https://www.mercadopago.com.pe/developers/es/docs/checkout-pro-preferences/integration-test/test-purchases
| Tipo | Marca | Número | CVV | Venc. |
|---|---|---|---|---|
| Crédito | Mastercard | 5031 7557 3453 0604 | 123 | 11/30 |
| Crédito | Visa | 4009 1753 3280 6176 | 123 | 11/30 |
| Crédito | American Express | 3711 803032 57522 | 1234 | 11/30 |
| Débito | Mastercard | 5178 7816 2220 2455 | 123 | 11/30 |

El **nombre del titular** decide el resultado:
- `APRO`: aprobado.
- `CONT`: pendiente.
- `OTHE`: rechazado por error general.
- `CALL`: rechazado, hay que llamar para autorizar.
- `FUND`: rechazado por fondos insuficientes.
- `SECU`: rechazado por CVV inválido.
- `EXPI`: rechazado por vencimiento.
- `FORM`: rechazado por error de formulario.
- También existen `CARD`, `INST`, `DUPL`, `LOCK`, `CTNA`, `ATTE` y `BLAC`.

Documento: la tabla da `123456789` para APRO y OTHE. La nota de 2023 indica el tipo "OTRO" con 9 dígitos.
Para la demo: **APRO** muestra el flujo pagado, **FUND** el rechazo y **CONT** el pendiente.

### A.5 Notificaciones (webhooks), firma y confirmación
Fuentes: https://www.mercadopago.com.pe/developers/es/docs/checkout-pro-preferences/payment-notifications ·
https://www.mercadopago.com.ar/developers/en/docs/checkout-api-v2/notifications · https://www.mercadopago.cl/developers/es/docs/qr-code/notifications ·
https://www.mercadopago.com.ar/developers/en/docs/your-integrations/notifications/ipn
- **Configuración:** se puede hacer en el panel (Tus integraciones → app → Webhooks → Configurar notificaciones, evento **Pagos**, URL HTTPS) o por pedido con `notification_url`. Según la documentación, la URL que se define al crear el pago o la preferencia tiene prioridad.
- **Lo que llega:** un POST JSON con `{"action":"payment.updated","type":"payment","data":{"id":"123"},"live_mode":false,...}`. La query también trae `?data.id=123&type=payment`.
- **Respuesta:** hay que contestar `200` o `201` en menos de **22 s**. Si no, Mercado Pago reintenta a los 15 min y luego con intervalos que se alargan. Lo correcto es responder rápido y procesar después.
- **IPN (aviso antiguo, `?topic=payment&id=…`):** está en proceso de discontinuación y **no lleva firma**. Hay que añadir `source_news=webhooks` a la URL para recibir solo webhooks. La documentación es contradictoria con este parámetro **[E]**, así que n8n debe aceptar los dos formatos.
- **Validar `x-signature`:** el panel genera la clave secreta al guardar la configuración de Webhooks (se ve con el botón para revelarla).
  1. Partir la cabecera `ts=…,v1=…` por la coma.
  2. Armar el texto `id:[data.id de la query];request-id:[cabecera x-request-id];ts:[ts];`. Si falta un valor, se quita ese tramo.
  3. Si `data.id` es alfanumérico, pasarlo a **minúsculas**. Los IDs de pago son numéricos.
  4. Calcular HMAC-SHA256 en hexadecimal con la clave secreta y compararlo con `v1` (deben coincidir exactamente).
- **Diseño a prueba de fallos:** la notificación **solo dispara** una consulta a `GET /v1/payments/{id}` con nuestro token, y lo que se cree es esa respuesta, no el cuerpo del aviso. Así, un aviso falso o sin firma no puede marcar un pedido como pagado. Validar la firma es una defensa extra y opcional; si se usa, la clave secreta iría en otra credencial n8n que rellena el usuario.
- **Estados de `/v1/payments/{id}` y cómo se mapean:**
  - `approved` → **pagado**.
  - `pending` / `in_process` / `authorized` → **pendiente de pago (en revisión)**.
  - `rejected` / `cancelled` → **pago rechazado**, con opción de reintentar y un nuevo enlace.
  - `refunded` / `charged_back` → **cancelado**.
  Un ID inexistente devuelve 404, code 2000.
- **Respaldo si el túnel cambió o no llegó el aviso:** el quick tunnel de Cloudflare cambia de URL al reiniciarse, y una preferencia antigua seguiría apuntando a la URL vieja. Hay dos salidas:
  - Al volver a `back_urls`, la web manda `payment_id` a n8n y n8n verifica con `/v1/payments/{id}`.
  - `/pedido <num>` y la página de seguimiento pueden consultar `GET /v1/payments/search?external_reference=PB-000123&sort=date_created&criteria=desc`.
  Fuente: https://www.mercadopago.com.ar/developers/es/docs/checkout-api-payments/response-handling/query-results.md

### A.6 `back_urls` con GitHub Pages y rutas con `#`
- La documentación **no dice nada** sobre fragmentos `#`. Al volver, Mercado Pago **añade la query** `collection_id`, `collection_status`, `payment_id`, `status`, `external_reference`, `payment_type`, `merchant_order_id`, `preference_id`, `site_id`, `processing_mode` y `merchant_account_id`. Con `#` el resultado es incierto (¿`?` antes o después del `#`?).
  **Recomendación:** usar `back_urls` **sin `#`**, como `…/tienda-tarapoto/?mp=ok`. El JS al cargar lee `location.search`, llama a n8n para verificar, hace `history.replaceState` y navega a `#/pedido/PB-000123`. Por robustez, conviene leer también la query que pudiera venir dentro de `location.hash`.
- Los dominios locales (`localhost`, `127.0.0.1`) **no** sirven ni en `back_urls` ni en `notification_url`. GitHub Pages (HTTPS) y `*.trycloudflare.com` sí sirven. Todos los ejemplos oficiales usan https.
- El `status` de la URL **no es prueba de pago**: siempre se confirma en el servidor.

### A.7 Cómo obtiene el usuario su Access Token de PRUEBA
Panel: https://www.mercadopago.com.pe/developers/panel/app
1. Entra con su cuenta de Mercado Pago **Perú** a Tus integraciones y pulsa **Crear aplicación**. Nombre: "Palmera Brava Demo"; tipo: Pagos online → **Checkout Pro**. Acepta las condiciones.
2. En la app, entra a **Pruebas → Credenciales de prueba** y copia el **Access Token**, que empieza con `APP_USR-`. La Public Key no hace falta porque redirigimos al `init_point`.
3. En **Cuentas de prueba**, anota el usuario y la contraseña del **Comprador**. Si no existe, crea una cuenta tipo Comprador con país Perú.
4. En n8n abre la credencial **"Mercado Pago Prueba"** (`pbCredMercPago01`, tipo Header Auth) y en Value escribe `Bearer ` seguido del token. Nadie más escribe esa credencial.
5. (Opcional) En Webhooks → Configurar notificaciones, guarda la URL del túnel y copia la clave secreta.
6. Para probar: ventana de incógnito → iniciar sesión como comprador de prueba → pagar con Visa 4009… a nombre de `APRO`.

---

## B. Envíos desde Tarapoto a todo el Perú

### B.1 Operadores verificados
| Operador | Presencia en Tarapoto | Rastreo oficial | Notas |
|---|---|---|---|
| **Shalom** | Tarapoto figura entre sus **destinos aéreos**. Tiene más de 211 agencias (más de 120 en provincias), más de 250 destinos terrestres y 15 aéreos (FAQ del sitio) | https://shalom.com.pe/rastrea con **N° de orden + código de envío**. El sitio tiene la ruta `/rastrea/{orden}/{código}` **[E]** (deducida del código del sitio) | Recojo con **DNI original + clave de seguridad de 4 dígitos que crea el remitente**. Reparto a domicilio 48–72 h después de llegar. Pago en web/app con Págalo (Yape, Plin, tarjeta) o en agencia |
| **Olva Courier** | **"TDA TARAPOTO"** en su tabla oficial. Morales y La Banda de Shilcayo tienen reparto sin tienda | `https://tracking.olvacourier.com/?q=<código>`. Por orden de servicio: `https://tracking.olvacourier.com/orden-de-tracking/?emision=26&numero=27250` | Acepta **N° de tracking/remito** (formato `AA-NNNN…`, año de 2 dígitos y número), **orden de servicio** (emisión + número) o **guía de cliente** (`COD-guía`). Ofrece **Pago en Destino**: paga el que recibe |
| **Movil Bus** | Rutas Tarapoto–Lima, Chiclayo, Trujillo y Piura (agregadores) | https://encomiendas.movilbus.pe/ ("Rastrea tu envío", enlazado desde movilbus.pe) | Tiene servicio de encomiendas |
| **Civa** | Terminal en Av. Salaverry 840, Morales (Busbud). Rutas a Lima, Moyobamba y Chiclayo | Su web bloquea el acceso automático (403), no lo verifiqué | Tuvo encomiendas Lima–Chiclayo según un caso de Indecopi de 2014. **[E]** para Tarapoto |
| **Transmar / Turismo Universo** | Rutas por Tocache, Tingo María y Pucallpa (foros y agregadores) | No verificado | **[E]** No hay que darlas como confirmadas |

Turismo Paredes Estrella: **no encontré evidencia actual** de que salga de Tarapoto, así que no la listaría.
Fuentes:
- Shalom: https://shalom.com.pe/ (FAQ y rutas en su app web)
- Olva: https://www.olvacourier.com/ y https://www.olvacourier.com/tiempos-de-entrega-olva-nivel-nacional/
- Buses: https://www.movilbus.pe/, https://www.rome2rio.com/s/Lima/Tarapoto, https://www.busbud.com/en/bus-piura-bus_station-tarapoto/i/6pndmjnj5-6qcen2 y https://vlex.com.pe/vid/637569585

### B.2 Tiempos promedio
Dato oficial de Olva (destinos, en días hábiles, con origen aparente en Lima):
- Tarapoto: 1 día, aéreo, recojo en tienda el mismo día.
- Iquitos y Pucallpa: 1 día, aéreo.
- Moyobamba, Arequipa, Cusco y Piura: 2 días, aéreo.
- Trujillo y Chiclayo: 2 días, terrestre.

Shalom no publica tiempos fijos ("varía según origen y destino", tarifas.shalom.pe). Por bus, Tarapoto–Lima son unas 24–30 h; Tarapoto–Chiclayo unas 12–14 h; Tarapoto–Piura unas 15–16 h y Tarapoto–Trujillo unas 20 h (Movil, según agregador). **[E]**

**Tabla que propongo para la web, Vale y el bot.** Son días hábiles desde que el pedido se despacha en Tarapoto **[E]**:
| Destino | Shalom (agencia) | Olva (domicilio o tienda) | Bus (terminal) |
|---|---|---|---|
| Lima y Callao | 2–3 días | 2–3 días | 1–2 días |
| Costa norte (Chiclayo, Trujillo, Piura) | 2–4 días | 2–4 días | 1–2 días |
| Sur (Arequipa, Cusco, Tacna, Puno) | 4–6 días | 3–5 días | 3–5 días, con transbordo |
| Selva (Moyobamba, Yurimaguas, Pucallpa, Iquitos) | 1–2 días (San Martín) / 3–6 días | 2–5 días | 1 día (San Martín) / 2–4 días (Iquitos solo aéreo o fluvial) |

Entrega local (Tarapoto, Morales y La Banda de Shilcayo): **el mismo día** si el pedido se paga antes de las 3 pm, si no **en 24 h**. Política de la tienda (demo).

### B.3 Costos referenciales para un paquete de ropa de 1–2 kg **[E]**
- Las tarifas oficiales dependen del cotizador. Shalom: https://shalom.com.pe/tarifas; Olva: https://olvacourier.com/cotizar/. No hay una tabla pública fija.
- Un blog de e-commerce (kom.pe) estima, para envíos Lima–provincia de hasta 2 kg:
  - **Shalom: S/ 10–15**, entrega en agencia y domicilio con recargo, 3–7 días hábiles.
  - **Olva: S/ 15–25**, 2–5 días hábiles.
  - Con 30–50 envíos al mes se puede negociar un descuento del 15–30 %.
  Fuente: https://kom.pe/olva-courier-shalom-envios-tienda-online-lima/
- **Propuesta demo** (precio fijo nacional por opción, cobrado como ítem en Mercado Pago):
  - Entrega local Tarapoto: **S/ 7**.
  - Shalom (agencia): **S/ 15**.
  - Olva Courier: **S/ 22**, a domicilio o tienda.
  - Agencia de bus a elección: **S/ 12**, o **S/ 0 con flete pagado en destino**.
  - Opcional: envío gratis desde S/ 299.
- Garantía Shalom: la base cubre hasta 10 veces el flete o S/ 500 (FAQ). Para prendas caras conviene ofrecer el servicio de garantía o declarar el valor.

### B.4 Pago en destino, recojo en agencia y estados
- **Olva:** tiene "Pago en Destino", en el que el destinatario paga el flete al recibir (dato oficial).
- **Shalom:** el flete lo puede pagar cualquiera por Págalo (web/app, con N° de orden + código) o en agencia. Que el destinatario lo pague al recoger en mostrador es **[E]**: hay que confirmarlo en la agencia de Tarapoto. Shalom también ofrece contraentrega o recaudo para negocios (Shalom Pro) con comisión.
- **Bus:** la encomienda "por pagar" en destino es habitual; el cliente recoge en el terminal con DNI y el número de guía. **[E]**, depende de la empresa.
- **Recojo en Shalom:** DNI original + clave de 4 dígitos. **Nunca** hay que mostrar la clave en la página pública de seguimiento: se envía por un canal privado (chat con número y correo verificados, o correo).
- **Estados de Shalom (textos de su sitio) y su equivalente en nuestros pedidos:**
  - Registrado (tiene 24 h para llegar a la agencia) → **preparando**.
  - En origen / En tránsito → **enviado**.
  - Llegó a destino → **listo para recojo**.
  - En reparto → **enviado**.
  - Entregado → **entregado**.

### B.5 Reglas sugeridas para `/enviar <num> <shalom|olva|bus|local> <codigo>`
- `shalom`: guardar `orden-código` y validar con `^[0-9]{5,12}[-/ ][A-Za-z0-9]{3,10}$`. **[E]**: Shalom no publica el formato.
  Enlace: `https://shalom.com.pe/rastrea`, indicando qué número ingresar.
- `olva`: validar con `^[A-Za-z0-9-]{5,25}$`. Enlace: `https://tracking.olvacourier.com/?q=<codigo>`.
- `bus`: texto libre `Empresa:guía` con `^[\w .:-]{3,40}$`. Sin enlace universal; se muestra el nombre de la empresa y la guía.
  Para Movil Bus: https://encomiendas.movilbus.pe/.
- `local`: código opcional. El estado pasa a "en camino" y luego a "entregado".
- En toda la UI y en los textos de bot y chat: **"Envíos a todo el Perú"**; no se menciona ningún vehículo de reparto local.
