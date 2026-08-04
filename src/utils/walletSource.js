/**
 * Single source of truth for which wallet backend the app reads/writes.
 * Live-service Postgres is production default (matches GiftSystem + coin store).
 * Set EXPO_PUBLIC_USE_LIVE_SERVICE_WALLET=0 to use legacy Firestore wallets.
 *
 * Env key is assembled at runtime so Expo babel cannot inline EXPO_PUBLIC_* at
 * transform time (which would break tests and runtime overrides).
 */
export function shouldUseLiveServiceWallet() {
  const env = typeof process !== 'undefined' && process?.env ? process.env : {};
  const key = ['EXPO', 'PUBLIC', 'USE', 'LIVE', 'SERVICE', 'WALLET'].join('_');
  const raw = env[key] != null ? String(env[key]).toLowerCase() : '';
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return true;
}

export default shouldUseLiveServiceWallet;
