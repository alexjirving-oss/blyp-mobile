const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Android 15 (API 35): BOOT_COMPLETED receivers may not start restricted FGS
 * types (mediaPlayback, dataSync, camera, phoneCall, mediaProjection, microphone).
 *
 * Blyp keeps IncomingCallForegroundService (mediaPlayback) for FCM-woken
 * incoming-call ringtones — that path is legal. expo-notifications also merges a
 * BOOT_COMPLETED receiver that only re-arms AlarmManager, but Play's static
 * check flags the combination as a crash risk.
 *
 * Strip boot / reboot / quickboot intents from NotificationsService while
 * keeping NOTIFICATION_EVENT + MY_PACKAGE_REPLACED. Local reminders re-arm on
 * app open (see reminderService.ensureRemindersArmed).
 */
function withAndroid15BootFgsCompliance(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!manifest) return cfg;

    // Drop RECEIVE_BOOT_COMPLETED — nothing in Blyp may start restricted FGS from boot.
    const perms = manifest['uses-permission'];
    if (Array.isArray(perms)) {
      manifest['uses-permission'] = perms.filter(
        (p) => p?.$?.['android:name'] !== 'android.permission.RECEIVE_BOOT_COMPLETED',
      );
      const alreadyRemoved = manifest['uses-permission'].some(
        (p) =>
          p?.$?.['android:name'] === 'android.permission.RECEIVE_BOOT_COMPLETED' &&
          p?.$?.['tools:node'] === 'remove',
      );
      if (!alreadyRemoved) {
        manifest['uses-permission'].push({
          $: {
            'android:name': 'android.permission.RECEIVE_BOOT_COMPLETED',
            'tools:node': 'remove',
          },
        });
      }
    }

    const app = manifest.application?.[0];
    if (!app) return cfg;
    if (!Array.isArray(app.receiver)) app.receiver = [];

    const BOOT_ACTIONS = new Set([
      'android.intent.action.BOOT_COMPLETED',
      'android.intent.action.REBOOT',
      'android.intent.action.QUICKBOOT_POWERON',
      'com.htc.intent.action.QUICKBOOT_POWERON',
      'android.intent.action.LOCKED_BOOT_COMPLETED',
    ]);

    const targetName = 'expo.modules.notifications.service.NotificationsService';
    const existingIdx = app.receiver.findIndex((r) => r?.$?.['android:name'] === targetName);

    const compliantReceiver = {
      $: {
        'android:name': targetName,
        'android:enabled': 'true',
        'android:exported': 'false',
        'tools:node': 'replace',
      },
      'intent-filter': [
        {
          $: { 'android:priority': '-1' },
          action: [
            { $: { 'android:name': 'expo.modules.notifications.NOTIFICATION_EVENT' } },
            { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } },
          ],
        },
      ],
    };

    if (existingIdx >= 0) {
      // Also scrub any leftover boot actions if a prior merge left them.
      const rec = app.receiver[existingIdx];
      const filters = Array.isArray(rec['intent-filter']) ? rec['intent-filter'] : [];
      for (const filter of filters) {
        if (!Array.isArray(filter.action)) continue;
        filter.action = filter.action.filter(
          (a) => !BOOT_ACTIONS.has(a?.$?.['android:name']),
        );
      }
      app.receiver[existingIdx] = compliantReceiver;
    } else {
      app.receiver.push(compliantReceiver);
    }

    return cfg;
  });
}

module.exports = withAndroid15BootFgsCompliance;
