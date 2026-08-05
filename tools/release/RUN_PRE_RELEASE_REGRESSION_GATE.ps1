param(
  [Parameter(Mandatory = $false)]
  [int]$ExpectedVersionCode = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($ExpectedVersionCode -le 0) {
  throw 'ABORT: ExpectedVersionCode is required. Usage: RUN_PRE_RELEASE_REGRESSION_GATE.ps1 -ExpectedVersionCode <value>'
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

function Parse-KeyValueFile([string]$Path) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $map
  }
  $lines = Get-Content -LiteralPath $Path
  foreach ($line in $lines) {
    if ($line -match '^\s*#') { continue }
    if ($line -match '^\s*$') { continue }
    $idx = $line.IndexOf('=')
    if ($idx -lt 0) { continue }
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim()
    if (-not [string]::IsNullOrWhiteSpace($key)) {
      $map[$key] = $val
    }
  }
  return $map
}

function Get-ObjectPropertyValue($Object, [string]$Name) {
  if ($null -eq $Object) { return '' }
  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop) { return '' }
  return [string]$prop.Value
}

function Is-Truthy([string]$Value) {
  $v = [string]($Value)
  if ([string]::IsNullOrWhiteSpace($v)) { return $false }
  $n = $v.Trim().ToLowerInvariant()
  return $n -eq '1' -or $n -eq 'true' -or $n -eq 'yes' -or $n -eq 'on'
}

function Is-Falsy([string]$Value) {
  $v = [string]($Value)
  if ([string]::IsNullOrWhiteSpace($v)) { return $false }
  $n = $v.Trim().ToLowerInvariant()
  return $n -eq '0' -or $n -eq 'false' -or $n -eq 'no' -or $n -eq 'off'
}

