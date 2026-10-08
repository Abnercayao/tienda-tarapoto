<#
 tools\iniciar-chat.ps1 - Publica el chat de Vale (WF11) y los pedidos (WF13-WF15) en internet con un tunel rapido de Cloudflare.
   1) tools\chat-proxy.py en 127.0.0.1:8787 (allowlist: /chat, /pedido, /seguimiento, /pedido/consultar, /pedido/pago,
      /mp-notificacion y GET /salud; nunca el resto de n8n)
   2) cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate  ->  https://<algo>.trycloudflare.com
   3) registra esa URL en data/chat.json de GitHub llamando al webhook LOCAL de n8n "chat-url" (WF12),
      que solo hace commit si la URL cambio. GitHub Pages la publica en 1-10 min. WF12 tambien la guarda en
      pb_config.TUNEL_URL: es la notification_url de Mercado Pago de los pedidos nuevos (docs/PEDIDOS.md).

 Uso:   tools\iniciar-chat.bat     (doble clic)  = powershell -ExecutionPolicy Bypass -File tools\iniciar-chat.ps1
        tools\detener-chat.bat     (doble clic)  = ... iniciar-chat.ps1 -Detener   (apaga y marca el chat inactivo)
 Opciones: -SinPublicar (no toca data/chat.json)  -Puerto 8787  -N8n http://127.0.0.1:5678
           -Cloudflared <ruta.exe>  -Estado <carpeta>  -EsperaPublicaSeg 60 (0 = no probar la URL publica)

 Clave X-Tienda-Key (la misma de la credencial "Header X-Tienda-Key" de n8n). Se busca en este orden:
   variable de entorno X_TIENDA_KEY (de usuario)  ->  %LOCALAPPDATA%\tienda\x-tienda-key.txt (texto o cifrada).
   Si no existe, se pide UNA vez y se guarda cifrada para tu usuario de Windows (DPAPI) en ese archivo.
   Nunca se escribe en el repo ni se muestra en pantalla.
 Registros: %LOCALAPPDATA%\tienda\chat\ (chat-proxy.log, cloudflared.log, url.txt).
