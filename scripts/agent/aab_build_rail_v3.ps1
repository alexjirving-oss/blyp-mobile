Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
throw 'RELEASE_PATH_BLOCKED: Use tools\\release\\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <value>. This legacy AAB rail is non-canonical and blocked by release governance.'

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function WriteNoBom([string]$path, [string]$content) {
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function W([string]$path, [string[]]$lines) {
    WriteNoBom $path ($lines -join "`r`n")
    $path
}

function ReadText([string]$path) {
    Get-Content -Raw -LiteralPath $path -ErrorAction Stop
}

function Rel([string]$path) {
    try { (Resolve-Path $path).Path.Replace((Get-Location).Path + "\", "") } catch { $path }
}

function FileUrl([string]$path) {
    $abs = if (Test-Path $path) { (Resolve-Path $path).Path } else { [System.IO.Path]::GetFullPath($path) }
    $full = $abs -replace "\\", "/"
    "file:///$full"
}

# Run gradlew.bat safely via cmd.exe, capture stdout+stderr to one log
function RunGradle([string]$androidDir, [string]$gradleArgs, [string]$logPath) {
    $outPath = $logPath + ".stdout.txt"
    $errPath = $logPath + ".stderr.txt"
    $cmdExe  = "cmd.exe"
    $cmdArgs = "/c `"gradlew.bat $gradleArgs`""
    $p = Start-Process -FilePath $cmdExe -ArgumentList $cmdArgs `
        -WorkingDirectory $androidDir -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $outPath -RedirectStandardError $errPath
    $o = if (Test-Path $outPath) { Get-Content -Raw $outPath } else { "" }
    $e = if (Test-Path $errPath) { Get-Content -Raw $errPath } else { "" }
    WriteNoBom $logPath ($o + "`r`n===== STDERR =====`r`n" + $e)
    Remove-Item $outPath, $errPath -Force -ErrorAction SilentlyContinue
    return $p.ExitCode
}

# ---------- BEGIN PIPELINE ----------
$ts      = NowTs
$rootRel = "diagnostics\release_aab\AAB_RAIL_$ts"
$root    = Join-Path (Get-Location).Path $rootRel
New-Item -ItemType Directory -Force -Path $root | Out-Null

$branch  = (git rev-parse --abbrev-ref HEAD).Trim()
$head0   = (git rev-parse --short HEAD).Trim()
W (Join-Path $root "01_repo_head_before.txt") @("BRANCH=$branch", "HEAD=$head0")
W (Join-Path $root "02_repo_status_before.txt") @((git status --porcelain))

# ---- GATE 1: Clean tree required ----
$dirty = (git status --porcelain)
if ($dirty.Length -ne 0) {
    W (Join-Path $root "99_FAIL_DIRTY_TREE.txt") $dirty
    throw "DIRTY_TREE: commit or stash first. See $rootRel\99_FAIL_DIRTY_TREE.txt"
}
Write-Output "[GATE1] Clean tree OK"

# ---- GATE 2: Broken JSX tag preflight ----
$jsxTargets = Get-ChildItem -Recurse -File -Path src -Include *.js,*.jsx,*.ts,*.tsx |
    Where-Object { $_.FullName -notmatch "\\node_modules\\|\\android\\|\\ios\\|\\dist\\|\\build\\|\\coverage\\" }
$bad = $null
if ($jsxTargets.Count -gt 0) {
    $bad = Select-String -Path ($jsxTargets.FullName) `
        -Pattern "<Viewstyle|<Viewclass|<Viewid|<Textstyle|<ScrollViewstyle|<SafeAreaViewstyle" `
        -ErrorAction SilentlyContinue
}
if ($bad) {
    $lines = @("RESULT=FAIL", "BROKEN_TAGS_FOUND=$($bad.Count)") + ($bad | Select-Object -First 200 | ForEach-Object {
        "{0}:{1} :: {2}" -f (Rel $_.Path), $_.LineNumber, $_.Line.Trim()
    })
    W (Join-Path $root "03_FAIL_BROKEN_JSX.txt") $lines
    throw "BROKEN_JSX: Fix before building. See $rootRel\03_FAIL_BROKEN_JSX.txt"
} else {
    W (Join-Path $root "03_preflight_jsx_ok.txt") @("RESULT=PASS", "NO_BROKEN_TAGS_FOUND")
}
Write-Output "[GATE2] JSX preflight OK"

# ---- STEP 1: Bump versionCode ----
$gradle = "android\app\build.gradle"
if (-not (Test-Path $gradle)) { throw "BUILD_GRADLE_NOT_FOUND: $gradle" }
$g0 = ReadText $gradle
W (Join-Path $root "04_build_gradle_before.txt") @($g0)

$vc = [regex]::Match($g0, "(?m)^\s*versionCode\s+(\d+)\s*$")
$vn = [regex]::Match($g0, '(?m)^\s*versionName\s+"([^"]+)"\s*$')
if (-not $vc.Success) { throw "VERSIONCODE_NOT_FOUND in build.gradle" }

$oldVc  = [int]$vc.Groups[1].Value
$today  = Get-Date -Format "yyyyMMdd"
$prefix = [int]("${today}00")
$newVc  = $prefix + 1
if ($oldVc -ge $prefix -and $oldVc -lt ($prefix + 100)) { $newVc = $oldVc + 1 }
if ($newVc -gt 2147483647) { throw "VERSIONCODE_OVERFLOW: $newVc" }

$g1 = $g0 -replace "(?m)(^\s*)versionCode\s+\d+", "`$1versionCode $newVc"
WriteNoBom (Resolve-Path $gradle).Path $g1
W (Join-Path $root "05_version_bump.txt") @(
    "OLD_VERSION_CODE=$oldVc"
    "NEW_VERSION_CODE=$newVc"
    ("VERSION_NAME=" + $(if ($vn.Success) { $vn.Groups[1].Value } else { "UNKNOWN" }))
)

$gAfter = ReadText $gradle
W (Join-Path $root "06_build_gradle_after.txt") @($gAfter)

git add $gradle | Out-Null
git commit -m "chore(android): bump versionCode to $newVc" 2>&1 |
    Out-File -Encoding utf8 (Join-Path $root "07_version_bump_commit.txt")
Write-Output "[STEP1] versionCode bumped $oldVc -> $newVc"

# ---- STEP 2: Build Release AAB (FORCED CLEAN, NO CACHE) ----
if (-not (Test-Path "android\gradlew.bat")) { throw "GRADLEW_NOT_FOUND: android\gradlew.bat" }
$buildLog   = Join-Path $root "08_build_log.txt"
$androidDir = Join-Path (Get-Location).Path "android"
Write-Output "[STEP2] Starting forced-clean Gradle bundleRelease (no-cache, rerun tasks)..."
$aabOut = Join-Path (Get-Location).Path "android\app\build\outputs\bundle\release\app-release.aab"
if (Test-Path $aabOut) {
    Remove-Item -Force -LiteralPath $aabOut
}
$exit = RunGradle $androidDir "--no-daemon -Dorg.gradle.caching=false clean bundleRelease --no-build-cache --rerun-tasks" $buildLog

W (Join-Path $root "09_build_result.txt") @(
    "EXIT_CODE=$exit"
    "TAIL_80_LINES:"
    ((Get-Content $buildLog -ErrorAction SilentlyContinue | Select-Object -Last 80) | ForEach-Object { $_ })
)

if ($exit -ne 0) { throw "GRADLE_BUILD_FAILED: exit=$exit. See $rootRel\08_build_log.txt" }
Write-Output "[STEP2] Gradle build succeeded"

# ---- STEP 3: Artifact + extraction + loopback scan ----
$aab = "android\app\build\outputs\bundle\release\app-release.aab"
if (-not (Test-Path $aab)) { throw "AAB_NOT_FOUND: $aab" }

# Freshness gate: reject an AAB older than critical source/config files.
$criticalPaths = @(
    "app.config.js",
    ".env.production",
    "eas.json",
    "index.js",
    "src\aws-exports.js",
    "src\config\amplify.js",
    "android\app\build.gradle"
) | ForEach-Object { Join-Path (Get-Location).Path $_ }

$existingCritical = $criticalPaths | Where-Object { Test-Path $_ }
$aabTime = (Get-Item $aab).LastWriteTimeUtc
$latestCritical = ($existingCritical | ForEach-Object { Get-Item $_ } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1)
if ($latestCritical -and $aabTime -lt $latestCritical.LastWriteTimeUtc) {
    W (Join-Path $root "10c_freshness_gate.txt") @(
        "RESULT=FAIL"
        "AAB_LAST_WRITE_UTC=$($aabTime.ToString('o'))"
        "LATEST_CRITICAL_FILE=$($latestCritical.FullName)"
        "LATEST_CRITICAL_LAST_WRITE_UTC=$($latestCritical.LastWriteTimeUtc.ToString('o'))"
    )
    throw "STALE_AAB_DETECTED: artifact older than critical source/config file"
}

$freshnessLines = @("RESULT=PASS", "AAB_LAST_WRITE_UTC=$($aabTime.ToString('o'))")
foreach ($item in ($existingCritical | ForEach-Object { Get-Item $_ } | Sort-Object FullName)) {
    $freshnessLines += ("CRITICAL_FILE={0} | LAST_WRITE_UTC={1}" -f $item.FullName, $item.LastWriteTimeUtc.ToString('o'))
}
W (Join-Path $root "10c_freshness_gate.txt") $freshnessLines

$sha = (Get-FileHash -Algorithm SHA256 $aab).Hash
$len = (Get-Item $aab).Length
W (Join-Path $root "10_aab_artifact.txt") @(
    "AAB_PATH=$((Resolve-Path $aab).Path)"
    "AAB_SIZE_BYTES=$len"
    "AAB_SHA256=$sha"
    "EXPECTED_VERSION_CODE=$newVc"
)

$tmp = Join-Path $root "aab_extract"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# Expand-Archive compat: copy .aab -> .zip
$zipCopy = Join-Path $root "app-release.zip"
Copy-Item $aab $zipCopy -Force
Expand-Archive -Force -LiteralPath $zipCopy -DestinationPath $tmp
Remove-Item $zipCopy -Force

# Manifest existence proof
$manifestPath = Join-Path $tmp "base\manifest\AndroidManifest.xml"
if (Test-Path $manifestPath) {
    $msz = (Get-Item $manifestPath).Length
    W (Join-Path $root "10b_manifest_present.txt") @(
        "MANIFEST_EXISTS=true"
        "PATH=base/manifest/AndroidManifest.xml"
        "SIZE_BYTES=$msz"
        "NOTE=Binary XML; use bundletool/aapt2 for readable versionCode if needed."
    )
} else {
    W (Join-Path $root "10b_manifest_present.txt") @(
        "MANIFEST_EXISTS=false"
        "NOTE=Unexpected; base manifest missing after extraction."
    )
}

# Loopback scan (WARN only)
$rx   = "(127\.0\.0\.1|localhost)(:\d+)?"
$hits = New-Object System.Collections.Generic.List[string]
Get-ChildItem -Recurse -File $tmp | Where-Object { $_.Length -lt 60000000 } | ForEach-Object {
    try {
        $c = Get-Content -Raw -LiteralPath $_.FullName -ErrorAction Stop
        if ($c -match $rx) {
            $rel = $_.FullName.Replace((Resolve-Path $tmp).Path + "\", "")
            $hits.Add("$rel :: $($Matches[0])") | Out-Null
        }
    } catch {}
}
if ($hits.Count -gt 0) {
    W (Join-Path $root "11_loopback_scan.txt") (@("RESULT=WARN", "HITS=$($hits.Count)") + $hits)
} else {
    W (Join-Path $root "11_loopback_scan.txt") @("RESULT=OK", "NO_LOOPBACK_MARKERS_FOUND")
}
Write-Output "[STEP3] Artifact captured + scanned"

# ---- Summary ----
$head1 = (git rev-parse --short HEAD).Trim()
$sum   = Join-Path $root "00_summary.txt"
W $sum @(
    "RESULT=PASS"
    "PACKET_REL=$rootRel"
    "BRANCH=$branch"
    "HEAD_BEFORE=$head0"
    "HEAD_AFTER=$head1"
    "VERSION_CODE=$newVc"
    "AAB=$((Resolve-Path $aab).Path)"
    "AAB_SHA256=$sha"
    ""
    "OPEN_THIS:"
    (FileUrl $sum)
    ""
    "KEY_FILES:"
    ("  - BUILD_LOG:  " + (FileUrl (Join-Path $root "08_build_log.txt")))
    ("  - AAB_PROOF:  " + (FileUrl (Join-Path $root "10_aab_artifact.txt")))
    ("  - FRESHNESS:  " + (FileUrl (Join-Path $root "10c_freshness_gate.txt")))
    ("  - MANIFEST:   " + (FileUrl (Join-Path $root "10b_manifest_present.txt")))
    ("  - LOOPBACK:   " + (FileUrl (Join-Path $root "11_loopback_scan.txt")))
)

Write-Output ""
Write-Output "============================="
Write-Output "PASS. PACKET=$rootRel"
Write-Output ("OPEN: " + (FileUrl $sum))
Write-Output "VERSION_CODE=$newVc"
Write-Output "AAB=$((Resolve-Path $aab).Path)"
Write-Output "============================="
