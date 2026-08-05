param(
  [Parameter(Mandatory = $false)]
  [int]$ExpectedVersionCode = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Enforce ExpectedVersionCode is required at script start (non-interactive hard-fail)
if ($ExpectedVersionCode -le 0) {
  throw "ABORT: ExpectedVersionCode is required for canonical release. Usage: BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <value>"
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $RepoRoot

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Write-Lines([string]$Path, [string[]]$Lines) {
  Write-Utf8NoBom -Path $Path -Content ($Lines -join "`r`n")
}

function Assert-RepoRoot {
  $gitTop = (git rev-parse --show-toplevel 2>$null | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($gitTop)) {
    throw 'ABORT: Current directory is not inside a git worktree.'
  }

  $resolvedGitTop = (Resolve-Path $gitTop).Path
  $resolvedRepoRoot = (Resolve-Path $RepoRoot).Path
  if ($resolvedGitTop -ne $resolvedRepoRoot) {
    throw "ABORT: Wrong repo/worktree. Expected $resolvedRepoRoot but git root is $resolvedGitTop"
  }

  foreach ($required in @('package.json', 'android\app\build.gradle', 'eas.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $required))) {
      throw "ABORT: Missing required release context file: $required"
    }
  }
}

function Assert-CleanRepo {
  $porcelain = (git status --porcelain | Out-String).Trim()
  if ($porcelain.Length -gt 0) {
    throw "ABORT: Repo dirty.`n$porcelain"
  }
}

function Assert-OnNamedBranch {
  $branch = (git rev-parse --abbrev-ref HEAD | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($branch) -or $branch -eq 'HEAD') {
    throw 'ABORT: Detached HEAD is not allowed for canonical release builds.'
  }
  return $branch
}

function Get-EnvOrFail([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required env var: $Name"
  }
  return $value.Trim()
}

function Get-ReleaseMetadata {
  $gradlePath = Join-Path $RepoRoot 'android\app\build.gradle'
  $text = Get-Content -Raw -LiteralPath $gradlePath

  $versionCodeMatch = [regex]::Match($text, '(?m)^\s*versionCode\s+(\d+)\s*$')
  $versionNameMatch = [regex]::Match($text, '(?m)^\s*versionName\s+"([^"]+)"\s*$')

  if (-not $versionCodeMatch.Success) {
    throw 'ABORT: versionCode not found in android/app/build.gradle'
  }

  if (-not $versionNameMatch.Success) {
    throw 'ABORT: versionName not found in android/app/build.gradle'
  }

  return [pscustomobject]@{
    VersionCode = [int]$versionCodeMatch.Groups[1].Value
    VersionName = $versionNameMatch.Groups[1].Value
    GradlePath = $gradlePath
  }
}

function Read-KeyValueFile([string]$Path) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $map
  }

  $lines = Get-Content -LiteralPath $Path
  foreach ($line in $lines) {
    if ($line -match '^\s*$') { continue }
    if ($line -match '^\s*#') { continue }

    $idx = $line.IndexOf('=')
    if ($idx -lt 0) { continue }

    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if (-not [string]::IsNullOrWhiteSpace($key)) {
      $map[$key] = $value
    }
  }

  return $map
}

