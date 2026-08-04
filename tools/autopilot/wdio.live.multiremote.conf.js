/**
 * WDIO v9 Multiremote config for Blyp LIVE E2E (two physical devices).
 *
 * Env vars consumed:
 *   BLYP_APK_PATH       – absolute path to the release APK
 *   BLYP_HOST_UDID      – ADB serial of the HOST device
 *   BLYP_VIEWER_UDID    – ADB serial of the VIEWER device
 *   APPIUM_PORT          – Appium server port (default 4723)
 */
const path = require('path');

const apkPath = process.env.BLYP_APK_PATH
    || path.resolve(__dirname, '..', '..', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

const appiumPort = parseInt(process.env.APPIUM_PORT || '4723', 10);

const hostUdid = process.env.BLYP_HOST_UDID || 'R9YT30NGVSJ';
const viewerUdid = process.env.BLYP_VIEWER_UDID || 'R58N6553WTF';

const sharedCaps = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:appPackage': 'com.blyp.mobile',
    'appium:appActivity': '.MainActivity',
    'appium:noReset': false,               // fresh install each run
    'appium:fullReset': false,
    'appium:autoGrantPermissions': true,
    'appium:newCommandTimeout': 180,
    'appium:adbExecTimeout': 60000,
    'appium:uiautomator2ServerInstallTimeout': 90000,
    'appium:skipServerInstallation': false,
    'appium:app': apkPath,
};

exports.config = {
    runner: 'local',
    port: appiumPort,
    path: '/',                              // Appium 2.x / 3.x default

    capabilities: {
        host: {
            capabilities: {
                ...sharedCaps,
                'appium:udid': hostUdid,
                'appium:systemPort': 8200,
                'appium:mjpegServerPort': 9100,
                'appium:chromedriverPort': 9515,
            },
        },
        viewer: {
            capabilities: {
                ...sharedCaps,
                'appium:udid': viewerUdid,
                'appium:systemPort': 8201,
                'appium:mjpegServerPort': 9101,
                'appium:chromedriverPort': 9516,
            },
        },
    },

    logLevel: 'warn',
    bail: 0,
    waitforTimeout: 15000,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,
    services: [],                           // Appium started externally
    framework: 'mocha',
    reporters: ['spec'],
    specs: [path.resolve(__dirname, '..', '..', 'e2e', 'live_e2e.multiremote.js')],
    mochaOpts: {
        ui: 'bdd',
        timeout: 300000,                      // 5 min per test — live operations are slow
    },
};
