import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../styles/useTheme';
import type { BlypTheme } from '../styles/blypTheme';
import { useAuth } from '../hooks/useCommon';
import BuyCoinsOverlay from './BuyCoinsOverlay';
import {
  getPromotePricing,
  getSpotlightAvailability,
  promoteBattle,
  promoteBookSpotlight,
  promoteBookTimeSlot,
} from '../api/economyLiveApi';
import { emitWalletUpdated } from '../utils/walletEvents';
import { subscribeMyBattles, BATTLE_STATUS } from '../services/battleService';
import { BLYP_LOGO_GRADIENT_COLORS } from './BlypLogo';

type DurationKey = '1h' | '24h' | '7d';

type PromotePricing = {
  battle: { coins: number; durationHours: number };
  timeSlot: { per30MinCoins: number };
  spotlight: { coins1h: number; coins24h: number; coins7d: number };
};

type BattlePick = {
  id: string;
  title?: string;
  opponentName?: string;
  creatorName?: string;
  status?: string;
  scheduledStartAt?: number;
};

type Props = {
  currentCoins: number;
  onCoinsChanged?: (nextCoins: number) => void;
  navigation?: any;
};

function formatShort(dtIso: string) {
  const d = new Date(dtIso);
  if (!Number.isFinite(d.getTime())) return dtIso;
  try {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return d.toISOString();
  }
}

