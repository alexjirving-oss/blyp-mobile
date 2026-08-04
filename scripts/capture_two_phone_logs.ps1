param(
  [Alias('HostDevice')]
  [string]$HostSerial = "",
  [Alias('ViewerDevice')]
  [string]$ViewerSerial = "",
  [int]$Seconds = 0,
  [switch]$ClearBefore,
  [switch]$AllBuffers,
  [string]$OutDir = "",
  [string]$Prefix = "",
  [int]$HostTail = 250,
  [int]$ViewerTail = 120
)

$ErrorActionPreference = "Stop"

$serials = (adb devices | Select-String "device$" | ForEach-Object { ($_ -split "\s+")[0] })
if ($serials.Count -lt 2) { throw "Need 2 devices connected" }

function Resolve-Serial {
  param(
    [string]$Requested,
    [string[]]$All,
    [string]$Label
  )
  if ([string]::IsNullOrWhiteSpace($Requested)) { return $null }
  if ($All -contains $Requested) { return $Requested }
  throw "$Label serial '$Requested' not found in 'adb devices'. Connected: $($All -join ', ')"
}

function Get-HostSignals($s) {
  $txt = adb -s $s logcat -d
  $score = 0
  if ($txt -match "startHostSession|startSession\(\)|sessionMode=HOST|IVS_HOST_LOCAL_JOINED") { $score += 5 }
  if ($txt -match "PUBLISHED|Publish state changed.*PUBLISHED") { $score += 3 }
  if ($txt -match "IVS_BROADCAST_STATE_CHANGED") { $score += 2 }
  [pscustomobject]@{ serial=$s; score=$score; tail=($txt | Select-Object -Last 300) }
}

$results = $serials | ForEach-Object { Get-HostSignals $_ } | Sort-Object score -Descending

$resolvedHost = Resolve-Serial -Requested $HostSerial -All $serials -Label "Host"
$resolvedViewer = Resolve-Serial -Requested $ViewerSerial -All $serials -Label "Viewer"

if ($resolvedHost -and $resolvedViewer) {
  if ($resolvedHost -eq $resolvedViewer) { throw "HostSerial and ViewerSerial must be different" }
  $hostSerial = $resolvedHost
  $viewerSerial = $resolvedViewer
} else {
  # Fallback auto-detect based on signals.
  $hostSerial = $results[0].serial
  $viewerSerial = $results[1].serial
}

if ($resolvedHost -and $resolvedViewer) {
  Write-Host "`nHOST (explicit):  $hostSerial"
  Write-Host "VIEWER (explicit): $viewerSerial`n"
} else {
  Write-Host "`nAUTO-DETECTED HOST: $hostSerial"
  Write-Host "AUTO-DETECTED VIEWER: $viewerSerial`n"
}

if ($ClearBefore) {
  Write-Host "[CAPTURE] Clearing logcat on both devices..." -ForegroundColor Yellow
  if ($AllBuffers) {
    adb -s $hostSerial logcat -b all -c | Out-Null
    adb -s $viewerSerial logcat -b all -c | Out-Null
  } else {
    adb -s $hostSerial logcat -c | Out-Null
    adb -s $viewerSerial logcat -c | Out-Null
  }
}

if ($Seconds -gt 0) {
  Write-Host "[CAPTURE] Waiting $Seconds seconds..." -ForegroundColor Yellow
  Start-Sleep -Seconds $Seconds
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$logs = if ([string]::IsNullOrWhiteSpace($OutDir)) { Join-Path $root "logs" } else { $OutDir }
New-Item -ItemType Directory -Force $logs | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

$safePrefix = if ([string]::IsNullOrWhiteSpace($Prefix)) { "" } else {
  # Keep filenames portable.
  ($Prefix -replace "[^a-zA-Z0-9_-]", "_") + "_"
}

$hostLogPath = Join-Path $logs "${safePrefix}logcat_host_$timestamp.log"
$viewerLogPath = Join-Path $logs "${safePrefix}logcat_viewer_$timestamp.log"
$hostPng = Join-Path $logs "${safePrefix}host_screen_$timestamp.png"
$viewerPng = Join-Path $logs "${safePrefix}viewer_screen_$timestamp.png"

Write-Host "[CAPTURE] Saving logcat dumps..." -ForegroundColor Yellow
$bufferArgs = @()
if ($AllBuffers) { $bufferArgs = @('-b', 'all') }

adb -s $hostSerial logcat @bufferArgs -d -v threadtime > $hostLogPath
adb -s $viewerSerial logcat @bufferArgs -d -v threadtime > $viewerLogPath

Write-Host "[CAPTURE] Saving screenshots..." -ForegroundColor Yellow
adb -s $hostSerial exec-out screencap -p > $hostPng
adb -s $viewerSerial exec-out screencap -p > $viewerPng

Write-Host "[CAPTURE] host log:   $hostLogPath"
Write-Host "[CAPTURE] viewer log: $viewerLogPath"
Write-Host "[CAPTURE] host png:   $hostPng"
Write-Host "[CAPTURE] viewer png: $viewerPng" 

Write-Host "===== HOST LOG (filtered last $HostTail) ====="
Select-String -Path $hostLogPath -Pattern "\[LIVE\]\[|IVS_|IVSBroadcastModule|startHostSession|startSession|Stage join|join\(\)|PUBLISHED|LOCAL_JOINED|SURFACE_READY|BROADCAST_STATE_CHANGED|UnknownHostException|PeerConnection is lost|ERROR|Exception|token|stageArn|streamId" -ErrorAction SilentlyContinue |
  Select-Object -Last $HostTail

Write-Host "`n===== VIEWER LOG (filtered last $ViewerTail) ====="
Select-String -Path $viewerLogPath -Pattern "\[LIVE\]\[|IVS_|VIEWER|SURFACE_READY|REMOTE_VIDEO_ADDED|FIRST_FRAME|firstFrame|PixelCopy|TIMEOUT|UnknownHostException|PeerConnection is lost|ERROR|Exception" -ErrorAction SilentlyContinue |
  Select-Object -Last $ViewerTail
