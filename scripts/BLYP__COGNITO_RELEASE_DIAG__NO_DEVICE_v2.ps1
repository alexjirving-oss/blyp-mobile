param(
  [string]$AabPath = "",
  [string]$ExpectedPoolId = "",
  [string]$ExpectedClientId = "",
  [string]$ExpectedRegion = ""
)

$ErrorActionPreference='Stop'

function Info([string]$s){ Write-Output $s }
function Warn([string]$s){ Write-Output ("WARN: " + $s) }

function Read-TextBestEffort([string]$path){
  $bytes = [System.IO.File]::ReadAllBytes($path)
  try { return [System.Text.Encoding]::UTF8.GetString($bytes) } catch {}
  try { return [System.Text.Encoding]::Unicode.GetString($bytes) } catch {}
  return [System.Text.Encoding]::Latin1.GetString($bytes)
}

function Find-AllMatches([string]$text, [string]$pattern){
  $rx = [regex]::new($pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  $ms = $rx.Matches($text)
  $out = New-Object System.Collections.Generic.List[object]
  foreach($m in $ms){
    $out.Add([pscustomobject]@{ Value=$m.Value; Index=$m.Index; Length=$m.Length })
  }
  return $out
}

function Unique-Values($matches){
  return @($matches | Select-Object -ExpandProperty Value | Select-Object -Unique)
}

function Find-ValueNearKey([string]$text, [string[]]$keyPatterns, [string]$valuePattern, [int]$window=400){
  foreach($kp in $keyPatterns){
    $keys = Find-AllMatches $text $kp
    foreach($k in $keys){
      $start = [Math]::Max(0, $k.Index - 50)
      $end = [Math]::Min($text.Length, $k.Index + $window)
      $slice = $text.Substring($start, $end - $start)
      $vals = Find-AllMatches $slice $valuePattern
      if($vals.Count -gt 0){
        $best = $vals | Sort-Object @{Expression={ [Math]::Abs(($start + $_.Index) - $k.Index) }} | Select-Object -First 1
        return $best.Value
      }
    }
  }
  return $null
}

function Try-Read-AppConfigExpected(){
  $p = Join-Path (Get-Location) "app.config.js"
  if(!(Test-Path $p)){ return $null }
  $t = Get-Content $p -Raw
  $pool = $null; $client = $null; $region = $null

  $m = [regex]::Match($t, '(?i)\b[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]{6,}\b')
  if($m.Success){ $pool = $m.Value; $region = ($pool.Split('_')[0]) }

  $m2 = [regex]::Match($t, '(?i)\b[a-z0-9]{18,40}\b')
  if($m2.Success){ $client = $m2.Value }

  return [pscustomobject]@{ pool=$pool; client=$client; region=$region; source="app.config.js (best-effort regex)" }
}

function Probe-Cognito([string]$region, [string]$clientId){
  $out = New-Object System.Collections.Generic.List[string]

  if(!$region -or !$clientId){ $out.Add("PROBE_SKIPPED: missing region/clientId"); return $out }

  $endpoint = "https://cognito-idp.$region.amazonaws.com/"

  $headers = @{
    "Content-Type"="application/x-amz-json-1.1"
    "X-Amz-Target"="AWSCognitoIdentityProviderService.SignUp"
  }

  $payload = @{
    ClientId = $clientId
    Username = ("probe_"+[Guid]::NewGuid().ToString("N")+"@example.com")
    Password = "Badpass1"  # intentionally invalid (too short/weak) to avoid any real signup
  } | ConvertTo-Json -Depth 6

  try{
    Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -Body $payload | Out-Null
    $out.Add("SIGNUP_UNEXPECTED_SUCCESS=true")
  } catch {
    $resp = $_.Exception.Response
    $body = $null
    try{
      if($resp -and $resp.GetResponseStream()){
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $body = $sr.ReadToEnd()
      }
    } catch {}
    $out.Add("SIGNUP_HTTP_FAILED=true")
    if($body){
      $out.Add("SIGNUP_ERROR_BODY="+$body)
    } else {
      $out.Add("SIGNUP_ERROR_MESSAGE="+$_.Exception.Message)
    }
  }

  $headers2 = @{
    "Content-Type"="application/x-amz-json-1.1"
    "X-Amz-Target"="AWSCognitoIdentityProviderService.InitiateAuth"
  }
  $payload2 = @{
    AuthFlow = "USER_PASSWORD_AUTH"
    ClientId = $clientId
    AuthParameters = @{
      USERNAME = "probe@example.com"
      PASSWORD = "DefinitelyNotTheRightPassword123!"
    }
  } | ConvertTo-Json -Depth 6

  try{
    Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers2 -Body $payload2 | Out-Null
    $out.Add("AUTH_UNEXPECTED_SUCCESS=true")
  } catch {
    $resp = $_.Exception.Response
    $body = $null
    try{
      if($resp -and $resp.GetResponseStream()){
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $body = $sr.ReadToEnd()
      }
    } catch {}
    $out.Add("AUTH_HTTP_FAILED=true")
    if($body){
      $out.Add("AUTH_ERROR_BODY="+$body)
    } else {
      $out.Add("AUTH_ERROR_MESSAGE="+$_.Exception.Message)
    }
  }

  return $out
}

# ---- Locate AAB ----
if(!$AabPath){
  $cand = Get-ChildItem -Path (Join-Path (Get-Location) "artifacts") -Filter "*.aab" -File -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if(!$cand){ throw "NO_AAB_FOUND_IN_ARTIFACTS" }
  $AabPath = $cand.FullName
}
if(!(Test-Path $AabPath)){ throw "MISSING_AAB: $AabPath" }

Info "AAB=$AabPath"

# ---- Extract bundle from AAB ----
$tmpZip = Join-Path $env:TEMP ("blyp_"+[Guid]::NewGuid().ToString("N")+".zip")
Copy-Item $AabPath $tmpZip -Force
$tmpDir = Join-Path $env:TEMP ("blyp_aab_inspect_"+[Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force

$bundle = Get-ChildItem -Path $tmpDir -Recurse -Filter "index.android.bundle" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if(!$bundle){
  $bundle = Get-ChildItem -Path (Join-Path $tmpDir "base\assets") -Recurse -Include "*.bundle","*.jsbundle","index.*.bundle" -File -ErrorAction SilentlyContinue | Select-Object -First 1
}
if(!$bundle){ throw "BUNDLE_NOT_FOUND_IN_AAB: $tmpDir" }

Info ("BUNDLE="+$bundle.FullName)
Info ("BUNDLE_BYTES="+(Get-Item $bundle.FullName).Length)

$text = Read-TextBestEffort $bundle.FullName

# ---- Extract Cognito-ish values from bundle ----
$poolValPattern   = '\b[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]{6,}\b'
$clientValPattern = '\b[a-z0-9]{18,40}\b'

$poolKeys = @(
  'EXPO_PUBLIC_AWS_USER_POOL_ID',
  'aws_user_pools_id',
  'userPoolId',
  'cognitoUserPoolId',
  'USER_POOL_ID'
)

$clientKeys = @(
  'EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID',
  'aws_user_pools_web_client_id',
  'userPoolWebClientId',
  'webClientId',
  'appClientId',
  'ClientId'
)

$regionKeys = @(
  'EXPO_PUBLIC_AWS_REGION',
  'aws_cognito_region',
  'region'
)

$poolFromKey   = Find-ValueNearKey $text $poolKeys $poolValPattern 1200
$clientFromKey = Find-ValueNearKey $text $clientKeys $clientValPattern 2000
$regionFromKey = Find-ValueNearKey $text $regionKeys '\b[a-z]{2}-[a-z]+-\d\b' 800

$allPools   = Unique-Values (Find-AllMatches $text $poolValPattern)
$allClients = Unique-Values (Find-AllMatches $text $clientValPattern)

$allClients = @($allClients | Where-Object {
  $_ -match '^[a-z0-9]+$' -and $_.Length -ge 18 -and $_.Length -le 40
} | Select-Object -Unique)

Info "POOL_FROM_KEY=$poolFromKey"
Info "CLIENT_FROM_KEY=$clientFromKey"
Info "REGION_FROM_KEY=$regionFromKey"
Info ("ALL_POOL_IDS_COUNT="+$allPools.Count)
if($allPools.Count -gt 0){ Info ("ALL_POOL_IDS="+($allPools -join ",")) }

Info ("ALL_CLIENT_IDS_COUNT="+$allClients.Count)
if($allClients.Count -gt 0){
  $top = $allClients | Select-Object -First 15
  Info ("ALL_CLIENT_IDS_TOP15="+($top -join ","))
}

# ---- Choose effective values ----
$chosenPool   = $null
$chosenClient = $null
$chosenRegion = $null

if($ExpectedPoolId){ $chosenPool = $ExpectedPoolId }
elseif($poolFromKey){ $chosenPool = $poolFromKey }
elseif($allPools.Count -eq 1){ $chosenPool = $allPools[0] }

if($ExpectedClientId){ $chosenClient = $ExpectedClientId }
elseif($clientFromKey){ $chosenClient = $clientFromKey }
elseif($allClients.Count -eq 1){ $chosenClient = $allClients[0] }

if($ExpectedRegion){ $chosenRegion = $ExpectedRegion }
elseif($regionFromKey){ $chosenRegion = $regionFromKey }
elseif($chosenPool){ $chosenRegion = $chosenPool.Split('_')[0] }

if((!$chosenPool -or !$chosenClient -or !$chosenRegion)){
  $cfg = Try-Read-AppConfigExpected
  if($cfg){
    Info ("APP_CONFIG_FALLBACK_SOURCE="+$cfg.source)
    if(!$chosenPool -and $cfg.pool){ $chosenPool = $cfg.pool }
    if(!$chosenClient -and $cfg.client){ $chosenClient = $cfg.client }
    if(!$chosenRegion -and $cfg.region){ $chosenRegion = $cfg.region }
  }
}

Info ("CHOSEN_POOL_ID="+$chosenPool)
Info ("CHOSEN_CLIENT_ID="+$chosenClient)
Info ("CHOSEN_REGION="+$chosenRegion)

if(!$chosenClient -or !$chosenRegion){
  throw "CANNOT_PROBE: missing chosen clientId/region. Provide -ExpectedClientId and -ExpectedRegion."
}

Info "=== COGNITO_PROBE_BEGIN ==="
$probe = Probe-Cognito $chosenRegion $chosenClient
$probe | ForEach-Object { Info $_ }
Info "=== COGNITO_PROBE_END ==="

try { Remove-Item -Force $tmpZip -ErrorAction SilentlyContinue } catch {}
try { Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue } catch {}
