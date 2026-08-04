$ErrorActionPreference="Stop"

function Redact-Line([string]$line) {
  # Redact common secret keys while keeping structure for debugging
  $patterns = @(
    '(\bstorePassword\s*=\s*)(.*)$',
    '(\bkeyPassword\s*=\s*)(.*)$',
    '(\bpassword\b\s*[:=]\s*)(.*)$',
    '(\bPASSWORD\b\s*[:=]\s*)(.*)$',
    '(\bKEY_PASSWORD\b\s*[:=]\s*)(.*)$',
    '(\bSTORE_PASSWORD\b\s*[:=]\s*)(.*)$'
  )
  foreach ($pat in $patterns) {
    if ($line -match $pat) { return ($line -replace $pat, '$1REDACTED') }
  }
  return $line
}
function Print-File-Redacted([string]$path) {
  if (!(Test-Path $path)) { throw "MISSING_FILE: $path" }
  Get-Content $path -ErrorAction Stop | ForEach-Object { Redact-Line $_ }
}

function Get-LogMessages([string]$path) {
  if (!(Test-Path $path)) { throw "MISSING_FILE: $path" }
  foreach ($line in (Get-Content $path -ErrorAction Stop)) {
    try {
      $obj = $line | ConvertFrom-Json -ErrorAction Stop
      if ($null -ne $obj.msg) {
        [string]$obj.msg
      } else {
        [string]$line
      }
    } catch {
      [string]$line
    }
  }
}

Write-Output "=== 0) ROOT (path-proof) ==="
$root = (git rev-parse --show-toplevel).Trim()
if (-not $root) { throw "Not in a git repo (git rev-parse failed)." }
Write-Output ("REPO_ROOT=" + $root)

$easJson = Join-Path $root "eas.json"
$gradleProps = Join-Path $root "android\gradle.properties"
$buildGradle = Join-Path $root "android\app\build.gradle"

Write-Output "`n=== 1) SNAPSHOT ==="
git status -sb
git rev-parse HEAD
Write-Output ("NODE=" + (node -v))
Write-Output ("EAS=" + (eas --version))

Write-Output "`n=== 2) QUICK SECRET-KEY PRESENCE CHECK (no printing secrets) ==="
Write-Output ("gradle.properties EXISTS=" + (Test-Path $gradleProps))
if (Test-Path $gradleProps) {
  Write-Output ("HAS_PASSWORD_KEYS=" + (Select-String -Path $gradleProps -Pattern 'PASSWORD' -SimpleMatch -Quiet))
  Write-Output ("HAS_storePassword=" + (Select-String -Path $gradleProps -Pattern 'storePassword' -SimpleMatch -Quiet))
  Write-Output ("HAS_keyPassword=" + (Select-String -Path $gradleProps -Pattern 'keyPassword' -SimpleMatch -Quiet))
}

Write-Output "`n=== 3) SHOW ONLY RELEVANT DIFFS (NO SECRETS) ==="
git diff -- android\app\build.gradle android\gradle.properties eas.json |
  ForEach-Object { Redact-Line $_ }

Write-Output "`n=== 4) VERIFY eas.json IS VALID JSON ==="
node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log('eas.json OK')" $easJson

Write-Output "`n=== 5) PRINT eas.json (safe, but redacted anyway) ==="
Print-File-Redacted $easJson

Write-Output "`n=== 6) PRINT android\gradle.properties (redacted) ==="
Print-File-Redacted $gradleProps

Write-Output "`n=== 7) LATEST EAS ANDROID BUILD ID (JSON) ==="
$latestJson = (eas build:list --platform android --limit 1 --json --non-interactive | Out-String)
$buildId = ($latestJson | node -e "const fs=require('fs');const s=fs.readFileSync(0,'utf8');const j=JSON.parse(s);const arr=Array.isArray(j)?j:(j.builds||j.data||[]);process.stdout.write((arr[0]&&arr[0].id)||'');")
if (-not $buildId) { throw "Could not parse latest build id from eas build:list --json" }
Write-Output ("LATEST_BUILD_ID=" + $buildId)

Write-Output "`n=== 8) DOWNLOAD FULL LOGS LOCALLY ==="
New-Item -ItemType Directory -Force -Path (Join-Path $root "logs") | Out-Null
$logDir = Join-Path $root ("logs\eas_" + $buildId)
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# NOTE: Some EAS CLI versions don't have `eas build:logs` and `eas build:view` may print a prefix line before JSON.
$buildViewRaw = (eas build:view $buildId --json | Out-String)
$firstBrace = $buildViewRaw.IndexOf('{')
$lastBrace = $buildViewRaw.LastIndexOf('}')
if ($firstBrace -lt 0 -or $lastBrace -le $firstBrace) {
  throw "Could not locate JSON object in eas build:view output."
}
$buildViewJson = $buildViewRaw.Substring($firstBrace, ($lastBrace - $firstBrace + 1))

