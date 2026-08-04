import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../hooks/useCommon';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';
import { getEconomyWallet } from '../api/economyLiveApi';

import { shouldUseLiveServiceWallet } from '../utils/walletSource';

export default function HeaderWalletBalances({ textColor = '#d1d5db' }) {
  const [coins, setCoins] = useState(0);
  const [gems, setGems] = useState(0);

  const { uid, isAuthenticated, authReady } = useAuth();

  const styles = useMemo(() => createStyles(textColor), [textColor]);

  useEffect(() => {
    // NOTE: Most of the app runs on Cognito auth, with an optional Firebase auth bridge.
    // Do not depend on Firebase `auth.currentUser` here; use `useAuth()` as the source of truth.
    if (!authReady || !isAuthenticated || !uid) {
      return;
    }

    if (shouldUseLiveServiceWallet()) {
      let cancelled = false;

      const refresh = async () => {
        try {
          const wallet = await getEconomyWallet();
          const nextCoins = Number(wallet?.coinBalance || 0) + Number(wallet?.bonusCoinBalance || 0);
          const nextGems = Number(wallet?.gemAvailable || 0) + Number(wallet?.gemPending || 0);

          if (cancelled) return;
          if (Number.isFinite(nextCoins)) setCoins(nextCoins);
          if (Number.isFinite(nextGems)) setGems(nextGems);
        } catch (e) {
          if (!cancelled) {
            console.warn('[HEADER_WALLET] live-service wallet fetch failed', e?.message || String(e));
          }
        }
      };

      refresh();
      const t = setInterval(refresh, 5000);

      return () => {
        cancelled = true;
        clearInterval(t);
      };
    }

    const unsubCoins = BlypCoinService.subscribeToBalance(uid, (newBalance) => {
      const n = Number(newBalance || 0);
      if (Number.isFinite(n)) setCoins(n);
    });

    const unsubGems = GemService.subscribeToGems(uid, (newBalance) => {
      const n = Number(newBalance || 0);
      if (Number.isFinite(n)) setGems(n);
    });

    return () => {
      try { unsubCoins?.(); } catch {}
      try { unsubGems?.(); } catch {}
    };
  }, [uid, isAuthenticated, authReady]);

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.item}>
        <Text style={styles.emoji} allowFontScaling={false}>🪙</Text>
        <Text style={styles.value} allowFontScaling={false}>{coins.toLocaleString()}</Text>
      </View>
      <View style={styles.item}>
        <Text style={styles.emoji} allowFontScaling={false}>💎</Text>
        <Text style={styles.value} allowFontScaling={false}>{gems.toLocaleString()}</Text>
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
