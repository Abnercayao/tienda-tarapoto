@echo off
REM ============================================================================
REM  tools\detener-sd-server.bat - Detiene sd-server (motor de imagenes) y libera
REM  la VRAM y unos 8 GB de RAM. No toca n8n, Ollama ni serve.py.
REM  Si el bot estaba generando una imagen (/imagen o el panel), ese pedido falla
REM  y el bot avisa; se puede repetir despues con tools\iniciar-sd-server.bat.
REM ============================================================================
setlocal
tasklist /FI "IMAGENAME eq sd-server.exe" 2>nul | find /I "sd-server.exe" >nul
if errorlevel 1 (
  echo sd-server no estaba corriendo.
  goto :fin
)
REM sd-server es un proceso de consola sin ventana propia: se cierra con /F.
taskkill /IM sd-server.exe /F >nul 2>nul
timeout /t 2 /nobreak >nul
tasklist /FI "IMAGENAME eq sd-server.exe" 2>nul | find /I "sd-server.exe" >nul
if errorlevel 1 (
  echo sd-server detenido. El puerto 127.0.0.1:1234 queda libre.
) else (
  echo No se pudo detener sd-server. Siguiente paso: cierra la ventana "sd-server - Palmera Brava"
  echo o finaliza "sd-server.exe" desde el Administrador de tareas.
)
:fin
endlocal
