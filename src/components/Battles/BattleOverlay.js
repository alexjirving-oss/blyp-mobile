// BattleOverlay — TikTok-style live 1v1 match chrome.
//
// Top MatchBar pushes teal ↔ coral as gift/vote scores change. Participants
// get Start match / End match; viewers get one free vote per side.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image,
} from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import {
  subscribeBattle, voteBattle, endBattle, startMatch, battleSideFor, BATTLE_STATUS,
} from '../../services/battleService';
import MatchBar, { MATCH_BAR_LEFT, MATCH_BAR_RIGHT } from './MatchBar';

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

export default function BattleOverlay({ battleId, currentUid, onEnded }) {
  const [battle, setBattle] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [myVote, setMyVote] = useState(null);
  const [ending, setEnding] = useState(false);
  const [starting, setStarting] = useState(false);
  const endedHandledRef = useRef(false);

  useEffect(() => {
    if (!battleId) return undefined;
    const unsub = subscribeBattle(battleId, setBattle);
    return () => { try { unsub && unsub(); } catch {} };
  }, [battleId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const side = battle ? battleSideFor(battle, currentUid) : null;
  const isParticipant = !!side;
  const score = battle?.score || { creator: 0, opponent: 0 };

  const startedAt = battle?.liveStartedAt || battle?.scheduledStartAt || now;
  const durationMs = (battle?.durationSec || 300) * 1000;
  const remaining = startedAt + durationMs - now;
  const completed = battle?.status === BATTLE_STATUS.COMPLETED;
  const isLive = battle?.status === BATTLE_STATUS.LIVE;
  const matchRunning = isLive && !!battle?.liveStartedAt;
  const canStart = isParticipant && !completed && !matchRunning && (
    battle?.status === BATTLE_STATUS.SCHEDULED || isLive
  );

  // A participant auto-ends when the match clock hits zero.
  useEffect(() => {
    if (!battle || completed || endedHandledRef.current) return;
    if (isParticipant && matchRunning && remaining <= 0) {
      endedHandledRef.current = true;
      setEnding(true);
      endBattle(battle).finally(() => setEnding(false));
    }
  }, [battle, completed, isParticipant, matchRunning, remaining]);

  const vote = useCallback(async (s) => {
    if (!currentUid || isParticipant || !matchRunning) return;
    setMyVote(s);
    const res = await voteBattle(battleId, currentUid, s);
    if (!res.ok && res.reason === 'already_voted') setMyVote(s);
  }, [battleId, currentUid, isParticipant, matchRunning]);

  const startNow = useCallback(async () => {
    if (!battle || !currentUid) return;
    setStarting(true);
    try {
      await startMatch(battle, currentUid);
    } finally {
      setStarting(false);
    }
  }, [battle, currentUid]);

  const endNow = useCallback(async () => {
    if (!battle) return;
    setEnding(true);
    endedHandledRef.current = true;
    await endBattle(battle);
    setEnding(false);
    onEnded && onEnded();
  }, [battle, onEnded]);

  if (!battle) return null;

  const winnerSide = completed
    ? (battle.winnerUid === battle.creatorUid
      ? 'creator'
      : battle.winnerUid === battle.opponentUid
        ? 'opponent'
        : null)
    : null;

  const clockLabel = completed
    ? 'ENDED'
    : matchRunning
      ? fmtClock(Math.max(0, remaining))
      : 'READY';

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.header} pointerEvents="box-none">
        <View style={styles.vsRow} pointerEvents="none">
          <SideChip
            name={battle.creatorName}
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
            name={battle.opponentName}
            photo={battle.opponentPhoto}
            accent={MATCH_BAR_RIGHT}
            align="right"
          />
        </View>

        <MatchBar
          leftScore={score.creator || 0}
          rightScore={score.opponent || 0}
          showScores
        />
      </View>

      {completed && (
        <View style={styles.winnerBanner} pointerEvents="none">
          <Icon name="trophy" size={responsiveFont(16)} color="#0A0A0C" />
          <Text style={styles.winnerBannerText}>
            {winnerSide === 'creator'
              ? `${battle.creatorName} wins!`
              : winnerSide === 'opponent'
                ? `${battle.opponentName} wins!`
                : "It's a draw!"}
          </Text>
        </View>
      )}

      {!completed && (
        <View style={styles.controls} pointerEvents="box-none">
          {isParticipant ? (
            <View style={styles.participantActions}>
              {canStart ? (
                <TouchableOpacity style={styles.startBtn} onPress={startNow} disabled={starting}>
                  {starting ? (
                    <ActivityIndicator color="#0A0A0C" />
                  ) : (
                    <>
                      <Icon name="flash" size={responsiveFont(16)} color="#0A0A0C" />
                      <Text style={styles.startBtnText}>Start match</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : null}
              {(isLive || canStart) ? (
                <TouchableOpacity
                  style={[styles.endBtn, canStart && styles.endBtnSecondary]}
                  onPress={endNow}
                  disabled={ending}
                >
                  {ending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.endBtnText}>End match</Text>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          ) : matchRunning ? (
            <View style={styles.voteRow}>
              <TouchableOpacity
                style={[styles.voteBtn, styles.voteLeft, myVote === 'creator' && styles.voteBtnActiveLeft]}
                onPress={() => vote('creator')}
              >
                <Text style={styles.voteBtnText} numberOfLines={1}>
                  Support {battle.creatorName}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.voteBtn, styles.voteRight, myVote === 'opponent' && styles.voteBtnActiveRight]}
                onPress={() => vote('opponent')}
              >
                <Text style={styles.voteBtnText} numberOfLines={1}>
                  Support {battle.opponentName}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.waitPill} pointerEvents="none">
              <Text style={styles.waitPillText}>Waiting for match to start</Text>
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
  winnerBanner: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: responsiveSize(8),
    backgroundColor: '#FFD54A',
    borderRadius: responsiveSize(20),
    paddingVertical: responsiveSize(8),
    paddingHorizontal: responsiveSize(16),
    marginTop: responsiveSize(14),
  },
  winnerBannerText: {
    color: '#0A0A0C',
    fontWeight: '800',
    fontSize: responsiveFont(14),
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
  endBtn: {
    backgroundColor: 'rgba(239,68,68,0.92)',
    borderRadius: responsiveSize(24),
    paddingVertical: responsiveSize(12),
    paddingHorizontal: responsiveSize(32),
  },
  endBtnSecondary: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
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