function Contains-Loopback([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
  return [regex]::IsMatch($Value, '(?i)(127\.0\.0\.1|localhost)(:\d+)?')
}

function Get-ReleaseMetadata([string]$GradlePath) {
  $text = Get-Content -Raw -LiteralPath $GradlePath
  $versionCodeMatch = [regex]::Match($text, '(?m)^\s*versionCode\s+(\d+)\s*$')
  $versionNameMatch = [regex]::Match($text, '(?m)^\s*versionName\s+"([^"]+)"\s*$')

  return [pscustomobject]@{
    VersionCodeFound = $versionCodeMatch.Success
    VersionNameFound = $versionNameMatch.Success
    VersionCode = $(if ($versionCodeMatch.Success) { [int]$versionCodeMatch.Groups[1].Value } else { 0 })
    VersionName = $(if ($versionNameMatch.Success) { $versionNameMatch.Groups[1].Value } else { '' })
  }
}

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$packetRel = "diagnostics\release_governance\PRE_RELEASE_REGRESSION_GATE_$timestamp"
$packetRoot = Join-Path $RepoRoot $packetRel
if (Test-Path -LiteralPath $packetRoot) {
  throw "ABORT: Gate packet path already exists: $packetRoot"
}
New-Item -ItemType Directory -Force -Path $packetRoot | Out-Null

$fails = New-Object System.Collections.Generic.List[string]
$warns = New-Object System.Collections.Generic.List[string]

function Add-Fail([string]$Msg) {
  $fails.Add($Msg) | Out-Null
}

function Add-Warn([string]$Msg) {
  $warns.Add($Msg) | Out-Null
}

# ---------------------------------------------------------------------------
# A) Release identity
# ---------------------------------------------------------------------------
$branch = (git rev-parse --abbrev-ref HEAD | Out-String).Trim()
$gitHead = (git rev-parse HEAD | Out-String).Trim()
$statusLines = @(git status --short)
$isCleanTree = $statusLines.Count -eq 0
if (-not $isCleanTree) {
  Add-Fail 'A.cleanTree: git tree is not clean'
}

$gradlePath = Join-Path $RepoRoot 'android\app\build.gradle'
$metadata = Get-ReleaseMetadata -GradlePath $gradlePath
if (-not $metadata.VersionCodeFound) {
  Add-Fail 'A.versionCode: versionCode not found in android/app/build.gradle'
}
if (-not $metadata.VersionNameFound) {
  Add-Fail 'A.versionName: versionName not found in android/app/build.gradle'
}
if ($metadata.VersionCodeFound -and $metadata.VersionCode -ne $ExpectedVersionCode) {
  Add-Fail "A.versionCodeIntent: expected versionCode $ExpectedVersionCode but found $($metadata.VersionCode)"
}

Write-Lines -Path (Join-Path $packetRoot '01_release_identity.txt') -Lines @(
  "UTC=$((Get-Date).ToUniversalTime().ToString('o'))"
  "BRANCH=$branch"
  "GIT_HEAD=$gitHead"
  "CLEAN_TREE=$(if ($isCleanTree) { 'YES' } else { 'NO' })"
  "EXPECTED_VERSION_CODE=$ExpectedVersionCode"
  "ACTUAL_VERSION_CODE=$($metadata.VersionCode)"
  "VERSION_NAME=$($metadata.VersionName)"
  "CHECK_BRANCH=$(if (-not [string]::IsNullOrWhiteSpace($branch) -and $branch -ne 'HEAD') { 'PASS' } else { 'FAIL' })"
  "CHECK_HEAD=$(if (-not [string]::IsNullOrWhiteSpace($gitHead)) { 'PASS' } else { 'FAIL' })"
  "CHECK_CLEAN_TREE=$(if ($isCleanTree) { 'PASS' } else { 'FAIL' })"
  "CHECK_VERSION_CODE_PRESENT=$(if ($metadata.VersionCodeFound) { 'PASS' } else { 'FAIL' })"
  "CHECK_VERSION_INTENT_MATCH=$(if ($metadata.VersionCodeFound -and $metadata.VersionCode -eq $ExpectedVersionCode) { 'PASS' } else { 'FAIL' })"
) + @('RAW_GIT_STATUS_BEGIN') + $statusLines + @('RAW_GIT_STATUS_END')

# ---------------------------------------------------------------------------
# Shared config reads
# ---------------------------------------------------------------------------
$envProdPath = Join-Path $RepoRoot '.env.production'
$envProd = Parse-KeyValueFile -Path $envProdPath
$easPath = Join-Path $RepoRoot 'eas.json'
$eas = Get-Content -Raw -LiteralPath $easPath | ConvertFrom-Json
$prodEnv = $eas.build.production.env

$envEnableStreaming = [string]$envProd['EXPO_PUBLIC_ENABLE_STREAMING']
$easEnableStreaming = Get-ObjectPropertyValue -Object $prodEnv -Name 'EXPO_PUBLIC_ENABLE_STREAMING'
$envLiveServiceUrl = [string]$envProd['EXPO_PUBLIC_LIVE_SERVICE_URL']
$easLiveServiceUrl = Get-ObjectPropertyValue -Object $prodEnv -Name 'EXPO_PUBLIC_LIVE_SERVICE_URL'
$envApiBase = [string]$envProd['EXPO_PUBLIC_API_BASE_URL']
$easApiBase = Get-ObjectPropertyValue -Object $prodEnv -Name 'EXPO_PUBLIC_API_BASE_URL'

# ---------------------------------------------------------------------------
# B) Live safety
# ---------------------------------------------------------------------------
$liveLoopbackHits = New-Object System.Collections.Generic.List[string]
foreach ($pair in @(
  @{ Name = '.env.production.EXPO_PUBLIC_LIVE_SERVICE_URL'; Value = $envLiveServiceUrl },
  @{ Name = '.env.production.EXPO_PUBLIC_API_BASE_URL'; Value = $envApiBase },
  @{ Name = 'eas.production.EXPO_PUBLIC_LIVE_SERVICE_URL'; Value = $easLiveServiceUrl },
  @{ Name = 'eas.production.EXPO_PUBLIC_API_BASE_URL'; Value = $easApiBase }
)) {
  if (Contains-Loopback -Value ([string]$pair.Value)) {
    $liveLoopbackHits.Add("$($pair.Name)=$($pair.Value)") | Out-Null
  }
}
if ($liveLoopbackHits.Count -gt 0) {
  Add-Fail 'B.loopback: loopback value found in release live/api config'
}

$liveEnabled = -not (Is-Falsy -Value $envEnableStreaming) -and -not (Is-Falsy -Value $easEnableStreaming)
if (-not $liveEnabled) {
  Add-Fail "B.streamingEnabled: EXPO_PUBLIC_ENABLE_STREAMING not enabled in release config (.env.production=$envEnableStreaming, eas.production=$easEnableStreaming)"
}

$createPostButtonPath = Join-Path $RepoRoot 'src\components\CreatePostButton.js'
$streamingFlagPath = Join-Path $RepoRoot 'src\config\StreamingFeatureFlag.js'
$createPostText = Get-Content -Raw -LiteralPath $createPostButtonPath
$streamingFlagText = Get-Content -Raw -LiteralPath $streamingFlagPath

# Go Live entry stays visible in Create sheet; streaming kill-switch is enforced on press.
$liveButtonWired =
  ($createPostText -match 'isLiveStreamingEnabled') -and
  ($createPostText -match 'canShowGoLive\s*=\s*true') -and
  ($createPostText -match 'if\s*\(\s*!streamingEnabled\s*\)') -and
  ($createPostText -match 'Live streaming disabled')
if (-not $liveButtonWired) {
  Add-Fail 'B.liveButtonGate: CreatePostButton Go Live entry/on-press streaming kill-switch no longer matches release expectation'
}

$streamingFlagWired =
  ($streamingFlagText -match 'EXPO_PUBLIC_ENABLE_STREAMING') -and
  ($streamingFlagText -match 'BUILD_ENABLE_LIVE_STREAMING')
if (-not $streamingFlagWired) {
  Add-Fail 'B.streamingGateSource: StreamingFeatureFlag no longer resolves EXPO_PUBLIC_ENABLE_STREAMING as source-of-truth'
}

$liveSourcePresent =
  (-not [string]::IsNullOrWhiteSpace($envLiveServiceUrl)) -and
  (-not [string]::IsNullOrWhiteSpace($easLiveServiceUrl))
if (-not $liveSourcePresent) {
  Add-Fail 'B.liveServiceUrl: EXPO_PUBLIC_LIVE_SERVICE_URL missing in production source-of-truth config'
}

Write-Lines -Path (Join-Path $packetRoot '02_live_safety.txt') -Lines @(
  "CHECK_NO_LOOPBACK_RELEASE_CONFIG=$(if ($liveLoopbackHits.Count -eq 0) { 'PASS' } else { 'FAIL' })"
  "CHECK_STREAMING_ENABLED_RELEASE=$(if ($liveEnabled) { 'PASS' } else { 'FAIL' })"
  "CHECK_LIVE_BUTTON_GATE_EXPECTATION=$(if ($liveButtonWired) { 'PASS' } else { 'FAIL' })"
  "CHECK_STREAMING_SOURCE_OF_TRUTH=$(if ($streamingFlagWired) { 'PASS' } else { 'FAIL' })"
  "CHECK_LIVE_SERVICE_URL_PRESENT=$(if ($liveSourcePresent) { 'PASS' } else { 'FAIL' })"
  "ENV_EXPO_PUBLIC_ENABLE_STREAMING=$envEnableStreaming"
  "EAS_EXPO_PUBLIC_ENABLE_STREAMING=$easEnableStreaming"
  "ENV_EXPO_PUBLIC_LIVE_SERVICE_URL=$envLiveServiceUrl"
  "EAS_EXPO_PUBLIC_LIVE_SERVICE_URL=$easLiveServiceUrl"
) + $liveLoopbackHits

# ---------------------------------------------------------------------------
# C) Purchase / wallet safety
# ---------------------------------------------------------------------------
$envDisablePurchases = [string]$envProd['EXPO_PUBLIC_DISABLE_PURCHASES']
$easDisablePurchases = Get-ObjectPropertyValue -Object $prodEnv -Name 'EXPO_PUBLIC_DISABLE_PURCHASES'
$disablePurchasesUnexpected = (Is-Truthy -Value $envDisablePurchases) -or (Is-Truthy -Value $easDisablePurchases)
if ($disablePurchasesUnexpected) {
  Add-Fail "C.disablePurchasesUnexpected: release config disables purchases (.env.production=$envDisablePurchases, eas.production=$easDisablePurchases)"
}

$envUseLiveWallet = [string]$envProd['EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET']
$easUseLiveWallet = Get-ObjectPropertyValue -Object $prodEnv -Name 'EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET'
$walletPathExpected = (Is-Truthy -Value $envUseLiveWallet) -and (Is-Truthy -Value $easUseLiveWallet)
if (-not $walletPathExpected) {
  Add-Fail "C.walletPath: expected EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET=true in production config (.env.production=$envUseLiveWallet, eas.production=$easUseLiveWallet)"
}

$economyModelPath = Join-Path $RepoRoot 'src\config\economyModel.ts'
$economyModelText = Get-Content -Raw -LiteralPath $economyModelPath
$purchaseDefaultsPresent =
  ($economyModelText -match "ENABLE_PURCHASES\s*=\s*!envFlag\('EXPO_PUBLIC_DISABLE_PURCHASES',\s*false\)") -and
  ($economyModelText -match 'REQUIRE_SERVER_RECEIPT_VALIDATION\s*=\s*!isDevelopment') -and
  ($economyModelText -match 'ALLOW_SIMULATED_CLIENT_TOPUPS\s*=\s*isDevelopment')
if (-not $purchaseDefaultsPresent) {
  Add-Fail 'C.walletDefaults: expected wallet/purchase safety defaults not found in economyModel.ts'
}

Write-Lines -Path (Join-Path $packetRoot '03_purchase_wallet_safety.txt') -Lines @(
  "CHECK_PURCHASES_NOT_DEFAULT_DISABLED=$(if (-not $disablePurchasesUnexpected) { 'PASS' } else { 'FAIL' })"
  "CHECK_WALLET_PATH_EXPECTED=$(if ($walletPathExpected) { 'PASS' } else { 'FAIL' })"
  "CHECK_WALLET_DEFAULT_GATES_PRESENT=$(if ($purchaseDefaultsPresent) { 'PASS' } else { 'FAIL' })"
  "ENV_EXPO_PUBLIC_DISABLE_PURCHASES=$envDisablePurchases"
  "EAS_EXPO_PUBLIC_DISABLE_PURCHASES=$easDisablePurchases"
  "ENV_EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET=$envUseLiveWallet"
  "EAS_EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET=$easUseLiveWallet"
)

# ---------------------------------------------------------------------------
# D) AI / Gemini safety
# ---------------------------------------------------------------------------
$reviewPath = Join-Path $RepoRoot 'src\screens\ReviewScreen.js'
$smartListPath = Join-Path $RepoRoot 'src\utils\smartListGenerator.js'
$reviewText = Get-Content -Raw -LiteralPath $reviewPath
$smartListText = Get-Content -Raw -LiteralPath $smartListPath

$aiDependsOnGemini =
  ($reviewText -match 'EXPO_PUBLIC_GEMINI_API_KEY') -or
  ($reviewText -match 'geminiSpeechService') -or
  ($smartListText -match '@google/generative-ai')

$envGemini = [string]$envProd['EXPO_PUBLIC_GEMINI_API_KEY']
$easGemini = Get-ObjectPropertyValue -Object $prodEnv -Name 'EXPO_PUBLIC_GEMINI_API_KEY'
$geminiPresent = (-not [string]::IsNullOrWhiteSpace($envGemini)) -or (-not [string]::IsNullOrWhiteSpace($easGemini))

if ($aiDependsOnGemini -and -not $geminiPresent) {
  Add-Warn 'D.geminiMissing: AI/Gemini-dependent features are expected to degrade in production (missing EXPO_PUBLIC_GEMINI_API_KEY)'
}

$aiDependencyState = if ($aiDependsOnGemini) { 'YES' } else { 'NO' }
$aiGeminiState = if ($geminiPresent) { 'PRESENT' } else { 'MISSING' }
$aiRiskState = if ($aiDependsOnGemini -and -not $geminiPresent) { 'WARN_DEGRADED_FEATURE' } else { 'NONE' }

Write-Lines -Path (Join-Path $packetRoot '04_ai_gemini_safety.txt') -Lines @(
  "CHECK_AI_DEPENDS_ON_GEMINI=$aiDependencyState"
  "CHECK_GEMINI_KEY=$aiGeminiState"
  "CHECK_DEGRADED_FEATURE_RISK=$aiRiskState"
  "ENV_EXPO_PUBLIC_GEMINI_API_KEY_PRESENT=$(if (-not [string]::IsNullOrWhiteSpace($envGemini)) { 'YES' } else { 'NO' })"
  "EAS_EXPO_PUBLIC_GEMINI_API_KEY_PRESENT=$(if (-not [string]::IsNullOrWhiteSpace($easGemini)) { 'YES' } else { 'NO' })"
)

# ---------------------------------------------------------------------------
# E) Release-path safety
# ---------------------------------------------------------------------------
$canonicalScriptPath = Join-Path $RepoRoot 'tools\release\BUILD_RELEASE_CANDIDATE.ps1'
$canonicalExists = Test-Path -LiteralPath $canonicalScriptPath
if (-not $canonicalExists) {
  Add-Fail 'E.canonicalPath: missing tools/release/BUILD_RELEASE_CANDIDATE.ps1'
}

$legacyScripts = @(
  'scripts\agent\aab_build_rail_v3.ps1',
  'scripts\agent\aab_build_rail_v2.ps1',
  'scripts\agent\aab_build_rail.ps1',
  'scripts\build_upload_aab.ps1',
  'scripts\finalize_aab.ps1'
)

$legacyBlockFailures = New-Object System.Collections.Generic.List[string]
foreach ($rel in $legacyScripts) {
  $abs = Join-Path $RepoRoot $rel
  if (-not (Test-Path -LiteralPath $abs)) {
    $legacyBlockFailures.Add("$rel=MISSING") | Out-Null
    continue
  }
  $text = Get-Content -Raw -LiteralPath $abs
  if ($text -notmatch 'RELEASE_PATH_BLOCKED') {
    $legacyBlockFailures.Add("$rel=UNBLOCKED") | Out-Null
  }
}
if ($legacyBlockFailures.Count -gt 0) {
  Add-Fail 'E.nonCanonicalBlocks: one or more known non-canonical scripts are not explicitly blocked'
}

$signingEnvChecks = @(
  'BLYP_RELEASE_STORE_FILE',
  'BLYP_RELEASE_STORE_PASSWORD',
  'BLYP_RELEASE_KEY_ALIAS',
  'BLYP_RELEASE_KEY_PASSWORD'
)

$missingSigning = New-Object System.Collections.Generic.List[string]
foreach ($name in $signingEnvChecks) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    $missingSigning.Add($name) | Out-Null
  }
}
if ($missingSigning.Count -gt 0) {
  Add-Fail "E.signingEnv: missing required signing env vars: $($missingSigning -join ', ')"
}

