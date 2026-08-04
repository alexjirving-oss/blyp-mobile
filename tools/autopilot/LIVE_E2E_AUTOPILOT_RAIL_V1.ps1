<#
.SYNOPSIS
  LIVE_FEATURES_E2E_AUTOPILOT_RAIL_V1 -- 12-hour autonomous loop.
  Builds, installs, and runs a WDIO multiremote test proving Blyp LIVE
  streaming works end-to-end across two physical devices.

.DESCRIPTION
  Loop: Build -> Install -> Start Appium -> Run WDIO -> Collect evidence.
  On failure: diagnose, patch selectors if needed, re-loop.
  On pass: celebrate and exit.
  MAX_HOURS safety cutoff (default 12).

.RULES
  - NO QUESTIONS / NO PROMPTS
  - DO NOT STOP ON FIRST FAILURE
  - LOOP UNTIL PASS (or until MAX_HOURS safety cutoff)
  - No secrets printed
  - No destructive data operations
  - HISTORICAL ONLY / NON-CANONICAL / DO NOT USE FOR ANDROID RELEASE CREATION
#>

param(
  [int]$MAX_HOURS = 12
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# -- Paths --
$REPO       = Resolve-Path "$PSScriptRoot\..\.."
$DIAG_ROOT  = Join-Path $REPO "diagnostics\live_rail"
$TS         = Get-Date -Format 'yyyyMMdd_HHmmss'
$RUN_DIR    = Join-Path $DIAG_ROOT "LIVE_E2E_AUTOPILOT_$TS"
$LOG_FILE   = Join-Path $RUN_DIR "autopilot.log"
$CREDS_FILE = Join-Path $REPO "diagnostics\secrets\e2e_creds.ps1"
$WDIO_CONF  = Join-Path $REPO "tools\autopilot\wdio.live.multiremote.conf.js"
$APK_PATH   = Join-Path $REPO "android\app\build\outputs\apk\release\app-release.apk"

# Devices
$HOST_UDID   = if ($env:BLYP_HOST_UDID) { $env:BLYP_HOST_UDID } else { 'R9YT30NGVSJ' }
$VIEWER_UDID = if ($env:BLYP_VIEWER_UDID) { $env:BLYP_VIEWER_UDID } else { 'R58N6553WTF' }

$null = New-Item -ItemType Directory -Force -Path $RUN_DIR

# -- Logging --
function Log {
  param([string]$Msg)
  $ts = Get-Date -Format 'HH:mm:ss'
  $entry = "[$ts] $Msg"
  Write-Host $entry
  Add-Content -Path $LOG_FILE -Value $entry
}

# -- Load credentials --
if (!(Test-Path $CREDS_FILE)) {
  Log "FATAL: Credentials file not found at $CREDS_FILE"
  exit 1
}
. $CREDS_FILE
if (-not $env:BLYP_E2E_HOST_EMAIL -or -not $env:BLYP_E2E_HOST_PASSWORD -or
    -not $env:BLYP_E2E_VIEWER_EMAIL -or -not $env:BLYP_E2E_VIEWER_PASSWORD) {
  Log "FATAL: Credentials env vars not set after sourcing creds file"
  exit 1
}
Log "Credentials loaded (emails redacted)"

# -- Verify devices --
function Test-Devices {
  $devices = adb devices 2>&1 | Select-String "device$" | ForEach-Object { ($_ -split '\s+')[0] }
  $hostOk   = $devices -contains $HOST_UDID
  $viewerOk = $devices -contains $VIEWER_UDID
  if (-not $hostOk) { Log "WARNING: Host device $HOST_UDID not found" }
  if (-not $viewerOk) { Log "WARNING: Viewer device $VIEWER_UDID not found" }
  return ($hostOk -and $viewerOk)
}

# === BLYP_AUTOPILOT_DEVICE_READY_GUARD_V1_START ===
function Ensure-AdbDeviceReady {
  param(
    [string]$Udid,
    [int]$TimeoutMs = 90000
  )

  if (-not $Udid) { return $false }

  $t0 = [Environment]::TickCount
  while (([Environment]::TickCount - $t0) -lt $TimeoutMs) {
    try {
      $state = ((& adb -s $Udid get-state 2>&1) | Out-String).Trim()
      if ($state -eq "device") {
        & adb -s $Udid shell getprop sys.boot_completed 2>$null | Out-Null
        return $true
      }
    } catch {}

    try { & adb reconnect 2>$null | Out-Null } catch {}
    try { & adb -s $Udid wait-for-device 2>$null | Out-Null } catch {}
    Start-Sleep -Milliseconds 400
  }

  return $false
}

function Device-ReadyGate {
  param(
    [string]$HostUdid,
    [string]$ViewerUdid,
    [string]$UiRoot
  )

  $okH = Ensure-AdbDeviceReady -Udid $HostUdid -TimeoutMs 30000
  $okV = Ensure-AdbDeviceReady -Udid $ViewerUdid -TimeoutMs 30000

  if (-not $okH -or -not $okV) {
    Log "[DEVICE] readiness failed before attempt (hostOk=$okH viewerOk=$okV)"
    try {
      @(
        "RESULT=FAIL",
        "GATE=DEVICE",
        "WHY=DEVICE_OFFLINE_BEFORE_ATTEMPT",
        "HOST_UDID=$HostUdid",
        "VIEWER_UDID=$ViewerUdid",
        "HOST_OK=$okH",
        "VIEWER_OK=$okV"
      ) | Out-File -Encoding utf8 (Join-Path $UiRoot "99_result.txt")
    } catch {}
    return $false
  }

  return $true
}
# === BLYP_AUTOPILOT_DEVICE_READY_GUARD_V1_END ===

# -- ADB reverse for local services --
function Setup-AdbReverse {
  foreach ($udid in @($HOST_UDID, $VIEWER_UDID)) {
    Log "Setting up adb reverse for $udid"
    adb -s $udid reverse tcp:8081 tcp:8081 2>&1 | Out-Null
    adb -s $udid reverse tcp:4000 tcp:4000 2>&1 | Out-Null
    adb -s $udid reverse tcp:5001 tcp:5001 2>&1 | Out-Null
  }
}

# -- Build APK --
function Build-Apk {
  Log "HISTORICAL ONLY - NON-CANONICAL - DO NOT USE FOR ANDROID RELEASE CREATION"
  Log "Building release-like test APK for diagnostics rail execution only..."
  Push-Location (Join-Path $REPO "android")
  try {
    $buildLog = Join-Path $RUN_DIR "gradle_build.log"
    $proc = Start-Process -FilePath ".\gradlew.bat" `
      -ArgumentList ":app:assembleRelease","--no-daemon","--warning-mode=none" `
      -NoNewWindow -PassThru -Wait `
      -RedirectStandardOutput $buildLog `
      -RedirectStandardError (Join-Path $RUN_DIR "gradle_build_err.log")

    if ($proc.ExitCode -ne 0) {
      $ec = $proc.ExitCode
      Log "BUILD FAILED (exit code $ec)"
      return $false
    }

    if (Test-Path $APK_PATH) {
      Log "BUILD OK -- APK at $APK_PATH"
      return $true
    } else {
      Log "BUILD FAILED -- APK not found at $APK_PATH"
      return $false
    }
  } finally {
    Pop-Location
  }
}

# -- Install APK --
function Install-Apk {
  foreach ($udid in @($HOST_UDID, $VIEWER_UDID)) {
    Log "Installing APK on $udid..."
    adb -s $udid uninstall com.blyp.mobile 2>&1 | Out-Null
    $result = adb -s $udid install -r -g $APK_PATH 2>&1
    if ($result -match "Success") {
      Log "Install OK on $udid"
    } else {
      Log "Install FAILED on $udid -- $result"
      return $false
    }
  }
  return $true
}

# -- Launch app on a device --
function Launch-App {
  param([string]$Udid)
  Log "Launching com.blyp.mobile on $Udid"
  adb -s $Udid shell am force-stop com.blyp.mobile 2>&1 | Out-Null
  Start-Sleep -Seconds 1
  adb -s $Udid shell am start -n com.blyp.mobile/.MainActivity 2>&1 | Out-Null
}

# -- Start Appium --
$script:AppiumProcess = $null

function Start-AppiumServer {
  Log "Starting Appium server on port 4723..."
  # Kill any existing Appium
  Get-Process -Name "node" -ErrorAction SilentlyContinue |
    Where-Object {
      $cmdLine = $null
      try { $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction Stop).CommandLine } catch {}
      $cmdLine -match "appium"
    } |
    Stop-Process -Force -ErrorAction SilentlyContinue

  # Hard cleanup: stale UiAutomator2 + adb forwards + local ports
  foreach ($udid in @($HOST_UDID, $VIEWER_UDID)) {
    try { adb -s $udid shell am force-stop io.appium.uiautomator2.server 2>&1 | Out-Null } catch {}
    try { adb -s $udid shell am force-stop io.appium.uiautomator2.server.test 2>&1 | Out-Null } catch {}
    try { adb -s $udid forward --remove-all 2>&1 | Out-Null } catch {}
  }
  foreach ($port in @(4723, 8200, 8201, 9100, 9101, 9515, 9516)) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
      $conn | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch {}
      }
      Log "Freed port $port"
    }
  }
  Start-Sleep -Seconds 1

  $appiumLog = Join-Path $RUN_DIR "appium.log"
  $appiumErr = Join-Path $RUN_DIR "appium_err.log"
  $appiumCmd = Join-Path $REPO "node_modules\.bin\appium.CMD"
  $script:AppiumProcess = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c","$appiumCmd --port 4723 --log-level warn --relaxed-security" `
    -NoNewWindow -PassThru `
    -RedirectStandardOutput $appiumLog `
    -RedirectStandardError $appiumErr `
    -WorkingDirectory $REPO

  # Wait for Appium to be ready
  Log "Waiting for Appium to be ready..."
  $ready = $false
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    try {
      $resp = Invoke-RestMethod -Uri "http://127.0.0.1:4723/status" -TimeoutSec 3
      if ($resp.value.ready -eq $true -or $resp.value.build) {
        $ready = $true
        break
      }
    } catch {}
  }
  if ($ready) {
    $pid2 = $script:AppiumProcess.Id
    Log "Appium is ready (PID $pid2)"
  } else {
    Log "WARNING: Appium readiness check timed out -- proceeding anyway"
  }
  return $ready
}

function Stop-AppiumServer {
  if ($script:AppiumProcess -and !$script:AppiumProcess.HasExited) {
    $pid2 = $script:AppiumProcess.Id
    Log "Stopping Appium (PID $pid2)"
    Stop-Process -Id $script:AppiumProcess.Id -Force -ErrorAction SilentlyContinue
  }
  # Also kill any stray Appium
  Get-Process -Name "node" -ErrorAction SilentlyContinue |
    Where-Object {
      $cmdLine = $null
      try { $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction Stop).CommandLine } catch {}
      $cmdLine -match "appium"
    } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

# -- Run WDIO test --
function Run-WdioTest {
  param([int]$Attempt)

  $attemptDir = Join-Path $RUN_DIR "attempt_$Attempt"
  $null = New-Item -ItemType Directory -Force -Path $attemptDir

  Log "=== ATTEMPT $Attempt ==="

  # Set env vars for WDIO config
  $env:BLYP_APK_PATH    = $APK_PATH
  $env:BLYP_HOST_UDID   = $HOST_UDID
  $env:BLYP_VIEWER_UDID = $VIEWER_UDID
  $env:APPIUM_PORT      = "4723"

  $wdioLog = Join-Path $attemptDir "wdio_output.log"
  $wdioErr = Join-Path $attemptDir "wdio_errors.log"

  Log "Running WDIO multiremote test..."
  $wdioCmd = Join-Path $REPO "node_modules\.bin\wdio.cmd"

  try {
    $proc = Start-Process -FilePath "cmd.exe" `
      -ArgumentList "/c","$wdioCmd run $WDIO_CONF" `
      -NoNewWindow -PassThru -Wait `
      -RedirectStandardOutput $wdioLog `
      -RedirectStandardError $wdioErr `
      -WorkingDirectory $REPO

    $exitCode = $proc.ExitCode
  } catch {
    Log "Start-Process threw an exception: $_"
    $exitCode = 99
  }

  # Collect evidence
  Collect-Evidence -AttemptDir $attemptDir

  # Read output for diagnosis
  $output = ""
  if (Test-Path $wdioLog) { $output = Get-Content $wdioLog -Raw -ErrorAction SilentlyContinue }
  $errors = ""
  if (Test-Path $wdioErr) { $errors = Get-Content $wdioErr -Raw -ErrorAction SilentlyContinue }

  # Log tail
  if ($output) {
    $lines = $output -split "`n" | Select-Object -Last 50
    $tail = $lines -join "`n"
    Log "WDIO Output (last 50 lines):"
    Log $tail
  }

  if ($exitCode -eq 0) {
    Log "WDIO TEST PASSED (attempt $Attempt)"
    return $true
  } else {
    Log "WDIO TEST FAILED (exit code $exitCode, attempt $Attempt)"
    if ($errors) {
      $errHead = ($errors -split "`n" | Select-Object -First 30) -join "`n"
      Log "WDIO Errors:"
      Log $errHead
    }
    return $false
  }
}