#>
param(
  [switch]$Detener,
  [switch]$SinPublicar,
  [string]$N8n = 'http://127.0.0.1:5678',
  [int]$Puerto = 8787,
  [string]$Cloudflared = '',
  [string]$Estado = '',
  [int]$EsperaPublicaSeg = 60
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 1
$Raiz = Split-Path -Parent $PSScriptRoot
$ProxyPy = Join-Path $PSScriptRoot 'chat-proxy.py'
if (-not $Estado) { $Estado = Join-Path $env:LOCALAPPDATA 'tienda\chat' }
$ArchivoClave = Join-Path $env:LOCALAPPDATA 'tienda\x-tienda-key.txt'
$N8n = $N8n.TrimEnd('/')
if ($N8n -notmatch '^http://(127\.0\.0\.1|localhost):\d{2,5}$') { throw "-N8n debe ser http://127.0.0.1:<puerto> (n8n local). Recibido: $N8n" }
New-Item -ItemType Directory -Force -Path $Estado | Out-Null

function Paso([string]$t) { Write-Host $t }
function Aviso([string]$t) { Write-Host $t -ForegroundColor Yellow }
function Falla([string]$t) { Write-Host $t -ForegroundColor Red; exit 1 }

# ---------- clave X-Tienda-Key ----------
function Leer-Clave {
  $v = $env:X_TIENDA_KEY
  if (-not $v) { $v = [Environment]::GetEnvironmentVariable('X_TIENDA_KEY', 'User') }
  if ($v) { return $v.Trim() }
  if (Test-Path -LiteralPath $ArchivoClave) {
    $t = (Get-Content -LiteralPath $ArchivoClave -Raw -ErrorAction SilentlyContinue)
    if ($t) {
      $t = $t.Trim()
      if ($t -match '^[0-9a-f]{100,}$') {
        try {
          $ss = ConvertTo-SecureString $t
          $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
          try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
        } catch { Aviso "No pude descifrar $ArchivoClave (se guardo con otro usuario de Windows). Se pedira de nuevo." }
      } else { return $t }
    }
  }
  if (-not [Environment]::UserInteractive) { Falla "Falta la clave X-Tienda-Key. Siguiente paso: crea $ArchivoClave con la clave de la credencial 'Header X-Tienda-Key' de n8n." }
  Write-Host 'Pega la clave X-Tienda-Key (la de la credencial "Header X-Tienda-Key" de n8n). Se guarda cifrada solo para tu usuario.'
  $ss = Read-Host -AsSecureString 'Clave X-Tienda-Key'
  if ($ss.Length -lt 8) { Falla 'La clave es muy corta (minimo 8 caracteres). Siguiente paso: vuelve a ejecutar y pegala completa.' }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ArchivoClave) | Out-Null
  Set-Content -LiteralPath $ArchivoClave -Value (ConvertFrom-SecureString $ss) -Encoding ASCII
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

# ---------- HTTP (Windows PowerShell 5.1 y 7) ----------
function Pedir([string]$Metodo, [string]$Url, [hashtable]$Cab, [string]$Cuerpo, [int]$Seg) {
  $r = @{ status = 0; texto = ''; json = $null }
  try {
    $p = @{ Uri = $Url; Method = $Metodo; UseBasicParsing = $true; TimeoutSec = $Seg; Headers = $Cab }
    if ($Cuerpo) { $p.Body = [Text.Encoding]::UTF8.GetBytes($Cuerpo); $p.ContentType = 'application/json; charset=utf-8' }
    $x = Invoke-WebRequest @p
    $r.status = [int]$x.StatusCode; $r.texto = [string]$x.Content
  } catch {
    $resp = $null
    if ($_.Exception -and ($_.Exception.PSObject.Properties.Name -contains 'Response')) { $resp = $_.Exception.Response }
    if ($resp) {
      $r.status = [int]$resp.StatusCode
      try { $sr = New-Object IO.StreamReader($resp.GetResponseStream()); $r.texto = $sr.ReadToEnd() } catch { $r.texto = '' }
      if (-not $r.texto -and $_.ErrorDetails) { $r.texto = [string]$_.ErrorDetails.Message }
    } else { $r.texto = $_.Exception.Message }
  }
  try { if ($r.texto) { $r.json = $r.texto | ConvertFrom-Json } } catch { $r.json = $null }
  return $r
}

# Llama al webhook local chat-url (WF12). Reintenta 409/502/504 hasta 3 veces.
function Registrar([string]$CuerpoJson) {
  $clave = Leer-Clave
  for ($i = 1; $i -le 3; $i++) {
    $r = Pedir 'POST' "$N8n/webhook/chat-url" @{ 'X-Tienda-Key' = $clave } $CuerpoJson 90
    if ($r.status -eq 200 -and $r.json -and $r.json.ok) { return $r.json }
    if ($r.status -eq 401 -or $r.status -eq 403) {
      Aviso 'n8n rechazo la clave X-Tienda-Key (403).'
      Aviso "Siguiente paso: corrige X_TIENDA_KEY o borra $ArchivoClave y vuelve a ejecutar (te la pedira)."
      return $null
    }
    if ($r.status -eq 404) { Aviso 'n8n no tiene el webhook chat-url. Siguiente paso: importa y publica WF12 (docs\CHAT-VENDEDOR.md).'; return $null }
    $err = $r.texto
    if ($r.json -and ($r.json.PSObject.Properties.Name -contains 'error')) { $err = [string]$r.json.error }
    if ($r.status -eq 400 -or $r.status -eq 422) { Aviso "chat-url rechazo el pedido ($($r.status)): $err"; return $null }
    Aviso "Intento $i de 3: chat-url respondio $($r.status). $err"
    if ($i -lt 3) { Start-Sleep -Seconds 4 }
  }
  return $null
}

# ---------- procesos ----------
function Guardar-Pid([string]$Nombre, $Proc) {
  Set-Content -LiteralPath (Join-Path $Estado "$Nombre.pid") -Value ("{0}|{1}" -f $Proc.Id, $Proc.ProcessName) -Encoding ASCII
}
function Matar([int]$IdProc) { & cmd.exe /d /c "taskkill /PID $IdProc /T /F >nul 2>&1" | Out-Null }
# Lee un archivo que otro proceso tiene abierto para escribir (los registros de cloudflared).
function Leer-Compartido([string]$Archivo) {
  $fs = [IO.File]::Open($Archivo, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]'ReadWrite, Delete')
  try { return (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Dispose() }
}
function Detener-Procesos {
  $n = 0
  foreach ($nombre in @('cloudflared', 'chat-proxy')) {
    $f = Join-Path $Estado "$nombre.pid"
    if (Test-Path -LiteralPath $f) {
      $partes = ((Get-Content -LiteralPath $f -Raw) -as [string]).Trim().Split('|')
      $p = Get-Process -Id ([int]$partes[0]) -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -eq $partes[1]) { Matar $p.Id; $n++ }
      Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
    }
  }
  # Restos sin archivo .pid (p. ej. se borro la carpeta): por linea de comandos y puerto.
  try {
    $restos = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
      $c = [string]$_.CommandLine
      ($c -like '*chat-proxy.py*' -and $c -like "*--puerto $Puerto*") -or ($c -like '*tunnel*' -and $c -like "*--url http://127.0.0.1:$Puerto*")
    }
    foreach ($p in @($restos)) { if ($p.ProcessId -ne $PID) { Matar ([int]$p.ProcessId); $n++ } }
  } catch { }
  return $n
}
function Buscar-Python {
  $c = Get-Command python -All -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike '*WindowsApps*' } | Select-Object -First 1
  if ($c) { return @{ exe = $c.Source; pre = @() } }
  $c = Get-Command py -ErrorAction SilentlyContinue
  if ($c) { return @{ exe = $c.Source; pre = @('-3') } }
  return $null
}
function Buscar-Cloudflared {
  if ($Cloudflared) { if (Test-Path -LiteralPath $Cloudflared) { return $Cloudflared } else { return $null } }
  $c = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($d in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
    if ($d) { $f = Join-Path $d 'cloudflared\cloudflared.exe'; if (Test-Path -LiteralPath $f) { return $f } }
  }
  return $null
}
function Cola([string]$Archivo, [int]$N) { if (Test-Path -LiteralPath $Archivo) { Get-Content -LiteralPath $Archivo -Tail $N -ErrorAction SilentlyContinue | ForEach-Object { '      ' + $_ } } }

