param(
  [string]$HostSerial   = "R5CX71NM1RK",
  [string]$ViewerSerial = "RFCY71ZFS6F",
  [int]$KeepAliveMinutes = 30,
  [int]$BackendPort = 4000,
  [switch]$ClearDeviceLogs,
  [string]$BackendCmd,
  [string]$MetroCmd
)

$ErrorActionPreference = "Stop"

function Resolve-Root { (Resolve-Path ".").Path }
function Ensure-Dir([string]$p){ if(-not(Test-Path $p)){ New-Item -ItemType Directory -Path $p | Out-Null } }
function Prefer-Shell { if(Get-Command pwsh -ErrorAction SilentlyContinue){ "pwsh" } else { "powershell" } }

function Start-External([string]$Title,[string]$Command){
  $shell = Prefer-Shell
  $args = @("-NoExit","-ExecutionPolicy","Bypass","-Command","`$Host.UI.RawUI.WindowTitle='$Title'; $Command")
  Start-Process $shell -ArgumentList $args | Out-Null
}

function ADB-Reset { & adb kill-server | Out-Null; & adb start-server | Out-Null }

function Require-Device([string]$serial){
  $out = (& adb devices) -join "`n"
  if($out -notmatch [regex]::Escape($serial)){
    Write-Host "[X] Device not detected: $serial" -ForegroundColor Red
    Write-Host $out
    exit 1
  }
}

function Maybe-Clear-Logcat([string]$serial){
  if($ClearDeviceLogs){
    Write-Host "[CLEAR] Clearing logcat buffer on $serial"
    & adb -s $serial logcat -c | Out-Null
  }
}

function Kill-Port([int]$port){
  $c = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if($c){
    $procId = $c.OwningProcess
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if($p){
      Write-Host "[WARN] Port $port in use by $($p.ProcessName) PID=$procId - killing"
      Stop-Process -Id $procId -Force
      Start-Sleep -Seconds 1
    }
  }
}

function Detect-BackendCmd{
  if($BackendCmd){ return $BackendCmd }
  $root = Resolve-Root

  $svc = Join-Path $root "blyp-live-service"
  if(Test-Path (Join-Path $svc "package.json")){
    return "cd `"$svc`"; npm run dev 2>&1"
  }

  throw 'No backend command detected. Pass -BackendCmd "cd PATH; COMMAND"'
}

function Detect-MetroCmd{
  if($MetroCmd){ return $MetroCmd }
  $root = Resolve-Root
  return "cd `"$root`"; npx expo start --dev-client --clear 2>&1"
}

$root = Resolve-Root
$logs = Join-Path $root "logs"
Ensure-Dir $logs
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

$hostLog   = Join-Path $logs "host_logcat_$ts.log"
$viewerLog = Join-Path $logs "viewer_logcat_$ts.log"
$backendLog= Join-Path $logs "backend_$ts.log"
$metroLog  = Join-Path $logs "metro_$ts.log"

Write-Host "=== START_TEST_STACK ==="
Write-Host "ROOT:   $root"
Write-Host "HOST:   $HostSerial"
Write-Host "VIEWER: $ViewerSerial"
Write-Host "LOGS:"
Write-Host "  HOST:   $hostLog"
Write-Host "  VIEWER: $viewerLog"
Write-Host "  BACKEND:$backendLog"
Write-Host "  METRO:  $metroLog"
Write-Host ""

ADB-Reset
Require-Device $HostSerial
Require-Device $ViewerSerial

Maybe-Clear-Logcat $HostSerial
Maybe-Clear-Logcat $ViewerSerial

Kill-Port $BackendPort

$backend = Detect-BackendCmd
$metro   = Detect-MetroCmd

Start-External "BLYP LOGCAT HOST ($HostSerial)"     "adb -s $HostSerial logcat -v time | Tee-Object -FilePath `"$hostLog`""
Start-External "BLYP LOGCAT VIEWER ($ViewerSerial)" "adb -s $ViewerSerial logcat -v time | Tee-Object -FilePath `"$viewerLog`""
Start-External "BLYP BACKEND" "$backend | Tee-Object -FilePath `"$backendLog`""
Start-External "BLYP METRO (--clear)" "$metro | Tee-Object -FilePath `"$metroLog`""

Write-Host ""
Write-Host "=== YOU DRIVE (NO TIMEOUTS) ==="
Write-Host "1) HOST: open app -> sign in -> Go Live -> press Go Live ONCE."
Write-Host "2) VIEWER: open app -> sign in -> Live Users -> tap the live entry."
Write-Host ""
Write-Host "Keep-alive: $KeepAliveMinutes minutes. Press ENTER to finish early."
Write-Host ""

$end = (Get-Date).AddMinutes($KeepAliveMinutes)
while((Get-Date) -lt $end){
  if([Console]::KeyAvailable){
    $k = [Console]::ReadKey($true)
    if($k.Key -eq "Enter"){ break }
  }
  Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "[DONE] Capture done. Logs saved in: $logs"
Write-Host "Paste back (if present):"
Write-Host "  [HOST][SESSION_CREATED]"
Write-Host "  [VIEWER][JOIN_REQUEST]"
Write-Host "  [LIVE_API][JOIN_REALTIME]"
