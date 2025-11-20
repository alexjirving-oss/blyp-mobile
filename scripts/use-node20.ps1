param(
  [string]$Version = '20.12.2'
)

$ErrorActionPreference = 'Continue'
function Write-Step($m){ Write-Host "[node20] $m" -ForegroundColor Cyan }
function Write-Ok($m){ Write-Host "[ok]     $m" -ForegroundColor Green }
function Write-Warn($m){ Write-Host "[warn]   $m" -ForegroundColor Yellow }
function Write-Err($m){ Write-Host "[err]    $m" -ForegroundColor Red }

Write-Step "Target Node version: $Version"

# 1) Try NVM for Windows
if (Get-Command nvm -ErrorAction SilentlyContinue) {
  Write-Step 'Using NVM for Windows'
  try {
    nvm install $Version | Out-Null
    nvm use $Version | Out-Null
    & node -v
    Write-Ok 'Switched via NVM'
    exit 0
  } catch { Write-Warn "NVM failed: $($_.Exception.Message)" }
}

# 2) Try Volta
if (Get-Command volta -ErrorAction SilentlyContinue) {
  Write-Step 'Using Volta'
  try {
    volta install "node@$Version" | Out-Null
    & node -v
    Write-Ok 'Switched via Volta'
    exit 0
  } catch { Write-Warn "Volta failed: $($_.Exception.Message)" }
}

# 3) Portable Node fallback (current session only)
$base = 'C:\node20'
$zip = Join-Path $env:TEMP "node-v$Version-win-x64.zip"
$url = "https://nodejs.org/dist/v$Version/node-v$Version-win-x64.zip"

Write-Step "Downloading portable Node from $url"
try {
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 120
} catch {
  Write-Err "Download failed: $($_.Exception.Message)"
  Write-Host "Manual fallback: Download Node $Version (Windows x64 zip) from https://nodejs.org/dist/v$Version/ and extract to C:\\node20, then prepend PATH." -ForegroundColor Yellow
  exit 1
}

Write-Step 'Extracting...'
try {
  if (Test-Path $base) { Remove-Item -Recurse -Force $base }
  Expand-Archive -Path $zip -DestinationPath 'C:\' -Force
  Rename-Item -Path ("C:\node-v$Version-win-x64") -NewName 'node20'
} catch {
  Write-Err "Extract failed: $($_.Exception.Message)"; exit 1
}

Write-Step 'Prepending PATH for this session'
$env:Path = "C:\node20;C:\node20\bin;" + $env:Path
& node -v
Write-Ok 'Portable Node 20 enabled for this session'