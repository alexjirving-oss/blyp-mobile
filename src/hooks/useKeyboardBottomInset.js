import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom inset for chat composers.
 *
 * Edge-to-edge Android does not reliably resize for the IME, and `adjustPan`
 * often under-pans tall keyboards (Gboard number row + toolbar) on Flip /
 * foldables — clipping the composer. We measure how much of the composer still
 * sits under the IME after any system pan, then pad only that shortfall.
 *
 * Lift only ratchets upward while the keyboard is open so later measures (after
 * we pad) cannot collapse the composer back under the IME.
 *
 * iOS: KeyboardAvoidingView owns IME lift; this hook reports `keyboardOpen` and
 * safe-area bottom when the keyboard is closed.
 *
 * @param {React.RefObject} [composerRef] Composer view measured against the IME top.
 */
export default function useKeyboardBottomInset(composerRef) {
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [androidLift, setAndroidLift] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const applyLift = (candidate) => {
      const next = Math.max(0, Math.round(candidate || 0));
      if (next <= 0) return;
      setAndroidLift((prev) => Math.max(prev, next));
    };

    const measureLift = (keyboardTop, fallbackHeight) => {
      if (Platform.OS !== 'android') return;
      const node = composerRef?.current;
      if (!node || typeof node.measureInWindow !== 'function' || !Number.isFinite(keyboardTop)) {
        applyLift(fallbackHeight);
        return;
      }
      try {
        node.measureInWindow((_x, y, _w, h) => {
          if (!Number.isFinite(y) || !Number.isFinite(h)) {
            applyLift(fallbackHeight);
            return;
          }
          // 8px gap so the composer border sits clearly above the IME toolbar.
          const overlap = Math.ceil(y + h - keyboardTop + 8);
          if (overlap > 0) {
            applyLift(overlap);
            return;
          }
          // Measured clear after system pan — do not force a full-IME lift.
        });
      } catch {
        applyLift(fallbackHeight);
      }
    };

    const onShow = (event) => {
      const next = Math.max(0, Math.round(event?.endCoordinates?.height || 0));
      const keyboardTop = event?.endCoordinates?.screenY;
      setKeyboardHeight(next);
      if (Platform.OS !== 'android') return;

      const run = () => measureLift(keyboardTop, next);
      requestAnimationFrame(() => requestAnimationFrame(run));
      setTimeout(run, 64);
      setTimeout(run, 200);
      // Edge-to-edge + adjustResize often never pans; if measure never saw overlap
      // (ref missing / layout race), fall back to full IME height once.
      setTimeout(() => {
        setAndroidLift((prev) => (prev > 0 ? prev : next));
      }, 260);
    };

    const onHide = () => {
      setKeyboardHeight(0);
      setAndroidLift(0);
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      try { showSub.remove(); } catch { /* ignore */ }
      try { hideSub.remove(); } catch { /* ignore */ }
    };
  }, [composerRef]);

  const keyboardOpen = keyboardHeight > 0;
  const safeBottom = Math.max(0, insets.bottom || 0);

  const bottomInset = Platform.OS === 'android'
    ? (keyboardOpen ? androidLift : safeBottom)
    : (keyboardOpen ? 0 : safeBottom);

  return {
    keyboardHeight: Platform.OS === 'android' ? keyboardHeight : 0,
    keyboardOpen,
    bottomInset,
    safeBottom,
  };
}
