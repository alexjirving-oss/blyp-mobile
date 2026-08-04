param(
  [Parameter(Mandatory=$true)][string]$HostLogPath,
  [Parameter(Mandatory=$true)][string]$ViewerLogPath,
  [string]$OutPath,
  [int]$MinNetRxTicks = 10,
  [int]$MinNetRxBytesTotal = 250000
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($OutPath)) {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $OutPath = Join-Path $repoRoot 'artifacts\ci\scoreboard.txt'
}

$ciDir = Split-Path -Parent $OutPath
if (-not (Test-Path $ciDir)) {
  New-Item -ItemType Directory -Path $ciDir -Force | Out-Null
}

if (-not (Test-Path $HostLogPath)) { throw "Host log missing: $HostLogPath" }
if (-not (Test-Path $ViewerLogPath)) { throw "Viewer log missing: $ViewerLogPath" }

function Count-InFile([string]$path, [string]$pattern) {
  (Select-String -Path $path -Pattern $pattern -ErrorAction SilentlyContinue).Count
}

function Get-HasTag([string]$path, [string]$tag) {
  # logcat -v time emits: "MM-DD HH:MM:SS.mmm  <prio>/<TAG>(pid): message"
  $pat = "/$([regex]::Escape($tag))\("
  return (Select-String -Path $path -Pattern $pat -ErrorAction SilentlyContinue -List) -ne $null
}

function Get-NetTotals([string]$path, [string]$role) {
  $ticks = 0
  $total = 0
  # Capture tick + totalBytes regardless of ordering within the log line.
  $rxRe = [regex]"\[IVS_PROOF\]\[(?:netRxTick|netRxDelta)\].*\brole=$role\b(?=.*\btotalBytes=(\d+)\b)(?=.*\b(?:tick|ticks)=(\d+)\b)"

  # Windows adb/logcat can hard-wrap long lines into continuation lines that do NOT start with the
  # logcat timestamp prefix. Reconstruct a logical line by concatenating continuations.
  $buf = $null
  foreach ($line in (Get-Content -Path $path -ErrorAction SilentlyContinue)) {
    if ($line -match '^[0-1][0-9]-[0-3][0-9]\s') {
      if ($null -ne $buf) {
        $mm = $rxRe.Match($buf)
        if ($mm.Success) {
          $t = [int]$mm.Groups[2].Value
          $b = [long]$mm.Groups[1].Value
          if ($t -gt $ticks) { $ticks = $t }
          if ($b -gt $total) { $total = $b }
        }
      }
      $buf = $line
    } else {
      if ($null -ne $buf) {
        $buf += $line
      }
    }
  }
  if ($null -ne $buf) {
    $mm = $rxRe.Match($buf)
    if ($mm.Success) {
      $t = [int]$mm.Groups[2].Value
      $b = [long]$mm.Groups[1].Value
      if ($t -gt $ticks) { $ticks = $t }
      if ($b -gt $total) { $total = $b }
    }
  }
  return @($ticks, $total)
}

$patRemoteAdded = "Emitting event 'IVS_REMOTE_VIDEO_ADDED'|\[IVS_BRIDGE\]\[REMOTE_VIDEO_ADDED\]"
$patRemoteBoundSlot0 = "\[IVS_NATIVE\]\[REMOTE_VIDEO_BOUND\].*(slot=0|slotId=0)"
$patPreviewAttached = "\[IVS_PREVIEW\]\[ATTACHED\]"
$patNetRxStall = "\[IVS_PROOF\]\[netRxStall\]"

$hostRemoteAdded = Count-InFile $HostLogPath $patRemoteAdded
$viewerRemoteAdded = Count-InFile $ViewerLogPath $patRemoteAdded
$viewerRemoteBoundSlot0 = Count-InFile $ViewerLogPath $patRemoteBoundSlot0
$viewerPreviewAttached = Count-InFile $ViewerLogPath $patPreviewAttached

$hostHasNative = Get-HasTag $HostLogPath 'IVS_NATIVE'
$viewerHasNative = Get-HasTag $ViewerLogPath 'IVS_NATIVE'
$hostHasProof = Get-HasTag $HostLogPath 'IVS_PROOF'
$viewerHasProof = Get-HasTag $ViewerLogPath 'IVS_PROOF'
$hostHasStage = Get-HasTag $HostLogPath 'IVS_STAGE'
$viewerHasStage = Get-HasTag $ViewerLogPath 'IVS_STAGE'

