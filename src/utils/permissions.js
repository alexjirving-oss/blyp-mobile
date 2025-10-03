import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Request camera and microphone permissions for Android devices
 * iOS handles this automatically through Info.plist
 */
export const requestCameraAndAudioPermission = async () => {
  if (Platform.OS !== 'android') {
    return true;
  }

  try {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    ]);
    
    if (
      granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED &&
      granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED
    ) {
      console.log('✅ Camera and audio permissions granted');
      return true;
    } else {
      console.log('❌ Camera and/or audio permission denied');
      return false;
    }
  } catch (error) {
    console.error('❌ Error requesting permissions:', error);
    return false;
  }
};

/**
 * Check if camera and microphone permissions are granted
 */
export const checkCameraAndAudioPermission = async () => {
  if (Platform.OS !== 'android') {
    return true; // iOS handles this through Info.plist
  }

  try {
    const cameraPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
    const audioPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    
    return cameraPermission && audioPermission;
  } catch (error) {
    console.error('❌ Error checking permissions:', error);
    return false;
  }
};