$storeFile = [Environment]::GetEnvironmentVariable('BLYP_RELEASE_STORE_FILE')
$storeFileExists = $false
if (-not [string]::IsNullOrWhiteSpace($storeFile)) {
  $storeFileExists = Test-Path -LiteralPath $storeFile
  if (-not $storeFileExists) {
    Add-Fail "E.signingStoreFile: BLYP_RELEASE_STORE_FILE path not found: $storeFile"
  }
}

$mutableOutputPath = Join-Path $RepoRoot 'android\app\build\outputs\bundle\release\app-release.aab'
$mutableOutputExists = Test-Path -LiteralPath $mutableOutputPath
if ($mutableOutputExists) {
  Add-Fail 'E.mutableOutput: mutable output path already contains app-release.aab (stale provenance risk)'
}

Write-Lines -Path (Join-Path $packetRoot '05_release_path_safety.txt') -Lines @(
  "CHECK_CANONICAL_PATH_ONLY=$(if ($canonicalExists) { 'PASS' } else { 'FAIL' })"
  "CHECK_NON_CANONICAL_BLOCKS=$(if ($legacyBlockFailures.Count -eq 0) { 'PASS' } else { 'FAIL' })"
  "CHECK_NO_LOOPBACK_RELEASE_CONFIG=$(if ($liveLoopbackHits.Count -eq 0) { 'PASS' } else { 'FAIL' })"
  "CHECK_SIGNING_ENV_PRESENT=$(if ($missingSigning.Count -eq 0) { 'PASS' } else { 'FAIL' })"
  "CHECK_SIGNING_STORE_FILE_EXISTS=$(if ([string]::IsNullOrWhiteSpace($storeFile) -or $storeFileExists) { 'PASS' } else { 'FAIL' })"
  "CHECK_MUTABLE_OUTPUT_STALE=$(if (-not $mutableOutputExists) { 'PASS' } else { 'FAIL' })"
  "MUTABLE_OUTPUT_PATH=$mutableOutputPath"
  "MUTABLE_OUTPUT_EXISTS=$(if ($mutableOutputExists) { 'YES' } else { 'NO' })"
) + $legacyBlockFailures

