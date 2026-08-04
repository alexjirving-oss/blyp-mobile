# ==============================================================
# VS CODE AGENT COMMAND — RECONCILE_FIRESTORE_USERS_TO_COGNITO_V1
#
# DEFAULT: DRY RUN ONLY
# TO APPLY CHANGES:
#   $env:BLYP_APPLY_USER_RECON="YES_APPLY"
#
# WHAT IT DOES:
#   - Reads Cognito users from eu-west-2_XUqSwhnMU
#   - Reads Firestore users collection (REST via gcloud token)
#   - Plans + (optionally) applies:
#       A) Ensure users/{sub} exists and has email from Cognito
#       B) Merge+delete Firestore docs whose email belongs to a different sub
#       C) Delete vanity/orphan docs whose id is not a Cognito sub and has no valid mapping
#
# OUTPUT:
#   diagnostics\state\USER_RECON_<ts>\01_report.json
# ==============================================================

$ErrorActionPreference="Stop"
Set-Location C:\Users\Alex\Blyp26

function NowTs(){ Get-Date -Format "yyyyMMdd_HHmmss" }
$ts = NowTs
$root = "diagnostics\state\USER_RECON_$ts"
New-Item -ItemType Directory -Force -Path $root | Out-Null
function W([string]$name, [string]$content){ $p = Join-Path $root $name; $content | Out-File -Encoding utf8 $p; $p }

$APPLY = ($env:BLYP_APPLY_USER_RECON -eq "YES_APPLY")

$userPoolId = "eu-west-2_XUqSwhnMU"
$region = "eu-west-2"
$projectId = "blyp-master"

# --- Get gcloud token for Firestore REST
$token = (cmd /c "gcloud auth print-access-token 2>NUL").Trim()
if(-not ($token -match "^ya29\.")){ throw "GCLOUD_AUTH_TOKEN_INVALID" }

# --- Pull Cognito users (limit 60 is enough for your test pool)
$resp = cmd /c "aws cognito-idp list-users --user-pool-id $userPoolId --region $region --limit 60 --output json 2>&1"
$cobj = ($resp -join "`n" | ConvertFrom-Json)

# Build map: email -> sub, sub -> email
$cUsers = @()
foreach($u in $cobj.Users){
  $attrs = @{}; foreach($a in $u.Attributes){ $attrs[$a.Name] = $a.Value }
  $cUsers += [PSCustomObject]@{
    sub = $attrs["sub"]
    email = $attrs["email"]
    preferred_username = $attrs["preferred_username"]
    status = $u.UserStatus
    enabled = $u.Enabled
  }
}

# --- Firestore list users docs (pageSize 200)
$fsHeaders = @{ Authorization = "Bearer $token" }
$fsObj = Invoke-RestMethod -Uri "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/users?pageSize=200" -Headers $fsHeaders
$docs = @()
if($fsObj.documents){
  foreach($d in $fsObj.documents){
    $id = $d.name -replace '.*/users/',''
    $f = $d.fields
    $getS = { param($k) if($f.$k){ $f.$k.stringValue } else { "" } }
    $docs += [PSCustomObject]@{
      id = $id
      displayName = & $getS "displayName"
      username = & $getS "username"
      handle = & $getS "handle"
      email = & $getS "email"
      # keep raw for merge (best-effort)
      raw = $d
    }
  }
}

# --- Build indexes
$emailToSub = @{}
$subSet = New-Object System.Collections.Generic.HashSet[string]
foreach($u in $cUsers){
  if($u.email){ $emailToSub[$u.email.ToLower()] = $u.sub }
  if($u.sub){ [void]$subSet.Add($u.sub) }
}

# --- Plan operations
$ops = @()

# A) Ensure canonical docs exist for every Cognito sub and have email
foreach($u in $cUsers){
  if(-not $u.sub){ continue }
  $existing = $docs | Where-Object { $_.id -eq $u.sub } | Select-Object -First 1
  if(-not $existing){
    $ops += [PSCustomObject]@{ op="CREATE_CANON"; id=$u.sub; email=$u.email; note="Create users/{sub} from Cognito" }
  } elseif(-not $existing.email){
    $ops += [PSCustomObject]@{ op="FILL_EMAIL"; id=$u.sub; email=$u.email; note="Set email on users/{sub}" }
  }
}

