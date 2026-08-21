// Schedule a gift for an upcoming battle — coins are reserved now and delivered
// when the match clock starts (liveStartedAt). Cancel anytime before then for a refund.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import {
  getEconomyCatalog,
  getEconomyWallet,
  createBattleGiftPledge,
  cancelBattleGiftPledge,
  listBattleGiftPledges,
  makeIdempotencyKey,
} from '../../api/economyLiveApi';
import BlypCoinService from '../../services/BlypCoinService';

function SidePick({ battle, side, onSelect }) {
  const items = [
    { key: 'creator', name: battle.creatorName, photo: battle.creatorPhoto },
    { key: 'opponent', name: battle.opponentName, photo: battle.opponentPhoto },
  ];
  return (
    <View style={styles.sideRow}>
      {items.map((item) => {
        const selected = side === item.key;
        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.sideCard, selected && styles.sideCardOn]}
            onPress={() => onSelect(item.key)}
            activeOpacity={0.85}
          >
            {item.photo ? (
              <Image source={{ uri: item.photo }} style={styles.sideAvatar} />
            ) : (
              <View style={[styles.sideAvatar, styles.sideAvatarFallback]}>
                <Text style={styles.sideInitial}>{String(item.name || '?').charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <Text style={[styles.sideLabel, selected && styles.sideLabelOn]} numberOfLines={1}>
              {item.name}
            </Text>
            {selected && <Icon name="checkmark-circle" size={responsiveFont(16)} color={COLORS.primary} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function ScheduleBattleGiftModal({ visible, battle, uid, onClose, onPledged }) {
  const [gifts, setGifts] = useState(() => BlypCoinService.getGiftTypes());
  const [balance, setBalance] = useState(0);
  const [side, setSide] = useState(null);
  const [selectedGift, setSelectedGift] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState([]);

  const refresh = useCallback(async () => {
    if (!battle?.id || !uid) return;
    setLoading(true);
    try {
      const [catalog, wallet, list] = await Promise.all([
        getEconomyCatalog().catch(() => null),
        getEconomyWallet().catch(() => null),
        listBattleGiftPledges(battle.id, { mine: true }).catch(() => null),
      ]);
      const catalogGifts = (catalog?.gifts || [])
        .filter((g) => g.enabled !== false)
        .map((g) => ({
          id: g.giftId,
          name: g.name || g.giftId,
          cost: Number(g.coinCost) || 0,
          rarity: g.rarity,
        }));
      if (catalogGifts.length) setGifts(catalogGifts);
      const coins = Number(wallet?.coinBalance || 0) + Number(wallet?.bonusCoinBalance || 0);
      setBalance(coins);
      setMine((list?.pledges || []).filter((p) => p.status === 'HELD' || p.status === 'APPLIED'));
    } finally {
      setLoading(false);
    }
  }, [battle?.id, uid]);

  useEffect(() => {
    if (!visible) return;
    setSide(null);
    setSelectedGift(null);
    refresh();
  }, [visible, refresh]);

  const confirm = useCallback(async () => {
    if (!battle?.id || !uid || !side || !selectedGift) return;
    const cost = Number(selectedGift.cost) || 0;
    if (cost > balance) {
      Alert.alert('Not enough coins', 'Top up your wallet to schedule this gift.');
      return;
    }
    const sideName = side === 'creator' ? battle.creatorName : battle.opponentName;
    Alert.alert(
      'Schedule gift?',
      `${selectedGift.name} (${cost} coins) for ${sideName}.\n\nCoins are reserved now and delivered when the battle match starts. If the battle is cancelled, you get a full refund.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Reserve coins',
          onPress: async () => {
            setBusy(true);
            try {
              const res = await createBattleGiftPledge({
                battleId: battle.id,
                side,
                giftId: selectedGift.id,
                quantity: 1,
                creatorUid: battle.creatorUid,
                opponentUid: battle.opponentUid,
                idempotencyKey: makeIdempotencyKey('btlgiftpledge'),
              });
              const bal = Number(res?.newBalances?.coinBalance || 0)
                + Number(res?.newBalances?.bonusCoinBalance || 0);
              if (Number.isFinite(bal)) setBalance(bal);
              await refresh();
              onPledged && onPledged(res);
              Alert.alert('Gift scheduled', 'It will land when the match starts. You can cancel it anytime before then.');
            } catch (e) {
              const code = e?.code || e?.response?.code;
              if (code === 'INSUFFICIENT_FUNDS') {
                Alert.alert('Not enough coins', 'Top up your wallet to schedule this gift.');
              } else {
                Alert.alert('Could not schedule', e?.message || 'Please try again.');
              }
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [battle, uid, side, selectedGift, balance, refresh, onPledged]);

  const onCancelPledge = useCallback((pledge) => {
    Alert.alert('Cancel scheduled gift?', `${pledge.coinCost} coins will be refunded to your wallet.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Refund',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const res = await cancelBattleGiftPledge({
              pledgeId: pledge.pledgeId,
              idempotencyKey: makeIdempotencyKey('btlgiftcancel'),
            });
            const bal = Number(res?.newBalances?.coinBalance || 0)
              + Number(res?.newBalances?.bonusCoinBalance || 0);
            if (Number.isFinite(bal)) setBalance(bal);
            await refresh();
          } catch (e) {
            Alert.alert('Could not cancel', e?.message || 'Please try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [refresh]);

  if (!battle) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Schedule a gift</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.sub}>
            Reserve coins now — your gift scores and appears in the feed when the match starts.
          </Text>
          <Text style={styles.balance}>Balance · {Math.trunc(balance)} coins</Text>

          {loading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 24 }} />
          ) : (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Text style={styles.section}>1. Pick a side</Text>
              <SidePick battle={battle} side={side} onSelect={setSide} />

              <Text style={styles.section}>2. Pick a gift</Text>
              <View style={styles.giftGrid}>
                {gifts.map((g) => {
                  const id = g.id || g.giftId;
                  const cost = Number(g.cost ?? g.coinCost) || 0;
                  const name = g.name || id;
                  const selected = selectedGift?.id === id;
                  return (
                    <TouchableOpacity
                      key={id}
                      style={[styles.giftTile, selected && styles.giftTileOn]}
                      onPress={() => setSelectedGift({ id, name, cost })}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.giftName} numberOfLines={1}>{name}</Text>
                      <Text style={styles.giftCost}>{cost}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, (!side || !selectedGift || busy) && styles.primaryBtnDisabled]}
                onPress={confirm}
                disabled={!side || !selectedGift || busy}
              >
                {busy ? (
                  <ActivityIndicator color="#0A0A0C" />
                ) : (
                  <Text style={styles.primaryText}>
                    {selectedGift ? `Reserve · ${selectedGift.cost} coins` : 'Reserve gift'}
                  </Text>
                )}
              </TouchableOpacity>

              {mine.length > 0 && (
                <>
                  <Text style={styles.section}>Your scheduled gifts</Text>
                  {mine.map((p) => (
                    <View key={p.pledgeId} style={styles.pledgeRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pledgeTitle}>
                          {p.giftId} · {p.coinCost} coins → {p.side === 'creator' ? battle.creatorName : battle.opponentName}
                        </Text>
                        <Text style={styles.pledgeMeta}>
                          {p.status === 'HELD' ? 'Waiting for match start' : p.status === 'APPLIED' ? 'Delivered' : p.status}
                        </Text>
                      </View>
                      {p.status === 'HELD' && (
                        <TouchableOpacity onPress={() => onCancelPledge(p)} disabled={busy}>
                          <Text style={styles.refundLink}>Refund</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.background || '#0A0A0C',
    borderTopLeftRadius: responsiveSize(18),
    borderTopRightRadius: responsiveSize(18),
    maxHeight: '88%',
    paddingBottom: responsiveSize(24),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: responsiveSize(16),
    paddingTop: responsiveSize(16),
  },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  sub: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(13),
    paddingHorizontal: responsiveSize(16),
    marginTop: responsiveSize(6),
    lineHeight: responsiveFont(18),
  },
  balance: {
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: responsiveFont(13),
    paddingHorizontal: responsiveSize(16),
    marginTop: responsiveSize(8),
  },
  body: { padding: responsiveSize(16), paddingBottom: responsiveSize(40) },
  section: {
    color: COLORS.textPrimary,
    fontWeight: '800',
    fontSize: responsiveFont(14),
    marginTop: responsiveSize(14),
    marginBottom: responsiveSize(10),
  },
  sideRow: { flexDirection: 'row', gap: responsiveSize(10) },
  sideCard: {
    flex: 1,
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(14),
    padding: responsiveSize(12),
    alignItems: 'center',
    gap: responsiveSize(6),
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  sideCardOn: { borderColor: COLORS.primary },
  sideAvatar: { width: responsiveSize(48), height: responsiveSize(48), borderRadius: responsiveSize(24), backgroundColor: '#222' },
  sideAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  sideInitial: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(18) },
  sideLabel: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '700', maxWidth: '100%' },
  sideLabelOn: { color: COLORS.textPrimary },
  giftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: responsiveSize(8) },
  giftTile: {
    width: '30%',
    flexGrow: 1,
    minWidth: responsiveSize(90),
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(12),
    paddingVertical: responsiveSize(12),
    paddingHorizontal: responsiveSize(8),
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  giftTileOn: { borderColor: COLORS.primary },
  giftName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(12) },
  giftCost: { color: COLORS.primary, fontWeight: '800', fontSize: responsiveFont(13), marginTop: 4 },
  primaryBtn: {
    marginTop: responsiveSize(18),
    backgroundColor: COLORS.primary,
    borderRadius: responsiveSize(14),
    paddingVertical: responsiveSize(14),
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: responsiveFont(15) },
  pledgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(12),
    padding: responsiveSize(12),
    marginBottom: responsiveSize(8),
    gap: responsiveSize(8),
  },
  pledgeTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(13) },
  pledgeMeta: { color: COLORS.textSecondary, fontSize: responsiveFont(11), marginTop: 2 },
  refundLink: { color: '#ef4444', fontWeight: '700', fontSize: responsiveFont(13) },
});