# =====================================================================================
if ($Detener) {
  $n = Detener-Procesos
  if ($n) { Paso "Chat detenido: proxy y tunel cerrados ($n proceso(s))." } else { Paso 'El chat no estaba corriendo.' }
  if (-not $SinPublicar) {
    Paso 'Marcando el chat como inactivo en data/chat.json (la web mostrara "Escribenos por WhatsApp")...'
    $j = Registrar '{"activo":false}'
    if ($j) {
      if ($j.cambiado) { Paso "  Hecho (commit $($j.commit)). GitHub Pages lo publica en 1-10 min." } else { Paso '  Ya estaba inactivo; no hizo falta commit.' }
    } else { Aviso '  No se pudo marcar como inactivo. La web igual detecta que el chat no responde y ofrece WhatsApp.' }
  }
  Remove-Item -LiteralPath (Join-Path $Estado 'url.txt') -Force -ErrorAction SilentlyContinue
  exit 0
}

# ---------- 1) requisitos ----------
Paso '[1/5] Revisando n8n y Python...'
$salud = Pedir 'GET' "$N8n/healthz" @{} '' 5
if ($salud.status -ne 200) { Falla "      n8n no responde en $N8n. Siguiente paso: abre Docker Desktop (el contenedor n8n arranca solo) y vuelve a ejecutar." }
$wf11 = Pedir 'OPTIONS' "$N8n/webhook/chat-tienda" @{ 'Origin' = 'https://abnercayao.github.io'; 'Access-Control-Request-Method' = 'POST' } '' 5
if ($wf11.status -lt 200 -or $wf11.status -ge 300) { Aviso "      OJO: WF11 (chat-tienda) no responde ($($wf11.status)). Siguiente paso: publica 'PB WF11 Chat-Vendedor' en n8n. Sigo igual." }
$py = Buscar-Python
if (-not $py) { Falla '      Falta Python 3. Siguiente paso: instala Python 3 (python.org) y vuelve a ejecutar.' }
$cf = Buscar-Cloudflared
if (-not $cf) { Falla '      No encuentro cloudflared.exe. Siguiente paso: instala cloudflared o pasa -Cloudflared <ruta>.' }
if (-not $SinPublicar) { $null = Leer-Clave }  # pedirla ahora (antes de abrir el tunel) si falta

