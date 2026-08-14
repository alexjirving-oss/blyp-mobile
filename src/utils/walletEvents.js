import { DeviceEventEmitter } from 'react-native';

export const WALLET_UPDATED_EVENT = 'blyp:wallet-updated';

/**
 * Broadcast a wallet snapshot so header / store / chat UIs update immediately
 * after purchase, gift spend, or a successful /wallet poll — not only on the
 * 45s timer.
 *
 * @param {{ coinBalance?: number, bonusCoinBalance?: number, gemAvailable?: number, gemPending?: number, gemConvertible?: number, coins?: number, gems?: number }} wallet
 */
export function emitWalletUpdated(wallet) {
  if (!wallet || typeof wallet !== 'object') return;
  const coins =
    wallet.coins != null
      ? Number(wallet.coins)
      : Number(wallet.coinBalance || 0) + Number(wallet.bonusCoinBalance || 0);
  const gemAvailable =
    wallet.gemAvailable != null && Number.isFinite(Number(wallet.gemAvailable))
      ? Number(wallet.gemAvailable)
      : undefined;
  const gemPending =
    wallet.gemPending != null && Number.isFinite(Number(wallet.gemPending))
      ? Number(wallet.gemPending)
      : undefined;
  const gems =
    wallet.gems != null
      ? Number(wallet.gems)
      : wallet.gemConvertible != null && Number.isFinite(Number(wallet.gemConvertible))
        ? Number(wallet.gemConvertible)
        : gemAvailable != null || gemPending != null
          ? Number(gemAvailable || 0) + Number(gemPending || 0)
          : undefined;
  DeviceEventEmitter.emit(WALLET_UPDATED_EVENT, {
    coins: Number.isFinite(coins) ? coins : undefined,
    gems: Number.isFinite(gems) ? gems : undefined,
    gemAvailable,
    gemPending,
    at: Date.now(),
  });
}

export function subscribeWalletUpdated(handler) {
  const sub = DeviceEventEmitter.addListener(WALLET_UPDATED_EVENT, handler);
  return () => {
    try {
      sub?.remove?.();
    } catch {
      /* ignore */
    }
  };
}
