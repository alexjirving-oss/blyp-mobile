// BattleOverlay — TikTok-style live 1v1 match chrome.
//
// Top MatchBar pushes teal ↔ coral as gift/vote scores change. Participants
// get Start match / End match; viewers get one free vote per side. Combo FX,
// top-gifter avatars, win banner + rematch land here.

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image, Alert,
} from 'react-native';
import Icon from '../Icon';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import {
  subscribeBattle,
  refreshBattleArena,
  voteBattle,
  leaveBattle,
  rematchBattle,
  battleSideFor,
  subscribeBattleContributors,
  topGiftersForSide,
} from '../../services/battleService';
import MatchBar, {
  MATCH_BAR_LEFT, MATCH_BAR_RIGHT, COMBO_IDLE_MS, COMBO_MIN,
} from './MatchBar';
import MatchWinBanner from './MatchWinBanner';

function fmtClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function SideChip({ name, photo, accent, align = 'left' }) {
  return (
    <View style={[styles.chip, align === 'right' && styles.chipRight]}>
      {align === 'left' && (
        photo ? (
          <Image source={{ uri: photo }} style={[styles.chipAvatar, { borderColor: accent }]} />
        ) : (
          <View style={[styles.chipAvatarFallback, { borderColor: accent }]}>
            <Text style={styles.chipInitial}>{String(name || '?').charAt(0).toUpperCase()}</Text>
          </View>
        )
      )}
      <Text style={styles.chipName} numberOfLines={1}>{name || 'Creator'}</Text>
      {align === 'right' && (
        photo ? (
          <Image source={{ uri: photo }} style={[styles.chipAvatar, { borderColor: accent }]} />
        ) : (
          <View style={[styles.chipAvatarFallback, { borderColor: accent }]}>
            <Text style={styles.chipInitial}>{String(name || '?').charAt(0).toUpperCase()}</Text>
          </View>
        )
      )}
    </View>
  );
}

/**
 * @param {object} props
 * @param {string} props.battleId
 * @param {string} [props.currentUid]
 * @param {() => void} [props.onEnded] — match ended (does not end the live)
 * @param {(info: { battleId: string, result?: object }) => void} [props.onExit]
 * @param {(info: { battleId: string }) => void} [props.onRematchStarted]
 * @param {string} [props.liveStreamId]
 */
