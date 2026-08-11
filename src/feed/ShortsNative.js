/**
 * BlypShorts native bridge — ground-up For You pool (not storm FeedPlayer).
 * Production For You never falls back to expo-av; missing module → hard fail UI.
 */
import { NativeModules, Platform, UIManager } from 'react-native';

const NativeMod = NativeModules.BlypShorts;

export function isShortsAvailable() {
  if (!NativeMod) return false;
  try {
    const cfg =
      UIManager.getViewManagerConfig?.('BlypShortsView') ||
      (UIManager.hasViewManagerConfig?.('BlypShortsView') ? true : null);
    return !!cfg;
  } catch {
    return Platform.OS === 'android' || Platform.OS === 'ios';
  }
}

export async function prefetchShortsUri(uri, bytes = 1024000) {
  if (!NativeMod?.prefetchOpening || !uri) return false;
  try {
    return await NativeMod.prefetchOpening(String(uri), Number(bytes) || 1024000);
  } catch {
    return false;
  }
}

export async function getShortsDiagnostics() {
  if (!NativeMod?.getDiagnostics) return { available: false };
  try {
    const d = await NativeMod.getDiagnostics();
    return { available: true, ...(d || {}) };
  } catch {
    return { available: false };
  }
}

/** Lazily require native view only when module exists — avoids registration side effects. */
export function getShortsView() {
  if (!NativeMod) return null;
  try {
    // eslint-disable-next-line global-require
    const { requireNativeComponent } = require('react-native');
    return requireNativeComponent('BlypShortsView');
  } catch {
    return null;
  }
}
