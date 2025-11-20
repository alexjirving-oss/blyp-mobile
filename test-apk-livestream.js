/**
 * APK Live Stream Testing Script
 * 
 * This script helps debug APK-specific issues:
 * 1. Camera initialization timing
 * 2. Stream startup sequence
 * 3. APK vs development differences
 */

const { exec } = require('child_process');
const fs = require('fs');

console.log('🔍 APK Live Stream Diagnostic Tool');
console.log('=====================================\n');

// Test 1: Check if APK is installed
console.log('1. Checking for installed APK...');
exec('adb shell pm list packages | findstr com.blypmobile.blypapp', (error, stdout, stderr) => {
    if (stdout.trim()) {
        console.log('✅ APK is installed:', stdout.trim());
        
        // Test 2: Check APK version
        exec('adb shell dumpsys package com.blypmobile.blypapp | findstr versionName', (error, stdout) => {
            console.log('📱 APK Version:', stdout.trim());
            
            // Test 3: Check camera permissions
            exec('adb shell dumpsys package com.blypmobile.blypapp | findstr "android.permission.CAMERA"', (error, stdout) => {
                console.log('📷 Camera Permission:', stdout ? '✅ Granted' : '❌ Not found');
                
                // Test 4: Check microphone permissions  
                exec('adb shell dumpsys package com.blypmobile.blypapp | findstr "android.permission.RECORD_AUDIO"', (error, stdout) => {
                    console.log('🎤 Microphone Permission:', stdout ? '✅ Granted' : '❌ Not found');
                });
            });
        });
    } else {
        console.log('❌ APK not installed. Install the APK first.');
    }
});

// Test 5: Monitor logcat for APK issues
setTimeout(() => {
    console.log('\n2. Starting logcat monitoring for APK issues...');
    console.log('   Look for these patterns when testing:\n');
    
    console.log('🔍 Key Issues to Watch For:');
    console.log('   • "Camera initialization timeout"');
    console.log('   • "Stream failed to start"');
    console.log('   • "APK_DETECTION: Running in production"');
    console.log('   • "Firebase connection failed"\n');
    
    console.log('📱 To test APK Live Stream:');
    console.log('   1. Launch APK on device');
    console.log('   2. Go to Live Stream tab');
    console.log('   3. Press "Go Live" button');
    console.log('   4. Watch countdown and initialization');
    console.log('   5. Check if stream starts properly\n');
    
    console.log('🔧 If still failing, check:');
    console.log('   • Internet connection on device');
    console.log('   • Firebase config in APK');
    console.log('   • Camera/microphone permissions');
    console.log('   • Logcat output below:\n');
    
    // Start logcat filtering
    const logcat = exec('adb logcat | findstr "Blyp\\|ReactNative\\|Expo\\|Firebase\\|Camera"');
    
    logcat.stdout.on('data', (data) => {
        // Filter important logs
        if (data.includes('Blyp') || 
            data.includes('Camera') || 
            data.includes('Stream') ||
            data.includes('Firebase') ||
            data.includes('Error') ||
            data.includes('timeout')) {
            console.log('📋 LOG:', data.trim());
        }
    });
    
    console.log('💡 Press Ctrl+C to stop monitoring\n');
    
}, 2000);

// Test 6: APK vs Development differences
setTimeout(() => {
    console.log('\n3. APK vs Development Mode Differences:');
    console.log('=====================================');
    console.log('📱 APK (Production):');
    console.log('   • No Metro bundler');
    console.log('   • Slower camera initialization');
    console.log('   • Different Firebase timing');
    console.log('   • Network requests may timeout faster');
    console.log('');
    console.log('💻 Development Mode:');
    console.log('   • Fast reload/hot reloading');
    console.log('   • Faster camera access');
    console.log('   • More lenient timeouts');
    console.log('   • Direct Firebase connection');
    console.log('');
    console.log('🔧 APK Fix Applied:');
    console.log('   • Extended camera initialization timeout (10s)');
    console.log('   • APK detection for different behavior');
    console.log('   • Debug overlay for troubleshooting');
    console.log('   • Safer initialization sequence\n');
    
}, 3000);

process.on('SIGINT', () => {
    console.log('\n\n👋 APK testing session ended');
    console.log('📊 Summary:');
    console.log('   • Check camera preview during countdown');
    console.log('   • Verify "initializing" message appears');
    console.log('   • Confirm stream starts after initialization');
    console.log('   • Monitor for any error messages\n');
    process.exit(0);
});