function Assert-FreshRegressionGateProof([int]$ExpectedVersionCode, [string]$Branch, [string]$GitHead) {
  $governanceRoot = Join-Path $RepoRoot 'diagnostics\release_governance'
  if (-not (Test-Path -LiteralPath $governanceRoot)) {
    throw 'ABORT: Missing diagnostics/release_governance. Run tools/release/RUN_PRE_RELEASE_REGRESSION_GATE.ps1 first.'
  }

  $packets = @(Get-ChildItem -LiteralPath $governanceRoot -Directory -Filter 'PRE_RELEASE_REGRESSION_GATE_*' | Sort-Object LastWriteTimeUtc -Descending)
  if ($packets.Count -eq 0) {
    throw 'ABORT: No pre-release regression gate packet found. Run tools/release/RUN_PRE_RELEASE_REGRESSION_GATE.ps1 first.'
  }

  $nowUtc = (Get-Date).ToUniversalTime()
  $matchedPacket = $null
  $latestChecked = $null

  foreach ($packet in $packets) {
    $verdictPath = Join-Path $packet.FullName '08_final_verdict.txt'
    if (-not (Test-Path -LiteralPath $verdictPath)) {
      continue
    }

    $kv = Read-KeyValueFile -Path $verdictPath
    if ($latestChecked -eq $null) {
      $latestChecked = $kv
    }

    if (($kv['RESULT'] | Out-String).Trim() -ne 'PASS') {
      continue
    }

    if (($kv['BRANCH'] | Out-String).Trim() -ne $Branch) {
      continue
    }

    if (($kv['GIT_HEAD'] | Out-String).Trim() -ne $GitHead) {
      continue
    }

    $packetVersion = 0
    $packetVersionRaw = ($kv['EXPECTED_VERSION_CODE'] | Out-String).Trim()
    if (-not [int]::TryParse($packetVersionRaw, [ref]$packetVersion)) {
      continue
    }
    if ($packetVersion -ne $ExpectedVersionCode) {
      continue
    }

    $utcRaw = ($kv['UTC'] | Out-String).Trim()
    $packetUtc = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse($utcRaw, [ref]$packetUtc)) {
      continue
    }

    $ageHours = ($nowUtc - $packetUtc.UtcDateTime).TotalHours
    if ($ageHours -gt 12) {
      continue
    }

    $matchedPacket = $packet.FullName
    break
  }

  if ($matchedPacket -eq $null) {
    $hint = 'unknown'
    if ($latestChecked -ne $null) {
      $hint = "latest RESULT=$($latestChecked['RESULT']) BRANCH=$($latestChecked['BRANCH']) GIT_HEAD=$($latestChecked['GIT_HEAD']) EXPECTED_VERSION_CODE=$($latestChecked['EXPECTED_VERSION_CODE']) UTC=$($latestChecked['UTC'])"
    }
    throw "ABORT: Missing fresh PASS pre-release regression gate proof for current branch/head/versionCode. Run tools/release/RUN_PRE_RELEASE_REGRESSION_GATE.ps1 -ExpectedVersionCode $ExpectedVersionCode first. Hint: $hint"
  }

  Write-Host "REGRESSION_GATE_PACKET=$matchedPacket"
}

function Assert-NoLoopbackReleaseConfig {
  $loopbackPattern = '(?i)(127\.0\.0\.1|localhost)(:\d+)?'
  $findings = New-Object System.Collections.Generic.List[string]

  $envProductionPath = Join-Path $RepoRoot '.env.production'
  if (Test-Path -LiteralPath $envProductionPath) {
    $envProductionText = Get-Content -Raw -LiteralPath $envProductionPath
    if ($envProductionText -match $loopbackPattern) {
      $findings.Add('.env.production contains loopback/localhost release config.') | Out-Null
    }
  }

  $easPath = Join-Path $RepoRoot 'eas.json'
  $eas = Get-Content -Raw -LiteralPath $easPath | ConvertFrom-Json
  $productionEnv = $eas.build.production.env
  if ($null -ne $productionEnv) {
    foreach ($property in $productionEnv.PSObject.Properties) {
      $value = [string]$property.Value
      if ($value -match $loopbackPattern) {
        $findings.Add("eas.json build.production.env.$($property.Name)=$value") | Out-Null
      }
    }
  }

  return $findings
}

function Get-AdbDeviceSerials {
  $lines = @(cmd /c 'adb devices 2>nul')
  if (-not $lines) { return @() }

  $serials = @()
  foreach ($line in $lines) {
    $text = ($line | Out-String).Trim()
    if (-not $text) { continue }
    if ($text -like 'List of devices*') { continue }
    if ($text -match '^([^\s]+)\s+device\b') {
      $serials += $Matches[1]
    }
  }

  return $serials
}

