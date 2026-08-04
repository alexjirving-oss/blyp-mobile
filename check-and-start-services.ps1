param(
  [switch]$Restart,
  [string]$HostSerial = "",
  [string]$ViewerSerial = ""
)

$ErrorActionPreference="Continue"

# Ensure all child processes (Metro/backends) start from the repo root, not whatever
# working directory PowerShell happened to be launched from.
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".")).Path
Set-Location $RepoRoot

# Ensure audit logs folder exists for Start-Process redirection.
New-Item -ItemType Directory -Force (Join-Path $RepoRoot "audit") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $RepoRoot "audit\logs") | Out-Null

function Stop-ListeningPorts([int[]]$Ports) {
  foreach($p in $Ports){
    $owningPids = @(Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach($procId in ($owningPids | Where-Object { $_ -and $_ -ne 0 })){
      try {
        Write-Host "Stopping PID $procId (port $p)"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      } catch { }
    }
  }
}

function Reset-AdbReverse([string]$Serial) {
  if ([string]::IsNullOrWhiteSpace($Serial)) { return }
  try {
    $list = (adb devices) -join "`n"
    if ($list -notmatch ("(?m)^" + [regex]::Escape($Serial) + "\s+device")) {
      return
    }
  } catch { return }
  try { adb -s $Serial reverse --remove-all | Out-Null } catch { }
  foreach($p in @(8081,4000,5001)){
    try { adb -s $Serial reverse "tcp:$p" "tcp:$p" | Out-Null } catch { }
  }
}

Write-Host "=== Reading PIDs from audit\COMMANDS_RUN.txt ==="
$pids = @{}
$lines = Select-String -Path "audit\COMMANDS_RUN.txt" -Pattern "BACKEND_DEV_PID=|FUNCTIONS_SERVE_PID=|METRO_PID=|LOGCAT_PID=" -ErrorAction SilentlyContinue |
  ForEach-Object { $_.Line.Trim() }

$lines | ForEach-Object {
  if ($_ -match "^(BACKEND_DEV_PID|FUNCTIONS_SERVE_PID|METRO_PID|LOGCAT_PID)=(\d+)$") {
    $pids[$matches[1]] = [int]$matches[2]
  }
}

$pids.GetEnumerator() | Sort-Object Name | ForEach-Object { "{0}={1}" -f $_.Name,$_.Value }

if ($Restart) {
  Write-Host "=== Restart requested: stopping known services + freeing ports ==="

  # Stop by last-known PIDs first (if present)
  foreach ($k in @('BACKEND_DEV_PID','FUNCTIONS_SERVE_PID','METRO_PID','LOGCAT_PID')) {
    if ($pids.ContainsKey($k)) {
      $procId = $pids[$k]
      try {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) {
          Write-Host "Stopping $k PID=$procId Name=$($p.ProcessName)"
          Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
      } catch { }
    }
  }

  # Then stop anything still listening on key dev ports.
  Stop-ListeningPorts -Ports @(8081,19000,19001,19002,4000,5001,3001)

  # Reset adb + reverse rules (optional)
  try { adb kill-server | Out-Null } catch { }
  try { adb start-server | Out-Null } catch { }
  Start-Sleep -Milliseconds 500
  Reset-AdbReverse -Serial $HostSerial
  Reset-AdbReverse -Serial $ViewerSerial
  if ($HostSerial -or $ViewerSerial) {
    Write-Host "ADB reverse reset for: HOST='$HostSerial' VIEWER='$ViewerSerial'"
  }

  Start-Sleep -Milliseconds 400
}

Write-Host "`n=== Checking processes by PID ==="
foreach ($k in $pids.Keys) {
  $procId = $pids[$k]
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p) { Write-Host "RUNNING  $k  PID=$procId  Name=$($p.ProcessName)" }
  else    { Write-Host "STOPPED  $k  PID=$procId" }
}

Write-Host "`n=== Checking key ports (LISTEN) ==="
$ports = 8081,19000,19001,19002,4000,5001,3001
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $ports -contains $_.LocalPort } |
  Select-Object LocalAddress,LocalPort,OwningProcess |
  Sort-Object LocalPort |
  Format-Table -AutoSize

Write-Host "`n=== Starting missing services (best-effort) ==="

# Start backend dev if present and not already listening on 4000
$backendPath = "backend\blyp-live-service"
if (Test-Path "$backendPath\package.json") {
  $listening4000 = (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 4000 } | Select-Object -First 1)
  if (-not $listening4000) {
    Write-Host "Starting backend dev..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd $backendPath && npm run dev" `
      -RedirectStandardOutput "audit\logs\backend_dev.log" -RedirectStandardError "audit\logs\backend_dev.err.log" -WindowStyle Hidden
  } else {
    Write-Host "Backend looks up (port 4000 listening)."
  }
} else {
  Write-Host "No backend\blyp-live-service found (skipping backend start)."
}

# Start functions serve if present and not already listening on 5001
if (Test-Path "functions\package.json") {
  $listening5001 = (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 5001 } | Select-Object -First 1)
  if (-not $listening5001) {
    Write-Host "Starting functions serve..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd functions && npm run serve" `
      -RedirectStandardOutput "audit\logs\functions_serve.log" -RedirectStandardError "audit\logs\functions_serve.err.log" -WindowStyle Hidden
  } else {
    Write-Host "Functions emulator looks up (port 5001 listening)."
  }
} else {
  Write-Host "No functions folder found (skipping functions start)."
}

# Start Metro if not already listening on 8081/19000/19001
$listeningMetro = (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 8081,19000,19001 } | Select-Object -First 1)
if (-not $listeningMetro) {
  Write-Host "Starting Metro (Expo dev client)..."
  Start-Process -FilePath "cmd.exe" -WorkingDirectory $RepoRoot -ArgumentList "/c set NODE_OPTIONS=--dns-result-order=ipv4first & npx expo start --dev-client --clear --host localhost --port 8081" `
    -RedirectStandardOutput "audit\logs\metro.log" -RedirectStandardError "audit\logs\metro.err.log" -WindowStyle Hidden
} else {
  Write-Host "Metro looks up (one of 8081/19000/19001 is listening)."
}

Write-Host "`n=== Done. Now open your Dev Client and load the app. ==="
Write-Host "If it doesn't load, check: audit\logs\metro.err.log (tail) + firewall/Wi-Fi."
