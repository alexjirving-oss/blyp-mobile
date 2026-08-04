param(
  [string]$HostSerial = "",
  [string]$ViewerSerial = "",
  [int]$CaptureSeconds = 240,
  # Used only for labeling/swap detection (host.log vs viewer.log). This should match what the app prints in `[AUTH DEBUG]` as `uid`.
  [string]$ExpectedHostUid = "william@tapaquatics.com",
  [string]$ExpectedViewerUid = "alexjirving2@gmail.com",
  [switch]$SkipBuildInstall,
  [switch]$SkipCapture,
  [switch]$KeepRunning,
  [switch]$KillPorts = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. "$PSScriptRoot\lib\DeviceSelect.ps1"
. "$PSScriptRoot\lib\ProcessHelpers.ps1"

function Assert-Cmd([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "Missing '$name' in PATH." }
}

function Kill-PortListener {
  param([int]$Port)

  try {
    $conn = Get-PortOwner -Port $Port
    if (-not $conn) { return }

    $ownerPid = $conn.OwningProcess
    if (-not $ownerPid) { return }

    Write-Host "[KILL] Port $Port owned by PID $ownerPid" -ForegroundColor Yellow
    Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
  } catch {
    Write-Warning "[KILL] Failed to kill owner of port ${Port}: $($_.Exception.Message)"
  }
}

function Find-BackendPath {
  param([string]$Root)
  $default = Join-Path $Root "backend\blyp-live-service"
  if (Test-Path $default) { return $default }
  return $null
}

function Resolve-MetroCommand {
  param([string]$Root)

  $pkg = Join-Path $Root "package.json"
  if (Test-Path $pkg) {
    try {
      $json = Get-Content $pkg -Raw | ConvertFrom-Json
      if ($json.scripts.'start:dev') {
        return "npm run start:dev -- --clear --port 8081"
      }
      if ($json.scripts.start) {
        # Respect repo instructions: dev client, do not switch to Expo Go.
        return "npm run start -- --dev-client --clear --port 8081"
      }
    } catch { }
  }

  return "npx expo start --dev-client --clear --port 8081"
}

function Start-LogcatCapture {
  param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$Path
  )

  Ensure-Directory -Path (Split-Path $Path -Parent)

  # Use a dedicated PowerShell process so we can stop it deterministically.
  $cmd = "adb -s $Serial logcat -v time *:V | Tee-Object -FilePath '$Path' -Append"
  $args = @('-NoLogo','-NoProfile','-Command', $cmd)
  return Start-Process -FilePath powershell.exe -ArgumentList $args -WindowStyle Hidden -PassThru
}

function Stop-IfRunning {
  param($proc)
  if ($proc -and -not $proc.HasExited) {
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
  }
}