function Invoke-LoggedCommand([string]$Command, [string]$LogPath) {
  # Native tools (npm/eslint/tsc) can write benign notices to stderr (e.g.
  # "npm notice"). Under $ErrorActionPreference='Stop', merging 2>&1 turns that
  # stderr into a TERMINATING error even when the command succeeded (exit 0).
  # Capture under 'Continue' and treat the native exit code as the only source of
  # truth — same fix already applied to the gradle step below.
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = cmd /c $Command 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }
  $output | Tee-Object -FilePath $LogPath | Out-Null
  if ($exitCode -ne 0) {
    throw "Command failed (exit $exitCode): $Command"
  }
}

Assert-RepoRoot

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$packetRel = "diagnostics\release_aab\CANONICAL_PLAY_AAB_$timestamp"
$packetRoot = Join-Path $RepoRoot $packetRel
if (Test-Path -LiteralPath $packetRoot) {
  throw "ABORT: Release packet path already exists: $packetRoot"
}
New-Item -ItemType Directory -Force -Path $packetRoot | Out-Null

$branch = Assert-OnNamedBranch
$gitHead = (git rev-parse HEAD | Out-String).Trim()
$gitHeadShort = (git rev-parse --short HEAD | Out-String).Trim()
Assert-CleanRepo

$metadata = Get-ReleaseMetadata
if ($metadata.VersionCode -ne $ExpectedVersionCode) {
  throw "ABORT: Explicit versionCode intent mismatch. android/app/build.gradle has $($metadata.VersionCode) but ExpectedVersionCode=$ExpectedVersionCode"
}

# Anti-reuse: refuse any versionCode already built/uploaded. tools/release/built_versioncodes.txt
# is the durable, committed record of every consumed code; the Gradle release guard enforces the
# same rule unconditionally. To proceed, allocate a fresh code with tools/release/bump_version_code.ps1.
$builtLedgerPath = Join-Path $RepoRoot 'tools\release\built_versioncodes.txt'
if (Test-Path -LiteralPath $builtLedgerPath) {
  $consumedCodes = Get-Content -LiteralPath $builtLedgerPath | ForEach-Object { ($_ | Out-String).Trim() } | Where-Object { $_ -match '^\d+$' }
  if ($consumedCodes -contains ([string]$ExpectedVersionCode)) {
    throw "ABORT: versionCode $ExpectedVersionCode has already been built/uploaded (tools/release/built_versioncodes.txt). Run tools/release/bump_version_code.ps1 to allocate a fresh, strictly-increasing code, then re-run with the new -ExpectedVersionCode."
  }
}

Assert-FreshRegressionGateProof -ExpectedVersionCode $ExpectedVersionCode -Branch $branch -GitHead $gitHead

$storeFile = Get-EnvOrFail 'BLYP_RELEASE_STORE_FILE'
$storePass = Get-EnvOrFail 'BLYP_RELEASE_STORE_PASSWORD'
$keyAlias = Get-EnvOrFail 'BLYP_RELEASE_KEY_ALIAS'
$keyPass = Get-EnvOrFail 'BLYP_RELEASE_KEY_PASSWORD'

if (-not (Test-Path -LiteralPath $storeFile)) {
  throw "ABORT: Keystore not found at BLYP_RELEASE_STORE_FILE=$storeFile"
}

if ((Split-Path -Leaf $storeFile) -ieq 'debug.keystore') {
  throw 'ABORT: debug.keystore cannot be used for Play Store uploads.'
}

