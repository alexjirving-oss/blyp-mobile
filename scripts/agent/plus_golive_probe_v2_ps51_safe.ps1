# ==============================================================
# PLUS_GOLIVE_PROBE_V2_PS51_SAFE
# SAFE: NO APP PATCH — NO BUILD
# All PS 5.1 issues fixed ($host, $pid, ternary, dual redirect)
# Probe JS login uses content-desc selectors (matches main spec fix)
# ==============================================================

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

# 0) Hard reset ADB + require 2 devices
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

# 1) Pin UDIDs (env override wins) — $hostUdid/$viewerUdid to avoid PS reserved $host
if($env:BLYP_HOST_UDID){ $hostUdid = $env:BLYP_HOST_UDID } else { $hostUdid = $devs[0] }
if($env:BLYP_VIEWER_UDID){ $viewerUdid = $env:BLYP_VIEWER_UDID } else { $viewerUdid = $devs[1] }
if($hostUdid -eq $viewerUdid){ throw "HOST_VIEWER_SAME_UDID: $hostUdid" }
W "01_udids.txt" @("HOST=$hostUdid","VIEWER=$viewerUdid")

# 2) Kill stale runners (PS 5.1 safe via CIM)
$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
$kill = $procs | Where-Object {
  ($_.Name -match 'node.exe|cmd.exe|powershell.exe|java.exe') -and (
    ($_.CommandLine -match '(?i)appium') -or
    ($_.CommandLine -match '(?i)wdio\.cmd') -or
    ($_.CommandLine -match '(?i)webdriverio') -or
    ($_.CommandLine -match '(?i)LIVE_E2E_AUTOPILOT_RAIL_V1\.ps1')
  )
} | Select-Object -ExpandProperty ProcessId -Unique
if($kill){ $killStr = $kill -join "," } else { $killStr = "(none)" }
W "02_kill_pids.txt" @("PIDS=$killStr")
foreach($procId in $kill){ try{ Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }catch{} }

