param(
  [int]$AppiumPort = 4723
)

$ErrorActionPreference="Stop"
$PSNativeCommandUseErrorActionPreference=$false
Set-Location C:\Users\Alex\Blyp26

# Ensure ANDROID_HOME is set (required by UiAutomator2 driver)
if(-not $env:ANDROID_HOME){
  $sdkPath = "C:\Users\Alex\AppData\Local\Android\sdk"
  if(Test-Path $sdkPath){ $env:ANDROID_HOME = $sdkPath }
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$pkt = "diagnostics\rail_v3\APPIUM_RUN_$ts"
New-Item -ItemType Directory -Force -Path $pkt | Out-Null

function W($name, $lines){
  $p = Join-Path $pkt $name
  $lines | Out-File -Encoding utf8 $p
  $p
}

# Precheck: devices
$raw = adb devices -l
W "01_adb_devices.txt" (@("=== adb devices -l ===") + $raw) | Out-Null

$lines = ($raw | Select-Object -Skip 1) | Where-Object { $_ -match "\S" }
$devs = @()
foreach($l in $lines){
  $p = $l -split "\s+"
  if($p.Length -ge 2 -and $p[1] -eq "device"){ $devs += $p[0] }
}
if($devs.Count -lt 1){ throw "NO_AUTHORIZED_DEVICES" }

# Start Appium (local)
$log = Join-Path (Resolve-Path $pkt).Path "10_appium_server.log"
$errLog = Join-Path (Resolve-Path $pkt).Path "10_appium_server_err.log"

# Find the appium main JS entry point and run via node.exe directly
$appiumMain = Join-Path $PSScriptRoot "..\..\node_modules\appium\build\lib\main.js"
if(-not (Test-Path $appiumMain)){ throw "APPIUM_MAIN_NOT_FOUND: $appiumMain - run npm i -D appium first" }
$appiumMain = (Resolve-Path $appiumMain).Path

$nodeExe = (Get-Command node).Source
$proc = Start-Process -PassThru -WindowStyle Hidden -FilePath $nodeExe `
  -ArgumentList @("`"$appiumMain`"", "--port", "$AppiumPort", "--base-path", "/", "--log-level", "info") `
  -RedirectStandardOutput $log -RedirectStandardError $errLog

# Wait for Appium to be ready (retry up to 20s)
$appiumReady = $false
for($i = 0; $i -lt 20; $i++){
  Start-Sleep 1
  try{
    $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port $AppiumPort -WarningAction SilentlyContinue -InformationLevel Quiet
    if($tcp){ $appiumReady = $true; break }
  } catch {}
}
W "11_appium_port.txt" @("PORT=$AppiumPort","LISTENING=$appiumReady","WAIT_SECONDS=$i","APPIUM_PID=$($proc.Id)") | Out-Null
if(-not $appiumReady){ Write-Warning "Appium not listening on port $AppiumPort after ${i}s - tests will likely fail" }

# Run smoke per device (sequential = stable)
$results = @()
foreach($d in $devs){
  $dDir = Join-Path $pkt $d
  New-Item -ItemType Directory -Force -Path $dDir | Out-Null

  $model = (adb -s $d shell getprop ro.product.model 2>$null).Trim()
  @("SERIAL=$d","MODEL=$model") | Out-File -Encoding utf8 (Join-Path $dDir "05_device.txt")

  $env:BLYP_UDID = $d
  $env:BLYP_DEVICE_NAME = $model
  $env:BLYP_OUTDIR = (Resolve-Path $dDir).Path

  $nodeLog = Join-Path $dDir "20_node_run.txt"
  $exit = 0
  try{
    node "e2e\appium\smoke_home.js" 2>&1 | Tee-Object -FilePath $nodeLog
    $exit = $LASTEXITCODE
  } catch {
    $exit = 2
    ("NODE_EXCEPTION=" + $_.Exception.Message) | Out-File -Encoding utf8 $nodeLog -Append
  }

  $r = if($exit -eq 0){"PASS"} else {"FAIL"}
  $results += "DEVICE=$d MODEL=$model RESULT=$r NODE_EXIT=$exit"
}

# Stop Appium
try{
  if($proc -and -not $proc.HasExited){
    Stop-Process -Id $proc.Id -Force
  }
} catch {}

W "00_summary.txt" (@(
  "RESULT=$(if($results -match 'RESULT=FAIL'){ 'FAIL' } else { 'PASS' })"
  "PACKET_DIR=$((Resolve-Path $pkt).Path)"
  "DEVICES=$($devs -join ',')"
  ""
  "PER_DEVICE:"
) + $results) | Out-Null

Get-Content (Join-Path $pkt "00_summary.txt")
