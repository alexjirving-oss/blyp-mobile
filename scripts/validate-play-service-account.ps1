[CmdletBinding()]
param(
  [string]$Path = "./android-service-account.json"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) {
  throw "Missing required file: $Path`nExpected location: repo root (./android-service-account.json)"
}

$jsonRaw = Get-Content -LiteralPath $Path -Raw
try {
  $obj = $jsonRaw | ConvertFrom-Json
} catch {
  throw "File exists but is not valid JSON: $Path"
}

$required = @('type','project_id','private_key_id','private_key','client_email','client_id')
$missing = @()
foreach ($k in $required) {
  if (-not ($obj.PSObject.Properties.Name -contains $k) -or [string]::IsNullOrWhiteSpace([string]$obj.$k)) {
    $missing += $k
  }
}

if ($missing.Count -gt 0) {
  throw "android-service-account.json is missing required fields: $($missing -join ', ')"
}

if ($obj.type -ne 'service_account') {
  throw "Unexpected type '$($obj.type)'. Expected 'service_account'."
}

if ($obj.private_key -notmatch 'BEGIN PRIVATE KEY') {
  throw "private_key does not look like a PEM key. (Expected to contain 'BEGIN PRIVATE KEY'.)"
}

Write-Host "OK: android-service-account.json looks valid." -ForegroundColor Green
Write-Host ("Service account: {0}" -f $obj.client_email)
Write-Host ("Project:        {0}" -f $obj.project_id)
