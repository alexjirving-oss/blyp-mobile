# Blyp Mobile - Reset Dev Environment
param(
    [switch]$DeepClean,          # Also clears user-level Gradle caches (slower)
    [switch]$NoAndroidClean,     # Skip Android project cache cleanup
    [switch]$NoNpmClean          # Skip npm cache clean
)

$ErrorActionPreference = 'SilentlyContinue'

function Write-Step($msg) { Write-Host "[reset] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[ok]    $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[warn]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[err]   $msg" -ForegroundColor Red }

function Remove-Safe([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return }
    if (Test-Path $path) {
        try {
            Remove-Item -Recurse -Force $path -ErrorAction Stop
            Write-Ok "Deleted $path"
        }
        catch {
            Write-Warn "Failed to delete ${path}: $($_.Exception.Message)"
        }
    } else {
        Write-Step "Skip (not found): $path"
    }
}

# Project root = parent of this script's folder
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ProjectRoot
Write-Step "Project root: $ProjectRoot"

# 1) Kill lingering processes that might hold file locks
Write-Step 'Killing lingering processes (node, expo, adb, gradle, java)'
foreach ($p in 'node.exe','expo.exe','adb.exe','gradle.exe','java.exe') {
    try { taskkill /f /im $p 2>$null | Out-Null } catch {}
}
Start-Sleep -Milliseconds 400

# 2) Clear project-local caches
Write-Step 'Clearing project caches (.expo, .expo-shared, node_modules/.cache)'
Remove-Safe (Join-Path $ProjectRoot '.expo')
Remove-Safe (Join-Path $ProjectRoot '.expo-shared')
Remove-Safe (Join-Path $ProjectRoot 'node_modules\.cache')

# 3) Clear Metro/Expo global caches
Write-Step 'Clearing Metro/Expo global caches'
Remove-Safe (Join-Path $env:TEMP 'metro-cache')
Remove-Safe (Join-Path $env:LOCALAPPDATA 'Temp\metro-cache')
Remove-Safe (Join-Path $env:APPDATA 'Expo')

# 4) Clear Android build caches (project-scoped)
if (-not $NoAndroidClean) {
    Write-Step 'Clearing Android project caches (android/.gradle, android/app/build)'
    Remove-Safe (Join-Path $ProjectRoot 'android\.gradle')
    Remove-Safe (Join-Path $ProjectRoot 'android\app\build')
} else {
    Write-Step 'Skipping Android project cache cleanup (NoAndroidClean)'
}

# 5) Deep clean (optional): user Gradle caches (can be large)
if ($DeepClean) {
    Write-Step 'DeepClean enabled: clearing user Gradle caches (~/.gradle/caches)'
    Remove-Safe (Join-Path $env:USERPROFILE '.gradle\caches')
} else {
    Write-Step 'DeepClean disabled: keeping user Gradle caches'
}

# 6) npm cache clean
if (-not $NoNpmClean) {
    Write-Step 'Cleaning npm cache (npm cache clean --force)'
    try { npm cache clean --force | Out-Null; Write-Ok 'npm cache cleaned' } catch { Write-Warn "npm cache clean failed: $($_.Exception.Message)" }
} else {
    Write-Step 'Skipping npm cache clean (NoNpmClean)'
}

# 7) Stop ADB daemon
Write-Step 'Stopping ADB daemon'
$adb = Join-Path $env:LOCALAPPDATA 'Android\sdk\platform-tools\adb.exe'
if (Test-Path $adb) {
    & $adb kill-server 2>$null | Out-Null
    Write-Ok 'ADB daemon stopped'
} else {
    Write-Step 'ADB not found; skipping adb kill-server'
}

Write-Host ''
Write-Ok 'CLEANUP COMPLETE'
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1) Start Metro:'
Write-Host '     npx expo start --dev-client --tunnel --clear' -ForegroundColor Gray
Write-Host '     (Or use LAN: npx expo start --dev-client --port 8081 --clear)'
Write-Host '  2) In Dev Client, Scan QR from Metro to attach and stream logs.'
