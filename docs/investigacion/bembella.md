# Bembella Perú: patrones de navegación, transiciones y postventa (investigación v3)

Fecha: 07/10/2026. Sitio: https://bembellaperu.com. Lo revisé con el navegador integrado en dos anchos, escritorio (800 px) y móvil (351 px). Usé `javascript_tool` para leer clases, reglas CSS y la configuración del tema.
No envié ningún formulario y no escribí datos en el checkout. Agregué un producto al carrito para ver el cajón y después vacié ese carrito.
**Solo documento patrones de interacción.** No copio textos, imágenes ni código del sitio. Los tiempos y las curvas son valores medidos que sirven de referencia.

## 1. Resumen ejecutivo

- Bembella está hecha en **Shopify con el tema Impulse v9.2**: cajón de carrito, vista rápida activa, búsqueda predictiva y animaciones de aparición con AOS.
- La sensación de "páginas separadas" no viene de un truco SPA. Cada colección y cada producto tiene **su propia URL y se carga como documento nuevo**.
  - Toda página nueva arranca arriba, con título de pestaña propio y una **animación de entrada**: el hero sube desde una máscara y las fotos de la grilla aparecen escalonadas.
  - El checkout **cambia de "escenario"** a una cabecera mínima, sin menú.
  - Encima de las páginas viven **superposiciones**: cajón del carrito a la derecha, cajón del menú en móvil, modal de vista rápida y buscador que reemplaza la cabecera.
- No usa transiciones *cross-document* (`@view-transition`). Solo declara `view-transition-name` en el bloque de producto, para el cambio de variante dentro de la misma página.
- Para nuestra SPA de un solo `index.html`, lo equivalente sería: **rutas con hash**, una vista por ruta, `document.startViewTransition` al cambiar de vista, entrada escalonada de la grilla y las mismas superposiciones.

## 2. Transiciones y navegación (valores medidos)

| Elemento | Comportamiento | Tiempo / curva |
|---|---|---|
| Cambio de página | Carga completa. URL propia (`/collections/<c>`, `/collections/<c>/products/<p>`). Scroll al inicio. Título de pestaña por página | (navegador) |
| Hero de portada | Título y subtítulo suben desde una máscara (translateY 120% → 0). Los botones aparecen después con fundido. La imagen hace transform + opacity | 0,8 s `cubic-bezier(.26,.54,.32,1)` con retardo 0,3 s. Botones: fundido 2 s con retardo 1,3/1,6 s. Imagen: 0,7 s |
| Aparición al hacer scroll (AOS) | Se dispara una sola vez, con offset de 60 px. Las fotos de las tarjetas hacen fundido y se escalonan por columna dentro de la fila | `ease-out-quad`. Fundido 0,5 s `cubic-bezier(.29,.65,.58,1)`. Escalón con 4 columnas: 0/0,12/0,24/0,36 s. Con 3 columnas: pasos de 0,15 s |
| Cabecera | En la portada es transparente sobre el hero. Al bajar se vuelve fija y blanca, y entra deslizándose desde arriba. En las demás páginas es sólida desde el inicio. La barra de anuncio superior también queda fija | Deslizamiento 0,4 s `cubic-bezier(.165,.84,.44,1)` |
| Megamenú (escritorio, hover) | Panel blanco de ancho completo con tarjetas de imagen y nombre de cada colección. Los otros menús son desplegables con lista simple de categorías | Instantáneo con fundido corto |
| Menú móvil | Cajón lateral. Los ítems aparecen escalonados (suben y aparecen). Los submenús son acordeones con chevron. Al final están "Ingresar" y las redes | 1 s `cubic-bezier(.165,.84,.44,1)`, +60 ms por ítem |
| Buscador | La lupa reemplaza la cabecera por una barra con foco automático. Debajo salen sugerencias predictivas (colecciones y productos) y un enlace "ver todos los resultados" que lleva a la página de búsqueda. Se cierra con Esc o con × | Panel con fundido |
| Carrito | Cajón desde la derecha que **se abre solo al agregar**. Un velo oscuro cubre el contenido | Cajón 0,45 s. Velo: 0 → 0,6 en 0,35 s al abrir, 0,25 s al cerrar |
| Vista rápida (modal) | Velo, y el panel sube 30 px con fundido. Al cerrar se encoge a 0,9 con fundido | 0,5 s `ease` |
| Acordeones de ficha | Animan altura y opacidad | 0,3 s `cubic-bezier(.25,.46,.45,.94)` |
| Cambio de variante | `view-transition-name` sobre el bloque de producto, que hace un crossfade al recargar ese bloque | VT same-document |
| Carga | Barra fina de 100 px que se llena y se vacía en bucle mientras algo carga | 0,5 s en bucle, retardo 0,3 s |
| Movimiento reducido | El tema consulta `prefers-reduced-motion` en JS (sliders y autoplay) | |

