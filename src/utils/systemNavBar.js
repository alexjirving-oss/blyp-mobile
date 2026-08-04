// systemNavBar — keeps the Android system navigation bar in "sticky immersive"
// mode so it doesn't sit on screen permanently on 3-button-navigation devices.
//
// Behaviour:
//   - The bar is hidden by default.
//   - Swiping in from the edge reveals it as a translucent overlay that then
//     auto-hides again ("overlay-swipe"), which is the standard behaviour users
//     expect from full-screen / video apps.
//
// The bar is re-asserted whenever the app returns to the foreground or the soft
// keyboard closes, because Android re-shows it after keyboards, dialogs and
// permission prompts. Everything degrades to a no-op on iOS or if the native
// module isn't available, so it can never crash startup.

import { Platform, AppState, Keyboard } from 'react-native';

let NavBar = null;
try {
  if (Platform.OS === 'android') {
    // eslint-disable-next-line global-require
    NavBar = require('expo-navigation-bar');
  }
} catch {
  NavBar = null;
}

/** Hide the nav bar and put it into swipe-to-reveal (sticky immersive) mode. */
export async function applyImmersiveNavBar() {
  if (Platform.OS !== 'android' || !NavBar) return;
  // Never toggle the system navigation bar while a live session is active.
  // Going live spins up the native IVS camera SurfaceView, and toggling the
  // system UI / window-insets controller at the same moment (which also fires
  // when the camera-permission dialog dismisses) can race the native surface
  // lifecycle and crash the broadcast on some OEMs. The bar staying put during
  // a live stream is a non-issue; a crash on go-live is not.
  try {
    if (global.__BLYP_LIVE_ACTIVE__) return;
  } catch {
    /* ignore */
  }
  try {
    if (NavBar.setBehaviorAsync) await NavBar.setBehaviorAsync('overlay-swipe');
  } catch {
    /* ignore — older/edge-to-edge variations */
  }
  try {
    if (NavBar.setVisibilityAsync) await NavBar.setVisibilityAsync('hidden');
  } catch {
    /* ignore */
  }
}

/**
 * Apply immersive mode now and keep re-applying it when the app resumes or the
 * keyboard closes. Returns a cleanup function to remove the listeners.
 */
export function setupImmersiveNavBar() {
  if (Platform.OS !== 'android' || !NavBar) return () => {};

  applyImmersiveNavBar();

  const appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') applyImmersiveNavBar();
  });

  // After the soft keyboard hides, the system bar often re-appears; re-assert.
  let keyboardSub = null;
  try {
    keyboardSub = Keyboard.addListener('keyboardDidHide', () => {
      applyImmersiveNavBar();
    });
  } catch {
    keyboardSub = null;
  }

  return () => {
    try { appStateSub?.remove?.(); } catch { /* ignore */ }
    try { keyboardSub?.remove?.(); } catch { /* ignore */ }
  };
}

export default { applyImmersiveNavBar, setupImmersiveNavBar };
