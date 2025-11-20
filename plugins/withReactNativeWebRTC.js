const { withPlugins, withAndroidManifest } = require('expo/config-plugins');

/**
 * Custom plugin to add WebRTC permissions to Android
 */
function withReactNativeWebRTC(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    
    // Add required permissions for WebRTC
    const permissions = [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.CHANGE_NETWORK_STATE',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.WAKE_LOCK',
      'android.permission.WRITE_EXTERNAL_STORAGE'
    ];

    if (!androidManifest.manifest['uses-permission']) {
      androidManifest.manifest['uses-permission'] = [];
    }

    permissions.forEach(permission => {
      const existingPermission = androidManifest.manifest['uses-permission'].find(
        p => p.$['android:name'] === permission
      );
      
      if (!existingPermission) {
        androidManifest.manifest['uses-permission'].push({
          $: { 'android:name': permission }
        });
      }
    });

    // Add hardware features
    if (!androidManifest.manifest['uses-feature']) {
      androidManifest.manifest['uses-feature'] = [];
    }

    const features = [
      { name: 'android.hardware.camera', required: 'true' },
      { name: 'android.hardware.camera.autofocus', required: 'false' },
      { name: 'android.hardware.audio.output', required: 'true' },
      { name: 'android.hardware.microphone', required: 'true' }
    ];

    features.forEach(feature => {
      const existingFeature = androidManifest.manifest['uses-feature'].find(
        f => f.$['android:name'] === feature.name
      );
      
      if (!existingFeature) {
        androidManifest.manifest['uses-feature'].push({
          $: { 
            'android:name': feature.name,
            'android:required': feature.required
          }
        });
      }
    });

    return config;
  });
}

module.exports = withReactNativeWebRTC;