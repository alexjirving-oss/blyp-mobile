import { Platform, requireNativeComponent } from 'react-native';

type NativeViewComponent = any;

// IMPORTANT:
// ReactNativeViewConfigRegistry persists across Fast Refresh / HMR, but module-level
// variables are reset. If we call requireNativeComponent('IVS...') again after a
// refresh, RN can throw:
// "Tried to register two views with the same name ..."
//
// To prevent this, we keep a cache on globalThis that survives JS reloads.
type IvsNativeViewCache = {
  broadcastView?: NativeViewComponent | null;
  playerView?: NativeViewComponent | null;
  realTimeView?: NativeViewComponent | null;
};

const getGlobalCache = (): IvsNativeViewCache => {
  const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : (global as any);
  if (!g.__BLYP_IVS_NATIVE_VIEWS__) {
    g.__BLYP_IVS_NATIVE_VIEWS__ = {};
  }
  return g.__BLYP_IVS_NATIVE_VIEWS__ as IvsNativeViewCache;
};

let cachedBroadcastView: NativeViewComponent | null | undefined;
let cachedPlayerView: NativeViewComponent | null | undefined;
let cachedRealTimeView: NativeViewComponent | null | undefined;

function safeRequireNativeView(name: string): NativeViewComponent | null {
  try {
    return requireNativeComponent(name);
  } catch (err: any) {
    console.warn('[IVS_NATIVE_VIEW_MISSING]', name, err?.message ?? err);
    return null;
  }
}

/**
 * IMPORTANT: Centralize all IVS native view requires in one module.
 * Requiring the same native view from multiple modules can trigger:
 * "Tried to register two views with the same name ...".
 */
function isNativeViewPlatform(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

export function getNativeIVSBroadcastView(): NativeViewComponent | null {
  if (!isNativeViewPlatform()) return null;
  const globalCache = getGlobalCache();
  if (globalCache.broadcastView !== undefined) {
    return globalCache.broadcastView;
  }
  if (cachedBroadcastView === undefined) {
    cachedBroadcastView = safeRequireNativeView('IVSBroadcastView');
  }
  globalCache.broadcastView = cachedBroadcastView;
  return cachedBroadcastView;
}

export function getNativeIVSPlayerView(): NativeViewComponent | null {
  if (!isNativeViewPlatform()) return null;
  const globalCache = getGlobalCache();
  if (globalCache.playerView !== undefined) {
    return globalCache.playerView;
  }
  if (cachedPlayerView === undefined) {
    cachedPlayerView = safeRequireNativeView('IVSPlayerView');
  }
  globalCache.playerView = cachedPlayerView;
  return cachedPlayerView;
}

export function getNativeIVSRealTimeView(): NativeViewComponent | null {
  if (!isNativeViewPlatform()) return null;
  const globalCache = getGlobalCache();
  if (globalCache.realTimeView !== undefined) {
    return globalCache.realTimeView;
  }
  if (cachedRealTimeView === undefined) {
    cachedRealTimeView = safeRequireNativeView('IVSRealTimeView');
  }
  globalCache.realTimeView = cachedRealTimeView;
  return cachedRealTimeView;
}
