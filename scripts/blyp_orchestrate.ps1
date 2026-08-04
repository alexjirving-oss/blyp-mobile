$ErrorActionPreference='Stop'
$root = 'C:\Users\Alex\Blyp26'
Set-Location $root

$HSerial = 'R5CX71NM1RK'
$VSerial = 'RFCY71ZFS6F'
$PKG     = 'com.blyp.mobile'

function Die($m){ Write-Host "`nFATAL: $m" -ForegroundColor Red; exit 1 }

function HasScript($dir,$name){
  try { $p = Get-Content (Join-Path $dir 'package.json') -Raw | ConvertFrom-Json
        return ($p.scripts.PSObject.Properties.Name -contains $name) }
  catch { return $false }
}

function StartPS($title,$cwd,$cmd){
  Start-Process powershell -WindowStyle Normal -ArgumentList '-NoExit','-Command',(
    "`$Host.UI.RawUI.WindowTitle='$title'; Set-Location '$cwd'; `$ErrorActionPreference='Stop'; $cmd"
  ) | Out-Null
}

function PortUp($port){
  try { return (Test-NetConnection -ComputerName 127.0.0.1 -Port $port -WarningAction SilentlyContinue).TcpTestSucceeded }
  catch { return $false }
}

Write-Host '=== ADB CHECK ==='
adb kill-server | Out-Null
adb start-server | Out-Null
$d = (adb devices -l); $ds = ($d -join "`n")
Write-Host $ds
if($ds -notmatch [regex]::Escape($HSerial) -or $ds -notmatch [regex]::Escape($VSerial)){ Die 'Both devices not visible in adb devices -l' }
if($ds -match ($HSerial+'.*unauthorized') -or $ds -match ($VSerial+'.*unauthorized')){ Die 'Device unauthorized. Unlock phones and accept RSA prompt.' }
if($ds -match ($HSerial+'.*offline') -or $ds -match ($VSerial+'.*offline')){ Die 'Device offline. Replug/restart USB debugging.' }

Write-Host '=== INSTALL DEPS (ROOT) ==='
if(Test-Path (Join-Path $root 'package-lock.json')){ npm ci } else { npm install }

Write-Host '=== START SERVERS (AUTO-DETECT) ==='
$metroCmd = if(HasScript $root 'dev-client'){ 'npm run dev-client -- --clear' }
           elseif(HasScript $root 'start'){ 'npm start -- --clear' }
           else { 'npx expo start --dev-client --clear' }
StartPS 'BLYP: METRO' $root $metroCmd

$backendDir = Join-Path $root 'blyp-live-service'
if(Test-Path (Join-Path $backendDir 'package.json')){
  if(Test-Path (Join-Path $backendDir 'package-lock.json')){ StartPS 'BLYP: BACKEND (deps)' $backendDir 'npm ci' }
  $backendCmd = if(HasScript $backendDir 'dev'){ 'npm run dev' } elseif(HasScript $backendDir 'start'){ 'npm start' } else { '' }
  if($backendCmd){ StartPS 'BLYP: BACKEND' $backendDir $backendCmd } else { Write-Host 'WARN: backend found but no dev/start script.' }
} else {
  Write-Host 'WARN: blyp-live-service not found; skipping backend.'
}

$functionsDir = Join-Path $root 'functions'
if(Test-Path (Join-Path $functionsDir 'package.json')){
  if(Test-Path (Join-Path $functionsDir 'package-lock.json')){ StartPS 'BLYP: FUNCTIONS (deps)' $functionsDir 'npm ci' }
  $fnCmd = if(HasScript $functionsDir 'serve'){ 'npm run serve' } elseif(HasScript $functionsDir 'emulators'){ 'npm run emulators' } else { '' }
  if($fnCmd){ StartPS 'BLYP: FUNCTIONS' $functionsDir $fnCmd } else { Write-Host 'WARN: functions found but no serve/emulators script.' }
} else {
  Write-Host 'INFO: no functions folder; skipping emulators.'
}

Start-Sleep -Seconds 2
Write-Host '=== PORT QUICK-CHECK (non-fatal) ==='
Write-Host ('Metro 8081: ' + (PortUp 8081))
Write-Host ('API 4000: ' + (PortUp 4000))
Write-Host ('Emulator 5001: ' + (PortUp 5001))

Write-Host '=== BUILD APK ==='
Push-Location (Join-Path $root 'android')
.\gradlew :app:assembleDebug --no-daemon
Pop-Location

$apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
if(!(Test-Path $apk)){ Die ("APK_NOT_FOUND: {0}" -f $apk) }

Write-Host '=== INSTALL APK (BOTH DEVICES) ==='
adb -s $HSerial install -r -d $apk
adb -s $VSerial install -r -d $apk

