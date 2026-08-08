import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAnimatedKeyboard, useAnimatedReaction, runOnJS } from 'react-native-reanimated';

/**
 * Bottom inset for chat composers.
 *
 * 1.0.36-38 inferred the Android keyboard height from `Dimensions`/window
 * resize deltas plus a `measureInWindow` shortfall guess, sampled on a
 * setTimeout race (64/180/320/400ms). That mixed window vs screen coordinate
 * spaces and under/over-counted tall Gboard chrome, and the races settled at
 * different times than on slab phones — on Z Flip the composer would clip or
 * float with a visible gap depending on which timeout won, and re-folding
 * mid-type (cover -> main) was never re-measured correctly.
 *
 * Fix: read the real IME inset straight from the OS via Reanimated's
 * `useAnimatedKeyboard`, which drives a native WindowInsetsCompat /
 * WindowInsetsAnimationCallback listener (reanimated is already a native
 * dependency here — no new library, no rebuild). This is authoritative for
 * any screen shape or fold state and tracks live height changes, so it also
 * self-corrects if the keyboard height changes while still open (e.g.
 * unfolding a Flip mid-conversation). `isStatusBarTranslucentAndroid` /
 * `isNavigationBarTranslucentAndroid` match this app's real edge-to-edge
 * config (transparent status + nav bars everywhere via
 * `edgeToEdgeEnabled`/`styles.xml`), so Reanimated's own decor-margin
 * bookkeeping stays a no-op and the only effect is the height value.
 *
 * iOS: KeyboardAvoidingView owns IME lift; this hook reports `keyboardOpen`
 * and safe-area bottom when the keyboard is closed (unchanged behavior).
 *
 * @param {React.RefObject} [_composerRef] Unused — kept so existing call
 *   sites (`useKeyboardBottomInset(composerRef)`) don't need to change.
 */
export default function useKeyboardBottomInset(_composerRef) {
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);
  const [iosKeyboardOpen, setIosKeyboardOpen] = useState(false);

  // Mirror the UI-thread keyboard height to JS state. Rounding to 2px avoids
  // a JS render on every sub-pixel animation tick while still tracking the
  // open/close animation and any live resize (fold-state change) smoothly.
  useAnimatedReaction(
    () => Math.round(keyboard.height.value / 2) * 2,
    (rounded, prevRounded) => {
      if (rounded === prevRounded) return;
      runOnJS(setAndroidKeyboardHeight)(rounded);
    },
    [],
  );

  useEffect(() => {
    if (Platform.OS === 'android') return undefined;
    const onShow = () => setIosKeyboardOpen(true);
    const onHide = () => setIosKeyboardOpen(false);
    const showSub = Keyboard.addListener('keyboardWillShow', onShow);
    const hideSub = Keyboard.addListener('keyboardWillHide', onHide);
    return () => {
      try { showSub.remove(); } catch { /* ignore */ }
      try { hideSub.remove(); } catch { /* ignore */ }
    };
  }, []);

  const keyboardOpen = Platform.OS === 'android' ? androidKeyboardHeight > 0 : iosKeyboardOpen;
  const safeBottom = Math.max(0, insets.bottom || 0);

  // Single padding owner: IME inset while open, safe-area only while closed.
  // Never add safe-area on top of the IME inset (nav bar is under the keyboard).
  const bottomInset = Platform.OS === 'android'
    ? (keyboardOpen ? androidKeyboardHeight : safeBottom)
    : (keyboardOpen ? 0 : safeBottom);

  return {
    keyboardHeight: Platform.OS === 'android' ? androidKeyboardHeight : 0,
    keyboardOpen,
    bottomInset,
    safeBottom,
  };
}
