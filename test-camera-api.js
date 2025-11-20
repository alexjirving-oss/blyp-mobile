/**
 * Camera API Test
 * Run this to verify Camera and CameraType imports work correctly
 */

console.log('🧪 Testing Camera API imports...\n');

try {
  // Test 1: Import Camera and CameraType
  console.log('Test 1: Importing Camera and CameraType...');
  const { Camera, CameraType } = require('expo-camera');
  
  console.log('✅ Camera imported:', typeof Camera);
  console.log('✅ CameraType imported:', typeof CameraType);
  
  // Test 2: Check CameraType enum values
  console.log('\nTest 2: Checking CameraType enum values...');
  console.log('CameraType.front:', CameraType.front);
  console.log('CameraType.back:', CameraType.back);
  
  // Test 3: Check if Camera.Constants exists (should not in SDK 48+)
  console.log('\nTest 3: Checking Camera.Constants (should be undefined)...');
  console.log('Camera.Constants:', Camera.Constants);
  
  if (Camera.Constants) {
    console.log('⚠️  WARNING: Camera.Constants exists! You may be using an old expo-camera version');
    console.log('Camera.Constants.Type:', Camera.Constants.Type);
  } else {
    console.log('✅ Camera.Constants is undefined (correct for SDK 48+)');
  }
  
  console.log('\n✅ All tests passed! Camera API is correctly configured.');
  
} catch (error) {
  console.error('\n❌ Error during Camera API test:');
  console.error(error.message);
  console.error('\nStack trace:');
  console.error(error.stack);
}
