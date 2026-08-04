<#
.SYNOPSIS
  Cut the Blyp production Cognito user pool over from the generic COGNITO_DEFAULT
  email sender (which lands in spam) to authenticated Amazon SES on blyp.world.

.DESCRIPTION
  This is the FINAL step of the email-deliverability work (see
  docs/EMAIL_DELIVERABILITY_RUNBOOK.md). It is intentionally conservative:

    * It REFUSES to change anything until the SES domain identity is actually
      verified (DKIM Status = SUCCESS, VerifiedForSendingStatus = true). Running
      it before the GoDaddy DNS records have propagated is a no-op + clear report.
    * Cognito's update-user-pool API REPLACES the whole pool config, silently
      resetting any field you don't pass (DeletionProtection -> INACTIVE, password
      policy, recovery, etc.). To avoid that footgun this script READS the live
      config and re-submits it verbatim via --cli-input-json, mutating ONLY the
      EmailConfiguration block.
    * It attaches the SES sending-authorization policy that lets Cognito send from
      the identity.

  Nothing is mutated unless you pass -Apply. Default is a safe dry run that prints
  the exact JSON that WOULD be submitted.

.EXAMPLE
  # Just check whether SES is verified yet (safe, read-only):
  pwsh tools/email/wire_cognito_ses.ps1 -CheckOnly

.EXAMPLE
  # Dry run (prints the update JSON, mutates nothing):
  pwsh tools/email/wire_cognito_ses.ps1

.EXAMPLE
  # Actually perform the cutover (only succeeds if SES is verified):
  pwsh tools/email/wire_cognito_ses.ps1 -Apply
