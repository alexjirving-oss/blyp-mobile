/**
 * Reaction Duel — two-player, server-authoritative live skill overlay.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  reactionDuelEnd,
  reactionDuelGetState,
  reactionDuelHeartbeat,
  reactionDuelLock,
  reactionDuelStart,
  reactionDuelTap,
} from '../../api/ivsLiveApi';
import { subscribeToReactionDuelEvents } from '../../realtime/reactionDuelGameSocket';
import { pickPublicLabel } from '../../utils/publicLabel';

const CYAN = '#22D3EE';
const ROSE = '#FB7185';
const GOLD = '#FACC15';
const INK = '#09090B';
const DEFAULT_STAKE_PRESETS = [50, 100, 250, 500];
const DEFAULT_MIN_STAKE = 25;
const DEFAULT_MAX_STAKE = 5000;
const SHAPE_GLYPH = {
  circle: '●',
  square: '■',
  triangle: '▲',
  star: '★',
};

function publicName(value, userId, fallback) {
  return pickPublicLabel(
    { displayName: value },
    { uid: userId, fallback },
  );
}

function guestName(guest) {
  return pickPublicLabel(guest, {
    uid: guest?.userId,
    fallback: 'Guest',
  });
}

function friendlyError(error) {
  const message = String(error?.code || error?.message || error || '');
  if (/INSUFFICIENT_FUNDS|requires \d+ coins|not enough coins/i.test(message)) {
    const required = String(error?.message || '').match(/requires (\d+) coins/i)?.[1];
    return required
      ? `You need ${required} coins to lock your entry.`
      : 'You do not have enough coins to lock this stake.';
  }
  if (/INVALID_STAKE|stake must/i.test(message)) {
    return 'Choose a whole-coin stake within the allowed range.';
  }
  if (/IMPOSSIBLE_TAP/i.test(message)) {
    return 'That tap arrived impossibly fast. Wait for the prompt to appear.';
  }
  if (/TOO_LATE|STALE_PROMPT/i.test(message)) {
    return 'Too late — the round has moved on.';
  }
  if (/OPPONENT_NOT_ON_STAGE/i.test(message)) {
    return 'That guest is no longer live on stage.';
  }
  if (/ALREADY_TAPPED/i.test(message)) {
    return 'You already tapped this round.';
  }
  return error?.message || error?.code || 'Something went wrong.';
}

export default function ReactionDuelOverlay({
  sessionId,
  currentUid,
  currentDisplayName,
  hostDisplayName,
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
  const [selectedOpponent, setSelectedOpponent] = useState(null);
  const [stakeText, setStakeText] = useState('100');
  const [customStakeActive, setCustomStakeActive] = useState(false);
  const [dismissedDuelId, setDismissedDuelId] = useState(null);
  const [submittedPromptId, setSubmittedPromptId] = useState(null);
  const [tick, setTick] = useState(0);
  const subRef = useRef(null);
  const serverOffsetRef = useRef(0);

  const applyEvent = useCallback(
    (payload) => {
      if (!payload || payload.game !== 'reaction-duel') return;
      if (payload.sessionId && payload.sessionId !== sessionId) return;
      if (payload.serverNow) {
        const serverNow = Date.parse(payload.serverNow);
        if (Number.isFinite(serverNow)) {
          serverOffsetRef.current = serverNow - Date.now();
        }
      }
      setEvent((previous) => {
        if (
          previous?.version != null &&
          payload?.version != null &&
          previous.version > payload.version
        ) {
          return previous;
        }
        return payload;
      });
      setErr(null);
    },
    [sessionId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await reactionDuelGetState(sessionId);
        if (!cancelled && snapshot) applyEvent(snapshot);
      } catch {
        // No duel exists yet.
      }
      try {
        const subscription = await subscribeToReactionDuelEvents(
          sessionId,
          (payload) => {
            if (!cancelled) applyEvent(payload);
          }
        );
        if (cancelled) subscription.close();
        else subRef.current = subscription;
      } catch (error) {
        if (!cancelled) setErr(friendlyError(error));
      }
    })();
    return () => {
      cancelled = true;
      try {
        subRef.current?.close?.();
      } catch {
        // Best-effort socket cleanup.
      }
      subRef.current = null;
    };
  }, [sessionId, applyEvent]);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 100);
    return () => clearInterval(timer);
  }, []);

  const eligibleGuests = useMemo(
    () =>
      (liveGuests || []).filter(
        (guest) =>
          guest?.userId &&
          guest.userId !== event?.hostUserId &&
          guest.userId !== currentUid
      ),
    [liveGuests, event?.hostUserId, currentUid]
  );

  useEffect(() => {
    if (
      selectedOpponent &&
      eligibleGuests.some((guest) => guest.userId === selectedOpponent)
    ) {
      return;
    }
    setSelectedOpponent(eligibleGuests[0]?.userId || null);
  }, [eligibleGuests, selectedOpponent]);

  const state = event?.state;
  const phase = state?.phase;
  const terminal = phase === 'ended' || phase === 'refunded';
  const terminalDismissed =
    !!terminal && !!state?.duelId && dismissedDuelId === state.duelId;
  const active = !!state?.active && !terminal;
  const players = state?.players || [];
  const me = players.find((player) => player.userId === currentUid);
  const prompt = state?.prompt;
  const entryCoins = event?.rules?.entryCoins || state?.stakeCoins || 100;
  const prizeCoins = event?.rules?.prizeCoins || state?.prizeCoins || entryCoins * 3;
  const stakePresets = event?.rules?.stakePresets || DEFAULT_STAKE_PRESETS;
  const minStakeCoins = event?.rules?.minStakeCoins || DEFAULT_MIN_STAKE;
  const maxStakeCoins = event?.rules?.maxStakeCoins || DEFAULT_MAX_STAKE;
  const selectedStake = Number(stakeText);
  const stakeValid =
    Number.isInteger(selectedStake) &&
    selectedStake >= minStakeCoins &&
    selectedStake <= maxStakeCoins;
  const selectedPrize = stakeValid ? selectedStake * 3 : 0;

  useEffect(() => {
    if (!active || !me || !sessionId) return undefined;
    let cancelled = false;
    const beat = async () => {
      try {
        await reactionDuelHeartbeat(sessionId);
      } catch (error) {
        if (!cancelled) {
          console.warn('[REACTION_DUEL][HEARTBEAT]', error?.message || String(error));
        }
      }
    };
    void beat();
    const timer = setInterval(() => void beat(), 4_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, me?.userId, sessionId]);

  const start = async () => {
    const opponent = eligibleGuests.find(
      (guest) => guest.userId === selectedOpponent
    );
    if (!opponent) {
      setErr('Choose a live guest before starting.');
      return;
    }
    if (!stakeValid) {
      setErr(
        `Stake must be a whole number from ${minStakeCoins} to ${maxStakeCoins} coins.`
      );
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const response = await reactionDuelStart(
        sessionId,
        opponent.userId,
        {
          stakeCoins: selectedStake,
          hostDisplayName: publicName(
            hostDisplayName || (isHost ? currentDisplayName : ''),
            event?.hostUserId,
            'Host'
          ),
          opponentDisplayName: guestName(opponent),
        }
      );
      applyEvent(response);
    } catch (error) {
      setErr(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const lockEntry = async () => {
    setBusy(true);
    setErr(null);
    try {
      applyEvent(await reactionDuelLock(sessionId));
    } catch (error) {
      setErr(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const tapTarget = async (targetId) => {
    if (!prompt?.promptId) return;
    setBusy(true);
    setErr(null);
    try {
      const response = await reactionDuelTap(
        sessionId,
        prompt.promptId,
        targetId
      );
      setSubmittedPromptId(prompt.promptId);
      applyEvent(response);
    } catch (error) {
      setErr(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    setBusy(true);
    setErr(null);
    try {
      applyEvent(await reactionDuelEnd(sessionId));
    } catch (error) {
      setErr(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const nowMs = Date.now() + serverOffsetRef.current;
  const visibleAtMs = prompt?.visibleAt ? Date.parse(prompt.visibleAt) : 0;
  const endsAtMs = prompt?.endsAt ? Date.parse(prompt.endsAt) : 0;
  const promptReady =
    !!prompt?.revealed &&
    !!prompt?.cue &&
    (prompt?.targets || []).length === 4 &&
    Number.isFinite(visibleAtMs) &&
    nowMs >= visibleAtMs;
  const countdownMs = prompt ? Math.max(0, visibleAtMs - nowMs) : 0;
  const promptMsLeft = prompt ? Math.max(0, endsAtMs - nowMs) : 0;
  const canTap =
    !!me?.locked &&
    phase === 'prompt' &&
    promptReady &&
    submittedPromptId !== prompt?.promptId &&
    !busy;
  const isShapePrompt =
    prompt?.kind === 'shape_color' || (!prompt?.kind && !!prompt?.cue?.shape);
  const selectedGuest = eligibleGuests.find(
    (guest) => guest.userId === selectedOpponent
  );
  const dismissTerminal = useCallback(() => {
    if (state?.duelId) setDismissedDuelId(state.duelId);
    setErr(null);
    (onClose || onBackToPicker)?.();
  }, [state?.duelId, onBackToPicker, onClose]);

  void tick;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {terminal && !terminalDismissed ? (
        <Pressable
          style={styles.terminalBackdrop}
          onPress={dismissTerminal}
          accessibilityRole="button"
          accessibilityLabel="Dismiss Reaction Duel result"
        />
      ) : null}

      {(isHost || isAdmin) &&
      controlsVisible &&
      !active &&
      (!terminal || terminalDismissed) ? (
        <View style={styles.startCard}>
          <LinearGradient
            colors={['rgba(8,47,73,0.97)', 'rgba(9,9,11,0.98)']}
            style={styles.startGradient}
          >
            <Text style={styles.eyebrow} allowFontScaling={false}>
              REACTION DUEL
            </Text>
            <Text style={styles.startTitle} allowFontScaling={false}>
              Quick thinking. Same prompt.
            </Text>
            <Text style={styles.startCopy} allowFontScaling={false}>
              Pick one shared stake. Winner prize is always 3× · best of five.
            </Text>

            <Text style={styles.chooseLabel} allowFontScaling={false}>
              Choose stake
            </Text>
            <View style={styles.stakeRow}>
              {stakePresets.map((stake) => {
                const selected = !customStakeActive && selectedStake === stake;
                return (
                  <TouchableOpacity
                    key={stake}
                    style={[styles.stakeChip, selected && styles.stakeChipSelected]}
                    onPress={() => {
                      setStakeText(String(stake));
                      setCustomStakeActive(false);
                    }}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel={`${stake} coin stake`}
                  >
                    <Text
                      style={[
                        styles.stakeChipText,
                        selected && styles.stakeChipTextSelected,
                      ]}
                      allowFontScaling={false}
                    >
                      {stake}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              value={customStakeActive ? stakeText : ''}
              onFocus={() => {
                setCustomStakeActive(true);
                if (!customStakeActive) setStakeText('');
              }}
              onChangeText={(value) => {
                setCustomStakeActive(true);
                setStakeText(value.replace(/[^0-9]/g, ''));
              }}
              placeholder={`Custom (${minStakeCoins}–${maxStakeCoins})`}
              placeholderTextColor="rgba(255,255,255,0.42)"
              keyboardType="number-pad"
              maxLength={5}
              style={[
                styles.customStakeInput,
                customStakeActive && styles.customStakeInputActive,
                customStakeActive && !stakeValid && styles.customStakeInputInvalid,
              ]}
              accessibilityLabel="Custom Reaction Duel coin stake"
            />
            <Text style={styles.stakePreview} allowFontScaling={false}>
              {stakeValid
                ? `${selectedPrize} coins in this live → ${selectedPrize} gems when live ends`
                : `Enter a whole amount from ${minStakeCoins} to ${maxStakeCoins}`}
            </Text>

            {eligibleGuests.length ? (
              <>
                <Text style={styles.chooseLabel} allowFontScaling={false}>
                  Choose an on-stage guest
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.guestRow}
                >
                  {eligibleGuests.map((guest) => {
                    const selected = guest.userId === selectedOpponent;
                    return (
                      <TouchableOpacity
                        key={guest.userId}
                        style={[styles.guestChip, selected && styles.guestChipSelected]}
                        onPress={() => setSelectedOpponent(guest.userId)}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[styles.guestChipText, selected && styles.guestChipTextSelected]}
                          numberOfLines={1}
                          allowFontScaling={false}
                        >
                          {guestName(guest)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            ) : (
              <Text style={styles.noGuest} allowFontScaling={false}>
                Bring a guest live on stage to start a duel.
              </Text>
            )}

            <TouchableOpacity
              style={[
                styles.primaryButton,
                (!selectedGuest || !stakeValid) && styles.disabled,
              ]}
              onPress={start}
              disabled={busy || !selectedGuest || !stakeValid}
              activeOpacity={0.85}
              accessibilityLabel="Start Reaction Duel"
            >
              {busy ? (
                <ActivityIndicator color={INK} />
              ) : (
                <Text style={styles.primaryButtonText} allowFontScaling={false}>
                  Challenge {selectedGuest ? guestName(selectedGuest) : 'a guest'} ·{' '}
                  {stakeValid ? selectedStake : '—'} coins
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onBackToPicker || onClose}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText} allowFontScaling={false}>
                Back to games
              </Text>
            </TouchableOpacity>
            {err ? <Text style={styles.errorText}>{err}</Text> : null}
          </LinearGradient>
        </View>
      ) : null}

      {state && !terminalDismissed ? (
        <View style={styles.gameCard} pointerEvents="box-none">
          <LinearGradient
            colors={['rgba(9,9,11,0.95)', 'rgba(8,47,73,0.88)']}
            style={styles.gameGradient}
          >
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.eyebrow} allowFontScaling={false}>
                  REACTION DUEL
                </Text>
                <Text style={styles.ruleLine} allowFontScaling={false}>
                  {entryCoins} stake · {prizeCoins} live-coin prize · best of 5
                </Text>
              </View>
              {(isAdmin || isHost) && active ? (
                <TouchableOpacity
                  style={styles.endButton}
                  onPress={end}
                  disabled={busy}
                >
                  <Text style={styles.endButtonText} allowFontScaling={false}>
                    End + refund
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.scoreRow}>
              {players.map((player, index) => (
                <View
                  key={player.userId}
                  style={[
                    styles.playerCard,
                    player.userId === currentUid && styles.playerCardMe,
                  ]}
                >
                  <Text
                    style={styles.playerRole}
                    numberOfLines={1}
                    allowFontScaling={false}
                  >
                    {index === 0 ? 'HOST' : 'CHALLENGER'}
                  </Text>
                  <Text
                    style={styles.playerName}
                    numberOfLines={1}
                    allowFontScaling={false}
                  >
                    {publicName(
                      player.displayName,
                      player.userId,
                      index === 0 ? 'Host' : 'Guest'
                    )}
                  </Text>
                  <Text style={styles.score} allowFontScaling={false}>
                    {player.score || 0}
                  </Text>
                  <Text
                    style={[
                      styles.lockStatus,
                      player.locked && styles.lockStatusReady,
                    ]}
                    allowFontScaling={false}
                  >
                    {player.locked ? `${entryCoins} LOCKED` : 'WAITING'}
                  </Text>
                </View>
              ))}
            </View>

            {phase === 'lobby' ? (
              <View style={styles.phaseBlock}>
                <Text style={styles.phaseTitle} allowFontScaling={false}>
                  Lock both entries
                </Text>
                <Text style={styles.phaseCopy} allowFontScaling={false}>
                  Host set {entryCoins} coins. Each player locks that exact stake to
                  confirm; then round one starts.
                </Text>
                {me && !me.locked ? (
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={lockEntry}
                    disabled={busy}
                    activeOpacity={0.85}
                    accessibilityLabel={`Lock ${entryCoins} coin Reaction Duel entry`}
                  >
                    {busy ? (
                      <ActivityIndicator color={INK} />
                    ) : (
                      <Text style={styles.primaryButtonText} allowFontScaling={false}>
                        Lock {entryCoins} coins
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.waitingText} allowFontScaling={false}>
                    {me?.locked
                      ? 'Entry locked — waiting for your opponent.'
                      : 'Watching the two players lock their entries.'}
                  </Text>
                )}
                <Text style={styles.safetyCopy} allowFontScaling={false}>
                  Winner gets {prizeCoins} coins in this live → {prizeCoins} gems when
                  live ends. Before both lock: full refund. After lock: disconnect
                  forfeits.
                </Text>
              </View>
            ) : null}

            {phase === 'prompt' && prompt ? (
              <View style={styles.phaseBlock}>
                <View style={styles.roundLine}>
                  <Text style={styles.roundText} allowFontScaling={false}>
                    ROUND {state.roundNumber}/{event?.rules?.maxRounds || 5}
                  </Text>
                  <Text style={styles.timerText} allowFontScaling={false}>
                    {promptReady
                      ? `${(promptMsLeft / 1000).toFixed(1)}s`
                      : `${Math.max(1, Math.ceil(countdownMs / 1000))}`}
                  </Text>
                </View>

                {!promptReady ? (
                  <View style={styles.readyPanel}>
                    <Text style={styles.readyNumber} allowFontScaling={false}>
                      {Math.max(1, Math.ceil(countdownMs / 1000))}
                    </Text>
                    <Text style={styles.readyCopy} allowFontScaling={false}>
                      Get ready…
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.tapInstruction} allowFontScaling={false}>
                      {isShapePrompt ? 'TAP THE' : 'ANSWER FAST'}
                    </Text>
                    {isShapePrompt ? (
                      <View style={styles.cueRow}>
                        <Text
                          style={[
                            styles.cueShape,
                            { color: prompt.cue.colorHex || CYAN },
                          ]}
                          allowFontScaling={false}
                        >
                          {SHAPE_GLYPH[prompt.cue.shape] || '●'}
                        </Text>
                        <Text
                          style={[
                            styles.cueText,
                            { color: prompt.cue.colorHex || CYAN },
                          ]}
                          allowFontScaling={false}
                        >
                          {String(prompt.cue.colorLabel || '').toUpperCase()}{' '}
                          {String(prompt.cue.shape || '').toUpperCase()}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.questionText} allowFontScaling={false}>
                        {prompt.cue.instruction}
                      </Text>
                    )}
                    <View style={styles.targetGrid}>
                      {(prompt.targets || []).map((target) => (
                        <TouchableOpacity
                          key={target.id}
                          style={[
                            styles.targetButton,
                            {
                              borderColor: target.colorHex || 'rgba(34,211,238,0.6)',
                              backgroundColor: target.colorHex
                                ? `${target.colorHex}1F`
                                : 'rgba(34,211,238,0.1)',
                            },
                            !isShapePrompt && styles.choiceButton,
                            !canTap && styles.targetDisabled,
                          ]}
                          onPress={() => tapTarget(target.id)}
                          disabled={!canTap}
                          activeOpacity={0.72}
                          accessibilityLabel={
                            target.label ||
                            `${target.colorLabel || ''} ${target.shape || ''}`.trim()
                          }
                        >
                          <Text
                            style={[
                              isShapePrompt ? styles.targetGlyph : styles.choiceText,
                              { color: target.colorHex || '#FFFFFF' },
                            ]}
                            allowFontScaling={false}
                          >
                            {isShapePrompt
                              ? SHAPE_GLYPH[target.shape] || '●'
                              : target.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {!me ? (
                      <Text style={styles.waitingText} allowFontScaling={false}>
                        Spectating — both players receive this exact prompt.
                      </Text>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}

            {phase === 'round_result' ? (
              <View style={styles.resultPanel}>
                <Text style={styles.resultTitle} allowFontScaling={false}>
                  {state.lastRound?.winnerDisplayName
                    ? `${publicName(
                        state.lastRound.winnerDisplayName,
                        state.lastRound.winnerUserId,
                        'Player'
                      )} takes the round`
                    : 'Round draw'}
                </Text>
                <Text style={styles.resultCopy} allowFontScaling={false}>
                  {state.lastRound?.text || 'Next prompt incoming…'}
                </Text>
              </View>
            ) : null}

            {terminal ? (
              <View style={[styles.resultPanel, styles.terminalResultPanel]}>
                <TouchableOpacity
                  style={styles.resultCloseButton}
                  onPress={dismissTerminal}
                  accessibilityRole="button"
                  accessibilityLabel="Close Reaction Duel result"
                >
                  <Text style={styles.resultCloseText} allowFontScaling={false}>
                    ×
                  </Text>
                </TouchableOpacity>
                <Text style={styles.resultTrophy} allowFontScaling={false}>
                  {phase === 'ended'
                    ? state.winnerUserId === currentUid
                      ? '🏆'
                      : '⚡'
                    : '↩'}
                </Text>
                <Text style={styles.resultKicker} allowFontScaling={false}>
                  {phase === 'ended' ? 'DUEL WON' : 'ENTRIES REFUNDED'}
                </Text>
                <Text style={styles.resultTitle} allowFontScaling={false}>
                  {phase === 'ended'
                    ? `${publicName(
                        state.winnerDisplayName,
                        state.winnerUserId,
                        'Winner'
                      )} wins ${prizeCoins} coins`
                    : state.endReason === 'draw'
                      ? 'Five-round draw'
                      : 'Duel closed safely'}
                </Text>
                {phase === 'ended' ? (
                  <View style={styles.prizePill}>
                    <Text style={styles.prizePillText} allowFontScaling={false}>
                      {prizeCoins} coins in this live → {prizeCoins} gems at live end
                    </Text>
                  </View>
                ) : null}
                <Text style={styles.resultCopy} allowFontScaling={false}>
                  {state.lastRound?.text ||
                    (phase === 'refunded'
                      ? 'Both entries were refunded.'
                      : 'Prize credited by the server.')}
                </Text>
                <TouchableOpacity
                  style={styles.doneButton}
                  onPress={dismissTerminal}
                  accessibilityRole="button"
                  accessibilityLabel="Done with Reaction Duel result"
                >
                  <Text style={styles.doneButtonText} allowFontScaling={false}>
                    Done
                  </Text>
                </TouchableOpacity>
                <Text style={styles.dismissHint} allowFontScaling={false}>
                  You can also tap outside this card to close it.
                </Text>
              </View>
            ) : null}

            {err && !((isHost || isAdmin) && controlsVisible && (!active || terminal)) ? (
              <Text style={styles.errorText}>{err}</Text>
            ) : null}
          </LinearGradient>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 56,
  },
  terminalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  startCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 72,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.45)',
    zIndex: 2,
  },
  startGradient: {
    padding: 16,
  },
  eyebrow: {
    color: CYAN,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2.2,
  },
  startTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    marginTop: 3,
  },
  startCopy: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  chooseLabel: {
    color: GOLD,
    fontWeight: '800',
    fontSize: 12,
    marginTop: 14,
  },
  stakeRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 8,
  },
  stakeChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  stakeChipSelected: {
    borderColor: GOLD,
    backgroundColor: 'rgba(250,204,21,0.16)',
  },
  stakeChipText: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 13,
    fontWeight: '900',
  },
  stakeChipTextSelected: {
    color: GOLD,
  },
  customStakeInput: {
    minHeight: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: 12,
    marginTop: 8,
    fontSize: 14,
    fontWeight: '800',
  },
  customStakeInputActive: {
    borderColor: CYAN,
  },
  customStakeInputInvalid: {
    borderColor: ROSE,
  },
  stakePreview: {
    color: CYAN,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 6,
  },
  guestRow: {
    gap: 8,
    paddingVertical: 9,
  },
  guestChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
    maxWidth: 150,
  },
  guestChipSelected: {
    borderColor: CYAN,
    backgroundColor: 'rgba(34,211,238,0.16)',
  },
  guestChipText: {
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '700',
    fontSize: 12,
  },
  guestChipTextSelected: {
    color: '#FFFFFF',
  },
  noGuest: {
    color: ROSE,
    marginVertical: 14,
    fontSize: 13,
    fontWeight: '700',
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: CYAN,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 10,
  },
  primaryButtonText: {
    color: INK,
    fontWeight: '900',
    fontSize: 15,
  },
  disabled: {
    opacity: 0.4,
  },
  backButton: {
    alignSelf: 'center',
    marginTop: 10,
    padding: 5,
  },
  backButtonText: {
    color: 'rgba(255,255,255,0.58)',
    fontWeight: '700',
    fontSize: 12,
  },
  errorText: {
    color: ROSE,
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  gameCard: {
    position: 'absolute',
    top: 100,
    left: 10,
    right: 10,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.42)',
    zIndex: 3,
  },
  gameGradient: {
    padding: 13,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  ruleLine: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  endButton: {
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.5)',
    backgroundColor: 'rgba(251,113,133,0.14)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  endButtonText: {
    color: ROSE,
    fontWeight: '800',
    fontSize: 10,
  },
  scoreRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  playerCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    backgroundColor: 'rgba(255,255,255,0.055)',
    padding: 9,
    alignItems: 'center',
  },
  playerCardMe: {
    borderColor: 'rgba(34,211,238,0.65)',
  },
  playerRole: {
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '900',
    fontSize: 8,
    letterSpacing: 1.1,
  },
  playerName: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
    marginTop: 2,
    maxWidth: '100%',
  },
  score: {
    color: GOLD,
    fontWeight: '900',
    fontSize: 27,
    lineHeight: 31,
  },
  lockStatus: {
    color: 'rgba(255,255,255,0.42)',
    fontWeight: '900',
    fontSize: 8,
    letterSpacing: 0.7,
  },
  lockStatusReady: {
    color: CYAN,
  },
  phaseBlock: {
    marginTop: 10,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.22)',
    padding: 12,
  },
  phaseTitle: {
    color: '#FFFFFF',
    textAlign: 'center',
    fontWeight: '900',
    fontSize: 18,
  },
  phaseCopy: {
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  waitingText: {
    color: CYAN,
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 12,
    marginTop: 10,
  },
  safetyCopy: {
    color: 'rgba(255,255,255,0.48)',
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 9,
  },
  roundLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roundText: {
    color: GOLD,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 1.5,
  },
  timerText: {
    color: CYAN,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    fontSize: 14,
  },
  readyPanel: {
    minHeight: 190,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyNumber: {
    color: GOLD,
    fontWeight: '900',
    fontSize: 64,
  },
  readyCopy: {
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '800',
    fontSize: 14,
  },
  tapInstruction: {
    color: 'rgba(255,255,255,0.54)',
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 8,
  },
  cueRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    marginBottom: 8,
  },
  cueShape: {
    fontSize: 27,
  },
  cueText: {
    fontWeight: '900',
    fontSize: 18,
  },
  questionText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 19,
    lineHeight: 27,
    textAlign: 'center',
    marginTop: 5,
    marginBottom: 12,
    paddingHorizontal: 5,
  },
  targetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  targetButton: {
    width: '48%',
    minHeight: 82,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceButton: {
    minHeight: 70,
  },
  targetDisabled: {
    opacity: 0.55,
  },
  targetGlyph: {
    fontSize: 50,
    lineHeight: 58,
  },
  choiceText: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
  },
  resultPanel: {
    marginTop: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.36)',
    backgroundColor: 'rgba(250,204,21,0.08)',
    padding: 14,
    alignItems: 'center',
  },
  terminalResultPanel: {
    position: 'relative',
    borderColor: 'rgba(250,204,21,0.68)',
    backgroundColor: 'rgba(250,204,21,0.12)',
    paddingTop: 20,
    paddingBottom: 16,
  },
  resultCloseButton: {
    position: 'absolute',
    right: 8,
    top: 7,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.09)',
    zIndex: 2,
  },
  resultCloseText: {
    color: '#FFFFFF',
    fontSize: 25,
    lineHeight: 28,
    fontWeight: '500',
  },
  resultTrophy: {
    fontSize: 42,
    lineHeight: 49,
    marginBottom: 2,
  },
  prizePill: {
    borderRadius: 999,
    backgroundColor: 'rgba(34,211,238,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.42)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 10,
  },
  prizePillText: {
    color: CYAN,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
  },
  doneButton: {
    alignSelf: 'stretch',
    minHeight: 46,
    borderRadius: 13,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  doneButtonText: {
    color: INK,
    fontSize: 15,
    fontWeight: '900',
  },
  dismissHint: {
    color: 'rgba(255,255,255,0.46)',
    fontSize: 10,
    marginTop: 7,
  },
  resultKicker: {
    color: GOLD,
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 2,
  },
  resultTitle: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 19,
    textAlign: 'center',
  },
  resultCopy: {
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
});
