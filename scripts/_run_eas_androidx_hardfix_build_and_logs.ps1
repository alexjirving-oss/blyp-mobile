$ErrorActionPreference='Stop'
Set-Location "C:\Users\Alex\Blyp26"

function Get-LogMessages([string]$path) {
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

Write-Output "=== 0) Snapshot ==="
git status -sb
(git rev-parse --short HEAD) | Write-Output
(git log -1 --oneline) | Write-Output
node -e "console.log('NODE',process.version)"

Write-Output "`n=== 1) PROVE what EAS will use (eas.json + config) ==="
if (!(Test-Path .\eas.json)) { throw "MISSING eas.json" }
Get-Content .\eas.json | Select-Object -First 120
try {
  eas config --non-interactive | Out-String -Width 220 | Select-Object -First 120 | Write-Output
} catch {
  Write-Output "WARN: eas config failed (non-fatal)."
}

Write-Output "`n=== 2) HARD-ENABLE AndroidX + Jetifier (android/gradle.properties) ==="
$gp = "C:\Users\Alex\Blyp26\android\gradle.properties"
if (!(Test-Path $gp)) { throw "MISSING: $gp" }
$orig = Get-Content $gp -Raw
$fixed = $orig

# Ensure explicit flags (append if missing; if present, force true)
if ($fixed -match '(?m)^\s*android\.useAndroidX\s*=') {
  $fixed = $fixed -replace '(?m)^\s*android\.useAndroidX\s*=.*$', 'android.useAndroidX=true'
} else {
  $fixed = $fixed.TrimEnd() + "`r`nandroid.useAndroidX=true`r`n"
}
if ($fixed -match '(?m)^\s*android\.enableJetifier\s*=') {
  $fixed = $fixed -replace '(?m)^\s*android\.enableJetifier\s*=.*$', 'android.enableJetifier=true'
} else {
  $fixed = $fixed.TrimEnd() + "`r`nandroid.enableJetifier=true`r`n"
}
if ($fixed -ne $orig) {
  Set-Content -Path $gp -Value $fixed -Encoding utf8
}

Write-Output "android/gradle.properties (relevant lines):"
Select-String -Path $gp -Pattern 'android.useAndroidX|android.enableJetifier' -SimpleMatch

Write-Output "`n=== 3) LOCAL sanity: Gradle sees AndroidX/Jetifier ==="
Set-Location "C:\Users\Alex\Blyp26\android"
.\gradlew.bat -q properties | Select-String -Pattern "android.useAndroidX|android.enableJetifier" -SimpleMatch | Select-Object -First 40 | Write-Output
Set-Location "C:\Users\Alex\Blyp26"

Write-Output "`n=== 4) Commit only AndroidX/Jetifier hard-fix ==="
# Ensure nothing else is staged
try { git reset | Out-Null } catch {}
# Sparse-checkout friendly add
try {
  git add --sparse -- android/gradle.properties
} catch {
  git add -- android/gradle.properties
}

git diff --cached -- android/gradle.properties | Write-Output

git commit -m "android: hard-enable AndroidX + Jetifier for EAS builds" --no-verify

Write-Output "`n=== 5) Kick production EAS build ==="
eas whoami --non-interactive | Write-Output
$buildOut = eas build -p android --profile production --non-interactive 2>&1 | Out-String
$buildOut | Write-Output
$buildId = ([regex]::Match($buildOut, '(?i)\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b')).Groups[1].Value
if (-not $buildId) { Write-Output "NO_BUILD_ID_FOUND_IN_OUTPUT"; exit 0 }
Write-Output ("BUILD_ID={0}" -f $buildId)

Write-Output "`n=== 6) Pull logs (via build:view --json logFiles) + show failure context fast ==="
$logDir="C:\Users\Alex\Blyp26\logs"; New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("eas_android_{0}.log" -f $buildId)

$buildViewRaw = (eas build:view $buildId --json | Out-String)
$firstBrace = $buildViewRaw.IndexOf('{')
$lastBrace = $buildViewRaw.LastIndexOf('}')
if ($firstBrace -lt 0 -or $lastBrace -le $firstBrace) {
  throw "Could not locate JSON object in eas build:view output."
}
$buildViewJson = $buildViewRaw.Substring($firstBrace, ($lastBrace - $firstBrace + 1))

$logUrlsJson = ($buildViewJson | node -e "const fs=require('fs');const s=fs.readFileSync(0,'utf8');const j=JSON.parse(s);process.stdout.write(JSON.stringify(j.logFiles||[]));")
$logUrls = $logUrlsJson | ConvertFrom-Json
if (-not $logUrls -or $logUrls.Count -eq 0) { throw "No logFiles URLs found in build metadata." }

$tmpDir = Join-Path $logDir ("eas_{0}" -f $buildId)
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$downloaded = @()
$idx = 0
foreach ($u in $logUrls) {
  $idx++
  $out = Join-Path $tmpDir ("log_{0:D2}.txt" -f $idx)
  Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $out | Out-Null
  $downloaded += $out
}

Get-Content -Path $downloaded -ErrorAction Stop | Out-File -Encoding utf8 $logPath
Write-Output ("LOG_PATH={0}" -f $logPath)
Write-Output ("LOG_BYTES={0}" -f (Get-Item $logPath).Length)

$msgs = @(Get-LogMessages $logPath)

Write-Output "`n--- First failure markers (top 60 lines) ---"
$failureRegex = 'FAILURE: Build failed|\* What went wrong:|Execution failed for task|A problem occurred|Caused by:|contains AndroidX dependencies'
$hits = $msgs | Where-Object { $_ -match $failureRegex } | Select-Object -First 60
$hits | ForEach-Object { $_ } | Write-Output

Write-Output "`n--- Prove RUN_GRADLEW line ---"
$msgs | Where-Object { $_ -like '*RUN_GRADLEW*' -or $_ -like '*gradlew*' } | Select-Object -First 40 | Write-Output

Write-Output "`n--- AndroidX / Jetifier signal ---"
foreach($p in @("AndroidX","android.useAndroidX","Jetifier","android.enableJetifier","android.support","Duplicate class")) {
  $has = $msgs | Where-Object { $_ -like "*$p*" } | Select-Object -First 1
  Write-Output ("LOG_HAS[{0}]={1}" -f $p, ([bool]$has))
}