Write-Host '=== ADB REVERSE (device -> localhost services) ==='
foreach($s in @($HSerial,$VSerial)){
  adb -s $s reverse tcp:8081 tcp:8081 1>$null 2>$null
  adb -s $s reverse tcp:4000 tcp:4000 1>$null 2>$null
  adb -s $s reverse tcp:5001 tcp:5001 1>$null 2>$null
  adb -s $s reverse tcp:3001 tcp:3001 1>$null 2>$null
}

$LH = Join-Path $root 'artifacts\ci\logcat_host_tags.txt'
$LV = Join-Path $root 'artifacts\ci\logcat_viewer_tags.txt'
if(Test-Path $LH){ Remove-Item $LH -Force }
if(Test-Path $LV){ Remove-Item $LV -Force }

adb -s $HSerial logcat -c
adb -s $VSerial logcat -c

Write-Host '=== START LOGCAT CAPTURE (TAG-SCOPED) ==='
$argH = '/c adb -s '+$HSerial+' logcat -v time ActivityManager:I BLYP_IVS_NATIVE:V ReactNativeJS:V ReactNative:V AndroidRuntime:E UIManager:V ViewManager:V *:S > "'+$LH+'" 2>&1'
$argV = '/c adb -s '+$VSerial+' logcat -v time ActivityManager:I BLYP_IVS_NATIVE:V ReactNativeJS:V ReactNative:V AndroidRuntime:E UIManager:V ViewManager:V *:S > "'+$LV+'" 2>&1'
$pH = Start-Process -PassThru -WindowStyle Normal -FilePath 'cmd.exe' -ArgumentList $argH
$pV = Start-Process -PassThru -WindowStyle Normal -FilePath 'cmd.exe' -ArgumentList $argV

Write-Host '=== LAUNCH APP (BOTH) ==='
adb -s $HSerial shell am force-stop $PKG 1>$null 2>$null
adb -s $VSerial shell am force-stop $PKG 1>$null 2>$null
adb -s $HSerial shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 1>$null
adb -s $VSerial shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 1>$null

Write-Host "`nACTION: open the app + reproduce the issue. Then press ENTER here."
Read-Host 'Press ENTER to stop capture + print filtered lines'

try{ Stop-Process -Id $pH.Id -Force -ErrorAction SilentlyContinue }catch{}
try{ Stop-Process -Id $pV.Id -Force -ErrorAction SilentlyContinue }catch{}
Start-Sleep -Seconds 1

# Auto-correct host/viewer labeling by detected Firebase uid in log files.
function Get-FirstAuthUid($p){
  try{
    $m = Select-String -Path $p -Pattern "\[AUTH DEBUG\].*uid:\s*'([^']+)'" -List
    if(-not $m){ return $null }
    return $m.Matches[0].Groups[1].Value
  } catch {
    return $null
  }
}

$expectedHostUid = 'alex'
$expectedViewerUid = 'test'

if((Test-Path $LH) -and (Test-Path $LV)){
  $hostUid = Get-FirstAuthUid $LH
  $viewerUid = Get-FirstAuthUid $LV
  Write-Host ("LOG_UID_HOST_FILE=" + $hostUid)
  Write-Host ("LOG_UID_VIEWER_FILE=" + $viewerUid)
  if($hostUid -eq $expectedViewerUid -and $viewerUid -eq $expectedHostUid){
    Write-Host "LOGS_SWAPPED_BY_UID=true (renaming host/viewer log files)" -ForegroundColor Yellow
    $tmp = Join-Path $root 'artifacts\ci\__tmp_swap.txt'
    try{ if(Test-Path $tmp){ Remove-Item $tmp -Force } } catch {}
    Move-Item $LH $tmp -Force
    Move-Item $LV $LH -Force
    Move-Item $tmp $LV -Force
  } else {
    Write-Host "LOGS_SWAPPED_BY_UID=false"
  }
}

$need=@(
  'BLYP_IVS_NATIVE',
  'Tried to register two views with the same name',
  'register two views with the same name',
  'Element type is invalid',
  'lazy element type must resolve',
  'Unable to load script',
  'Could not connect to development server',
  'Invariant Violation',
  'FATAL EXCEPTION',
  'AndroidRuntime',
  'UIManager',
  'ViewManager',
  'ReactNativeJS',
  'ReactNative'
)

Write-Host "`n=== HOST FILTER ==="
if(Test-Path $LH){ Select-String -Path $LH -SimpleMatch -Pattern $need | Select-Object -Last 500 | ForEach-Object Line } else { Write-Host 'MISSING_HOST_LOG' }

Write-Host "`n=== VIEWER FILTER ==="
if(Test-Path $LV){ Select-String -Path $LV -SimpleMatch -Pattern $need | Select-Object -Last 500 | ForEach-Object Line } else { Write-Host 'MISSING_VIEWER_LOG' }

Write-Host "`nSAVED_LOGS:`n$LH`n$LV"

