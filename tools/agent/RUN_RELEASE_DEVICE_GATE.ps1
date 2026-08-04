# Install a release APK on adb device (no Metro). Local testing uses debug-signed release.
param(
  [switch]$SkipBuild,
  [switch]$ForceBuild,
  [int]$SmokeSec = 20,
  [switch]$KeepData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

$packetTs = Get-Date -Format 'yyyyMMdd_HHmmss'
$packet = Join-Path $Root "diagnostics\agent_gate\RELEASE_DEVICE_$packetTs"
New-Item -ItemType Directory -Force -Path $packet | Out-Null

function Write-Ledger([string]$Name, [string[]]$Lines) {
  ($Lines -join "`r`n") | Set-Content -Path (Join-Path $packet $Name) -Encoding utf8
}

Write-Ledger '00_start.txt' @(
  "UTC=$((Get-Date).ToUniversalTime().ToString('o'))"
  "ROOT=$Root"
  "SKIP_BUILD=$SkipBuild"
  "FORCE_BUILD=$ForceBuild"
  "MODE=release_apk_no_metro"
)

$adbScript = Join-Path $Root 'tools\guardrails\Get-AdbDevices.ps1'
$deviceOutput = & $adbScript
$devices = @($deviceOutput | Where-Object { $_ -is [pscustomobject] -and $_.Serial })
if (@($devices).Length -lt 1) {
  Write-Ledger '99_verdict.txt' @('RESULT=SKIP', 'REASON=NO_ADB_DEVICE')
  Write-Host 'RELEASE_DEVICE_SKIP: no adb device'
  exit 0
}

$serial = [string]$devices[0].Serial
Write-Ledger '01_adb.txt' @("SERIAL=$serial")

$apk = Join-Path $Root 'android\app\build\outputs\apk\release\app-release.apk'
$needsBuild = $ForceBuild -or -not (Test-Path -LiteralPath $apk)

if ($needsBuild -and -not $SkipBuild) {
  Write-Host 'RELEASE_DEVICE: building release APK (bundled JS, no dev launcher)...'
  $buildLog = Join-Path $packet '02_gradle_release.txt'
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = cmd /c "cd /d `"$Root\android`" && set BLYP_LOCAL_DEVICE_RELEASE=1&& set BLYP_ALLOW_DEBUG_SIGNED_RELEASE=1&& gradlew.bat :app:assembleRelease" 2>&1
  $exit = $LASTEXITCODE
  $ErrorActionPreference = $prev
  $out | Set-Content -Path $buildLog -Encoding utf8
  if ($exit -ne 0) {
    throw "RELEASE_DEVICE_FAIL: assembleRelease exit $exit (see $buildLog)"
  }
}

if (-not (Test-Path -LiteralPath $apk)) {
  throw "RELEASE_DEVICE_FAIL: APK missing at $apk (use canonical BUILD_RELEASE_CANDIDATE.ps1 for Play AAB)"
}

$smoke = Join-Path $Root 'tools\guardrails\Smoke-Android.ps1'
Write-Host "RELEASE_DEVICE: install + smoke on $serial ..."
if ($KeepData) {
  & $smoke -Serial $serial -ApkPath $apk -DurationSec $SmokeSec -KeepData
} else {
  & $smoke -Serial $serial -ApkPath $apk -DurationSec $SmokeSec
}

Write-Ledger '99_verdict.txt' @(
  'RESULT=PASS'
  "SERIAL=$serial"
  "APK=$apk"
  "PACKET=$packet"
)
Write-Host "RELEASE_DEVICE_PASS packet=$packet"
exit 0