## 3. Página de colección

- Arriba no hay banner grande, solo una **barra de herramientas**:
  - botón "Filtrar", que abre un cajón lateral con facetas de precio, talla y tipo de prenda;
  - contador de artículos;
  - selector de orden: relevancia, más vendidos, A–Z/Z–A, precio ↑/↓ y fecha.
- La grilla tiene **4 columnas en escritorio y 2 en móvil**. Cada tarjeta lleva:
  - etiqueta de oferta en la esquina;
  - mini carrusel de fotos con flechas;
  - **botón "Comprar" que aparece al pasar el mouse**, pegado al pie de la foto, y abre la vista rápida;
  - título centrado en mayúsculas;
  - precio tachado, precio actual y "ahorras %";
  - muestras de color.
- Las categorías (subdivisiones) se reparten así:
  - las listas de tipos de prenda van en el desplegable "Shop all";
  - las colecciones o cápsulas temáticas van en el megamenú con foto;
  - "Accesorios" y "Últimas unidades" son entradas propias.

## 4. Página de producto

Orden de los bloques:
1. **Galería.** En escritorio: miniaturas verticales, foto grande y botón de zoom. En móvil: carrusel deslizable con puntos y lupa.
2. Título (h1, mayúsculas). Precio antes, precio ahora y ahorro. Una nota que avisa que el envío se calcula al pagar.
3. **Color.** Círculos, y el nombre del color elegido aparece al lado de la etiqueta.
4. **Talla.** Botones, con las agotadas tachadas.
5. **Stock.** Punto de color con pulso, más "N en stock".
6. Dos llamados a la acción: **agregar al carrito** (contorno) y **comprar ahora** (sólido, salta al pago).
7. Disponibilidad de retiro en tienda, con el plazo. Widget de cuotas de Mercado Pago.
8. **Acordeones**: descripción, materiales, cuidados, envíos y guía de tallas.
   - El acordeón de envíos da plazos por zona: Lima en 3–5 días útiles y provincias en 6–7. Despachan de lunes a viernes, con hora de corte el viernes por la tarde.
9. Compartir en redes. Luego "también te podría gustar", con recomendaciones.

## 5. Carrito y checkout

- **Cajón del carrito:**
  - título y botón cerrar;
  - **barra de progreso hacia el envío gratis** ("te faltan S/ X");
  - línea de producto con miniatura, color y talla, stepper −/+ y precio tachado/oferta/ahorro;
  - resumen con productos, descuentos y subtotal;
  - nota de que el envío y los cupones se calculan al pagar;
  - botón "Finalizar pedido".
- **Checkout (Shopify, una sola página)**. Tiene una cabecera mínima, solo el logo, y eso refuerza la sensación de pasar a otra etapa.
  1. **Contacto:** correo, opción de iniciar sesión y casilla para recibir novedades.
  2. **Entrega:** alternador Envío / Retiro. Dirección peruana: nombre, apellidos, **DNI**, dirección, referencia opcional, **distrito**, **región** (lista de departamentos) y teléfono. Casilla para guardar los datos y comprar más rápido.
  3. **Método de envío:** tarifa según la región. Con San Martín apareció una sola tarifa plana.
  4. **Pago:** tarjeta de crédito o débito, **Mercado Pago** (Yape, PagoEfectivo, billetera), depósito bancario, Plin y Yape.
  5. **Resumen del pedido:** a un lado en escritorio y plegable en móvil. Campo de cupón, total en PEN y botón para pagar.

## 6. Cuentas

- **Inicio de sesión sin contraseña:** el cliente pone su correo y recibe un código de un solo uso. También puede entrar con el botón de Shop.
  - Es una pantalla alojada por Shopify con el logo de la marca, más una casilla de novedades.
- Hay acceso desde el ícono de persona en la cabecera, "Ingresar" en el menú móvil y "Log in / Sign up" en el pie de página.
- La cuenta muestra los pedidos del cliente y su estado. Es lo estándar de Shopify; no lo verifiqué porque requiere iniciar sesión.

## 7. Seguimiento de pedido

