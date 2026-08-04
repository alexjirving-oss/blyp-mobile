/**
 * Thin JS bridge to native IncomingCallModule (Android).
 * Shows a full-screen incoming-call notification and loops the Blyp ringtone
 * even when the screen is locked / app is backgrounded (process alive).
 */

import { NativeModules, Platform } from 'react-native';

const Native = NativeModules?.IncomingCallModule;

export async function showIncomingCallNative(callId, callerName) {
  if (Platform.OS !== 'android' || !Native?.showIncomingCall) return false;
  try {
    await Native.showIncomingCall(String(callId || ''), String(callerName || 'Incoming call'));
    return true;
  } catch (e) {
    console.warn('[IncomingCall] show failed', e?.message || String(e));
    return false;
  }
}

export async function cancelIncomingCallNative(callId) {
  if (Platform.OS !== 'android' || !Native?.cancelIncomingCall) return false;
  try {
    await Native.cancelIncomingCall(String(callId || ''));
    return true;
  } catch (e) {
    console.warn('[IncomingCall] cancel failed', e?.message || String(e));
    return false;
  }
}

/** Prompt Android 14+ full-screen intent settings when blocked (Messenger-style). */
export async function ensureFullScreenIntentPermission() {
  if (Platform.OS !== 'android' || !Native?.ensureFullScreenIntentPermission) return true;
  try {
    return await Native.ensureFullScreenIntentPermission();
  } catch (e) {
    console.warn('[IncomingCall] FSI prompt failed', e?.message || String(e));
    return false;
  }
}

export default { showIncomingCallNative, cancelIncomingCallNative, ensureFullScreenIntentPermission };
