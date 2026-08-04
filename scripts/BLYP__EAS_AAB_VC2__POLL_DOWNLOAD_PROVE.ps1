param(
  [Parameter(Mandatory = $false)]
  [string]$BuildId = "b92c429d-29a5-475a-9c1a-ce0e68422b74",

  [Parameter(Mandatory = $false)]
  [int]$MaxMinutes = 35
)

Set-Location "C:\Users\Alex\Blyp26"
$ErrorActionPreference = 'Stop'

Write-Output "=== 0) Local proof: versionCode/versionName sources ==="
Write-Output "--- app.config.js (versionCode/versionName hints) ---"
if (Test-Path .\app.config.js) {
  Select-String -Path .\app.config.js -Pattern "versionCode|versionName|version:\s*|android\s*:" -CaseSensitive:$false |
    Select-Object -First 60 |
    ForEach-Object { $_.Line }
} else {
  Write-Output "NO_app.config.js"
}

Write-Output "--- android/app/build.gradle (versionCode/versionName lines) ---"
Select-String -Path .\android\app\build.gradle -Pattern "versionCode|versionName" -CaseSensitive:$false |
  Select-Object -First 80 |
  ForEach-Object { $_.Line }

Write-Output "--- eas.json (appVersionSource) ---"
if (Test-Path .\eas.json) {
  Select-String -Path .\eas.json -Pattern "appVersionSource" -CaseSensitive:$false |
    Select-Object -First 20 |
    ForEach-Object { $_.Line }
} else {
  Write-Output "NO_eas.json"
}

function Get-ViewJson([string]$id) {
  # eas-cli 16.x can write progress to stderr which PowerShell treats as an error record under EAP=Stop.
  # Keep script strict overall, but relax around the CLI call and parse JSON out of combined streams.
  $oldEap = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $raw = (eas build:view $id --json 2>&1 | Out-String)
  } finally {
    $ErrorActionPreference = $oldEap
  }

  $idx = $raw.IndexOf('{')
  if ($idx -lt 0) { throw "BUILD_VIEW_NOT_JSON" }
  return ($raw.Substring($idx) | ConvertFrom-Json)
}

Write-Output "=== 1) Poll EAS until build FINISHED (or FAILED) ==="
$deadline = (Get-Date).AddMinutes($MaxMinutes)

while ($true) {
  $v = Get-ViewJson $BuildId
  $status = $v.status
  Write-Output ("STATUS={0}  UPDATED={1}" -f $status, (Get-Date).ToString("s"))

  if ($status -in @('FINISHED','ERRORED','CANCELED')) { break }
  if ((Get-Date) -gt $deadline) { throw "TIMEOUT_WAITING_FOR_BUILD" }
  Start-Sleep -Seconds 20
}

if ($status -ne 'FINISHED') {
  Write-Output ("BUILD_NOT_FINISHED_STATUS={0}" -f $status)
  exit 2
}

Write-Output "=== 2) Download AAB silently (no URL printed) ==="
$artifactUrl = $null
if ($v.artifacts -and $v.artifacts.buildUrl) { $artifactUrl = $v.artifacts.buildUrl }
elseif ($v.artifacts -and $v.artifacts.applicationArchiveUrl) { $artifactUrl = $v.artifacts.applicationArchiveUrl }
elseif ($v.artifactUrl) { $artifactUrl = $v.artifactUrl }
if (-not $artifactUrl) { throw "NO_ARTIFACT_URL" }

$artDir = Join-Path (Get-Location) "artifacts"
New-Item -ItemType Directory -Force -Path $artDir | Out-Null

# Always write to a fresh file to avoid reusing a truncated/corrupt download.
$aabPath = Join-Path $artDir ("blyp-mobile__production__{0}__{1}.aab" -f $BuildId, (Get-Date -Format 'yyyyMMdd_HHmmss'))

& curl.exe --silent --show-error --location --fail --output $aabPath $artifactUrl
if (-not (Test-Path $aabPath)) { throw "DOWNLOAD_FAILED_NO_FILE" }

$aab = Get-Item $aabPath
Write-Output ("AAB={0}" -f $aab.FullName)
Write-Output ("AAB_BYTES={0}" -f $aab.Length)

# ZIP sanity check (Play Console rejects malformed zips)
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue | Out-Null
  $zip = [System.IO.Compression.ZipFile]::OpenRead($aab.FullName)
  $zip.Dispose()
} catch {
  throw "AAB_ZIP_INVALID"
}

Write-Output "=== 3) Prove signing (jarsigner) ==="
if (-not (Get-Command jarsigner -ErrorAction SilentlyContinue)) {
  Write-Output "JARSIGNER_NOT_FOUND"
} else {
  $js = (jarsigner -verify -verbose -certs $aab.FullName 2>&1)
  $signedBy = ($js | Select-String -Pattern "^- Signed by" | Select-Object -First 1)
  $digest = ($js | Select-String -Pattern "Digest algorithm:\\s*SHA-256" | Select-Object -Last 1)
  $verified = ($js | Select-String -Pattern "jar verified\\." | Select-Object -Last 1)

  if ($signedBy) { Write-Output $signedBy.Line.Trim() }
  if ($digest) { Write-Output $digest.Line.Trim() }
  if ($verified) { Write-Output $verified.Line.Trim() }

  if (-not $signedBy -and -not $digest -and -not $verified) {
    $js | Select-Object -Last 60 | ForEach-Object { $_.ToString().Trim() }
  }
}

Write-Output "=== 4) Prove manifest package/versionCode/versionName (bundletool) ==="
if (-not (Get-Command java -ErrorAction SilentlyContinue)) { Write-Output "JAVA_NOT_FOUND"; exit 0 }

$bundletool = Get-Item .\dist\bundletool.jar -ErrorAction SilentlyContinue
if (-not $bundletool) { $bundletool = Get-ChildItem -Recurse -Filter "bundletool*.jar" -ErrorAction SilentlyContinue | Select-Object -First 1 }
if (-not $bundletool) { throw "BUNDLETOOL_NOT_FOUND" }

$manifestXml = (java -jar $bundletool.FullName dump manifest --bundle $aab.FullName 2>&1 | Out-String)

$pkg=$null; $vc=$null; $vn=$null
if ($manifestXml -match 'package="([^"]+)"') { $pkg=$Matches[1] }
if ($manifestXml -match 'android:versionCode="([^"]+)"') { $vc=$Matches[1] }
if ($manifestXml -match 'android:versionName="([^"]+)"') { $vn=$Matches[1] }

if (-not $pkg -or -not $vc -or -not $vn) { throw "MANIFEST_PARSE_FAILED" }

Write-Output ("package={0}" -f $pkg)
Write-Output ("versionCode={0}" -f $vc)
Write-Output ("versionName={0}" -f $vn)

Write-Output "=== DONE ==="
