param(
  [Parameter(Mandatory=$true)][string]$HostSerial,
  [Parameter(Mandatory=$true)][string]$ViewerSerial,
  [int]$KeepAliveMinutes = 2,
  [switch]$SkipBuild,
  [int]$AutoCaptureDelaySec = 45
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path ".").Path
$Logs = Join-Path $Root "logs"
New-Item -ItemType Directory -Force $Logs | Out-Null

function Wait-Devices {
  param([string]$H,[string]$V,[int]$Seconds=60)
  for($i=0;$i -lt [Math]::Ceiling($Seconds/2);$i++){
    $list = (adb devices) -join "`n"
    if($list -match ("(?m)^" + [regex]::Escape($H) + "\s+device") -and $list -match ("(?m)^" + [regex]::Escape($V) + "\s+device")){
      return
    }
    Write-Host "Waiting for both devices..."
    Start-Sleep 2
  }
  adb devices -l
  throw "Devices not ready. Need both HOST=$H and VIEWER=$V as 'device'."
}

function Capture-Screenshot {
  param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$DestPath
  )

  $remote = "/sdcard/blyp_screen_latest.png"

  function Get-PrimaryDisplayId {
    param([Parameter(Mandatory=$true)][string]$S)

    # Prefer the physical display (usually "HWC display 0") so we don't
    # accidentally capture a virtual/secondary display (which can appear black).
    try {
      $raw = adb -s $S shell dumpsys SurfaceFlinger --display-id
    } catch {
      return $null
    }

    $lines = ($raw -split "`r?`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ }

    foreach($line in $lines){
      if($line -match '^Display\s+(\d+)\s+\(.*HWC\s+display\s+0'){ return $matches[1] }
    }
    foreach($line in $lines){
      if($line -match '^Display\s+(\d+)\s+\(.*(Built-in|Built in|Internal)'){ return $matches[1] }
    }
    foreach($line in $lines){
      if($line -match '^Display\s+(\d+)\s+\('){ return $matches[1] }
    }

    return $null
  }

  # Use on-device screencap + adb pull to avoid PowerShell stdout redirection
  # corrupting binary data.
  try { adb -s $Serial shell rm -f $remote | Out-Null } catch { }

  $displayId = Get-PrimaryDisplayId -S $Serial
  if($displayId){
    adb -s $Serial shell screencap -d $displayId -p $remote | Out-Null
  } else {
    adb -s $Serial shell screencap -p $remote | Out-Null
  }

  adb -s $Serial pull $remote $DestPath | Out-Null
  try { adb -s $Serial shell rm -f $remote | Out-Null } catch { }
}

adb kill-server
adb start-server
Wait-Devices -H $HostSerial -V $ViewerSerial -Seconds 60
adb devices -l

if(-not $SkipBuild){
  powershell -NoLogo -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\rebuild_install_dev_2phones_hard.ps1") -HostSerial $HostSerial -ViewerSerial $ViewerSerial
}

powershell -NoLogo -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\start_live_stack_2phones.ps1") -HostSerial $HostSerial -ViewerSerial $ViewerSerial -ClearDeviceLogs -KeepAliveMinutes $KeepAliveMinutes -UseAdbReverse -NoWait

# Ensure the app process is running so our IVS logs appear in the captured logcat files.
# (Users still need to navigate to Go Live / Join manually.)
try {
  adb -s $HostSerial shell monkey -p com.blyp.mobile -c android.intent.category.LAUNCHER 1 | Out-Null
  adb -s $ViewerSerial shell monkey -p com.blyp.mobile -c android.intent.category.LAUNCHER 1 | Out-Null
} catch {
  Write-Host "[WARN] Failed to auto-launch com.blyp.mobile on one or both devices: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "DO NOW: HOST Go Live -> VIEWER join. Keep viewer screen visible (unlocked, foreground)."

if($AutoCaptureDelaySec -gt 0){
  Write-Host ""
  Write-Host ("Auto-capturing proof in {0}s... (pass -AutoCaptureDelaySec 0 for manual capture)" -f $AutoCaptureDelaySec) -ForegroundColor Yellow
  Start-Sleep -Seconds $AutoCaptureDelaySec
} else {
  Write-Host ""
  Write-Host "PRESS ENTER TO CAPTURE PROOF..." -ForegroundColor Yellow
  [void][System.Console]::ReadLine()
}

powershell -NoLogo -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\_tmp_extract_logs.ps1")

$p = (Get-ChildItem -Path $Logs -Filter "logcat_viewer_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
if(-not $p){ throw "No viewer logcat file found under $Logs" }

$hp = (Get-ChildItem -Path $Logs -Filter "logcat_host_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
if(-not $hp){ throw "No host logcat file found under $Logs" }

Write-Host ("Using viewer log: " + $p)
Write-Host ("Using host log:   " + $hp)

Write-Host ""
Write-Host "==== VIEWER (bind/attach window) ====" -ForegroundColor Cyan
Select-String -Path $p -Pattern "ReactNativeJS|\[LIVE\]|IVS_NATIVE|IVS_PROOF|IVS_BIND|\[IVS_SLOT\]|\[IVS_SURFACE\]|\[IVS_BIND\]\[TRACE\]|ATTACH_DECISION|ATTACH_EXEC|REMOTE_VIDEO_ADDED|REMOTE_PARTICIPANT_|firstFrame|PixelCopy|TIMEOUT" |
  Select-Object -Last 260

Write-Host ""
Write-Host "==== HOST (bind/clear + IVS errors) ====" -ForegroundColor Cyan
Select-String -Path $hp -Pattern "ReactNativeJS|\[LIVE\]|IVS_NATIVE|IVS_PROOF|IVS_BIND|\[IVS_SURFACE\]|\[IVS_RENDER\]|clearHostPreviewTargets|UnknownHostException|live-video\.net|ERROR_TYPE|ERROR_INVALID_STATE|DISCONNECTED|Join" |
  Select-Object -Last 260

$png = Join-Path $Logs "viewer_screen_latest.png"
Capture-Screenshot -Serial $ViewerSerial -DestPath $png
Write-Host ("Saved screenshot: " + $png)

$hpng = Join-Path $Logs "host_screen_latest.png"
Capture-Screenshot -Serial $HostSerial -DestPath $hpng
Write-Host ("Saved screenshot: " + $hpng)