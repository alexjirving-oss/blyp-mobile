[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ReleaseApk,
  [int]$Seconds = 30
)

$ErrorActionPreference = 'Stop'

# scripts/guardrails -> repo root
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

if (-not (Test-Path -LiteralPath $ReleaseApk)) {
  Write-Error "Release APK not found: $ReleaseApk"
  exit 1
}

$apkPath = (Resolve-Path -LiteralPath $ReleaseApk).Path

$smokeScript = Join-Path $repoRoot 'tools\guardrails\Smoke-Android.ps1'
if (-not (Test-Path -LiteralPath $smokeScript)) {
  Write-Error "Missing guardrails smoke script: $smokeScript"
  exit 1
}

& $smokeScript -ApkPath $apkPath -DurationSec $Seconds
exit $LASTEXITCODE
