param(
  [string]$HostSerial = "",
  [string]$ViewerSerial = "",
  [int]$ReadyTimeoutSec = 180,
  [int]$HostSessionTimeoutSec = 180,
  [int]$ViewerJoinTimeoutSec = 180,
  [int]$RemoteTrackTimeoutSec = 180,
  [switch]$KillPort4000IfUnhealthy,
  [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\lib\DeviceSelect.ps1"
. "$PSScriptRoot\lib\ProcessHelpers.ps1"

# ---------- Helpers ----------
function New-LogLine {
  param([string]$Path,[string]$Line)
  Ensure-Directory -Path (Split-Path $Path -Parent)
  $Line | Add-Content -Path $Path
}

function Find-BackendPath {
  param([string]$Root)
  $defaultPath = Join-Path $Root "backend\blyp-live-service"
  if (Test-Path $defaultPath) { return $defaultPath }

  $candidates = Get-ChildItem -Path $Root -Filter package.json -Recurse -ErrorAction SilentlyContinue |
    Where-Object { (Get-Content $_.FullName -ErrorAction SilentlyContinue | Select-String '"dev"') } |
    Select-Object -First 5

  if ($candidates.Count -eq 0) { return $null }
  return Split-Path $candidates[0].FullName -Parent
}

function Resolve-MetroCommand {
  param([string]$Root)
  $pkg = Join-Path $Root "package.json"
  if (Test-Path $pkg) {
    try {
      $json = Get-Content $pkg -Raw | ConvertFrom-Json
      if ($json.scripts.start -and ($json.scripts.start -match "expo start")) {
        return "npm run start -- --dev-client --clear"
      }
    } catch {}
  }
  return "npx expo start --dev-client --clear"
}

function Check-BackendHealth {
  param([string]$Url,[string]$LogPath)
  try {
    $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    $line = "[BACKEND][HEALTH] status=$($resp.StatusCode) url=$Url"
    $line | Add-Content -Path $LogPath
    return $resp.StatusCode -eq 200
  } catch {
    $line = "[BACKEND][HEALTH] status=error url=$Url message=$($_.Exception.Message)"
    $line | Add-Content -Path $LogPath
    return $false
  }
}

function Wait-ForReadiness {
  param(
    [string]$Serial,
    [string]$Label,
    [int]$TimeoutSec,
    [string]$LogPath
  )

  $patterns = "\[AUTH DEBUG\]|authReady|isAuthenticated|\[HOME\]|\[NAV\].*Home"
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $lastHit = $null
  while ((Get-Date) -lt $deadline) {
    try {
      $hit = & adb -s $Serial logcat -d | Select-String -Pattern $patterns -ErrorAction SilentlyContinue | Select-Object -Last 1
      if ($hit) {
        $lastHit = $hit.Line
        return $lastHit
      }
    } catch {}
    Start-Sleep -Seconds 3
  }

  if (-not $lastHit) {
    try {
      $tail = & adb -s $Serial logcat -d | Select-Object -Last 50
      "[STATE][$Label] readiness timeout; last 50 lines:" | Add-Content -Path $LogPath
      $tail | ForEach-Object { $_.ToString() } | Add-Content -Path $LogPath
    } catch {}
  }
  return $lastHit
}

function Start-LogcatCapture {
  param([string]$Serial,[string]$Path)
  Ensure-Directory -Path (Split-Path $Path -Parent)

  # Clear buffer so each run's log file is self-contained.
  try { & adb -s $Serial logcat -c | Out-Null } catch {}

  # Prefer a focused filter to keep logs readable and avoid massive files.
  # (ReactNativeJS carries our app logs; IVS*/AmazonIVS* carry native IVS logs.)
  $args = @(
    '-s', $Serial,
    'logcat',
    '-v', 'time',
    'ReactNativeJS:D',
    'Blyp*:D',
    'IVS*:D',
    'IVS_REALTIME*:D',
    'AmazonIVS*:D',
    '*:S'
  )

  $stderrPath = "$Path.err"
  return Start-Process -FilePath adb -ArgumentList $args -NoNewWindow -RedirectStandardOutput $Path -RedirectStandardError $stderrPath -PassThru
}

function Stop-IfRunning { param($proc) if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } }

function Extract-Line {
  param([string]$Path,[string]$Pattern)
  if (-not (Test-Path $Path)) { return $null }
  return Select-String -Path $Path -Pattern $Pattern -SimpleMatch -ErrorAction SilentlyContinue | Select-Object -Last 1
}

function Safe-SelectString {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$false)][string]$Pattern
  )

  if ([string]::IsNullOrWhiteSpace($Pattern)) {
    return @()
  }

  if (-not (Test-Path $Path)) { return @() }

  try {
    return Select-String -Path $Path -Pattern $Pattern -ErrorAction SilentlyContinue
  } catch {
    return @()
  }
}