# Free port 4723 best-effort
try{
  $c = Get-NetTCPConnection -LocalPort 4723 -ErrorAction SilentlyContinue
  if($c){ $c | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
}catch{}

# 3) Clean forwards + stop UiAutomator2 servers
foreach($u in @($hostUdid,$viewerUdid)){
  try{ adb -s $u forward --remove-all 2>$null | Out-Null }catch{}
  try{ adb -s $u shell am force-stop io.appium.uiautomator2.server 2>$null | Out-Null }catch{}
  try{ adb -s $u shell am force-stop io.appium.uiautomator2.server.test 2>$null | Out-Null }catch{}
}

# 4) Write probe spec (new file; does not touch your main spec)
$specDir = "e2e\probes"
New-Item -ItemType Directory -Force -Path $specDir | Out-Null
$spec = Join-Path $specDir "live_plus_golive_probe.js"

@'
const path = require('path');
const fs = require('fs');
const PKG = process.env.BLYP_PKG || 'com.blyp.mobile';

function out(p){ return path.join(process.env.BLYP_OUT_DIR, p); }

async function dump(tag){
  console.log('[PROBE] dump:', tag);
  try{ fs.writeFileSync(out('host_' + tag + '.xml'), await browser.host.getPageSource()); }catch(e){ console.log('[PROBE] dump host xml err:', e.message); }
  try{ fs.writeFileSync(out('viewer_' + tag + '.xml'), await browser.viewer.getPageSource()); }catch(e){ console.log('[PROBE] dump viewer xml err:', e.message); }
  try{ await browser.host.saveScreenshot(out('host_' + tag + '.png')); }catch(e){ console.log('[PROBE] dump host png err:', e.message); }
  try{ await browser.viewer.saveScreenshot(out('viewer_' + tag + '.png')); }catch(e){ console.log('[PROBE] dump viewer png err:', e.message); }
}

async function tapCoord(dev, x, y){
  await browser[dev].performActions([{
    type: 'pointer', id: 'finger1',
    parameters: { pointerType: 'touch' },
    actions: [
      { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: 100 },
      { type: 'pointerUp', button: 0 }
    ]
  }]);
  await browser[dev].releaseActions();
}

async function ensureFg(dev){
  try { await browser[dev].activateApp(PKG); } catch(e) {}
  await browser[dev].pause(700);
  const src = await browser[dev].getPageSource();
  if(!src.includes('package="' + PKG + '"')){
    await browser[dev].pause(900);
    const src2 = await browser[dev].getPageSource();
    if(!src2.includes('package="' + PKG + '"')) throw new Error('APP_NOT_FOREGROUND[' + dev + ']');
  }
}

async function waitAny(dev, selectors, ms){
  ms = ms || 25000;
  const t0 = Date.now();
  while(Date.now() - t0 < ms){
    for(const s of selectors){
      try{
        const el = await browser[dev].$(s);
        if(await el.isExisting()) return el;
      }catch(e){}
    }
    await browser[dev].pause(250);
  }
  throw new Error('WAITANY_FAILED[' + dev + '] ' + selectors.join(' | '));
}

async function tapAny(dev, selectors, ms){
  const el = await waitAny(dev, selectors, ms || 25000);
  await el.click();
  await browser[dev].pause(650);
}

async function loginIfNeeded(dev, email, pass){
  await ensureFg(dev);
  await dump(dev + '_login_start');

  // If Home exists, assume logged-in
  try{
    const home = await browser[dev].$('~Home');
    if(await home.isExisting()){
      console.log('[PROBE] ' + dev + ' already on Home');
      return;
    }
  }catch(e){}

  // Also check HOME_FEED resource-id
  try{
    const feed = await browser[dev].$('//*[@resource-id="HOME_FEED"]');
    if(await feed.isExisting()){
      console.log('[PROBE] ' + dev + ' already on Home (feed)');
      return;
    }
  }catch(e){}

  const toggle = [
    '//*[contains(@text,"Already have an account")]',
    '//*[contains(@text,"Don\'t have an account")]',
    '//*[contains(@text,"Log In")]',
    '//*[contains(@text,"Sign Up")]'
  ];

  let edits = await browser[dev].$$('//android.widget.EditText');
  if(edits.length >= 3){
    console.log('[PROBE] ' + dev + ' signup form (3+ fields), toggling to login');
    await tapAny(dev, toggle, 20000);
    edits = await browser[dev].$$('//android.widget.EditText');
  }
  if(edits.length < 2){
    console.log('[PROBE] ' + dev + ' no login form yet, toggling');
    await tapAny(dev, toggle, 20000);
    edits = await browser[dev].$$('//android.widget.EditText');
  }

  const e = await browser[dev].$$('//android.widget.EditText');
  console.log('[PROBE] ' + dev + ' found ' + e.length + ' EditTexts');
  if(e.length >= 1){ await e[0].click(); await e[0].setValue(email); }
  if(e.length >= 2){ await e[1].click(); await e[1].setValue(pass); }

  await dump(dev + '_creds_filled');

  // Login submit — content-desc selectors FIRST (the clickable ViewGroup),
  // then text fallbacks, then Enter key
  const submitSelectors = [
    '~Log In',
    '//*[@content-desc="Log In"]',
    'android=new UiSelector().description("Log In")',
    'android=new UiSelector().descriptionContains("Log In")',
    '//*[@text="Log In"]',
    '//*[@text="Login"]',
    '//*[@text="Sign In"]',
    '//*[@text="Continue"]',
    '//*[@text="Submit"]',
    '//*[@text="Next"]'
  ];

  let tapped = false;
  try {
    await tapAny(dev, submitSelectors, 45000);
    tapped = true;
  } catch(err) {
    console.log('[PROBE] ' + dev + ' submit selectors failed, trying Enter key');
  }

  if(!tapped){
    // Enter-key fallback
    try {
      await browser[dev].pressKeyCode(66);
      await browser[dev].pause(700);
      tapped = true;
      console.log('[PROBE] ' + dev + ' Enter key sent');
    } catch(err2) {
      console.log('[PROBE] ' + dev + ' Enter key also failed');
    }
  }

  if(!tapped){
    // Generic button fallback
    try {
      const btn = await browser[dev].$('//android.widget.Button');
      if(await btn.isExisting()){
        await btn.click();
        await browser[dev].pause(700);
        tapped = true;
        console.log('[PROBE] ' + dev + ' generic Button fallback');
      }
    }catch(e3){}
  }

  await dump(dev + '_after_submit');

  // Wait for Home
  const homeSelectors = [
    '~Home',
    '//*[@content-desc="Home"]',
    '//*[@text="Home"]',
    '//*[@resource-id="HOME_FEED"]',
    '~home',
    '//*[contains(@content-desc,"Home")]',
    '//*[contains(@content-desc,"home")]'
  ];

  try {
    await waitAny(dev, homeSelectors, 90000);
    console.log('[PROBE] ' + dev + ' reached Home');
  } catch(homeErr) {
    await dump(dev + '_FAIL_home_not_reached');
    throw homeErr;
  }
}

async function plusThenGoLive_HARD_PROOF(){
  console.log('[PROBE] start plusThenGoLive_HARD_PROOF');
  await ensureFg('host');
  await dump('host_on_home');

  // The plus button is an unlabeled SVG-icon ViewGroup in the center of the
  // bottom tab bar.  From XML evidence the clickable ViewGroup sits at
  // [311,1446][409,1524] on a 720-wide screen.  There is NO content-desc,
  // text, or resource-id, so we MUST use coordinates.
  // Strategy: compute center of screen width, and ~93% of screen height
  // (which lands on the bottom-bar center gap).

  const r = await browser.host.getWindowRect();
  const plusX = Math.floor(r.width / 2);                 // center horizontally
  const plusY = Math.floor(r.height * 0.93);             // bottom-bar region

  // Also try selector-based detection first (in case the app gets labels later)
  const plusSelectors = [
    '~+',
    '//*[@content-desc="+"]',
    '//*[@text="+"]',
    '~Create',
    '~CreatePost',
    '//*[@content-desc="Create"]',
    '//*[@content-desc="CreatePost"]',
    'android=new UiSelector().descriptionContains("Create")',
    'android=new UiSelector().text("+")'
  ];

  let tappedPlus = false;
  for(const s of plusSelectors){
    try{
      const el = await browser.host.$(s);
      if(await el.isExisting()){
        console.log('[PROBE] plus found via selector:', s);
        await el.click();
        await browser.host.pause(700);
        tappedPlus = true;
        break;
      }
    }catch(e){}
  }

  if(!tappedPlus){
    console.log('[PROBE] plus has no selectors — using coord tap at (' + plusX + ',' + plusY + ')');
    await tapCoord('host', plusX, plusY);
    await browser.host.pause(900);
    tappedPlus = true;
  }

  await dump('host_after_plus_tap');

  const goLiveSelectors = [
    '//*[@text="Go Live"]',
    '//*[@text="Go live"]',
    '//*[contains(@text,"Go Live")]',
    '//*[@text="Live"]',
    '//*[@text="Start Live"]',
    '~Go Live',
    '//*[@content-desc="Go Live"]',
    'android=new UiSelector().description("Go Live")',
    'android=new UiSelector().text("Go Live")',
    'android=new UiSelector().textContains("Go Live")'
  ];

  let glFound = false;
  for(const s of goLiveSelectors){
    try{
      const el = await browser.host.$(s);
      if(await el.isExisting()){ glFound = true; console.log('[PROBE] Go Live found via:', s); break; }
    }catch(e){}
  }
  if(!glFound){
    await dump('FAIL_go_live_not_found');
    throw new Error('GO_LIVE_NOT_FOUND_AFTER_PLUS');
  }

  console.log('[PROBE] tapping Go Live');
  await tapAny('host', goLiveSelectors, 45000);
  await dump('host_after_go_live_tap');

  console.log('[PROBE] proving Go Live setup screen');
  try {
    await waitAny('host', [
      '//android.widget.EditText',
      '//*[@text="Start Live"]',
      '//*[@text="Start"]',
      '//*[@text="Begin"]',
      '//*[@text="Go Live"]',
      '//*[contains(@text,"LIVE")]'
    ], 30000);
  } catch(setupErr) {
    await dump('FAIL_go_live_setup_not_reached');
    throw new Error('GO_LIVE_SETUP_NOT_REACHED');
  }

  await dump('PASS_reached_go_live_setup');
}

describe('PLUS -> GO LIVE PROBE V2 (Host)', () => {
  it('logs in then proves plus and go live navigation with evidence', async () => {
    const hostEmail = process.env.BLYP_HOST_EMAIL || 'host@example.com';
    const hostPass  = process.env.BLYP_HOST_PASS  || 'Password1!';
    const viewEmail = process.env.BLYP_VIEW_EMAIL || 'viewer@example.com';
    const viewPass  = process.env.BLYP_VIEW_PASS  || 'Password1!';

    await ensureFg('host');
    await ensureFg('viewer');

    await dump('00_initial_state');

    await loginIfNeeded('host', hostEmail, hostPass);
    await loginIfNeeded('viewer', viewEmail, viewPass);

    await plusThenGoLive_HARD_PROOF();
  });
});
'@ | Out-File -Encoding utf8 $spec

W "03_probe_spec.txt" @("SPEC=$spec")

# 5) Start Appium (cmd.exe /c) + run WDIO once with --spec
$outDir = Join-Path $root "evidence"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outDirFull = (Resolve-Path $outDir).Path
$env:BLYP_OUT_DIR = $outDirFull

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

W "04_env.txt" @(
  "HOST_UDID=$env:BLYP_HOST_UDID",
  "VIEWER_UDID=$env:BLYP_VIEWER_UDID",
  "OUT_DIR=$env:BLYP_OUT_DIR",
  "PASS=set (Password1!)"
)

$rootFull     = (Resolve-Path $root).Path
$appiumLog    = Join-Path $rootFull "10_appium_stdout.log"
$appiumErrLog = Join-Path $rootFull "10_appium_stderr.log"
$wdioOut      = Join-Path $rootFull "11_wdio_output.log"
$wdioErr      = Join-Path $rootFull "12_wdio_error.log"

$appiumCmd = "appium"
if(Test-Path "node_modules\.bin\appium.cmd"){ $appiumCmd = (Resolve-Path "node_modules\.bin\appium.cmd").Path }

$wdioCmd = "node_modules\.bin\wdio.cmd"
if(-not (Test-Path $wdioCmd)){ throw "WDIO_CMD_NOT_FOUND: $wdioCmd" }
$wdioCmd = (Resolve-Path $wdioCmd).Path

$conf = "tools\autopilot\wdio.live.multiremote.conf.js"
if(-not (Test-Path $conf)){ throw "CONF_NOT_FOUND: $conf" }
$conf = (Resolve-Path $conf).Path

$spec = (Resolve-Path $spec).Path

# Start Appium (separate stdout/stderr files for PS 5.1 compat)
$wdFull = (Get-Location).Path
$ap = Start-Process -FilePath $appiumCmd -ArgumentList "--address 127.0.0.1 --port 4723 --relaxed-security" `
  -WorkingDirectory $wdFull -NoNewWindow -PassThru `
  -RedirectStandardOutput $appiumLog -RedirectStandardError $appiumErrLog

W "05_appium_pid.txt" @("PID=$($ap.Id)","STDOUT=$appiumLog","STDERR=$appiumErrLog")
Start-Sleep -Seconds 6

# Run WDIO once (probe spec)
W "06_run_command.txt" @("$wdioCmd run $conf --spec $spec")

$wd = Start-Process -FilePath $wdioCmd -ArgumentList "run `"$conf`" --spec `"$spec`"" `
  -WorkingDirectory $wdFull -NoNewWindow -PassThru -Wait `
  -RedirectStandardOutput $wdioOut -RedirectStandardError $wdioErr

W "07_wdio_exit.txt" @("EXITCODE=$($wd.ExitCode)","OUT=$wdioOut","ERR=$wdioErr")

# Stop Appium
try{ Stop-Process -Id $ap.Id -Force -ErrorAction SilentlyContinue }catch{}
W "99_done.txt" @("DONE","ROOT=$root","HOST=$hostUdid","VIEWER=$viewerUdid","WDIO_EXIT=$($wd.ExitCode)")
Write-Host "`nDONE. ROOT=$root`nHOST=$hostUdid`nVIEWER=$viewerUdid`nWDIO_EXIT=$($wd.ExitCode)`n"