$logUrlsJson = ($buildViewJson | node -e "const fs=require('fs');const s=fs.readFileSync(0,'utf8');const j=JSON.parse(s);const urls=(j.logFiles||[]);process.stdout.write(JSON.stringify(urls));")
$logUrls = @()
try { $logUrls = $logUrlsJson | ConvertFrom-Json } catch { throw "Could not parse logFiles from build:view JSON." }

if (-not $logUrls -or $logUrls.Count -eq 0) {
  throw "No logFiles URLs found in build metadata."
}

Write-Output ("LOGFILES_COUNT=" + $logUrls.Count)

$downloaded = @()
$idx = 0
foreach ($u in $logUrls) {
  $idx++
  # Avoid printing signed URLs; keep filenames deterministic.
  $out = Join-Path $logDir ("log_{0:D2}.txt" -f $idx)
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $out | Out-Null
    $downloaded += $out
  } catch {
    throw ("Failed downloading log_{0:D2}.txt" -f $idx)
  }
}

$logPath = Join-Path $root ("logs\eas_android_" + $buildId + ".log")
Get-Content -Path $downloaded -ErrorAction Stop | Out-File -Encoding utf8 $logPath
Write-Output ("LOG_SAVED=" + $logPath)

Write-Output "`n=== 9) EXTRACT THE FIRST REAL FAILURE (sanitized) ==="
$msgs = @(Get-LogMessages $logPath)
$failureRegex = 'FAILURE: Build failed|\* What went wrong:|Execution failed for task|A problem occurred|Caused by:|contains AndroidX dependencies'
$firstIdx = -1
for ($i = 0; $i -lt $msgs.Count; $i++) {
  if ($msgs[$i] -match $failureRegex) { $firstIdx = $i; break }
}

if ($firstIdx -lt 0) {
  Write-Output "NO_FAILURE_MARKERS_FOUND"
} else {
  $from = [Math]::Max(0, $firstIdx - 5)
  $to = [Math]::Min($msgs.Count - 1, $firstIdx + 80)
  Write-Output ("FAILURE_CONTEXT_INDEXES {0}-{1} (match at {2})" -f $from, $to, $firstIdx)
  for ($j = $from; $j -le $to; $j++) {
    Redact-Line $msgs[$j]
  }
}

Write-Output "`n=== 10) TARGETED SIGNAL CHECKS ==="
$patterns = @(
  "Release signing is not configured",
  "BLYP_RELEASE",
  "keystore",
  ".jks",
  "AndroidX",
  "android.useAndroidX",
  "Jetifier",
  "android.enableJetifier",
  "hermesEnabled",
  "Could not get unknown property",
  "Duplicate class",
  "android.support"
)
foreach ($p in $patterns) {
  $hit = $msgs | Where-Object { $_ -like "*$p*" } | Select-Object -First 1
  $hit = [bool]$hit
  Write-Output ("LOG_HAS[{0}]={1}" -f $p, $hit)
}

Write-Output "`n=== 11) build.gradle SIGNING/HERMES/ANDROIDX LINES ONLY (safe) ==="
if (!(Test-Path $buildGradle)) { throw "MISSING_FILE: $buildGradle" }
$lines = Get-Content $buildGradle
for ($i=1; $i -le $lines.Count; $i++) {
  $line = $lines[$i-1]
  if ($line -match "signingConfigs|storeFile|storePassword|keyAlias|keyPassword|Release signing|BLYP_RELEASE|hermesEnabled|android.useAndroidX|Jetifier|useAndroidX") {
    "{0,4}: {1}" -f $i, (Redact-Line $line)
  }
}

Write-Output "`n=== 12) BOM / HIDDEN-CHAR CHECK (gradle.properties) ==="
$bytes=[System.IO.File]::ReadAllBytes($gradleProps)
$first16 = ($bytes[0..15] | ForEach-Object { '{0:X2}' -f $_ }) -join ' '
Write-Output ("FIRST16_HEX=" + $first16 + "  (UTF8_BOM is EF BB BF)")

Write-Output "`n=== 13) DUPLICATE PROPERTY CHECK (gradle.properties) ==="
$props=@{}
$ln=0
Get-Content $gradleProps | ForEach-Object {
  $ln++
  if ($_ -match '^\s*([^#][^=]+?)\s*=\s*(.*)\s*$') {
    $k=$matches[1].Trim()
    $v=$matches[2].Trim()
    if ($props.ContainsKey($k)) {
      Write-Output ("DUPLICATE_KEY line {0}: {1}={2} (prev {3})" -f $ln, $k, (Redact-Line "$k=$v").Split('=')[1], (Redact-Line "$k=$($props[$k])").Split('=')[1])
    } else {
      $props[$k]=$v
    }
  }
}

Write-Output "`n=== DONE ==="
Write-Output "PASTE BACK ONLY:"
Write-Output "A) Section 9 output"
Write-Output "B) Section 10 LOG_HAS block"
Write-Output "C) Section 3 diff block"

