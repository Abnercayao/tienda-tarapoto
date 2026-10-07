# Imágenes con IA local — Palmera Brava

Las 47 imágenes del sitio se generaron **en este PC, sin servicios en la nube**:

- 34 de producto: 16 de la primera tanda y **18 variantes por color**, añadidas el 2026-10-07.
- 6 de marca: 2 hero y 4 de categoría.
- 4 del lookbook y 3 del blog.

Se usó el motor de Open Generative AI (`sd-server` de stable-diffusion.cpp) con **Z-Image Turbo Q4_K** sobre una **RTX 5060 Ti de 8 GB**, por CUDA.

- **Demo privada:** la web la ve solo quien Abner invita (dueños de negocios), así que **no muestra** etiquetas de "Imagen referencial (IA)", banners de muestra ni créditos de IA. Debe parecer una tienda real.
- `origen: "ia_local"` sigue en `data/products.json` como **metadato interno**: la web no lo muestra. Desde el contrato v2, el validador ya no exige `muestra: true` para usar imágenes `ia_local`.
- Los prompts están en `tools/image-prompts.json`. El generador es `tools/generar-imagenes.mjs` (Node, sin dependencias).

## Imágenes por color

Cada producto de referencia (`prd-0001` a `prd-0016`) tiene **una imagen por cada color**:

- En `data/products.json`, `imagenes[].color` guarda el nombre exacto del color, el mismo de `colores[].nombre`. En la web, al elegir un color cambia la foto.
- La imagen `prd-XXXX-1.webp` corresponde al **primer color** del producto.
- Las variantes se llaman `prd-XXXX-<color-en-slug>.webp`.
- En `image-prompts.json`, cada variante lleva `color` y `variante_de` (la imagen original).
- El prompt de la variante es el del original con solo el color cambiado. Mantiene la misma prenda, la misma escena y el mismo recorte.
- Las seeds de las variantes son `10000 + 100·n + k`. Por ejemplo, `prd-0013` tiene `11301` y `11302`.

`prd-0017` lo creó el bot de Telegram con su propia foto (un solo color). No forma parte de este lote.

| Variante | Color | Seed | KB | s gen. | QA |
|---|---|---|---:|---:|---|
| `prd-0001-blanco-hueso` | Blanco hueso | 10101 | 59 | 24.3 | Aprobada a la primera |
| `prd-0002-celeste` | Celeste | 10201 | 78 | 16.2 | Aprobada a la primera |
| `prd-0003-arena` | Arena | 10301 | 64 | 15.7 | Aprobada a la primera |
| `prd-0003-azul-laguna` | Azul laguna | 10302 | 71 | 15.6 | Aprobada a la primera |
| `prd-0004-verde-oliva` | Verde oliva | 10401 | 65 | 16.1 | Aprobada a la primera |
| `prd-0005-arena` | Arena | 10501 → 30501 | 46 | 16.3 | Regenerada (ver ajustes) |
| `prd-0006-amarillo-sol` | Amarillo sol | 10601 | 91 | 16.2 | Aprobada a la primera |
| `prd-0007-arena` | Arena | 10701 | 64 | 16.0 | Aprobada a la primera |
| `prd-0008-hibisco` | Hibisco | 10801 | 48 | 16.1 | Aprobada a la primera |
| `prd-0009-mango` | Mango | 10901 → 30901 | 85 | 13.2 | Regenerada (ver ajustes) |
| `prd-0010-amarillo-sol` | Amarillo sol | 11001 | 42 | 13.0 | Aprobada a la primera |
| `prd-0011-verde-oliva` | Verde oliva | 11101 | 95 | 13.3 | Aprobada a la primera |
| `prd-0012-mango` | Mango | 11201 | 111 | 13.2 | Aprobada a la primera |
| `prd-0013-blanco-hueso` | Blanco hueso | 11301 | 81 | 13.1 | Aprobada a la primera |
| `prd-0013-tostado` | Tostado | 11302 → 31302 | 86 | 13.1 | Regenerada (ver ajustes) |
| `prd-0014-arena` | Arena | 11401 | 36 | 13.0 | Aprobada a la primera |
| `prd-0015-natural` | Natural | 11501 → 51501 | 76 | 12.8 | Regenerada (ver ajustes) |
| `prd-0016-mango` | Mango | 11601 | 102 | 13.1 | Aprobada a la primera |

La columna **s gen.** cuenta los segundos de petición a sd-server medidos el 2026-10-07:

- Lote de las 18: 273 s en total, con una media de 15,0 s por imagen.
- Con recorte (personas, se piden a 768×1216): ≈ 16 s.
- Sin recorte (768×1024): ≈ 13 s.
- La primera imagen tarda más (24 s) porque el modelo se carga en caliente.