# ---------------------------------------------------------------------------
# F) Post-build proof contract definition + enforcement model
# ---------------------------------------------------------------------------
Write-Lines -Path (Join-Path $packetRoot '06_enforcement_model.txt') -Lines @(
  'ENFORCEMENT_MODEL=HARD_COUPLED_CANONICAL_GATE_CHECK'
  'SUMMARY=BUILD_RELEASE_CANDIDATE.ps1 requires a fresh PASS gate packet for same BRANCH+GIT_HEAD+EXPECTED_VERSION_CODE before build can proceed.'
  'FRESHNESS_POLICY=Gate UTC must be within 12 hours of canonical build start.'
  'MATCH_POLICY=BRANCH, GIT_HEAD, EXPECTED_VERSION_CODE must exactly match current canonical invocation.'
  'POST_BUILD_PROOF_CONTRACT_REQUIRED_FIELDS=branch,HEAD,versionCode,versionName,frozen AAB path,size bytes,SHA-256,critical gate summary'
  'POST_BUILD_PROOF_PACKET_EXPECTED_FILES=00_summary.txt,12_artifact_meta.txt,03_release_config_guard.txt'
)

$changedLines = @(git status --short)
$filesChangedLines = @(
  "UTC=$((Get-Date).ToUniversalTime().ToString('o'))"
  "BRANCH=$branch"
  "GIT_HEAD=$gitHead"
)
$filesChangedLines += 'GIT_STATUS_SHORT_BEGIN'
$filesChangedLines += $changedLines
$filesChangedLines += 'GIT_STATUS_SHORT_END'
Write-Lines -Path (Join-Path $packetRoot '07_files_changed.txt') -Lines $filesChangedLines

