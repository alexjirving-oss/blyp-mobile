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

  // Login submit â€” content-desc selectors FIRST (the clickable ViewGroup),
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
    console.log('[PROBE] plus has no selectors â€” using coord tap at (' + plusX + ',' + plusY + ')');
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