## Reglas de contenido (control de calidad)

Se revisaron una por una las 47 imágenes finales. Las 18 variantes se compararon **lado a lado con la foto original** del producto. En las que muestran personas, se amplió la franja superior (220 px) a tamaño real.

| Regla | Cómo se cumple |
|---|---|
| Personas **sin rostro** | Encuadre de clavículas o pecho hacia abajo. Se genera más alto (768×1216 o 1344×1024) y se recortan 192–256 px de arriba. En ninguna imagen se ven ojos, nariz, boca ni mentón. |
| Niños **sin personas** | Las imágenes de producto infantil (y sus variantes), `cat-ninos`, `look-4` y el blog de protección solar son flat-lay, percha o bodegón. |
| Solo adultos y una sola persona | Excepción a propósito: `hero-1` muestra a dos adultos (pareja), ambos sin rostro. En `look-1` se cambió el escenario porque aparecían otras personas al fondo. |
| Prenda coherente con el producto, su `alt` y **las otras fotos del producto** | Se revisaron el color pedido, el tipo de prenda, el corte y la escena frente a `data/*.json` y frente a la foto `-1`. |
| Sin texto, logos ni marcas de agua | Solo quedan etiquetas lisas diminutas en algunos cuellos (`hero-2`, `cat-ninos`), sin letras legibles. Se descartaron las sandalias con letras grabadas en la plantilla. |
| Sin manos ni cuerpos deformes evidentes | Revisado. |
| Peso ≤ 250 KB | Máximo: 158 KB. Total de las 47: ≈ 3,8 MB. Todas son WebP q80 con el tamaño exacto de `size`. |

### Ajustes del control de calidad

Estas 11 imágenes no pasaron el QA con la seed del JSON y se regeneraron. Los ajustes están en `AJUSTES_QA`, dentro de `tools/generar-imagenes.mjs`. Así, `--force` reproduce exactamente las imágenes aprobadas. En las 4 variantes se comprobó byte a byte.

Cada ajuste solo se aplica si la entrada del JSON conserva su seed original. Si alguien pasa estas seeds y textos a `image-prompts.json`, manda el JSON y el ajuste queda inactivo.

| Imagen | Seed | Ajuste | Motivo |
|---|---|---|---|
| `products/prd-0002-1` | 102 → 1102 | `extra`: detalles de guayabera tradicional (4 bolsillos, alforzas) | Intento anterior: reforzar los detalles de guayabera. |
| `products/prd-0011-1` | 111 → 1111 | `extra`: pretina limpia, sin etiquetas | Había objetos de colores raros dentro de la pretina. |
| `products/prd-0016-1` | 116 → 1116 | `extra`: yute natural con una franja | Intento anterior: limitar los colores a la paleta. Salió con franjas turquesa y mango, que están en la paleta y se aceptan. |
| `products/prd-0005-arena` | 10501 → 30501 | `extra`: vestido de tirantes anchos en línea A, sin costura en la cintura; pared solo con sombras de palmera | Salía con cintura imperio fruncida, un corte distinto al de `prd-0005-1`, y con la sombra de una cabeza de perfil en la pared. |
| `products/prd-0009-mango` | 10901 → 30901 | `extra`: solo la parte de arriba, polo de baño de manga larga con basta recta | Salía un traje de baño enterizo, no el polo UV del producto. |
| `products/prd-0013-tostado` | 11302 → 31302 | `extra`: paja tostada caramelo, claramente más oscura que la natural | El tono casi no se distinguía del color Natural. La seed 21302 salió con manchas rojizas. |
| `products/prd-0015-natural` | 11501 → 51501 | `extra`: plantillas de cuero lisas, sin marcas | Letras grabadas en las plantillas, también con las seeds 21501, 31501 y 41501. |
| `brand/hero-2` | 202 → 1202 | `extra`: camisas lisas, sin etiquetas | Intento anterior: quitar estampados y etiquetas. |
| `lookbook/look-1` | 401 → 3401 | **`prompt` nuevo**: puesto de fruta de mercado con una pared terracota detrás, "she is the only person in the picture" | Con las seeds 401, 1401 y 2401, y aun con `--extra` "no other people", salían otras personas desenfocadas al fondo del mercado. El modelo ignora las negaciones, así que se cambió el escenario. |
| `lookbook/look-2` | 402 → 1402 | `extra`: plano hasta los pies, con sandalias de cuero | El `alt` dice "sandalias de cuero… encuadre de hombros a pies", pero el prompt cortaba en las rodillas. |
| `blog/proteccion-solar-para-ninos-en-la-selva` | 503 → 1503 | `extra`: frasco de bloqueador liso, sin etiqueta | Intento anterior: quitar texto del frasco. |

