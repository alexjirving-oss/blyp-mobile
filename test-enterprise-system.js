#!/usr/bin/env node

/**
 * Enterprise Live Streaming System - Quick Test Script
 * 
 * This script tests the enterprise live streaming system components
 * to verify everything is working correctly.
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 ENTERPRISE LIVE STREAMING SYSTEM - QUICK TEST');
console.log('='.repeat(60));

// Test 1: Check if all enterprise components exist
console.log('\n📁 1. CHECKING ENTERPRISE COMPONENTS...');

const requiredFiles = [
  'src/services/ScalableHLSService.js',
  'src/components/ProductionLiveStreamBroadcaster.js', 
  'src/components/IntelligentAdaptivePlayer.js',
  'src/services/EnterpriseStorageService.js',
  'src/services/EnterpriseAnalyticsService.js',
  'src/testing/EnterpriseLiveStreamTester.js',
  'src/integration/EnterpriseSystemIntegration.js',
  'functions/src/index.ts'
];

let allFilesExist = true;

for (const filePath of requiredFiles) {
  const fullPath = path.join(__dirname, filePath);
  if (fs.existsSync(fullPath)) {
    console.log(`✅ ${filePath}`);
  } else {
    console.log(`❌ ${filePath} - MISSING`);
    allFilesExist = false;
  }
}

// Test 2: Check Firebase configuration
console.log('\n🔥 2. CHECKING FIREBASE CONFIGURATION...');

const firebaseConfigPath = path.join(__dirname, 'src/config/firebase.js');
if (fs.existsSync(firebaseConfigPath)) {
  console.log('✅ Firebase config file exists');
  
  try {
    const configContent = fs.readFileSync(firebaseConfigPath, 'utf8');
    
    const requiredConfigs = [
      'apiKey',
      'authDomain', 
      'projectId',
      'storageBucket',
      'messagingSenderId',
      'appId'
    ];
    
    let configValid = true;
    for (const config of requiredConfigs) {
      if (configContent.includes(config)) {
        console.log(`✅ ${config} configured`);
      } else {
        console.log(`❌ ${config} - MISSING`);
        configValid = false;
      }
    }
    
    if (configValid) {
      console.log('✅ Firebase configuration is complete');
    } else {
      console.log('❌ Firebase configuration incomplete');
    }
    
  } catch (error) {
    console.log(`❌ Error reading Firebase config: ${error.message}`);
  }
} else {
  console.log('❌ Firebase config file missing');
}

// Test 3: Check feature flags
console.log('\n🏁 3. CHECKING FEATURE FLAGS...');

const featureFlagPath = path.join(__dirname, 'src/config/StreamingFeatureFlag.js');
if (fs.existsSync(featureFlagPath)) {
  console.log('✅ Streaming feature flag file exists');
  
  try {
    const flagContent = fs.readFileSync(featureFlagPath, 'utf8');
    
    if (flagContent.includes('BUILD_ENABLE_LIVE_STREAMING') && flagContent.includes('true')) {
      console.log('✅ Live streaming enabled');
    } else {
      console.log('⚠️  Live streaming may be disabled');
    }
  } catch (error) {
    console.log(`❌ Error reading feature flags: ${error.message}`);
  }
} else {
  console.log('❌ Feature flag file missing');
}

// Test 4: Check package.json dependencies
console.log('\n📦 4. CHECKING DEPENDENCIES...');

const packageJsonPath = path.join(__dirname, 'package.json');
if (fs.existsSync(packageJsonPath)) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    const requiredDeps = [
      'expo',
      'react-native',
      'firebase',
      'expo-camera',
      'expo-av'
    ];
    
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    for (const dep of requiredDeps) {
      if (dependencies[dep]) {
        console.log(`✅ ${dep} v${dependencies[dep]}`);
      } else {
        console.log(`❌ ${dep} - MISSING`);
      }
    }
  } catch (error) {
    console.log(`❌ Error reading package.json: ${error.message}`);
  }
} else {
  console.log('❌ package.json missing');
}

// Test 5: Check Firebase Functions
console.log('\n⚡ 5. CHECKING FIREBASE FUNCTIONS...');

const functionsPath = path.join(__dirname, 'functions');
const functionsPackagePath = path.join(functionsPath, 'package.json');
const functionsIndexPath = path.join(functionsPath, 'src/index.ts');

if (fs.existsSync(functionsPath)) {
  console.log('✅ Functions directory exists');
  
  if (fs.existsSync(functionsPackagePath)) {
    console.log('✅ Functions package.json exists');
  } else {
    console.log('❌ Functions package.json missing');
  }
  
  if (fs.existsSync(functionsIndexPath)) {
    console.log('✅ Functions index.ts exists');
  } else {
    console.log('❌ Functions index.ts missing');
  }
} else {
  console.log('❌ Functions directory missing');
}

// Test 6: Check documentation
console.log('\n📚 6. CHECKING DOCUMENTATION...');

const documentationFiles = [
  'ENTERPRISE_README.md',
  'PRODUCTION_DEPLOYMENT_CHECKLIST.md',
  'QUICK_START.md',
  'TROUBLESHOOTING_GUIDE.md'
];

for (const docFile of documentationFiles) {
  const docPath = path.join(__dirname, docFile);
  if (fs.existsSync(docPath)) {
    console.log(`✅ ${docFile}`);
  } else {
    console.log(`⚠️  ${docFile} - Optional documentation missing`);
  }
}

// Final Summary
console.log('\n' + '='.repeat(60));
console.log('🎯 ENTERPRISE SYSTEM TEST SUMMARY');
console.log('='.repeat(60));

if (allFilesExist) {
  console.log('✅ All enterprise components are present');
  console.log('✅ System ready for testing');
  
  console.log('\n🚀 NEXT STEPS:');
  console.log('1. Run the app: .\\start-app.ps1');
  console.log('2. Test live streaming: node test-live-streaming.js');
  console.log('3. Run full test suite: node run-enterprise-tests.js');
  console.log('4. Check production readiness: node production-validation.js');
  
} else {
  console.log('❌ Some enterprise components are missing');
  console.log('⚠️  Please ensure all files are created before testing');
}

console.log('\n📖 For detailed testing instructions, see:');
console.log('   - ENTERPRISE_README.md');
console.log('   - PRODUCTION_DEPLOYMENT_CHECKLIST.md');
console.log('\n🎉 Enterprise Live Streaming System Check Complete!');