$loopbackFindings = @(Assert-NoLoopbackReleaseConfig)
Write-Lines -Path (Join-Path $packetRoot '03_release_config_guard.txt') -Lines @(
  'RESULT=' + $(if ($loopbackFindings.Count -eq 0) { 'PASS' } else { 'FAIL' })
  'CHECK=.env.production + eas.json build.production.env'
) + $loopbackFindings
if ($loopbackFindings.Count -gt 0) {
  throw 'ABORT: Loopback/localhost release configuration detected. See 03_release_config_guard.txt'
}

Write-Lines -Path (Join-Path $packetRoot '01_repo.txt') -Lines @(
  "UTC=$((Get-Date).ToUniversalTime().ToString('o'))"
  "BRANCH=$branch"
  "GIT_HEAD=$gitHead"
  "GIT_HEAD_SHORT=$gitHeadShort"
)

Write-Lines -Path (Join-Path $packetRoot '02_release_context.txt') -Lines @(
  "EXPECTED_VERSION_CODE=$ExpectedVersionCode"
  "ACTUAL_VERSION_CODE=$($metadata.VersionCode)"
  "VERSION_NAME=$($metadata.VersionName)"
  "SIGNING_STORE_FILE=$storeFile"
  "SIGNING_KEY_ALIAS=$keyAlias"
)

Write-Host '=== 1) JS QUALITY GATES ==='
Invoke-LoggedCommand -Command 'npm run lint' -LogPath (Join-Path $packetRoot '04_lint.txt')
Invoke-LoggedCommand -Command 'npm run typecheck' -LogPath (Join-Path $packetRoot '05_typecheck.txt')

Write-Host '=== 2) BUILD SIGNED AAB ==='
$env:NODE_ENV = 'production'
$env:CI = '1'
$env:BLYP_CANONICAL_RELEASE = '1'
$env:BLYP_RELEASE_BUILD = '1'
$env:BLYP_EXPECTED_VERSION_CODE = [string]$ExpectedVersionCode

$buildLog = Join-Path $packetRoot '06_gradle_bundleRelease.txt'
$buildCommand = 'cd /d android && gradlew.bat :app:clean :app:bundleRelease -Pandroid.useAndroidX=true'
# Gradle/javac emit benign notes to stderr (e.g. "uses or overrides a deprecated API").
# Under $ErrorActionPreference='Stop', a native command writing to stderr while we merge
# 2>&1 turns those notes into a terminating error AFTER the AAB is already built. Relax to
# 'Continue' only around the capture so authoritative success/failure comes from $LASTEXITCODE.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$buildOutput = cmd /c "set NODE_ENV=$env:NODE_ENV& set CI=$env:CI& set BLYP_CANONICAL_RELEASE=$env:BLYP_CANONICAL_RELEASE& set BLYP_RELEASE_BUILD=$env:BLYP_RELEASE_BUILD& set BLYP_EXPECTED_VERSION_CODE=$env:BLYP_EXPECTED_VERSION_CODE& $buildCommand" 2>&1
$buildExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
$buildOutput | Tee-Object -FilePath $buildLog | Out-Null
if ($buildExit -ne 0) {
  throw "Gradle failed (exit $buildExit). See $buildLog"
}

$sourceAab = Join-Path $RepoRoot 'android\app\build\outputs\bundle\release\app-release.aab'
if (-not (Test-Path -LiteralPath $sourceAab)) {
  throw "ABORT: AAB missing at $sourceAab"
}

$frozenAab = Join-Path $packetRoot 'app-release.aab'
Copy-Item -Force -LiteralPath $sourceAab -Destination $frozenAab

Write-Host '=== 3) VALIDATE MANIFEST ==='
$bundletool = Join-Path $RepoRoot 'tools\bundletool-all-1.15.6.jar'
if (-not (Test-Path -LiteralPath $bundletool)) {
  throw "ABORT: bundletool jar missing at $bundletool"
}

$manifestOut = Join-Path $packetRoot '07_manifest.xml'
$manifestDump = & java -jar $bundletool dump manifest --bundle $frozenAab 2>&1
$manifestDump | Out-File -Encoding utf8 $manifestOut
$manifestText = Get-Content -Raw -LiteralPath $manifestOut

