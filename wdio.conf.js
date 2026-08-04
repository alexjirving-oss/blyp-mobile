/**
 * Minimal WDIO config for Appium-based E2E on Android (com.blyp.mobile).
 * Used by automated proof scripts — not part of normal dev workflow.
 */
const path = require('path');

exports.config = {
    runner: 'local',
    port: 4723,
    specs: ['./e2e/**/*.e2e.js'],       // overridden by --spec flag
    maxInstances: 1,
    capabilities: [{
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:udid': process.env.BLYP_UDID || undefined,
        'appium:appPackage': 'com.blyp.mobile',
        'appium:appActivity': '.MainActivity',
        'appium:noReset': true,            // keep current state, don't reinstall
        'appium:autoGrantPermissions': true,
        'appium:newCommandTimeout': 120,
        'appium:adbExecTimeout': 30000,
    }],
    logLevel: 'warn',
    bail: 0,
    waitforTimeout: 10000,
    connectionRetryTimeout: 90000,
    connectionRetryCount: 3,
    // No appium service — we start Appium externally
    services: [],
    framework: 'mocha',
    reporters: ['spec'],
    mochaOpts: {
        ui: 'bdd',
        timeout: 60000,
    },
};