function formatBattleWhen(ms?: number) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function makeIdempotencyKey(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function applyNewBalances(
  out: any,
  onCoinsChanged?: (n: number) => void
) {
  const coinBalance = Number(out?.newBalances?.coinBalance || 0);
  const bonusCoinBalance = Number(out?.newBalances?.bonusCoinBalance || 0);
  const next = coinBalance + bonusCoinBalance;
  if (Number.isFinite(next)) {
    onCoinsChanged?.(next);
    emitWalletUpdated({ coinBalance, bonusCoinBalance });
  }
}

export default function PromoteTab({ currentCoins, onCoinsChanged, navigation }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { uid, authReady } = useAuth();

  const [pricing, setPricing] = useState<PromotePricing | null>(null);
  const [pricingErr, setPricingErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [buyCoinsVisible, setBuyCoinsVisible] = useState(false);
  const [buyCoinsRequired, setBuyCoinsRequired] = useState(0);

  const [myBattles, setMyBattles] = useState<BattlePick[]>([]);
  const [battleModalOpen, setBattleModalOpen] = useState(false);
  const [selectedBattleId, setSelectedBattleId] = useState<string | null>(null);

  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [slotNote, setSlotNote] = useState('');
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(30);
  const [slotStartIso, setSlotStartIso] = useState<string | null>(null);

  const [spotModalOpen, setSpotModalOpen] = useState(false);
  const [spotDuration, setSpotDuration] = useState<DurationKey>('1h');
  const [spotAvail, setSpotAvail] = useState<string[]>([]);
  const [spotSelected, setSpotSelected] = useState<string | null>(null);
  const spotPollRef = useRef<any>(null);

  const requireCoinsOrOpenOverlay = useCallback(
    (required: number) => {
      const req = Number(required || 0);
      const cur = Number(currentCoins || 0);
      if (cur >= req) return true;
      setBuyCoinsRequired(req);
      setBuyCoinsVisible(true);
      return false;
    },
    [currentCoins]
  );

  const handleApiError = useCallback(
    (e: any, fallback: string, requiredCoins?: number) => {
      const code = String(e?.code || '');
      if (code === 'INSUFFICIENT_FUNDS' && requiredCoins != null) {
        setBuyCoinsRequired(requiredCoins);
        setBuyCoinsVisible(true);
        return;
      }
      Alert.alert('Error', String(e?.message || fallback));
    },
    []
  );

  const refreshPricing = useCallback(async () => {
    if (!uid || !authReady) return;
    try {
      setPricingErr(null);
      const p: any = await getPromotePricing();
      setPricing(p);
    } catch (e: any) {
      setPricing(null);
      setPricingErr(e?.message || 'Failed to load pricing');
    }
  }, [uid, authReady]);

  useEffect(() => {
    refreshPricing();
  }, [refreshPricing]);

  useEffect(() => {
    if (!uid) {
      setMyBattles([]);
      return undefined;
    }
    const unsub = subscribeMyBattles(uid, (rows: any[]) => {
      const eligible = (rows || []).filter((b) =>
        [BATTLE_STATUS.PENDING, BATTLE_STATUS.SCHEDULED, BATTLE_STATUS.LIVE].includes(b.status)
      );
      setMyBattles(eligible);
      setSelectedBattleId((prev) => {
        if (prev && eligible.some((b) => b.id === prev)) return prev;
        return eligible[0]?.id || null;
      });
    });
    return () => {
      try {
        unsub && unsub();
      } catch {
        /* ignore */
      }
    };
  }, [uid]);

  const battleCoins = pricing?.battle?.coins ?? 100;
  const battleHours = pricing?.battle?.durationHours ?? 24;

  const onBuyCoinsClose = () => {
    setBuyCoinsVisible(false);
  };

  const openBattlePromote = () => {
    if (!uid) {
      Alert.alert('Login Required', 'Please log in to promote.');
      return;
    }
    setBattleModalOpen(true);
  };

  const submitBattlePromote = async () => {
    if (!uid) {
      Alert.alert('Login Required', 'Please log in to promote.');
      return;
    }
    if (!requireCoinsOrOpenOverlay(battleCoins)) return;

    setBusy(true);
    try {
      const out: any = await promoteBattle({
        idempotencyKey: makeIdempotencyKey('promote:battle'),
        battleRef: selectedBattleId || undefined,
      });
      applyNewBalances(out, onCoinsChanged);
      setBattleModalOpen(false);
      const ends = out?.endsAt ? formatShort(out.endsAt) : `${battleHours}h`;
      Alert.alert('Promoted', `Battle boost is active until ${ends}.`);
    } catch (e: any) {
      handleApiError(e, 'Failed to promote', battleCoins);
    } finally {
      setBusy(false);
    }
  };

  const buildTimeSlotChoices = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    now.setSeconds(0, 0);

    const start = new Date(now);
    start.setMinutes(start.getMinutes() + (30 - (start.getMinutes() % 30 || 30)));

    for (let i = 0; i < 40; i++) {
      const d = new Date(start);
      d.setMinutes(d.getMinutes() + i * 30);
      out.push(d.toISOString());
    }
    return out;
  }, []);

  const timeSlotCost = useMemo(() => {
    const per30 = Number(pricing?.timeSlot?.per30MinCoins ?? 250);
    const blocks = Math.max(1, Math.ceil(Number(slotDurationMinutes || 30) / 30));
    return per30 * blocks;
  }, [pricing, slotDurationMinutes]);

  const openTimeSlot = () => {
    setSlotStartIso(buildTimeSlotChoices[0] || null);
    setSlotDurationMinutes(30);
    setSlotNote('');
    setSlotModalOpen(true);
  };

  const submitTimeSlot = async () => {
    if (!uid) {
      Alert.alert('Login Required', 'Please log in to promote.');
      return;
    }
    if (!slotStartIso) {
      Alert.alert('Missing time', 'Pick a time slot.');
      return;
    }

    if (!requireCoinsOrOpenOverlay(timeSlotCost)) return;

    setBusy(true);
    try {
      const out: any = await promoteBookTimeSlot({
        idempotencyKey: makeIdempotencyKey('promote:slot'),
        startsAt: slotStartIso,
        durationMinutes: slotDurationMinutes,
        note: slotNote ? slotNote.trim().slice(0, 200) : undefined,
      });
      applyNewBalances(out, onCoinsChanged);
      setSlotModalOpen(false);
      Alert.alert('Booked', `Time slot booked for ${formatShort(slotStartIso)}.`);
    } catch (e: any) {
      handleApiError(e, 'Failed to book', timeSlotCost);
    } finally {
      setBusy(false);
    }
  };

  const spotlightCost = useMemo(() => {
    if (spotDuration === '1h') return Number(pricing?.spotlight?.coins1h ?? 500);
    if (spotDuration === '24h') return Number(pricing?.spotlight?.coins24h ?? 5000);
    return Number(pricing?.spotlight?.coins7d ?? 25000);
  }, [pricing, spotDuration]);

  const refreshSpotAvail = useCallback(async () => {
    try {
      const out: any = await getSpotlightAvailability({ durationKey: spotDuration });
      const arr = Array.isArray(out?.availableStartsAt) ? out.availableStartsAt : [];
      setSpotAvail(arr);
      setSpotSelected((prev) => (prev && arr.includes(prev) ? prev : arr[0] || null));
    } catch {
      setSpotAvail([]);
      setSpotSelected(null);
    }
  }, [spotDuration]);

  const openSpotlight = async () => {
    setSpotModalOpen(true);
  };

  useEffect(() => {
    if (!spotModalOpen) return;
    refreshSpotAvail();
    spotPollRef.current = setInterval(() => {
      refreshSpotAvail();
    }, 5000);
    return () => {
      if (spotPollRef.current) clearInterval(spotPollRef.current);
      spotPollRef.current = null;
    };
  }, [spotModalOpen, refreshSpotAvail]);

  const submitSpotlight = async () => {
    if (!uid) {
      Alert.alert('Login Required', 'Please log in to promote.');
      return;
    }
    if (!spotSelected) {
      Alert.alert('No availability', 'No spotlight slots available right now.');
      return;
    }

    if (!requireCoinsOrOpenOverlay(spotlightCost)) return;

    setBusy(true);
    try {
      const out: any = await promoteBookSpotlight({
        idempotencyKey: makeIdempotencyKey('promote:spotlight'),
        startsAt: spotSelected,
        durationKey: spotDuration,
      });
      applyNewBalances(out, onCoinsChanged);
      setSpotModalOpen(false);
      Alert.alert('Booked', `Spotlight booked from ${formatShort(spotSelected)}.`);
    } catch (e: any) {
      handleApiError(e, 'Failed to book', spotlightCost);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Promote</Text>
      <Text style={styles.headerSub}>Spend coins to boost battles, book slots, or take the spotlight.</Text>

      <View style={styles.balanceRow}>
        <Text style={styles.balanceLabel}>Your coins</Text>
        <Text style={styles.balanceValue}>{Number(currentCoins || 0).toLocaleString()}</Text>
      </View>

      {pricingErr ? (
        <TouchableOpacity onPress={refreshPricing}>
          <Text style={styles.errorText}>{pricingErr} — tap to retry</Text>
        </TouchableOpacity>
      ) : null}

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.card} onPress={openBattlePromote} disabled={busy} activeOpacity={0.9}>
          <LinearGradient colors={['#141418', '#1C1C22']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardGradient}>
            <View style={styles.cardTopRow}>
              <Text style={styles.cardTitle}>Boost a Battle</Text>
              <Text style={styles.pricePill}>{battleCoins.toLocaleString()} coins</Text>
            </View>
            <Text style={styles.cardDesc}>
              Feature your upcoming fight for {battleHours}h. Pick which battle to boost.
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={openTimeSlot} disabled={busy} activeOpacity={0.9}>
          <View style={styles.cardPlain}>
            <View style={styles.cardTopRow}>
              <Text style={styles.cardTitle}>Book a Time Slot</Text>
              <Text style={styles.pricePillMuted}>
                From {Number(pricing?.timeSlot?.per30MinCoins ?? 250).toLocaleString()}
              </Text>
            </View>
            <Text style={styles.cardDescMuted}>Reserve a promoted window for your content or live.</Text>
            <Text style={styles.cardMeta}>Priced per 30 minutes</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={openSpotlight} disabled={busy} activeOpacity={0.9}>
          <View style={styles.cardPlain}>
            <View style={styles.cardTopRow}>
              <Text style={styles.cardTitle}>Ultimate Spotlight</Text>
              <Text style={styles.pricePillMuted}>Limited</Text>
            </View>
            <Text style={styles.cardDescMuted}>Exclusive spotlight windows — only one at a time.</Text>
            <Text style={styles.cardMeta}>
              1h {Number(pricing?.spotlight?.coins1h ?? 500).toLocaleString()} · 24h{' '}
              {Number(pricing?.spotlight?.coins24h ?? 5000).toLocaleString()} · 7d{' '}
              {Number(pricing?.spotlight?.coins7d ?? 25000).toLocaleString()}
            </Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          Coins are debited from your live-service wallet instantly. Failed bookings are not charged.
        </Text>
        <View style={{ height: 24 }} />
      </ScrollView>

      <BuyCoinsOverlay
        visible={buyCoinsVisible}
        onClose={onBuyCoinsClose}
        requiredCoins={buyCoinsRequired}
        currentCoins={Number(currentCoins || 0)}
        navigation={navigation}
      />

      <Modal visible={battleModalOpen} transparent animationType="slide" onRequestClose={() => setBattleModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Boost a Battle</Text>
            <Text style={styles.modalSub}>
              {battleCoins.toLocaleString()} coins · active for {battleHours} hours
            </Text>

            <Text style={styles.sectionLabel}>Your battles (optional)</Text>
            {myBattles.length === 0 ? (
              <View style={styles.emptyAvail}>
                <Text style={styles.emptyAvailText}>No upcoming battles — you can still buy a general boost.</Text>
                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={() => {
                    setBattleModalOpen(false);
                    navigation?.navigate?.('CreateBattle');
                  }}
                >
                  <Text style={styles.linkBtnText}>Or prearrange a battle</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                <TouchableOpacity
                  onPress={() => setSelectedBattleId(null)}
                  style={[styles.battleRow, !selectedBattleId && styles.battleRowActive]}
                >
                  <Text style={[styles.battleRowTitle, !selectedBattleId && styles.choiceTextActive]}>
                    General battle boost
                  </Text>
                  <Text style={styles.battleRowMeta}>Not tied to a specific fight</Text>
                </TouchableOpacity>
                {myBattles.map((b) => {
                  const active = selectedBattleId === b.id;
                  const vs =
                    b.creatorName && b.opponentName
                      ? `${b.creatorName} vs ${b.opponentName}`
                      : b.title || 'Battle';
                  return (
                    <TouchableOpacity
                      key={b.id}
                      onPress={() => setSelectedBattleId(b.id)}
                      style={[styles.battleRow, active && styles.battleRowActive]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.battleRowTitle, active && styles.choiceTextActive]} numberOfLines={1}>
                          {b.title || vs}
                        </Text>
                        <Text style={styles.battleRowMeta} numberOfLines={1}>
                          {formatBattleWhen(b.scheduledStartAt)}
                          {b.status ? ` · ${b.status}` : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <Text style={styles.costText}>Cost: {battleCoins.toLocaleString()} coins</Text>

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setBattleModalOpen(false)} style={styles.secondaryBtn} disabled={busy}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitBattlePromote} style={styles.primaryBtn} disabled={busy}>
                <LinearGradient colors={BLYP_LOGO_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryBtnGrad}>
                  {busy ? <ActivityIndicator color={theme.colors.onBrand} /> : <Text style={styles.primaryBtnText}>Promote</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={slotModalOpen} transparent animationType="slide" onRequestClose={() => setSlotModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Book a Time Slot</Text>
            <Text style={styles.modalSub}>Choose a time and duration.</Text>

            <Text style={styles.sectionLabel}>Time</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
              {buildTimeSlotChoices.slice(0, 12).map((iso) => {
                const active = slotStartIso === iso;
                return (
                  <TouchableOpacity key={iso} onPress={() => setSlotStartIso(iso)} style={[styles.choicePill, active && styles.choicePillActive]}>
                    <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{formatShort(iso)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.sectionLabel}>Duration</Text>
            <View style={styles.choiceRowWrap}>
              {[30, 60, 120].map((m) => {
                const active = slotDurationMinutes === m;
                return (
                  <TouchableOpacity key={String(m)} onPress={() => setSlotDurationMinutes(m)} style={[styles.choicePill, active && styles.choicePillActive]}>
                    <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{m} min</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>Note (optional)</Text>
            <TextInput
              value={slotNote}
              onChangeText={setSlotNote}
              placeholder="What are you promoting?"
              placeholderTextColor="rgba(255,255,255,0.5)"
              style={styles.input}
            />

            <Text style={styles.costText}>Cost: {timeSlotCost.toLocaleString()} coins</Text>

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setSlotModalOpen(false)} style={styles.secondaryBtn} disabled={busy}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitTimeSlot} style={styles.primaryBtn} disabled={busy}>
                <LinearGradient colors={BLYP_LOGO_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryBtnGrad}>
                  {busy ? <ActivityIndicator color={theme.colors.onBrand} /> : <Text style={styles.primaryBtnText}>Book</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={spotModalOpen} transparent animationType="slide" onRequestClose={() => setSpotModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Ultimate Spotlight</Text>
            <Text style={styles.modalSub}>Pick a duration, then choose an available start time.</Text>

            <Text style={styles.sectionLabel}>Duration</Text>
            <View style={styles.choiceRowWrap}>
              {(
                [
                  { key: '1h', label: '1 hour' },
                  { key: '24h', label: '24 hours' },
                  { key: '7d', label: '7 days' },
                ] as { key: DurationKey; label: string }[]
              ).map((d) => {
                const active = spotDuration === d.key;
                return (
                  <TouchableOpacity
                    key={d.key}
                    onPress={() => setSpotDuration(d.key)}
                    style={[styles.choicePill, active && styles.choicePillActive]}
                  >
                    <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{d.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>Available</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
              {spotAvail.length === 0 ? (
                <View style={styles.emptyAvail}>
                  <Text style={styles.emptyAvailText}>No slots right now</Text>
                </View>
              ) : (
                spotAvail.slice(0, 10).map((iso) => {
                  const active = spotSelected === iso;
                  return (
                    <TouchableOpacity key={iso} onPress={() => setSpotSelected(iso)} style={[styles.choicePill, active && styles.choicePillActive]}>
                      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{formatShort(iso)}</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            <Text style={styles.costText}>Cost: {spotlightCost.toLocaleString()} coins</Text>

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setSpotModalOpen(false)} style={styles.secondaryBtn} disabled={busy}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitSpotlight} style={styles.primaryBtn} disabled={busy || !spotSelected}>
                <LinearGradient colors={BLYP_LOGO_GRADIENT_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryBtnGrad}>
                  {busy ? <ActivityIndicator color={theme.colors.onBrand} /> : <Text style={styles.primaryBtnText}>Book</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(theme: BlypTheme) {
  return StyleSheet.create({
    container: {
      paddingTop: 8,
      flex: 1,
    },
    headerTitle: {
      color: theme.colors.textPrimary,
      fontSize: 20,
      fontWeight: '900',
      textAlign: 'center',
      marginTop: 6,
    },
    headerSub: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      textAlign: 'center',
      marginTop: 6,
      marginBottom: 12,
      paddingHorizontal: 20,
      lineHeight: 18,
    },
    balanceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      marginBottom: 10,
    },
    balanceLabel: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      fontWeight: '700',
    },
    balanceValue: {
      color: theme.colors.textPrimary,
      fontSize: 16,
      fontWeight: '900',
    },
    errorText: {
      color: theme.colors.error,
      textAlign: 'center',
      marginBottom: 10,
      paddingHorizontal: 16,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingBottom: 24,
    },
    card: {
      borderRadius: 16,
      overflow: 'hidden',
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    cardGradient: {
      padding: 16,
    },
    cardPlain: {
      padding: 16,
      backgroundColor: theme.colors.surface,
    },
    cardTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    cardTitle: {
      color: theme.colors.textPrimary,
      fontSize: 16,
      fontWeight: '900',
      flex: 1,
    },
    pricePill: {
      color: theme.colors.onBrand,
      backgroundColor: theme.colors.accent,
      overflow: 'hidden',
      fontSize: 11,
      fontWeight: '900',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
    },
    pricePillMuted: {
      color: theme.colors.textSecondary,
      fontSize: 11,
      fontWeight: '800',
    },
    cardDesc: {
      color: theme.colors.textPrimary,
      opacity: 0.9,
      marginTop: 8,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18,
    },
    cardDescMuted: {
      color: theme.colors.textSecondary,
      marginTop: 8,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18,
    },
    cardMeta: {
      color: theme.colors.textSecondary,
      marginTop: 10,
      fontSize: 12,
      fontWeight: '700',
    },
    footnote: {
      color: theme.colors.textSecondary,
      fontSize: 11,
      textAlign: 'center',
      marginTop: 8,
      opacity: 0.85,
      lineHeight: 16,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: theme.colors.background,
      padding: 16,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingBottom: 20,
    },
    modalTitle: {
      color: theme.colors.textPrimary,
      fontSize: 18,
      fontWeight: '900',
      textAlign: 'center',
    },
    modalSub: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      textAlign: 'center',
      marginTop: 6,
      marginBottom: 14,
    },
    sectionLabel: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: '800',
      marginTop: 12,
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    choiceRow: {
      paddingRight: 8,
      gap: 8,
      alignItems: 'center',
    },
    choiceRowWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    choicePill: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: theme.colors.surface,
    },
    choicePillActive: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.surfaceAlt,
    },
    choiceText: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: '800',
    },
    choiceTextActive: {
      color: theme.colors.textPrimary,
    },
    battleRow: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
      backgroundColor: theme.colors.surface,
    },
    battleRowActive: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.surfaceAlt,
    },
    battleRowTitle: {
      color: theme.colors.textPrimary,
      fontWeight: '800',
      fontSize: 14,
    },
    battleRowMeta: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      marginTop: 4,
      fontWeight: '600',
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      color: theme.colors.textPrimary,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
    },
    costText: {
      color: theme.colors.textPrimary,
      fontSize: 14,
      fontWeight: '900',
      textAlign: 'center',
      marginTop: 14,
    },
    modalActions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 14,
      marginBottom: 8,
    },
    secondaryBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
    },
    secondaryBtnText: {
      color: theme.colors.textPrimary,
      fontWeight: '900',
    },
    primaryBtn: {
      flex: 1,
      borderRadius: 12,
      overflow: 'hidden',
    },
    primaryBtnGrad: {
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
    },
    primaryBtnText: {
      color: theme.colors.onBrand,
      fontWeight: '900',
    },
    emptyAvail: {
      paddingVertical: 14,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
    },
    emptyAvailText: {
      color: theme.colors.textSecondary,
      fontWeight: '700',
    },
    linkBtn: {
      marginTop: 10,
      paddingVertical: 8,
    },
    linkBtnText: {
      color: theme.colors.accent,
      fontWeight: '800',
      fontSize: 13,
    },
  });
}
