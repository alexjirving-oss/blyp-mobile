param(
  [Parameter(Mandatory=$true)][string]$HostSerial,
  [Parameter(Mandatory=$true)][string]$ViewerSerial,
  [int]$KeepAliveMinutes = 45,
  [switch]$ClearDeviceLogs,
  [switch]$UseAdbReverse,
  [switch]$NoWait,
  [int]$BackendPort = 4000,
  [int]$MetroPort = 8081,
  [int]$FunctionsPort = 5001
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Cmd([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "Missing '$name' in PATH." }
}

function Get-BackendCommand {
  $candidates = @("backend/blyp-live-service","blyp-live-service","backend","server","api","functions")
  foreach ($dir in $candidates) {
    $pkgPath = Join-Path $dir "package.json"
    if (Test-Path $pkgPath) {
      try {
        $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
        $scripts = $pkg.scripts
        if ($scripts.dev)   { return @{ Dir=$dir; Cmd="npm run dev" } }
        if ($scripts.serve) { return @{ Dir=$dir; Cmd="npm run serve" } }
        if ($scripts.start) { return @{ Dir=$dir; Cmd="npm run start" } }
      } catch { }
    }
  }
  # Fallback: assume blyp-live-service dev
  if (Test-Path "blyp-live-service/package.json") { return @{ Dir="blyp-live-service"; Cmd="npm run dev" } }
  throw "Could not auto-detect backend dir/command. Put backend in blyp-live-service or add a scripts.dev/serve/start."
}

function Start-PSWindow([string]$title, [string]$command, [string]$workdir) {
  $arg = @(
    "-NoLogo","-NoExit",
    "-Command", "try { `$host.ui.RawUI.WindowTitle='$title'; cd '$workdir'; $command } catch { Write-Host `$_.ToString() -ForegroundColor Red; pause }"
  )
  Start-Process "powershell.exe" -ArgumentList $arg | Out-Null
}

Assert-Cmd "adb"
Assert-Cmd "node"
Assert-Cmd "npx"

adb start-server | Out-Null
$devices = (adb devices) -join "`n"
if ($devices -notmatch [regex]::Escape($HostSerial))  { throw "Host device not found: $HostSerial`n$devices" }
if ($devices -notmatch [regex]::Escape($ViewerSerial)){ throw "Viewer device not found: $ViewerSerial`n$devices" }

$root = (Resolve-Path ".").Path
$logs = Join-Path $root "logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$hostLog   = Join-Path $logs "logcat_host_$ts.log"
$viewerLog = Join-Path $logs "logcat_viewer_$ts.log"

if ($ClearDeviceLogs) {
  adb -s $HostSerial logcat -c | Out-Null
  adb -s $ViewerSerial logcat -c | Out-Null
}

if ($UseAdbReverse) {
  # lets you use http://127.0.0.1:* from device over USB (canonical for Windows two-phone testing)
  foreach ($p in @($MetroPort, $BackendPort, $FunctionsPort)) {
    adb -s $HostSerial reverse "tcp:$p" "tcp:$p" | Out-Null
    adb -s $ViewerSerial reverse "tcp:$p" "tcp:$p" | Out-Null
  }
  Write-Host "[ADB REVERSE] tcp:$MetroPort,$BackendPort,$FunctionsPort -> tcp:$MetroPort,$BackendPort,$FunctionsPort on both devices"
}

$backend = Get-BackendCommand
Write-Host "[BACKEND] $($backend.Dir) :: $($backend.Cmd)"
Write-Host "[LOGS] host=$hostLog"
Write-Host "[LOGS] viewer=$viewerLog"

# Backend window
Start-PSWindow "BLYP BACKEND" $backend.Cmd (Join-Path $root $backend.Dir)

# Metro window (dev client)
$metroCmd = "npx expo start --dev-client --clear --host localhost --port $MetroPort"
Start-PSWindow "BLYP METRO" $metroCmd $root

# Logcat windows
Start-PSWindow "LOGCAT HOST ($HostSerial)"   "adb -s $HostSerial logcat -v time *:V | Tee-Object -FilePath '$hostLog'" $root
Start-PSWindow "LOGCAT VIEWER ($ViewerSerial)" "adb -s $ViewerSerial logcat -v time *:V | Tee-Object -FilePath '$viewerLog'" $root

Write-Host ""
Write-Host "DO THIS NOW:"
Write-Host "  1) On HOST phone: open Blyp dev build -> Go Live"
Write-Host "  2) On VIEWER phone: open Live list -> tap stream to join"
Write-Host ""
if ($NoWait) {
  Write-Host "Stack started (NoWait). Close spawned windows when done."
} else {
  Write-Host "Stack running for $KeepAliveMinutes minutes. Logs saved under /logs."
  Start-Sleep -Seconds ($KeepAliveMinutes * 60)
}
