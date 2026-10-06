@echo off
REM Arranca el motor de imagenes de Open Generative AI (sd-server de stable-diffusion.cpp)
REM con Z-Image Turbo, escuchando SOLO en 127.0.0.1:1234. No modifica archivos de la app.
REM Cierra la app Open Generative AI y Wan2GP antes de usarlo (comparten la VRAM).
set D=%APPDATA%\open-generative-ai\local-ai
REM DLL de CUDA 12 tomadas del venv de Wan2GP (sin descargas). Si no existen, sd-server usa Vulkan.
set PATH=C:\AI\Wan2GP\venv\Lib\site-packages\torch\lib;%PATH%
if not exist "%LOCALAPPDATA%\tienda" mkdir "%LOCALAPPDATA%\tienda"
"%D%\bin\sd-server.exe" --listen-ip 127.0.0.1 --listen-port 1234 -v ^
 --diffusion-model "%D%\models\z_image_turbo-Q4_K.gguf" ^
 --llm "%D%\models\Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf" ^
 --vae "%D%\models\ae.safetensors" --offload-to-cpu --diffusion-fa --vae-tiling ^
 --steps 8 --cfg-scale 1.0 --sampling-method euler --scheduler simple -W 1024 -H 1024 ^
 > "%LOCALAPPDATA%\tienda\sd-server.log" 2>&1
