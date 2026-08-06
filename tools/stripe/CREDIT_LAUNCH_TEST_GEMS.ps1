<#
.SYNOPSIS
  Credit launch-test gems + optionally mint a Stripe Connect onboard link.
  Does NOT execute a Stripe transfer.

.EXAMPLE
  .\tools\stripe\CREDIT_LAUNCH_TEST_GEMS.ps1
  .\tools\stripe\CREDIT_LAUNCH_TEST_GEMS.ps1 -Gems 1500 -IncludeConnectLink
#>
param(
  [string]$Project = "blyp-master",
  [string]$ServiceUrl = "https://blyp-live-service-innn3d7yqq-uc.a.run.app",
  [string]$UserId = "26522274-e001-70aa-51b6-bcbbdffc43bb",
  [string]$Email = "alex@tapaquatics.com",
  [int]$Gems = 1500,
  [switch]$IncludeConnectLink,
  [string]$IdempotencyKey = ""
)

$ErrorActionPreference = "Stop"

if (-not $IdempotencyKey) {
  $day = Get-Date -Format 'yyyyMMdd'
  $IdempotencyKey = "launch-test-gems-${UserId}-${day}"
}

Write-Host "Fetching INTERNAL_SHARED_SECRET from Secret Manager..."
$secret = (gcloud secrets versions access latest --secret=blyp-live-internal-shared-secret --project=$Project).Trim()
if (-not $secret) { throw "INTERNAL_SHARED_SECRET empty" }

$body = @{
  userId = $UserId
  gems = $Gems
  idempotencyKey = $IdempotencyKey
  reason = "owner_launch_test_withdraw_20260806"
  includeConnectLink = [bool]$IncludeConnectLink
  email = $Email
} | ConvertTo-Json

Write-Host "POST $ServiceUrl/internal/economy/credit-launch-test-gems (gems=$Gems, connect=$IncludeConnectLink)"
$resp = Invoke-RestMethod `
  -Method POST `
  -Uri "$ServiceUrl/internal/economy/credit-launch-test-gems" `
  -Headers @{
    "Content-Type" = "application/json"
    "x-internal-secret" = $secret
  } `
  -Body $body

$resp | ConvertTo-Json -Depth 8
if ($resp.connect -and $resp.connect.url) {
  Write-Host ""
  Write-Host "=== OPEN THIS CONNECT LINK (KYC in browser, ~2 min) ==="
  Write-Host $resp.connect.url
  Write-Host "Return deep link: blyp://withdraw/connect-return"
}

Write-Host ""
Write-Host "gem_available=$($resp.gemAvailable) gemsCredited=$($resp.gemsCredited) replay=$($resp.replay)"
Write-Host "No Stripe transfer was executed by this script."
