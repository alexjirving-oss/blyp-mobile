/**
 * IVSBridgeTest.ts
 * 
 * Quick diagnostic tool to test if the JS→Native bridge is working.
 * This helps isolate whether the problem is:
 * 1. The bridge itself (NativeModules communication)
 * 2. The startHostSession method specifically
 * 3. Parameter marshaling
 */

import { NativeModules } from 'react-native';

const { IVSBroadcastModule } = NativeModules;

export async function testBridgeConnection(): Promise<void> {
  console.log('[BRIDGE_TEST] Starting bridge diagnostic...');
  
  if (!IVSBroadcastModule) {
    console.error('[BRIDGE_TEST] ❌ IVSBroadcastModule not found in NativeModules');
    throw new Error('IVSBroadcastModule not available');
  }
  
  console.log('[BRIDGE_TEST] ✅ IVSBroadcastModule found');
  console.log('[BRIDGE_TEST] Module methods:', Object.keys(IVSBroadcastModule || {}));

  // Test 1: Call the simple testBridge method
  console.log('[BRIDGE_TEST] --- Test 1: Simple testBridge() method ---');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('testBridge timeout - callback never fired'));
    }, 5000);

    try {
      IVSBroadcastModule.testBridge((error: any, result: any) => {
        clearTimeout(timeout);
        console.log('[BRIDGE_TEST] testBridge callback fired!');
        if (error) {
          console.error('[BRIDGE_TEST] ❌ testBridge error:', error);
          reject(error);
        } else {
          console.log('[BRIDGE_TEST] ✅ testBridge result:', result);
          resolve(result);
        }
      });
      console.log('[BRIDGE_TEST] testBridge called (awaiting callback)...');
    } catch (e) {
      clearTimeout(timeout);
      console.error('[BRIDGE_TEST] ❌ Exception calling testBridge:', e);
      reject(e);
    }
  });

  // Test 2: Try calling startHostSession with minimal params
  console.log('[BRIDGE_TEST] --- Test 2: startHostSession() with test params ---');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('startHostSession timeout - callback never fired'));
    }, 5000);

    try {
      IVSBroadcastModule.startHostSession(
        'rtmps://us-east-1.contribute.live-video.net/app',  // stageArn
        'test-token-12345',  // token
        'test-session-id',   // sessionId
        (error: any) => {
          clearTimeout(timeout);
          console.log('[BRIDGE_TEST] startHostSession callback fired!');
          if (error) {
            console.error('[BRIDGE_TEST] ⚠️  startHostSession returned error:', error);
            // Don't reject - an error response is still a successful bridge call
            resolve({ error });
          } else {
            console.log('[BRIDGE_TEST] ✅ startHostSession succeeded (no error)');
            resolve({ success: true });
          }
        }
      );
      console.log('[BRIDGE_TEST] startHostSession called (awaiting callback)...');
    } catch (e) {
      clearTimeout(timeout);
      console.error('[BRIDGE_TEST] ❌ Exception calling startHostSession:', e);
      reject(e);
    }
  });

  console.log('[BRIDGE_TEST] ✅ All bridge tests completed!');
}

export async function runAllTests(): Promise<void> {
  try {
    await testBridgeConnection();
    console.log('[BRIDGE_TEST] ✅✅✅ SUCCESS: Bridge is working!');
  } catch (e) {
    console.error('[BRIDGE_TEST] ❌❌❌ FAILURE:', e);
    throw e;
  }
}
