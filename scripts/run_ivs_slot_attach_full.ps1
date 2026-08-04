param(
  [string]$HostSerial,
  [string]$ViewerSerial
)

$ErrorActionPreference="Stop"

$RepoRoot = (Resolve-Path ".").Path
$LogsDir = Join-Path $RepoRoot "logs"
if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null }

Write-Host "== Sanity: files =="
ls scripts\run_ivs_slot_attach_test.ps1, scripts\parse_ivs_slot_logs.ps1, docs\IVS_VIEWER_DEBUG.md -ErrorAction SilentlyContinue

Write-Host "== Sanity: adb devices =="
adb kill-server
adb start-server
adb devices -l

Write-Host "== Sanity: typecheck =="
try {
  npm run typecheck
} catch {
  Write-Warning "typecheck failed; continuing per instructions."
}

Write-Host "== Rebuild/Install dev client (native changes require this) =="
# Install to BOTH devices to remove doubt (viewer + host share native module codepaths).
powershell -ExecutionPolicy Bypass -File scripts\build_install_android_debug.ps1 -Serial $ViewerSerial
powershell -ExecutionPolicy Bypass -File scripts\build_install_android_debug.ps1 -Serial $HostSerial

Write-Host "== Runtime proof: slot logs exist =="
adb -s $ViewerSerial logcat -c
Write-Host "Open viewer screen once, then press Enter to dump proof logs..."
Read-Host
adb -s $ViewerSerial logcat -d | findstr /R "IVS_SLOT IVS_SURFACE_READY IVSRealTimeView IVS_VIEWER"

Write-Host "== Run existing harness =="
powershell -ExecutionPolicy Bypass -File scripts\run_ivs_slot_attach_test.ps1

Write-Host "== Post: print newest summary + last 200 relevant log lines =="
$summary = Get-ChildItem logs\ivs_slot_attach_summary_*.md | Sort-Object LastWriteTime | Select-Object -Last 1
$log = Get-ChildItem logs\ivs_slot_attach_*.log | Sort-Object LastWriteTime | Select-Object -Last 1

Write-Host "`n===== NEWEST SUMMARY: $($summary.Name) =====`n"
Get-Content $summary.FullName

Write-Host "`n===== LAST 200 RELEVANT LINES: $($log.Name) =====`n"
Get-Content $log.FullName | Select-String "IVS_SLOT|IVS_VIEWER|IVS_SURFACE_READY|SURFACE_STATE|RENDER_SLOT|IVSRealTimeView" | Select-Object -Last 200
