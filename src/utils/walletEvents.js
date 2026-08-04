import { DeviceEventEmitter } from 'react-native';

export const WALLET_UPDATED_EVENT = 'blyp:wallet-updated';

/**
 * Broadcast a wallet snapshot so header / store / chat UIs update immediately
 * after purchase, gift spend, or a successful /wallet poll — not only on the
 * 45s timer.
 *
 * @param {{ coinBalance?: number, bonusCoinBalance?: number, gemAvailable?: number, gemPending?: number, coins?: number, gems?: number }} wallet
 */
export function emitWalletUpdated(wallet) {
  if (!wallet || typeof wallet !== 'object') return;
  const coins =
    wallet.coins != null
      ? Number(wallet.coins)
      : Number(wallet.coinBalance || 0) + Number(wallet.bonusCoinBalance || 0);
  const gems =
    wallet.gems != null
      ? Number(wallet.gems)
      : Number(wallet.gemAvailable || 0) + Number(wallet.gemPending || 0);
  DeviceEventEmitter.emit(WALLET_UPDATED_EVENT, {
    coins: Number.isFinite(coins) ? coins : undefined,
    gems: Number.isFinite(gems) ? gems : undefined,
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
