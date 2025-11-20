param(
  [string]$Region = "eu-west-2",
  [string]$UserPoolId
)

Write-Host "AWS Setup + Cognito Reset" -ForegroundColor Cyan

# Ensure AWS CLI
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  Write-Host "Installing AWS CLI..." -ForegroundColor Yellow
  winget install --source winget --exact --id Amazon.AWSCLI --accept-package-agreements --accept-source-agreements
}

# Attempt to locate default install path if PATH isn't updated yet
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  $awsDir = "C:\Program Files\Amazon\AWSCLIV2"
  if (Test-Path (Join-Path $awsDir 'aws.exe')) {
    $env:Path = "$awsDir;$env:Path"
  }
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  Write-Host "AWS CLI not found after install. Aborting." -ForegroundColor Red
  exit 1
}

# Configure region
aws configure set region $Region | Out-Null

# Prompt for credentials if not configured
function Test-Creds {
  try {
    $id = aws sts get-caller-identity --output json | ConvertFrom-Json
    return [bool]$id.Account
  } catch { return $false }
}

if (-not (Test-Creds)) {
  Write-Host "Enter your AWS credentials (stored in your user profile)." -ForegroundColor Yellow
  $accessKey = Read-Host "AWS Access Key ID"
  $secretKey = Read-Host "AWS Secret Access Key"
  if (-not $accessKey -or -not $secretKey) {
    Write-Host "Missing credentials. Aborting." -ForegroundColor Red
    exit 1
  }
  aws configure set aws_access_key_id $accessKey | Out-Null
  aws configure set aws_secret_access_key $secretKey | Out-Null
}

if (-not (Test-Creds)) {
  Write-Host "Credentials invalid. Please run 'aws configure' and try again." -ForegroundColor Red
  exit 1
}

Write-Host "AWS CLI configured. Region: $Region" -ForegroundColor Green

if ($UserPoolId) {
  $script = Join-Path $PSScriptRoot 'cognito-reset-users.ps1'
  if (Test-Path $script) {
    & $script -Region $Region -UserPoolId $UserPoolId
  } else {
    Write-Host "Reset script not found at $script" -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "No UserPoolId provided. Skipping user deletion." -ForegroundColor Yellow
}

Write-Host "Setup complete." -ForegroundColor Green
