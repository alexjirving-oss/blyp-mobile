// BattleOverlay — the scoreboard + countdown + voting layer for a live battle.
//
// Rendered on top of the shared live room. Bound to battles/{id}: shows each
// side's score (votes + gift weight), a countdown to the end, a free one-per-
// viewer vote, and the winner when it's done. Participants get an "End battle"
// control which declares the winner (glory) and triggers coin settlement.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import {
  subscribeBattle, voteBattle, endBattle, battleSideFor, BATTLE_STATUS,
} from '../../services/battleService';

function fmtClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function BattleOverlay({ battleId, currentUid, onEnded }) {
  const [battle, setBattle] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [myVote, setMyVote] = useState(null);
  const [ending, setEnding] = useState(false);
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

  // A participant auto-ends when time runs out (first one to hit zero settles it).
  useEffect(() => {
    if (!battle || completed || endedHandledRef.current) return;
    if (isParticipant && remaining <= 0 && battle.status === BATTLE_STATUS.LIVE) {
      endedHandledRef.current = true;
      setEnding(true);
      endBattle(battle).finally(() => setEnding(false));
    }
  }, [battle, completed, isParticipant, remaining]);

  const vote = useCallback(async (s) => {
    if (!currentUid || isParticipant) return;
    setMyVote(s);
    const res = await voteBattle(battleId, currentUid, s);
    if (!res.ok && res.reason === 'already_voted') setMyVote(s);
  }, [battleId, currentUid, isParticipant]);

  const endNow = useCallback(async () => {
    if (!battle) return;
    setEnding(true);
    endedHandledRef.current = true;
    await endBattle(battle);
    setEnding(false);
    onEnded && onEnded();
  }, [battle, onEnded]);

  if (!battle) return null;

  const total = (score.creator || 0) + (score.opponent || 0);
  const creatorPct = total > 0 ? Math.round((score.creator / total) * 100) : 50;
  const winnerSide = completed ? (battle.winnerUid === battle.creatorUid ? 'creator' : battle.winnerUid === battle.opponentUid ? 'opponent' : null) : null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {/* Scoreboard header */}
      <View style={styles.scoreboard} pointerEvents="none">
        <View style={styles.scoreSide}>
          <Text style={styles.scoreName} numberOfLines={1}>{battle.creatorName}</Text>
          <Text style={[styles.scoreVal, winnerSide === 'creator' && styles.scoreWin]}>{score.creator}</Text>
        </View>
        {completed ? (
          <View style={styles.centerBadge}><Text style={styles.endedText}>ENDED</Text></View>
        ) : (
          <View style={styles.centerBadge}>
            <Icon name="time-outline" size={responsiveFont(13)} color="#fff" />
            <Text style={styles.clock}>{fmtClock(Math.max(0, remaining))}</Text>
          </View>
        )}
        <View style={styles.scoreSide}>
          <Text style={[styles.scoreVal, winnerSide === 'opponent' && styles.scoreWin]}>{score.opponent}</Text>
          <Text style={styles.scoreName} numberOfLines={1}>{battle.opponentName}</Text>
        </View>
      </View>

      {/* Momentum bar */}
      <View style={styles.barTrack} pointerEvents="none">
        <View style={[styles.barFill, { width: `${creatorPct}%` }]} />
      </View>

      {completed && (
        <View style={styles.winnerBanner} pointerEvents="none">
          <Icon name="trophy" size={responsiveFont(16)} color="#0A0A0C" />
          <Text style={styles.winnerBannerText}>
            {winnerSide === 'creator' ? `${battle.creatorName} wins!` : winnerSide === 'opponent' ? `${battle.opponentName} wins!` : "It's a draw!"}
          </Text>
        </View>
      )}

      {/* Bottom controls */}
      {!completed && (
        <View style={styles.controls}>
          {isParticipant ? (
            <TouchableOpacity style={styles.endBtn} onPress={endNow} disabled={ending}>
              {ending ? <ActivityIndicator color="#fff" /> : <Text style={styles.endBtnText}>End battle</Text>}
            </TouchableOpacity>
          ) : (
            <View style={styles.voteRow}>
              <TouchableOpacity style={[styles.voteBtn, myVote === 'creator' && styles.voteBtnActive]} onPress={() => vote('creator')}>
                <Text style={styles.voteBtnText} numberOfLines={1}>Vote {battle.creatorName}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.voteBtn, myVote === 'opponent' && styles.voteBtnActive]} onPress={() => vote('opponent')}>
                <Text style={styles.voteBtnText} numberOfLines={1}>Vote {battle.opponentName}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-start' },
  scoreboard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: responsiveSize(70), marginHorizontal: responsiveSize(14),
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: responsiveSize(14), padding: responsiveSize(10),
  },
  scoreSide: { flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: responsiveSize(6) },
  scoreName: { color: '#fff', fontSize: responsiveFont(12), fontWeight: '700', maxWidth: responsiveSize(80) },
  scoreVal: { color: COLORS.primary, fontSize: responsiveFont(20), fontWeight: '900' },
  scoreWin: { color: '#FFD54A' },
  centerBadge: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(4), paddingHorizontal: responsiveSize(8) },
  clock: { color: '#fff', fontWeight: '800', fontSize: responsiveFont(14) },
  endedText: { color: '#fff', fontWeight: '800', fontSize: responsiveFont(12) },
  barTrack: {
    height: responsiveSize(6), backgroundColor: '#ef4444', borderRadius: responsiveSize(3),
    marginHorizontal: responsiveSize(14), marginTop: responsiveSize(8), overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: COLORS.primary },
  winnerBanner: {
    flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: responsiveSize(8),
    backgroundColor: '#FFD54A', borderRadius: responsiveSize(20),
    paddingVertical: responsiveSize(8), paddingHorizontal: responsiveSize(16), marginTop: responsiveSize(16),
  },
  winnerBannerText: { color: '#0A0A0C', fontWeight: '800', fontSize: responsiveFont(14) },
  controls: { position: 'absolute', bottom: responsiveSize(120), left: 0, right: 0, alignItems: 'center', paddingHorizontal: responsiveSize(14) },
  voteRow: { flexDirection: 'row', gap: responsiveSize(10), width: '100%' },
  voteBtn: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: responsiveSize(24),
    paddingVertical: responsiveSize(12), alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  voteBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  voteBtnText: { color: '#fff', fontWeight: '700', fontSize: responsiveFont(13) },
  endBtn: { backgroundColor: '#ef4444', borderRadius: responsiveSize(24), paddingVertical: responsiveSize(13), paddingHorizontal: responsiveSize(40) },
  endBtnText: { color: '#fff', fontWeight: '800', fontSize: responsiveFont(15) },
});
