$ErrorActionPreference="Stop"
$PSNativeCommandUseErrorActionPreference=$false
Set-Location C:\Users\Alex\Blyp26

function NowTs(){ Get-Date -Format "yyyyMMdd_HHmmss" }
$ts = NowTs
$root = "diagnostics\live_rail\PLUS_GOLIVE_PROBE_$ts"
New-Item -ItemType Directory -Force -Path $root | Out-Null
function W([string]$name,[string[]]$lines){
  $p = Join-Path $root $name
  $lines | Out-File -Encoding utf8 $p
  return $p
}

adb kill-server | Out-Null
Start-Sleep 1
adb start-server | Out-Null
$adbDevices = (adb devices) 2>&1
W "00_adb_devices.txt" @($adbDevices)

$devs = @($adbDevices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] })
if($devs.Count -lt 2){
  W "99_fail.txt" @("NEED_2_DEVICES","FOUND_COUNT=$($devs.Count)","FOUND=" + ($devs -join ","))
  throw "NEED_2_DEVICES"
}

$hostUdid   = if($env:BLYP_HOST_UDID){$env:BLYP_HOST_UDID}else{$devs[0]}
$viewerUdid = if($env:BLYP_VIEWER_UDID){$env:BLYP_VIEWER_UDID}else{$devs[1]}
if($hostUdid -eq $viewerUdid){ throw "HOST_VIEWER_SAME_UDID: $hostUdid" }

W "01_udids.txt" @("HOST=$hostUdid","VIEWER=$viewerUdid")

$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
$kill = $procs | Where-Object {
  ($_.Name -match 'node.exe|cmd.exe|powershell.exe|java.exe') -and (
    ($_.CommandLine -match '(?i)appium') -or
    ($_.CommandLine -match '(?i)wdio\.cmd') -or
    ($_.CommandLine -match '(?i)webdriverio') -or
    ($_.CommandLine -match '(?i)LIVE_E2E_AUTOPILOT_RAIL_V1\.ps1')
  )
} | Select-Object -ExpandProperty ProcessId -Unique
W "02_kill_pids.txt" @("PIDS=" + ($(if($kill){$kill -join ","}else{"(none)"})))
foreach($procId in $kill){ try{ Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }catch{} }

