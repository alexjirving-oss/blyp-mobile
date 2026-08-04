// Lightweight, dependency-free analytics shim for Matchday Live. Mirrors the
// repo convention of guarding optional native modules; falls back to a tagged
// console log so events are always observable in dev without a hard dependency
// on a specific analytics provider.

let nativeAnalytics: { logEvent?: (name: string, params?: Record<string, any>) => void } | null = null;
try {
  // Optional: only present in native builds that ship the Firebase analytics module.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nativeAnalytics = require('@react-native-firebase/analytics').default();
} catch {
  nativeAnalytics = null;
}

export function logMatchdayEvent(event: string, params: Record<string, any> = {}): void {
  const name = `matchday_${event}`.slice(0, 40);
  try {
    if (nativeAnalytics?.logEvent) {
      nativeAnalytics.logEvent(name, params);
      return;
    }
  } catch {
    // fall through to console
  }
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[MATCHDAY][analytics]', name, params);
  }
}