function Get-LogTail {
  param([string]$Path, [int]$Lines = 80)
  if (-not (Test-Path $Path)) { return @() }
  try { return Get-Content -Path $Path -Tail $Lines -ErrorAction SilentlyContinue } catch { return @() }
}

function Wait-ForGate {
  param(
    [string]$Name,
    [string]$Path,
    [string]$Pattern,
    [int]$TimeoutSec = 180,
    [int]$PollMs = 750
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  Write-Host "=== WAIT: $Name ==="

  while ((Get-Date) -lt $deadline) {
    $hits = Safe-SelectString -Path $Path -Pattern $Pattern
    if ($hits -and $hits.Count -gt 0) {
      $last = $hits[-1].Line
      Write-Host "OK: $Name -> $last"
      return @{ ok=$true; line=$last }
    }
    Start-Sleep -Milliseconds $PollMs
  }

  $tail = Get-LogTail -Path $Path -Lines 40
  Write-Host "TIMEOUT: $Name"
  if ($tail.Count -gt 0) {
    Write-Host "--- tail ($Name) ---"
    $tail | ForEach-Object { Write-Host $_ }
  } else {
    Write-Host "(no log content yet)"
  }
  return @{ ok=$false; line=$null }
}

function Get-LastMatch {
  param([string]$Path,[string]$Pattern,[switch]$Simple)
  if (-not (Test-Path $Path)) { return $null }
  $params = @{ Path = $Path; Pattern = $Pattern; ErrorAction = 'SilentlyContinue' }
  if ($Simple) { $params['SimpleMatch'] = $true }
  return Select-String @params | Select-Object -Last 1
}

function Extract-Value {
  param([string]$Path,[string]$Regex,[int]$Group = 1)
  $m = Get-LastMatch -Path $Path -Pattern $Regex
  if ($m -and $m.Matches.Count -gt 0) {
    $g = $m.Matches[0].Groups[$Group]
    if ($g) { return $g.Value }
  }
  return $null
}

function Start-HealthTail {
  param(
    [string]$Label,
    [string]$Url,
    [string]$LogPath,
    [int]$Seconds = 10,
    [int]$ProcessId
  )

  $cmd = @"
Write-Host '[$Label][ATTACH] PID $ProcessId; polling $Url -> $LogPath'
while(
  $true
) {
  try {
    $resp = Invoke-WebRequest -Uri '$Url' -UseBasicParsing -TimeoutSec 5
    "[$Label][STATUS] $($resp.StatusCode)" | Add-Content -Path '$LogPath'
  } catch {
    "[$Label][STATUS] error $($_.Exception.Message)" | Add-Content -Path '$LogPath'
  }
  Start-Sleep -Seconds $Seconds
}
"@

  $args = @('-NoExit','-Command', $cmd)
  return Start-Process -FilePath powershell -ArgumentList $args -WindowStyle Hidden -PassThru
}

# --- Paths and setup ---
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logDir = Join-Path $root "logs"
Ensure-Directory -Path $logDir

$devices = Select-TwoDevices -HostSerial $HostSerial -ViewerSerial $ViewerSerial
Write-Host "HOST=$($devices.Host) ($($devices.HostInfo.Model))"
Write-Host "VIEWER=$($devices.Viewer) ($($devices.ViewerInfo.Model))"

$backendPath = Find-BackendPath -Root $root
if (-not $backendPath) {
  Write-Warning "Backend not found. Searched under $root"
}
$metroCommand = Resolve-MetroCommand -Root $root

$backendLog = Join-Path $logDir "backend_$timestamp.log"
$metroLog = Join-Path $logDir "metro_$timestamp.log"
$hostLog = Join-Path $logDir "host_logcat_$timestamp.log"
$viewerLog = Join-Path $logDir "viewer_logcat_$timestamp.log"

# --- Start backend ---
$backendProc = $null
if ($backendPath) {
  $port4000 = Get-PortOwner -Port 4000
  if ($port4000) {
    Write-Host "Backend port 4000 already in use by PID $($port4000.OwningProcess); attaching (health poll)." -ForegroundColor Yellow
    $healthy = Check-BackendHealth -Url "http://127.0.0.1:4000/health" -LogPath $backendLog
    if (-not $healthy -and $KillPort4000IfUnhealthy) {
      Write-Host "Backend unhealthy; killing PID $($port4000.OwningProcess) and restarting." -ForegroundColor Yellow
      try { Stop-Process -Id $port4000.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
      $backendProc = Start-LoggedProcess -WorkingDirectory $backendPath -Command "npm run dev" -WindowTitle "backend-dev" -LogPath $backendLog
    } else {
      # Attach by polling health into our log
      Start-HealthTail -Label "BACKEND" -Url "http://127.0.0.1:4000/health" -LogPath $backendLog -Seconds 10 -ProcessId $port4000.OwningProcess | Out-Null
    }
  } else {
    $backendProc = Start-LoggedProcess -WorkingDirectory $backendPath -Command "npm run dev" -WindowTitle "backend-dev" -LogPath $backendLog
  }
}

# --- Start Metro ---
$port8081 = Get-PortOwner -Port 8081
$metroProc = $null
if ($port8081) {
  Write-Host "Metro port 8081 already in use by PID $($port8081.OwningProcess); attaching (status poll)." -ForegroundColor Yellow
  Start-HealthTail -Label "METRO" -Url "http://localhost:8081/status" -LogPath $metroLog -Seconds 15 -ProcessId $port8081.OwningProcess | Out-Null
} else {
  $metroProc = Start-LoggedProcess -WorkingDirectory $root -Command $metroCommand -WindowTitle "expo-metro" -LogPath $metroLog
}

# --- Start logcat captures (immediately) ---
$hostLogProc = Start-LogcatCapture -Serial $devices.Host -Path $hostLog
$viewerLogProc = Start-LogcatCapture -Serial $devices.Viewer -Path $viewerLog

Write-Host "Logs will be written to:" -ForegroundColor Cyan
Write-Host "  HOST:   $hostLog"
Write-Host "  VIEWER: $viewerLog"
Write-Host "  BACKEND:$backendLog"
Write-Host "  METRO:  $metroLog"

# ---------- Gates ----------
$gates = @{}
$HOST_READY_PATTERN = "\[LIVE\]\[ENTRY\] Navigating to LiveStreamScreen"
$VIEWER_READY_PATTERN = "\[AUTH\]\[SUCCESS\]"
$HOST_SESSION_PATTERN = "\[HOST\]\[SESSION_CREATED\]"
$VIEWER_JOIN_PATTERN = "\[VIEWER\]\[JOIN_REQUEST\]|Status: connected"
$BACKEND_JOIN_PATTERN = "\[LIVE_API\]\[JOIN_REALTIME\]"
$REMOTE_TRACK_PATTERN = "\[IVS_VIEWER\]\[REMOTE_VIDEO_ADDED\]|First frame: yes|Remote video tracks: 1"

$gates['HOST_READY']   = Wait-ForGate -Name 'HOST_READY (auth + navigation)' -Path $hostLog   -Pattern $HOST_READY_PATTERN   -TimeoutSec $ReadyTimeoutSec
$gates['VIEWER_READY'] = Wait-ForGate -Name 'VIEWER_READY (auth)'            -Path $viewerLog -Pattern $VIEWER_READY_PATTERN -TimeoutSec $ReadyTimeoutSec
$gates['HOST_SESSION'] = Wait-ForGate -Name 'HOST_SESSION'                   -Path $hostLog   -Pattern $HOST_SESSION_PATTERN -TimeoutSec $HostSessionTimeoutSec
$gates['VIEWER_JOIN']  = Wait-ForGate -Name 'VIEWER_JOIN'                    -Path $viewerLog -Pattern $VIEWER_JOIN_PATTERN  -TimeoutSec $ViewerJoinTimeoutSec
$gates['BACKEND_JOIN'] = Wait-ForGate -Name 'BACKEND_JOIN'                   -Path $backendLog -Pattern $BACKEND_JOIN_PATTERN -TimeoutSec $ViewerJoinTimeoutSec
$gates['REMOTE_TRACK'] = Wait-ForGate -Name 'REMOTE_TRACK / FIRST_FRAME'     -Path $viewerLog -Pattern $REMOTE_TRACK_PATTERN -TimeoutSec $RemoteTrackTimeoutSec

# Track drop detection (after gates run)
$remoteDropped = $false
$remoteAdded = Get-LastMatch -Path $viewerLog -Pattern "\[IVS_VIEWER\]\[REMOTE_VIDEO_ADDED\]" -Simple
$remoteRemoved = Get-LastMatch -Path $viewerLog -Pattern "\[IVS_VIEWER\]\[REMOTE_VIDEO_REMOVED\]" -Simple
if ($remoteAdded -and $remoteRemoved -and ($remoteRemoved.LineNumber -gt $remoteAdded.LineNumber)) {
  $remoteDropped = $true
}

# Stop logcat unless keeping alive
if (-not $KeepRunning) {
  Stop-IfRunning $hostLogProc
  Stop-IfRunning $viewerLogProc
} else {
  Write-Host "`nPress Enter to stop captures (KeepRunning enabled)..." -ForegroundColor Yellow
  Read-Host | Out-Null
  Stop-IfRunning $hostLogProc
  Stop-IfRunning $viewerLogProc
}

# ---------- Results ----------
$hostMarker = Get-LastMatch -Path $hostLog -Pattern "\[HOST\]\[SESSION_CREATED\]" -Simple
$viewerMarker = Get-LastMatch -Path $viewerLog -Pattern "\[VIEWER\]\[JOIN_REQUEST\]" -Simple
$backendMarker = Get-LastMatch -Path $backendLog -Pattern "\[LIVE_API\]\[JOIN_REALTIME\]"

$hostStageArn = Extract-Value -Path $hostLog -Regex 'stageArn"\s*:\s*"([^"]+)' -Group 1
$hostSessionId = Extract-Value -Path $hostLog -Regex 'sessionId"\s*:\s*"([^"]+)' -Group 1
$viewerStageArn = Extract-Value -Path $viewerLog -Regex 'stageArn"\s*:\s*"([^"]+)' -Group 1
$viewerSessionId = Extract-Value -Path $viewerLog -Regex 'sessionId"\s*:\s*"([^"]+)' -Group 1

$backendStatus = if ($backendMarker -and $backendMarker.Line -match '200') { '200' } elseif ($backendMarker) { 'unknown' } else { 'missing' }

$sessionMismatch = $false
if ($hostSessionId -and $viewerSessionId -and ($hostSessionId -ne $viewerSessionId)) { $sessionMismatch = $true }
if ($hostStageArn -and $viewerStageArn -and ($hostStageArn -ne $viewerStageArn)) { $sessionMismatch = $true }

Write-Host "`n=== RESULT ===" -ForegroundColor Cyan
Write-Host "HOST_SESSION_CREATED: $(if ($hostMarker) { $hostMarker.Line } else { 'MISSING' })"
Write-Host "VIEWER_JOIN_REQUEST:  $(if ($viewerMarker) { $viewerMarker.Line } else { 'MISSING' })"
Write-Host "LIVE_API_JOIN_REALTIME: $(if ($backendMarker) { "$($backendMarker.Line) status=$backendStatus" } else { 'MISSING' })"

Write-Host "`nStage/Session" -ForegroundColor Cyan
Write-Host "  Host   StageArn: $hostStageArn"
Write-Host "  Host   Session : $hostSessionId"
Write-Host "  Viewer StageArn: $viewerStageArn"
Write-Host "  Viewer Session : $viewerSessionId"
if ($sessionMismatch) { Write-Host "  SESSION MISMATCH (routing bug?)" -ForegroundColor Red }

Write-Host "`nRemote video" -ForegroundColor Cyan
Write-Host "  Added/first frame: $(if ($gates['REMOTE_TRACK'].ok) { 'yes' } else { 'no' })"
Write-Host "  Track dropped:     $(if ($remoteDropped) { 'yes' } else { 'no' })"

foreach ($key in $gates.Keys) {
  $gate = $gates[$key]
  if (-not $gate.ok) {
    Write-Host "FAIL_REASON: $key timed out" -ForegroundColor Red
    if ($gate.line) { Write-Host "  Last match: $($gate.line)" }
  }
}

if ($gates.Values | Where-Object { -not $_.ok }) {
  Write-Host "`nResult: FAILED (see FAIL_REASON)" -ForegroundColor Red
} elseif ($sessionMismatch) {
  Write-Host "`nResult: FAILED (SESSION MISMATCH)" -ForegroundColor Red
} elseif (-not $gates['REMOTE_TRACK'].ok) {
  Write-Host "`nResult: FAILED (PUBLISHING/DELIVERY)" -ForegroundColor Red
} elseif ($remoteDropped) {
  Write-Host "`nResult: FAILED (TRACK DROP)" -ForegroundColor Red
} else {
  Write-Host "`nResult: PASS (all gates met)" -ForegroundColor Green
}

Write-Host "`nDone. Logs: host=$hostLog viewer=$viewerLog backend=$backendLog metro=$metroLog" -ForegroundColor Cyan
