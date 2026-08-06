#Requires -Version 5.1
<#
.SYNOPSIS
  Flip ENABLE_WITHDRAWALS=1 on Cloud Run ONLY if Secret Manager latest
  Stripe secret starts with sk_live_. Does not print the key.
#>
param(
  [string]$Project = "blyp-master",
  [string]$Region = "us-central1",
  [string]$Service = "blyp-live-service",
  [string]$SecretKeyName = "blyp-stripe-secret-key",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$raw = (gcloud secrets versions access latest --secret=$SecretKeyName --project=$Project 2>$null)
$sk = ([string]$raw).Trim()
if (-not $sk.StartsWith("sk_live_")) {
  $kind = if ($sk.StartsWith("sk_test_")) { "TEST" } elseif ($sk) { "UNKNOWN/NON-LIVE" } else { "EMPTY" }
  throw "Refusing ENABLE_WITHDRAWALS=1 — $SecretKeyName is $kind (need sk_live_). Run SET_STRIPE_LIVE_SECRETS.ps1 first."
}

$suffix = $sk.Substring($sk.Length - 4)
Write-Host "Verified live key sk_live_…$suffix"
if (-not $Force) {
  $c = Read-Host "Type ENABLE to set ENABLE_WITHDRAWALS=1 on $Service"
  if ($c -ne "ENABLE") { throw "Aborted" }
}

gcloud run services update $Service `
  --project=$Project `
  --region=$Region `
  --update-env-vars "ENABLE_WITHDRAWALS=1"

Write-Host "ENABLE_WITHDRAWALS=1 requested. Confirm Admin → Economy shows PAYOUTS LIVE."
Write-Host "Then ship mobile EXPO_PUBLIC_ENABLE_WITHDRAWALS=1."