- **No hay una página pública de seguimiento.** Probé rutas típicas como `/pages/seguimiento` y `/pages/track-order`, y todas devuelven 404. El seguimiento se ofrece por tres vías:
  1. **Dentro del chat**, con un formulario de **número de pedido + correo** (detalle en el punto 8).
  2. **Desde la cuenta** del cliente.
  3. Desde la página de estado del pedido que llega en el correo de confirmación. Esto lo deduzco porque es lo estándar de Shopify.
- Para nosotros: haremos **las dos cosas**, una vista dedicada `#/seguimiento` (número + correo) y el formulario dentro del chat Vale.

## 8. Widget de chat (Shopify Inbox con asistente)

- **Lanzador:** píldora oscura "Chat" abajo a la derecha. Hay además un botón de WhatsApp abajo a la izquierda y otro de Shop.
  - En móvil estos botones se tapan entre sí y con el contenido; es un error que no hay que repetir.
- **Panel:** en móvil es una hoja que ocupa casi toda la pantalla. Arriba tiene el botón "Iniciar sesión", otro de **nueva conversación** y otro de minimizar (−). Mientras carga muestra un **esqueleto difuminado**. Se cierra al hacer clic fuera.
- **Estado inicial:**
  - un saludo;
  - **una tarjeta del producto que el cliente está viendo** (usa la página como contexto);
  - una línea que explica en qué ayuda: compras, tallas, envíos, devoluciones y estado del pedido;
  - **chips de acción rápida en una fila con scroll horizontal**, por ejemplo "seguimiento de mi pedido";
  - un aviso de privacidad pequeño;
  - un campo "pregunta cualquier cosa" con ícono de adjuntar.
- **Flujo del chip de seguimiento:**
  1. Aparece una burbuja del cliente con el texto del chip: alineada a la derecha, oscura, con "Enviado · hora".
  2. Responde el bot automáticamente: alineado a la izquierda, con el avatar de la tienda y "Automático · hora".
  3. Aparece una **tarjeta-formulario dentro de la conversación**: ícono de caja, título y subtítulo, campo **número de pedido** (con foco), campo **correo**, botón **Cancelar** (secundario) y botón de enviar (primario oscuro, ancho completo).
  4. Al cancelar aparece una burbuja "Cancelar" y un mensaje del bot. Luego salen **chips de continuación**: "seguimiento de otro pedido" y "nueva conversación".
- **Otros:** al entrar aparece un popup de newsletter con descuento en la primera compra, y una etiqueta flotante de descuento.
  - Son intrusivos y además se superponen al chat; **no los vamos a replicar**.

## 9. Qué replicar en nuestra SPA (prioridad)

Contexto: Palmera Brava es un solo `index.html` en GitHub Pages, sin reescrituras de servidor.
Hoy ya hay `hashchange`, rutas `#p/<id>` y `startViewTransition` en los filtros del catálogo.
Mantenemos el estilo y los colores "Selva pop editorial"; de Bembella copiamos **solo el movimiento y la estructura**.

**P0 (imprescindible)**
1. **Router con hash** y una vista por ruta:
   - `#/`, `#/c/<categoria>[/<sub>]`, `#/p/<id>`, `#/checkout`, `#/pedido/<PB-000123>`, `#/seguimiento`, `#/cuenta` y `#/blog/<slug>`.
   - El enlace viejo `#p/<id>` redirige al nuevo con `replaceState`.
   - Cada vista se pinta en `<main data-vista>`, y el resto de vistas queda `hidden`.
   - En cada cambio: actualizar `document.title`, mover el foco al `h1` de la vista, anunciar el cambio en una región `aria-live` y marcar `aria-current` en el menú.
   - Scroll: al avanzar, ir arriba. Al volver, restaurar la posición guardada en `history.state` (con respaldo en `sessionStorage`).
   - No conviene History API con rutas reales: al recargar en Pages dan 404. Habría que forzarlo con el truco de `404.html`, y no hace falta.
2. **View Transitions API** (same-document) al cambiar de vista: `document.startViewTransition(() => pintar(ruta))`.
   - En `::view-transition-old(root)` va la salida: fundido de unos 180 ms.
   - En `::view-transition-new(root)` va la entrada: fundido más `translateY(16px → 0)` de unos 320 ms con `cubic-bezier(.165,.84,.44,1)`, la curva "de lujo" de Bembella.
   - La **cabecera** lleva `view-transition-name: cabecera` para que no se mueva.
   - **Dirección:** al volver se agrega la clase `nav-atras` en `<html>` para invertir el desplazamiento.
   - **Elemento compartido** (mejora propia): `view-transition-name: foto-<id>` se pone solo en la foto clicada y en la foto principal de la ficha, así la tarjeta "se transforma" en producto. Se quita al terminar.
   - **Respaldo sin VT:** clase `.vista-entra` con `@keyframes` equivalentes sobre la vista nueva.
   - **`prefers-reduced-motion: reduce`:** no se llama a `startViewTransition` y en CSS van `::view-transition-*{animation:none}` y `.vista-entra{animation:none}`.
