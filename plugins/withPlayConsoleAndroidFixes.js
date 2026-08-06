const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Play Console large-screen / foldable recommendations:
 * - MainActivity must not hard-lock PORTRAIT (blocks Fold unfold).
 * - Override ML Kit code-scanner delegate activity portrait lock from
 *   play-services-code-scanner (pulled in by expo-camera barcode_ui).
 * - Mark the app resizeable for multi-window / foldables.
 */
function withPlayConsoleAndroidFixes(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!manifest) return cfg;

    const app = manifest.application?.[0];
    if (!app) return cfg;

    app.$ = app.$ || {};
    app.$['android:resizeableActivity'] = 'true';

    if (!Array.isArray(app.activity)) app.activity = [];

    for (const activity of app.activity) {
      const name = activity?.$?.['android:name'];
      if (name === '.MainActivity' || name === 'com.blyp.mobile.MainActivity') {
        activity.$['android:screenOrientation'] = 'fullSensor';
        // Keep screenSize/screenLayout so unfold / fold config changes are handled.
        const existing = String(activity.$['android:configChanges'] || '');
        const needed = [
          'keyboard',
          'keyboardHidden',
          'orientation',
          'screenSize',
          'screenLayout',
          'smallestScreenSize',
          'uiMode',
        ];
        const set = new Set(
          existing
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean),
        );
        for (const n of needed) set.add(n);
        activity.$['android:configChanges'] = [...set].join('|');
      }
    }

    const mlkitName =
      'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity';
    const existingIdx = app.activity.findIndex((a) => a?.$?.['android:name'] === mlkitName);
    const mlkitOverride = {
      $: {
        'android:name': mlkitName,
        'android:exported': 'false',
        'android:screenOrientation': 'fullSensor',
        'tools:node': 'merge',
        'tools:replace': 'android:screenOrientation',
      },
    };
    if (existingIdx >= 0) {
      app.activity[existingIdx] = mlkitOverride;
    } else {
      app.activity.push(mlkitOverride);
    }

    return cfg;
  });
}

module.exports = withPlayConsoleAndroidFixes;
