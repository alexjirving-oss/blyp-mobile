import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAnimatedKeyboard, useAnimatedReaction, runOnJS } from 'react-native-reanimated';

/**
 * Bottom inset for chat composers.
 *
 * Hard Z Flip / foldable IME fix:
 * - Authoritative height from Reanimated `useAnimatedKeyboard` (WindowInsetsCompat
 *   / WindowInsetsAnimationCallback) — no measureInWindow races, live updates on
 *   unfold / Gboard chrome growth.
 * - Subtract any window shrink already applied by `adjustResize` so slab phones
 *   that DO resize are not double-padded, while edge-to-edge Flip (often no
 *   shrink) still gets the full IME inset.
 * - Never stack safe-area under an open IME (nav bar sits under the keyboard).
 *
 * iOS: KeyboardAvoidingView owns IME lift; this hook reports `keyboardOpen`
 * and safe-area bottom when the keyboard is closed.
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
  const [androidWindowShrink, setAndroidWindowShrink] = useState(0);
  const [iosKeyboardOpen, setIosKeyboardOpen] = useState(false);
  const baselineWindowHRef = useRef(Dimensions.get('window').height);

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
    if (Platform.OS !== 'android') return undefined;

    const refreshShrink = (winH) => {
      const h = Math.round(winH || Dimensions.get('window').height || 0);
      if (!h) return;
      if (androidKeyboardHeight <= 0) {
        baselineWindowHRef.current = h;
        setAndroidWindowShrink(0);
        return;
      }
      const baseline = baselineWindowHRef.current || h;
      setAndroidWindowShrink(Math.max(0, Math.round(baseline - h)));
    };

    refreshShrink(Dimensions.get('window').height);
    const dimSub = Dimensions.addEventListener?.('change', ({ window: win }) => {
      refreshShrink(win?.height);
    });
    return () => {
      try { dimSub?.remove?.(); } catch { /* ignore */ }
    };
  }, [androidKeyboardHeight]);

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
  const androidLift = Math.max(0, androidKeyboardHeight - androidWindowShrink);

  // Single padding owner: IME lift while open, safe-area only while closed.
  const bottomInset = Platform.OS === 'android'
    ? (keyboardOpen ? androidLift : safeBottom)
    : (keyboardOpen ? 0 : safeBottom);

  return {
    keyboardHeight: Platform.OS === 'android' ? androidKeyboardHeight : 0,
    keyboardOpen,
    bottomInset,
    safeBottom,
  };
}
