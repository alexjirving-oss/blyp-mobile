# BLYP__COGNITO_RELEASE_DIAG__NO_DEVICE.ps1
# Goal: identify exact Cognito failure without adb/logcat.
# It does NOT create accounts (uses intentionally invalid creds).

Set-Location "C:\Users\Alex\Blyp26"
$ErrorActionPreference='Stop'

# ---- INPUT: point at the AAB you installed from Play ----
# If you already know the exact file, set it directly:
# $aab = "C:\Users\Alex\Blyp26\artifacts\blyp-mobile__production__33ceaf7c-c2d3-425f-b779-374cd1c7b0ea__20260116_124737.aab"
$aab = (Get-ChildItem -Path .\artifacts -Filter "*.aab" -Recurse | Sort-Object LastWriteTime -Desc | Select-Object -First 1).FullName
if (-not $aab) { throw "NO_AAB_FOUND_UNDER_artifacts" }
Write-Output ("AAB={0}" -f $aab)

# ---- 1) Extract bundled JS and auto-detect region + pool + clientId ----
$tmp = Join-Path $env:TEMP ("blyp_aab_diag_" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$zip = Join-Path $env:TEMP ("blyp_" + [Guid]::NewGuid().ToString('N') + ".zip")
Copy-Item $aab $zip -Force
Expand-Archive -Path $zip -DestinationPath $tmp -Force

$bundle = Join-Path $tmp "base\assets\index.android.bundle"
if (!(Test-Path $bundle)) { throw "BUNDLE_NOT_FOUND: $bundle" }

$text = [System.IO.File]::ReadAllText($bundle, [Text.Encoding]::UTF8)

# user pool ids look like: eu-west-2_XXXXXXXXX
$poolMatch = [regex]::Match($text, '\b([a-z]{2}-[a-z]+-\d)_[A-Za-z0-9]+\b')
$poolId = if ($poolMatch.Success) { $poolMatch.Value } else { $null }
$region = if ($poolId) { $poolId.Split('_')[0] } else { $null }

# app client id is usually 26-ish chars lower/num, but to avoid false positives:
# search near known amplify/cognito config keys first
$clientId = $null
$near = [regex]::Match($text, '(?s)(userPoolWebClientId|userPoolClientId|WebClientId|ClientId).{0,200}')
if ($near.Success) {
  $cid = [regex]::Match($near.Value, '\b[a-z0-9]{20,40}\b')
  if ($cid.Success) { $clientId = $cid.Value }
}
if (-not $clientId) {
  # fallback: first 20-40 len token (can still be wrong, but we’ll validate with Cognito)
  $cid2 = [regex]::Match($text, '\b[a-z0-9]{20,40}\b')
  if ($cid2.Success) { $clientId = $cid2.Value }
}

Write-Output ("DETECTED_region={0}" -f $region)
Write-Output ("DETECTED_userPoolId={0}" -f $poolId)
Write-Output ("DETECTED_appClientId={0}" -f $clientId)

if (-not $region -or -not $poolId -or -not $clientId) {
  Write-Output "FAIL: Could not reliably detect Cognito config from bundle."
  Write-Output "Next: grep your repo for EXPO_PUBLIC_AWS_USER_POOL / WEB_CLIENT_ID and paste values."
  exit 2
}

# ---- 2) Hit Cognito IdP with deliberate invalid creds to extract *real* error code ----
# NOTE: This never creates a user. It calls SignUp with an intentionally invalid password.
function Invoke-CognitoJson($region, $target, $bodyObj) {
  $uri = "https://cognito-idp.$region.amazonaws.com/"
  $json = ($bodyObj | ConvertTo-Json -Depth 6 -Compress)
  try {
    return Invoke-WebRequest -Method POST -Uri $uri -ContentType "application/x-amz-json-1.1" `
      -Headers @{ "X-Amz-Target"=$target } -Body $json -UseBasicParsing
  } catch {
    # return the response body + status if present
    $resp = $_.Exception.Response
    if ($resp) {
      $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $body = $sr.ReadToEnd()
      return [pscustomobject]@{
        StatusCode = [int]$resp.StatusCode
        Body = $body
      }
    }
    return [pscustomobject]@{ StatusCode = -1; Body = $_.Exception.Message }
  }
}

$email = ("diag_{0}@example.com" -f ([Guid]::NewGuid().ToString('N').Substring(0,8)))
$badPw = "bad" # intentionally invalid to force deterministic error paths

Write-Output "=== Cognito SignUp probe (expecting an error; we want the code/message) ==="
$signupBody = @{
  ClientId = $clientId
  Username = $email
  Password = $badPw
  UserAttributes = @(@{ Name="email"; Value=$email })
}
$signup = Invoke-CognitoJson -region $region -target "AWSCognitoIdentityProviderService.SignUp" -bodyObj $signupBody

if ($signup.PSObject.Properties.Name -contains "Body") {
  Write-Output ("HTTP_STATUS={0}" -f $signup.StatusCode)
  Write-Output ("RAW_BODY={0}" -f $signup.Body)
} else {
  Write-Output ("HTTP_STATUS={0}" -f $signup.StatusCode)
  $b = $signup.Content
  Write-Output ("RAW_BODY={0}" -f $b)
}

Write-Output "=== Interpret (fast) ==="
$raw = if ($signup.PSObject.Properties.Name -contains "Body") { $signup.Body } else { $signup.Content }
$etype = $null
try { $etype = ((ConvertFrom-Json $raw)."__type") } catch { }
if ($etype) { Write-Output ("ERROR_TYPE={0}" -f $etype) }

if ($raw -match "NotAuthorizedException" -or $raw -match "SECRET_HASH") {
  Write-Output "ROOT_CAUSE=APP_CLIENT_HAS_SECRET_OR_SECRET_HASH_REQUIRED"
  Write-Output "FIX=Create a NEW Cognito App Client with NO client secret (public client), update EXPO_PUBLIC_* to that clientId, rebuild."
} elseif ($raw -match "InvalidParameterException" -and $raw -match "password") {
  Write-Output "ROOT_CAUSE=CONFIG_IS_VALID (we reached Cognito); UI error in app likely masking different call (ConfirmSignUp/InitiateAuth)."
  Write-Output "NEXT=Run InitiateAuth probe below to test login path."
} elseif ($raw -match "InvalidParameterException" -and $raw -match "ClientId") {
  Write-Output "ROOT_CAUSE=WRONG_APP_CLIENT_ID_IN_RELEASE"
  Write-Output "FIX=Release build is inlining stale EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID; fix env injection for EAS production and rebuild."
} elseif ($raw -match "ResourceNotFoundException") {
  Write-Output "ROOT_CAUSE=WRONG_REGION_OR_POOL"
  Write-Output "FIX=Release build points at wrong region/pool. Align EXPO_PUBLIC_AWS_USER_POOL_ID to the correct pool and rebuild."
} elseif ($raw -match "SignUp is not permitted|SignUp not permitted|SelfSignUp") {
  Write-Output "ROOT_CAUSE=SELF_SIGN_UP_DISABLED"
  Write-Output "FIX=Enable self sign-up in the User Pool (or implement admin-create-user flow)."
} else {
  Write-Output "ROOT_CAUSE=UNKNOWN_FROM_SIGNUP_PROBE"
  Write-Output "NEXT=Run InitiateAuth probe now (login path)."
}

Write-Output "=== Cognito InitiateAuth probe (login) ==="
$authBody = @{
  AuthFlow = "USER_PASSWORD_AUTH"
  ClientId = $clientId
  AuthParameters = @{
    USERNAME = $email
    PASSWORD = "DefinitelyWrongPassword123!"
  }
}
$auth = Invoke-CognitoJson -region $region -target "AWSCognitoIdentityProviderService.InitiateAuth" -bodyObj $authBody
if ($auth.PSObject.Properties.Name -contains "Body") {
  Write-Output ("HTTP_STATUS={0}" -f $auth.StatusCode)
  Write-Output ("RAW_BODY={0}" -f $auth.Body)
} else {
  Write-Output ("HTTP_STATUS={0}" -f $auth.StatusCode)
  Write-Output ("RAW_BODY={0}" -f $auth.Content)
}

Write-Output "=== CLEANUP ==="
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Remove-Item -Force $zip -ErrorAction SilentlyContinue
Write-Output "DONE"