Las demás imágenes pasaron el QA a la primera. Algunas observaciones menores se aceptaron:

- `prd-0001` tiene cuello camisero abierto en vez de clásico. Su variante blanco hueso también, así que son coherentes entre sí.
- En `hero-1` se ve parte del cabello y del cuello de la modelo, sin rostro.
- `prd-0003-azul-laguna`: el modelo lleva un short mango, que no es parte del producto.
- `prd-0013-tostado` sale sin el bordado de colores que tienen el Natural y el Blanco hueso.
- `prd-0012-mango` sale sin la banda de contraste.
- `prd-0016-mango` es un bolso entero color mango, sin franja.

## Tiempos y VRAM medidos

**VRAM** (`nvidia-smi`, RTX 5060 Ti, 8151 MiB en total):

| Estado | VRAM usada |
|---|---|
| Reposo (sd-server arrancado con `--offload-to-cpu`, escritorio de Windows) | ≈ 1 840 – 1 940 MiB |
| Ollama con `qwen3.5:4b-q4_K_M` cargado | 5 700 MiB (Ollama ocupa ≈ 3,8 GB) |
| Tras `keep_alive: 0` (lo hace el script al empezar) | ≈ 1 930 MiB; `/api/ps` vacío |
| **Generando** (pico por imagen) | **6 120 – 6 770 MiB** (768×1024 ≈ 6,1–6,4 GB; 768×1216 ≈ 6,3–6,8 GB; 1344×1024 ≈ 6,6 GB) |
| GPU durante la generación | 95–100 % de uso, hasta ≈ 170 W |

Proceso `sd-server` en RAM: ≈ 7,3 GB de memoria privada, por `--offload-to-cpu`.

**Conclusión:** los modelos de Ollama no caben en 8 GB junto con sd-server generando (≈ 4,3–4,8 GB):

- `qwen3.5:4b` del bot ocupa ≈ 3,8 GB.
- `llama3.1:8b` del chat de la web ocupa ≈ 4,9 GB.

Por eso, al empezar, el script pide a Ollama `/api/ps` y descarga **todos** los modelos cargados con `POST /api/generate {"model":<m>,"keep_alive":0}`. Luego espera a que `/api/ps` quede vacío. Si `/api/ps` no responde, descarga `--model`.

**No se deben usar a la vez** la app de Open Generative AI, Wan2GP ni el bot o el chat generando textos con Ollama. Mientras se generan imágenes, el chat de la web puede tardar más o responder con el mensaje de respaldo.

## Cómo regenerar

Requisitos:

- **sd-server corriendo** con `tools\iniciar-sd-server.bat`. Escucha solo en `127.0.0.1:1234`.
  - Para que siga encendido al cerrar la terminal, arráncalo separado desde PowerShell:
    ```powershell
    Start-Process cmd.exe -ArgumentList '/c','C:\Users\abner\dev\tienda-tarapoto\tools\iniciar-sd-server.bat' -WindowStyle Hidden
    ```
  - En Git Bash, `cmd.exe /c …` falla: MSYS convierte `/c` en `C:/` y se abre un `cmd` interactivo.
  - Para comprobar que responde: `http://127.0.0.1:1234/sdcpp/v1/capabilities`.
  - Para apagarlo: `tools\detener-sd-server.bat`.
- **El contenedor `n8n` encendido.** Su GraphicsMagick hace el recorte por tubería (`docker exec -i n8n gm convert png:- … webp:-`); no se escribe en su volumen ni se cambia su configuración.
- **Ollama no hace falta.** Si está encendido, el script descarga sus modelos de la VRAM.

```powershell
node tools\generar-imagenes.mjs --list            # estado: KB, seed y [ajuste QA]
node tools\generar-imagenes.mjs                   # genera solo las que faltan
node tools\generar-imagenes.mjs --force           # regenera las 47 (≈ 12 min), idénticas a las actuales
node tools\generar-imagenes.mjs --dry-run --force # qué pediría, sin llamar a sd-server
```

**Para añadir un color a un producto:**

1. Añade el color en `data/products.json` (`colores[]`, `stock_por_color`) y una entrada en `imagenes[]` con `color`.
2. Añade en `image-prompts.json` una entrada con `color` y `variante_de`. Copia el prompt del original y cambia solo el color. Usa la siguiente seed libre de la serie `10000 + 100·n + k`.
3. Ejecuta `node tools\generar-imagenes.mjs`. Solo genera las que faltan.
4. Revisa la imagen lado a lado con la original (sigue los pasos de abajo).

**Para cambiar una imagen que no gusta:**

