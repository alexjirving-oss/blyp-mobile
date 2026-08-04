[CmdletBinding()]
[CmdletBinding()]
param(
  [int]$DurationSec = 25,
  [string]$Package = "com.blyp.mobile",
  [string]$Activity = ".MainActivity"
)

# HISTORICAL ONLY - NON-CANONICAL - DO NOT USE FOR RELEASE.
# This guardrail script exists for local smoke validation and is not a Play-upload release path.

$ErrorActionPreference = "Stop"
Set-Location "C:\Users\Alex\Blyp26"

function Get-StatusPaths {
  $lines = (& git status --porcelain 2>$null)
  $paths = New-Object System.Collections.Generic.List[string]

  foreach ($l in $lines) {
    if (-not $l) { continue }
    $rest = $l.Substring(3).Trim()
    if (-not $rest) { continue }

    # Rename format: "old -> new"
    if ($rest -like "* -> *") {
      $rest = ($rest -split " -> ")[-1].Trim()
    }

    $paths.Add($rest)
  }

  $paths | Sort-Object -Unique
}

function Assert-OnlyAllowedChanges {
  $changed = Get-StatusPaths
  if (-not $changed -or $changed.Count -eq 0) { return }

  foreach ($p in $changed) {
    $ok = $false
    if ($p -eq ".gitignore") { $ok = $true }
    elseif ($p -eq ".baseline.lock") { $ok = $true }
    elseif ($p -like "tools/guardrails/*") { $ok = $true }

    if (-not $ok) {
      throw "ABORT: Found changes outside tools/guardrails/*, .gitignore, .baseline.lock: $p"
    }
  }
}

Assert-OnlyAllowedChanges

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$root = Join-Path (Resolve-Path ".") ("artifacts\\guardrails\\" + $ts)
New-Item -ItemType Directory -Force -Path $root | Out-Null

"START=$(Get-Date -Format o)" | Out-File -Encoding utf8 (Join-Path $root "00_start.txt")
(& git status -sb 2>&1) | Out-File -Encoding utf8 (Join-Path $root "01_git_status.txt")
(& adb devices -l 2>&1) | Out-File -Encoding utf8 (Join-Path $root "02_adb_devices.txt")

$devices = & (Join-Path $PSScriptRoot "Get-AdbDevices.ps1")
if (-not $devices -or $devices.Count -lt 1) {
  throw "No authorized adb devices detected. Need 'device' state from 'adb devices -l'."
}

Write-Host "AUTHORIZED_DEVICES:"
$devices | ForEach-Object { Write-Host (" - " + $_.Serial + " :: " + $_.Line) }

# Build release once
$env:NODE_ENV = "production"
$env:CI = "1"

$buildLog = Join-Path $root "03_build_debug.txt"
"HISTORICAL ONLY - NON-CANONICAL - DO NOT USE FOR RELEASE" | Out-File -Encoding utf8 $buildLog
"android/gradlew.bat :app:assembleDebug" | Add-Content -Encoding utf8 $buildLog
"NODE_ENV=$env:NODE_ENV" | Add-Content -Encoding utf8 $buildLog
"CI=$env:CI" | Add-Content -Encoding utf8 $buildLog

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$buildOut = cmd /c "set NODE_ENV=$env:NODE_ENV& set CI=$env:CI& cd /d C:\Users\Alex\Blyp26\android& .\gradlew.bat :app:assembleDebug" 2>&1
$buildExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap

$buildOut | Tee-Object -FilePath $buildLog -Append | Out-Null
if ($buildExit -ne 0) { throw "Gradle build failed (exit $buildExit). See $buildLog" }

$apk = "android\\app\\build\\outputs\\apk\\debug\\app-debug.apk"
if (!(Test-Path -LiteralPath $apk)) { throw "APK missing at $apk" }

$results = @()
$allOk = $true
foreach ($d in $devices) {
  try {
    & (Join-Path $PSScriptRoot "Smoke-Android.ps1") -Serial $d.Serial -ApkPath $apk -Package $Package -Activity $Activity -DurationSec $DurationSec
    $results += [pscustomobject]@{ Serial=$d.Serial; Result="PASS" }
  } catch {
    $allOk = $false
    $results += [pscustomobject]@{ Serial=$d.Serial; Result="FAIL"; Error=$_.Exception.Message }
  }
}

$results | Format-Table -AutoSize | Out-String | Out-File -Encoding utf8 (Join-Path $root "04_results.txt")
$results | ForEach-Object { Write-Host ("RESULT " + $_.Serial + " = " + $_.Result) }

if (-not $allOk) {
  throw "GUARDRAILS FAIL: One or more devices failed smoke. See $root\\04_results.txt"
}

$hash = (git rev-parse HEAD).Trim()
Write-Host "BASELINE_LOCKED_HEAD=$hash"
Write-Host "GUARDRAILS_ROOT=$root"
Write-Host "DONE"
