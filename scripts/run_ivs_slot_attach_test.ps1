Param(
    [string]$HostSerial,
    [string]$ViewerSerial,
    [string]$OutDir = "logs"
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogsDir = Join-Path $RepoRoot "logs"
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
}
$OutDir = $LogsDir

function Get-DefaultDevice {
    $list = adb devices
    $lines = $list -split "`n" | Where-Object {$_ -match "\s+device$" -or $_ -match "\s+device\s"}
    if ($lines.Count -gt 0) {
        return ($lines[0] -split "\s+")[0]
    }
    return $null
}

$deviceForLogcat = $ViewerSerial
if (-not $deviceForLogcat) { $deviceForLogcat = $HostSerial }
if (-not $deviceForLogcat) { $deviceForLogcat = Get-DefaultDevice }
if (-not $deviceForLogcat) {
    Write-Error "No adb device available for logcat capture."
    exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logPath = Join-Path $OutDir "ivs_slot_attach_$timestamp.log"
$summaryPath = Join-Path $OutDir "ivs_slot_attach_summary_$timestamp.md"

Write-Host "[IVS TEST] Clearing logcat..." -ForegroundColor Cyan
adb -s $deviceForLogcat logcat -c

# Start Metro in a separate window
$metroCmd = "cd `"$RepoRoot`"; npx expo start --dev-client --clear"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $metroCmd | Out-Null
Write-Host "[IVS TEST] Metro started in new window." -ForegroundColor Green

# Build logcat filter and start capture as background job
$pattern = "IVS_SLOT|IVS_VIEWER|IVS_SURFACE_READY|RENDER_SLOT|SURFACE_STATE"
$logJob = Start-Job -ScriptBlock {
    Param($patternInner, $logFileInner, $device, $repo)
    Set-Location $repo
    adb -s $device logcat | Select-String -Pattern $patternInner | Tee-Object -FilePath $logFileInner
} -ArgumentList $pattern, $logPath, $deviceForLogcat, $RepoRoot

Write-Host "[IVS TEST] Logcat capture started -> $logPath" -ForegroundColor Green
if ($HostSerial) { Write-Host "Host device: $HostSerial" }
if ($ViewerSerial) { Write-Host "Viewer device: $ViewerSerial" }

Write-Host ""; Write-Host "=== ACTION REQUIRED ===" -ForegroundColor Yellow
Write-Host "1) On HOST phone: Press Go Live now, then press Enter here." -ForegroundColor Yellow
Read-Host | Out-Null
Write-Host "2) On VIEWER phone: Join the stream now, then press Enter here." -ForegroundColor Yellow
Read-Host | Out-Null

Write-Host "[IVS TEST] Capturing for 20 seconds..." -ForegroundColor Cyan
Start-Sleep -Seconds 20

Write-Host "[IVS TEST] Stopping log capture..." -ForegroundColor Cyan
Stop-Job $logJob | Out-Null
Receive-Job $logJob | Out-Null
Remove-Job $logJob | Out-Null

Write-Host "[IVS TEST] Parsing log..." -ForegroundColor Cyan
$parser = Join-Path $PSScriptRoot "parse_ivs_slot_logs.ps1"
if (-not (Test-Path $parser)) {
    Write-Error "Parser script not found at $parser"
    exit 1
}

powershell -ExecutionPolicy Bypass -File $parser -LogPath $logPath -OutPath $summaryPath
Write-Host "[IVS TEST] Summary written -> $summaryPath" -ForegroundColor Green

Write-Host ""; Write-Host "Done. Share the summary markdown." -ForegroundColor Green
