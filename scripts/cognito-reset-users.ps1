param(
  [Parameter(Mandatory=$true)][string]$Region,
  [Parameter(Mandatory=$true)][string]$UserPoolId
)

Write-Host "Cognito reset - Region: $Region, Pool: $UserPoolId" -ForegroundColor Cyan

# Ensure AWS CLI is available
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  Write-Host "AWS CLI not found. Please install and configure AWS CLI first." -ForegroundColor Red
  exit 1
}

# Verify credentials
try {
  $identity = aws sts get-caller-identity --region $Region --output json | ConvertFrom-Json
  if (-not $identity.Account) { throw 'No identity' }
  Write-Host "Using AWS Account: $($identity.Account)" -ForegroundColor Green
} catch {
  Write-Host "AWS CLI is not configured. Run: aws configure" -ForegroundColor Red
  exit 1
}

function Get-AllUsernames {
  param([string]$Region, [string]$UserPoolId)
  $all = @()
  $token = $null
  do {
    $args = @('cognito-idp','list-users','--region', $Region, '--user-pool-id', $UserPoolId, '--max-results','60','--output','json')
    if ($token) { $args += @('--starting-token', $token) }
    $resp = aws @args | ConvertFrom-Json
    if ($resp.Users) {
      $all += ($resp.Users | ForEach-Object { $_.Username })
    }
    $token = $resp.NextToken
  } while ($token)
  return $all | Where-Object { $_ } | Select-Object -Unique
}

$usernames = Get-AllUsernames -Region $Region -UserPoolId $UserPoolId
if (-not $usernames -or $usernames.Count -eq 0) {
  Write-Host "No users found in pool." -ForegroundColor Yellow
  exit 0
}

Write-Host "Deleting $($usernames.Count) users..." -ForegroundColor Yellow
$i = 0
foreach ($u in $usernames) {
  $i++
  Write-Host ("[{0}/{1}] {2}" -f $i, $usernames.Count, $u)
  try {
    aws cognito-idp admin-delete-user --region $Region --user-pool-id $UserPoolId --username $u | Out-Null
  } catch {
    Write-Host "Failed to delete $u: $_" -ForegroundColor Red
  }
}

Write-Host "Done. All users deleted from pool $UserPoolId." -ForegroundColor Green
