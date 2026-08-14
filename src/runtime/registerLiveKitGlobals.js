/**
 * LiveKit RN needs RTCPeerConnection on the JS global before Room.connect().
 * Official API for @livekit/react-native ^2.12 / @livekit/react-native-webrtc ^144:
 *   import { registerGlobals } from '@livekit/react-native';
 *   registerGlobals();
 *
 * Must run once at app startup ÔÇö before React navigates to Call / any PeerConnection.
 * Idempotent.
 *
 * Do NOT gate on NativeModules.WebRTCModule. New Architecture / bridgeless often
 * leaves that key undefined until the TurboModule is first touched; skipping here
 * makes livekit-client throw "WebRTC isn't detected".
 */
export function registerLiveKitGlobals() {
  const g = typeof globalThis !== 'undefined' ? globalThis : global;
  if (g.__BLYP_LIVEKIT_GLOBALS__) return true;
  try {
    // eslint-disable-next-line global-require
    const { registerGlobals } = require('@livekit/react-native');
    registerGlobals();
    g.__BLYP_LIVEKIT_GLOBALS__ = true;
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[BLYP][LIVEKIT] registerGlobals failed:', e?.message || String(e));
    return false;
  }
}
