import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getEconomyWallet } from '../../api/economyLiveApi';
import { subscribeWalletUpdated } from '../../utils/walletEvents';

/**
 * Account (platform) coin balance for Grid 9 arsenal / gift UI.
 * Uses live-service GET /wallet + walletEvents — does not touch frozen BlypCoinService.
 */
export function useGrid9AccountCoinBalance(enabled = true): {
  accountCoins: number;
  status: 'idle' | 'loading' | 'ok' | 'error';
  refresh: () => Promise<void>;
} {
  const [accountCoins, setAccountCoins] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    setStatus((prev) => (prev === 'ok' ? 'ok' : 'loading'));
    try {
      const wallet = await getEconomyWallet();
      const next =
        Number(wallet?.coinBalance || 0) + Number(wallet?.bonusCoinBalance || 0);
      if (Number.isFinite(next)) {
        setAccountCoins(Math.max(0, Math.floor(next)));
        setStatus('ok');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const unsub = subscribeWalletUpdated((payload: { coins?: number }) => {
      const coins = Number(payload?.coins);
      if (Number.isFinite(coins)) {
        setAccountCoins(Math.max(0, Math.floor(coins)));
        setStatus('ok');
      }
    });
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => {
      unsub();
      try {
        appSub?.remove?.();
      } catch {
        /* ignore */
      }
    };
  }, [enabled, refresh]);

  return { accountCoins, status, refresh };
}
