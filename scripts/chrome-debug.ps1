# Starts Google Chrome with a DEDICATED profile and the DevTools port open on 127.0.0.1 only (Windows).
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$profile = if ($env:CHROME_PROFILE_DIR) { $env:CHROME_PROFILE_DIR } else { Join-Path $root ".chrome-profile" }
$port = if ($env:CHROME_DEBUG_PORT) { $env:CHROME_DEBUG_PORT } else { "9222" }
New-Item -ItemType Directory -Force -Path $profile | Out-Null
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = if ($env:CHROME_BIN) { $env:CHROME_BIN } else { $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1 }
if (-not $chrome) { Write-Error "Chrome não encontrado. Defina CHROME_BIN."; exit 1 }
Write-Host "Perfil dedicado: $profile"
Write-Host "Porta de depuração: 127.0.0.1:$port (nunca 0.0.0.0)"
& $chrome --user-data-dir="$profile" --remote-debugging-address=127.0.0.1 --remote-debugging-port=$port --no-first-run --no-default-browser-check "https://www.instagram.com/"