$captureHasNative = ($hostHasNative -and $viewerHasNative)
$captureHasProof = ($hostHasProof -and $viewerHasProof)
$captureHasStage = ($hostHasStage -and $viewerHasStage)

$hostStall = (Count-InFile $HostLogPath $patNetRxStall) -gt 0
$viewerStall = (Count-InFile $ViewerLogPath $patNetRxStall) -gt 0

$hostNet = Get-NetTotals $HostLogPath 'host'
$hostNetTicks = [int]$hostNet[0]
$hostNetBytesTotal = [long]$hostNet[1]

$viewerNet = Get-NetTotals $ViewerLogPath 'viewer'
$viewerNetTicks = [int]$viewerNet[0]
$viewerNetBytesTotal = [long]$viewerNet[1]

# --- Stability (strict: must parse PASS/FAIL) ---
$stable = 'FAIL'
try {
  $flapsOut = & (Join-Path $PSScriptRoot 'extract_ivs_flaps.ps1') -HostLogPath $HostLogPath -ViewerLogPath $ViewerLogPath | Out-String
  $m = [regex]::Match($flapsOut, 'SOAK_STREAM_STABLE:\s*(PASS|FAIL)')
  if ($m.Success) { $stable = $m.Groups[1].Value }
} catch {
  $stable = 'FAIL'
}

# --- Guest E2E (strict: must be PASS) ---
$guest = 'FAIL'
try {
  $guestOut = & (Join-Path $PSScriptRoot 'extract_ci_guest_signals.ps1') -HostLogPath $HostLogPath -ViewerLogPath $ViewerLogPath | Out-String
  $m = [regex]::Match($guestOut, 'CI_GUEST_E2E:\s*(PASS|FAIL)')
  if ($m.Success) { $guest = $m.Groups[1].Value }
} catch {
  $guest = 'FAIL'
}

# --- OVERALL PASS criteria (45s capture, strict) ---
$overallPass = $true

if ($guest -ne 'PASS') { $overallPass = $false }
if ($stable -ne 'PASS') { $overallPass = $false }

if (-not $captureHasNative) { $overallPass = $false }
if (-not $captureHasProof) { $overallPass = $false }
if (-not $captureHasStage) { $overallPass = $false }

if ($viewerRemoteBoundSlot0 -lt 1) { $overallPass = $false }
if ($hostRemoteAdded -lt 1 -or $viewerRemoteAdded -lt 1) { $overallPass = $false }

if ($viewerNetTicks -lt $MinNetRxTicks -or $viewerNetBytesTotal -lt $MinNetRxBytesTotal) { $overallPass = $false }
if ($hostNetTicks -lt $MinNetRxTicks -or $hostNetBytesTotal -lt $MinNetRxBytesTotal) { $overallPass = $false }

if ($hostStall -or $viewerStall) { $overallPass = $false }

$lines = @(
  "CI_GUEST_E2E=$guest",
  "SOAK_STREAM_STABLE=$stable",
  "HOST_REMOTE_VIDEO_ADDED=$hostRemoteAdded",
  "VIEWER_REMOTE_VIDEO_ADDED=$viewerRemoteAdded",
  "VIEWER_REMOTE_VIDEO_BOUND_SLOT0=$viewerRemoteBoundSlot0",
  "VIEWER_PREVIEW_ATTACHED=$viewerPreviewAttached",
  "HOST_NETRX_TICKS=$hostNetTicks",
  "VIEWER_NETRX_TICKS=$viewerNetTicks",
  "HOST_NETRX_BYTES_TOTAL=$hostNetBytesTotal",
  "VIEWER_NETRX_BYTES_TOTAL=$viewerNetBytesTotal",
  "OVERALL=$(if($overallPass){'PASS'}else{'FAIL'})"
)

Set-Content -Path $OutPath -Value $lines -Encoding UTF8

[pscustomobject]@{
  Ok = $overallPass
  OutPath = $OutPath
}
