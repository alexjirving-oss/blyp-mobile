# Kill any stale companion on 8765, rebuild, and start fresh.
$ErrorActionPreference = "Stop"
$port = if ($env:BLYP_TIKTOK_COMPANION_PORT) { [int]$env:BLYP_TIKTOK_COMPANION_PORT } else { 8765 }

Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
  ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }

Start-Sleep -Milliseconds 500

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node dist/main.js
