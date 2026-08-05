// CreateBattleScreen — prearrange a head-to-head battle vs a competitor.
//
// Pick an opponent, set the datetime, optionally put down an equal forfeit stake
// (attendance bond), confirm, and both sides are notified. Submitting writes the
// invite; the opponent gets a push. Creator also gets a 10-min reminder.

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView,
  Image, ActivityIndicator, Switch, Alert,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import {
  searchUsers, getUserProfile, createBattle, STAKE_PRESETS, DEFAULT_DURATION_SEC,
} from '../services/battleService';

// Quick scheduling presets (label -> function returning epoch ms).
const SCHEDULE_PRESETS = [
  { key: '15m', label: 'In 15 min', ms: () => Date.now() + 15 * 60 * 1000 },
  { key: '1h', label: 'In 1 hour', ms: () => Date.now() + 60 * 60 * 1000 },
  { key: 'tonight', label: 'Tonight 8pm', ms: () => atHour(0, 20) },
  { key: 'tomorrow', label: 'Tomorrow 8pm', ms: () => atHour(1, 20) },
];

function atHour(daysAhead, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function whenLabel(ms) {
  try {
    const d = new Date(ms);
    return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function Avatar({ uri, name, size = 44 }) {
  if (uri) return <Image source={{ uri }} style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]} />;
  return (
    <View style={[styles.avatar, styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.avatarInitial}>{String(name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const CreateBattleScreen = ({ navigation, route }) => {
  const { uid } = useAuth();
  // The Blyp bar ("arrange a battle between me and X for Friday 8") can deep-link
  // here with the opponent and/or start time already resolved.
  const prefill = route?.params || {};
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [opponent, setOpponent] = useState(prefill.opponent || null);
  const [title, setTitle] = useState(prefill.prefillTitle || '');
  const [startAt, setStartAt] = useState(() => {
    const t = Number(prefill.startAt);
    return Number.isFinite(t) && t > Date.now() ? t : atHour(0, 20);
  });
  const [stakeCoins, setStakeCoins] = useState(
    Number.isFinite(Number(prefill.stakeCoins)) ? Math.max(0, Math.round(Number(prefill.stakeCoins))) : 0
  );
  const [notifySupporters, setNotifySupporters] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef(null);

  const runSearch = useCallback((text) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const rows = await searchUsers(text, uid, 20);
      setResults(rows);
      setSearching(false);
    }, 280);
  }, [uid]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const nudgeDay = useCallback((delta) => {
    setStartAt((v) => {
      const d = new Date(v);
      d.setDate(d.getDate() + delta);
      const next = d.getTime();
      return next > Date.now() + 60000 ? next : Date.now() + 15 * 60 * 1000;
    });
  }, []);

  const nudgeHour = useCallback((delta) => {
    setStartAt((v) => {
      const next = v + delta * 60 * 60 * 1000;
      return next > Date.now() + 60000 ? next : Date.now() + 15 * 60 * 1000;
    });
  }, []);

  const submit = useCallback(async () => {
    if (!opponent) {
      Alert.alert('Pick an opponent', 'Choose who you want to battle first.');
      return;
    }
    if (startAt <= Date.now()) {
      Alert.alert('Pick a time', 'The battle start time must be in the future.');
      return;
    }
    setSubmitting(true);
    try {
      const creator = (await getUserProfile(uid)) || { id: uid, displayName: 'You', username: '', photoURL: '' };
      const res = await createBattle(creator, opponent, {
        title: title.trim(),
        scheduledStartAt: startAt,
        stakeCoins,
        durationSec: DEFAULT_DURATION_SEC,
        notifySupporters,
      });
      if (!res.ok) {
        const msg =
          res.reason === 'insufficient_funds'
            ? 'You do not have enough coins for that forfeit stake.'
            : res.reason === 'self'
              ? 'You cannot challenge yourself.'
              : res.reason === 'missing_participants'
                ? 'Pick an opponent and try again.'
                : res.reason === 'unavailable'
                  ? 'Battles are temporarily unavailable. Check your connection and sign-in, then try again.'
                  : res.reason === 'write_failed'
                    ? 'Could not save the battle (cloud permissions). Please try again in a moment.'
                    : res.reason === 'deposit_failed'
                      ? 'Could not place the forfeit stake. Check your coin balance and try again.'
                      : 'Could not create the battle. Please try again.';
        Alert.alert('Battle not created', msg);
        setSubmitting(false);
        return;
      }
      navigation.replace ? navigation.replace('BattleDetail', { battleId: res.id }) : navigation.navigate('BattleDetail', { battleId: res.id });
    } catch (e) {
      console.warn('[CreateBattle] submit failed', e?.message || e);
      Alert.alert('Battle not created', 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }, [opponent, startAt, title, stakeCoins, notifySupporters, uid, navigation]);

  return (
    <ScreenContainer>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Prearrange battle</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.heroSub}>
          Challenge someone at a set time. Optional forfeit stake — both put coins down; show up to get them back.
        </Text>

        <Text style={styles.label}>1. Opponent</Text>
        {opponent ? (
          <View style={styles.selectedOpponent}>
            <Avatar uri={opponent.photoURL} name={opponent.displayName} />
            <View style={{ flex: 1, marginLeft: responsiveSize(12) }}>
              <Text style={styles.selName}>{opponent.displayName}</Text>
              {!!opponent.username && <Text style={styles.selUsername}>@{opponent.username}</Text>}
            </View>
            <TouchableOpacity onPress={() => { setOpponent(null); setQuery(''); setResults([]); }}>
              <Icon name="close-circle" size={responsiveFont(22)} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.searchBox}>
              <Icon name="search" size={responsiveFont(16)} color={COLORS.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search people…"
                placeholderTextColor={COLORS.textSecondary}
                value={query}
                onChangeText={runSearch}
                autoCapitalize="none"
              />
              {searching && <ActivityIndicator size="small" color={COLORS.primary} />}
            </View>
            {results.map((u) => (
              <TouchableOpacity key={u.id} style={styles.resultRow} onPress={() => { setOpponent(u); setResults([]); }}>
                <Avatar uri={u.photoURL} name={u.displayName} size={36} />
                <View style={{ flex: 1, marginLeft: responsiveSize(10) }}>
                  <Text style={styles.selName}>{u.displayName}</Text>
                  {!!u.username && <Text style={styles.selUsername}>@{u.username}</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        <Text style={styles.label}>2. Title (optional)</Text>
        <TextInput
          style={styles.textInput}
          placeholder="e.g. Sing-off, FIFA showdown…"
          placeholderTextColor={COLORS.textSecondary}
          value={title}
          onChangeText={setTitle}
          maxLength={60}
        />

        <Text style={styles.label}>3. When</Text>
        <View style={styles.chipRow}>
          {SCHEDULE_PRESETS.map((p) => {
            const v = p.ms();
            const active = Math.abs(v - startAt) < 60 * 1000;
            return (
              <TouchableOpacity key={p.key} style={[styles.chip, active && styles.chipActive]} onPress={() => setStartAt(p.ms())}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.whenCard}>
          <Text style={styles.whenLabel}>{whenLabel(startAt)}</Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => nudgeDay(-1)}>
              <Text style={styles.stepBtnText}>−1d</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stepBtn} onPress={() => nudgeHour(-1)}>
              <Text style={styles.stepBtnText}>−1h</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setStartAt((v) => Math.max(Date.now() + 60000, v - 15 * 60 * 1000))}>
              <Text style={styles.stepBtnText}>−15m</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setStartAt((v) => v + 15 * 60 * 1000)}>
              <Text style={styles.stepBtnText}>+15m</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stepBtn} onPress={() => nudgeHour(1)}>
              <Text style={styles.stepBtnText}>+1h</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stepBtn} onPress={() => nudgeDay(1)}>
              <Text style={styles.stepBtnText}>+1d</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.label}>4. Forfeit stake</Text>
        <Text style={styles.helpText}>
          Both put down the same coins. Turn up and you get them back. If only one shows, they take the pot. If nobody shows, the app keeps it. Paid in coins, never gems.
        </Text>
        <View style={styles.chipRow}>
          {STAKE_PRESETS.map((s) => {
            const active = stakeCoins === s;
            return (
              <TouchableOpacity key={s} style={[styles.chip, active && styles.chipActive]} onPress={() => setStakeCoins(s)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{s === 0 ? 'Free' : `${s} coins`}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Notify my supporters</Text>
            <Text style={styles.helpText}>After they accept, followers get a heads-up.</Text>
          </View>
          <Switch
            value={notifySupporters}
            onValueChange={setNotifySupporters}
            trackColor={{ true: COLORS.primary, false: '#3a3a40' }}
            thumbColor="#fff"
          />
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, (!opponent || submitting) && styles.submitBtnDisabled]}
          onPress={submit}
          disabled={!opponent || submitting}
          activeOpacity={0.9}
        >
          {submitting ? (
            <ActivityIndicator color="#0A0A0C" />
          ) : (
            <Text style={styles.submitText}>
              {stakeCoins > 0 ? `Send challenge · ${stakeCoins} coins` : 'Send challenge'}
            </Text>
          )}
        </TouchableOpacity>
        <Text style={styles.footerHint}>Opponent is notified instantly. You’ll get a reminder 10 minutes before start.</Text>
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 4, paddingTop: responsiveSize(8) },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  content: { padding: responsiveSize(16), paddingBottom: responsiveSize(60) },
  heroSub: { color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(18), marginBottom: responsiveSize(4) },
  label: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(14), marginTop: responsiveSize(18), marginBottom: responsiveSize(8) },
  toggleLabel: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(14), marginBottom: responsiveSize(4) },
  helpText: { color: COLORS.textSecondary, fontSize: responsiveFont(12), lineHeight: responsiveFont(17), marginBottom: responsiveSize(10) },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: responsiveSize(8),
    backgroundColor: COLORS.backgroundCard, borderRadius: responsiveSize(12),
    paddingHorizontal: responsiveSize(12), paddingVertical: responsiveSize(10),
  },
  searchInput: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(14) },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: responsiveSize(10) },
  selectedOpponent: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.backgroundCard, borderRadius: responsiveSize(12), padding: responsiveSize(12),
    borderWidth: 1, borderColor: 'rgba(0,210,190,0.35)',
  },
  selName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(14) },
  selUsername: { color: COLORS.textSecondary, fontSize: responsiveFont(12) },
  avatar: { backgroundColor: '#222' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(18) },
  textInput: {
    backgroundColor: COLORS.backgroundCard, borderRadius: responsiveSize(12),
    paddingHorizontal: responsiveSize(12), paddingVertical: responsiveSize(12),
    color: COLORS.textPrimary, fontSize: responsiveFont(14),
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: responsiveSize(8) },
  chip: {
    backgroundColor: COLORS.backgroundCard, borderRadius: responsiveSize(20),
    paddingVertical: responsiveSize(8), paddingHorizontal: responsiveSize(14),
    borderWidth: 1, borderColor: 'transparent',
  },
  chipActive: { borderColor: COLORS.primary, backgroundColor: 'rgba(0,210,190,0.12)' },
  chipText: { color: COLORS.textSecondary, fontSize: responsiveFont(13), fontWeight: '600' },
  chipTextActive: { color: COLORS.primary },
  whenCard: {
    marginTop: responsiveSize(12),
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(12),
    padding: responsiveSize(12),
  },
  stepperRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: responsiveSize(6), marginTop: responsiveSize(10) },
  stepBtn: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: responsiveSize(10), paddingVertical: responsiveSize(8), paddingHorizontal: responsiveSize(10) },
  stepBtnText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(12) },
  whenLabel: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '800', textAlign: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: responsiveSize(16) },
  submitBtn: {
    backgroundColor: COLORS.primary, borderRadius: responsiveSize(14),
    paddingVertical: responsiveSize(15), alignItems: 'center', marginTop: responsiveSize(28),
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { color: '#0A0A0C', fontWeight: '800', fontSize: responsiveFont(15) },
  footerHint: { color: COLORS.textSecondary, fontSize: responsiveFont(11), textAlign: 'center', marginTop: responsiveSize(10), opacity: 0.8 },
});

export default CreateBattleScreen;
