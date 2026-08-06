#Requires -Version 5.1
<#
.SYNOPSIS
  Add live Stripe secret + webhook signing secret to GCP Secret Manager
  and refresh Cloud Run bindings (does NOT flip ENABLE_WITHDRAWALS).

.NOTES
  Never commit keys. This script does not print full secret values.
#>
param(
  [string]$Project = "blyp-master",
  [string]$Region = "us-central1",
  [string]$Service = "blyp-live-service",
  [string]$SecretKeyName = "blyp-stripe-secret-key",
  [string]$WebhookSecretName = "blyp-stripe-webhook-secret",
  [switch]$SkipCloudRunRefresh
)

$ErrorActionPreference = "Stop"

function Redact-Key([string]$v) {
  $t = ($v ?? "").Trim()
  if ($t.Length -lt 12) { return "(too short)" }
  return "$($t.Substring(0, [Math]::Min(10, $t.Length)))…$($t.Substring($t.Length - 4)) (len=$($t.Length))"
}

Write-Host ""
Write-Host "Stripe live secret loader for $Service ($Region / $Project)"
Write-Host "This will NOT set ENABLE_WITHDRAWALS=1."
Write-Host ""

$sk = Read-Host "Paste STRIPE live secret key (sk_live_…)"
$sk = ($sk ?? "").Trim()
if (-not $sk.StartsWith("sk_live_")) {
  throw "Refusing non-live key. Expected prefix sk_live_ (got $(Redact-Key $sk))"
}

$wh = Read-Host "Paste webhook signing secret (whsec_…)"
$wh = ($wh ?? "").Trim()
if (-not $wh.StartsWith("whsec_")) {
  throw "Refusing webhook secret. Expected prefix whsec_ (got $(Redact-Key $wh))"
}

Write-Host ""
Write-Host "Will write:"
Write-Host "  $SecretKeyName = $(Redact-Key $sk)"
Write-Host "  $WebhookSecretName = $(Redact-Key $wh)"
$confirm = Read-Host "Type YES to add new Secret Manager versions"
if ($confirm -ne "YES") { throw "Aborted" }

$sk | gcloud secrets versions add $SecretKeyName --project=$Project --data-file=-
$wh | gcloud secrets versions add $WebhookSecretName --project=$Project --data-file=-

Write-Host "Secret versions added."

if (-not $SkipCloudRunRefresh) {
  Write-Host "Refreshing Cloud Run secret bindings to :latest …"
  gcloud run services update $Service `
    --project=$Project `
    --region=$Region `
    --update-secrets="STRIPE_SECRET_KEY=${SecretKeyName}:latest,STRIPE_WEBHOOK_SECRET=${WebhookSecretName}:latest"
  Write-Host "Cloud Run update requested. Confirm Admin → Economy shows Stripe secret = live."
}

Write-Host ""
Write-Host "Next:"
Write-Host "  1) Stripe Dashboard → webhook URL https://blyp-live-service-innn3d7yqq-uc.a.run.app/webhooks/stripe"
Write-Host "  2) Send test event; expect 200"
Write-Host "  3) Only then: reply 'enable withdrawals' (separate one-liner ENABLE_WITHDRAWALS=1)"
Write-Host ""
