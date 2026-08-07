/**
 * FrenemiesOverlay — polished TikTok-LIVE-style wheel + challenge + throw UI.
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  frenemiesStart,
  frenemiesEnd,
  frenemiesThrow,
  frenemiesQuizAnswer,
  frenemiesGetState,
  MAX_GUEST_SLOTS,
} from '../../api/ivsLiveApi';
import { subscribeToFrenemiesGameEvents } from '../../realtime/frenemiesGameSocket';
import PrizeWheel from './frenemies/PrizeWheel';
import CelebrationBurst from './frenemies/CelebrationBurst';
import TimerRing from './frenemies/TimerRing';

const TEAL = '#00D2BE';
const ROSE = '#FB7185';
const GOLD = '#F5C542';
const GOLD_SOFT = '#FDE68A';
const INK = '#0A0A0C';

function countdownLabel(endsAt) {
  if (!endsAt) return '';
  const ms = Date.parse(endsAt) - Date.now();
  if (!Number.isFinite(ms)) return '';
  return `${Math.max(0, Math.ceil(ms / 1000))}s`;
}

function initialsFor(name) {
  const s = String(name || '').trim().replace(/^@/, '');
  if (!s) return '?';
  return s.slice(0, 1).toUpperCase();
}

function guestLabel(g) {
  if (!g) return null;
  return g.name || g.displayName || g.username || g.handle || null;
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

export default function FrenemiesOverlay({
  sessionId,
  currentUid,
  displayName,
  isAdmin = false,
  isHost = false,
  liveGuests = [],
  controlsVisible = false,
  onClose,
  onBackToPicker,
}) {
  const [event, setEvent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const subRef = useRef(null);
  const tension = useRef(new Animated.Value(0)).current;

  const applyEvent = useCallback(
    (payload) => {
      if (!payload || payload.game !== 'frenemies') return;
      if (payload.sessionId && payload.sessionId !== sessionId) return;
      setEvent(payload);
      setErr(null);
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

  const state = event?.state;
  const phase = state?.phase;
  const active = state?.active && phase && phase !== 'ended' && phase !== 'idle';
  const maxSlots = event?.maxSlots || MAX_GUEST_SLOTS;
  const houseCoins = event?.houseCoins || 25;
  const spinMs = event?.spinMs || 30_000;
  const chooseMs = event?.chooseMs || 20_000;

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
      return guestLabel(g) || fallback || 'Guest';
    },
    [rosterByUser]
  );

  // Spin tension pulse — keeps the wait feeling alive.
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
    try {
      const res = await frenemiesStart(sessionId);
      applyEvent(res);
    } catch (e) {
      setErr(e?.message || e?.code || 'Start failed');
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    setBusy(true);
    try {
      const res = await frenemiesEnd(sessionId);
      applyEvent(res);
      onClose?.();
    } catch (e) {
      setErr(e?.message || e?.code || 'End failed');
    } finally {
      setBusy(false);
    }
  };

  const throwTarget = async (targetUserId) => {
    setBusy(true);
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
  const chooserName = resolveName(state?.chooserUserId, state?.chooserDisplayName);

  void tick;

  const resultCopy = (() => {
    if (!lastResult?.text) return null;
    // Prefer roster names over server "Box N" placeholders when we can.
    let text = String(lastResult.text);
    if (lastResult.kickedUserId) {
      const n = resolveName(lastResult.kickedUserId, null);
      if (n && n !== 'Guest') {
        text = text.replace(/Box\s+\d+/i, n);
      }
    }
    if (lastResult.coinUserId) {
      const n = resolveName(lastResult.coinUserId, null);
      if (n && n !== 'Guest' && /Chooser/i.test(text)) {
        text = text.replace(/Chooser/i, n);
      }
    }
    return text;
  })();

  return (
    <View style={styles.root} pointerEvents="box-none">
      {isAdmin && controlsVisible && !active ? (
        <View style={styles.startCard} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(14,61,56,0.95)', 'rgba(10,10,12,0.96)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.startGrad}
          >
            <Text style={styles.brandKicker} allowFontScaling={false}>
              BLYP
            </Text>
            <Text style={styles.title} allowFontScaling={false}>
              Frenemies
            </Text>
            <Text style={styles.sub} allowFontScaling={false}>
              Spin the prize wheel · throw a guest · win {houseCoins} HOUSE coins
            </Text>
            <TouchableOpacity style={styles.startBtn} onPress={start} disabled={busy} activeOpacity={0.85}>
              {busy ? (
                <ActivityIndicator color={INK} />
              ) : (
                <Text style={styles.startBtnText} allowFontScaling={false}>
                  Start Frenemies
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
            colors={['rgba(10,10,12,0.88)', 'rgba(14,61,56,0.55)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hudInner}
          >
            <View style={styles.hudRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.brandKicker} allowFontScaling={false}>
                  FRENEMIES
                </Text>
                <Text style={styles.hudPhase} allowFontScaling={false}>
                  Round {state.roundIndex || 1}
                  {phase === 'spinning' ? ' · spinning' : ''}
                  {phase === 'choosing' ? ' · throw' : ''}
                  {phase === 'challenge' ? ' · challenge' : ''}
                  {phase === 'resolving' ? ' · result' : ''}
                </Text>
              </View>
              {(isAdmin || isHost) ? (
                <TouchableOpacity style={styles.endBtn} onPress={end} disabled={busy}>
                  <Text style={styles.endBtnText} allowFontScaling={false}>
                    End
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {phase === 'spinning' ? (
              <Animated.View style={[styles.wheelBlock, { transform: [{ scale: tensionScale }] }]}>
                <PrizeWheel
                  size={188}
                  maxSlots={maxSlots}
                  phase={phase}
                  roundId={state.roundId}
                  targetSlot={state.targetSlot}
                  landedSlot={state.landedSlot}
                  spinStartedAt={state.spinStartedAt}
                  spinEndsAt={state.spinEndsAt}
                  occupiedBySlot={occupiedBySlot}
                />
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
                            width: `${Math.round(
                              (1 - spinSecsLeft / spinTotalSecs) * 100
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                </View>
              </Animated.View>
            ) : null}

            {(phase === 'choosing' || phase === 'challenge' || phase === 'resolving') &&
              state.landedSlot ? (
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

            {resultCopy ? (
              <View style={styles.resultBanner}>
                <Text style={styles.resultText} allowFontScaling={false}>
                  {resultCopy}
                </Text>
              </View>
            ) : null}

            {err ? <Text style={styles.err}>{err}</Text> : null}
          </LinearGradient>
        </View>
      ) : null}

      {celebrationKey ? (
        <CelebrationBurst resultKey={celebrationKey} kind={lastResult?.kind} />
      ) : null}

      {showChallenge && challenge ? (
        <View style={styles.overlayCard} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(12,12,14,0.97)', 'rgba(14,61,56,0.9)']}
            style={styles.overlayGrad}
          >
            <Text style={styles.overlayEyebrow} allowFontScaling={false}>
              EMPTY BOX
            </Text>
            <Text style={styles.overlayTitle} allowFontScaling={false}>
              Challenge!
            </Text>

            <View style={styles.timerRow}>
              <TimerRing
                endsAt={challenge.endsAt}
                totalMs={event?.challengeMs || 20_000}
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
            colors={['rgba(12,12,14,0.97)', 'rgba(60,20,28,0.88)']}
            style={styles.overlayGrad}
          >
            <Text style={styles.overlayEyebrow} allowFontScaling={false}>
              {isChooser ? 'YOUR MOVE' : 'CHOOSER'}
            </Text>
            <Text style={styles.overlayTitle} allowFontScaling={false}>
              {isChooser ? 'Throw someone out!' : `${chooserName} is choosing…`}
            </Text>
            <Text style={styles.overlayBody} allowFontScaling={false}>
              {isChooser
                ? `Pick an occupied box. Land the throw in time for ${houseCoins} HOUSE coins.`
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
                  const canThrow = g && g.userId !== currentUid;
                  const name = guestLabel(g) || (g ? 'Guest' : 'Empty');
                  const photo = guestPhoto(g);
                  return (
                    <TouchableOpacity
                      key={n}
                      style={[styles.throwCell, !canThrow && styles.throwEmpty]}
                      disabled={!canThrow || busy}
                      onPress={() => canThrow && throwTarget(g.userId)}
                      activeOpacity={0.85}
                    >
                      {g ? (
                        <Avatar uri={photo} name={name} size={34} ringColor={canThrow ? ROSE : 'rgba(255,255,255,0.25)'} />
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
                        {g ? name : '—'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </LinearGradient>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 55 },
  startCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 72,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.4)',
  },
  startGrad: { padding: 16 },
  brandKicker: {
    color: TEAL,
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 2.2,
  },
  title: {
    color: GOLD_SOFT,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0.3,
    marginTop: 2,
  },
  sub: { color: 'rgba(244,247,250,0.75)', marginTop: 6, marginBottom: 14, fontSize: 13, lineHeight: 18 },
  startBtn: {
    backgroundColor: TEAL,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  startBtnText: { color: INK, fontWeight: '900', fontSize: 15, letterSpacing: 0.2 },
  backChip: { alignSelf: 'center', marginTop: 10, padding: 4 },
  backChipText: { color: 'rgba(255,255,255,0.55)', fontWeight: '700', fontSize: 12 },
  hud: {
    position: 'absolute',
    top: 104,
    left: 10,
    right: 10,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(245,197,66,0.28)',
  },
  hudInner: { padding: 12 },
  hudRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hudPhase: { color: '#fff', fontWeight: '800', fontSize: 15, marginTop: 2 },
  endBtn: {
    backgroundColor: 'rgba(251,113,133,0.22)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.45)',
  },
  endBtnText: { color: ROSE, fontWeight: '800', fontSize: 12 },
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
  err: { color: ROSE, marginTop: 6, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  overlayCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: '24%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.4)',
  },
  overlayGrad: { padding: 16 },
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
  progressText: { color: TEAL, textAlign: 'center', fontWeight: '900', marginBottom: 8, fontSize: 15 },
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
  throwEmpty: {
    opacity: 0.4,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
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
});