#>
[CmdletBinding()]
param(
  [string]$UserPoolId   = 'eu-west-2_ITX07Zvnt',
  [string]$Region       = 'eu-west-2',
  [string]$AccountId    = '030569357413',
  [string]$Domain       = 'blyp.world',
  [string]$FromAddress  = 'Blyp <no-reply@blyp.world>',
  [string]$ReplyTo      = 'support@blyp.world',
  [switch]$CheckOnly,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'

function Info($m){ Write-Host "[ses-wire] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[ses-wire] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[ses-wire] $m" -ForegroundColor Yellow }
function Fail($m){ Write-Host "[ses-wire] $m" -ForegroundColor Red; exit 1 }

$identityArn = "arn:aws:ses:${Region}:${AccountId}:identity/${Domain}"
$poolArn     = "arn:aws:cognito-idp:${Region}:${AccountId}:userpool/${UserPoolId}"

# ---------------------------------------------------------------------------
# 1. Preflight: is the SES domain identity verified?
# ---------------------------------------------------------------------------
Info "Checking SES identity '$Domain' in $Region ..."
$idJson = aws sesv2 get-email-identity --email-identity $Domain --region $Region --output json 2>&1
if ($LASTEXITCODE -ne 0) { Fail "SES identity '$Domain' not found in $Region. Has it been created? ($idJson)" }
$id = $idJson | ConvertFrom-Json

$verified = [bool]$id.VerifiedForSendingStatus
$dkim     = $id.DkimAttributes.Status
$mailFrom = $id.MailFromAttributes.MailFromDomainStatus

Info "  VerifiedForSendingStatus : $verified"
Info "  DKIM Status              : $dkim"
Info "  MAIL FROM Status         : $mailFrom"

if (-not $verified -or $dkim -ne 'SUCCESS') {
  Warn "SES is NOT verified yet (DKIM=$dkim). This means the GoDaddy DNS records"
  Warn "from docs/EMAIL_DELIVERABILITY_RUNBOOK.md have not fully propagated."
  Warn "Add the 3 DKIM CNAMEs + MAIL FROM MX/TXT, wait for propagation, then re-run."
  if ($CheckOnly) { exit 0 }
  Fail "Refusing to wire Cognito to an unverified SES identity."
}
Ok "SES identity is verified and DKIM-signed."

if ($mailFrom -ne 'SUCCESS') {
  Warn "Custom MAIL FROM ($($id.MailFromAttributes.MailFromDomain)) is '$mailFrom', not SUCCESS."
  Warn "Cognito will still send (falls back to amazonses.com), but add the MAIL FROM"
  Warn "MX/TXT records for best deliverability."
}

if ($CheckOnly) { Ok "Check-only mode: SES is ready. Re-run with -Apply to wire Cognito."; exit 0 }

# ---------------------------------------------------------------------------
# 2. Read the LIVE pool config and rebuild an update payload that preserves
#    every existing setting, changing only EmailConfiguration.
# ---------------------------------------------------------------------------
Info "Reading live config for pool $UserPoolId ..."
$poolJson = aws cognito-idp describe-user-pool --user-pool-id $UserPoolId --region $Region --output json 2>&1
if ($LASTEXITCODE -ne 0) { Fail "describe-user-pool failed: $poolJson" }
$p = ($poolJson | ConvertFrom-Json).UserPool

# update-user-pool only accepts a subset of fields; anything omitted is RESET to
# default. Copy through every mutable field that is currently set.
$update = [ordered]@{ UserPoolId = $UserPoolId }
if ($p.Name)                       { $update.PoolName                  = $p.Name }
if ($p.Policies)                   { $update.Policies                  = $p.Policies }
if ($p.DeletionProtection)         { $update.DeletionProtection        = $p.DeletionProtection }
if ($p.LambdaConfig)               { $update.LambdaConfig              = $p.LambdaConfig }
if ($p.AutoVerifiedAttributes)     { $update.AutoVerifiedAttributes    = $p.AutoVerifiedAttributes }
if ($p.VerificationMessageTemplate){ $update.VerificationMessageTemplate = $p.VerificationMessageTemplate }
if ($p.UserAttributeUpdateSettings){ $update.UserAttributeUpdateSettings = $p.UserAttributeUpdateSettings }
if ($p.MfaConfiguration)           { $update.MfaConfiguration          = $p.MfaConfiguration }
if ($p.AccountRecoverySetting)     { $update.AccountRecoverySetting    = $p.AccountRecoverySetting }
if ($p.UserPoolTags)               { $update.UserPoolTags              = $p.UserPoolTags }
if ($p.UserPoolAddOns)             { $update.UserPoolAddOns            = $p.UserPoolAddOns }
if ($p.SmsConfiguration)           { $update.SmsConfiguration          = $p.SmsConfiguration }
if ($p.DeviceConfiguration)        { $update.DeviceConfiguration       = $p.DeviceConfiguration }

# AdminCreateUserConfig: keep only AllowAdminCreateUserOnly. The deprecated
# UnusedAccountValidityDays conflicts with the password policy's
# TemporaryPasswordValidityDays and is rejected when both are present.
if ($p.AdminCreateUserConfig) {
  $update.AdminCreateUserConfig = @{ AllowAdminCreateUserOnly = [bool]$p.AdminCreateUserConfig.AllowAdminCreateUserOnly }
}

# THE ONLY ACTUAL CHANGE: switch the email sender to SES (DEVELOPER mode).
$update.EmailConfiguration = [ordered]@{
  EmailSendingAccount  = 'DEVELOPER'
  SourceArn            = $identityArn
  From                 = $FromAddress
  ReplyToEmailAddress  = $ReplyTo
}

$payload = $update | ConvertTo-Json -Depth 20

Info "Proposed update payload (EmailConfiguration is the only change):"
Write-Host $payload -ForegroundColor DarkGray

if (-not $Apply) {
  Warn "DRY RUN. Nothing was changed. Re-run with -Apply to perform the cutover."
  exit 0
}

# ---------------------------------------------------------------------------
# 3. Attach the SES sending-authorization policy for Cognito (idempotent).
# ---------------------------------------------------------------------------
$sesPolicy = @{
  Version   = '2012-10-17'
  Statement = @(@{
    Sid       = 'AllowCognitoToSend'
    Effect    = 'Allow'
    Principal = @{ Service = 'cognito-idp.amazonaws.com' }
    Action    = @('ses:SendEmail','ses:SendRawEmail')
    Resource  = $identityArn
    Condition = @{
      StringEquals = @{ 'aws:SourceAccount' = $AccountId }
      ArnLike      = @{ 'aws:SourceArn' = $poolArn }
    }
  })
} | ConvertTo-Json -Depth 20 -Compress

Info "Attaching SES sending-authorization policy for Cognito ..."
aws sesv2 delete-email-identity-policy --email-identity $Domain --policy-name CognitoSend --region $Region 2>$null | Out-Null
$polRes = aws sesv2 create-email-identity-policy --email-identity $Domain --policy-name CognitoSend --policy $sesPolicy --region $Region 2>&1
if ($LASTEXITCODE -ne 0) { Warn "Could not attach SES identity policy (same-account sending may still work): $polRes" }
else { Ok "SES identity policy attached." }

# ---------------------------------------------------------------------------
# 4. Apply the Cognito update.
# ---------------------------------------------------------------------------
$tmp = Join-Path $env:TEMP "cognito_update_payload.json"
$payload | Set-Content -Path $tmp -Encoding utf8

Info "Applying update-user-pool ..."
$res = aws cognito-idp update-user-pool --region $Region --cli-input-json "file://$tmp" 2>&1
if ($LASTEXITCODE -ne 0) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue; Fail "update-user-pool failed: $res" }
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# 5. Verify the change landed.
# ---------------------------------------------------------------------------
$after = (aws cognito-idp describe-user-pool --user-pool-id $UserPoolId --region $Region --output json | ConvertFrom-Json).UserPool
$sending = $after.EmailConfiguration.EmailSendingAccount
$from    = $after.EmailConfiguration.From
$dp      = $after.DeletionProtection
Ok "Cutover complete."
Info "  EmailSendingAccount : $sending"
Info "  From                : $from"
Info "  DeletionProtection  : $dp  (should still be ACTIVE)"
if ($sending -ne 'DEVELOPER') { Fail "EmailSendingAccount is '$sending', expected DEVELOPER." }
if ($dp -ne 'ACTIVE') { Warn "DeletionProtection is '$dp' - expected ACTIVE. Re-enable it if needed." }
Ok "Send a test sign-up to confirm the verification email now arrives from $FromAddress (check inbox, not spam)."