export default function BattleOverlay({
  battleId,
  currentUid,
  onEnded,
  onExit,
  onRematchStarted,
  liveStreamId,
}) {
  const [battle, setBattle] = useState(null);
  const [contributors, setContributors] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [myVote, setMyVote] = useState(null);
  const [ending, setEnding] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [combo, setCombo] = useState(null);
  const endedHandledRef = useRef(false);
  const scoreRef = useRef({ creator: 0, opponent: 0 });
  const comboSideRef = useRef({ side: null, streak: 0, at: 0 });
  const comboClearTimer = useRef(null);

  useEffect(() => {
    if (!battleId) return undefined;
    const unsub = subscribeBattle(battleId, setBattle);
    return () => { try { unsub && unsub(); } catch {} };
  }, [battleId]);

  useEffect(() => {
    if (!battleId) return undefined;
    const unsub = subscribeBattleContributors(battleId, setContributors);
    return () => { try { unsub && unsub(); } catch {} };
  }, [battleId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // GET also advances scheduled lifecycle boundaries on the server. Firestore
  // remains a presentation mirror and will receive the resulting snapshot.
  useEffect(() => {
    if (!battleId) return undefined;
    const reconcile = () => refreshBattleArena(battleId).catch(() => {});
    reconcile();
    const t = setInterval(reconcile, 4000);
    return () => clearInterval(t);
  }, [battleId]);

  // Combo / multiplier pulse from rapid score bumps on one side.
  useEffect(() => {
    if (!battle) return;
    const score = battle.score || { creator: 0, opponent: 0 };
    const prev = scoreRef.current;
    const left = Number(score.A ?? score.creator) || 0;
    const right = Number(score.B ?? score.opponent) || 0;
    const dC = left - (Number(prev.creator) || 0);
    const dO = right - (Number(prev.opponent) || 0);
    scoreRef.current = {
      creator: left,
      opponent: right,
    };
    if (dC <= 0 && dO <= 0) return;
    if (!battle.liveStartedAt || battle.state === 'ENDED') return;

    const side = dC >= dO ? 'left' : 'right';
    const t = Date.now();
    const prevCombo = comboSideRef.current;
    let streak = 1;
    if (prevCombo.side === side && t - prevCombo.at <= COMBO_IDLE_MS) {
      streak = (prevCombo.streak || 0) + 1;
    }
    comboSideRef.current = { side, streak, at: t };
    const mult = streak >= 5 ? 1.5 : streak >= 3 ? 1.2 : 1;
    if (streak >= COMBO_MIN) {
      setCombo({ side, streak, mult });
    }
    if (comboClearTimer.current) clearTimeout(comboClearTimer.current);
    comboClearTimer.current = setTimeout(() => {
      setCombo(null);
      comboSideRef.current = { side: null, streak: 0, at: 0 };
    }, COMBO_IDLE_MS);
  }, [battle?.score?.A, battle?.score?.B, battle?.score?.creator, battle?.score?.opponent, battle?.liveStartedAt, battle?.state]);

  useEffect(() => () => {
    if (comboClearTimer.current) clearTimeout(comboClearTimer.current);
  }, []);

  const side = battle ? battleSideFor(battle, currentUid) : null;
  const isParticipant = !!side;
  const rawScore = battle?.score || {};
  const score = {
    creator: Number(rawScore.A ?? rawScore.creator) || 0,
    opponent: Number(rawScore.B ?? rawScore.opponent) || 0,
  };

  const leftGifters = useMemo(
    () => topGiftersForSide(contributors, 'creator', 3),
    [contributors]
  );
  const rightGifters = useMemo(
    () => topGiftersForSide(contributors, 'opponent', 3),
    [contributors]
  );

  const arenaState = battle?.state || battle?.serverState || 'INVITED';
  const startedAt = battle?.liveStartedAt || battle?.scheduledStartAt || now;
  const durationMs = (battle?.durationSec || 300) * 1000;
  const remaining = startedAt + durationMs - now;
  const completed = arenaState === 'ENDED';
  const isLive = arenaState === 'LIVE';
  const matchRunning = isLive && !!battle?.liveStartedAt;

  const vote = useCallback(async (s) => {
    if (!currentUid || isParticipant || !matchRunning) return;
    setMyVote(s);
    const res = await voteBattle(battleId, currentUid, s);
    if (!res.ok && res.reason === 'already_voted') setMyVote(s);
  }, [battleId, currentUid, isParticipant, matchRunning]);

  const exitNow = useCallback(() => {
    if (!battle || ending) return;
    const state = String(battle.state || battle.serverState || '').toUpperCase();
    const running = state === 'LIVE' || battle.status === 'live';
    Alert.alert(
      'Exit battle?',
      running
        ? 'This ends the battle, but your live stays open.'
        : 'Leave the battle arena and return without ending the whole app.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Exit battle',
          style: 'destructive',
          onPress: async () => {
            setEnding(true);
            endedHandledRef.current = true;
            const result = await leaveBattle(battle, currentUid);
            setEnding(false);
            if (result.ok) onEnded?.();
            onExit?.({ battleId, result });
            if (!result.ok) {
              setTimeout(() => {
                Alert.alert(
                  'Left battle view',
                  'The arena could not be closed on the server. Check your connection before starting another battle.'
                );
              }, 200);
            }
          },
        },
      ]
    );
  }, [battle, battleId, currentUid, ending, onEnded, onExit]);

  const rematchNow = useCallback(async () => {
    if (!battle || !currentUid) return;
    setRematching(true);
    try {
      const res = await rematchBattle(battle, currentUid, {
        liveStreamId: liveStreamId || battle.liveStreamId || null,
      });
      if (res.ok && res.id) {
        endedHandledRef.current = false;
        setMyVote(null);
        setCombo(null);
        onRematchStarted && onRematchStarted({ battleId: res.id });
      }
    } finally {
      setRematching(false);
    }
  }, [battle, currentUid, liveStreamId, onRematchStarted]);

  if (!battle) return null;

  const creatorName = battle.sideA?.displayName || battle.creatorName || 'Side A';
  const opponentName = battle.sideB?.displayName || battle.opponentName || 'Side B';
  const winnerSide = completed
    ? (battle.winnerSide === 'A' || battle.winnerUid === battle.creatorUid
      ? 'creator'
      : battle.winnerSide === 'B' || battle.winnerUid === battle.opponentUid
        ? 'opponent'
        : null)
    : null;

  const winnerTitle = winnerSide === 'creator'
    ? `${creatorName} wins!`
    : winnerSide === 'opponent'
      ? `${opponentName} wins!`
      : "It's a draw!";

  const clockLabel = completed
    ? 'ENDED'
    : matchRunning
      ? fmtClock(Math.max(0, remaining))
      : arenaState === 'COUNTDOWN'
        ? fmtClock(Math.max(0, (battle.countdownEndsAt || now) - now))
        : arenaState === 'FINALIZING'
          ? 'SCORING'
          : ['ACCEPTED', 'LOBBY_OPEN'].includes(arenaState)
            ? `T-${fmtClock(Math.max(0, (battle.scheduledStartAt || now) - now))}`
            : arenaState;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.header} pointerEvents="box-none">
        <View style={styles.vsRow} pointerEvents="none">
          <SideChip
            name={`A · ${creatorName}`}
            photo={battle.creatorPhoto}
            accent={MATCH_BAR_LEFT}
            align="left"
          />
          <View style={styles.centerBadge}>
            <Text style={styles.vsText}>VS</Text>
            <View style={styles.clockRow}>
              {!completed && <Icon name="time-outline" size={responsiveFont(12)} color="rgba(255,255,255,0.85)" />}
              <Text style={styles.clock}>{clockLabel}</Text>
            </View>
          </View>
          <SideChip
            name={`B · ${opponentName}`}
            photo={battle.opponentPhoto}
            accent={MATCH_BAR_RIGHT}
            align="right"
          />
        </View>

        <MatchBar
          leftScore={score.creator}
          rightScore={score.opponent}
          leftGifters={leftGifters}
          rightGifters={rightGifters}
          combo={matchRunning ? combo : null}
          showScores
        />
      </View>

      {completed && (
        <>
          <MatchWinBanner
            title={winnerTitle}
            winnerSide={winnerSide}
            canRematch={isParticipant}
            rematching={rematching}
            onRematch={rematchNow}
          />
          {isParticipant && onExit ? (
            <View style={styles.completedExit}>
              <TouchableOpacity style={styles.exitBtn} onPress={exitNow}>
                <Icon name="exit-outline" size={responsiveFont(17)} color="#fff" />
                <Text style={styles.endBtnText}>Exit battle</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      )}

      {!completed && (
        <View style={styles.controls} pointerEvents="box-none">
          {isParticipant ? (
            <View style={styles.participantActions}>
              <TouchableOpacity
                style={styles.exitBtn}
                onPress={exitNow}
                disabled={ending}
                accessibilityLabel="Exit battle and keep live open"
              >
                {ending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Icon name="exit-outline" size={responsiveFont(17)} color="#fff" />
                    <Text style={styles.endBtnText}>Exit battle</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : matchRunning ? (
            <View style={styles.voteRow}>
              <TouchableOpacity
                style={[styles.voteBtn, styles.voteLeft, myVote === 'creator' && styles.voteBtnActiveLeft]}
                onPress={() => vote('creator')}
              >
                <Text style={styles.voteBtnText} numberOfLines={1}>
                  Vote SIDE A · {creatorName}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.voteBtn, styles.voteRight, myVote === 'opponent' && styles.voteBtnActiveRight]}
                onPress={() => vote('opponent')}
              >
                <Text style={styles.voteBtnText} numberOfLines={1}>
                  Vote SIDE B · {opponentName}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.waitPill} pointerEvents="none">
              <Text style={styles.waitPillText}>
                {arenaState === 'LOBBY_OPEN'
                  ? `${battle.sideA?.joined ? 'A ready' : 'Waiting A'} · ${battle.sideB?.joined ? 'B ready' : 'Waiting B'}`
                  : arenaState === 'COUNTDOWN'
                    ? 'Both sides ready'
                    : 'Waiting for Battle Arena'}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start',
    zIndex: 40,
  },
  header: {
    marginTop: responsiveSize(58),
    marginHorizontal: responsiveSize(12),
    paddingHorizontal: responsiveSize(12),
    paddingTop: responsiveSize(10),
    paddingBottom: responsiveSize(12),
    borderRadius: responsiveSize(16),
    backgroundColor: 'rgba(10,10,12,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  vsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: responsiveSize(10),
    gap: responsiveSize(6),
  },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(6),
    minWidth: 0,
  },
  chipRight: {
    justifyContent: 'flex-end',
  },
  chipAvatar: {
    width: responsiveSize(28),
    height: responsiveSize(28),
    borderRadius: responsiveSize(14),
    borderWidth: 2,
  },
  chipAvatarFallback: {
    width: responsiveSize(28),
    height: responsiveSize(28),
    borderRadius: responsiveSize(14),
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipInitial: {
    color: '#fff',
    fontWeight: '800',
    fontSize: responsiveFont(11),
  },
  chipName: {
    flexShrink: 1,
    color: '#fff',
    fontSize: responsiveFont(12),
    fontWeight: '700',
  },
  centerBadge: {
    alignItems: 'center',
    paddingHorizontal: responsiveSize(6),
    minWidth: responsiveSize(56),
  },
  vsText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: responsiveFont(13),
    letterSpacing: 1,
  },
  clockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(3),
    marginTop: responsiveSize(2),
  },
  clock: {
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '800',
    fontSize: responsiveFont(12),
    fontVariant: ['tabular-nums'],
  },
  controls: {
    position: 'absolute',
    bottom: responsiveSize(118),
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: responsiveSize(14),
  },
  participantActions: {
    alignItems: 'center',
    gap: responsiveSize(10),
    width: '100%',
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(8),
    backgroundColor: MATCH_BAR_LEFT,
    borderRadius: responsiveSize(24),
    paddingVertical: responsiveSize(13),
    paddingHorizontal: responsiveSize(28),
  },
  startBtnText: {
    color: '#0A0A0C',
    fontWeight: '900',
    fontSize: responsiveFont(15),
  },
  exitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(7),
    backgroundColor: 'rgba(239,68,68,0.92)',
    borderRadius: responsiveSize(24),
    paddingVertical: responsiveSize(12),
    paddingHorizontal: responsiveSize(32),
  },
  completedExit: { alignItems: 'center', marginTop: responsiveSize(12) },
  endBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: responsiveFont(14),
  },
  voteRow: {
    flexDirection: 'row',
    gap: responsiveSize(10),
    width: '100%',
  },
  voteBtn: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: responsiveSize(22),
    paddingVertical: responsiveSize(12),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  voteLeft: {
    borderColor: 'rgba(0,210,190,0.45)',
  },
  voteRight: {
    borderColor: 'rgba(255,90,69,0.45)',
  },
  voteBtnActiveLeft: {
    backgroundColor: MATCH_BAR_LEFT,
    borderColor: MATCH_BAR_LEFT,
  },
  voteBtnActiveRight: {
    backgroundColor: MATCH_BAR_RIGHT,
    borderColor: MATCH_BAR_RIGHT,
  },
  voteBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: responsiveFont(12),
    paddingHorizontal: responsiveSize(4),
  },
  waitPill: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: responsiveSize(20),
    paddingVertical: responsiveSize(10),
    paddingHorizontal: responsiveSize(18),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  waitPillText: {
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '700',
    fontSize: responsiveFont(13),
  },
});
