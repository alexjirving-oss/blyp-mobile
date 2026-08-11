/**
 * BlypShorts native bridge — ground-up For You pool (not storm FeedPlayer).
 * Production For You never falls back to expo-av; missing module → hard fail UI.
 *
 * Fabric/new-arch: UIManager view-manager config for BlypShortsView is often null
 * even when ShortsPackage is linked. Do NOT gate on that config API.
 */
import { NativeModules, Platform, requireNativeComponent } from 'react-native';

const NativeMod = NativeModules.BlypShorts;

const SHORTS_VIEW_NAME = 'BlypShortsView';

/** Survive Fast Refresh — avoid double-register of the same native view name. */
function getViewCache() {
  const g = typeof globalThis !== 'undefined' ? globalThis : global;
  if (!g.__BLYP_SHORTS_NATIVE_VIEW__) {
    g.__BLYP_SHORTS_NATIVE_VIEW__ = { view: undefined };
  }
  return g.__BLYP_SHORTS_NATIVE_VIEW__;
}

function tryRequireShortsView() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  const cache = getViewCache();
  if (cache.view !== undefined) return cache.view;
  try {
    cache.view = requireNativeComponent(SHORTS_VIEW_NAME);
  } catch {
    cache.view = null;
  }
  return cache.view;
}

/**
 * Available when the native module is present OR the view can be required.
 * Prefer mounting when NativeMod exists (module proves package registration).
 */
export function isShortsAvailable() {
  if (NativeMod) return true;
  return !!tryRequireShortsView();
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

/** Lazily require BlypShortsView — prefer when NativeMod exists. */
export function getShortsView() {
  if (NativeMod) {
    const view = tryRequireShortsView();
    if (view) return view;
  }
  return tryRequireShortsView();
}
