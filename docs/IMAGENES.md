# Imágenes con IA local — Palmera Brava

Las 29 imágenes del sitio (16 de producto, 2 de hero, 4 de categoría, 4 del lookbook y 3 del blog) se generaron **en este PC, sin servicios en la nube**. Se usó el motor de Open Generative AI (`sd-server` de stable-diffusion.cpp) con **Z-Image Turbo Q4_K** sobre una **RTX 5060 Ti de 8 GB**, por CUDA.

- Todas tienen `origen: "ia_local"`. La web debe mostrar **"Imagen referencial (IA)"** sobre cada una y el banner *"Catálogo de muestra · precios referenciales"* mientras existan productos `muestra: true`.
- Un producto real (`muestra: false`) **no admite** imágenes `ia_local`; el validador lo impide. Al convertir una muestra en producto real hay que reemplazar antes sus fotos por fotos reales.
- Los prompts están en `tools/image-prompts.json` (del equipo B, contrato §12). El generador es `tools/generar-imagenes.mjs` (Node, sin dependencias).

## Reglas de contenido (control de calidad)

Se revisaron una por una las 29 imágenes finales, abriéndolas a tamaño real y ampliando las zonas dudosas.

| Regla | Cómo se cumple |
|---|---|
| Personas **sin rostro** | Encuadre de clavículas o pecho hacia abajo. Se genera más alto (768×1216 o 1344×1024) y se recortan 192–256 px de arriba. En ninguna imagen se ven ojos, nariz, boca ni mentón. |
| Niños **sin personas** | Las 4 de producto infantil, `cat-ninos`, `look-4` y el blog de protección solar son flat-lay, percha o bodegón. |
| Solo adultos y una sola persona | Excepción a propósito: `hero-1` muestra a dos adultos (pareja), ambos sin rostro. En `look-1` se cambió el escenario porque aparecían otras personas al fondo. |
| Prenda coherente con el producto y su `alt` | Se revisaron color, tipo de prenda y escena frente a `data/*.json`. |
| Sin texto, logos ni marcas de agua | Solo quedan etiquetas lisas diminutas en algunos cuellos (`hero-2`, `cat-ninos`), sin letras legibles. |
| Sin manos ni cuerpos deformes evidentes | Revisado. |
| Peso ≤ 250 KB | Máximo: 158 KB. Total de las 29: ≈ 2,5 MB. Todas son WebP q80 con el tamaño exacto de `size`. |

## Tabla de imágenes

Columna **s gen.**: segundos medidos de petición a sd-server en la ejecución completa del 2026-10-06 (`--force` de las 29 imágenes a una carpeta temporal). Las 29 salieron **idénticas byte a byte** a las del repo.

<!--TABLA-->

### Ajustes del control de calidad

Estas 7 imágenes no pasaron el QA con la seed del JSON y se regeneraron (contrato §12: "otra seed (+1000)"). Los ajustes están en `AJUSTES_QA`, dentro de `tools/generar-imagenes.mjs`. Así, `--force` reproduce exactamente las imágenes aprobadas.

Cada ajuste solo se aplica si la entrada del JSON conserva su seed original. Si el equipo B actualiza `image-prompts.json` con estas seeds y textos, manda el JSON y el ajuste queda inactivo.

