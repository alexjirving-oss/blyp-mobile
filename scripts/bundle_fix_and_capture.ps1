<#
BLYP  Bundle/Metro Fix + Evidence Capture (2 devices)

Run:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bundle_fix_and_capture.ps1

Outputs:
  artifacts\ci\bundle_fix_run.txt
  artifacts\ci\metro_stdout.txt
  artifacts\ci\metro_stderr.txt
  artifacts\ci\host_bundle_errors.txt
  artifacts\ci\viewer_bundle_errors.txt

What to paste back:
  - METRO_STATUS_RUNNING=...
  - last 40 lines of HOST + VIEWER error extracts printed at the end
#>

param(
  [string]$Root = "C:\Users\Alex\Blyp26",
  [string]$HostSerial = "R5CX71NM1RK",
  [string]$ViewerSerial = "RFCY71ZFS6F",
  [string]$PackageName = "com.blyp.mobile"
)

$ErrorActionPreference="Stop"
try { $PSNativeCommandUseErrorActionPreference = $false } catch {}
$ProgressPreference="SilentlyContinue"

Set-Location $Root
New-Item -ItemType Directory -Force ".\artifacts\ci" | Out-Null

$runLog   = ".\artifacts\ci\bundle_fix_run.txt"
$metroOut = ".\artifacts\ci\metro_stdout.txt"
$metroErr = ".\artifacts\ci\metro_stderr.txt"
$hostErr  = ".\artifacts\ci\host_bundle_errors.txt"
$viewErr  = ".\artifacts\ci\viewer_bundle_errors.txt"

foreach($p in @($runLog,$metroOut,$metroErr,$hostErr,$viewErr)){ if(Test-Path $p){ Remove-Item $p -Force } }

function W([string]$m){ $m | Tee-Object -FilePath $runLog -Append | Out-Null }
function A([string]$args){
  $out = cmd.exe /c ("adb " + $args + " 2>&1")
  $out | ForEach-Object { W ("adb " + $args + " :: " + $_) }
  return $out
}

W "=== ADB RESET ==="
A "kill-server" | Out-Null
A "start-server" | Out-Null

W "=== DEVICES ==="
$ds = cmd.exe /c "adb devices -l" 2>&1
$dsText = ($ds -join "`n")
$ds | ForEach-Object { W $_ }

foreach($s in @($HostSerial,$ViewerSerial)){
  if($dsText -notmatch [regex]::Escape($s)){ throw "MISSING_DEVICE:$s (adb devices -l)" }
}
if($dsText -match ($HostSerial+'.*unauthorized') -or $dsText -match ($ViewerSerial+'.*unauthorized')){ throw "DEVICE_UNAUTHORIZED: unlock phones + accept RSA prompt" }
if($dsText -match ($HostSerial+'.*offline') -or $dsText -match ($ViewerSerial+'.*offline')){ throw "DEVICE_OFFLINE: replug / toggle USB debugging" }

W "=== REVERSE PORTS + CLEAR RN DEV HOST OVERRIDE ==="
foreach($s in @($HostSerial,$ViewerSerial)){
  A "-s $s reverse --remove-all" | Out-Null
  foreach($p in 8081,3001,4000,5001){ A "-s $s reverse tcp:$p tcp:$p" | Out-Null }

  A "-s $s shell am force-stop $PackageName" | Out-Null
  A "-s $s logcat -c" | Out-Null

  # If this fails (common), we still log it. Its just a cleanup attempt.
  A "-s $s shell run-as $PackageName rm -f /data/data/$PackageName/shared_prefs/com.facebook.react.devsupport.sharedpreferences.xml" | Out-Null

  A "-s $s reverse --list" | Out-Null
}

W "=== START METRO (CAPTURE STDOUT/ERR) ==="
$pjson = Get-Content .\package.json -Raw | ConvertFrom-Json
$metroCmd =
  if($pjson.scripts.'dev-client'){ "npm run dev-client -- --clear" }
  elseif($pjson.scripts.start){ "npm start -- --clear" }
  else { "npx expo start --dev-client --clear" }

W ("METRO_CMD=" + $metroCmd)

# Start Metro in background, fully logged to files (no console-output truncation).
$metroProc = Start-Process -PassThru -WindowStyle Hidden -FilePath "powershell" -ArgumentList @(
  "-NoProfile","-ExecutionPolicy","Bypass","-Command",("cd `"$Root`"; " + $metroCmd)
) -RedirectStandardOutput $metroOut -RedirectStandardError $metroErr

W "=== WAIT FOR METRO /status ==="
$ok=$false
for($i=0;$i -lt 60;$i++){
  try{
    $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8081/status" -TimeoutSec 2
    if($r.Content -match "packager-status:running"){ $ok=$true; break }
  } catch {}
  Start-Sleep -Milliseconds 400
}
W ("METRO_STATUS_RUNNING=" + $ok)

W "=== LAUNCH APP (BOTH) ==="
foreach($s in @($HostSerial,$ViewerSerial)){
  A "-s $s shell monkey -p $PackageName -c android.intent.category.LAUNCHER 1" | Out-Null
}
Start-Sleep -Seconds 4

W "=== EXTRACT BUNDLE/DEVSERVER ERRORS (HOST) ==="
cmd.exe /c "adb -s $HostSerial logcat -d -v time -t 700" 2>&1 |
  Select-String -SimpleMatch -Pattern @(
    "Could not load bundle",
    "Unable to load script",
    "Could not connect to development server",
    "ECONNREFUSED",
    "Connection refused",
    "DevServerHelper",
    "PackagerConnectionSettings",
    "ReactNativeJS",
    "AndroidRuntime"
  ) | Select-Object -Last 220 | ForEach-Object { $_.Line } | Out-File -FilePath $hostErr

W "=== EXTRACT BUNDLE/DEVSERVER ERRORS (VIEWER) ==="
cmd.exe /c "adb -s $ViewerSerial logcat -d -v time -t 700" 2>&1 |
  Select-String -SimpleMatch -Pattern @(
    "Could not load bundle",
    "Unable to load script",
    "Could not connect to development server",
    "ECONNREFUSED",
    "Connection refused",
    "DevServerHelper",
    "PackagerConnectionSettings",
    "ReactNativeJS",
    "AndroidRuntime"
  ) | Select-Object -Last 220 | ForEach-Object { $_.Line } | Out-File -FilePath $viewErr

Write-Host "`n=== SUMMARY (PASTE THIS BACK) ==="
Write-Host ("METRO_STATUS_RUNNING=" + $ok)
Write-Host ("HOST_ERRORS_FILE=" + (Resolve-Path $hostErr).Path)
Write-Host ("VIEWER_ERRORS_FILE=" + (Resolve-Path $viewErr).Path)
Write-Host ("RUN_LOG_FILE=" + (Resolve-Path $runLog).Path)

Write-Host "`n--- HOST ERRORS (last 40 lines) ---"
Get-Content $hostErr -ErrorAction SilentlyContinue | Select-Object -Last 40

Write-Host "`n--- VIEWER ERRORS (last 40 lines) ---"
Get-Content $viewErr -ErrorAction SilentlyContinue | Select-Object -Last 40

if(-not $ok){
  Write-Host "`nMETRO NOT RUNNING. Open these and paste last 80 lines:"
  Write-Host (Resolve-Path $metroOut).Path
  Write-Host (Resolve-Path $metroErr).Path
  exit 2
}

exit 0
