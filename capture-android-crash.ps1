# PowerShell helper to capture Blyp Android crash logs
# Usage: connect device (adb), then run:
#   ./capture-android-crash.ps1
# It will clear logcat, launch expo (if not already), wait, then save logs.

param(
  [string]$Output = "blyp-crash-$(Get-Date -Format 'yyyyMMdd-HHmmss').log",
  [int]$DurationSeconds = 20,
  [switch]$Raw
)

Write-Host "[BLYP][LOG] Ensuring device connected..."
adb devices | Select-String "device$" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Warning "No device detected. Aborting."; exit 1 }

Write-Host "[BLYP][LOG] Clearing old logcat buffer"; adb logcat -c | Out-Null
Write-Host "[BLYP][LOG] Starting capture for $DurationSeconds seconds -> $Output"

# Start async logcat capture
$logTask = Start-Job -ScriptBlock {
  param($OutFile, $Dur, $RawMode)
  $end = (Get-Date).AddSeconds($Dur)
  $filter = '(blyp|firebase|amplify|exponent|AndroidRuntime|FATAL)' # case-insensitive pattern
  $fs = New-Object System.IO.StreamWriter($OutFile, $false)
  try {
    $proc = Start-Process adb -ArgumentList 'logcat','-v','time' -NoNewWindow -RedirectStandardOutput pipe -PassThru
    $reader = $proc.StandardOutput
    while(-not $reader.EndOfStream -and (Get-Date) -lt $end) {
      $line = $reader.ReadLine()
      if ($RawMode -or $line -match $filter) { $fs.WriteLine($line) }
    }
    try { $proc.CloseMainWindow() | Out-Null } catch {}
    try { $proc.Kill() } catch {}
  } finally { $fs.Flush(); $fs.Close() }
  return $OutFile
} -ArgumentList $Output,$DurationSeconds,$Raw.IsPresent

Write-Host "[BLYP][LOG] Launch or reproduce the crash now..."
Start-Sleep -Seconds $DurationSeconds
Receive-Job $logTask | Out-Null; Remove-Job $logTask

Write-Host "[BLYP][LOG] Capture complete: $Output"
Write-Host "[BLYP][LOG] Last 40 lines:"; Get-Content $Output -Tail 40