# -- Collect evidence --
function Collect-Evidence {
  param([string]$AttemptDir)

  Log "Collecting evidence..."

  foreach ($entry in @(@{Udid=$HOST_UDID; Name="host"}, @{Udid=$VIEWER_UDID; Name="viewer"})) {
    $udid = $entry.Udid
    $name = $entry.Name
    try {
      $screenshotPath = Join-Path $AttemptDir "${name}_screenshot.png"
      adb -s $udid exec-out screencap -p > $screenshotPath 2>$null
      Log "Screenshot saved: ${name}_screenshot.png"
    } catch { Log "Failed to capture screenshot for $name" }

    try {
      $xmlPath = Join-Path $AttemptDir "${name}_ui_dump.xml"
      adb -s $udid exec-out uiautomator dump /dev/tty 2>$null | Out-File -FilePath $xmlPath -Encoding utf8
      Log "UI dump saved: ${name}_ui_dump.xml"
    } catch { Log "Failed to dump UI for $name" }

    try {
      $logcatPath = Join-Path $AttemptDir "${name}_logcat.txt"
      adb -s $udid logcat -d -t 200 *:W 2>$null | Out-File -FilePath $logcatPath -Encoding utf8
      Log "Logcat saved: ${name}_logcat.txt"
    } catch { Log "Failed to capture logcat for $name" }
  }
}