function Extract-AuthUid {
  param([string]$Path)

  if (-not (Test-Path $Path)) { return $null }

  $hit = Select-String -Path $Path -Pattern "\[AUTH DEBUG\]" -ErrorAction SilentlyContinue | Select-Object -Last 30
  if (-not $hit) { return $null }

  $text = ($hit | ForEach-Object { $_.Line }) -join "`n"
  $m = [regex]::Match($text, '"uid"\s*:\s*"([^"]+)"')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

function Write-SummarySignals {
  param(
    [Parameter(Mandatory=$true)][string]$HostLog,
    [Parameter(Mandatory=$true)][string]$ViewerLog,
    [Parameter(Mandatory=$true)][string]$OutPath
  )

  "=== SIGNAL SUMMARY ===" | Out-File -FilePath $OutPath -Encoding utf8
  "HOST:   $HostLog" | Add-Content -Path $OutPath
  "VIEWER: $ViewerLog" | Add-Content -Path $OutPath
  "" | Add-Content -Path $OutPath

  $patterns = @(
    "\\/guest\\/request",
    "\\/guest\\/accept",
    "\\/guest\\/token",
    "token",
    "stageArn",
    "streamId",
    "LOCAL_",
    "REMOTE_",
    "PUBLISHED",
    "Publish state changed",
    "FIRST_FRAME",
    "firstFrame",
    "Exception",
    "ERROR"
  )

  "--- HOST (filtered) ---" | Add-Content -Path $OutPath
  foreach ($p in $patterns) {
    Select-String -Path $HostLog -Pattern $p -ErrorAction SilentlyContinue | Select-Object -Last 6 | ForEach-Object { $_.Line } | Add-Content -Path $OutPath
  }

  "" | Add-Content -Path $OutPath
  "--- VIEWER (filtered) ---" | Add-Content -Path $OutPath
  foreach ($p in $patterns) {
    Select-String -Path $ViewerLog -Pattern $p -ErrorAction SilentlyContinue | Select-Object -Last 6 | ForEach-Object { $_.Line } | Add-Content -Path $OutPath
  }
}

Assert-Cmd "adb"
Assert-Cmd "node"
Assert-Cmd "npm"
Assert-Cmd "npx"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

adb start-server | Out-Null
$devices = Select-TwoDevices -HostSerial $HostSerial -ViewerSerial $ViewerSerial
$hostSerialResolved = $devices.Host
$viewerSerialResolved = $devices.Viewer

Write-Host "HOST=$hostSerialResolved" -ForegroundColor Cyan
Write-Host "VIEWER=$viewerSerialResolved" -ForegroundColor Cyan

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = Join-Path $root "artifacts\ci\$timestamp"
Ensure-Directory -Path $outDir

$backendLog = Join-Path $outDir "backend.log"
$metroLog = Join-Path $outDir "metro.log"
$hostRawLog = Join-Path $outDir "logcat_raw_$hostSerialResolved.log"
$viewerRawLog = Join-Path $outDir "logcat_raw_$viewerSerialResolved.log"
$hostPng = Join-Path $outDir "host_screen.png"
$viewerPng = Join-Path $outDir "viewer_screen.png"
$summaryPath = Join-Path $outDir "summary_signals.txt"

if ($KillPorts) {
  Write-Host "[FRESH START] Killing port listeners (8081, 4000, 5001)" -ForegroundColor Yellow
  Kill-PortListener -Port 8081
  Kill-PortListener -Port 4000
  Kill-PortListener -Port 5001
}

# Always ensure device->PC connectivity for Metro + live-service (+ Functions emulator when used).
Write-Host "[ADB REVERSE] tcp:8081, tcp:4000, tcp:5001 on both devices" -ForegroundColor Yellow
adb -s $hostSerialResolved reverse "tcp:8081" "tcp:8081" | Out-Null
adb -s $viewerSerialResolved reverse "tcp:8081" "tcp:8081" | Out-Null
adb -s $hostSerialResolved reverse "tcp:4000" "tcp:4000" | Out-Null
adb -s $viewerSerialResolved reverse "tcp:4000" "tcp:4000" | Out-Null
adb -s $hostSerialResolved reverse "tcp:5001" "tcp:5001" | Out-Null
adb -s $viewerSerialResolved reverse "tcp:5001" "tcp:5001" | Out-Null

$apkPath = Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
if (-not $SkipBuildInstall) {
  Write-Host "[BUILD] Android debug APK" -ForegroundColor Yellow
  $gradleLog = Join-Path $outDir "gradle_assembleDebug.log"
  $gradlew = Join-Path $root "android\gradlew.bat"
  if (-not (Test-Path $gradlew)) { throw "Missing gradlew at $gradlew" }

  # Some Expo/Gradle integration expects NODE_ENV to be defined.
  # Default to development for local/CI-like runs to avoid hard failure.
  if (-not $env:NODE_ENV -or [string]::IsNullOrWhiteSpace($env:NODE_ENV)) {
    $env:NODE_ENV = "development"
    Write-Host "[ENV] NODE_ENV was not set; defaulting to 'development'" -ForegroundColor Yellow
  }

  Push-Location (Join-Path $root "android")
  try {
    & $gradlew ":app:assembleDebug" "--no-daemon" 2>&1 | Tee-Object -FilePath $gradleLog -Append | Out-Host
  } finally {
    Pop-Location
  }

  if (-not (Test-Path $apkPath)) { throw "APK not found at $apkPath" }

  Write-Host "[INSTALL] $apkPath -> host + viewer" -ForegroundColor Yellow
  adb -s $hostSerialResolved install -r -d $apkPath | Out-Null
  adb -s $viewerSerialResolved install -r -d $apkPath | Out-Null
}

# Start backend + Metro in their own windows (keeps this terminal clean).
$backendPath = Find-BackendPath -Root $root
if (-not $backendPath) { throw "Backend not found at backend/blyp-live-service" }

$metroCmd = Resolve-MetroCommand -Root $root

Write-Host "[BACKEND] starting (logs -> $backendLog)" -ForegroundColor Yellow
$backendProc = Start-LoggedProcess -WorkingDirectory $backendPath -Command "npm run dev" -WindowTitle "BLYP BACKEND" -LogPath $backendLog

Write-Host "[METRO] starting (logs -> $metroLog)" -ForegroundColor Yellow
$metroProc = Start-LoggedProcess -WorkingDirectory $root -Command $metroCmd -WindowTitle "BLYP METRO" -LogPath $metroLog

# Clear device log buffers right before capture so evidence is tight.
adb -s $hostSerialResolved logcat -c | Out-Null
adb -s $viewerSerialResolved logcat -c | Out-Null

$hostCap = $null
$viewerCap = $null
if (-not $SkipCapture) {
  Write-Host "[CAPTURE] Starting logcat capture for $CaptureSeconds sec" -ForegroundColor Yellow
  $hostCap = Start-LogcatCapture -Serial $hostSerialResolved -Path $hostRawLog
  $viewerCap = Start-LogcatCapture -Serial $viewerSerialResolved -Path $viewerRawLog

  Write-Host ""; Write-Host "DO THIS NOW:" -ForegroundColor Cyan
  Write-Host "  1) HOST phone: Go Live" -ForegroundColor Cyan
  Write-Host "  2) VIEWER phone: Join stream" -ForegroundColor Cyan
  Write-Host "  3) VIEWER: Request guest slot" -ForegroundColor Cyan
  Write-Host "  4) HOST: Accept guest request" -ForegroundColor Cyan
  Write-Host "";

  Start-Sleep -Seconds $CaptureSeconds

  Stop-IfRunning $hostCap
  Stop-IfRunning $viewerCap

  adb -s $hostSerialResolved exec-out screencap -p > $hostPng
  adb -s $viewerSerialResolved exec-out screencap -p > $viewerPng

  # Normalize host/viewer logs by UID if we can.
  $uidHostRaw = Extract-AuthUid -Path $hostRawLog
  $uidViewerRaw = Extract-AuthUid -Path $viewerRawLog

  $hostFinal = Join-Path $outDir "host.log"
  $viewerFinal = Join-Path $outDir "viewer.log"

  $swap = $false
  if ($uidHostRaw -and $uidViewerRaw -and $ExpectedHostUid -and $ExpectedViewerUid) {
    $h = $uidHostRaw.ToLowerInvariant()
    $v = $uidViewerRaw.ToLowerInvariant()
    $expHost = $ExpectedHostUid.ToLowerInvariant()
    $expViewer = $ExpectedViewerUid.ToLowerInvariant()

    # If the raw HOST device log contains the viewer identity and the raw VIEWER device log contains the host identity, we swap.
    if ($h.Contains($expViewer) -and $v.Contains($expHost)) {
      $swap = $true
    }
  }

  if ($swap) {
    Copy-Item -Force $hostRawLog $viewerFinal
    Copy-Item -Force $viewerRawLog $hostFinal
    "SWAPPED by uid (hostRawUid='$uidHostRaw', viewerRawUid='$uidViewerRaw', expectedHost='$ExpectedHostUid', expectedViewer='$ExpectedViewerUid')" | Out-File -FilePath (Join-Path $outDir "swap_note.txt") -Encoding utf8
    Write-Host "[LABEL] Logs swapped based on UID (host/viewer were reversed)" -ForegroundColor Yellow
  } else {
    Copy-Item -Force $hostRawLog $hostFinal
    Copy-Item -Force $viewerRawLog $viewerFinal
    "NO SWAP (hostRawUid='$uidHostRaw', viewerRawUid='$uidViewerRaw', expectedHost='$ExpectedHostUid', expectedViewer='$ExpectedViewerUid')" | Out-File -FilePath (Join-Path $outDir "swap_note.txt") -Encoding utf8
    Write-Host "[LABEL] Logs kept as-is" -ForegroundColor Yellow
  }

  Write-SummarySignals -HostLog $hostFinal -ViewerLog $viewerFinal -OutPath $summaryPath

  Write-Host "[ARTIFACTS] $outDir" -ForegroundColor Green
}

Write-Host "[DONE] Metro/backend are running in separate windows; close them when finished." -ForegroundColor Green
