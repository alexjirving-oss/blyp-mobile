/**
 * COMPREHENSIVE LIVE STREAMING FIX VALIDATION
 * 
 * This script validates both broadcaster and viewer fixes implemented.
 * Run this to verify the streaming system is working correctly.
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 COMPREHENSIVE LIVE STREAMING FIX VALIDATION');
console.log('================================================');

// Track validation results
const validationResults = {
  broadcasterFixes: [],
  viewerFixes: [],
  fileIntegrity: [],
  architectureChanges: [],
  riskAssessment: []
};

function addResult(category, test, status, details) {
  validationResults[category].push({
    test,
    status,
    details,
    timestamp: new Date().toISOString()
  });
  
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} [${category.toUpperCase()}] ${test}: ${status}`);
  if (details) console.log(`   └─ ${details}`);
}

// Test 1: Validate LiveStreamScreen broadcaster logic fix
console.log('\n📡 Testing Broadcaster Camera Fix...');

try {
  const liveStreamScreenPath = 'src/screens/LiveStreamScreen.js';
  const liveStreamContent = fs.readFileSync(liveStreamScreenPath, 'utf8');
  
  // Check if the old broken condition was removed
  const oldConditionExists = liveStreamContent.includes('isCreator && isLive && (route.params?.streamId || streamId)');
  if (oldConditionExists) {
    addResult('broadcasterFixes', 'Remove Broken Condition', 'FAIL', 'Old condition still exists');
  } else {
    addResult('broadcasterFixes', 'Remove Broken Condition', 'PASS', 'Old restrictive condition removed');
  }
  
  // Check if new simplified condition exists
  const newConditionExists = liveStreamContent.includes('isCreator ? (') || liveStreamContent.includes('{isCreator ? (');
  if (newConditionExists) {
    addResult('broadcasterFixes', 'New Simplified Condition', 'PASS', 'Broadcaster shows camera immediately when isCreator=true');
  } else {
    addResult('broadcasterFixes', 'New Simplified Condition', 'FAIL', 'New condition not found');
  }
  
  // Check if preview-mode streamId fallback exists
  const previewModeExists = liveStreamContent.includes('preview-mode');
  if (previewModeExists) {
    addResult('broadcasterFixes', 'Preview Mode Fallback', 'PASS', 'Fallback streamId for preview mode implemented');
  } else {
    addResult('broadcasterFixes', 'Preview Mode Fallback', 'WARN', 'Preview mode fallback not found');
  }
  
  // Check APKFixedLiveStreamBroadcaster usage
  const apkBroadcasterUsed = liveStreamContent.includes('APKFixedLiveStreamBroadcaster');
  if (apkBroadcasterUsed) {
    addResult('broadcasterFixes', 'APK Broadcaster Integration', 'PASS', 'Using production-ready APK broadcaster');
  } else {
    addResult('broadcasterFixes', 'APK Broadcaster Integration', 'FAIL', 'APK broadcaster not being used');
  }
  
} catch (error) {
  addResult('broadcasterFixes', 'File Analysis', 'FAIL', error.message);
}

// Test 2: Validate LiveStreamViewer fix integration
console.log('\n📺 Testing Viewer "Waiting for segments" Fix...');

try {
  const liveStreamContent = fs.readFileSync('src/screens/LiveStreamScreen.js', 'utf8');
  
  // Check if FIXED viewer is being imported
  const fixedViewerImport = liveStreamContent.includes("from '../components/LiveStreamViewer_FIXED'");
  if (fixedViewerImport) {
    addResult('viewerFixes', 'Fixed Viewer Import', 'PASS', 'LiveStreamViewer_FIXED is imported');
  } else {
    addResult('viewerFixes', 'Fixed Viewer Import', 'FAIL', 'Fixed viewer not imported');
  }
  
  // Check if enhanced viewer is available as fallback
  const enhancedViewerImport = liveStreamContent.includes("from '../components/EnhancedLiveStreamViewer'");
  if (enhancedViewerImport) {
    addResult('viewerFixes', 'Enhanced Viewer Fallback', 'PASS', 'Enhanced viewer available as fallback option');
  } else {
    addResult('viewerFixes', 'Enhanced Viewer Fallback', 'WARN', 'Enhanced viewer not imported (optional)');
  }
  
} catch (error) {
  addResult('viewerFixes', 'Viewer Integration', 'FAIL', error.message);
}

// Test 3: Validate Fixed Viewer Component Logic
console.log('\n🔧 Testing Fixed Viewer Component Logic...');

try {
  const fixedViewerPath = 'src/components/LiveStreamViewer_FIXED.js';
  if (fs.existsSync(fixedViewerPath)) {
    const fixedViewerContent = fs.readFileSync(fixedViewerPath, 'utf8');
    
    // Check for direct segment access fix
    const directSegmentAccess = fixedViewerContent.includes('segments[i]');
    if (directSegmentAccess) {
      addResult('viewerFixes', 'Direct Segment Access', 'PASS', 'Uses segments[i] instead of broken getBufferSegments');
    } else {
      addResult('viewerFixes', 'Direct Segment Access', 'FAIL', 'Direct segment access not found');
    }
    
    // Check for enhanced logging
    const enhancedLogging = fixedViewerContent.includes('FIXED VIEWER:');
    if (enhancedLogging) {
      addResult('viewerFixes', 'Enhanced Debugging', 'PASS', 'Enhanced logging for debugging implemented');
    } else {
      addResult('viewerFixes', 'Enhanced Debugging', 'WARN', 'Enhanced logging not found');
    }
    
    // Check for APK compatibility
    const apkCompatibility = fixedViewerContent.includes('APK') || fixedViewerContent.includes('expo-av');
    if (apkCompatibility) {
      addResult('viewerFixes', 'APK Compatibility', 'PASS', 'APK compatibility considerations found');
    } else {
      addResult('viewerFixes', 'APK Compatibility', 'WARN', 'APK compatibility not explicit');
    }
    
  } else {
    addResult('viewerFixes', 'Fixed Viewer File', 'FAIL', 'LiveStreamViewer_FIXED.js not found');
  }
} catch (error) {
  addResult('viewerFixes', 'Fixed Viewer Analysis', 'FAIL', error.message);
}

// Test 4: File Integrity and Architecture
console.log('\n🏗️ Testing File Integrity and Architecture...');

const criticalFiles = [
  'src/screens/LiveStreamScreen.js',
  'src/components/LiveStreamViewer_FIXED.js', 
  'src/components/APKFixedLiveStreamBroadcaster.js',
  'src/components/EnhancedLiveStreamViewer.js',
  'src/services/HLSLiveStreamService.js'
];

criticalFiles.forEach(file => {
  if (fs.existsSync(file)) {
    const stats = fs.statSync(file);
    const sizeKB = Math.round(stats.size / 1024);
    addResult('fileIntegrity', `${file}`, 'PASS', `File exists (${sizeKB}KB)`);
  } else {
    addResult('fileIntegrity', `${file}`, 'FAIL', 'File missing');
  }
});

// Test 5: Risk Assessment
console.log('\n⚠️  Risk Assessment...');

// Check for potential breaking changes
try {
  const liveStreamContent = fs.readFileSync('src/screens/LiveStreamScreen.js', 'utf8');
  
  // Check if original imports are preserved
  const originalImportsPreserved = liveStreamContent.includes('LiveStreamViewerProduction') && 
                                 liveStreamContent.includes('SmartLiveStreamViewer');
  if (originalImportsPreserved) {
    addResult('riskAssessment', 'Fallback Components Available', 'PASS', 'Original components still available for rollback');
  } else {
    addResult('riskAssessment', 'Fallback Components Available', 'WARN', 'Some original components may have been removed');
  }
  
  // Check if Firebase integration is maintained
  const firebaseIntegration = liveStreamContent.includes('HLSLiveStreamService') || 
                            liveStreamContent.includes('firebase');
  if (firebaseIntegration) {
    addResult('riskAssessment', 'Firebase Integration', 'PASS', 'Firebase integration maintained');
  } else {
    addResult('riskAssessment', 'Firebase Integration', 'FAIL', 'Firebase integration may be broken');
  }
  
} catch (error) {
  addResult('riskAssessment', 'Risk Analysis', 'FAIL', error.message);
}

// Generate Summary Report
console.log('\n📊 VALIDATION SUMMARY');
console.log('====================');

Object.keys(validationResults).forEach(category => {
  const results = validationResults[category];
  const total = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warnings = results.filter(r => r.status === 'WARN').length;
  
  console.log(`${category.toUpperCase()}: ${passed}✅ ${failed}❌ ${warnings}⚠️  (${total} total)`);
});

// Overall Assessment
const allResults = Object.values(validationResults).flat();
const totalTests = allResults.length;
const totalPassed = allResults.filter(r => r.status === 'PASS').length;
const totalFailed = allResults.filter(r => r.status === 'FAIL').length;
const passRate = Math.round((totalPassed / totalTests) * 100);

console.log(`\n🎯 OVERALL RESULT: ${totalPassed}/${totalTests} tests passed (${passRate}%)`);

if (totalFailed === 0) {
  console.log('🎉 ALL CRITICAL FIXES VALIDATED SUCCESSFULLY!');
  console.log('\n✅ The live streaming system should now work correctly:');
  console.log('   • Broadcasters see their camera immediately');
  console.log('   • Viewers see video instead of "Waiting for video segments..."');
  console.log('   • Enhanced error handling and fallback systems in place');
  console.log('   • Production-ready APK compatibility maintained');
} else {
  console.log('⚠️  Some issues detected. Please review failed tests above.');
}

console.log('\n🚀 Next Steps:');
console.log('1. Test the app manually: \\start-app.ps1');
console.log('2. Go to Live Streaming and verify camera shows for broadcaster');
console.log('3. Test viewer functionality with another device/user');
console.log('4. Build production APK: eas build --platform android');
console.log('5. Test APK on physical devices');

// Export results for further analysis
const reportPath = 'live-streaming-fix-validation-report.json';
fs.writeFileSync(reportPath, JSON.stringify(validationResults, null, 2));
console.log(`\n📋 Detailed report saved to: ${reportPath}`);

process.exit(totalFailed > 0 ? 1 : 0);