# B) Any Firestore doc with email that maps to a different Cognito sub => MERGE then DELETE wrong doc
foreach($d in $docs){
  if(-not $d.email){ continue }
  $key = $d.email.ToLower()
  if($emailToSub.ContainsKey($key)){
    $canonSub = $emailToSub[$key]
    if($d.id -ne $canonSub){
      $ops += [PSCustomObject]@{ op="MERGE_TO_CANON"; from=$d.id; to=$canonSub; email=$d.email; note="Doc id != Cognito sub for this email" }
      $ops += [PSCustomObject]@{ op="DELETE_DOC"; id=$d.id; email=$d.email; note="Delete non-canonical duplicate after merge" }
    }
  }
}

# C) Orphan/vanity docs: id not a Cognito sub AND no email => delete
foreach($d in $docs){
  if($subSet.Contains($d.id)){ continue }
  if(-not $d.email){
    $ops += [PSCustomObject]@{ op="DELETE_DOC"; id=$d.id; note="Orphan/vanity Firestore user doc (not a Cognito sub, no email)" }
  }
}

# --- Write dry-run plan
$report = [ordered]@{
  APPLY = $APPLY
  cognitoUserCount = $cUsers.Count
  firestoreDocCount = $docs.Count
  opsCount = $ops.Count
  ops = $ops
}
W "01_report.json" (($report | ConvertTo-Json -Depth 9))

Write-Host ""
Write-Host "DRY RUN PLAN WRITTEN:"
Write-Host "  $root\01_report.json"
Write-Host "APPLY=$APPLY"

if(-not $APPLY){
  Write-Host ""
  Write-Host "To APPLY, run:"
  Write-Host '$env:BLYP_APPLY_USER_RECON="YES_APPLY"'
  exit 0
}

# ==============================================================
# APPLY MODE (uses Firestore REST PATCH/DELETE; merge is best-effort shallow merge)
# ==============================================================

function Invoke-FS([string]$method,[string]$url,[string]$body){
  $h = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
  if($body){
    Invoke-RestMethod -Method $method -Uri $url -Headers $h -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType "application/json"
  } else {
    Invoke-RestMethod -Method $method -Uri $url -Headers $h
  }
}

function Get-FSDoc([string]$id){
  $u = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/users/$id"
  $h = @{ Authorization = "Bearer $token" }
  Invoke-RestMethod -Uri $u -Headers $h
}

function Patch-FSDoc([string]$id, [hashtable]$stringFields){
  # build minimal fields payload
  $fields = @{}
  foreach($k in $stringFields.Keys){
    $fields[$k] = @{ stringValue = [string]$stringFields[$k] }
  }
  $payload = @{ fields = $fields } | ConvertTo-Json -Depth 6
  $mask = ($stringFields.Keys | ForEach-Object { "updateMask.fieldPaths=$_" }) -join "&"
  $u = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/users/${id}?${mask}"
  $h = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
  Invoke-RestMethod -Method PATCH -Uri $u -Headers $h -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) -ContentType "application/json"
}

function Delete-FSDoc([string]$id){
  $u = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/users/$id"
  $h = @{ Authorization = "Bearer $token" }
  Invoke-RestMethod -Method DELETE -Uri $u -Headers $h
}

$applied = @()

foreach($op in $ops){
  try{
    if($op.op -eq "CREATE_CANON"){
      # create minimal canonical doc with email + sub
      $r = Patch-FSDoc $op.id @{ email=$op.email; sub=$op.id; cognitoSub=$op.id }
      $applied += "CREATE_CANON id=$($op.id)"
    }
    elseif($op.op -eq "FILL_EMAIL"){
      $r = Patch-FSDoc $op.id @{ email=$op.email }
      $applied += "FILL_EMAIL id=$($op.id)"
    }
    elseif($op.op -eq "MERGE_TO_CANON"){
      $fromDoc = Get-FSDoc $op.from
      # best-effort shallow merge of common string fields
      $merge = @{}
      foreach($k in @("displayName","username","handle","photoURL","bio","status")){
        if($fromDoc.fields.$k.stringValue){ $merge[$k] = $fromDoc.fields.$k.stringValue }
      }
      $merge["email"] = $op.email
      $merge["sub"] = $op.to
      $merge["cognitoSub"] = $op.to
      if($merge.Keys.Count -gt 0){
        $r = Patch-FSDoc $op.to $merge
      }
      $applied += "MERGE_TO_CANON from=$($op.from) to=$($op.to)"
    }
    elseif($op.op -eq "DELETE_DOC"){
      $r = Delete-FSDoc $op.id
      $applied += "DELETE_DOC id=$($op.id)"
    }
  } catch {
    $applied += "FAIL op=$($op.op) msg=$($_.Exception.Message)"
  }
}

W "02_applied.txt" ($applied -join "`r`n") | Out-Null
Write-Host ""
Write-Host "APPLY COMPLETE. See:"
Write-Host "  $root\02_applied.txt"
