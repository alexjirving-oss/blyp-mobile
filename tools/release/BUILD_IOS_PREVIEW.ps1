<#
.SYNOPSIS
  Approved EAS iOS preview (TestFlight-bound) build for Blyp.

.DESCRIPTION
  Canonical path for kicking an iOS store-distribution build via EAS profile
  `preview-ios`. Cursor hooks block bare `eas build`; run this script instead
  after the user greenlights iOS shipping.

  Non-interactive by default. If Apple credentials are missing, EAS fails fast
  with a clear error — this script does not hang on interactive Apple login.

.PARAMETER Profile
  EAS build profile. Default: preview-ios (store distribution for TestFlight).

.PARAMETER Wait
  If set, wait for the cloud build to finish.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_IOS_PREVIEW.ps1
#>
[CmdletBinding()]
param(
  [string]$Profile = 'preview-ios',
  [switch]$Wait
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $RepoRoot

Write-Host "=== Blyp iOS EAS build ===" -ForegroundColor Cyan
Write-Host "Repo:    $RepoRoot"
Write-Host "Profile: $Profile"
Write-Host "Platform: ios"
Write-Host "Mode:    non-interactive (no Apple login prompts)"

$easJson = Join-Path $RepoRoot 'eas.json'
if (-not (Test-Path $easJson)) {
  throw "ABORT: eas.json missing at $easJson"
}

$easRaw = Get-Content $easJson -Raw | ConvertFrom-Json
if (-not $easRaw.build.$Profile) {
  throw "ABORT: eas.json has no build profile '$Profile'. Use preview-ios / development / production."
}

$who = & npx --yes eas-cli whoami 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "ABORT: Not logged into EAS. Run: npx eas-cli login"
}
Write-Host "EAS user: $who"

if ($Wait) {
  $easArgs = @(
    'eas-cli', 'build',
    '--platform', 'ios',
    '--profile', $Profile,
    '--non-interactive'
  )
} else {
  $easArgs = @(
    'eas-cli', 'build',
    '--platform', 'ios',
    '--profile', $Profile,
    '--non-interactive',
    '--no-wait'
  )
}

Write-Host "Running: npx $($easArgs -join ' ')" -ForegroundColor Yellow
& npx @easArgs
$exit = $LASTEXITCODE

if ($exit -ne 0) {
  Write-Host ""
  Write-Host "BUILD FAILED (exit $exit)." -ForegroundColor Red
  Write-Host "Common blockers:"
  Write-Host "  1. No Apple credentials on EAS — Alex must run interactively once:"
  Write-Host "       npx eas-cli credentials -p ios"
  Write-Host "     or: npx eas-cli build -p ios --profile $Profile   (allows Apple login prompts)"
  Write-Host "  2. App Store Connect app missing for bundle id com.blyp.mobile"
  Write-Host "  3. ASC App ID / Apple Team ID not set for submit (build can still succeed)"
  Write-Host "See docs/IOS_TESTFLIGHT_RUNBOOK.md"
  exit $exit
}

Write-Host ""
Write-Host "EAS iOS build submitted. Track: https://expo.dev/accounts/alexjirving/projects/blyp-mobile/builds" -ForegroundColor Green
Write-Host "Next: after SUCCESS, submit with profile $Profile (see runbook)."
exit 0