| Imagen | Seed | Ajuste | Motivo |
|---|---|---|---|
| `products/prd-0002-1` | 102 → 1102 | `extra`: detalles de guayabera tradicional (4 bolsillos, alforzas) | Intento anterior: reforzar los detalles de guayabera. |
| `products/prd-0011-1` | 111 → 1111 | `extra`: pretina limpia, sin etiquetas | Había objetos de colores raros dentro de la pretina. |
| `products/prd-0016-1` | 116 → 1116 | `extra`: yute natural con una franja | Intento anterior: limitar los colores a la paleta. Salió con franjas turquesa y mango, que están en la paleta y se aceptan. |
| `brand/hero-2` | 202 → 1202 | `extra`: camisas lisas, sin etiquetas | Intento anterior: quitar estampados y etiquetas. |
| `lookbook/look-1` | 401 → 3401 | **`prompt` nuevo**: puesto de fruta de mercado con una pared terracota detrás, "she is the only person in the picture" | Con las seeds 401, 1401 y 2401, y aun con `--extra` "no other people", salían otras personas desenfocadas al fondo del mercado. El modelo ignora las negaciones, así que se cambió el escenario. |
| `lookbook/look-2` | 402 → 1402 | `extra`: plano hasta los pies, con sandalias de cuero | El `alt` dice "sandalias de cuero… encuadre de hombros a pies", pero el prompt cortaba en las rodillas. |
| `blog/proteccion-solar-para-ninos-en-la-selva` | 503 → 1503 | `extra`: frasco de bloqueador liso, sin etiqueta | Intento anterior: quitar texto del frasco. |

Las 22 imágenes restantes pasaron el QA a la primera. Algunas observaciones menores se aceptaron: `prd-0001` tiene cuello camisero abierto en vez de clásico, y en `hero-1` se ve parte del cabello y del cuello de la modelo, sin rostro.

## Tiempos y VRAM medidos

<!--TIEMPOS-->

**VRAM** (`nvidia-smi`, RTX 5060 Ti, 8151 MiB en total):

| Estado | VRAM usada |
|---|---|
| Reposo (sd-server arrancado con `--offload-to-cpu`, escritorio de Windows) | ≈ 1 920 MiB |
| Ollama con `qwen3.5:4b-q4_K_M` cargado | 5 700 MiB (Ollama ocupa ≈ 3,8 GB) |
| Tras `keep_alive: 0` (lo hace el script al empezar) | 1 929 MiB; `/api/ps` vacío |
| **Generando** (pico por imagen) | **6 120 – 6 590 MiB** (768×1024 ≈ 6,1 GB; 1344×1024 ≈ 6,6 GB) |
| GPU durante la generación | 95–100 % de uso, hasta ≈ 170 W |

Proceso `sd-server` en RAM: ≈ 7,3 GB de memoria privada, por `--offload-to-cpu`.

**Conclusión:** Ollama (≈ 3,8 GB) y sd-server (≈ 4,3–4,7 GB generando) **no caben juntos** en 8 GB. Por eso el script descarga primero el modelo de Ollama (`POST /api/generate {"model":"qwen3.5:4b-q4_K_M","keep_alive":0}`) y espera a que `/api/ps` quede vacío. **No se deben usar a la vez** la app de Open Generative AI, Wan2GP ni el bot generando textos con Ollama.

## Cómo regenerar

Requisitos:
- sd-server corriendo: `tools\iniciar-sd-server.bat`. Escucha solo en `127.0.0.1:1234`.
- El contenedor `n8n` encendido. Su GraphicsMagick hace el recorte por tubería (`docker exec -i n8n gm convert png:- … webp:-`); no se escribe en su volumen ni se cambia su configuración.
- Ollama no hace falta: si está encendido, el script lo descarga de la VRAM.

```powershell
node tools\generar-imagenes.mjs --list            # estado: KB, seed y [ajuste QA]
node tools\generar-imagenes.mjs                   # genera solo las que faltan
node tools\generar-imagenes.mjs --force           # regenera las 29 (≈ 7–8 min), idénticas a las actuales
node tools\generar-imagenes.mjs --dry-run --force # qué pediría, sin llamar a sd-server
```

**Para cambiar una imagen que no gusta:**

