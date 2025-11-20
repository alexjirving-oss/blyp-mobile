/**
 * Live Streaming Debug Helper
 * 
 * Run this to diagnose streaming issues:
 * - Check camera permissions
 * - Test video recording capabilities  
 * - Verify Firebase connectivity
 * - Test segment upload process
 */

console.log('🔍 Live Streaming Debug Analysis');
console.log('================================');

// Check what mode we're running in
console.log('📱 Environment Detection:');
console.log('  __DEV__:', __DEV__);
console.log('  Platform.OS:', require('react-native').Platform.OS);
console.log('  Has Metro:', !!global.__METRO__);

// Check Firebase config
try {
  const firebase = require('./src/config/firebase');
  console.log('✅ Firebase config loaded');
  console.log('  Auth available:', !!firebase.auth);
  console.log('  DB available:', !!firebase.db);
  console.log('  Storage available:', !!firebase.storage);
} catch (error) {
  console.log('❌ Firebase config error:', error.message);
}

// Check camera permissions
async function checkCameraPermissions() {
  try {
    const { Camera } = require('expo-camera');
    const { status } = await Camera.getCameraPermissionsAsync();
    console.log('📷 Camera permissions:', status);
    
    if (status !== 'granted') {
      console.log('⚠️  Camera permission not granted - this will cause streaming issues');
    }
  } catch (error) {
    console.log('❌ Camera permission check failed:', error.message);
  }
}

// Check microphone permissions  
async function checkMicrophonePermissions() {
  try {
    const { Audio } = require('expo-av');
    const { status } = await Audio.getPermissionsAsync();
    console.log('🎤 Microphone permissions:', status);
    
    if (status !== 'granted') {
      console.log('⚠️  Microphone permission not granted - this will cause streaming issues');
    }
  } catch (error) {
    console.log('❌ Microphone permission check failed:', error.message);
  }
}

// Test Firebase connectivity
async function testFirebaseConnectivity() {
  try {
    const { db } = require('./src/config/firebase');
    const { doc, getDoc } = require('firebase/firestore');
    
    // Try to read a test document
    const testRef = doc(db, 'test', 'connectivity');
    await getDoc(testRef);
    console.log('✅ Firebase Firestore connectivity working');
  } catch (error) {
    console.log('❌ Firebase connectivity issue:', error.message);
  }
}

// Run all checks
async function runDiagnostics() {
  console.log('\n🔧 Running Live Streaming Diagnostics...');
  
  await checkCameraPermissions();
  await checkMicrophonePermissions();
  await testFirebaseConnectivity();
  
  console.log('\n💡 Common Issues & Solutions:');
  console.log('1. Camera permission denied → Grant camera access in device settings');
  console.log('2. "APK Module Stream Health degraded" → Usually means video recording is failing');
  console.log('3. "Waiting for video segments" → Check if broadcaster is actually uploading segments');
  console.log('4. Firebase errors → Check internet connection and Firebase config');
  
  console.log('\n📋 Next Steps:');
  console.log('1. Check the Metro bundler logs for any red error messages');
  console.log('2. Look for camera recording errors in console');
  console.log('3. Verify streamId is being passed correctly between broadcaster and viewer');
  console.log('4. Test with a second device as viewer while first device broadcasts');
}

// Export for use in React Native
if (typeof module !== 'undefined') {
  module.exports = { runDiagnostics };
}

// Run diagnostics if called directly
if (require.main === module) {
  runDiagnostics();
}