# ---------- 2) proxy ----------
$previos = Detener-Procesos
if ($previos) { Paso "      (cerre $previos proceso(s) de un chat anterior)" }
$logProxy = Join-Path $Estado 'chat-proxy.log'
$logProxyErr = Join-Path $Estado 'chat-proxy.err.log'
Paso "[2/5] Arrancando chat-proxy en http://127.0.0.1:$Puerto ..."
$argsPy = @($py.pre) + @('-u', "`"$ProxyPy`"", '--puerto', "$Puerto", '--destino', "$N8n/webhook/chat-tienda")
$pp = Start-Process -FilePath $py.exe -ArgumentList $argsPy -WorkingDirectory $Raiz -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $logProxy -RedirectStandardError $logProxyErr
Guardar-Pid 'chat-proxy' $pp
$listo = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  if ($pp.HasExited) { break }
  if ((Pedir 'GET' "http://127.0.0.1:$Puerto/salud" @{} '' 2).status -eq 200) { $listo = $true; break }
}
if (-not $listo) { Cola $logProxyErr 8; Detener-Procesos | Out-Null; Falla '      chat-proxy no arranco. Siguiente paso: revisa el error de arriba (puerto ocupado?).' }

# ---------- 3) tunel ----------
$logCf = Join-Path $Estado 'cloudflared.log'
$logCfOut = Join-Path $Estado 'cloudflared.out.log'
Remove-Item -LiteralPath $logCf, $logCfOut -Force -ErrorAction SilentlyContinue
Paso '[3/5] Abriendo el tunel rapido de Cloudflare (sin cuenta; la URL cambia cada vez)...'
$pc = Start-Process -FilePath $cf -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$Puerto", '--no-autoupdate') -WorkingDirectory $Estado `
  -WindowStyle Hidden -PassThru -RedirectStandardError $logCf -RedirectStandardOutput $logCfOut
Guardar-Pid 'cloudflared' $pc
$url = ''
for ($i = 0; $i -lt 120 -and -not $url; $i++) {
  Start-Sleep -Milliseconds 500
  foreach ($f in @($logCf, $logCfOut)) {
    if (-not $url -and (Test-Path -LiteralPath $f)) {
      $t = ''
      try { $t = Leer-Compartido $f } catch { $t = '' }
      foreach ($m in [regex]::Matches($t, 'https://[a-z0-9-]+\.trycloudflare\.com')) {
        if ($m.Value -ne 'https://api.trycloudflare.com') { $url = $m.Value; break }
      }
    }
  }
  if (-not $url -and $pc.HasExited) { break }
}
if (-not $url) { Cola $logCf 12; Detener-Procesos | Out-Null; Falla '      No obtuve la URL del tunel. Siguiente paso: revisa tu internet y vuelve a ejecutar.' }
Set-Content -LiteralPath (Join-Path $Estado 'url.txt') -Value $url -Encoding ASCII
Paso "      URL publica: $url"

# ---------- 4) probar la URL publica ----------
if ($EsperaPublicaSeg -gt 0) {
  Paso "[4/5] Probando $url/salud (hasta $EsperaPublicaSeg s; el DNS nuevo tarda unos segundos)..."
  $nombre = ([Uri]$url).Host
  $ok = $false
  $fin = (Get-Date).AddSeconds($EsperaPublicaSeg)
  while (-not $ok -and (Get-Date) -lt $fin) {
    Start-Sleep -Seconds 3
    $ip = $null
    try { $ip = (Resolve-DnsName -Name $nombre -Type A -Server 1.1.1.1 -DnsOnly -QuickTimeout -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -First 1).IPAddress } catch { $ip = $null }
    if ($ip) {
      # --resolve evita la cache negativa de DNS de Windows (el nombre es nuevo).
      $out = ''
      try { $out = [string](& curl.exe -s -m 8 --resolve "${nombre}:443:$ip" "$url/salud") } catch { $out = '' }
      if ($out -match '"ok":\s*true') { $ok = $true }
    }
  }
  if ($ok) { Paso '      El tunel responde.' } else { Aviso '      El tunel aun no responde desde esta PC (DNS o red). Lo registro igual; la web reintenta sola.' }
} else { Paso '[4/5] (prueba de la URL publica omitida)' }

# ---------- 5) registrar en data/chat.json ----------
if ($SinPublicar) {
  Paso '[5/5] -SinPublicar: no se toca data/chat.json.'
} else {
  Paso '[5/5] Registrando la URL en data/chat.json (webhook local chat-url de n8n)...'
  $j = Registrar ('{"url":"' + $url + '"}')
  if (-not $j) { Aviso '      No se pudo registrar. El chat funciona en esta PC, pero la web publicada no lo vera. Siguiente paso: revisa WF12 y la credencial GitHub.' }
  elseif ($j.cambiado) { Paso "      Hecho: commit $($j.commit). GitHub Pages publica el cambio en 1-10 min." }
  else { Paso '      data/chat.json ya tenia esta URL; no hizo falta commit.' }
}
Write-Host ''
Write-Host "Chat publico activo: $url/chat" -ForegroundColor Green
Write-Host "Pedidos y pagos: $url/pedido, $url/seguimiento y $url/pedido/pago"
Write-Host "Avisos de Mercado Pago (notification_url de cada pedido nuevo): $url/mp-notificacion"
if ($SinPublicar) { Aviso '      -SinPublicar: pb_config.TUNEL_URL no se actualizo; los pedidos nuevos no recibiran avisos de Mercado Pago (la web los confirma al volver).' }
Write-Host "Registros: $Estado"
Write-Host 'Siguiente paso: deja esta PC encendida mientras muestres la demo. Para apagar el chat: tools\detener-chat.bat'
exit 0