1. Genera candidatas **fuera del repo**, sin pisar la actual:
   ```powershell
   node tools\generar-imagenes.mjs --only look-3 --seed 1403 --force --salida $env:TEMP\cand
   node tools\generar-imagenes.mjs --only look-3 --seed 2403 --force --salida $env:TEMP\cand2 --extra "Brown leather sandals visible."
   node tools\generar-imagenes.mjs --only look-3 --seed 3403 --force --salida $env:TEMP\cand3 --prompt "<prompt completo nuevo>"
   ```
   - `--extra` añade texto al final del prompt.
   - `--prompt` lo reemplaza entero. Úsalo cuando el escenario provoca el fallo: el modelo no respeta bien "no people".
   - `--only` acepta la ruta, el nombre de archivo o el nombre sin extensión.
2. Revisa la candidata con las reglas de QA de arriba (ampliando la parte superior si hay personas).
3. Copia la elegida a `assets/img/...`.
4. Registra la seed y el texto en `AJUSTES_QA`, o pide al equipo B que los pase a `image-prompts.json`. Así `--force` la reproduce.

Otras opciones del script:

| Opción | Uso |
|---|---|
| `--compression <n>` | Calidad WebP inicial (80 por defecto). |
| `--max-kb <n>` | Peso máximo (250 por defecto). Si una imagen lo supera, el script baja la calidad de 8 en 8 hasta q40. |
| `--retries <n>` | Reintentos con espera creciente (3 por defecto). |
| `--log <archivo.json>` | Guarda un informe con los tiempos y la VRAM de cada imagen. |
| `--sin-ajustes` | Ignora `AJUSTES_QA` y parte del JSON puro. Sin esta opción, un `--seed` sobre una imagen con ajuste conserva el texto (`extra` o `prompt`) del ajuste. |
| `--no-unload` | No descarga Ollama de la VRAM. |

Detalles técnicos:
- **Determinismo:** la misma seed, el mismo prompt y el mismo tamaño dan el mismo archivo, byte a byte. Comprobado en las 29 imágenes.
- **Petición:** `POST http://127.0.0.1:1234/v1/images/generations` con `{"prompt":"<prompt> <sd_cpp_extra_args>{\"seed\":N,\"sample_params\":{\"sample_steps\":8,\"sample_method\":\"euler\",\"scheduler\":\"simple\",\"guidance\":{\"txt_cfg\":1.0}}}</sd_cpp_extra_args>","n":1,"size":"<generar>","output_format":"webp","output_compression":80}`.
  - Las imágenes con recorte se piden en `png` (intermedio sin pérdida) y se pasan a WebP q80 tras recortar.
  - La respuesta llega en `data[0].b64_json`.
  - Se escribe en un `.tmp` y luego se renombra, así nunca queda una imagen a medias.

## Pendientes y observaciones para otros equipos

- **Equipo B (`data/*.json` e `image-prompts.json`):**
  - Conviene pasar las 7 seeds y textos de `AJUSTES_QA` a `image-prompts.json`. Al hacerlo, los ajustes se desactivan solos.
  - En `look-1` hay que reemplazar el prompt entero, no solo añadir texto.
- **Textos `alt` algo inexactos (equipo B):**
  - `lookbook/look-4` dice "gorro legionario", pero la imagen muestra un gorro tipo pescador con cordón y sin cubrenuca.
  - `blog/proteccion-solar…` dice "gorro con cubrenuca", pero se ven dos gorros pescador sin cubrenuca. También hay un traje de baño UV enterizo y un tomatodo.
  - Opciones: ajustar el `alt` o regenerar con más énfasis en el cubrenuca (`prd-0012` sí lo logró).
- **`hero-1`** muestra a dos adultos (hombre y mujer), ambos sin rostro. Si se prefiere estrictamente una persona por imagen, hay que regenerarla.
- **Equipo A (web):** mostrar la etiqueta "Imagen referencial (IA)" sobre cada imagen `ia_local`. Hero y blog son 1344×768 y 1216×832; usar `object-fit: cover` sin recortar por arriba en las imágenes con personas.
- **Licencia del modelo:** por confirmar en la ficha oficial de Z-Image Turbo antes de un uso comercial.
- Las imágenes son **referenciales**: no muestran productos reales de la tienda.
