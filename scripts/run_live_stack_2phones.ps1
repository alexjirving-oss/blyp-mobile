# scripts/run_live_stack_2phones.ps1
# Launches backend + Metro + logcat in external PowerShell windows.
# Validates 2 devices, checks app install, optionally builds & installs.

param(
  [switch]$Install,              # Force build+install to both devices
  [string]$PackageName = "com.blyp.mobile",
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot ".." )).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($msg) { Write-Host "`nERROR: $msg`n" -ForegroundColor Red; exit 1 }

function RequireCmd($cmd) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "Missing required command: $cmd (check PATH)" }
}

function Start-ExternalPS($title, $workdir, $command) {
  $escapedWorkdir = $workdir.Replace("'", "''")
  $escapedTitle = $title.Replace("'", "''")
  $arg = ('-NoExit -ExecutionPolicy Bypass -Command "cd ''{0}''; `$Host.UI.RawUI.WindowTitle=''{1}''; {2}"' -f $escapedWorkdir, $escapedTitle, $command)
  Start-Process -FilePath "powershell.exe" -ArgumentList $arg
}

RequireCmd "adb"
RequireCmd "node"
RequireCmd "npm"

Write-Host "ProjectRoot: $ProjectRoot"
Set-Location $ProjectRoot

# --- Detect devices ---
$devicesRaw = & adb devices -l
$deviceLines = $devicesRaw | Select-String -Pattern "device(\s|$)" | ForEach-Object { $_.Line } | Where-Object { $_ -notmatch "List of devices" }
$serials = @()
foreach ($line in $deviceLines) {
  $parts = $line -split "\s+"
  if ($parts.Length -ge 2 -and $parts[1] -eq "device") { $serials += $parts[0] }
}

if ($serials.Count -lt 2) {
  Write-Host $devicesRaw
  Fail "Need 2 Android devices connected (Phone 1 + Phone 2). Found: $($serials.Count)"
}

$phone1 = $serials[0]
$phone2 = $serials[1]
Write-Host "Phone 1: $phone1"
Write-Host "Phone 2: $phone2"

# --- Check app install on each phone ---
function IsInstalled($serial, $pkg) {
  try {
    $out = & adb -s $serial shell pm path $pkg 2>$null
    return ($out -match "^package:")
  } catch { return $false }
}

$installed1 = IsInstalled $phone1 $PackageName
$installed2 = IsInstalled $phone2 $PackageName
Write-Host "Installed on Phone 1: $installed1"
Write-Host "Installed on Phone 2: $installed2"

# --- Decide whether to build/install ---
$shouldInstall = $Install -or (-not $installed1) -or (-not $installed2)

if ($shouldInstall) {
  Write-Host "`nBuilding debug APK + installing on both devices..." -ForegroundColor Yellow
  $androidDir = Join-Path $ProjectRoot "android"
  if (-not (Test-Path $androidDir)) { Fail "Missing android/ directory at $androidDir" }

  # Build debug APK
  & powershell -NoProfile -ExecutionPolicy Bypass -Command "cd '$androidDir'; ./gradlew assembleDebug" | Out-Host

  $apk = Join-Path $androidDir "app\build\outputs\apk\debug\app-debug.apk"
  if (-not (Test-Path $apk)) { Fail "APK not found at $apk" }

  # Install on both phones
  & adb -s $phone1 install -r $apk | Out-Host
  & adb -s $phone2 install -r $apk | Out-Host
  Write-Host "Install complete." -ForegroundColor Green
}

# --- Start backend / emulators (choose best available) ---
# Preference order:
# 1) functions/ with npm run serve
# 2) backend/blyp-live-service with npm run dev
# 3) firebase emulators if firebase.json exists

$functionsDir = Join-Path $ProjectRoot "functions"
$backendDir   = Join-Path $ProjectRoot "backend\blyp-live-service"
$firebaseJson = Join-Path $ProjectRoot "firebase.json"

if (Test-Path (Join-Path $functionsDir "package.json")) {
  Start-ExternalPS "BLYP • Functions/Emulators" $functionsDir "npm run serve"
} elseif (Test-Path (Join-Path $backendDir "package.json")) {
  Start-ExternalPS "BLYP • Backend" $backendDir "npm run dev"
} elseif (Test-Path $firebaseJson) {
  RequireCmd "firebase"
  Start-ExternalPS "BLYP • Firebase Emulators" $ProjectRoot "firebase emulators:start"
} else {
  Write-Host "WARN: No functions/ or backend/ detected. Skipping backend window." -ForegroundColor Yellow
}

# --- Start Metro (Expo dev client) ---
Start-ExternalPS "BLYP • Metro (Dev Client)" $ProjectRoot "npx expo start --dev-client"

# --- Logcat windows (one per phone) ---
$logsDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$log1 = Join-Path $logsDir "logcat_phone1.txt"
$log2 = Join-Path $logsDir "logcat_phone2.txt"

Start-ExternalPS "BLYP • Logcat Phone1" $ProjectRoot "adb -s $phone1 logcat -c; adb -s $phone1 logcat | Tee-Object -FilePath '$log1'"
Start-ExternalPS "BLYP • Logcat Phone2" $ProjectRoot "adb -s $phone2 logcat -c; adb -s $phone2 logcat | Tee-Object -FilePath '$log2'"

Write-Host "`nDONE."
Write-Host "Metro + backend + logcats launched in external windows."
Write-Host "Logs:"
Write-Host "  $log1"
Write-Host "  $log2"
Write-Host "`nIf you want to force reinstall next time:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\run_live_stack_2phones.ps1 -Install"
