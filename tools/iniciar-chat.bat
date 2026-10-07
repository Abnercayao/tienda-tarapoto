@echo off
REM ============================================================================
REM  tools\iniciar-chat.bat - Publica el chat de Valeria (agente vendedor) en internet.
REM   1) tools\chat-proxy.py en 127.0.0.1:8787 (solo /chat; nunca el resto de n8n)
REM   2) tunel rapido de Cloudflare -> https://<algo>.trycloudflare.com (cambia cada vez)
REM   3) registra la URL en data/chat.json (GitHub) via el webhook LOCAL chat-url de n8n
REM  Requisitos: n8n (Docker Desktop) con WF11 y WF12 publicados, Ollama, Python 3,
REM  cloudflared. La primera vez pide la clave X-Tienda-Key (se guarda cifrada en
REM  %LOCALAPPDATA%\tienda\x-tienda-key.txt, fuera del repo).
REM  Para apagar el chat: tools\detener-chat.bat
REM  Opciones: tools\iniciar-chat.bat -SinPublicar   (no toca data/chat.json)
REM ============================================================================
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-chat.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo Listo. Puedes cerrar esta ventana: el chat sigue funcionando en segundo plano.) else (echo Hubo un problema ^(codigo %RC%^). Lee el mensaje de arriba.)
pause
endlocal & exit /b %RC%
