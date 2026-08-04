<#
.SYNOPSIS
  Allocates a globally-unique, strictly-increasing Android versionCode and writes it
  into android/app/build.gradle, so a Play "version code already used" rejection is
  structurally impossible.

.DESCRIPTION
  New code = max(timeFloor, currentGradle + 1, ledgerMax + 1)
    - timeFloor    : 2026000000 + whole minutes since 2026-01-01T00:00:00Z.
                     Keeps the value inside the 2.02-2.1 billion band Google already
                     has on file (so it always reads as "newer") and advances every
                     minute on its own. ~140 years of headroom before the 2.1B ceiling.
    - currentGradle: whatever is in build.gradle right now (+1 guarantees increase).
    - ledgerMax    : the highest code we have EVER produced (+1 guarantees no reuse,
                     even for multiple builds inside the same minute).
  The chosen code is appended to tools/release/versioncode_ledger.txt (committed),
  which is the durable memory that makes duplication impossible across builds/machines.

.OUTPUTS
  Writes "VERSION_CODE=<n>" to stdout (last line) for the caller to capture.
#>
param(
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$GradlePath = Join-Path $RepoRoot 'android\app\build.gradle'
$LedgerPath = Join-Path $PSScriptRoot 'versioncode_ledger.txt'

if (-not (Test-Path -LiteralPath $GradlePath)) { throw "ABORT: build.gradle not found at $GradlePath" }

$ANDROID_MAX = 2100000000  # Google Play hard ceiling for versionCode.

# --- current value from build.gradle ---
$gradleText = Get-Content -Raw -LiteralPath $GradlePath
$m = [regex]::Match($gradleText, '(?m)^(?<indent>\s*)versionCode\s+(?<code>\d+)\s*$')
if (-not $m.Success) { throw 'ABORT: versionCode line not found in build.gradle' }
$currentGradle = [long]$m.Groups['code'].Value

# --- ledger max ---
$ledgerMax = 0L
$ledgerLines = @()
if (Test-Path -LiteralPath $LedgerPath) {
  $ledgerLines = Get-Content -LiteralPath $LedgerPath
  foreach ($line in $ledgerLines) {
    $t = ($line | Out-String).Trim()
    if ($t -match '^\d+$') {
      $v = [long]$t
      if ($v -gt $ledgerMax) { $ledgerMax = $v }
    }
  }
}

# --- time floor (minute resolution, kept in the existing 2.02B band) ---
$epoch    = [DateTime]::SpecifyKind([DateTime]'2026-01-01T00:00:00', [DateTimeKind]::Utc)
$nowUtc   = (Get-Date).ToUniversalTime()
$minutes  = [long][math]::Floor(($nowUtc - $epoch).TotalMinutes)
$timeFloor = 2026000000L + $minutes

# --- choose strictly-increasing, never-before-used code ---
$next = [Math]::Max($timeFloor, [Math]::Max($currentGradle + 1, $ledgerMax + 1))

if ($next -ge $ANDROID_MAX) {
  throw "ABORT: computed versionCode $next exceeds Android ceiling $ANDROID_MAX."
}

Write-Host "current(build.gradle)=$currentGradle  ledgerMax=$ledgerMax  timeFloor=$timeFloor  ->  next=$next"

if ($DryRun) {
  Write-Host "DRY-RUN: no files changed."
  Write-Output "VERSION_CODE=$next"
  return
}

# --- write back to build.gradle (preserve indentation) ---
$indent = $m.Groups['indent'].Value
$updated = [regex]::Replace($gradleText, '(?m)^(\s*)versionCode\s+\d+\s*$', ("`${1}versionCode $next"), 1)
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($GradlePath, $updated, $enc)

# --- append to ledger ---
Add-Content -LiteralPath $LedgerPath -Value $next

Write-Host "OK: build.gradle versionCode set to $next and recorded in ledger."
Write-Output "VERSION_CODE=$next"
