#Requires -Version 5.1
<#
.SYNOPSIS
  Idempotent replay of paid blyp.world Stripe Checkout sessions → live-service wallet credit.

.DESCRIPTION
  Loads STRIPE_SECRET_KEY + INTERNAL_SHARED_SECRET from GCP Secret Manager (never prints them).
  For each paid session with metadata.source=blyp-world in the lookback window, POSTs
  /internal/economy/credit-web-coins. Safe to re-run (ledger idempotent on session id).
  Web packs grant base + ~15% (e.g. £1 → 115 coins).

.EXAMPLE
  .\tools\stripe\REPLAY_WEB_STRIPE_CREDITS.ps1
  .\tools\stripe\REPLAY_WEB_STRIPE_CREDITS.ps1 -Hours 48 -SessionId cs_live_...
#>
param(
  [string]$Project = "blyp-master",
  [string]$ServiceUrl = "https://blyp-live-service-innn3d7yqq-uc.a.run.app",
  [int]$Hours = 48,
  [string]$SessionId = ""
)

$ErrorActionPreference = "Stop"

function Redact-Id([string]$v) {
  $t = ($v ?? "").Trim()
  if ($t.Length -le 12) { return $t }
  return "$($t.Substring(0, 12))…$($t.Substring($t.Length - 4))"
}

$sk = (gcloud secrets versions access latest --secret=blyp-stripe-secret-key --project=$Project).Trim()
$internal = (gcloud secrets versions access latest --secret=blyp-live-internal-shared-secret --project=$Project).Trim()
if (-not $sk.StartsWith("sk_")) { throw "Stripe secret missing/invalid" }
if (-not $internal) { throw "Internal shared secret missing" }

$stripeHeaders = @{ Authorization = "Bearer $sk" }
$creditHeaders = @{
  "Content-Type" = "application/json"
  "x-internal-secret" = $internal
}

$targets = @()
if ($SessionId) {
  $targets = @(Invoke-RestMethod -Uri "https://api.stripe.com/v1/checkout/sessions/$SessionId" -Headers $stripeHeaders)
} else {
  $since = [DateTimeOffset]::UtcNow.AddHours(-1 * [Math]::Abs($Hours)).ToUnixTimeSeconds()
  $page = Invoke-RestMethod -Uri "https://api.stripe.com/v1/checkout/sessions?limit=100" -Headers $stripeHeaders
  $targets = @($page.data | Where-Object {
    $_.payment_status -eq "paid" -and
    $_.metadata.source -eq "blyp-world" -and
    $_.created -ge $since
  })
}

Write-Host "Replaying $($targets.Count) paid blyp-world session(s) → $ServiceUrl"
foreach ($s in $targets) {
  $uid = [string]$s.metadata.userId
  $pack = [string]$s.metadata.packId
  if (-not $uid -or -not $pack) {
    Write-Host "SKIP $(Redact-Id $s.id) missing userId/packId"
    continue
  }
  $body = @{ userId = $uid; packId = $pack; stripeSessionId = $s.id } | ConvertTo-Json -Compress
  $out = Invoke-RestMethod -Uri "$ServiceUrl/internal/economy/credit-web-coins" -Method POST -Headers $creditHeaders -Body $body
  $spendable = [int]$out.wallet.coinBalance + [int]$out.wallet.bonusCoinBalance
  Write-Host ("OK $(Redact-Id $s.id) pack=$pack kind=$($out.kind) granted=$($out.granted) spendable=$spendable")
}

Remove-Variable sk, internal, stripeHeaders, creditHeaders -ErrorAction SilentlyContinue
[GC]::Collect()
Write-Host "Done."