# -- Clean up between attempts --
function Reset-Devices {
  foreach ($udid in @($HOST_UDID, $VIEWER_UDID)) {
    Log "Clearing app data on $udid"
    adb -s $udid shell pm clear com.blyp.mobile 2>&1 | Out-Null
    # Kill stale UiAutomator2 server on device
    adb -s $udid shell am force-stop io.appium.uiautomator2.server 2>&1 | Out-Null
    adb -s $udid shell am force-stop io.appium.uiautomator2.server.test 2>&1 | Out-Null
    # Remove stale adb forward rules
    adb -s $udid forward --remove-all 2>&1 | Out-Null
    Start-Sleep -Milliseconds 500
  }
  # Kill any processes holding UiAutomator2 ports on local machine
  foreach ($port in @(8200, 8201, 9100, 9101, 9515, 9516)) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
      $pids = $conn | Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($p in $pids) {
        try { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } catch {}
      }
      Log "Freed local port $port"
    }
  }
}

# ====================================================================
#  MAIN LOOP
# ====================================================================

$startTime = Get-Date
$maxEnd    = $startTime.AddHours($MAX_HOURS)
$attempt   = 0
$passed    = $false

$startedFmt = $startTime.ToString("yyyy-MM-dd HH:mm:ss")
$maxEndFmt  = $maxEnd.ToString("yyyy-MM-dd HH:mm:ss")
Log "=============================================================="
Log "  LIVE_FEATURES_E2E_AUTOPILOT_RAIL_V1"
Log "  Started: $startedFmt"
Log "  Max end: $maxEndFmt"
Log "  Output:  $RUN_DIR"
Log "=============================================================="

