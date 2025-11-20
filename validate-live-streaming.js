// Validation script for live streaming setup
// Run this to verify all pieces are in place

const fs = require('fs');
const path = require('path');

console.log('🔍 Validating Live Streaming Setup...\n');

const checks = [];

// Check 1: LiveService.js has all required exports
try {
  const liveServicePath = path.join(__dirname, 'src', 'services', 'LiveService.js');
  const liveServiceContent = fs.readFileSync(liveServicePath, 'utf8');
  
  const requiredExports = [
    'setUserStatus',
    'ensureUserProfile',
    'createStream',
    'endStream',
    'subscribeToLiveUsers'
  ];
  
  const missing = requiredExports.filter(exp => !liveServiceContent.includes(`export async function ${exp}`));
  
  if (missing.length === 0) {
    checks.push({ name: 'LiveService exports', status: '✅', details: 'All required functions present' });
  } else {
    checks.push({ name: 'LiveService exports', status: '❌', details: `Missing: ${missing.join(', ')}` });
  }
} catch (error) {
  checks.push({ name: 'LiveService exports', status: '❌', details: error.message });
}

// Check 2: LiveStreamScreen imports LiveService
try {
  const screenPath = path.join(__dirname, 'src', 'screens', 'LiveStreamScreen.js');
  const screenContent = fs.readFileSync(screenPath, 'utf8');
  
  if (screenContent.includes("import { createStream, endStream } from '../services/LiveService'")) {
    checks.push({ name: 'LiveStreamScreen imports', status: '✅', details: 'LiveService imported' });
  } else {
    checks.push({ name: 'LiveStreamScreen imports', status: '❌', details: 'LiveService not imported' });
  }
  
  // Check if createStream is called
  if (screenContent.includes('await createStream({')) {
    checks.push({ name: 'createStream() called', status: '✅', details: 'Function is called in actuallyStartStream' });
  } else {
    checks.push({ name: 'createStream() called', status: '❌', details: 'Function not called' });
  }
  
  // Check if endStream is called
  if (screenContent.includes('await endStream(')) {
    checks.push({ name: 'endStream() called', status: '✅', details: 'Function is called in stopStreaming' });
  } else {
    checks.push({ name: 'endStream() called', status: '❌', details: 'Function not called' });
  }
  
  // Check timer implementation
  if (screenContent.includes('setElapsedTime')) {
    checks.push({ name: 'Timer state', status: '✅', details: 'elapsedTime state variable exists' });
  } else {
    checks.push({ name: 'Timer state', status: '⚠️', details: 'elapsedTime not found' });
  }
  
  if (screenContent.includes('setInterval') && screenContent.includes('elapsedTime')) {
    checks.push({ name: 'Timer interval', status: '✅', details: 'setInterval updates elapsedTime' });
  } else {
    checks.push({ name: 'Timer interval', status: '❌', details: 'Timer interval not properly set up' });
  }
  
} catch (error) {
  checks.push({ name: 'LiveStreamScreen checks', status: '❌', details: error.message });
}

// Check 3: AuthScreen calls ensureUserProfile
try {
  const authPath = path.join(__dirname, 'src', 'screens', 'AuthScreen.js');
  const authContent = fs.readFileSync(authPath, 'utf8');
  
  if (authContent.includes("import { ensureUserProfile }")) {
    checks.push({ name: 'AuthScreen imports', status: '✅', details: 'ensureUserProfile imported' });
  } else {
    checks.push({ name: 'AuthScreen imports', status: '❌', details: 'ensureUserProfile not imported' });
  }
  
  if (authContent.includes('await ensureUserProfile()')) {
    checks.push({ name: 'Profile creation', status: '✅', details: 'ensureUserProfile called after auth' });
  } else {
    checks.push({ name: 'Profile creation', status: '❌', details: 'ensureUserProfile not called' });
  }
} catch (error) {
  checks.push({ name: 'AuthScreen checks', status: '❌', details: error.message });
}

// Check 4: LiveUsersTab component
try {
  const tabPath = path.join(__dirname, 'src', 'components', 'LiveUsersTab.js');
  const tabContent = fs.readFileSync(tabPath, 'utf8');
  
  if (tabContent.includes('subscribeToLiveUsers')) {
    checks.push({ name: 'LiveUsersTab subscription', status: '✅', details: 'subscribeToLiveUsers used' });
  } else {
    checks.push({ name: 'LiveUsersTab subscription', status: '❌', details: 'No subscription set up' });
  }
  
  if (tabContent.includes('useSafeAreaInsets')) {
    checks.push({ name: 'Safe area padding', status: '✅', details: 'Safe area insets implemented' });
  } else {
    checks.push({ name: 'Safe area padding', status: '⚠️', details: 'No safe area padding' });
  }
} catch (error) {
  checks.push({ name: 'LiveUsersTab checks', status: '❌', details: error.message });
}

// Check 5: Firestore rules
try {
  const rulesPath = path.join(__dirname, 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');
  
  if (rulesContent.includes('allow read') && rulesContent.includes('request.auth')) {
    checks.push({ name: 'Firestore rules', status: '✅', details: 'Authenticated users can read' });
  } else {
    checks.push({ name: 'Firestore rules', status: '⚠️', details: 'Rules may be too restrictive' });
  }
} catch (error) {
  checks.push({ name: 'Firestore rules', status: '❌', details: error.message });
}

// Print results
console.log('═'.repeat(80));
console.log('VALIDATION RESULTS');
console.log('═'.repeat(80));

checks.forEach(check => {
  console.log(`${check.status} ${check.name.padEnd(30)} - ${check.details}`);
});

console.log('═'.repeat(80));

const passed = checks.filter(c => c.status === '✅').length;
const failed = checks.filter(c => c.status === '❌').length;
const warnings = checks.filter(c => c.status === '⚠️').length;

console.log(`\n📊 Summary: ${passed} passed, ${failed} failed, ${warnings} warnings\n`);

if (failed === 0) {
  console.log('✅ All critical checks passed! Your live streaming setup is ready.\n');
  console.log('📝 Next steps:');
  console.log('   1. Restart Metro bundler: npx expo start --clear');
  console.log('   2. Test login/signup to ensure profile creation');
  console.log('   3. Start stream on Device A');
  console.log('   4. Check Live tab on Device B\n');
} else {
  console.log('❌ Some checks failed. Please review the issues above.\n');
  process.exit(1);
}
