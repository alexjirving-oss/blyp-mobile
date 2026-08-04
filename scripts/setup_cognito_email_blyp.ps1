<#
.SYNOPSIS
  Set up Blyp-owned Cognito verification email via Amazon SES (blyp.world).

.DESCRIPTION
  The Blyp user pool sends sign-up verification codes from Cognito's shared
  sender by default, which lands in spam and is off-brand. This script wires
  the pool to send from safety@blyp.world via our own verified SES domain.

  It is safe to re-run. Steps:
    1) Print the DNS records you must add at the blyp.world registrar.
    2) Poll SES until the domain (DKIM + MAIL FROM) is verified.
    3) Attach an SES identity policy authorizing Cognito to send.
    4) (Optional) Submit an SES production-access request (exit sandbox).
    5) Tell you how to deploy the Cognito email config (amplify push).

.NOTES
  Requires: AWS CLI v2 authenticated for account 030569357413, region eu-west-2.
#>

[CmdletBinding()]
param(
  [string]$Region       = 'eu-west-2',
  [string]$Account      = '030569357413',
  [string]$Domain       = 'blyp.world',
  [string]$MailFromSub  = 'mail.blyp.world',
  [string]$UserPoolId   = 'eu-west-2_ITX07Zvnt',
  [string]$WebsiteUrl   = 'https://blyp.world',
  [switch]$RequestProductionAccess
)

$ErrorActionPreference = 'Stop'
$IdentityArn = "arn:aws:ses:$Region`:$Account`:identity/$Domain"
$UserPoolArn = "arn:aws:cognito-idp:$Region`:$Account`:userpool/$UserPoolId"

function Write-Section($t) { Write-Host "`n===== $t =====" -ForegroundColor Cyan }

Write-Section "DNS records to add at the $Domain registrar"
$identity = aws sesv2 get-email-identity --region $Region --email-identity $Domain --output json | ConvertFrom-Json
$tokens = $identity.DkimAttributes.Tokens

Write-Host "DKIM (add all three as CNAME records):" -ForegroundColor Yellow
foreach ($tok in $tokens) {
  Write-Host ("  CNAME  {0}._domainkey.{1}  ->  {0}.dkim.amazonses.com" -f $tok, $Domain)
}
Write-Host "`nMAIL FROM (custom return-path for SPF alignment):" -ForegroundColor Yellow
Write-Host ("  MX     {0}  ->  10 feedback-smtp.{1}.amazonses.com" -f $MailFromSub, $Region)
Write-Host ("  TXT    {0}  ->  `"v=spf1 include:amazonses.com ~all`"" -f $MailFromSub)
Write-Host "`nDMARC (recommended; start in monitor mode):" -ForegroundColor Yellow
Write-Host ("  TXT    _dmarc.{0}  ->  `"v=DMARC1; p=none; rua=mailto:dmarc@{0}; fo=1`"" -f $Domain)

Write-Section "Current SES verification status"
$verified = $identity.VerifiedForSendingStatus
$dkimStatus = $identity.DkimAttributes.Status
$mailFromStatus = $identity.MailFromAttributes.MailFromDomainStatus
Write-Host "  Domain verified for sending : $verified"
Write-Host "  DKIM status                 : $dkimStatus"
Write-Host "  MAIL FROM status            : $mailFromStatus"

if (-not $verified -or $dkimStatus -ne 'SUCCESS') {
  Write-Host "`nDomain not fully verified yet. Add the DNS records above, then re-run this script." -ForegroundColor Yellow
  Write-Host "DNS propagation + SES verification typically takes minutes to a few hours." -ForegroundColor Yellow
  return
}

Write-Section "Authorizing Cognito to send via SES identity"
$policy = @{
  Version   = '2008-10-17'
  Statement = @(@{
    Sid       = 'AllowCognitoToSend'
    Effect    = 'Allow'
    Principal = @{ Service = 'cognito-idp.amazonaws.com' }
    Action    = @('ses:SendEmail', 'ses:SendRawEmail')
    Resource  = $IdentityArn
    Condition = @{
      StringEquals = @{ 'aws:SourceAccount' = $Account }
      ArnLike      = @{ 'aws:SourceArn' = $UserPoolArn }
    }
  })
} | ConvertTo-Json -Depth 10 -Compress

$tmp = New-TemporaryFile
Set-Content -Path $tmp -Value $policy -Encoding utf8
aws sesv2 put-email-identity-policy --region $Region --email-identity $Domain `
  --policy-name 'CognitoSend' --policy "file://$tmp" | Out-Null
Remove-Item $tmp -Force
Write-Host "  Identity policy 'CognitoSend' applied to $IdentityArn" -ForegroundColor Green

Write-Section "SES sandbox / production access"
$account = aws sesv2 get-account --region $Region --output json | ConvertFrom-Json
if ($account.ProductionAccessEnabled) {
  Write-Host "  Production access: ENABLED (can email any recipient)." -ForegroundColor Green
} else {
  Write-Host "  Production access: DISABLED (sandbox) - can only email VERIFIED addresses." -ForegroundColor Yellow
  if ($RequestProductionAccess) {
    Write-Host "  Submitting production-access request..." -ForegroundColor Yellow
    aws sesv2 put-account-details --region $Region `
      --production-access-enabled `
      --mail-type TRANSACTIONAL `
      --website-url $WebsiteUrl `
      --use-case-description "Blyp sends one-time account verification codes and password reset codes to users who sign up in our mobile app. Transactional only; recipients are app users who explicitly requested the email. No marketing." `
      --additional-contact-email-addresses "safety@$Domain" `
      --contact-language EN | Out-Null
    Write-Host "  Request submitted. AWS usually responds within 24h." -ForegroundColor Green
  } else {
    Write-Host "  Re-run with -RequestProductionAccess to submit the exit-sandbox request." -ForegroundColor Yellow
  }
}

Write-Section "Final step: deploy the Cognito email config"
Write-Host "  The pool email settings are defined as code in:"
Write-Host "    amplify/backend/auth/369369369a1962b5f/override.ts"
Write-Host "  Deploy with:" -ForegroundColor Yellow
Write-Host "    amplify push --yes" -ForegroundColor White
Write-Host "`n  Verify afterwards with:" -ForegroundColor Yellow
Write-Host ("    aws cognito-idp describe-user-pool --user-pool-id {0} --region {1} --query UserPool.EmailConfiguration" -f $UserPoolId, $Region) -ForegroundColor White
Write-Host "`nDone." -ForegroundColor Green
