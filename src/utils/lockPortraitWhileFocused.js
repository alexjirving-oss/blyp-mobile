/**
 * Lock Android/iOS to portrait only while a video/camera screen is focused.
 * MainActivity uses fullSensor so Fold unfold works elsewhere; camera/live
 * feeds still need a stable portrait window.
 */
import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Platform } from 'react-native';

let ScreenOrientation = null;
try {
  // Optional: installed via expo-screen-orientation. Missing package = no-op.
  // eslint-disable-next-line global-require
  ScreenOrientation = require('expo-screen-orientation');
} catch {
  ScreenOrientation = null;
}

export function useLockPortraitWhileFocused() {
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        if (!ScreenOrientation?.lockAsync) return;
        try {
          await ScreenOrientation.lockAsync(
            ScreenOrientation.OrientationLock.PORTRAIT_UP,
          );
        } catch {
          /* ignore — web / unsupported */
        }
      })();
      return () => {
        active = false;
        (async () => {
          if (!active || !ScreenOrientation?.unlockAsync) return;
          try {
            // Prefer unlock so foldables can rotate again after leaving camera/live.
            if (Platform.OS === 'android' || Platform.OS === 'ios') {
              await ScreenOrientation.unlockAsync();
            }
          } catch {
            /* ignore */
          }
        })();
      };
    }, []),
  );
}

export default { useLockPortraitWhileFocused };
