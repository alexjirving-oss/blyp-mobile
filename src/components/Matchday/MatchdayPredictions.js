// MatchdayPredictions
//
// Live predictions engine. Three markets (full-time result, correct score,
// first goalscorer) with BlypCoin stakes pooled pari-mutuel style and settled on
// the final result. v1 has no in-play feed, so predictions resolve at full time
// via settleFromFinalResult (fetched from the free data service).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import {
  getMatchdayPredictions,
  placeMatchdayPrediction,
  makeIdempotencyKey,
} from '../../api/economyLiveApi';
import { getPricing } from '../../services/matchdayEntitlementService';
import { PREDICTION_MARKETS, settleFromFinalResult } from '../../services/matchdayService';
import { logMatchdayEvent } from '../../services/matchdayAnalytics';

const ACCENT = '#19D27C';
const SCORELINES = ['0-0', '1-0', '0-1', '1-1', '2-0', '0-2', '2-1', '1-2', '2-2', '3-1'];

const STATUS_COLORS = { OPEN: COLORS.textSecondary, WON: '#34D399', LOST: '#F87171', REFUNDED: '#E0A341' };

function MarketCard({ def, eventMeta, pool, existing, pricing, locked, onPlace }) {
  const [selection, setSelection] = useState(null);
  const [scorer, setScorer] = useState('');
  const [stake, setStake] = useState(pricing?.predictionMinStake || 5);
  const [busy, setBusy] = useState(false);

  const min = pricing?.predictionMinStake || 5;
  const max = pricing?.predictionMaxStake || 1000;
  const step = min;

  const resultOptions = [
    { key: 'HOME', label: eventMeta?.homeTeam || 'Home' },
    { key: 'DRAW', label: 'Draw' },
    { key: 'AWAY', label: eventMeta?.awayTeam || 'Away' },
  ];

  const effectiveSelection = def.market === 'FIRST_SCORER' ? scorer.trim() : selection;
  const canPlace = !existing && !locked && !!effectiveSelection && !busy;

  const place = async () => {
    if (!canPlace) return;
    setBusy(true);
    try {
      await onPlace(def.market, effectiveSelection, stake);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.market}>
      <View style={styles.marketHeader}>
        <Icon name={def.icon} size={responsiveFont(16)} color={ACCENT} />
        <View style={{ flex: 1 }}>
          <Text style={styles.marketTitle}>{def.title}</Text>
          <Text style={styles.marketSub}>{def.subtitle}</Text>
        </View>
        <View style={styles.poolPill}>
          <Icon name="logo-bitcoin" size={responsiveFont(12)} color="#0A0A0C" />
          <Text style={styles.poolText}>{pool?.poolCoins ?? 0}</Text>
        </View>
      </View>

      {existing ? (
        <View style={styles.existing}>
          <Text style={styles.existingPick} numberOfLines={1}>
            Your pick: <Text style={{ color: COLORS.textPrimary, fontWeight: '800' }}>{existing.selection}</Text> · {existing.stakeCoins} coins
          </Text>
          <View style={styles.statusRow}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[existing.status] || COLORS.textSecondary }]}>
              {existing.status}
            </Text>
            {existing.status === 'WON' && <Text style={styles.payout}>+{existing.payoutCoins} coins</Text>}
            {existing.status === 'REFUNDED' && <Text style={styles.payout}>refunded {existing.payoutCoins}</Text>}
          </View>
        </View>
      ) : (
        <>
          {def.market === 'RESULT' && (
            <View style={styles.chipRow}>
              {resultOptions.map((o) => (
                <TouchableOpacity
                  key={o.key}
                  style={[styles.chip, selection === o.key && styles.chipOn]}
                  onPress={() => setSelection(o.key)}
                >
                  <Text style={[styles.chipText, selection === o.key && styles.chipTextOn]} numberOfLines={1}>
                    {o.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {def.market === 'SCORELINE' && (
            <View style={styles.chipWrap}>
              {SCORELINES.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.scoreChip, selection === s && styles.chipOn]}
                  onPress={() => setSelection(s)}
                >
                  <Text style={[styles.chipText, selection === s && styles.chipTextOn]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {def.market === 'FIRST_SCORER' && (
            <TextInput
              value={scorer}
              onChangeText={setScorer}
              placeholder="Type a player name"
              placeholderTextColor={COLORS.textMuted}
              style={styles.scorerInput}
              maxLength={60}
              autoCorrect={false}
            />
          )}

          {locked ? (
            <Text style={styles.lockedNote}>Predictions are closed for this match.</Text>
          ) : (
            <View style={styles.stakeRow}>
              <View style={styles.stepper}>
                <TouchableOpacity onPress={() => setStake((s) => Math.max(min, s - step))} style={styles.stepBtn}>
                  <Icon name="remove" size={responsiveFont(16)} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.stakeText}>{stake}</Text>
                <TouchableOpacity onPress={() => setStake((s) => Math.min(max, s + step))} style={styles.stepBtn}>
                  <Icon name="add" size={responsiveFont(16)} color={COLORS.textPrimary} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={[styles.placeBtn, !canPlace && styles.placeBtnOff]} onPress={place} disabled={!canPlace}>
                {busy ? (
                  <ActivityIndicator color={COLORS.background} size="small" />
                ) : (
                  <Text style={styles.placeText}>Place · {stake}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
}

export default function MatchdayPredictions({ eventId, eventMeta, teamId, phase, refreshSignal, onBalances }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ predictions: [], pools: [] });
  const [pricing, setPricing] = useState(null);
  const [settling, setSettling] = useState(false);
  const [settleNote, setSettleNote] = useState(null);

  const load = useCallback(async () => {
    try {
      const [preds, price] = await Promise.all([getMatchdayPredictions(eventId), getPricing()]);
      setData(preds);
      setPricing(price);
      setError(null);
    } catch (e) {
      setError(e?.message || 'Could not load predictions.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  const poolByMarket = useMemo(() => {
    const m = {};
    (data.pools || []).forEach((p) => (m[p.market] = p));
    return m;
  }, [data.pools]);

  const predictionByMarket = useMemo(() => {
    const m = {};
    (data.predictions || []).forEach((p) => (m[p.market] = p));
    return m;
  }, [data.predictions]);

  const handlePlace = useCallback(
    async (market, selection, stakeCoins) => {
      try {
        const res = await placeMatchdayPrediction({
          idempotencyKey: makeIdempotencyKey(`matchday-pred:${eventId}:${market}`),
          eventId,
          market,
          selection,
          stakeCoins,
        });
        logMatchdayEvent('prediction_place', { eventId, market, stakeCoins });
        if (res?.newBalances) onBalances?.(res.newBalances);
        await load();
      } catch (e) {
        setError(e?.message || 'Could not place prediction.');
      }
    },
    [eventId, load, onBalances]
  );

  const handleSettle = useCallback(async () => {
    setSettling(true);
    setSettleNote(null);
    const out = await settleFromFinalResult(eventId, teamId);
    setSettling(false);
    if (out.ok) {
      setSettleNote('Settled from the final result.');
      logMatchdayEvent('prediction_settle', { eventId });
      await load();
    } else if (out.reason === 'not-final-yet') {
      setSettleNote('Final result not available yet — try again after full time.');
    } else if (String(out.message || '').includes('RESTRICTED')) {
      // Settlement is ops-gated; untrusted clients can't move balances.
      setSettleNote('Results are confirmed by Blyp shortly after full time — payouts land automatically.');
    } else {
      setSettleNote(out.message || 'Settlement failed.');
    }
  }, [eventId, teamId, load]);

  const hasOpen = (data.predictions || []).some((p) => p.status === 'OPEN');
  const locked = phase === 'ended';

  if (loading) return <ActivityIndicator color={ACCENT} style={{ marginTop: responsiveSize(24) }} />;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.intro}>Back your call with coins. Winners split each market's pool.</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}

      {PREDICTION_MARKETS.map((def) => (
        <MarketCard
          key={def.market}
          def={def}
          eventMeta={eventMeta}
          pool={poolByMarket[def.market]}
          existing={predictionByMarket[def.market]}
          pricing={pricing}
          locked={locked}
          onPlace={handlePlace}
        />
      ))}

      {locked && hasOpen && (
        <TouchableOpacity style={styles.settleBtn} onPress={handleSettle} disabled={settling} activeOpacity={0.85}>
          {settling ? (
            <ActivityIndicator color={COLORS.background} />
          ) : (
            <>
              <Icon name="checkmark-done" size={responsiveFont(17)} color={COLORS.background} />
              <Text style={styles.settleText}>Settle from final result</Text>
            </>
          )}
        </TouchableOpacity>
      )}
      {!!settleNote && <Text style={styles.settleNote}>{settleNote}</Text>}
      <Text style={styles.disclaimer}>
        First goalscorer settles only when goal data is available; otherwise that pool is refunded.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: responsiveSize(14), paddingBottom: responsiveSize(30) },
  intro: { color: COLORS.textSecondary, fontSize: responsiveFont(13), marginBottom: responsiveSize(12) },
  error: { color: '#F87171', fontSize: responsiveFont(13), marginBottom: responsiveSize(10), fontWeight: '600' },
  market: {
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(16),
    padding: responsiveSize(14),
    marginBottom: responsiveSize(12),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  marketHeader: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(10) },
  marketTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '800' },
  marketSub: { color: COLORS.textMuted, fontSize: responsiveFont(11), marginTop: 1 },
  poolPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(4),
    backgroundColor: '#FFD24A',
    paddingHorizontal: responsiveSize(9),
    paddingVertical: responsiveSize(4),
    borderRadius: 999,
  },
  poolText: { color: '#FFFFFF', fontWeight: '900', fontSize: responsiveFont(12) },
  chipRow: { flexDirection: 'row', gap: responsiveSize(8), marginTop: responsiveSize(12) },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: responsiveSize(8), marginTop: responsiveSize(12) },
  chip: {
    flex: 1,
    paddingVertical: responsiveSize(10),
    borderRadius: responsiveSize(10),
    backgroundColor: COLORS.background,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  scoreChip: {
    paddingHorizontal: responsiveSize(14),
    paddingVertical: responsiveSize(9),
    borderRadius: responsiveSize(10),
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '700' },
  chipTextOn: { color: COLORS.background },
  scorerInput: {
    marginTop: responsiveSize(12),
    color: COLORS.textPrimary,
    fontSize: responsiveFont(15),
    backgroundColor: COLORS.background,
    borderRadius: responsiveSize(10),
    paddingHorizontal: responsiveSize(12),
    height: responsiveSize(44),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  stakeRow: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(10), marginTop: responsiveSize(12) },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: responsiveSize(10),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  stepBtn: { paddingHorizontal: responsiveSize(12), paddingVertical: responsiveSize(9) },
  stakeText: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '800', minWidth: responsiveSize(34), textAlign: 'center' },
  placeBtn: {
    flex: 1,
    backgroundColor: ACCENT,
    borderRadius: responsiveSize(10),
    height: responsiveSize(42),
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeBtnOff: { opacity: 0.4 },
  placeText: { color: COLORS.background, fontWeight: '800', fontSize: responsiveFont(14) },
  existing: { marginTop: responsiveSize(10) },
  existingPick: { color: COLORS.textSecondary, fontSize: responsiveFont(13) },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(10), marginTop: responsiveSize(6) },
  statusText: { fontWeight: '800', fontSize: responsiveFont(12), letterSpacing: 0.5 },
  payout: { color: '#34D399', fontWeight: '700', fontSize: responsiveFont(12) },
  lockedNote: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: responsiveSize(10), fontStyle: 'italic' },
  settleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: responsiveSize(8),
    backgroundColor: ACCENT,
    borderRadius: responsiveSize(12),
    height: responsiveSize(48),
    marginTop: responsiveSize(6),
  },
  settleText: { color: COLORS.background, fontWeight: '800', fontSize: responsiveFont(15) },
  settleNote: { color: COLORS.textSecondary, fontSize: responsiveFont(12), textAlign: 'center', marginTop: responsiveSize(10) },
  disclaimer: { color: COLORS.textMuted, fontSize: responsiveFont(11), textAlign: 'center', marginTop: responsiveSize(14), lineHeight: responsiveFont(16) },
});
