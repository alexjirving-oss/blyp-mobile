# Live device smoke gate — release APK (bundled JS, no Metro/dev launcher).
param(
  [int]$DurationSec = 25,
  [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

$packetTs = Get-Date -Format 'yyyyMMdd_HHmmss'
$packet = Join-Path $Root "diagnostics\agent_gate\LIVE_SMOKE_$packetTs"
New-Item -ItemType Directory -Force -Path $packet | Out-Null

function Write-Ledger([string]$Name, [string[]]$Lines) {
  $path = Join-Path $packet $Name
  ($Lines -join "`r`n") | Set-Content -Path $path -Encoding utf8
}

Write-Ledger '00_start.txt' @(
  "UTC=$((Get-Date).ToUniversalTime().ToString('o'))"
  "ROOT=$Root"
  "SKIP_BUILD=$SkipBuild"
  "BLYP_REQUIRE_LIVE=$env:BLYP_REQUIRE_LIVE"
)

$adbScript = Join-Path $Root 'tools\guardrails\Get-AdbDevices.ps1'
if (-not (Test-Path -LiteralPath $adbScript)) {
  throw "MISSING: $adbScript"
}

$devices = @()
try {
  $deviceOutput = & $adbScript
  $devices = @($deviceOutput | Where-Object { $_ -is [pscustomobject] -and $_.Serial })
} catch {
  Write-Ledger '01_adb.txt' @("ERROR=$($_.Exception.Message)")
  if ($env:BLYP_REQUIRE_LIVE -eq '1') {
    throw "LIVE_GATE_FAIL: no adb devices and BLYP_REQUIRE_LIVE=1"
  }
  Write-Host 'LIVE_GATE_SKIP: no authorized adb device'
  Write-Ledger '99_verdict.txt' @('RESULT=SKIP', 'REASON=NO_ADB_DEVICE')
  exit 0
}

if (@($devices).Length -lt 1) {
  if ($env:BLYP_REQUIRE_LIVE -eq '1') {
    throw 'LIVE_GATE_FAIL: BLYP_REQUIRE_LIVE=1 but no authorized adb device'
  }
  Write-Host 'LIVE_GATE_SKIP: no authorized adb device'
  Write-Ledger '99_verdict.txt' @('RESULT=SKIP', 'REASON=NO_ADB_DEVICE')
  exit 0
}

$serial = [string]$devices[0].Serial
Write-Ledger '01_adb.txt' @(
  "DEVICE_COUNT=$($devices.Count)"
  "PRIMARY_SERIAL=$serial"
) + ($devices | ForEach-Object { "DEVICE=$($_.Serial) :: $($_.Line)" })

$apk = Join-Path $Root 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path -LiteralPath $apk) -and -not $SkipBuild) {
  Write-Host "LIVE_GATE: building release APK (no Metro)..."
  $buildLog = Join-Path $packet '02_gradle_build.txt'
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = cmd /c "cd /d `"$Root\android`" && set BLYP_LOCAL_DEVICE_RELEASE=1&& set BLYP_ALLOW_DEBUG_SIGNED_RELEASE=1&& gradlew.bat :app:assembleRelease" 2>&1
  $exit = $LASTEXITCODE
  $ErrorActionPreference = $prev
  $out | Set-Content -Path $buildLog -Encoding utf8
  if ($exit -ne 0) {
    throw "LIVE_GATE_FAIL: gradle assembleRelease exit $exit (see $buildLog)"
  }
}

if (-not (Test-Path -LiteralPath $apk)) {
  throw "LIVE_GATE_FAIL: APK missing at $apk"
}

$smoke = Join-Path $Root 'tools\guardrails\Smoke-Android.ps1'
Write-Host "LIVE_GATE: smoke on $serial ..."
& $smoke -Serial $serial -ApkPath $apk -DurationSec $DurationSec

Write-Ledger '99_verdict.txt' @(
  'RESULT=PASS'
  "SERIAL=$serial"
  "APK=$apk"
  "PACKET=$packet"
)
Write-Host "LIVE_GATE_PASS packet=$packet"
exit 0
