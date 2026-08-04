param(
  [switch]$Install,
  [string]$HostSerial = "",
  [string]$ViewerSerial = ""
)

$ErrorActionPreference = "Stop"

function Pick-Serials {
  $lines = & adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" }
  $serials = @()
  foreach ($l in $lines) { $serials += ($l -split "\s+")[0] }
  if ($serials.Count -lt 2) { throw "Need 2 connected devices. adb devices shows: $($serials -join ', ')" }

  if ($HostSerial -and $ViewerSerial) { return @($HostSerial, $ViewerSerial) }

  # Stable choice: first = host, second = viewer (override via params if needed)
  return @($serials[0], $serials[1])
}

$root = Resolve-Path "."
$hostDevice,$viewerDevice = Pick-Serials

Write-Host "HOST=$hostDevice"
Write-Host "VIEWER=$viewerDevice"

# Start backend in external window (if folder exists)
$backendPath = Join-Path $root "backend\blyp-live-service"
if (Test-Path $backendPath) {
  Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$backendPath`"; npm run dev"
  Start-Sleep -Seconds 2
}

# Start Metro in external window
Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$root`"; npx expo start --dev-client --clear"

# Optional install/reinstall if requested
if ($Install) {
  Write-Host "INSTALL requested. Building Android debug + installing to both phones."
  Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$root`"; npx expo run:android --device $hostDevice"
  Start-Sleep -Seconds 2
  Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$root`"; npx expo run:android --device $viewerDevice"
}

# Clear logs
& adb -s $hostDevice logcat -c | Out-Null
& adb -s $viewerDevice logcat -c | Out-Null

# Cold launch app on both
& adb -s $hostDevice shell "am force-stop com.blyp.mobile; monkey -p com.blyp.mobile -c android.intent.category.LAUNCHER 1" | Out-Null
& adb -s $viewerDevice shell "am force-stop com.blyp.mobile; monkey -p com.blyp.mobile -c android.intent.category.LAUNCHER 1" | Out-Null

Write-Host ""
Write-Host "=== ACTION REQUIRED ==="
Write-Host "1) On HOST phone: navigate to LiveStreamScreen (host) and press Go Live ONCE."
Write-Host "2) Wait 10 seconds."
Write-Host "3) On VIEWER phone: open the live stream page (viewer) and wait 10 seconds."
Write-Host "Then return here. Capturing logs…"
Write-Host ""
Start-Sleep -Seconds 25

$patternHost = "TOKEN_RECEIVED|NATIVE_CALL_READY|START_HOST_SESSION|START_SESSION_ENTER|STAGE_CREATE|LOCAL_JOINED|BROADCAST_STATE_CHANGED|PUBLISHED|IVSBroadcastModule|IVS_HOST|IVS_|ERROR|Exception|\[TRACE\]\[HOST\]|\[ASSERT\]\[HOST\]|\[LIVE\]\[GO_LIVE_BUTTON\]"
$patternViewer = "TOKEN|JOIN|JOIN_STREAM|NATIVE_CALL_READY|SURFACE_READY|REMOTE_VIDEO|FIRST_FRAME|BROADCAST_STATE_CHANGED|VIEWER|IVS_|ERROR|Exception|\[ASSERT\]\[VIEWER\]"

$hostLog = & adb -s $hostDevice logcat -d | Select-String -Pattern $patternHost | Select-Object -Last 350
$viewerLog = & adb -s $viewerDevice logcat -d | Select-String -Pattern $patternViewer | Select-Object -Last 350

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$hostPath = Join-Path $logDir "ivs_phase1_host_$ts.log"
$viewerPath = Join-Path $logDir "ivs_phase1_viewer_$ts.log"

$hostLog | ForEach-Object { $_.ToString() } | Set-Content -Encoding UTF8 $hostPath
$viewerLog | ForEach-Object { $_.ToString() } | Set-Content -Encoding UTF8 $viewerPath

Write-Host "=== SAVED ==="
Write-Host "HOST_LOG: $hostPath"
Write-Host "VIEWER_LOG: $viewerPath"
Write-Host ""
Write-Host "=== QUICK PASS/FAIL RULES ==="
Write-Host "PASS host if you see: TOKEN_RECEIVED -> NATIVE_CALL_READY -> (native) START_HOST_SESSION/START_SESSION_ENTER -> STAGE_CREATE -> LOCAL_JOINED"
Write-Host "FAIL host if TOKEN_RECEIVED exists but no NATIVE_CALL_READY, or NATIVE_CALL_READY exists but no native START_* lines."
Write-Host ""
Write-Host "Now paste back the last ~120 lines from each saved log."