1. Genera candidatas **fuera del repo**, sin pisar la actual:
   ```powershell
   node tools\generar-imagenes.mjs --only look-3 --seed 1403 --force --salida $env:TEMP\cand
   node tools\generar-imagenes.mjs --only look-3 --seed 2403 --force --salida $env:TEMP\cand2 --extra "Brown leather sandals visible."
   node tools\generar-imagenes.mjs --only look-3 --seed 3403 --force --salida $env:TEMP\cand3 --prompt "<prompt completo nuevo>"
   ```
   - `--extra` añade texto al final del prompt.
   - `--prompt` lo reemplaza entero. Úsalo cuando el escenario provoca el fallo: el modelo no respeta bien "no people".
   - Las negaciones funcionan mal en general. Describe en positivo lo que quieres, por ejemplo "plain smooth blank leather insoles".
   - `--only` acepta la ruta, el nombre de archivo o el nombre sin extensión.
2. Revisa la candidata con las reglas de QA de arriba, ampliando la parte superior si hay personas.
   - Para comparar con la original sin instalar nada, usa un contenedor desechable: `docker run --rm -v <products>:/in:ro -v <tmp>:/out --entrypoint gm docker.n8n.io/n8nio/n8n:2.40.7 convert /in/a.webp /in/b.webp -resize 480x640 +append /out/lado-a-lado.png`.
3. Copia la elegida a `assets/img/...`.
4. Registra la seed y el texto en `AJUSTES_QA`, o pásalos a `image-prompts.json`. Así `--force` la reproduce.

Otras opciones del script:

| Opción | Uso |
|---|---|
| `--compression <n>` | Calidad WebP inicial (80 por defecto). |
| `--max-kb <n>` | Peso máximo (250 por defecto). Si una imagen lo supera, el script baja la calidad de 8 en 8 hasta q40. |
| `--retries <n>` | Reintentos con espera creciente (3 por defecto). |
| `--log <archivo.json>` | Guarda un informe con los tiempos y la VRAM de cada imagen. |
| `--sin-ajustes` | Ignora `AJUSTES_QA` y parte del JSON puro. Sin esta opción, un `--seed` sobre una imagen con ajuste conserva el texto (`extra` o `prompt`) del ajuste. |
| `--no-unload` | No descarga los modelos de Ollama de la VRAM. |
| `--model <nombre>` | Modelo a descargar si `/api/ps` no responde (`qwen3.5:4b-q4_K_M`). |

Detalles técnicos:

- **Determinismo:** la misma seed, el mismo prompt y el mismo tamaño dan el mismo archivo, byte a byte. Comprobado en las 29 originales y en las 4 variantes con ajuste.
- **Petición:** `POST http://127.0.0.1:1234/v1/images/generations` con `{"prompt":"<prompt> <sd_cpp_extra_args>{\"seed\":N,\"sample_params\":{\"sample_steps\":8,\"sample_method\":\"euler\",\"scheduler\":\"simple\",\"guidance\":{\"txt_cfg\":1.0}}}</sd_cpp_extra_args>","n":1,"size":"<generar>","output_format":"webp","output_compression":80}`.
  - Las imágenes con recorte se piden en `png` (intermedio sin pérdida) y se pasan a WebP q80 tras recortar.
  - La respuesta llega en `data[0].b64_json`.
  - Se escribe en un `.tmp` y luego se renombra, así nunca queda una imagen a medias.

## Pendientes y observaciones para otros equipos

- **`data/*.json` e `image-prompts.json`:**
  - Conviene pasar las 11 seeds y textos de `AJUSTES_QA` a `image-prompts.json`. Al hacerlo, los ajustes se desactivan solos.
  - En `look-1` hay que reemplazar el prompt entero, no solo añadir texto.
- **Textos `alt` algo inexactos:**
  - `lookbook/look-4` dice "gorro legionario", pero la imagen muestra un gorro tipo pescador con cordón y sin cubrenuca.
  - `blog/proteccion-solar…` dice "gorro con cubrenuca", pero se ven dos gorros pescador sin cubrenuca. También hay un traje de baño UV enterizo y un tomatodo.
  - Opciones: ajustar el `alt` o regenerar con más énfasis en el cubrenuca (`prd-0012` sí lo logró).
- **`hero-1`** muestra a dos adultos (hombre y mujer), ambos sin rostro. Si se prefiere estrictamente una persona por imagen, hay que regenerarla.
- **Web:**
  - Hero y blog son 1344×768 y 1216×832. Usar `object-fit: cover` sin recortar por arriba en las imágenes con personas.
  - Todas las fotos de producto son 768×1024, así que cambiar de color no mueve el diseño.
- **Licencia del modelo:** por confirmar en la ficha oficial de Z-Image Turbo antes de un uso comercial.
- Las imágenes no muestran productos reales de una tienda. Cuando un cliente contrate el servicio, se reemplazan por sus fotos (`origen: "foto"`).