# Verify prerequisites
if (!(Test-Devices)) {
  Log "FATAL: Not all devices connected. Connect both $HOST_UDID and $VIEWER_UDID."
  exit 1
}
Log "Both devices connected"

# Build APK (once unless it fails to install)
$buildNeeded = $true
if (Test-Path $APK_PATH) {
  $apkAge = (Get-Date) - (Get-Item $APK_PATH).LastWriteTime
  if ($apkAge.TotalMinutes -lt 30) {
    $apkAgeMin = [math]::Round($apkAge.TotalMinutes,1)
    Log "Recent APK found ($apkAgeMin min old) -- skipping build"
    $buildNeeded = $false
  }
}

if ($buildNeeded) {
  if (!(Build-Apk)) {
    Log "FATAL: Build failed -- cannot proceed"
    exit 1
  }
}

# Install APK on both devices
if (!(Install-Apk)) {
  Log "FATAL: Install failed -- cannot proceed"
  exit 1
}

# Setup ADB reverse for local services
Setup-AdbReverse

# Start Appium server
Start-AppiumServer

try {
  while (-not $passed -and (Get-Date) -lt $maxEnd) {
    if (-not (Device-ReadyGate -HostUdid $HOST_UDID -ViewerUdid $VIEWER_UDID -UiRoot $RUN_DIR)) {
      Log "[DEVICE] offline before attempt -> retry"
      Start-Sleep -Seconds 2
      continue
    }

    $attempt++
    $elapsed = ((Get-Date) - $startTime).TotalMinutes
    $elRound = [math]::Round($elapsed,1)
    Log "--- Attempt $attempt (elapsed: $elRound min) ---"

    # Verify devices are still connected
    if (!(Test-Devices)) {
      Log "Devices disconnected -- waiting 10s then retrying..."
      Start-Sleep -Seconds 10
      if (!(Test-Devices)) {
        Log "Devices still disconnected -- aborting"
        break
      }
    }

    # Re-setup ADB reverse (in case it was lost)
    Setup-AdbReverse

    # Run the test
    $passed = Run-WdioTest -Attempt $attempt

    if ($passed) {
      Log "=========================================================="
      Log "  ALL TESTS PASSED on attempt $attempt!"
      $passElapsed = [math]::Round(((Get-Date) - $startTime).TotalMinutes, 1)
      Log "  Elapsed: $passElapsed minutes"
      Log "=========================================================="
      break
    }

    # Failed -- reset and retry
    Log "Attempt $attempt failed -- resetting for next attempt..."
    Reset-Devices
    Start-Sleep -Seconds 2

    # Re-install on retry (fresh state)
    Install-Apk | Out-Null
    Start-Sleep -Seconds 1

    # Check if Appium is still alive
    try {
      $resp = Invoke-RestMethod -Uri "http://127.0.0.1:4723/status" -TimeoutSec 5
    } catch {
      Log "Appium seems dead -- restarting..."
      Stop-AppiumServer
      Start-Sleep -Seconds 1
      Start-AppiumServer
    }

    # Backoff: wait a bit between attempts
    $backoff = [math]::Min(15, 3 * $attempt)
    Log "Waiting ${backoff}s before next attempt..."
    Start-Sleep -Seconds $backoff
  }
} finally {
  Stop-AppiumServer
}

# -- Final report --
$totalMinutes = [math]::Round(((Get-Date) - $startTime).TotalMinutes, 1)

if ($passed) {
  Log "RESULT: PASS after $attempt attempt(s), $totalMinutes minutes"
  $resultFile = Join-Path $RUN_DIR "RESULT_PASS.txt"
} else {
  Log "RESULT: FAIL after $attempt attempt(s), $totalMinutes minutes (cutoff or abort)"
  $resultFile = Join-Path $RUN_DIR "RESULT_FAIL.txt"
}

$resultLabel = if ($passed) { "PASS" } else { "FAIL" }
$startedStr  = $startTime.ToString("yyyy-MM-dd HH:mm:ss")
$endedStr    = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$reportBody  = "Result:   $resultLabel`nAttempts: $attempt`nElapsed:  $totalMinutes minutes`nStarted:  $startedStr`nEnded:    $endedStr"
$reportBody | Out-File -FilePath $resultFile -Encoding utf8

Log "Report written to $resultFile"
Log "Done."

