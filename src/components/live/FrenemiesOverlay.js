/**
 * FrenemiesOverlay — EA-grade host-conducted live party show.
 * Ready → host Spin → land → challenge|throw → result → Ready.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Animated,
  Easing,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import {
  frenemiesStart,
  frenemiesEnd,
  frenemiesSpin,
  frenemiesThrow,
  frenemiesQuizAnswer,
  frenemiesGetState,
  frenemiesUpdateSettings,
  frenemiesGetPreview,
  frenemiesQueueJoin,
  frenemiesQueueLeave,
  MAX_GUEST_SLOTS,
} from '../../api/ivsLiveApi';
import { subscribeToFrenemiesGameEvents } from '../../realtime/frenemiesGameSocket';
import PrizeWheel from './frenemies/PrizeWheel';
import { pickPublicLabel } from '../../utils/publicLabel';
import CelebrationBurst from './frenemies/CelebrationBurst';
import TimerRing from './frenemies/TimerRing';
import FrenemiesRulesSheet from './frenemies/FrenemiesRulesSheet';
import FrenemiesSettingsSheet from './frenemies/FrenemiesSettingsSheet';
import FrenemiesWheelGlyph from './frenemies/FrenemiesWheelGlyph';
import BuyCoinsOverlay from '../BuyCoinsOverlay';

const TEAL = '#00F5D4';
const ROSE = '#FF2D95';
const GOLD = '#FFE566';
const GOLD_SOFT = '#FFF1A8';
const INK = '#050508';
const RULES_TIP_KEY = '@blyp/frenemies_rules_tip_v1';
const MAGENTA = '#FF2D95';
const ELECTRIC = '#7CFFB2';

function initialsFor(name) {
  const s = String(name || '').trim().replace(/^@/, '');
  if (!s) return '?';
  return s.slice(0, 1).toUpperCase();
}

function guestLabel(g) {
  if (!g) return null;
  return pickPublicLabel(g, { uid: g.userId, fallback: 'Guest' });
}

function guestPhoto(g) {
  if (!g) return null;
  const u = g.photoUrl || g.photoURL || g.avatarUrl || g.avatar || null;
  return typeof u === 'string' && u.trim() ? u.trim() : null;
}

function Avatar({ uri, name, size = 36, ringColor = TEAL }) {
  const r = size / 2;
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{
          width: size,
          height: size,
          borderRadius: r,
          borderWidth: 2,
          borderColor: ringColor,
          backgroundColor: 'rgba(255,255,255,0.08)',
        }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: r,
        backgroundColor: 'rgba(0,210,190,0.22)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: ringColor,
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.38 }} allowFontScaling={false}>
        {initialsFor(name)}
      </Text>
    </View>
  );
}

function LikesProgressBar({ value, target }) {
  const pct = Math.max(0, Math.min(1, (Number(value) || 0) / Math.max(1, Number(target) || 50)));
  return (
    <View style={styles.likesTrack}>
      <LinearGradient
        colors={[TEAL, GOLD]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.likesFill, { width: `${Math.round(pct * 100)}%` }]}
      />
    </View>
  );
}

function RulesChip({ onPress }) {
  return (
    <TouchableOpacity style={styles.rulesChip} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.rulesChipText} allowFontScaling={false}>
        Rules
      </Text>
    </TouchableOpacity>
  );
}

function PayerBadge({ payer, show }) {
  if (!show) return null;
  const house = payer === 'house';
  return (
    <View style={[styles.payerBadge, house ? styles.payerHouse : styles.payerHost]}>
      <Text style={styles.payerText} allowFontScaling={false}>
        {house ? 'House pays' : 'Host pays'}
      </Text>
    </View>
  );
}

export default function FrenemiesOverlay({
  sessionId,
  currentUid,
  displayName,
  isAdmin = false,
  isHost = false,
  liveGuests = [],
  controlsVisible = false,
  navigation = null,
  onClose,
  onBackToPicker,
}) {
  const [event, setEvent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [spinCue, setSpinCue] = useState(false);
  const [landFlash, setLandFlash] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [endRecap, setEndRecap] = useState(null);
  const [preview, setPreview] = useState(null);
  const [showRulesTip, setShowRulesTip] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const subRef = useRef(null);
  const spinCueWindowRef = useRef(null);
  const tension = useRef(new Animated.Value(0)).current;
  const landAnim = useRef(new Animated.Value(0)).current;
  const prevPhaseRef = useRef(null);

  const applyEvent = useCallback(
    (payload) => {
      if (!payload || payload.game !== 'frenemies') return;
      if (payload.sessionId && payload.sessionId !== sessionId) return;
      setEvent(payload);
      setErr(null);
      if (payload.type === 'ENDED') {
        setEndRecap(payload.stats || payload.state?.lastResult ? payload.stats : null);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await frenemiesGetState(sessionId);
        if (!cancelled && snap) applyEvent(snap);
      } catch {
        // no active game
      }
      try {
        const sub = await subscribeToFrenemiesGameEvents(sessionId, (p) => {
          if (!cancelled) applyEvent(p);
        });
        if (cancelled) sub.close();
        else subRef.current = sub;
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Socket failed');
      }
    })();
    return () => {
      cancelled = true;
      try {
        subRef.current?.close?.();
      } catch {
        /* ignore */
      }
      subRef.current = null;
    };
  }, [sessionId, applyEvent]);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);

  // First-open tip once per account: Rules are always reachable.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(RULES_TIP_KEY);
        if (!cancelled && !seen) setShowRulesTip(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissRulesTip = useCallback(async () => {
    setShowRulesTip(false);
    try {
      await AsyncStorage.setItem(RULES_TIP_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  const openRules = useCallback(() => {
    void dismissRulesTip();
    setRulesOpen(true);
  }, [dismissRulesTip]);

  const state = event?.state;
  const phase = state?.phase;
  const settings = event?.settings || {};
  const stats = event?.stats || {};
  const active = state?.active && phase && phase !== 'ended' && phase !== 'idle';
  const maxSlots = event?.maxSlots || MAX_GUEST_SLOTS;
  const throwCoins = event?.throwCoins ?? settings.throwCoins ?? event?.houseCoins ?? 25;
  const soloCoins = event?.soloCoins ?? settings.soloCoins ?? 25;
  const spinMs = event?.spinMs || settings.spinMs || 15_000;
  const chooseMs = event?.chooseMs || settings.chooseMs || 20_000;
  const payer = state?.payer || (settings.housePays ? 'house' : 'host');
  const showPayer = settings.showPayerBadge !== false;
  const prizePreview = state?.prizePreview ?? Math.max(throwCoins, soloCoins);
  const canConduct = isHost || isAdmin;

  const occupiedBySlot = useMemo(() => {
    const map = {};
    (liveGuests || []).forEach((g) => {
      if (g?.userId && typeof g.slotIndex === 'number') {
        map[g.slotIndex] = g;
      }
    });
    return map;
  }, [liveGuests]);

  const rosterByUser = useMemo(() => {
    const map = {};
    (liveGuests || []).forEach((g) => {
      if (g?.userId) map[g.userId] = g;
    });
    return map;
  }, [liveGuests]);

  const resolveName = useCallback(
    (userId, fallback) => {
      const g = userId ? rosterByUser[userId] : null;
      return (
        guestLabel(g) ||
        pickPublicLabel({ displayName: fallback }, { uid: userId, fallback: 'Guest' })
      );
    },
    [rosterByUser]
  );

  // Refresh host prize preview on Ready.
  useEffect(() => {
    if (!active || phase !== 'ready' || !canConduct) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const p = await frenemiesGetPreview(sessionId);
        if (!cancelled) setPreview(p);
      } catch {
        if (!cancelled) setPreview(null);
      }
    };
    void load();
    const t = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [active, phase, canConduct, sessionId, settings.throwCoins, settings.soloCoins, settings.housePays]);

  // Land sting when leaving spinning.
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (prev === 'spinning' && phase && phase !== 'spinning' && state?.landedSlot) {
      const label = state.landedOccupied
        ? `Box ${state.landedSlot} — ${resolveName(state.chooserUserId, state.chooserDisplayName)}`
        : `Box ${state.landedSlot} — EMPTY · CHALLENGE`;
      setLandFlash(label);
      landAnim.setValue(0);
      Animated.sequence([
        Animated.timing(landAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(landAnim, { toValue: 0.92, duration: 220, useNativeDriver: true }),
        Animated.delay(900),
        Animated.timing(landAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start(() => setLandFlash(null));
    }
  }, [phase, state?.landedSlot, state?.landedOccupied, state?.chooserUserId, landAnim, resolveName]);

  useEffect(() => {
    if (phase !== 'spinning') {
      tension.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(tension, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(tension, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, state?.roundId, tension]);

  const start = async () => {
    setBusy(true);
    setErr(null);
    setEndRecap(null);
    try {
      const res = await frenemiesStart(sessionId);
      applyEvent(res);
    } catch (e) {
      setErr(e?.message || e?.code || 'Open failed');
    } finally {
      setBusy(false);
    }
  };

  const openTopUp = useCallback(() => {
    setTopUpOpen(true);
  }, []);

  const doSpin = async () => {
    if (spinCue || busy) return;
    const needed = preview?.needed ?? prizePreview;
    const hostFunded = payer === 'host' && needed > 0;
    if (hostFunded && preview && !preview.canSpin) {
      setErr(`You need ${needed} coins to cover prizes.`);
      Alert.alert('Insufficient coins', `You need ${needed} coins to cover prizes.`, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Top up', onPress: openTopUp },
      ]);
      return;
    }

    const run = async () => {
      const cueStart = Date.now();
      spinCueWindowRef.current = {
        start: new Date(cueStart).toISOString(),
        end: new Date(cueStart + 1200).toISOString(),
      };
      setSpinCue(true);
      setErr(null);
      // 1.2s lock-in cue before server spin.
      await new Promise((r) => setTimeout(r, 1200));
      setBusy(true);
      try {
        const res = await frenemiesSpin(sessionId);
        applyEvent(res);
      } catch (e) {
        const code = String(e?.code || e?.message || '');
        if (/INSUFFICIENT/i.test(code)) {
          const need = e?.needed || needed;
          setErr(`You need ${need} coins to cover prizes.`);
          Alert.alert('Insufficient coins', `You need ${need} coins to cover prizes.`, [
            { text: 'Not now', style: 'cancel' },
            { text: 'Top up', onPress: openTopUp },
          ]);
        } else {
          setErr(e?.message || e?.code || 'Spin failed');
        }
      } finally {
        setBusy(false);
        setSpinCue(false);
        spinCueWindowRef.current = null;
      }
    };

    if (hostFunded) {
      Alert.alert(
        'Spin Frenemies',
        `This spin reserves up to ${needed} coins from your balance.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Spin', onPress: () => void run() },
        ]
      );
      return;
    }
    await run();
  };

  const end = () => {
    Alert.alert('End Frenemies?', 'Show recap, then close the stage.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End show',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const res = await frenemiesEnd(sessionId);
            applyEvent(res);
            setEndRecap(res.stats || null);
          } catch (e) {
            setErr(e?.message || e?.code || 'End failed');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const throwTarget = async (targetUserId) => {
    setBusy(true);
    setConfirmTarget(null);
    try {
      const res = await frenemiesThrow(sessionId, targetUserId);
      applyEvent(res);
    } catch (e) {
      setErr(e?.message || e?.code || 'Throw failed');
    } finally {
      setBusy(false);
    }
  };

  const answerQuiz = async (choiceIndex) => {
    setBusy(true);
    try {
      const res = await frenemiesQuizAnswer(sessionId, choiceIndex, displayName);
      applyEvent(res);
    } catch (e) {
      const code = String(e?.code || e?.message || '');
      if (/FROZEN/i.test(code)) setErr('Wrong — you’re frozen for this challenge.');
      else setErr(e?.message || e?.code || 'Answer failed');
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (patch) => {
    const res = await frenemiesUpdateSettings(sessionId, patch);
    applyEvent(res);
  };

  const isChooser = state?.chooserUserId && state.chooserUserId === currentUid;
  const challenge = state?.challenge;
  const frozen = (challenge?.frozenUserIds || []).includes(currentUid);
  const showChooserOverlay = phase === 'choosing' && (isChooser || isHost || isAdmin);
  const showChallenge = phase === 'challenge';
  const lastResult = state?.lastResult;
  const celebrationKey =
    lastResult && (phase === 'resolving' || event?.type === 'RESULT')
      ? `${state.roundId}:${lastResult.kind}:${lastResult.text}`
      : null;

  const spinSecsLeft = state?.spinEndsAt
    ? Math.max(0, Math.ceil((Date.parse(state.spinEndsAt) - Date.now()) / 1000))
    : 0;
  const spinTotalSecs = Math.max(1, Math.round(spinMs / 1000));
  const tensionScale = tension.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const landScale = landAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.06] });
  const chooserName = resolveName(state?.chooserUserId, state?.chooserDisplayName);
  const settingsLocked = phase !== 'ready' && phase !== 'idle' && !!active;
  const isAdminHost = !!(isAdmin || event?.isAdminHost);

  const toggleAutoContinue = async () => {
    if (!canConduct) return;
    if (settingsLocked) {
      setSettingsOpen(true);
      return;
    }
    const next = !(settings.autoContinue === true);
    setBusy(true);
    try {
      await saveSettings({ ...settings, autoContinue: next });
    } catch (e) {
      setErr(e?.message || e?.code || 'Could not update auto-continue');
    } finally {
      setBusy(false);
    }
  };

  void tick;

  const resultCopy = (() => {
    if (!lastResult?.text) return null;
    let text = String(lastResult.text);
    if (lastResult.kickedUserId) {
      const n = resolveName(lastResult.kickedUserId, null);
      if (n && n !== 'Guest') text = text.replace(/Box\s+\d+/i, n);
    }
    if (lastResult.coinUserId) {
      const n = resolveName(lastResult.coinUserId, null);
      if (n && n !== 'Guest' && /Chooser/i.test(text)) text = text.replace(/Chooser/i, n);
    }
    return text;
  })();

  const phaseLabel = (() => {
    if (phase === 'ready') return 'Ready';
    if (phase === 'spinning') return spinCue ? 'Locking in…' : 'Spinning';
    if (phase === 'choosing') return 'Throw';
    if (phase === 'challenge') return 'Challenge';
    if (phase === 'resolving') return 'Result';
    return phase || '';
  })();

  const needsTopUp =
    canConduct && payer === 'host' && preview && !preview.canSpin && (preview.needed || 0) > 0;

  const joinQueue = Array.isArray(event?.queue) ? event.queue : [];
  const seatMeta = event?.seatMeta || {};
  const isSeated = !!(currentUid && rosterByUser[currentUid]);
  const myQueuePos = joinQueue.find((q) => q.userId === currentUid)?.position || null;

  const joinFrenemiesQueue = useCallback(async () => {
    if (!sessionId || !currentUid || busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await frenemiesQueueJoin(sessionId, {
        displayName: displayName || 'Guest',
        source: 'cta',
      });
      if (res) setEvent(res);
    } catch (e) {
      const code = e?.code || e?.error;
      if (code === 'DROP_COOLDOWN') {
        setErr('Just dropped — sit out one full round before rejoining.');
      } else if (code === 'ALREADY_SEATED') {
        setErr('You are already on stage.');
      } else if (code === 'ALREADY_QUEUED') {
        setErr('You are already in the queue.');
      } else {
        setErr(e?.message || 'Could not join queue');
      }
    } finally {
      setBusy(false);
    }
  }, [sessionId, currentUid, busy, displayName]);

  const leaveFrenemiesQueue = useCallback(async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      const res = await frenemiesQueueLeave(sessionId);
      if (res) setEvent(res);
    } catch {
      /* best-effort */
    } finally {
      setBusy(false);
    }
  }, [sessionId, busy]);

  const topBar = (
    <View>
      <View style={styles.hudRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brandKicker} allowFontScaling={false}>
            FRENEMIES
          </Text>
          <Text style={styles.hudPhase} allowFontScaling={false}>
            {phase === 'ready' ? 'On air' : `Round ${state?.roundIndex || 1}`}
            {phaseLabel ? ` · ${phaseLabel}` : ''}
          </Text>
        </View>
        <View style={styles.topActions}>
          <View>
            <RulesChip onPress={openRules} />
            {showRulesTip ? (
              <TouchableOpacity style={styles.rulesTip} onPress={openRules} activeOpacity={0.9}>
                <Text style={styles.rulesTipText} allowFontScaling={false}>
                  Rules anytime →
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {canConduct ? (
            <TouchableOpacity
              style={styles.gearChip}
              onPress={() => setSettingsOpen(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.gearText} allowFontScaling={false}>
                Settings
              </Text>
            </TouchableOpacity>
          ) : null}
          {canConduct ? (
            <TouchableOpacity style={styles.endBtn} onPress={end} disabled={busy}>
              <Text style={styles.endBtnText} allowFontScaling={false}>
                End
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.root} pointerEvents="box-none">
      {(canConduct && controlsVisible && !active && !endRecap) ? (
        <View style={styles.startCard} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(42,10,36,0.98)', 'rgba(6,42,40,0.96)', 'rgba(5,5,8,0.99)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.startGrad}
          >
            <View style={styles.openBrandRow}>
              <View style={styles.hubGlyphWrap}>
                <FrenemiesWheelGlyph size={72} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.brandKicker} allowFontScaling={false}>
                  BLYP LIVE · PARTY
                </Text>
                <Text style={styles.title} allowFontScaling={false}>
                  Frenemies
                </Text>
                <Text style={styles.titleTag} allowFontScaling={false}>
                  neon wheel · host-run
                </Text>
              </View>
              <View>
                <RulesChip onPress={openRules} />
                {showRulesTip ? (
                  <TouchableOpacity style={styles.rulesTip} onPress={openRules} activeOpacity={0.9}>
                    <Text style={styles.rulesTipText} allowFontScaling={false}>
                      Rules anytime →
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
            <Text style={styles.sub} allowFontScaling={false}>
              Host-conducted prize wheel · throw a frenemy · room challenges on empty boxes
            </Text>
            <TouchableOpacity style={styles.startBtn} onPress={start} disabled={busy} activeOpacity={0.85}>
              {busy ? (
                <ActivityIndicator color={INK} />
              ) : (
                <Text style={styles.startBtnText} allowFontScaling={false}>
                  Open Frenemies
                </Text>
              )}
            </TouchableOpacity>
            {typeof (onBackToPicker || onClose) === 'function' ? (
              <TouchableOpacity onPress={onBackToPicker || onClose} style={styles.backChip}>
                <Text style={styles.backChipText} allowFontScaling={false}>
                  Back to games
                </Text>
              </TouchableOpacity>
            ) : null}
            {err ? <Text style={styles.err}>{err}</Text> : null}
          </LinearGradient>
        </View>
      ) : null}

      {active ? (
        <View style={styles.hud} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(42,10,36,0.94)', 'rgba(6,42,40,0.72)', 'rgba(5,5,8,0.55)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hudInner}
          >
            {topBar}

            <View style={styles.scoreStrip}>
              <Text style={styles.scoreItem} allowFontScaling={false}>
                Rounds {stats.rounds || state?.roundIndex || 0}
              </Text>
              <Text style={styles.scoreDot}>·</Text>
              <Text style={styles.scoreItem} allowFontScaling={false}>
                Prize {prizePreview}
              </Text>
              <Text style={styles.scoreDot}>·</Text>
              <PayerBadge payer={payer} show={showPayer} />
              <Text style={styles.scoreDot}>·</Text>
              {canConduct ? (
                <TouchableOpacity
                  onPress={toggleAutoContinue}
                  disabled={busy}
                  hitSlop={8}
                  style={[
                    styles.autoChip,
                    settings.autoContinue === true ? styles.autoOnChip : styles.autoOffChip,
                  ]}
                >
                  <Text
                    style={[
                      styles.scoreItem,
                      settings.autoContinue === true ? styles.autoOn : styles.autoOff,
                    ]}
                    allowFontScaling={false}
                  >
                    Auto {settings.autoContinue === true ? 'ON' : 'OFF'} · tap
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text
                  style={[
                    styles.scoreItem,
                    settings.autoContinue === true ? styles.autoOn : styles.autoOff,
                  ]}
                  allowFontScaling={false}
                >
                  Auto {settings.autoContinue === true ? 'ON' : 'OFF'}
                </Text>
              )}
            </View>

            {(phase === 'ready' || spinCue) ? (
              <View style={styles.readyBlock}>
                <View style={styles.stageFrame}>
                  <PrizeWheel
                    size={196}
                    maxSlots={maxSlots}
                    phase={spinCue ? 'spinning' : 'ready'}
                    roundId={state?.roundId || 'ready'}
                    targetSlot={1}
                    landedSlot={null}
                    spinStartedAt={spinCue ? spinCueWindowRef.current?.start || null : null}
                    spinEndsAt={spinCue ? spinCueWindowRef.current?.end || null : null}
                    occupiedBySlot={occupiedBySlot}
                  />
                </View>
                <Text style={styles.readyTitle} allowFontScaling={false}>
                  {spinCue ? 'Here we go…' : 'Ready when you are'}
                </Text>
                <Text style={styles.readyHint} allowFontScaling={false}>
                  {payer === 'house'
                    ? `House covers up to ${prizePreview} coins`
                    : preview && !preview.canSpin
                      ? `Need ${preview.needed} coins to cover prizes`
                      : `Up to ${prizePreview} coins reserved at Spin`}
                </Text>
                {canConduct && !spinCue ? (
                  needsTopUp ? (
                    <TouchableOpacity
                      style={styles.topUpBtn}
                      onPress={openTopUp}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.topUpBtnText} allowFontScaling={false}>
                        Top up · need {preview.needed}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.spinBtn}
                      onPress={doSpin}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      {busy ? (
                        <ActivityIndicator color={INK} />
                      ) : (
                        <Text style={styles.spinBtnText} allowFontScaling={false}>
                          Spin · {spinTotalSecs}s
                        </Text>
                      )}
                    </TouchableOpacity>
                  )
                ) : null}
                {!canConduct ? (
                  <View style={styles.queueViewerBlock}>
                    {isSeated ? (
                      <Text style={styles.readyHint} allowFontScaling={false}>
                        You are on stage · first spin is protected until your box hits
                      </Text>
                    ) : myQueuePos ? (
                      <>
                        <Text style={styles.readyHint} allowFontScaling={false}>
                          In queue · #{myQueuePos} — fair fill after each round
                        </Text>
                        <TouchableOpacity
                          style={styles.queueLeaveBtn}
                          onPress={leaveFrenemiesQueue}
                          disabled={busy}
                        >
                          <Text style={styles.queueLeaveText} allowFontScaling={false}>
                            Leave queue
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity
                        style={styles.queueJoinBtn}
                        onPress={joinFrenemiesQueue}
                        disabled={busy}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.queueJoinText} allowFontScaling={false}>
                          Request to join · queue
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}
                {canConduct && joinQueue.length ? (
                  <View style={styles.queueHostBlock}>
                    <Text style={styles.queueHostTitle} allowFontScaling={false}>
                      Queue · {joinQueue.length}
                    </Text>
                    {joinQueue.slice(0, 5).map((q) => (
                      <Text key={q.userId} style={styles.queueHostRow} numberOfLines={1} allowFontScaling={false}>
                        #{q.position} {q.displayName || 'Guest'}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {phase === 'spinning' && !spinCue ? (
              <Animated.View style={[styles.wheelBlock, { transform: [{ scale: tensionScale }] }]}>
                <View style={styles.stageFrame}>
                  <PrizeWheel
                    size={210}
                    maxSlots={maxSlots}
                    phase={phase}
                    roundId={state.roundId}
                    targetSlot={state.targetSlot}
                    landedSlot={state.landedSlot}
                    spinStartedAt={state.spinStartedAt}
                    spinEndsAt={state.spinEndsAt}
                    occupiedBySlot={occupiedBySlot}
                  />
                </View>
                <View style={styles.spinMeta}>
                  <TimerRing
                    endsAt={state.spinEndsAt}
                    totalMs={spinMs}
                    size={64}
                    stroke={5}
                    label="LEFT"
                    tone={spinSecsLeft <= 5 ? 'rose' : 'gold'}
                    nowTick={tick}
                  />
                  <View style={styles.spinCopy}>
                    <Text style={styles.spinTitle} allowFontScaling={false}>
                      {spinSecsLeft <= 5 ? 'Landing…' : 'Who’s next?'}
                    </Text>
                    <Text style={styles.spinHint} allowFontScaling={false}>
                      {spinSecsLeft}s of {spinTotalSecs}s · boxes 1–{maxSlots}
                    </Text>
                    <View style={styles.tensionBar}>
                      <View
                        style={[
                          styles.tensionFill,
                          {
                            width: `${Math.round((1 - spinSecsLeft / spinTotalSecs) * 100)}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                </View>
              </Animated.View>
            ) : null}

            {(phase === 'choosing' || phase === 'challenge' || phase === 'resolving') &&
            state.landedSlot &&
            !landFlash ? (
              <Text style={styles.landText} allowFontScaling={false}>
                Landed on box {state.landedSlot}
                {state.landedOccupied
                  ? ` · ${resolveName(
                      Object.values(occupiedBySlot).find((g) => g.slotIndex === state.landedSlot)
                        ?.userId || state.chooserUserId,
                      chooserName
                    )}`
                  : ' · empty box challenge'}
              </Text>
            ) : null}

            {resultCopy && (phase === 'resolving' || phase === 'ready') ? (
              <View style={styles.resultBanner}>
                <Text style={styles.resultText} allowFontScaling={false}>
                  {resultCopy}
                </Text>
                {lastResult?.coins > 0 && lastResult?.payer ? (
                  <Text style={styles.ledgerChip} allowFontScaling={false}>
                    {lastResult.coins} BONUS · {lastResult.payer === 'house' ? 'House' : 'Host'}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {err ? <Text style={styles.err}>{err}</Text> : null}
          </LinearGradient>
        </View>
      ) : null}

      {landFlash ? (
        <Animated.View
          style={[styles.landSlam, { opacity: landAnim, transform: [{ scale: landScale }] }]}
          pointerEvents="none"
        >
          <LinearGradient colors={['rgba(245,197,66,0.95)', 'rgba(0,210,190,0.9)']} style={styles.landSlamInner}>
            <Text style={styles.landSlamKicker} allowFontScaling={false}>
              LAND
            </Text>
            <Text style={styles.landSlamText} allowFontScaling={false}>
              {landFlash}
            </Text>
          </LinearGradient>
        </Animated.View>
      ) : null}

      {celebrationKey ? (
        <CelebrationBurst resultKey={celebrationKey} kind={lastResult?.kind} />
      ) : null}

      {showChallenge && challenge ? (
        <View style={styles.overlayCard} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(12,12,14,0.97)', 'rgba(14,61,56,0.92)', 'rgba(26,21,32,0.9)']}
            style={styles.overlayGrad}
          >
            <View style={styles.overlayTop}>
              <Text style={styles.overlayEyebrow} allowFontScaling={false}>
                EMPTY BOX · {(challenge.type || '').toUpperCase()}
              </Text>
              <RulesChip onPress={openRules} />
            </View>
            <Text style={styles.overlayTitle} allowFontScaling={false}>
              Challenge!
            </Text>
            <View style={styles.timerRow}>
              <TimerRing
                endsAt={challenge.endsAt}
                totalMs={event?.challengeMs || settings.challengeMs || 20_000}
                size={70}
                tone="teal"
                label="SEC"
                nowTick={tick}
              />
            </View>

            {challenge.type === 'quiz' ? (
              <>
                <View style={styles.quizCard}>
                  <Text style={styles.quizQ} allowFontScaling={false}>
                    {challenge.question}
                  </Text>
                </View>
                {(challenge.choices || []).map((c, idx) => (
                  <TouchableOpacity
                    key={`${idx}-${c}`}
                    style={[styles.choiceBtn, frozen && styles.choiceDisabled]}
                    disabled={busy || frozen}
                    onPress={() => answerQuiz(idx)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.choiceLetter}>
                      <Text style={styles.choiceLetterText} allowFontScaling={false}>
                        {String.fromCharCode(65 + idx)}
                      </Text>
                    </View>
                    <Text style={styles.choiceText} allowFontScaling={false}>
                      {c}
                    </Text>
                  </TouchableOpacity>
                ))}
                {frozen ? (
                  <Text style={styles.err} allowFontScaling={false}>
                    Frozen — wrong answer this round
                  </Text>
                ) : null}
              </>
            ) : null}

            {challenge.type === 'chat' ? (
              <View style={styles.quizCard}>
                <Text style={styles.overlayBody} allowFontScaling={false}>
                  First to type this in live chat wins:
                </Text>
                <Text style={styles.phrase} allowFontScaling={false}>
                  “{challenge.phrase}”
                </Text>
              </View>
            ) : null}

            {challenge.type === 'likes' ? (
              <View style={styles.quizCard}>
                <Text style={styles.overlayBody} allowFontScaling={false}>
                  Spam likes — first to {challenge.likesTarget || 50} wins!
                </Text>
                <Text style={styles.progressText} allowFontScaling={false}>
                  You · {challenge.likeProgress?.[currentUid] || 0} / {challenge.likesTarget || 50}
                </Text>
                <LikesProgressBar
                  value={challenge.likeProgress?.[currentUid] || 0}
                  target={challenge.likesTarget || 50}
                />
              </View>
            ) : null}
          </LinearGradient>
        </View>
      ) : null}

      {showChooserOverlay ? (
        <View style={styles.overlayCard} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(12,12,14,0.97)', 'rgba(60,20,28,0.9)', 'rgba(14,61,56,0.55)']}
            style={styles.overlayGrad}
          >
            <View style={styles.overlayTop}>
              <Text style={styles.overlayEyebrow} allowFontScaling={false}>
                {isChooser ? 'YOUR MOVE' : 'CHOOSER'}
              </Text>
              <RulesChip onPress={openRules} />
            </View>
            <Text style={styles.overlayTitle} allowFontScaling={false}>
              {isChooser ? 'Throw someone out!' : `${chooserName} is choosing…`}
            </Text>
            <Text style={styles.overlayBody} allowFontScaling={false}>
              {isChooser
                ? `Confirm a target. Land the throw for ${throwCoins} coins.`
                : 'Waiting for the chooser to pick a target…'}
            </Text>
            <View style={styles.timerRow}>
              <TimerRing
                endsAt={state.chooseEndsAt}
                totalMs={chooseMs}
                size={70}
                tone="rose"
                label="THROW"
                nowTick={tick}
              />
            </View>
            {isChooser ? (
              <View style={styles.throwGrid}>
                {Array.from({ length: maxSlots }, (_, i) => {
                  const n = i + 1;
                  const g = occupiedBySlot[n];
                  const protectedSeat = !!(g?.userId && seatMeta[g.userId]?.protected);
                  const canThrow = g && g.userId !== currentUid && !protectedSeat;
                  const name = guestLabel(g) || (g ? 'Guest' : 'Empty');
                  const photo = guestPhoto(g);
                  return (
                    <TouchableOpacity
                      key={n}
                      style={[
                        styles.throwCell,
                        !canThrow && styles.throwEmpty,
                        canThrow && styles.throwDanger,
                        protectedSeat && styles.throwProtected,
                      ]}
                      disabled={!canThrow || busy}
                      onPress={() => canThrow && setConfirmTarget({ userId: g.userId, name, slot: n })}
                      activeOpacity={0.85}
                    >
                      {g ? (
                        <Avatar
                          uri={photo}
                          name={name}
                          size={34}
                          ringColor={canThrow ? ROSE : 'rgba(255,255,255,0.25)'}
                        />
                      ) : (
                        <View style={styles.emptyDot}>
                          <Text style={styles.throwNum} allowFontScaling={false}>
                            {n}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.throwSlot} allowFontScaling={false}>
                        Box {n}
                      </Text>
                      <Text style={styles.throwName} numberOfLines={1} allowFontScaling={false}>
                        {g ? (protectedSeat ? `${name} · safe` : name) : '—'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </LinearGradient>
        </View>
      ) : null}

      {/* Throw confirm */}
      <Modal visible={!!confirmTarget} transparent animationType="fade">
        <Pressable style={styles.confirmBackdrop} onPress={() => setConfirmTarget(null)}>
          <Pressable style={styles.confirmCard} onPress={(e) => e.stopPropagation()}>
            <LinearGradient colors={['#3C141C', '#0A0A0C']} style={styles.confirmGrad}>
              <Text style={styles.overlayEyebrow} allowFontScaling={false}>
                CONFIRM THROW
              </Text>
              <Text style={styles.overlayTitle} allowFontScaling={false}>
                Throw {confirmTarget?.name}?
              </Text>
              <Text style={styles.overlayBody} allowFontScaling={false}>
                Box {confirmTarget?.slot} leaves the stage. You earn {throwCoins} coins if it lands.
              </Text>
              <View style={styles.confirmRow}>
                <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmTarget(null)}>
                  <Text style={styles.confirmCancelText} allowFontScaling={false}>
                    Back
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmGo}
                  onPress={() => confirmTarget && throwTarget(confirmTarget.userId)}
                  disabled={busy}
                >
                  <Text style={styles.confirmGoText} allowFontScaling={false}>
                    Throw
                  </Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </Pressable>
        </Pressable>
      </Modal>

      {/* End recap */}
      <Modal visible={!!endRecap && !active} transparent animationType="fade">
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <LinearGradient colors={['#0E3D38', '#0A0A0C']} style={styles.confirmGrad}>
              <Text style={styles.overlayEyebrow} allowFontScaling={false}>
                SHOW OVER
              </Text>
              <Text style={styles.overlayTitle} allowFontScaling={false}>
                Frenemies recap
              </Text>
              <Text style={styles.overlayBody} allowFontScaling={false}>
                Rounds {endRecap?.rounds || 0} · Throws {endRecap?.throws || 0} · Coins out{' '}
                {endRecap?.coinsAwarded || 0}
              </Text>
              {(endRecap?.topWinners || []).slice(0, 3).map((w) => (
                <Text key={w.userId} style={styles.recapWinner} allowFontScaling={false}>
                  {w.displayName} · {w.coins}
                </Text>
              ))}
              <TouchableOpacity
                style={styles.spinBtn}
                onPress={() => {
                  setEndRecap(null);
                  onClose?.();
                }}
              >
                <Text style={styles.spinBtnText} allowFontScaling={false}>
                  Close
                </Text>
              </TouchableOpacity>
              <RulesChip onPress={openRules} />
            </LinearGradient>
          </View>
        </View>
      </Modal>

      <FrenemiesRulesSheet
        visible={rulesOpen}
        onClose={() => setRulesOpen(false)}
        throwCoins={throwCoins}
        soloCoins={soloCoins}
        payer={payer}
        isHost={canConduct}
        autoContinue={!!settings.autoContinue}
        spinSec={spinTotalSecs}
      />

      <FrenemiesSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        isAdminHost={isAdminHost}
        readOnly={settingsLocked}
        onSave={saveSettings}
      />

      <BuyCoinsOverlay
        visible={topUpOpen}
        onClose={() => {
          setTopUpOpen(false);
          if (canConduct && phase === 'ready') {
            void frenemiesGetPreview(sessionId)
              .then((p) => setPreview(p))
              .catch(() => {});
          }
        }}
        requiredCoins={preview?.needed || prizePreview || 0}
        currentCoins={preview?.balance || 0}
        title="Top up for Frenemies"
        navigation={navigation}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 220 },
  startCard: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 72,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,45,149,0.65)',
  },
  startGrad: { padding: 16 },
  openBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hubGlyphWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(255,45,149,0.18)',
    borderWidth: 2,
    borderColor: MAGENTA,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelGlyph: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(245,197,66,0.2)',
    borderWidth: 2,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelGlyphText: { color: GOLD_SOFT, fontWeight: '900', fontSize: 18 },
  brandKicker: {
    color: ELECTRIC,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 2.4,
  },
  title: {
    color: GOLD_SOFT,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 0.3,
    marginTop: 2,
  },
  titleTag: {
    color: MAGENTA,
    fontWeight: '800',
    fontSize: 12,
    marginTop: 2,
    letterSpacing: 0.4,
  },
  sub: {
    color: 'rgba(244,247,250,0.8)',
    marginTop: 10,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 18,
  },
  startBtn: {
    backgroundColor: MAGENTA,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  startBtnText: { color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 0.2 },
  backChip: { alignSelf: 'center', marginTop: 10, padding: 4 },
  backChipText: { color: 'rgba(255,255,255,0.55)', fontWeight: '700', fontSize: 12 },
  hud: {
    position: 'absolute',
    top: 104,
    left: 10,
    right: 10,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,45,149,0.45)',
  },
  hudInner: { padding: 12 },
  hudRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hudPhase: { color: '#fff', fontWeight: '800', fontSize: 15, marginTop: 2 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rulesChip: {
    backgroundColor: 'rgba(0,210,190,0.16)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.45)',
  },
  rulesChipText: { color: TEAL, fontWeight: '900', fontSize: 11, letterSpacing: 0.3 },
  rulesTip: {
    position: 'absolute',
    top: 30,
    right: 0,
    backgroundColor: GOLD,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    minWidth: 110,
    zIndex: 2,
  },
  rulesTipText: { color: INK, fontWeight: '900', fontSize: 10 },
  topUpBtn: {
    marginTop: 10,
    backgroundColor: GOLD,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  topUpBtnText: { color: INK, fontWeight: '900', fontSize: 15 },
  gearChip: {
    backgroundColor: 'rgba(245,197,66,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,197,66,0.4)',
  },
  gearText: { color: GOLD_SOFT, fontWeight: '800', fontSize: 11 },
  endBtn: {
    backgroundColor: 'rgba(251,113,133,0.22)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.45)',
  },
  endBtnText: { color: ROSE, fontWeight: '800', fontSize: 11 },
  scoreStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  scoreItem: { color: 'rgba(244,247,250,0.7)', fontWeight: '800', fontSize: 11 },
  scoreDot: { color: 'rgba(255,255,255,0.3)' },
  payerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  payerHost: {
    backgroundColor: 'rgba(245,197,66,0.12)',
    borderColor: 'rgba(245,197,66,0.4)',
  },
  payerHouse: {
    backgroundColor: 'rgba(0,210,190,0.14)',
    borderColor: 'rgba(0,210,190,0.45)',
  },
  payerText: { color: GOLD_SOFT, fontWeight: '900', fontSize: 10, letterSpacing: 0.4 },
  readyBlock: { alignItems: 'center', marginTop: 6 },
  stageFrame: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'rgba(255,45,149,0.55)',
    backgroundColor: 'rgba(42,10,36,0.55)',
    marginBottom: 4,
  },
  autoOn: { color: MAGENTA },
  autoOff: { color: ELECTRIC },
  autoChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  autoOnChip: {
    backgroundColor: 'rgba(255,45,149,0.18)',
    borderColor: 'rgba(255,45,149,0.55)',
  },
  autoOffChip: {
    backgroundColor: 'rgba(124,255,178,0.12)',
    borderColor: 'rgba(124,255,178,0.45)',
  },
  readyTitle: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 18,
    marginTop: 8,
    letterSpacing: 0.2,
  },
  readyHint: {
    color: 'rgba(244,247,250,0.7)',
    fontWeight: '700',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  spinBtn: {
    marginTop: 12,
    backgroundColor: GOLD,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 28,
    alignItems: 'center',
    minWidth: 180,
  },
  spinBtnDisabled: { opacity: 0.4 },
  spinBtnText: { color: INK, fontWeight: '900', fontSize: 16, letterSpacing: 0.3 },
  wheelBlock: { alignItems: 'center', marginTop: 8 },
  spinMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    width: '100%',
    paddingHorizontal: 4,
  },
  spinCopy: { flex: 1 },
  spinTitle: { color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 0.2 },
  spinHint: { color: 'rgba(244,247,250,0.7)', marginTop: 2, fontWeight: '700', fontSize: 12 },
  tensionBar: {
    marginTop: 8,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  tensionFill: { height: '100%', backgroundColor: GOLD, borderRadius: 3 },
  landText: {
    color: GOLD_SOFT,
    marginTop: 10,
    fontWeight: '800',
    textAlign: 'center',
    fontSize: 14,
  },
  landSlam: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '38%',
    zIndex: 80,
  },
  landSlamInner: {
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(10,10,12,0.35)',
  },
  landSlamKicker: {
    color: INK,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 2.4,
    textAlign: 'center',
  },
  landSlamText: {
    color: INK,
    fontWeight: '900',
    fontSize: 18,
    textAlign: 'center',
    marginTop: 4,
  },
  resultBanner: {
    marginTop: 8,
    backgroundColor: 'rgba(0,210,190,0.14)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
  },
  resultText: { color: TEAL, fontWeight: '800', textAlign: 'center', fontSize: 13, lineHeight: 18 },
  ledgerChip: {
    color: GOLD_SOFT,
    fontWeight: '900',
    textAlign: 'center',
    fontSize: 11,
    marginTop: 4,
  },
  err: { color: ROSE, marginTop: 6, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  overlayCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: '22%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.4)',
  },
  overlayGrad: { padding: 16 },
  overlayTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  overlayEyebrow: {
    color: GOLD,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 2.4,
    textAlign: 'center',
  },
  overlayTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 4,
    letterSpacing: 0.2,
  },
  overlayBody: {
    color: 'rgba(244,247,250,0.82)',
    marginTop: 8,
    marginBottom: 4,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  timerRow: { alignItems: 'center', marginVertical: 10 },
  quizCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,197,66,0.22)',
  },
  quizQ: { color: '#fff', fontWeight: '800', fontSize: 16, textAlign: 'center', lineHeight: 22 },
  choiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,210,190,0.1)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
    gap: 10,
  },
  choiceDisabled: { opacity: 0.4 },
  choiceLetter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceLetterText: { color: INK, fontWeight: '900', fontSize: 13 },
  choiceText: { color: '#fff', fontWeight: '700', flex: 1, fontSize: 14 },
  phrase: {
    color: GOLD_SOFT,
    fontWeight: '900',
    fontSize: 22,
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: 0.4,
  },
  progressText: {
    color: TEAL,
    textAlign: 'center',
    fontWeight: '900',
    marginBottom: 8,
    fontSize: 15,
  },
  likesTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  likesFill: { height: '100%', borderRadius: 5 },
  throwGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  throwCell: {
    width: '30%',
    backgroundColor: 'rgba(251,113,133,0.16)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: ROSE,
    alignItems: 'center',
    gap: 4,
  },
  throwDanger: {
    shadowColor: ROSE,
    shadowOpacity: 0.45,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  throwProtected: {
    borderColor: 'rgba(0,245,212,0.55)',
    backgroundColor: 'rgba(0,245,212,0.12)',
  },
  throwEmpty: {
    opacity: 0.4,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  queueViewerBlock: { marginTop: 10, alignItems: 'center', gap: 8 },
  queueJoinBtn: {
    backgroundColor: TEAL,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    minWidth: 220,
    alignItems: 'center',
  },
  queueJoinText: { color: INK, fontWeight: '900', fontSize: 14 },
  queueLeaveBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  queueLeaveText: { color: 'rgba(255,255,255,0.75)', fontWeight: '800', fontSize: 12 },
  queueHostBlock: {
    marginTop: 10,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  queueHostTitle: { color: GOLD_SOFT, fontWeight: '900', fontSize: 12, letterSpacing: 0.4 },
  queueHostRow: { color: 'rgba(255,255,255,0.82)', fontWeight: '700', fontSize: 12 },
  emptyDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  throwNum: { color: GOLD_SOFT, fontWeight: '900', fontSize: 14 },
  throwSlot: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '800' },
  throwName: { color: '#fff', fontSize: 11, fontWeight: '700', maxWidth: 80, textAlign: 'center' },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  confirmCard: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.45)',
  },
  confirmGrad: { padding: 18 },
  confirmRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  confirmCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  confirmCancelText: { color: '#fff', fontWeight: '800' },
  confirmGo: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: ROSE,
  },
  confirmGoText: { color: '#fff', fontWeight: '900' },
  recapWinner: {
    color: GOLD_SOFT,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 4,
    fontSize: 13,
  },
});
