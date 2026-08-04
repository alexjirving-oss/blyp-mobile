Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
throw 'RELEASE_PATH_BLOCKED: Use tools\\release\\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <value>. This upload-key helper is non-canonical and blocked by release governance.'
$UPLOAD_KEYSTORE = "C:\Users\Alex\Blyp26\android\app\blyp-upload.jks"
$UPLOAD_KEY_ALIAS = "upload"

if(-not (Test-Path $UPLOAD_KEYSTORE)){ throw "UPLOAD_KEYSTORE_NOT_FOUND: $UPLOAD_KEYSTORE" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$root = "diagnostics\release_aab\UPLOAD_KEY_RESET_BUILD_$ts"
New-Item -ItemType Directory -Force -Path $root | Out-Null

function W($name, $lines){
  $p = Join-Path $root $name
  $lines | Out-File -Encoding utf8 $p
  return $p
}

# Secure prompts (no echo)
$storePass = Read-Host -AsSecureString "Enter KEYSTORE password"
$keyPass   = Read-Host -AsSecureString "Enter KEY password (often same as keystore password)"

function Unsecure([Security.SecureString]$s){
  $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$STORE_P = Unsecure $storePass
$KEY_P   = Unsecure $keyPass

W "00_summary.txt" @(
  "WHEN_UTC=$(Get-Date -Format o)"
  "UPLOAD_KEYSTORE=$UPLOAD_KEYSTORE"
  "UPLOAD_KEY_ALIAS=$UPLOAD_KEY_ALIAS"
)

# 1) Keystore SHA1 proof (no secrets written)
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$ksOut = & keytool -list -v -keystore "$UPLOAD_KEYSTORE" -alias "$UPLOAD_KEY_ALIAS" -storepass "$STORE_P" -keypass "$KEY_P" 2>&1
$ErrorActionPreference = $prevEAP
W "01_keytool_keystore_full.txt" $ksOut
$ksSha1Line = ($ksOut | Select-String -Pattern "SHA1:\s*" | Select-Object -First 1).Line
if(-not $ksSha1Line){ throw "FAILED_TO_EXTRACT_KEYSTORE_SHA1 (see 01_keytool_keystore_full.txt)" }
W "02_keytool_keystore_sha1.txt" @("KEYSTORE_$ksSha1Line")

# 2) Export signing env vars commonly used by your build scripts
$env:BLYP_RELEASE_STORE_FILE = $UPLOAD_KEYSTORE
$env:BLYP_RELEASE_KEY_ALIAS = $UPLOAD_KEY_ALIAS
$env:BLYP_RELEASE_STORE_PASSWORD = $STORE_P
$env:BLYP_RELEASE_KEY_PASSWORD = $KEY_P

$env:RELEASE_STORE_FILE = $UPLOAD_KEYSTORE
$env:RELEASE_KEY_ALIAS = $UPLOAD_KEY_ALIAS
$env:RELEASE_STORE_PASSWORD = $STORE_P
$env:RELEASE_KEY_PASSWORD = $KEY_P

W "03_signing_env_proof.txt" @(
  "BLYP_RELEASE_STORE_FILE=$($env:BLYP_RELEASE_STORE_FILE)"
  "BLYP_RELEASE_KEY_ALIAS=$($env:BLYP_RELEASE_KEY_ALIAS)"
  "RELEASE_STORE_FILE=$($env:RELEASE_STORE_FILE)"
  "RELEASE_KEY_ALIAS=$($env:RELEASE_KEY_ALIAS)"
  "NOTE=passwords not logged"
)

# 3) Build Release AAB
$env:NODE_ENV = "production"
$buildLog = Join-Path $root "04_gradle_build_log.txt"
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
cmd /c "cd /d android && gradlew.bat :app:bundleRelease --no-daemon --stacktrace" 2>&1 | Tee-Object -FilePath $buildLog | Out-Null
$ErrorActionPreference = $prevEAP

$aab = Get-ChildItem "android\app\build\outputs\bundle\release" -Filter "*.aab" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(-not $aab){ throw "AAB_NOT_FOUND under android\app\build\outputs\bundle\release" }
W "05_aab_path.txt" @("AAB_PATH=$($aab.FullName)")

# 4) Verify AAB signing cert SHA1
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$jsOut = & jarsigner -verify -verbose -certs "$($aab.FullName)" 2>&1
$ErrorActionPreference = $prevEAP
W "06_jarsigner_verify_full.txt" $jsOut
$jsSha1Line = ($jsOut | Select-String -Pattern "SHA1:" | Select-Object -First 1).Line
W "07_jarsigner_sha1.txt" @("AAB_$jsSha1Line")

function NormSha($line){
  if(-not $line){ return "" }
  $m = [regex]::Match($line, "([0-9A-Fa-f]{2}:){19}[0-9A-Fa-f]{2}")
  if($m.Success){ return $m.Value.ToUpper() } else { return "" }
}

$k = NormSha $ksSha1Line
$j = NormSha $jsSha1Line

$gate = @(
  "KEYSTORE_SHA1=$k"
  "AAB_SHA1=$j"
)
if($k -and $j -and ($k -eq $j)){
  $gate += "RESULT=PASS (AAB signed with Upload Key)"
} else {
  $gate += "RESULT=FAIL (AAB signing SHA1 mismatch - build.gradle not using these vars)"
}
W "08_gate_result.txt" $gate

Write-Output ("DONE_PACKET=" + (Resolve-Path $root).Path)
Write-Output ("UPLOAD_THIS_AAB=" + $aab.FullName)
Write-Output ("OPEN_PROOF=" + (Join-Path (Resolve-Path $root).Path "08_gate_result.txt"))
