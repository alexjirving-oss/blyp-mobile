import React, { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../hooks/useCommon';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';
import { getEconomyWallet } from '../api/economyLiveApi';
import { shouldUseLiveServiceWallet } from '../utils/walletSource';
import { emitWalletUpdated, subscribeWalletUpdated } from '../utils/walletEvents';
import { recoverPendingAndroidIapPurchases } from '../utils/recoverPendingAndroidIap';

export default function HeaderWalletBalances({ textColor = '#d1d5db' }) {
  const [coins, setCoins] = useState(0);
  const [gems, setGems] = useState(0);

  const { uid, isAuthenticated, authReady } = useAuth();

  const styles = useMemo(() => createStyles(textColor), [textColor]);

  useEffect(() => {
    // Keep last-known balances across auth flicker — never force 0 here.
    if (!authReady || !isAuthenticated || !uid) {
      return undefined;
    }

    if (shouldUseLiveServiceWallet()) {
      let cancelled = false;
      let failStreak = 0;

      const applyWallet = (wallet) => {
        const nextCoins = Number(wallet?.coinBalance || 0) + Number(wallet?.bonusCoinBalance || 0);
        const nextGems = Number(wallet?.gemAvailable || 0) + Number(wallet?.gemPending || 0);
        if (Number.isFinite(nextCoins)) setCoins(nextCoins);
        if (Number.isFinite(nextGems)) setGems(nextGems);
        emitWalletUpdated(wallet);
      };

      const refresh = async () => {
        try {
          const wallet = await getEconomyWallet();
          if (cancelled) return;
          failStreak = 0;
          applyWallet(wallet);
        } catch (e) {
          failStreak += 1;
          if (!cancelled) {
            console.warn('[HEADER_WALLET] live-service wallet fetch failed', e?.message || String(e));
          }
          // Retry quickly a few times after failure (auth race / 304 / timeout).
          if (!cancelled && failStreak <= 3) {
            setTimeout(() => {
              if (!cancelled) refresh();
            }, 1500 * failStreak);
          }
        }
      };

      refresh();
      recoverPendingAndroidIapPurchases().catch(() => {});
      const t = setInterval(refresh, 15000);

      const onAppState = (next) => {
        if (next === 'active') {
          refresh();
          recoverPendingAndroidIapPurchases().catch(() => {});
        }
      };
      const appSub = AppState.addEventListener('change', onAppState);
      const unsubBus = subscribeWalletUpdated((snap) => {
        if (cancelled) return;
        if (snap?.coins != null && Number.isFinite(snap.coins)) setCoins(snap.coins);
        if (snap?.gems != null && Number.isFinite(snap.gems)) setGems(snap.gems);
      });

      return () => {
        cancelled = true;
        clearInterval(t);
        try {
          appSub?.remove?.();
        } catch {
          /* ignore */
        }
        unsubBus();
      };
    }

    const unsubCoins = BlypCoinService.subscribeToBalance(uid, (newBalance) => {
      const n = Number(newBalance || 0);
      if (Number.isFinite(n)) {
        setCoins(n);
        emitWalletUpdated({ coins: n });
      }
    });

    const unsubGems = GemService.subscribeToGems(uid, (newBalance) => {
      const n = Number(newBalance || 0);
      if (Number.isFinite(n)) setGems(n);
    });

    return () => {
      try {
        unsubCoins?.();
      } catch {}
      try {
        unsubGems?.();
      } catch {}
    };
  }, [uid, isAuthenticated, authReady]);

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.item}>
        <Text style={styles.emoji} allowFontScaling={false}>
          🪙
        </Text>
        <Text style={styles.value} allowFontScaling={false}>
          {coins.toLocaleString()}
        </Text>
      </View>
      <View style={styles.item}>
        <Text style={styles.emoji} allowFontScaling={false}>
          💎
        </Text>
        <Text style={styles.value} allowFontScaling={false}>
          {gems.toLocaleString()}
        </Text>
      </View>
    </View>
  );
}

const createStyles = (textColor) =>
  StyleSheet.create({
    wrap: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 2,
      marginLeft: 10,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    emoji: {
      fontSize: 14,
    },
    value: {
      color: textColor,
      fontSize: 12,
      fontWeight: '700',
      includeFontPadding: false,
    },
  });
