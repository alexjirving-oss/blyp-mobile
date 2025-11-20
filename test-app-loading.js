// This script verifies that the app loads correctly with the LiveStream feature disabled
// Run it with: node test-app-loading.js

const fs = require('fs');
const path = require('path');

console.log('🧪 Testing app configuration for LiveStream feature flag...');

// Check the StreamingFeatureFlag.js file
const flagFilePath = path.join(__dirname, 'src', 'config', 'StreamingFeatureFlag.js');
try {
  const flagFileContent = fs.readFileSync(flagFilePath, 'utf-8');
  
  // Check if the feature flag is disabled
  if (flagFileContent.includes('BUILD_ENABLE_LIVE_STREAMING = false')) {
    console.log('✅ LiveStream feature flag is correctly disabled');
  } else if (flagFileContent.includes('BUILD_ENABLE_LIVE_STREAMING = true')) {
    console.log('❌ WARNING: LiveStream feature flag is still enabled!');
    console.log('   Please update src/config/StreamingFeatureFlag.js to set BUILD_ENABLE_LIVE_STREAMING = false');
  } else {
    console.log('❓ Could not determine LiveStream feature flag status');
  }
} catch (error) {
  console.error('❌ Error reading StreamingFeatureFlag.js:', error.message);
}

// Optional: Check HomeScreen.js for proper conditional rendering
const homeScreenPath = path.join(__dirname, 'src', 'screens', 'HomeScreen.js');
try {
  const homeScreenContent = fs.readFileSync(homeScreenPath, 'utf-8');
  
  if (homeScreenContent.includes('streamingEnabled &&')) {
    console.log('✅ HomeScreen correctly uses streamingEnabled conditional check');
  } else {
    console.log('⚠️ HomeScreen might not be conditionally rendering LiveStreamsFeed correctly');
  }
} catch (error) {
  console.error('❌ Error reading HomeScreen.js:', error.message);
}

console.log('\nℹ️ To test the app on device:');
console.log('1. Run: npm start');
console.log('2. Open the app on your device using Expo Go');
console.log('3. Verify the HomeScreen loads without any LiveStream UI elements');