if ($manifestText -notmatch 'package="com\.blyp\.mobile"') {
  throw 'ABORT: Package name mismatch in manifest dump.'
}
if ($manifestText -notmatch "android:versionCode=`"$ExpectedVersionCode`"") {
  throw 'ABORT: versionCode mismatch in manifest dump.'
}
if ($manifestText -notmatch "android:versionName=`"$([regex]::Escape($metadata.VersionName))`"") {
  throw 'ABORT: versionName mismatch in manifest dump.'
}

Write-Host '=== 4) INSTALLABILITY CHECK ==='
$apksPath = Join-Path $packetRoot '08_universal.apks'
$buildApksArgs = @(
  'build-apks',
  '--bundle', $frozenAab,
  '--output', $apksPath,
  '--mode', 'universal',
  '--ks', $storeFile,
  '--ks-pass', "pass:$storePass",
  '--ks-key-alias', $keyAlias,
  '--key-pass', "pass:$keyPass"
)
$buildApksOut = & java -jar $bundletool @buildApksArgs 2>&1
$buildApksOut | Out-File -Encoding utf8 (Join-Path $packetRoot '09_bundletool_build-apks.txt')
if (-not (Test-Path -LiteralPath $apksPath)) {
  throw 'ABORT: bundletool did not produce .apks output.'
}

$devices = Get-AdbDeviceSerials
cmd /c "adb devices -l > `"$(Join-Path $packetRoot '10_adb_devices.txt')`" 2>&1" | Out-Null
$deviceList = @($devices)
if ($deviceList.Count -gt 0) {
  foreach ($device in $deviceList) {
    try {
      $installOut = cmd /c "java -jar `"$bundletool`" install-apks --apks `"$apksPath`" --device-id $device 2>&1"
      $installOut | Out-File -Encoding utf8 (Join-Path $packetRoot ("11_install_$device.txt"))
    } catch {
      @("RESULT=WARN", "REASON=$($_.Exception.Message)") | Out-File -Encoding utf8 (Join-Path $packetRoot ("11_install_$device.txt"))
    }
  }
} else {
  Write-Lines -Path (Join-Path $packetRoot '11_installability_skipped.txt') -Lines @('RESULT=SKIPPED', 'REASON=No adb devices connected')
}

$sha = (Get-FileHash -Algorithm SHA256 $frozenAab).Hash
$sizeBytes = (Get-Item -LiteralPath $frozenAab).Length
Write-Lines -Path (Join-Path $packetRoot '12_artifact_meta.txt') -Lines @(
  "UTC=$((Get-Date).ToUniversalTime().ToString('o'))"
  "SOURCE_AAB_PATH=$sourceAab"
  "FROZEN_AAB_PATH=$frozenAab"
  "VERSION_CODE=$ExpectedVersionCode"
  "VERSION_NAME=$($metadata.VersionName)"
  "AAB_SIZE_BYTES=$sizeBytes"
  "AAB_SHA256=$sha"
)

Write-Lines -Path (Join-Path $packetRoot '00_summary.txt') -Lines @(
  'RESULT=PASS'
  "PACKET_REL=$packetRel"
  "UTC=$((Get-Date).ToUniversalTime().ToString('o'))"
  "BRANCH=$branch"
  "GIT_HEAD=$gitHead"
  "VERSION_CODE=$ExpectedVersionCode"
  "VERSION_NAME=$($metadata.VersionName)"
  "SOURCE_AAB_PATH=$sourceAab"
  "FROZEN_AAB_PATH=$frozenAab"
  "AAB_SIZE_BYTES=$sizeBytes"
  "AAB_SHA256=$sha"
)

Write-Host "AAB_READY=$frozenAab"
Write-Host "AAB_SHA256=$sha"
Write-Host "RC_ROOT=$packetRoot"