try{
  $c = Get-NetTCPConnection -LocalPort 4723 -ErrorAction SilentlyContinue
  if($c){ $c | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
}catch{}

foreach($u in @($hostUdid,$viewerUdid)){
  try{ adb -s $u forward --remove-all 2>$null | Out-Null }catch{}
  try{ adb -s $u shell am force-stop io.appium.uiautomator2.server 2>$null | Out-Null }catch{}
  try{ adb -s $u shell am force-stop io.appium.uiautomator2.server.test 2>$null | Out-Null }catch{}
}

$specDir = "e2e\probes"
New-Item -ItemType Directory -Force -Path $specDir | Out-Null
$spec = Join-Path $specDir "live_plus_golive_probe.js"

@'
const PKG = process.env.BLYP_PKG || 'com.blyp.mobile';
const fs = require('fs');

function out(p){ return `${process.env.BLYP_OUT_DIR}/${p}`; }

async function dump(tag){
  try{ fs.writeFileSync(out(`host_${tag}.xml`), await browser.host.getPageSource()); }catch{}
  try{ fs.writeFileSync(out(`viewer_${tag}.xml`), await browser.viewer.getPageSource()); }catch{}
  try{ await browser.host.saveScreenshot(out(`host_${tag}.png`)); }catch{}
  try{ await browser.viewer.saveScreenshot(out(`viewer_${tag}.png`)); }catch{}
}

async function ensureFg(dev){
  try{ await browser[dev].activateApp(PKG); }catch{}
  await browser[dev].pause(700);
  const src = await browser[dev].getPageSource();
  if(!src.includes(`package="${PKG}"`)){
    await browser[dev].pause(900);
    const src2 = await browser[dev].getPageSource();
    if(!src2.includes(`package="${PKG}"`)) throw new Error(`APP_NOT_FOREGROUND[${dev}]`);
  }
}

async function waitAny(dev, selectors, ms=25000){
  const t0 = Date.now();
  while(Date.now()-t0 < ms){
    for(const s of selectors){
      try{
        const el = await browser[dev].$(s);
        if(await el.isExisting()) return el;
      }catch{}
    }
    await browser[dev].pause(250);
  }
  throw new Error(`WAITANY_FAILED[${dev}] ${selectors.join(' | ')}`);
}

async function tapAny(dev, selectors, ms=25000){
  const el = await waitAny(dev, selectors, ms);
  await el.click();
  await browser[dev].pause(650);
}

async function loginIfNeeded(dev, email, pass){
  await ensureFg(dev);
  try{
    const home = await browser[dev].$('~Home');
    if(await home.isExisting()) return;
  }catch{}

  const toggle = [
    `//*[contains(@text,"Already have an account")]`,
    `//*[contains(@text,"Don't have an account")]`,
    `//*[contains(@text,"Log In")]`,
    `//*[contains(@text,"Sign Up")]`
  ];

  let edits = await browser[dev].$$('//android.widget.EditText');
  if(edits.length >= 3){ await tapAny(dev, toggle, 20000); edits = await browser[dev].$$('//android.widget.EditText'); }
  if(edits.length < 2){ await tapAny(dev, toggle, 20000); edits = await browser[dev].$$('//android.widget.EditText'); }

  const e = await browser[dev].$$('//android.widget.EditText');
  if(e.length >= 1){ await e[0].click(); await e[0].setValue(email); }
  if(e.length >= 2){ await e[1].click(); await e[1].setValue(pass); }

  await tapAny(dev, [
    '//*[@text="Login"]',
    '//*[@text="Log In"]',
    '//*[@text="Sign In"]',
    '//*[@text="Continue"]',
    '//*[@text="Submit"]',
    '//*[@text="Next"]'
  ], 45000);

  await waitAny(dev, ['~Home','//*[@content-desc="Home"]','//*[@text="Home"]'], 90000);
}

async function plusThenGoLive_HARD_PROOF(){
  await ensureFg('host');
  await dump('host_after_login');

  const plusSelectors = [
    '~+', '//*[@content-desc="+"]', '//*[@text="+"]',
    '~Create', '//*[@content-desc="Create"]', '//*[@text="Create"]',
    '//*[contains(@content-desc,"create")]', '//*[contains(@content-desc,"Create")]', '//*[contains(@text,"Create")]'
  ];

  let found = false;
  for(const s of plusSelectors){
    try{ const el = await browser.host.$(s); if(await el.isExisting()){ found = true; break; } }catch{}
  }
  if(!found){ await dump('FAIL_plus_not_found'); throw new Error('PLUS_NOT_FOUND_ON_HOME'); }

  try{ await tapAny('host', plusSelectors, 25000); }
  catch(e){
    await dump('plus_selector_failed');
    const r = await browser.host.getWindowRect();
    await browser.host.touchAction({ action: 'tap', x: Math.floor(r.width/2), y: Math.floor(r.height*0.92) });
    await browser.host.pause(900);
  }

  await dump('host_after_plus');

  const goLiveSelectors = [
    '//*[@text="Go Live"]','//*[@text="Go live"]','//*[contains(@text,"Go Live")]',
    '//*[@text="Live"]','//*[@text="Start Live"]','~Go Live','//*[@content-desc="Go Live"]'
  ];

  let glFound = false;
  for(const s of goLiveSelectors){
    try{ const el = await browser.host.$(s); if(await el.isExisting()){ glFound = true; break; } }catch{}
  }
  if(!glFound){ await dump('FAIL_go_live_not_found'); throw new Error('GO_LIVE_NOT_FOUND_AFTER_PLUS'); }

  await tapAny('host', goLiveSelectors, 45000);
  await dump('host_after_go_live_tap');

  await waitAny('host', [
    '//android.widget.EditText','//*[@text="Start Live"]','//*[@text="Start"]',
    '//*[@text="Begin"]','//*[@text="Go Live"]','//*[contains(@text,"LIVE")]'
  ], 30000).catch(async () => {
    await dump('FAIL_go_live_setup_not_reached');
    throw new Error('GO_LIVE_SETUP_NOT_REACHED');
  });

  await dump('PASS_reached_go_live_setup');
}

describe('PLUS -> GO LIVE PROBE (Host)', () => {
  it('logs in then proves plus and go live navigation with evidence', async () => {
    const hostEmail = process.env.BLYP_HOST_EMAIL || 'host@example.com';
    const hostPass  = process.env.BLYP_HOST_PASS  || 'Password1!';
    const viewEmail = process.env.BLYP_VIEW_EMAIL || 'viewer@example.com';
    const viewPass  = process.env.BLYP_VIEW_PASS  || 'Password1!';

    await ensureFg('host');
    await ensureFg('viewer');
    await loginIfNeeded('host', hostEmail, hostPass);
    await loginIfNeeded('viewer', viewEmail, viewPass);
    await plusThenGoLive_HARD_PROOF();
  });
});
'@ | Out-File -Encoding utf8 $spec

W "03_probe_spec.txt" @("SPEC=$spec")

$env:BLYP_OUT_DIR = (Join-Path $root "evidence")
New-Item -ItemType Directory -Force -Path $env:BLYP_OUT_DIR | Out-Null
$env:BLYP_HOST_UDID   = $hostUdid
$env:BLYP_VIEWER_UDID = $viewerUdid
$env:BLYP_E2E_HOST_EMAIL="host@example.com"
$env:BLYP_E2E_HOST_PASSWORD="Password1!"
$env:BLYP_E2E_VIEWER_EMAIL="viewer@example.com"
$env:BLYP_E2E_VIEWER_PASSWORD="Password1!"
$env:BLYP_HOST_EMAIL="host@example.com"
$env:BLYP_HOST_PASS="Password1!"
$env:BLYP_VIEW_EMAIL="viewer@example.com"
$env:BLYP_VIEW_PASS="Password1!"

W "04_env.txt" @("HOST_UDID=$env:BLYP_HOST_UDID","VIEWER_UDID=$env:BLYP_VIEWER_UDID","OUT_DIR=$env:BLYP_OUT_DIR","PASS=set (Password1!)")

$appiumLog = Join-Path $root "10_appium.log"
$appiumErr = Join-Path $root "10_appium_err.log"
$wdioOut   = Join-Path $root "11_wdio_output.log"
$wdioErr   = Join-Path $root "12_wdio_error.log"
$appiumCmd = "appium"
if (Test-Path "node_modules\.bin\appium.cmd") {
  $appiumCmd = "node_modules\.bin\appium.cmd"
}
$wdioCmd   = "node_modules\.bin\wdio.cmd"
if(-not (Test-Path $wdioCmd)){ throw "WDIO_CMD_NOT_FOUND: $wdioCmd (run npm i)" }

$ap = Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$appiumCmd`" --address 127.0.0.1 --port 4723 --relaxed-security" -WorkingDirectory (Get-Location) -NoNewWindow -PassThru -RedirectStandardOutput $appiumLog -RedirectStandardError $appiumErr
W "05_appium_pid.txt" @("PID=$($ap.Id)","LOG=$appiumLog")
Start-Sleep -Seconds 3

$conf = "tools\autopilot\wdio.live.multiremote.conf.js"
if(-not (Test-Path $conf)){ throw "CONF_NOT_FOUND: $conf" }
$specArg = $spec -replace '\\','/'
W "06_run_command.txt" @("cmd.exe /c `"$wdioCmd` run `"$conf`" --spec `"$specArg`"")

$wd = Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$wdioCmd` run `"$conf`" --spec `"$specArg`"" -WorkingDirectory (Get-Location) -NoNewWindow -PassThru -Wait -RedirectStandardOutput $wdioOut -RedirectStandardError $wdioErr
W "07_wdio_exit.txt" @("EXITCODE=$($wd.ExitCode)","OUT=$wdioOut","ERR=$wdioErr")

try{ Stop-Process -Id $ap.Id -Force -ErrorAction SilentlyContinue }catch{}
W "99_done.txt" @("DONE","ROOT=$root","HOST=$hostUdid","VIEWER=$viewerUdid","WDIO_EXIT=$($wd.ExitCode)")
Write-Host "`nDONE. ROOT=$root`nHOST=$hostUdid`nVIEWER=$viewerUdid`n"
