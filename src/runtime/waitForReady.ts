import { AppState, InteractionManager } from 'react-native';

export async function waitForReady() {
  // Finish initial interactions
  await new Promise<void>(r => InteractionManager.runAfterInteractions(() => r()));
  // Ensure app is active
  if (AppState.currentState !== 'active') {
    await new Promise<void>(r => {
      const sub = AppState.addEventListener('change', s => {
        if (s === 'active') { sub.remove(); r(); }
      });
    });
  }
  if (typeof (global as any).WebSocket === 'undefined') {
    // Last-ditch: force RN polyfill
    try {
      // @ts-ignore internal RN polyfill
      (global as any).WebSocket = require('react-native/Libraries/WebSocket/WebSocket');
      // eslint-disable-next-line no-console
      console.warn('[BLYP][WS] waitForReady injected RN WebSocket polyfill');
    } catch {}
  }
}
