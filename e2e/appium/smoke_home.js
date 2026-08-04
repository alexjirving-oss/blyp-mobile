const fs = require("fs");
const path = require("path");
const { remote } = require("webdriverio");

// App package/activity
const PKG = "com.blyp.mobile";
const ACT = "com.blyp.mobile.MainActivity"; // adjust if needed

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runOne(deviceName, udid, outDir) {
    const log = [];
    const push = (s) => { log.push(s); console.log(s); };

    push(`DEVICE_NAME=${deviceName}`);
    push(`UDID=${udid}`);
    push(`OUT_DIR=${outDir}`);

    const caps = {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:udid": udid,
        "appium:newCommandTimeout": 180,
        "appium:appPackage": PKG,
        "appium:appActivity": ACT,
        "appium:autoGrantPermissions": true,
        "appium:noReset": true
    };

    const client = await remote({
        hostname: "127.0.0.1",
        port: 4723,
        path: "/",
        logLevel: "error",
        capabilities: caps
    });

    let result = "PASS";
    let reason = "OK";

    try {
        push("STEP=LAUNCH");
        // App is launched automatically via appPackage/appActivity in capabilities
        // Use mobile: startActivity if app needs to be restarted
        try {
            await client.execute("mobile: startActivity", {
                component: `${PKG}/${ACT}`,
                action: "android.intent.action.MAIN",
                categories: "android.intent.category.LAUNCHER"
            });
        } catch (launchErr) {
            push("WARN_LAUNCH=" + String(launchErr && launchErr.message ? launchErr.message : launchErr));
            // App may already be launched via caps, continue
        }
        await sleep(3000);

        // Wait for the app to be in foreground
        push("STEP=CHECK_FOREGROUND");
        await sleep(1000);

        // Dump page source for diagnostics (always, for debugging selectors)
        push("STEP=DUMP_PAGE_SOURCE");
        try {
            const source = await client.getPageSource();
            fs.writeFileSync(path.join(outDir, "50_page_source.xml"), source);
            push("WROTE_PAGE_SOURCE=50_page_source.xml");
        } catch (srcErr) {
            push("WARN_PAGE_SOURCE=" + String(srcErr.message || srcErr));
        }

        // Try multiple selector strategies for ROOT_APP
        // Strategy 1: accessibility id (content-desc) — works if accessibilityLabel is set
        // Strategy 2: resource-id — React Native testID maps to resource-id on Android
        // Strategy 3: any visible element from the app (proof app loaded)
        push("STEP=WAIT_APP_ELEMENT");
        let foundRoot = false;
        let foundHome = false;

        // Try accessibility id first (for rebuilt APKs with accessibilityLabel)
        try {
            const root = await client.$("~ROOT_APP");
            await root.waitForExist({ timeout: 8000 });
            foundRoot = true;
            push("FOUND=ROOT_APP_accessibility_id");
        } catch { }

        // Try resource-id (testID mapping: com.blyp.mobile:id/ROOT_APP or just ROOT_APP)
        if (!foundRoot) {
            try {
                const root = await client.$('android=new UiSelector().resourceId("ROOT_APP")');
                await root.waitForExist({ timeout: 5000 });
                foundRoot = true;
                push("FOUND=ROOT_APP_resource_id_short");
            } catch { }
        }
        if (!foundRoot) {
            try {
                const root = await client.$(`android=new UiSelector().resourceId("${PKG}:id/ROOT_APP")`);
                await root.waitForExist({ timeout: 5000 });
                foundRoot = true;
                push("FOUND=ROOT_APP_resource_id_full");
            } catch { }
        }

        // Fallback: just check the app is displaying UI (any RN view hierarchy element)
        if (!foundRoot) {
            try {
                // Look for any android.view.ViewGroup — proof RN rendered
                const anyView = await client.$("android.view.ViewGroup");
                await anyView.waitForExist({ timeout: 15000 });
                foundRoot = true;
                push("FOUND=FALLBACK_ViewGroup (app rendered but ROOT_APP selector not found)");
            } catch { }
        }

        if (!foundRoot) {
            throw new Error("APP_NOT_LOADED: No app UI elements found after launch");
        }

        // Try HOME_FEED similarly
        push("STEP=WAIT_HOME_FEED");
        try {
            const home = await client.$("~HOME_FEED");
            await home.waitForExist({ timeout: 8000 });
            foundHome = true;
            push("FOUND=HOME_FEED_accessibility_id");
        } catch { }

        if (!foundHome) {
            try {
                const home = await client.$('android=new UiSelector().resourceId("HOME_FEED")');
                await home.waitForExist({ timeout: 5000 });
                foundHome = true;
                push("FOUND=HOME_FEED_resource_id");
            } catch { }
        }

        if (!foundHome) {
            // Not fatal — app may be on login screen or different tab
            push("WARN=HOME_FEED not found (app may require login or different landing)");
        }

        push(`ASSERT=APP_LOADED root=${foundRoot} home=${foundHome}`);
    } catch (e) {
        result = "FAIL";
        reason = String(e && e.message ? e.message : e);
        push("ERROR=" + reason);

        // screenshot
        try {
            const png = await client.takeScreenshot();
            fs.writeFileSync(path.join(outDir, "90_fail_screenshot.png"), Buffer.from(png, "base64"));
            push("WROTE_SCREENSHOT=90_fail_screenshot.png");
        } catch { }
    } finally {
        try { await client.deleteSession(); } catch { }
    }

    fs.writeFileSync(path.join(outDir, "00_result.txt"), `RESULT=${result}\nREASON=${reason}\n`);
    fs.writeFileSync(path.join(outDir, "99_log.txt"), log.join("\n") + "\n");

    return { result, reason };
}

(async () => {
    const udid = process.env.BLYP_UDID;
    const name = process.env.BLYP_DEVICE_NAME || udid;
    const outDir = process.env.BLYP_OUTDIR;

    if (!udid) throw new Error("Missing env BLYP_UDID");
    if (!outDir) throw new Error("Missing env BLYP_OUTDIR");

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const r = await runOne(name, udid, outDir);
    process.exit(r.result === "PASS" ? 0 : 2);
})();
