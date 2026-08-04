async function hostGoLive(host) {
    console.log('[HOST] Starting Go Live flow');
    await ensureBlyp(host, 'HOST');

    // --- 1. Tap the PLUS / CREATE button in the bottom nav ---
    // XML evidence shows this is an unlabeled SVG-icon ViewGroup with no
    // content-desc, text, or resource-id.  Try selectors first, then fall
    // back to a coordinate tap at center of the bottom bar.
    console.log('[HOST] Opening create/plus tab');
    let openedCreateMenu = false;
    const plusSelectors = [
        '~CreatePost, tab, 3 of 5',
        '~CreatePost',
        '~Create',
        '~+',
        'android=new UiSelector().descriptionContains("CreatePost")',
        'android=new UiSelector().descriptionContains("Create")',
        'android=new UiSelector().text("+")'
    ];
    for (const sel of plusSelectors) {
        if (await exists(host, sel, 1200)) {
            try {
                const el = await host.$(sel);
                await el.click();
                openedCreateMenu = true;
                console.log('[HOST] Plus found via selector:', sel);
                break;
            } catch { }
        }
    }
    if (!openedCreateMenu) {
        // Coordinate fallback: center of screen, ~93% height (bottom bar)
        const { width, height } = await host.getWindowSize();
        const plusX = Math.round(width / 2);
        const plusY = Math.round(height * 0.93);
        console.log(`[HOST] Plus selectors failed -- coord tap (${plusX}, ${plusY})`);
        await tapCoord(host, plusX, plusY);
    }
    await host.pause(1000);

    // --- 2. Menu modal opens -- tap "Go Live" ---
    console.log('[HOST] Tapping Go Live in menu');
    let tappedGoLive = false;
    const goLiveSelectors = [
        '~Go Live',
        'android=new UiSelector().description("Go Live")',
        'android=new UiSelector().descriptionContains("Go Live")',
        'android=new UiSelector().text("Go Live")',
        'android=new UiSelector().textContains("Go Live")'
    ];
    for (const sel of goLiveSelectors) {
        if (await exists(host, sel, 1500)) {
            try {
                const el = await host.$(sel);
                await el.click();
                tappedGoLive = true;
                break;
            } catch { }
        }
    }
    if (!tappedGoLive) {
        await tapText(host, 'Go Live', TIMEOUT);
    }
    await host.pause(2000);
    await dismissOverlays(host);

    // --- 3. On Go Live setup screen -- enter a title ---
    console.log('[HOST] Waiting for Go Live setup screen');

    // Wait for an EditText or a recognizable setup element
    const setupEnd = Date.now() + 45000;
    let setupReady = false;
    while (Date.now() < setupEnd && !setupReady) {
        const edits = await host.$$('android=new UiSelector().className("android.widget.EditText")');
        if (edits.length > 0) { setupReady = true; break; }
        if (await exists(host, 'android=new UiSelector().textContains("Enter a title")', 1000)) { setupReady = true; break; }
        if (await exists(host, 'android=new UiSelector().textContains("Add a title")', 1000)) { setupReady = true; break; }
        await host.pause(500);
    }
    if (!setupReady) {
        console.log('[HOST] WARNING: setup screen EditText not found in 45s, proceeding anyway');
    }

    // Tap the title area (might be a hint overlay or an EditText)
    console.log('[HOST] Opening title editor');
    const titleHintSelectors = [
        'android=new UiSelector().textContains("Enter a title")',
        'android=new UiSelector().textContains("Add a title")',
        'android=new UiSelector().textContains("Title")',
        'android=new UiSelector().className("android.widget.EditText").instance(0)'
    ];
    for (const sel of titleHintSelectors) {
        if (await exists(host, sel, 2000)) {
            try {
                const el = await host.$(sel);
                await el.click();
                console.log('[HOST] Title field opened via:', sel);
                break;
            } catch { }
        }
    }
    await host.pause(1000);

    // --- 4. Type the title ---
    const streamTitle = `E2E Test ${Date.now()}`;
    console.log('[HOST] Typing stream title:', streamTitle);

    const editTexts = await host.$$('android=new UiSelector().className("android.widget.EditText")');
    if (editTexts.length > 0) {
        try {
            await editTexts[0].click();
            await host.pause(250);
            await editTexts[0].setValue(streamTitle);
        } catch (e) {
            console.log('[HOST] setValue attempt 1 failed, retrying:', e.message);
            try { await editTexts[0].click(); } catch { }
            await host.pause(300);
            try { await editTexts[0].setValue(streamTitle); } catch { }
        }
    } else {
        console.log('[HOST] WARNING: No EditText for title -- proceeding without title');
    }
    await host.pause(300);

    // --- 5. Tap "Done" to close title editor (if present) ---
    if (await exists(host, 'android=new UiSelector().text("Done")', 3000)) {
        console.log('[HOST] Tapping Done');
        await tapText(host, 'Done', SHORT);
        await host.pause(500);
    }

    // Hide keyboard if still showing
    try { await host.hideKeyboard(); } catch {
        try { await host.back(); } catch { }
    }
    await host.pause(500);

    // --- 6. Tap the final "Go Live" / "Start" button ---
    console.log('[HOST] Tapping final Go Live / Start button');
    let startTapped = false;
    const startSelectors = [
        'android=new UiSelector().text("Go Live")',
        'android=new UiSelector().text("Start Live")',
        'android=new UiSelector().text("Start")',
        'android=new UiSelector().text("Begin")',
        'android=new UiSelector().textContains("Go Live")',
        '~Go Live'
    ];
    for (const sel of startSelectors) {
        if (await exists(host, sel, 2000)) {
            try {
                const el = await host.$(sel);
                await el.click();
                startTapped = true;
                console.log('[HOST] Start button tapped via:', sel);
                break;
            } catch { }
        }
    }
    if (!startTapped) {
        await tapText(host, 'Go Live', TIMEOUT);
    }
    await host.pause(1000);

    // --- 7. Wait for LIVE indicator (after countdown) ---
    console.log('[HOST] Waiting for LIVE indicator...');

    const liveEnd = Date.now() + 120000;
    let isLive = false;
    while (Date.now() < liveEnd && !isLive) {
        await dismissOverlays(host);
        const liveSelectors = [
            'android=new UiSelector().text("LIVE")',
            'android=new UiSelector().textContains("LIVE")',
            'android=new UiSelector().text("Gift")',
            'android=new UiSelector().text("Share")',
            'android=new UiSelector().text("End")'
        ];
        for (const sel of liveSelectors) {
            if (await exists(host, sel, 1500)) {
                isLive = true;
                break;
            }
        }
        if (!isLive) await host.pause(1000);
    }
    if (!isLive) throw new Error('[HOST] LIVE indicator not found after 120s');
    console.log('[HOST] LIVE -- streaming!');

    return streamTitle;
}
