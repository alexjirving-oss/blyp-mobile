param(
  [Parameter(Mandatory = $true)]
  [string]$BuildId
)

$ErrorActionPreference = 'Stop'

function Get-EasBuildViewJson {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Id
  )

  # eas-cli 16.28 can write non-error progress to stderr; keep script strict overall,
  # but temporarily relax error handling to avoid PS treating stderr as terminating.
  $oldEap = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $raw = (eas build:view $Id --json 2>&1 | Out-String)
  } finally {
    $ErrorActionPreference = $oldEap
  }

  $idx = $raw.IndexOf('{')
  if ($idx -lt 0) {
    throw "BUILD_VIEW_NOT_JSON"
  }

  return ($raw.Substring($idx) | ConvertFrom-Json)
}

function Resolve-ArtifactUrl {
  param(
    [Parameter(Mandatory = $true)]
    $View
  )

  if ($View.artifacts -and $View.artifacts.buildUrl) { return $View.artifacts.buildUrl }
  if ($View.artifacts -and $View.artifacts.applicationArchiveUrl) { return $View.artifacts.applicationArchiveUrl }
  if ($View.artifactUrl) { return $View.artifactUrl }

  throw "NO_ARTIFACT_URL"
}

Write-Output "=== A) Get artifact URL from EAS (silent) ==="
$view = Get-EasBuildViewJson -Id $BuildId
$artifactUrl = Resolve-ArtifactUrl -View $view

$repoRoot = (Get-Location)
$artDir = Join-Path $repoRoot "artifacts"
New-Item -ItemType Directory -Force -Path $artDir | Out-Null

$aabPath = Join-Path $artDir ("blyp-mobile__production__{0}__{1}.aab" -f $BuildId, (Get-Date -Format 'yyyyMMdd_HHmmss'))

Write-Output "=== B) Download AAB (no URL printed) ==="
if (Test-Path $aabPath) { Remove-Item -Force -ErrorAction SilentlyContinue $aabPath }

# Keep output minimal (no URL printed). `--show-error` still surfaces failures.
& curl.exe --silent --show-error --location --fail --output $aabPath $artifactUrl

if (-not (Test-Path $aabPath)) { throw "DOWNLOAD_FAILED_NO_FILE" }
$aab = Get-Item $aabPath
Write-Output ("AAB={0}" -f $aab.FullName)
Write-Output ("AAB_BYTES={0}" -f $aab.Length)

# Quick corruption guard: ensure this is a readable zip.
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue | Out-Null
  $zip = [System.IO.Compression.ZipFile]::OpenRead($aab.FullName)
  $zip.Dispose()
} catch {
  throw "AAB_ZIP_INVALID"
}

Write-Output "=== C) Signing proof (jarsigner) ==="
if (-not (Get-Command jarsigner -ErrorAction SilentlyContinue)) {
  Write-Output "JARSIGNER_NOT_FOUND"
} else {
  $js = (jarsigner -verify -verbose -certs $aab.FullName 2>&1)
  $signedByMatch = ($js | Select-String -Pattern "^- Signed by" | Select-Object -First 1)
  $digestMatch = ($js | Select-String -Pattern "Digest algorithm:\\s*SHA-256" | Select-Object -Last 1)
  $verifiedMatch = ($js | Select-String -Pattern "jar verified\\." | Select-Object -Last 1)

  if ($signedByMatch) { Write-Output $signedByMatch.Line.Trim() }
  if ($digestMatch) { Write-Output $digestMatch.Line.Trim() }
  if ($verifiedMatch) { Write-Output $verifiedMatch.Line.Trim() }

  if (-not $signedByMatch -and -not $digestMatch -and -not $verifiedMatch) {
    $js | Select-Object -Last 40 | ForEach-Object { $_.ToString().Trim() }
  }
}

Write-Output "=== D) Manifest proof (bundletool) ==="
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  Write-Output "JAVA_NOT_FOUND"
  exit 0
}

$bundletool = Get-Item .\dist\bundletool.jar -ErrorAction SilentlyContinue
if (-not $bundletool) {
  $bundletool = Get-ChildItem -Recurse -Filter "bundletool*.jar" -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $bundletool) { throw "BUNDLETOOL_NOT_FOUND" }

$manifestXml = (java -jar $bundletool.FullName dump manifest --bundle $aab.FullName 2>&1 | Out-String)

$pkg = $null; $vc = $null; $vn = $null
if ($manifestXml -match 'package="([^"]+)"') { $pkg = $Matches[1] }
if ($manifestXml -match 'android:versionCode="([^"]+)"') { $vc = $Matches[1] }
if ($manifestXml -match 'android:versionName="([^"]+)"') { $vn = $Matches[1] }

if (-not $pkg -or -not $vc -or -not $vn) {
  throw "MANIFEST_PARSE_FAILED"
}

Write-Output ("package={0}" -f $pkg)
Write-Output ("versionCode={0}" -f $vc)
Write-Output ("versionName={0}" -f $vn)

Write-Output "=== DONE ==="
