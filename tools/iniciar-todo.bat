@echo off
REM ============================================================================
REM  tools\iniciar-todo.bat - Arranca lo local de Palmera Brava y abre el panel.
REM   1) sd-server (motor de imagenes de Open Generative AI) MINIMIZADO, si no corre.
REM   2) serve.py: el sitio en http://127.0.0.1:8080/tienda-tarapoto/ (solo esta PC).
REM   3) Revisa n8n (Docker Desktop) y Ollama, que arrancan solos al iniciar sesion.
REM   4) Abre http://127.0.0.1:8080/tienda-tarapoto/admin.html
REM  Para detener sd-server: tools\detener-sd-server.bat
REM  Si Windows pregunta "Permitir acceso?" para python, sd-server u ollama: Cancelar.
REM ============================================================================
setlocal
cd /d "%~dp0.."
set "PANEL=http://127.0.0.1:8080/tienda-tarapoto/admin.html"

REM --- 1) sd-server ------------------------------------------------------------
tasklist /FI "IMAGENAME eq sd-server.exe" 2>nul | find /I "sd-server.exe" >nul
if errorlevel 1 (
  echo [1/4] Arrancando sd-server minimizado ^(tarda 1-2 min en cargar el modelo^)...
  echo       Cierra antes la app Open Generative AI y Wan2GP: comparten la VRAM.
  start "sd-server - Palmera Brava" /min cmd /c ""%~dp0iniciar-sd-server.bat""
) else (
  echo [1/4] sd-server ya estaba corriendo.
)

REM --- 2) serve.py -------------------------------------------------------------
curl.exe -s -m 2 -I http://127.0.0.1:8080/tienda-tarapoto/ 2>nul | find /I "PalmeraBravaLocal" >nul
if not errorlevel 1 (
  echo [2/4] serve.py ya estaba abierto en el puerto 8080.
  goto :revisar
)
netstat -ano -p tcp | find ":8080 " | find "LISTENING" >nul
if not errorlevel 1 (
  echo [2/4] OJO: el puerto 8080 lo usa OTRO programa, no serve.py. Cierralo y vuelve a
  echo       ejecutar este .bat ^(el panel y n8n necesitan exactamente el puerto 8080^).
  set "AJENO=1"
  goto :revisar
)
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY ( where py >nul 2>nul && set "PY=py -3" )
if not defined PY (
  echo [2/4] FALTA Python: instala Python 3 o ejecuta el sitio con otro servidor local.
  goto :revisar
)
echo [2/4] Arrancando el sitio local ^(serve.py^) minimizado...
start "Sitio local - serve.py" /min %PY% "%~dp0serve.py"

REM --- 3) n8n y Ollama --------------------------------------------------------
:revisar
echo [3/4] Revisando servicios...
curl.exe -s -m 3 -o nul http://127.0.0.1:5678/healthz
if errorlevel 1 (
  echo       n8n: NO responde. Siguiente paso: abre Docker Desktop; el contenedor n8n arranca solo.
) else (
  echo       n8n: OK
)
curl.exe -s -m 3 -o nul http://127.0.0.1:11434/api/version
if errorlevel 1 (
  echo       Ollama: NO responde. Siguiente paso: abre "Ollama" desde el menu Inicio.
) else (
  echo       Ollama: OK
)

REM --- 4) Esperar a serve.py y abrir el panel ---------------------------------
if defined AJENO (
  echo [4/4] No se abre el panel: primero libera el puerto 8080.
  goto :fin
)
set /a INTENTOS=0
:esperar
curl.exe -s -m 2 -o nul http://127.0.0.1:8080/tienda-tarapoto/
if not errorlevel 1 goto :abrir
set /a INTENTOS+=1
if %INTENTOS% GEQ 15 (
  echo [4/4] serve.py no respondio en 15 s. Revisa su ventana "Sitio local - serve.py".
  goto :fin
)
timeout /t 1 /nobreak >nul
goto :esperar

:abrir
echo [4/4] Abriendo el panel: %PANEL%
start "" "%PANEL%"
echo       sd-server tarda 1-2 min la primera vez; el panel muestra su estado en vivo.

:fin
endlocal
