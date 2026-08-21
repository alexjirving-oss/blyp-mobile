// BattleDiaryScreen — a per-user battle diary in two parts:
//   • Planner   : the user's upcoming/live battles (tap to open the detail).
//   • History   : the user's past battles (opponent, date, result, final score).
// A header summarises the user's glory stats (read from the server-maintained
// `battleStats` aggregate). All scoring is GLORY-ONLY — no money is shown here.

import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import { subscribeMyBattles, BATTLE_STATUS, battleSideFor } from '../services/battleService';
import { subscribeMyStats, winRate } from '../services/battleStatsService';

const UPCOMING_STATUSES = [BATTLE_STATUS.PENDING, BATTLE_STATUS.SCHEDULED, BATTLE_STATUS.LIVE];

function startLabel(ms) {
  try {
    const d = new Date(ms);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return `Today ${time}`;
    if (isTomorrow) return `Tomorrow ${time}`;
    return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
  } catch {
    return 'Soon';
  }
}

function pastLabel(ms) {
  try {
    return new Date(ms).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** The opposing side's identity + the user's own/their scores, from the user's POV. */
function opponentView(battle, uid) {
  const side = battleSideFor(battle, uid);
  const score = battle.score || { creator: 0, opponent: 0 };
  if (side === 'opponent') {
    return {
      name: battle.creatorName, photo: battle.creatorPhoto,
      myScore: Number(score.opponent) || 0, theirScore: Number(score.creator) || 0,
    };
  }
  // default to creator's POV (covers side === 'creator')
  return {
    name: battle.opponentName, photo: battle.opponentPhoto,
    myScore: Number(score.creator) || 0, theirScore: Number(score.opponent) || 0,
  };
}

/** Result of a completed battle from the user's POV. */
function resultFor(battle, uid) {
  if (battle.status !== BATTLE_STATUS.COMPLETED) return null;
  if (!battle.winnerUid) return 'draw';
  return battle.winnerUid === uid ? 'win' : 'loss';
}

function Avatar({ uri, name, size = 40 }) {
  const base = [styles.avatar, { width: size, height: size, borderRadius: size / 2 }];
  if (uri) return <Image source={{ uri }} style={base} />;
  return (
    <View style={[base, styles.avatarFallback]}>
      <Text style={[styles.avatarInitial, { fontSize: size / 2.4 }]}>
        {String(name || '?').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

const RESULT_META = {
  win: { label: 'Won', color: COLORS.success, bg: 'rgba(52,211,153,0.14)' },
  loss: { label: 'Lost', color: COLORS.error, bg: 'rgba(251,113,133,0.14)' },
  draw: { label: 'Draw', color: COLORS.textSecondary, bg: 'rgba(255,255,255,0.08)' },
};

const STATUS_LABEL = {
  [BATTLE_STATUS.PENDING]: 'Invite pending',
  [BATTLE_STATUS.SCHEDULED]: 'Scheduled',
  [BATTLE_STATUS.LIVE]: 'Live now',
  [BATTLE_STATUS.CANCELLED]: 'Cancelled',
  [BATTLE_STATUS.REJECTED]: 'Declined',
  [BATTLE_STATUS.EXPIRED]: 'Expired',
};

function StatPill({ value, label }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DiaryHeader({ stats }) {
  const s = stats || {};
  const record = `${s.wins || 0}-${s.losses || 0}-${s.draws || 0}`;
  return (
    <View style={styles.headerCard}>
      <View style={styles.headerTop}>
        <Icon name="ribbon-outline" size={responsiveFont(18)} color={COLORS.primary} />
        <Text style={styles.headerTitle}>Your glory</Text>
      </View>
      <View style={styles.statsRow}>
        <StatPill value={s.gloryPoints || 0} label="Glory" />
        <StatPill value={record} label="W-L-D" />
        <StatPill value={`${winRate(s)}%`} label="Win rate" />
        <StatPill value={s.currentStreak || 0} label="Streak" />
      </View>
      {(s.bestStreak || 0) > 0 && (
        <Text style={styles.headerNote}>Best win streak: {s.bestStreak}</Text>
      )}
    </View>
  );
}

function SectionHeader({ icon, title, count }) {
  return (
    <View style={styles.sectionHeader}>
      <Icon name={icon} size={responsiveFont(15)} color={COLORS.textSecondary} />
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}

const BattleDiaryScreen = ({ navigation }) => {
  const { uid } = useAuth();
  const [battles, setBattles] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setLoading(false); return undefined; }
    const unsub = subscribeMyBattles(uid, (rows) => {
      setBattles(rows || []);
      setLoading(false);
    });
    return () => { try { unsub && unsub(); } catch {} };
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribeMyStats(uid, setStats);
    return () => { try { unsub && unsub(); } catch {} };
  }, [uid]);

  const { upcoming, history } = useMemo(() => {
    const up = battles
      .filter((b) => UPCOMING_STATUSES.includes(b.status))
      .sort((a, b) => (a.scheduledStartAt || 0) - (b.scheduledStartAt || 0));
    const past = battles
      .filter((b) => !UPCOMING_STATUSES.includes(b.status))
      .sort((a, b) => (b.endedAt || b.scheduledStartAt || 0) - (a.endedAt || a.scheduledStartAt || 0));
    return { upcoming: up, history: past };
  }, [battles]);

  const openDetail = (battleId) => navigation?.navigate?.('BattleDetail', { battleId });

  const renderUpcoming = (b) => {
    const opp = opponentView(b, uid);
    const live = b.status === BATTLE_STATUS.LIVE;
    return (
      <TouchableOpacity key={b.id} style={styles.row} activeOpacity={0.85} onPress={() => openDetail(b.id)}>
        <Avatar uri={opp.photo} name={opp.name} />
        <View style={styles.rowBody}>
          <Text style={styles.rowName} numberOfLines={1}>vs {opp.name || 'Opponent'}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {live ? 'Live now' : startLabel(b.scheduledStartAt)}
          </Text>
        </View>
        <View style={[styles.statusChip, live && styles.liveChip]}>
          <Text style={[styles.statusChipText, live && styles.liveChipText]}>
            {STATUS_LABEL[b.status] || 'Upcoming'}
          </Text>
        </View>
        <Icon name="chevron-forward" size={responsiveFont(16)} color={COLORS.textSecondary} />
      </TouchableOpacity>
    );
  };

  const renderHistory = (b) => {
    const opp = opponentView(b, uid);
    const result = resultFor(b, uid);
    const meta = result ? RESULT_META[result] : null;
    const when = pastLabel(b.endedAt || b.scheduledStartAt);
    return (
      <TouchableOpacity key={b.id} style={styles.row} activeOpacity={0.85} onPress={() => openDetail(b.id)}>
        <Avatar uri={opp.photo} name={opp.name} />
        <View style={styles.rowBody}>
          <Text style={styles.rowName} numberOfLines={1}>vs {opp.name || 'Opponent'}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {when}{result ? ` · ${opp.myScore}–${opp.theirScore}` : ''}
          </Text>
        </View>
        {meta ? (
          <View style={[styles.resultChip, { backgroundColor: meta.bg }]}>
            <Text style={[styles.resultChipText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        ) : (
          <View style={styles.statusChip}>
            <Text style={styles.statusChipText}>{STATUS_LABEL[b.status] || 'Ended'}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.topRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Your battle diary</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={[]}
        renderItem={() => null}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <DiaryHeader stats={stats} />

            <SectionHeader icon="calendar-outline" title="Planner" count={upcoming.length} />
            {loading ? (
              <Text style={styles.muted}>Loading…</Text>
            ) : upcoming.length === 0 ? (
              <View style={styles.emptyMini}>
                <Text style={styles.emptyText}>No upcoming battles.</Text>
                <TouchableOpacity onPress={() => navigation?.navigate?.('CreateBattle')}>
                  <Text style={styles.link}>Challenge someone →</Text>
                </TouchableOpacity>
              </View>
            ) : (
              upcoming.map(renderUpcoming)
            )}

            <View style={{ height: responsiveSize(10) }} />
            <SectionHeader icon="time-outline" title="History" count={history.length} />
            {loading ? (
              <Text style={styles.muted}>Loading…</Text>
            ) : history.length === 0 ? (
              <View style={styles.emptyMini}>
                <Text style={styles.emptyText}>No past battles yet.</Text>
              </View>
            ) : (
              history.map(renderHistory)
            )}
          </View>
        }
      />
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, marginBottom: 8, paddingTop: responsiveSize(8),
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  content: { padding: responsiveSize(16), paddingBottom: responsiveSize(50) },
  muted: { color: COLORS.textSecondary, fontSize: responsiveFont(13), marginBottom: responsiveSize(8) },
  headerCard: {
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(16),
    padding: responsiveSize(16),
    marginBottom: responsiveSize(20),
    borderWidth: 1,
    borderColor: 'rgba(255, 45, 85,0.18)',
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(8), marginBottom: responsiveSize(14) },
  headerTitle: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(15) },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: responsiveSize(8) },
  statPill: { flex: 1, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: responsiveSize(12), paddingVertical: responsiveSize(10) },
  statValue: { color: COLORS.primary, fontWeight: '900', fontSize: responsiveFont(17) },
  statLabel: { color: COLORS.textMuted, fontSize: responsiveFont(10), marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  headerNote: { color: COLORS.textMuted, fontSize: responsiveFont(11), marginTop: responsiveSize(12), textAlign: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(8), marginBottom: responsiveSize(10) },
  sectionTitle: {
    flex: 1, color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(13),
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  sectionCount: { color: COLORS.textMuted, fontSize: responsiveFont(12), fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(12),
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(12),
    padding: responsiveSize(12),
    marginBottom: responsiveSize(8),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  rowBody: { flex: 1 },
  rowName: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '700' },
  rowMeta: { color: COLORS.textMuted, fontSize: responsiveFont(11), marginTop: 2 },
  avatar: { backgroundColor: '#222' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: COLORS.textPrimary, fontWeight: '800' },
  statusChip: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: responsiveSize(20), paddingVertical: responsiveSize(5), paddingHorizontal: responsiveSize(10) },
  statusChipText: { color: COLORS.textSecondary, fontSize: responsiveFont(11), fontWeight: '700' },
  liveChip: { backgroundColor: 'rgba(239,68,68,0.15)' },
  liveChipText: { color: '#ef4444' },
  resultChip: { borderRadius: responsiveSize(20), paddingVertical: responsiveSize(5), paddingHorizontal: responsiveSize(12) },
  resultChipText: { fontSize: responsiveFont(11), fontWeight: '800' },
  emptyMini: { alignItems: 'flex-start', gap: responsiveSize(6), paddingVertical: responsiveSize(8), marginBottom: responsiveSize(8) },
  emptyText: { color: COLORS.textSecondary, fontSize: responsiveFont(13) },
  link: { color: COLORS.primary, fontSize: responsiveFont(13), fontWeight: '700' },
});

export default BattleDiaryScreen;