3. **Cabecera:**
   - transparente sobre el hero solo en `#/`; sólida en las demás vistas;
   - fija al bajar, con deslizamiento de 0,4 s;
   - más compacta en el checkout (logo y volver), para que se sienta como otra etapa.
4. **Cajón del carrito** a la derecha:
   - con velo y apertura automática al agregar;
   - barra de progreso hacia el envío gratis, si existe una meta;
   - stepper de cantidad y subtotal;
   - "Finalizar pedido" lleva a `#/checkout`.
   - Debe usar `<dialog>` o `inert` en el fondo, cerrarse con Esc y devolver el foco al botón que lo abrió.
5. **Checkout como vista propia, en pasos:**
   1. contacto;
   2. envío: Shalom / Olva Courier / agencia de bus elegida por el cliente / entrega local en Tarapoto, cada opción **con costo y tiempo promedio**;
   3. pago con Mercado Pago.
   - El resumen va a un lado y se pliega en móvil. Datos del Perú: DNI, región, provincia, distrito, referencia y celular.
   - Botón para guardar los datos en "Mi cuenta", en el navegador.
6. **Ficha de producto como vista:**
   - galería con miniaturas (deslizable en móvil);
   - color con su nombre al lado y talla con agotadas tachadas;
   - stock con punto pulsante; agregar y comprar ahora;
   - acordeones de descripción, cuidados, **envíos y tiempos** y guía de tallas;
   - "también te puede gustar".
7. **Colección como vista:**
   - chips de **subcategorías** (Hombres → Camisas, Polos, Pantalones, Shorts, Zapatillas, Old money…);
   - barra con Filtrar (cajón), contador y orden;
   - grilla de 4 columnas en escritorio y 2 en móvil;
   - **aparición escalonada** con `IntersectionObserver`: una sola vez, `rootMargin` de unos 60 px, pasos de 80–120 ms por columna.

**P1 (muy recomendable)**
8. **Megamenú en escritorio**: tarjetas con imagen por subcategoría. **Menú móvil en cajón**: ítems escalonados (+60 ms) y acordeones con chevron.
9. **Buscador en la cabecera**: barra que la reemplaza, con sugerencias de productos y categorías mientras se escribe, navegación con flechas y Enter, y cierre con Esc.
10. **Vista rápida**: botón "Comprar" que aparece con hover o foco al pie de la foto. Abre un modal que sube 30 px con fundido de unos 0,5 s y tiene "ver ficha completa".
11. **Seguimiento:**
    - Vista `#/seguimiento`: número + correo. Muestra el resultado como **línea de tiempo**: pendiente de pago → pagado → preparando → enviado (agencia y código) → listo para recojo o entregado (o cancelado), cada paso con su fecha.
    - **En el chat Vale**: chip "Hacer seguimiento de mi pedido" → burbuja del cliente → respuesta → **tarjeta-formulario inline** (número, correo, Cancelar / Consultar) → **tarjeta de estado** → chips "otro pedido" y "nueva conversación".
12. **Chat Vale:**
    - tarjeta del producto que se está viendo como contexto inicial;
    - chips con scroll horizontal y marcas "Enviado / Automático · hora";
    - esqueleto de carga y botón de nueva conversación;
    - lanzadores flotantes que **no se tapen**: un solo botón, o WhatsApp dentro del panel.
13. **Mi cuenta ligera**, sin contraseña y sin backend de correo:
    - los datos de envío y los números de pedido se guardan en `localStorage`;
    - el estado real se consulta siempre con número + correo;
    - un botón "olvidar mis datos".

**P2 (pulido)**
14. Entrada del hero tipo máscara: el título sube desde abajo y los botones aparecen con retardo. Solo en `#/` y respetando movimiento reducido.
15. Barra fina de progreso arriba si una vista tarda más de 300 ms (por ejemplo, al consultar un pedido).
16. Cinta de beneficios en movimiento ("Envíos a todo el Perú", Mercado Pago, cambios), con pausa al pasar el mouse y estática si el movimiento está reducido.

**No replicar:** popup de newsletter al entrar, etiqueta flotante de descuento, botones flotantes encimados, píxeles de seguimiento de terceros, y el inicio de sesión con proveedor externo.
