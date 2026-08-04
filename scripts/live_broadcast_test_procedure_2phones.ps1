param(
  [switch]$Install,
  [switch]$ClearMetro,
  [string]$HostSerial = "",
  [string]$ViewerSerial = "",
  [int]$WarmupSeconds = 12,
  [int]$AfterGoLiveSeconds = 12,
  [int]$AfterViewerOpenSeconds = 12,
  [switch]$AutoCapture,
  [int]$ReadyTimeoutSec = 180,
  [int]$HostGoLiveTimeoutSec = 120,
  [int]$ViewerJoinTimeoutSec = 120,
  [switch]$KillPort4000IfUnhealthy
)

$ErrorActionPreference = "Stop"

if ($AutoCapture) {
  $runner = Join-Path $PSScriptRoot "run_2phone_live_autocapture.ps1"
  if (-not (Test-Path $runner)) { throw "AutoCapture requested but $runner not found" }
  & powershell -ExecutionPolicy Bypass -File $runner -HostSerial $HostSerial -ViewerSerial $ViewerSerial -WarmupSeconds $WarmupSeconds -AfterGoLiveSeconds $AfterGoLiveSeconds -AfterViewerOpenSeconds $AfterViewerOpenSeconds -ReadyTimeoutSec $ReadyTimeoutSec -HostGoLiveTimeoutSec $HostGoLiveTimeoutSec -ViewerJoinTimeoutSec $ViewerJoinTimeoutSec -KillPort4000IfUnhealthy:$KillPort4000IfUnhealthy
  return
}

function Get-ConnectedSerials {
  $lines = & adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" }
  $serials = @()
  foreach ($l in $lines) { $serials += ($l -split "\s+")[0] }
  return $serials
}

function Pick-Serials {
  $serials = Get-ConnectedSerials
  if ($serials.Count -lt 2) { throw "Need 2 connected devices. adb devices: $($serials -join ', ')" }
  if ($HostSerial -and $ViewerSerial) { return @($HostSerial, $ViewerSerial) }
  return @($serials[0], $serials[1])
}

