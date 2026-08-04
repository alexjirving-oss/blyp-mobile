param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('services','live','e2e','capture')]
  [string]$Mode,

  [string]$HostSerial = 'R5CX71NM1RK',
  [string]$ViewerSerial = 'RFCY71ZFS6F',

  [int]$KeepAliveMinutes = 45,

  [bool]$UseAdbReverse = $true,
  [bool]$ClearDeviceLogs = $true,
  [int]$BackendPort = 4000,

  [switch]$SkipBuild,
  [int]$AutoCaptureDelaySec = 0,

  # capture-mode options
  [switch]$ClearBefore,
  [int]$Seconds = 0,

  # passthrough convenience
  [switch]$NoWait
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-Directory {
  param([Parameter(Mandatory=$true)][string]$Path)
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Get-RepoRoot {
  $root = Resolve-Path (Join-Path $PSScriptRoot '..')
  return $root.Path
}

function Get-GitInfo {
  param([string]$RepoRoot)

  $branch = '(unknown)'
  $commit = '(unknown)'
  try {
    $branch = (git -C $RepoRoot branch --show-current 2>$null).Trim()
    if ([string]::IsNullOrWhiteSpace($branch)) { $branch = '(detached)' }
  } catch {}

  try {
    $commit = (git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
    if ([string]::IsNullOrWhiteSpace($commit)) { $commit = '(unknown)' }
  } catch {}

  return [pscustomobject]@{ Branch = $branch; Commit = $commit }
}

function New-RunFolder {
  param(
    [Parameter(Mandatory=$true)][string]$RepoRoot,
    [Parameter(Mandatory=$true)][string]$ModeName,
    [Parameter(Mandatory=$true)][string]$HostSerialValue,
    [Parameter(Mandatory=$true)][string]$ViewerSerialValue
  )

  $runsRoot = Join-Path $RepoRoot 'logs\runs'
  Ensure-Directory -Path $runsRoot

  $ts = Get-Date -Format 'yyyyMMdd_HHmmss'
  $runDir = Join-Path $runsRoot $ts
  Ensure-Directory -Path $runDir

  $git = Get-GitInfo -RepoRoot $RepoRoot
  $infoPath = Join-Path $runDir 'RUN_INFO.txt'
  @(
    "time_utc=$((Get-Date).ToUniversalTime().ToString('o'))",
    "time_local=$((Get-Date).ToString('o'))",
    "mode=$ModeName",
    "host_serial=$HostSerialValue",
    "viewer_serial=$ViewerSerialValue",
    "backend_port=$BackendPort",
    "git_branch=$($git.Branch)",
    "git_commit=$($git.Commit)",
    "repo_root=$RepoRoot"
  ) | Set-Content -Path $infoPath -Encoding UTF8

  $latestPath = Join-Path $runsRoot 'LATEST.txt'
  $runDir | Set-Content -Path $latestPath -Encoding UTF8

  return $runDir
}

function Resolve-LatestRunFolder {
  param([Parameter(Mandatory=$true)][string]$RepoRoot)

  $runsRoot = Join-Path $RepoRoot 'logs\runs'
  if (-not (Test-Path $runsRoot)) { return $null }

  $latestTxt = Join-Path $runsRoot 'LATEST.txt'
  if (Test-Path $latestTxt) {
    try {
      $p = (Get-Content -Path $latestTxt -ErrorAction Stop | Select-Object -First 1).Trim()
      if (-not [string]::IsNullOrWhiteSpace($p) -and (Test-Path $p)) { return $p }
    } catch {}
  }

  $dirs = Get-ChildItem -Path $runsRoot -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
  if ($dirs -and $dirs.Count -gt 0) { return $dirs[0].FullName }
  return $null
}

$repoRoot = Get-RepoRoot

if ($Mode -ne 'capture') {
  $runDir = New-RunFolder -RepoRoot $repoRoot -ModeName $Mode -HostSerialValue $HostSerial -ViewerSerialValue $ViewerSerial
  Write-Host "[BLYP] Run folder: $runDir" -ForegroundColor Cyan
} else {
  $runDir = Resolve-LatestRunFolder -RepoRoot $repoRoot
  if (-not $runDir) {
    $runDir = New-RunFolder -RepoRoot $repoRoot -ModeName 'capture' -HostSerialValue $HostSerial -ViewerSerialValue $ViewerSerial
  }
  Write-Host "[BLYP] Using run folder: $runDir" -ForegroundColor Cyan
}

switch ($Mode) {
  'services' {
    $svc = Join-Path $repoRoot 'check-and-start-services.ps1'
    & powershell -NoLogo -ExecutionPolicy Bypass -File $svc
    break
  }

  'live' {
    $live = Join-Path $PSScriptRoot 'start_live_stack_2phones.ps1'

    $args = @(
      '-NoLogo','-ExecutionPolicy','Bypass','-File', $live,
      '-HostSerial', $HostSerial,
      '-ViewerSerial', $ViewerSerial,
      '-KeepAliveMinutes', $KeepAliveMinutes,
      '-BackendPort', $BackendPort
    )

    if ($ClearDeviceLogs) { $args += '-ClearDeviceLogs' }
    if ($UseAdbReverse)   { $args += '-UseAdbReverse' }
    if ($NoWait)          { $args += '-NoWait' }

    & powershell @args
    break
  }

  'e2e' {
    $e2e = Join-Path $PSScriptRoot 'run_e2e_proof.ps1'

    $args = @(
      '-NoLogo','-ExecutionPolicy','Bypass','-File', $e2e,
      '-HostSerial', $HostSerial,
      '-ViewerSerial', $ViewerSerial,
      '-KeepAliveMinutes', $KeepAliveMinutes,
      '-AutoCaptureDelaySec', $AutoCaptureDelaySec
    )

    if ($SkipBuild) { $args += '-SkipBuild' }

    & powershell @args
    break
  }

  'capture' {
    $cap = Join-Path $PSScriptRoot 'capture_two_phone_logs.ps1'

    $args = @(
      '-NoLogo','-ExecutionPolicy','Bypass','-File', $cap,
      '-HostSerial', $HostSerial,
      '-ViewerSerial', $ViewerSerial,
      '-OutDir', $runDir,
      '-Seconds', $Seconds
    )

    if ($ClearBefore) { $args += '-ClearBefore' }

    & powershell @args
    break
  }
}
