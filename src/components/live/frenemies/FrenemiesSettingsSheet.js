/**
 * Host Settings — Tempo / Economy / Challenges (session-scoped).
 *
 * Touch model: backdrop is a separate absoluteFill Pressable; the sheet is a
 * plain View. Nested Pressable(sheet)+stopPropagation was swallowing Switch /
 * chip taps on Android (settings looked "dead").
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const TEAL = '#00D2BE';
const GOLD = '#F5C542';
const GOLD_SOFT = '#FDE68A';
const ROSE = '#FB7185';
const INK = '#0A0A0C';

const SPIN_OPTS = [10, 15, 20, 30];
const CHOOSE_OPTS = [10, 15, 20, 30, 45];
const CHALLENGE_OPTS = [10, 15, 20, 30, 45];
const RESULT_OPTS = [3, 6, 9, 12];
const AUTO_DELAY_OPTS = [1, 2, 3, 5, 10];

function nearestOpt(sec, opts) {
  const n = Math.round(Number(sec) || 0);
  let best = opts[0];
  let bestDiff = Math.abs(n - best);
  for (const o of opts) {
    const d = Math.abs(n - o);
    if (d < bestDiff) {
      best = o;
      bestDiff = d;
    }
  }
  return best;
}

function Chip({ label, active, onPress, disabled }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipOn, disabled && styles.chipDisabled]}
      onPress={onPress}
      activeOpacity={0.85}
      disabled={disabled}
      hitSlop={6}
    >
      <Text style={[styles.chipText, active && styles.chipTextOn]} allowFontScaling={false}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ChipRow({ label, opts, valueSec, onPick, disabled, hint }) {
  const active = nearestOpt(valueSec, opts);
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel} allowFontScaling={false}>
        {label}
      </Text>
      {hint ? (
        <Text style={styles.hint} allowFontScaling={false}>
          {hint}
        </Text>
      ) : null}
      <View style={styles.chipRow}>
        {opts.map((s) => (
          <Chip
            key={s}
            label={`${s}s`}
            active={active === s}
            disabled={disabled}
            onPress={() => !disabled && onPick(s)}
          />
        ))}
      </View>
    </View>
  );
}

function RowToggle({ label, value, onValueChange, hint, disabled }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel} allowFontScaling={false}>
          {label}
        </Text>
        {hint ? (
          <Text style={styles.hint} allowFontScaling={false}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={!!value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: 'rgba(255,255,255,0.18)', true: 'rgba(0,210,190,0.55)' }}
        thumbColor={value ? TEAL : '#ccc'}
      />
    </View>
  );
}

export default function FrenemiesSettingsSheet({
  visible,
  onClose,
  settings,
  isAdminHost = false,
  readOnly = false,
  onSave,
}) {
  const [draft, setDraft] = useState(settings || {});
  const [throwText, setThrowText] = useState(String(settings?.throwCoins ?? 25));
  const [soloText, setSoloText] = useState(String(settings?.soloCoins ?? 25));
  const [likesText, setLikesText] = useState(String(settings?.likesTarget ?? 50));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && settings) {
      setDraft(settings);
      setThrowText(String(settings.throwCoins ?? 25));
      setSoloText(String(settings.soloCoins ?? 25));
      setLikesText(String(settings.likesTarget ?? 50));
    }
  }, [visible, settings]);

  const spinSec = nearestOpt(Math.round((draft.spinMs || 15000) / 1000), SPIN_OPTS);
  const chooseSec = nearestOpt(Math.round((draft.chooseMs || 20000) / 1000), CHOOSE_OPTS);
  const challengeSec = nearestOpt(Math.round((draft.challengeMs || 20000) / 1000), CHALLENGE_OPTS);
  const resultSec = nearestOpt(Math.round((draft.resultMs || 6000) / 1000), RESULT_OPTS);
  const autoDelaySec = nearestOpt(
    Math.round((draft.autoContinueDelayMs || 3000) / 1000),
    AUTO_DELAY_OPTS
  );

  const commitCoins = (field, text) => {
    let n = Math.floor(Number(text));
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (n > 500) n = 500;
    const apply = () => setDraft((d) => ({ ...d, [field]: n }));
    if (n > 100) {
      Alert.alert(
        'High prize amount',
        `Set ${field === 'throwCoins' ? 'throw' : 'solo'} reward to ${n} coins?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Confirm', onPress: apply },
        ]
      );
      return;
    }
    apply();
  };

  const commitLikes = (text) => {
    let n = Math.floor(Number(text));
    if (!Number.isFinite(n)) n = 50;
    n = Math.max(10, Math.min(500, n));
    setLikesText(String(n));
    setDraft((d) => ({ ...d, likesTarget: n }));
  };

  const save = async () => {
    if (readOnly || !onSave) {
      onClose?.();
      return;
    }
    let throwCoins = Math.floor(Number(throwText));
    let soloCoins = Math.floor(Number(soloText));
    let likesTarget = Math.floor(Number(likesText));
    if (!Number.isFinite(throwCoins) || throwCoins < 0) throwCoins = 0;
    if (!Number.isFinite(soloCoins) || soloCoins < 0) soloCoins = 0;
    if (!Number.isFinite(likesTarget)) likesTarget = 50;
    throwCoins = Math.min(500, throwCoins);
    soloCoins = Math.min(500, soloCoins);
    likesTarget = Math.max(10, Math.min(500, likesTarget));

    const finish = async () => {
      setSaving(true);
      try {
        await onSave({
          ...draft,
          // Explicit — never coerce undefined into a truthy auto-continue.
          autoContinue: draft.autoContinue === true,
          throwCoins,
          soloCoins,
          likesTarget,
          spinMs: spinSec * 1000,
          chooseMs: chooseSec * 1000,
          challengeMs: challengeSec * 1000,
          resultMs: resultSec * 1000,
          autoContinueDelayMs: autoDelaySec * 1000,
        });
        onClose?.();
      } catch (e) {
        Alert.alert('Settings', e?.message || e?.code || 'Could not save');
      } finally {
        setSaving(false);
      }
    };

    if (throwCoins > 100 || soloCoins > 100) {
      Alert.alert(
        'Confirm prizes',
        `Throw ${throwCoins} · Solo ${soloCoins}. Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save', onPress: finish },
        ]
      );
      return;
    }
    await finish();
  };

  return (
    <Modal
      visible={!!visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop} pointerEvents="box-none">
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={onClose}
          accessibilityLabel="Dismiss settings"
        />
        <View style={styles.sheet} pointerEvents="auto">
          <LinearGradient
            colors={['#0E3D38', '#0A0A0C', '#1A1520']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.grad}
          >
            <View style={styles.topRow}>
              <View>
                <Text style={styles.kicker} allowFontScaling={false}>
                  HOST
                </Text>
                <Text style={styles.title} allowFontScaling={false}>
                  Settings
                </Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={8}>
                <Text style={styles.closeText} allowFontScaling={false}>
                  Close
                </Text>
              </TouchableOpacity>
            </View>

            {readOnly ? (
              <Text style={styles.readOnly} allowFontScaling={false}>
                View only mid-round — edit on Ready.
              </Text>
            ) : null}

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              <Text style={styles.section} allowFontScaling={false}>
                Tempo
              </Text>
              <ChipRow
                label="Spin duration"
                opts={SPIN_OPTS}
                valueSec={spinSec}
                disabled={readOnly}
                onPick={(s) => setDraft((d) => ({ ...d, spinMs: s * 1000 }))}
              />
              <ChipRow
                label="Choose (throw) window"
                opts={CHOOSE_OPTS}
                valueSec={chooseSec}
                disabled={readOnly}
                onPick={(s) => setDraft((d) => ({ ...d, chooseMs: s * 1000 }))}
              />
              <ChipRow
                label="Challenge duration"
                opts={CHALLENGE_OPTS}
                valueSec={challengeSec}
                disabled={readOnly}
                onPick={(s) => setDraft((d) => ({ ...d, challengeMs: s * 1000 }))}
              />
              <ChipRow
                label="Result display"
                opts={RESULT_OPTS}
                valueSec={resultSec}
                disabled={readOnly}
                onPick={(s) => setDraft((d) => ({ ...d, resultMs: s * 1000 }))}
              />

              <RowToggle
                label="Auto-continue"
                hint="OFF = tap Spin every round (default)"
                value={draft.autoContinue === true}
                disabled={readOnly}
                onValueChange={(v) => !readOnly && setDraft((d) => ({ ...d, autoContinue: v === true }))}
              />
              {draft.autoContinue === true ? (
                <ChipRow
                  label="Auto-continue delay"
                  hint="Pause after result before next spin"
                  opts={AUTO_DELAY_OPTS}
                  valueSec={autoDelaySec}
                  disabled={readOnly}
                  onPick={(s) => setDraft((d) => ({ ...d, autoContinueDelayMs: s * 1000 }))}
                />
              ) : null}

              <Text style={styles.section} allowFontScaling={false}>
                Economy
              </Text>
              <Text style={styles.fieldLabel} allowFontScaling={false}>
                Coins per successful throw
              </Text>
              <TextInput
                style={styles.input}
                value={throwText}
                onChangeText={setThrowText}
                onBlur={() => commitCoins('throwCoins', throwText)}
                keyboardType="number-pad"
                editable={!readOnly}
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
              <Text style={styles.fieldLabel} allowFontScaling={false}>
                Coins per solo challenge win
              </Text>
              <TextInput
                style={styles.input}
                value={soloText}
                onChangeText={setSoloText}
                onBlur={() => commitCoins('soloCoins', soloText)}
                keyboardType="number-pad"
                editable={!readOnly}
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
              <Text style={styles.hint} allowFontScaling={false}>
                Challenge → throw uses throw amount once. Max 500. Confirm above 100.
              </Text>

              {isAdminHost ? (
                <RowToggle
                  label="House pays"
                  hint="Admin only — prizes from House, not your balance"
                  value={draft.housePays === true}
                  disabled={readOnly}
                  onValueChange={(v) => !readOnly && setDraft((d) => ({ ...d, housePays: v === true }))}
                />
              ) : (
                <Text style={styles.hint} allowFontScaling={false}>
                  You pay prizes from your balance (held at Spin).
                </Text>
              )}

              <RowToggle
                label="Show payer badge"
                value={draft.showPayerBadge !== false}
                disabled={readOnly}
                onValueChange={(v) => !readOnly && setDraft((d) => ({ ...d, showPayerBadge: v }))}
              />

              <Text style={styles.section} allowFontScaling={false}>
                Challenges
              </Text>
              <Text style={styles.fieldLabel} allowFontScaling={false}>
                Likes race target
              </Text>
              <TextInput
                style={styles.input}
                value={likesText}
                onChangeText={setLikesText}
                onBlur={() => commitLikes(likesText)}
                keyboardType="number-pad"
                editable={!readOnly}
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
              <Text style={styles.hint} allowFontScaling={false}>
                First to this many likes wins (10–500).
              </Text>
              <RowToggle
                label="Quiz"
                value={draft.challengeQuiz !== false}
                disabled={readOnly}
                onValueChange={(v) => !readOnly && setDraft((d) => ({ ...d, challengeQuiz: v }))}
              />
              <RowToggle
                label="Chat phrase"
                value={draft.challengeChat !== false}
                disabled={readOnly}
                onValueChange={(v) => !readOnly && setDraft((d) => ({ ...d, challengeChat: v }))}
              />
              <RowToggle
                label="Likes race"
                value={draft.challengeLikes !== false}
                disabled={readOnly}
                onValueChange={(v) => !readOnly && setDraft((d) => ({ ...d, challengeLikes: v }))}
              />
            </ScrollView>

            {!readOnly ? (
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={save}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Text style={styles.saveText} allowFontScaling={false}>
                  {saving ? 'Saving…' : 'Save settings'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  sheet: {
    maxHeight: '88%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(245,197,66,0.35)',
    zIndex: 2,
    elevation: 8,
  },
  grad: { padding: 16 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  kicker: { color: GOLD, fontWeight: '900', fontSize: 10, letterSpacing: 2.2 },
  title: { color: GOLD_SOFT, fontWeight: '900', fontSize: 22, marginTop: 2 },
  closeBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  closeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  readOnly: { color: ROSE, fontWeight: '700', fontSize: 12, marginBottom: 8 },
  scroll: { maxHeight: 440 },
  scrollContent: { paddingBottom: 8 },
  section: {
    color: TEAL,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 1.6,
    marginTop: 14,
    marginBottom: 8,
  },
  fieldBlock: { marginBottom: 4 },
  fieldLabel: { color: '#fff', fontWeight: '800', fontSize: 13, marginBottom: 6 },
  hint: { color: 'rgba(244,247,250,0.55)', fontSize: 11, fontWeight: '600', marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  chipOn: { backgroundColor: 'rgba(0,210,190,0.22)', borderColor: TEAL },
  chipDisabled: { opacity: 0.55 },
  chipText: { color: 'rgba(255,255,255,0.7)', fontWeight: '800', fontSize: 13 },
  chipTextOn: { color: TEAL },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,197,66,0.28)',
    borderRadius: 12,
    color: '#fff',
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  saveBtn: {
    marginTop: 12,
    backgroundColor: TEAL,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveText: { color: INK, fontWeight: '900', fontSize: 15 },
});
