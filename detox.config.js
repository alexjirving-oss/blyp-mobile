// Basic Detox config (placeholder; will be refined)
module.exports = {
  testRunner: {
    args: { '$0': 'jest', config: 'e2e/jest.config.js' },
    jest: { setupTimeout: 120000 }
  },
  apps: {
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build: 'cd android && gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug'
    }
  },
  devices: {
    attached: { type: 'android.attached', device: { adbName: '.*' } }
  },
  configurations: {
    'android.attached': { device: 'attached', app: 'android.debug' }
  }
};
