import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom inset for chat composers.
 *
 * Edge-to-edge Android often does not shrink the RN window for the IME even with
 * `adjustResize`. 1.0.36 measured composer vs `endCoordinates.screenY` and padded
 * only the shortfall — that mixed window vs screen coordinates and under-counted
 * tall Gboard chrome (toolbar + number row) on Flip / foldables, so the composer
 * stayed clipped.
 *
 * Android lift = IME height minus any window shrink already applied by the system,
 * raised by a same-space measure (composer bottom vs window bottom). Lift only
 * ratchets up while the keyboard is open.
 *
 * iOS: KeyboardAvoidingView owns IME lift; this hook reports `keyboardOpen` and
 * safe-area bottom when the keyboard is closed.
 *
 * @param {React.RefObject} [composerRef] Composer view measured against the window.
 */
export default function useKeyboardBottomInset(composerRef) {
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [androidLift, setAndroidLift] = useState(0);
  const baselineWindowHRef = useRef(Dimensions.get('window').height);
  const keyboardOpenRef = useRef(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const applyLift = (candidate) => {
      const next = Math.max(0, Math.round(candidate || 0));
      if (next <= 0) return;
      setAndroidLift((prev) => Math.max(prev, next));
    };

    const computeAndroidLift = (kbH) => {
      if (Platform.OS !== 'android') return;
      const winH = Dimensions.get('window').height;
      const baseline = baselineWindowHRef.current || winH;
      // Portion of the IME already absorbed by adjustResize (when it actually runs).
      const alreadyResized = Math.max(0, Math.round(baseline - winH));
      const heightBased = Math.max(0, kbH - alreadyResized);

      const node = composerRef?.current;
      if (!node || typeof node.measureInWindow !== 'function') {
        applyLift(heightBased);
        return;
      }

      try {
        node.measureInWindow((_x, y, _w, h) => {
          if (!Number.isFinite(y) || !Number.isFinite(h) || !Number.isFinite(winH)) {
            applyLift(heightBased);
            return;
          }
          // Same coordinate space (window): how much of the IME still covers us.
          const composerBottom = y + h;
          const gapBelow = Math.max(0, winH - composerBottom);
          const measuredShortfall = Math.max(0, Math.ceil(kbH - gapBelow + 8));
          applyLift(Math.max(heightBased, measuredShortfall));
        });
      } catch {
        applyLift(heightBased);
      }
    };

    const onShow = (event) => {
      const next = Math.max(0, Math.round(event?.endCoordinates?.height || 0));
      keyboardOpenRef.current = next > 0;
      setKeyboardHeight(next);
      if (Platform.OS !== 'android') return;

      const run = () => computeAndroidLift(next);
      requestAnimationFrame(() => requestAnimationFrame(run));
      setTimeout(run, 64);
      setTimeout(run, 180);
      setTimeout(run, 320);
      // Layout race / missing ref: never leave the composer at 0 under a tall IME.
      setTimeout(() => {
        setAndroidLift((prev) => (prev > 0 ? prev : next));
      }, 400);
    };

    const onHide = () => {
      keyboardOpenRef.current = false;
      setKeyboardHeight(0);
      setAndroidLift(0);
      baselineWindowHRef.current = Dimensions.get('window').height;
    };

    const onDimChange = ({ window: win }) => {
      if (!keyboardOpenRef.current && win?.height) {
        baselineWindowHRef.current = win.height;
      }
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    const dimSub = Dimensions.addEventListener?.('change', onDimChange);

    return () => {
      try { showSub.remove(); } catch { /* ignore */ }
      try { hideSub.remove(); } catch { /* ignore */ }
      try { dimSub?.remove?.(); } catch { /* ignore */ }
    };
  }, [composerRef]);

  const keyboardOpen = keyboardHeight > 0;
  const safeBottom = Math.max(0, insets.bottom || 0);

  // Single padding owner: IME lift while open, safe-area only while closed.
  // Never add safe-area on top of IME lift (nav bar is under the keyboard).
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
