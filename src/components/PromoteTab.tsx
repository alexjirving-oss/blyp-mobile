import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import BuyCoinsOverlay from './BuyCoinsOverlay';
import {
  getPromotePricing,
  getSpotlightAvailability,
  getMyPromotions,
  promoteBookMethod,
  type PromotePricing,
} from '../api/economyLiveApi';
import { emitWalletUpdated } from '../utils/walletEvents';
import { subscribeMyBattles, BATTLE_STATUS } from '../services/battleService';
import { BLYP_LOGO_GRADIENT_COLORS } from './BlypLogo';
import {
  PROMOTE_CATEGORIES,
  PROMOTE_SPORT_TARGETS,
  PROMOTE_GEO_TARGETS,
  PROMOTE_INTEREST_TARGETS,
  mergePromoteCatalog,
  estimatePromoteReach,
  formatReachPreview,
  methodTitleForType,
} from '../config/promoteCatalog';

type DurationKey = '1h' | '24h' | '7d';

type BattlePick = {
  id: string;
  title?: string;
  opponentName?: string;
  creatorName?: string;
  status?: string;
  scheduledStartAt?: number;
};

type PostPick = { id: string; caption?: string; thumbnail?: string };

type StudioTab = 'catalog' | 'active' | 'history';

type Props = {
  currentCoins: number;
  onCoinsChanged?: (nextCoins: number) => void;
  navigation?: any;
  posts?: PostPick[];
  initialMethodId?: string | null;
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

export default function PromoteTab({
  currentCoins,
  onCoinsChanged,
  navigation: _navigation,
  posts = [],
  initialMethodId = null,
}: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [studioTab, setStudioTab] = useState<StudioTab>('catalog');
  const [category, setCategory] = useState('all');
  const [pricing, setPricing] = useState<PromotePricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [battles, setBattles] = useState<BattlePick[]>([]);
  const [mineActive, setMineActive] = useState<any[]>([]);
  const [mineHistory, setMineHistory] = useState<any[]>([]);
  const [mineLoading, setMineLoading] = useState(false);

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMethodId, setComposeMethodId] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [battleRef, setBattleRef] = useState<string | null>(null);
  const [postRef, setPostRef] = useState<string | null>(null);
  const [sports, setSports] = useState<string[]>([]);
  const [geos, setGeos] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [slotStarts, setSlotStarts] = useState<string[]>([]);
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [durationKey, setDurationKey] = useState<DurationKey>('1h');
  const [slotsLoading, setSlotsLoading] = useState(false);

  const catalog = useMemo(() => mergePromoteCatalog(pricing), [pricing]);
  const filtered = useMemo(() => {
    if (category === 'all') return catalog;
    return catalog.filter((m) => m.category === category);
  }, [catalog, category]);

  const composeMethod = useMemo(
    () => catalog.find((m) => m.methodId === composeMethodId) || null,
    [catalog, composeMethodId],
  );

  const selectedPkg = useMemo(() => {
    if (!composeMethod) return null;
    const list = composeMethod.packages || [];
    return list.find((p) => p.id === packageId) || list[0] || null;
  }, [composeMethod, packageId]);

  const reachPreview = useMemo(() => {
    if (!composeMethod || !selectedPkg) return '';
    const est = estimatePromoteReach({
      methodId: composeMethod.methodId,
      type: composeMethod.type,
      hours: selectedPkg.hours,
      targeting: { sports, geos, interests },
    });
    return formatReachPreview(est);
  }, [composeMethod, selectedPkg, sports, geos, interests]);

  const reloadPricing = useCallback(async () => {
    setLoading(true);
    try {
      const p = await getPromotePricing();
      setPricing(p);
    } catch (e: any) {
      console.warn('[PromoteStudio] pricing', e?.message || e);
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadMine = useCallback(async () => {
    setMineLoading(true);
    try {
      const res = await getMyPromotions();
      setMineActive(Array.isArray(res?.active) ? res.active : []);
      setMineHistory(Array.isArray(res?.history) ? res.history : []);
    } catch (e: any) {
      console.warn('[PromoteStudio] mine', e?.message || e);
      setMineActive([]);
      setMineHistory([]);
    } finally {
      setMineLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadPricing();
  }, [reloadPricing]);

  useEffect(() => {
    if (studioTab === 'active' || studioTab === 'history') reloadMine();
  }, [studioTab, reloadMine]);

  useEffect(() => {
    const unsub = subscribeMyBattles?.((list: any[]) => {
      const mapped = (list || [])
        .filter((b) => b && b.id)
        .map((b) => ({
          id: String(b.id),
          title: b.title || b.name,
          opponentName: b.opponentName || b.opponent?.displayName,
          creatorName: b.creatorName,
          status: b.status || b.battleStatus,
          scheduledStartAt: b.scheduledStartAt || b.startsAtMs,
        }));
      setBattles(mapped);
    });
    return () => {
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const openCompose = useCallback(
    (methodId: string) => {
      const m = catalog.find((x) => x.methodId === methodId);
      setComposeMethodId(methodId);
      setPackageId(m?.packages?.[0]?.id || null);
      setNote('');
      setBattleRef(null);
      setPostRef(posts?.[0]?.id || null);
      setSports([]);
      setGeos([]);
      setInterests([]);
      setSelectedStart(null);
      setSlotStarts([]);
      setDurationKey('1h');
      setComposeOpen(true);
    },
    [catalog, posts],
  );

  useEffect(() => {
    if (!initialMethodId || !catalog.length) return;
    openCompose(String(initialMethodId));
  }, [initialMethodId, catalog.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadExclusiveSlots = useCallback(async () => {
    if (!composeMethod?.exclusiveCalendar) return;
    setSlotsLoading(true);
    try {
      if (composeMethod.methodId === 'spotlight') {
        const res = await getSpotlightAvailability({ durationKey });
        setSlotStarts(Array.isArray(res?.availableStartsAt) ? res.availableStartsAt : []);
      } else {
        // time_slot: synthesize near-term starts every 30m for next 6h
        const out: string[] = [];
        const now = new Date();
        now.setSeconds(0, 0);
        const mins = now.getMinutes();
        now.setMinutes(mins % 30 === 0 ? mins : mins + (30 - (mins % 30)));
        for (let i = 0; i < 12; i++) {
          const d = new Date(now);
          d.setMinutes(d.getMinutes() + i * 30);
          out.push(d.toISOString());
        }
        setSlotStarts(out);
      }
    } catch (e: any) {
      console.warn('[PromoteStudio] slots', e?.message || e);
      setSlotStarts([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [composeMethod, durationKey]);

  useEffect(() => {
    if (composeOpen && composeMethod?.exclusiveCalendar) loadExclusiveSlots();
  }, [composeOpen, composeMethod, loadExclusiveSlots]);

  const toggleChip = (list: string[], id: string, set: (v: string[]) => void) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(0, 6));
  };

  const ensureCoins = (need: number) => {
    if (Number(currentCoins) >= need) return true;
    Alert.alert('Not enough coins', 'Buy more coins to run this promote.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Buy coins', onPress: () => setBuyOpen(true) },
    ]);
    return false;
  };

  const submitCompose = async () => {
    if (!composeMethod || !selectedPkg || busy) return;
    const cost = Number(selectedPkg.coins) || 0;
    if (!ensureCoins(cost)) return;

    if (composeMethod.needsBattle && !battleRef) {
      Alert.alert('Pick a battle', 'Choose which battle to promote.');
      return;
    }
    if (composeMethod.needsPost && !postRef) {
      Alert.alert('Pick a post', 'Choose which post to boost.');
      return;
    }
    if (composeMethod.exclusiveCalendar && !selectedStart) {
      Alert.alert('Pick a slot', 'Choose an available start time.');
      return;
    }

    setBusy(true);
    try {
      const body: any = {
        idempotencyKey: makeIdempotencyKey(composeMethod.methodId),
        methodId: composeMethod.methodId,
        packageId: selectedPkg.id,
        note: note.trim() || undefined,
        targeting: {
          sports: sports.length ? sports : undefined,
          geos: geos.length ? geos : undefined,
          interests: interests.length ? interests : undefined,
        },
      };
      if (battleRef) body.battleRef = battleRef;
      if (postRef) body.postRef = postRef;
      if (selectedStart) body.startsAt = selectedStart;
      if (composeMethod.methodId === 'spotlight') {
        body.durationKey = (selectedPkg.id === '7d' || selectedPkg.id === '24h' || selectedPkg.id === '1h'
          ? selectedPkg.id
          : durationKey) as DurationKey;
      }
      if (composeMethod.methodId === 'time_slot') {
        body.durationMinutes = Math.max(15, Math.round(selectedPkg.hours * 60));
      }

      const res = await promoteBookMethod(body);
      const next = Number(res?.newBalances?.coinBalance);
      if (Number.isFinite(next)) {
        onCoinsChanged?.(next);
        try {
          emitWalletUpdated({ coinBalance: next, bonusCoinBalance: res?.newBalances?.bonusCoinBalance });
        } catch {
          /* ignore */
        }
      }
      setComposeOpen(false);
      Alert.alert('Promote booked', `${composeMethod.title} is live until ${formatShort(res.endsAt)}.`);
      setStudioTab('active');
      reloadMine();
    } catch (e: any) {
      const msg = e?.message || e?.error || String(e);
      Alert.alert('Could not book', msg);
    } finally {
      setBusy(false);
    }
  };

  const liveBattles = battles.filter((b) => {
    const s = String(b.status || '').toUpperCase();
    return s !== 'ENDED' && s !== 'CANCELLED' && s !== String(BATTLE_STATUS?.ENDED || 'ENDED');
  });

  return (
    <View style={styles.root}>
      <LinearGradient colors={[...BLYP_LOGO_GRADIENT_COLORS]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <Text style={styles.heroEyebrow}>Creator growth</Text>
        <Text style={styles.heroTitle}>Promote Studio</Text>
        <Text style={styles.heroSub}>Catalog-driven methods · fair caps · labelled search</Text>
        <Text style={styles.heroCoins}>{Number(currentCoins || 0).toLocaleString()} coins</Text>
      </LinearGradient>

      <View style={styles.tabRow}>
        {([
          ['catalog', 'Methods'],
          ['active', 'Active'],
          ['history', 'History'],
        ] as const).map(([id, label]) => (
          <TouchableOpacity key={id} style={[styles.tabBtn, studioTab === id && styles.tabBtnOn]} onPress={() => setStudioTab(id)}>
            <Text style={[styles.tabText, studioTab === id && styles.tabTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {studioTab === 'catalog' && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
            {PROMOTE_CATEGORIES.map((c) => (
              <TouchableOpacity key={c.id} style={[styles.catChip, category === c.id && styles.catChipOn]} onPress={() => setCategory(c.id)}>
                <Text style={[styles.catText, category === c.id && styles.catTextOn]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {loading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />
          ) : (
            <ScrollView contentContainerStyle={styles.listPad} showsVerticalScrollIndicator={false}>
              {filtered.map((m) => {
                const minCoins = Math.min(...(m.packages || []).map((p) => Number(p.coins) || 0));
                return (
                  <TouchableOpacity key={m.methodId} style={styles.card} activeOpacity={0.88} onPress={() => openCompose(m.methodId)}>
                    <View style={styles.cardTop}>
                      <Text style={styles.cardTitle}>{m.title}</Text>
                      <Text style={styles.cardPrice}>from {minCoins}</Text>
                    </View>
                    <Text style={styles.cardSub}>{m.subtitle}</Text>
                    <Text style={styles.cardMeta}>{m.type.replace(/_/g, ' ')} · {m.packages?.length || 0} packages</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </>
      )}

      {(studioTab === 'active' || studioTab === 'history') && (
        <ScrollView contentContainerStyle={styles.listPad} showsVerticalScrollIndicator={false}>
          {mineLoading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (studioTab === 'active' ? mineActive : mineHistory).length === 0 ? (
            <Text style={styles.empty}>No {studioTab} promotions yet.</Text>
          ) : (
            (studioTab === 'active' ? mineActive : mineHistory).map((p) => (
              <View key={p.promotionId} style={styles.card}>
                <Text style={styles.cardTitle}>{methodTitleForType(p.methodId || p.promotionType)}</Text>
                <Text style={styles.cardSub}>
                  {p.promotionType} · {formatShort(p.startsAt)} → {formatShort(p.endsAt)}
                </Text>
                {p.note ? <Text style={styles.cardMeta}>{p.note}</Text> : null}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal visible={composeOpen} animationType="slide" transparent onRequestClose={() => setComposeOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{composeMethod?.title || 'Compose'}</Text>
              <TouchableOpacity onPress={() => setComposeOpen(false)}>
                <Text style={styles.modalClose}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 28 }}>
              <Text style={styles.sectionLabel}>Package</Text>
              <View style={styles.rowWrap}>
                {(composeMethod?.packages || []).map((pkg) => (
                  <TouchableOpacity
                    key={pkg.id}
                    style={[styles.pkgChip, packageId === pkg.id && styles.pkgChipOn]}
                    onPress={() => {
                      setPackageId(pkg.id);
                      if (pkg.id === '1h' || pkg.id === '24h' || pkg.id === '7d') setDurationKey(pkg.id);
                    }}
                  >
                    <Text style={styles.pkgLabel}>{pkg.label}</Text>
                    <Text style={styles.pkgCoins}>{pkg.coins} coins</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.reach}>{reachPreview}</Text>

              {composeMethod?.needsBattle ? (
                <>
                  <Text style={styles.sectionLabel}>Battle</Text>
                  {(liveBattles.length ? liveBattles : battles).slice(0, 8).map((b) => (
                    <TouchableOpacity
                      key={b.id}
                      style={[styles.pickRow, battleRef === b.id && styles.pickRowOn]}
                      onPress={() => setBattleRef(b.id)}
                    >
                      <Text style={styles.pickTitle}>{b.title || `Battle ${b.id.slice(0, 6)}`}</Text>
                      <Text style={styles.pickSub}>{formatBattleWhen(b.scheduledStartAt) || b.status || ''}</Text>
                    </TouchableOpacity>
                  ))}
                  {!battles.length ? <Text style={styles.empty}>No battles found.</Text> : null}
                </>
              ) : null}

              {composeMethod?.needsPost ? (
                <>
                  <Text style={styles.sectionLabel}>Post</Text>
                  {(posts || []).slice(0, 12).map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.pickRow, postRef === p.id && styles.pickRowOn]}
                      onPress={() => setPostRef(p.id)}
                    >
                      <Text style={styles.pickTitle} numberOfLines={2}>
                        {p.caption || `Post ${p.id.slice(0, 8)}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {!posts?.length ? <Text style={styles.empty}>No posts on this profile yet.</Text> : null}
                </>
              ) : null}

              {composeMethod?.exclusiveCalendar ? (
                <>
                  <Text style={styles.sectionLabel}>Exclusive slot</Text>
                  {slotsLoading ? (
                    <ActivityIndicator color={theme.colors.primary} />
                  ) : (
                    <View style={styles.rowWrap}>
                      {slotStarts.map((s) => (
                        <TouchableOpacity
                          key={s}
                          style={[styles.pkgChip, selectedStart === s && styles.pkgChipOn]}
                          onPress={() => setSelectedStart(s)}
                        >
                          <Text style={styles.pkgLabel}>{formatShort(s)}</Text>
                        </TouchableOpacity>
                      ))}
                      {!slotStarts.length ? <Text style={styles.empty}>No slots available.</Text> : null}
                    </View>
                  )}
                </>
              ) : null}

              <Text style={styles.sectionLabel}>Targeting</Text>
              <Text style={styles.chipGroupLabel}>Sport</Text>
              <View style={styles.rowWrap}>
                {PROMOTE_SPORT_TARGETS.map((t) => (
                  <TouchableOpacity key={t.id} style={[styles.tinyChip, sports.includes(t.id) && styles.tinyChipOn]} onPress={() => toggleChip(sports, t.id, setSports)}>
                    <Text style={styles.tinyText}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.chipGroupLabel}>Geo</Text>
              <View style={styles.rowWrap}>
                {PROMOTE_GEO_TARGETS.map((t) => (
                  <TouchableOpacity key={t.id} style={[styles.tinyChip, geos.includes(t.id) && styles.tinyChipOn]} onPress={() => toggleChip(geos, t.id, setGeos)}>
                    <Text style={styles.tinyText}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.chipGroupLabel}>Interest</Text>
              <View style={styles.rowWrap}>
                {PROMOTE_INTEREST_TARGETS.map((t) => (
                  <TouchableOpacity key={t.id} style={[styles.tinyChip, interests.includes(t.id) && styles.tinyChipOn]} onPress={() => toggleChip(interests, t.id, setInterests)}>
                    <Text style={styles.tinyText}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.sectionLabel}>Note</Text>
              <TextInput
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                placeholder="Optional note for your campaign"
                placeholderTextColor={theme.colors.textMuted}
                maxLength={200}
              />

              <TouchableOpacity style={styles.cta} activeOpacity={0.9} onPress={submitCompose} disabled={busy}>
                {busy ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.ctaText}>Book · {selectedPkg?.coins ?? 0} coins</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <BuyCoinsOverlay visible={buyOpen} onClose={() => setBuyOpen(false)} />
    </View>
  );
}

function createStyles(theme: BlypTheme) {
  const c = theme.colors;
  return StyleSheet.create({
    root: { flex: 1 },
    hero: { borderRadius: 16, padding: 16, marginBottom: 12 },
    heroEyebrow: { color: 'rgba(0,0,0,0.55)', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
    heroTitle: { color: '#0b0b0b', fontSize: 26, fontWeight: '900', marginTop: 4 },
    heroSub: { color: 'rgba(0,0,0,0.65)', fontSize: 13, marginTop: 4 },
    heroCoins: { marginTop: 10, color: '#0b0b0b', fontWeight: '800', fontSize: 14 },
    tabRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: c.backgroundCard, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
    tabBtnOn: { borderColor: c.primary, backgroundColor: c.primary + '22' },
    tabText: { color: c.textSecondary, fontWeight: '700', fontSize: 13 },
    tabTextOn: { color: c.textPrimary },
    catRow: { gap: 8, paddingBottom: 10 },
    catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.backgroundCard, marginRight: 8 },
    catChipOn: { borderColor: c.primary, backgroundColor: c.primary + '22' },
    catText: { color: c.textSecondary, fontWeight: '700', fontSize: 12 },
    catTextOn: { color: c.textPrimary },
    listPad: { paddingBottom: 40, gap: 10 },
    card: { backgroundColor: c.backgroundCard, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border, marginBottom: 10 },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    cardTitle: { color: c.textPrimary, fontSize: 16, fontWeight: '800', flex: 1 },
    cardPrice: { color: c.primary, fontWeight: '800', fontSize: 13 },
    cardSub: { color: c.textSecondary, marginTop: 6, fontSize: 13, lineHeight: 18 },
    cardMeta: { color: c.textMuted, marginTop: 8, fontSize: 11, fontWeight: '600' },
    empty: { color: c.textMuted, textAlign: 'center', marginTop: 24 },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    modalSheet: { maxHeight: '92%', backgroundColor: c.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    modalTitle: { color: c.textPrimary, fontSize: 18, fontWeight: '900' },
    modalClose: { color: c.primary, fontWeight: '700' },
    sectionLabel: { color: c.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 14, marginBottom: 8, textTransform: 'uppercase' },
    rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pkgChip: { borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.backgroundCard, marginBottom: 4 },
    pkgChipOn: { borderColor: c.primary, backgroundColor: c.primary + '22' },
    pkgLabel: { color: c.textPrimary, fontWeight: '700', fontSize: 13 },
    pkgCoins: { color: c.textSecondary, fontSize: 11, marginTop: 2 },
    reach: { color: c.primary, fontWeight: '700', marginTop: 10, fontSize: 13 },
    pickRow: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.backgroundCard, marginBottom: 8 },
    pickRowOn: { borderColor: c.primary, backgroundColor: c.primary + '18' },
    pickTitle: { color: c.textPrimary, fontWeight: '700', fontSize: 14 },
    pickSub: { color: c.textSecondary, fontSize: 12, marginTop: 2 },
    chipGroupLabel: { color: c.textSecondary, fontSize: 12, marginBottom: 6, marginTop: 4 },
    tinyChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.border, marginRight: 6, marginBottom: 6 },
    tinyChipOn: { borderColor: c.primary, backgroundColor: c.primary + '22' },
    tinyText: { color: c.textPrimary, fontSize: 12, fontWeight: '600' },
    noteInput: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, color: c.textPrimary, minHeight: 72, textAlignVertical: 'top', backgroundColor: c.backgroundCard },
    cta: { marginTop: 18, backgroundColor: c.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
    ctaText: { color: '#0b0b0b', fontWeight: '900', fontSize: 15 },
  });
}