function Ensure-Backend {
  param([string]$root)
  $backendPath = Join-Path $root "backend\blyp-live-service"
  if (Test-Path $backendPath) {
    Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$backendPath`"; npm run dev"
    Start-Sleep -Seconds 2
  } else {
    Write-Host "No backend folder found at backend\blyp-live-service - skipping backend start."
  }
}

function Start-Metro {
  param([string]$root)
  $cmd = "cd `"$root`"; npx expo start --dev-client"
  if ($ClearMetro -or $true) { $cmd += " --clear" }  # always clear for test reproducibility
  Start-Process powershell -ArgumentList "-NoExit","-Command",$cmd
  Start-Sleep -Seconds 2
}

function Optional-Install {
  param([string]$root,[string]$hostSerial,[string]$viewerSerial)
  if (-not $Install) { return }
  Write-Host "INSTALL requested. Building + installing to both devices."
  Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$root`"; npx expo run:android --device $hostSerial"
  Start-Sleep -Seconds 2
  Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$root`"; npx expo run:android --device $viewerSerial"
}

function Ensure-EnvForAutoLogin {
  param([string]$root)

  # We rely on your existing dev behavior:
  # Log shows: uid=test, authReady true, isAuthenticated true and "[LIVE][AUTH] DEV: skipping Firebase auth bridge"
  # This function just prints the env files so we can confirm.
  Write-Host "=== ENV CHECK (AUTO-LOGIN) ==="
  Get-ChildItem -Force (Join-Path $root ".env*") -ErrorAction SilentlyContinue |
    ForEach-Object {
      "`n=== $($_.Name) ==="
      Get-Content $_.FullName | Select-String "EXPO_PUBLIC_API_BASE_URL|EXPO_PUBLIC_ENABLE|DEV|BYPASS|AUTH|FIREBASE"
    } | Out-Host
}

function Clear-Logs {
  param([string]$hostSerial,[string]$viewerSerial)
  & adb -s $hostSerial logcat -c | Out-Null
  & adb -s $viewerSerial logcat -c | Out-Null
}

function Ensure-AdbReverse {
  param(
    [Parameter(Mandatory=$true)][string]$hostSerial,
    [Parameter(Mandatory=$true)][string]$viewerSerial
  )

  # When EXPO_PUBLIC_API_BASE_URL is set to 127.0.0.1 (recommended for USB testing),
  # the Android device must have adb reverse rules to reach services on the dev machine.
  foreach ($s in @($hostSerial, $viewerSerial)) {
    try { & adb -s $s reverse --remove-all | Out-Null } catch { }
    foreach ($p in @(8081, 4000, 5001)) {
      try { & adb -s $s reverse "tcp:$p" "tcp:$p" | Out-Null } catch { }
    }
  }
}

function Launch-App {
  param([string]$serial)
  & adb -s $serial shell "am force-stop com.blyp.mobile; monkey -p com.blyp.mobile -c android.intent.category.LAUNCHER 1" | Out-Null
}

function Save-LogSlices {
  param([string]$root,[string]$hostSerial,[string]$viewerSerial)

  function Get-AppPid([string]$serial) {
    try {
      $pid = (& adb -s $serial shell "pidof com.blyp.mobile" 2>$null).Trim()
      if ($pid) { return $pid }
    } catch { }
    return $null
  }

  function Get-LogcatDump([string]$serial,[string]$pid) {
    # Prefer pid-filtered dump so we don't drown in system logs.
    if ($pid) {
      try { return (& adb -s $serial logcat -d --pid $pid) } catch { }
    }
    return (& adb -s $serial logcat -d)
  }

  # Keep patterns focused on Blyp + IVS signals. Avoid matching generic OS "ERROR" spam.
  $patternHost = "com\.blyp\.mobile|ReactNativeJS|\[LIVE\]|\[TRACE\]\[HOST\]|\[ASSERT\]\[HOST\]|TOKEN_RECEIVED|NATIVE_CALL_READY|startHostSession|START_HOST_SESSION|STAGE_CREATE|LOCAL_JOINED|BROADCAST_STATE_CHANGED|PUBLISHED|IVS_"
  $patternViewer = "com\.blyp\.mobile|ReactNativeJS|\[ASSERT\]\[VIEWER\]|\[VIEWER\]|SURFACE_READY|joinAsViewer|REMOTE_VIDEO|FIRST_FRAME|BROADCAST_STATE_CHANGED|IVS_"

  $hostPid = Get-AppPid -serial $hostSerial
  $viewerPid = Get-AppPid -serial $viewerSerial

  $hostDump = Get-LogcatDump -serial $hostSerial -pid $hostPid
  $viewerDump = Get-LogcatDump -serial $viewerSerial -pid $viewerPid

  $hostLog = $hostDump | Select-String -Pattern $patternHost | Select-Object -Last 450
  $viewerLog = $viewerDump | Select-String -Pattern $patternViewer | Select-Object -Last 450

  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $logDir = Join-Path $root "logs"
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null

  $hostPath = Join-Path $logDir "live_test_host_$ts.log"
  $viewerPath = Join-Path $logDir "live_test_viewer_$ts.log"

  $hostLog | ForEach-Object { $_.ToString() } | Set-Content -Encoding UTF8 $hostPath
  $viewerLog | ForEach-Object { $_.ToString() } | Set-Content -Encoding UTF8 $viewerPath

  Write-Host "`n=== SAVED LOGS ==="
  Write-Host "HOST_LOG:   $hostPath"
  Write-Host "VIEWER_LOG: $viewerPath"
  if ($hostPid) { Write-Host "HOST_PID:   $hostPid" }
  if ($viewerPid) { Write-Host "VIEWER_PID: $viewerPid" }
  Write-Host ""

  Write-Host "=== PASS/FAIL GATES ==="
  Write-Host "HOST PASS if you see: TOKEN_RECEIVED -> NATIVE_CALL_READY -> (native) START_HOST_SESSION/startHostSession -> STAGE_CREATE -> LOCAL_JOINED"
  Write-Host "VIEWER PASS if you see: SURFACE_READY -> TOKEN -> joinAsViewer -> REMOTE_VIDEO -> FIRST_FRAME"
  Write-Host ""
  Write-Host "If HOST fails, VIEWER cannot ever pass. Fix host first."
  Write-Host ""

  Write-Host "=== HOST TAIL (last 120 lines) ==="
  Get-Content $hostPath -Tail 120 | Out-Host
  Write-Host ""
  Write-Host "=== VIEWER TAIL (last 120 lines) ==="
  Get-Content $viewerPath -Tail 120 | Out-Host
  Write-Host ""
}

# ---------- MAIN ----------
$root = Resolve-Path "."

$hostDevice,$viewerDevice = Pick-Serials
Write-Host "HOST=$hostDevice"
Write-Host "VIEWER=$viewerDevice"

Write-Host "`n=== ADB REVERSE (8081, 4000, 5001) ==="
Ensure-AdbReverse -hostSerial $hostDevice -viewerSerial $viewerDevice

Ensure-EnvForAutoLogin -root $root
Ensure-Backend -root $root
Start-Metro -root $root
Optional-Install -root $root -hostSerial $hostDevice -viewerSerial $viewerDevice

Clear-Logs -hostSerial $hostDevice -viewerSerial $viewerDevice

Write-Host "`n=== STEP 0: Launch both apps (warmup) ==="
Launch-App -serial $hostDevice
Launch-App -serial $viewerDevice
Start-Sleep -Seconds $WarmupSeconds

Write-Host "`n=== STEP 1: AUTO-LOGIN CHECK ==="
Write-Host "On BOTH phones: wait for home screen to load."
Write-Host "Expected: no login UI, dev user (uid=test) resolved automatically."
Write-Host ""

Write-Host "=== STEP 2: HOST GO LIVE ==="
Write-Host "On HOST phone: navigate to Live (host) and press Go Live ONCE."
Write-Host "Then wait $AfterGoLiveSeconds seconds."
Start-Sleep -Seconds $AfterGoLiveSeconds

Write-Host "`n=== STEP 3: VIEWER OPEN LIVE ==="
Write-Host "On VIEWER phone: navigate to the live viewer screen for that stream and wait $AfterViewerOpenSeconds seconds."
Start-Sleep -Seconds $AfterViewerOpenSeconds

Write-Host "`n=== STEP 4: CAPTURE LOGS ==="
Save-LogSlices -root $root -hostSerial $hostDevice -viewerSerial $viewerDevice

Write-Host "DONE. Paste back the last ~120 lines of each saved log."
