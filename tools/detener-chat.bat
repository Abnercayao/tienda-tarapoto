@echo off
REM ============================================================================
REM  tools\detener-chat.bat - Apaga el chat publico de Valeria.
REM   - Cierra chat-proxy.py y el tunel de Cloudflare (cloudflared).
REM   - Marca data/chat.json como inactivo (webhook local chat-url de n8n): la web
REM     muestra "Escribenos por WhatsApp" en 1-10 min.
REM  No toca n8n, Ollama ni serve.py. Para volver a encenderlo: tools\iniciar-chat.bat
REM  Opciones: tools\detener-chat.bat -SinPublicar   (solo cierra procesos)
REM ============================================================================
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-chat.ps1" -Detener %*
set "RC=%ERRORLEVEL%"
echo.
pause
endlocal & exit /b %RC%