$result = if ($fails.Count -eq 0) { 'PASS' } else { 'FAIL' }
$failItems = @($fails.ToArray())
$warnItems = @($warns.ToArray())
Write-Lines -Path (Join-Path $packetRoot '08_final_verdict.txt') -Lines @(
  "RESULT=$result"
  "UTC=$((Get-Date).ToUniversalTime().ToString('o'))"
  "GATE_PACKET_REL=$packetRel"
  "BRANCH=$branch"
  "GIT_HEAD=$gitHead"
  "EXPECTED_VERSION_CODE=$ExpectedVersionCode"
  "ACTUAL_VERSION_CODE=$($metadata.VersionCode)"
  "VERSION_NAME=$($metadata.VersionName)"
  "CLEAN_TREE=$(if ($isCleanTree) { 'YES' } else { 'NO' })"
  "FAIL_COUNT=$($fails.Count)"
  "WARN_COUNT=$($warns.Count)"
  "FIRST_FAIL=$(if ($failItems.Count -gt 0) { $failItems[0] } else { '' })"
)
$verdictLines = @(
  "RESULT=$result"
  "UTC=$((Get-Date).ToUniversalTime().ToString('o'))"
  "GATE_PACKET_REL=$packetRel"
  "BRANCH=$branch"
  "GIT_HEAD=$gitHead"
  "EXPECTED_VERSION_CODE=$ExpectedVersionCode"
  "ACTUAL_VERSION_CODE=$($metadata.VersionCode)"
  "VERSION_NAME=$($metadata.VersionName)"
  "CLEAN_TREE=$(if ($isCleanTree) { 'YES' } else { 'NO' })"
  "FAIL_COUNT=$($fails.Count)"
  "WARN_COUNT=$($warns.Count)"
  "FIRST_FAIL=$(if ($failItems.Count -gt 0) { $failItems[0] } else { '' })"
)
$verdictLines += 'FAILS_BEGIN'
$verdictLines += $failItems
$verdictLines += 'FAILS_END'
$verdictLines += 'WARNS_BEGIN'
$verdictLines += $warnItems
$verdictLines += 'WARNS_END'
Write-Lines -Path (Join-Path $packetRoot '08_final_verdict.txt') -Lines $verdictLines

Write-Lines -Path (Join-Path $packetRoot '00_summary.txt') -Lines @(
  "RESULT=$result"
  "PACKET_REL=$packetRel"
  "UTC=$((Get-Date).ToUniversalTime().ToString('o'))"
  "BRANCH=$branch"
  "GIT_HEAD=$gitHead"
  "EXPECTED_VERSION_CODE=$ExpectedVersionCode"
  "ACTUAL_VERSION_CODE=$($metadata.VersionCode)"
  "VERSION_NAME=$($metadata.VersionName)"
  "FAIL_COUNT=$($fails.Count)"
  "WARN_COUNT=$($warns.Count)"
)

Write-Host "GATE_PACKET=$packetRoot"
Write-Host "GATE_RESULT=$result"

if ($fails.Count -gt 0) {
  throw "PRE_RELEASE_REGRESSION_GATE_FAILED: $($fails[0]). See $packetRel\\08_final_verdict.txt"
}
