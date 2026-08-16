/**
 * TreasureChestScreen — daily chest for verified accounts.
 * Deep link: blyp://treasure  |  push data.type = treasure_chest
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { emitWalletUpdated } from '../utils/walletEvents';
import {
  claimTreasureChest,
  claimTreasureChestBonus,
  peekTreasureChest,
} from '../services/treasureChestService';
import { isProfileVerified } from '../services/verificationService';
import { useAuth } from '../hooks/useCommon';
import { db } from '../config/firebase';

export default function TreasureChestScreen({ navigation }) {
  const isFocused = useIsFocused();
  const { uid } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState(null);
  const [lastReward, setLastReward] = useState(null);
  const [localVerified, setLocalVerified] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (uid && db) {
        try {
          const snap = await db.collection('users').doc(uid).get();
          const data = typeof snap?.data === 'function' ? snap.data() : snap?.data;
          setLocalVerified(isProfileVerified(data || {}));
        } catch {
          setLocalVerified(null);
        }
      }
      const next = await peekTreasureChest();
      if (next?.ok) setPeek(next);
      else setPeek(next);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    if (isFocused) refresh();
  }, [isFocused, refresh]);

  const onClaimBase = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await claimTreasureChest();
      if (!result?.ok) {
        if (result?.reason === 'unauthenticated') {
          Alert.alert('Sign in required', 'Please sign in to open your treasure chest.');
        } else if (result?.reason === 'not_verified' || result?.code === 'RESTRICTED') {
          Alert.alert('Verified only', 'Treasure chests are for verified accounts.');
        } else {
          Alert.alert('Could not claim', String(result?.reason || 'Try again later.'));
        }
        await refresh();
        return;
      }
      if (result.alreadyClaimed) {
        Alert.alert('Already claimed', 'You already opened today’s chest. Come back after 00:00 UTC.');
      } else {
        setLastReward({ coins: result.reward, kind: 'base' });
        emitWalletUpdated({ coins: result.balanceCoins });
        Alert.alert('You got coins!', `You got ${result.reward} coins from your treasure chest.`);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onClaimBonus = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await claimTreasureChestBonus();
      if (!result?.ok) {
        if (result?.reason === 'video_post_required') {
          Alert.alert(
            'Post a video',
            'Post a new video today, then come back to claim your bonus coins.',
            [
              { text: 'Not now', style: 'cancel' },
              {
                text: 'Create',
                onPress: () => {
                  try {
                    navigation?.navigate?.('CreatePost');
                  } catch {
                    /* ignore */
                  }
                },
              },
            ]
          );
        } else if (result?.reason === 'base_required') {
          Alert.alert('Open the chest first', 'Claim today’s treasure before the bonus.');
        } else {
          Alert.alert('Bonus unavailable', String(result?.reason || 'Try again later.'));
        }
        await refresh();
        return;
      }
      if (result.alreadyClaimed) {
        Alert.alert('Bonus claimed', 'You already collected today’s video bonus.');
      } else {
        setLastReward({ coins: result.reward, kind: 'bonus' });
        emitWalletUpdated({ coins: result.balanceCoins });
        Alert.alert('Bonus unlocked!', `You got ${result.reward} more coins.`);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const verified = peek?.verified === true || localVerified === true;
  const enabled = peek?.enabled !== false;
  const claimableBase = Number(peek?.claimableBase || 0);
  const claimableBonus = Number(peek?.claimableBonus || 0);
  const baseClaimed = peek?.baseClaimedToday === true;
  const bonusClaimed = peek?.bonusClaimedToday === true;
  const baseCoins = Number(peek?.baseCoins || 15);
  const bonusCoins = Number(peek?.bonusCoins || 10);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} hitSlop={12} style={styles.backBtn}>
          <Icon name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Daily treasure</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.chest}>
            <Text style={styles.chestEmoji}>🎁</Text>
            <Text style={styles.title}>
              {!enabled
                ? 'Treasure chest offline'
                : !verified
                  ? 'Verified accounts only'
                  : baseClaimed
                    ? 'Chest opened'
                    : 'Your chest is ready'}
            </Text>
            <Text style={styles.sub}>
              Resets every day at 00:00 UTC
              {peek?.day ? ` · ${peek.day}` : ''}
            </Text>
          </View>

          {lastReward ? (
            <View style={styles.rewardBanner}>
              <Text style={styles.rewardText}>
                You got {lastReward.coins} coins
                {lastReward.kind === 'bonus' ? ' (bonus)' : ''}
              </Text>
            </View>
          ) : null}

          {!verified ? (
            <Text style={styles.hint}>
              Get verified on your profile to unlock a daily coin chest and a same-day video bonus.
            </Text>
          ) : (
            <>
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  (busy || claimableBase <= 0) && styles.btnDisabled,
                ]}
                disabled={busy || claimableBase <= 0}
                onPress={onClaimBase}
              >
                {busy && claimableBase > 0 ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {baseClaimed
                      ? `Claimed · ${baseCoins} coins`
                      : `Open chest · ${baseCoins} coins`}
                  </Text>
                )}
              </TouchableOpacity>

              <View style={styles.bonusCard}>
                <Text style={styles.bonusTitle}>Want more coins?</Text>
                <Text style={styles.bonusBody}>
                  Post a new video today, then claim +{bonusCoins} coins (once per day).
                </Text>
                {baseClaimed && !bonusClaimed && claimableBonus <= 0 ? (
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => {
                      try {
                        navigation?.navigate?.('CreatePost');
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    <Text style={styles.secondaryBtnText}>Post a video</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.secondaryBtn,
                    styles.bonusClaimBtn,
                    (busy || claimableBonus <= 0) && styles.btnDisabled,
                  ]}
                  disabled={busy || claimableBonus <= 0}
                  onPress={onClaimBonus}
                >
                  <Text style={styles.secondaryBtnText}>
                    {bonusClaimed
                      ? 'Bonus claimed'
                      : claimableBonus > 0
                        ? `Claim bonus · ${bonusCoins} coins`
                        : `Bonus · ${bonusCoins} coins`}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f14' },
  header: {
    paddingTop: 52,
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingTop: 8 },
  chest: { alignItems: 'center', marginBottom: 20 },
  chestEmoji: { fontSize: 64, marginBottom: 8 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  sub: { color: '#9ca3af', marginTop: 6, fontSize: 13, textAlign: 'center' },
  hint: { color: '#d1d5db', lineHeight: 20, textAlign: 'center', marginTop: 8 },
  rewardBanner: {
    backgroundColor: 'rgba(16,185,129,0.18)',
    borderColor: 'rgba(16,185,129,0.45)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  rewardText: { color: '#6ee7b7', fontWeight: '700', textAlign: 'center' },
  primaryBtn: {
    backgroundColor: COLORS.primary || '#e11d48',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  btnDisabled: { opacity: 0.45 },
  bonusCard: {
    marginTop: 18,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#141a22',
    borderWidth: 1,
    borderColor: '#243041',
  },
  bonusTitle: { color: '#fff', fontWeight: '800', fontSize: 16 },
  bonusBody: { color: '#9ca3af', marginTop: 6, marginBottom: 12, lineHeight: 19 },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#1f2937',
    marginBottom: 8,
  },
  bonusClaimBtn: { backgroundColor: '#0f766e' },
  secondaryBtnText: { color: '#fff', fontWeight: '700' },
});
