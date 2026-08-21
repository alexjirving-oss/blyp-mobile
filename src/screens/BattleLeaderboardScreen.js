// BattleLeaderboardScreen — a transparent, GLORY-ONLY ranking of creators by
// battle performance. Ranks by glory points (never money/coins/gems). Supports
// an all-time view and a "this week" toggle, with an in-UI explainer of exactly
// how points are earned. Reads the server-maintained `battleStats` aggregates.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import {
  fetchLeaderboardPage, winRate, GLORY_RULE_LINES,
} from '../services/battleStatsService';

function Avatar({ uri, name, size = 44 }) {
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

function Segmented({ value, onChange }) {
  const options = [
    { key: 'alltime', label: 'All time' },
    { key: 'week', label: 'This week' },
  ];
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <TouchableOpacity
          key={o.key}
          style={[styles.segment, value === o.key && styles.segmentOn]}
          activeOpacity={0.85}
          onPress={() => onChange(o.key)}
        >
          <Text style={[styles.segmentText, value === o.key && styles.segmentTextOn]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function HowPointsWork() {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.howCard}>
      <TouchableOpacity style={styles.howHeader} activeOpacity={0.8} onPress={() => setOpen((v) => !v)}>
        <Icon name="information-circle-outline" size={responsiveFont(16)} color={COLORS.primary} />
        <Text style={styles.howTitle}>How glory points work</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={responsiveFont(16)} color={COLORS.textSecondary} />
      </TouchableOpacity>
      {open && (
        <View style={styles.howBody}>
          {GLORY_RULE_LINES.map((line) => (
            <View key={line.label} style={styles.howRow}>
              <Icon name={line.icon} size={responsiveFont(15)} color={COLORS.textSecondary} />
              <Text style={styles.howLabel}>{line.label}</Text>
              <Text style={styles.howValue}>{line.value}</Text>
            </View>
          ))}
          <Text style={styles.howNote}>
            Glory is bragging rights only — it’s never coins, gems or cash, and nothing is ever paid out for your rank.
          </Text>
        </View>
      )}
    </View>
  );
}

function rankBadge(rank) {
  if (rank === 1) return { color: '#FFD24A', icon: 'trophy' };
  if (rank === 2) return { color: '#C0C7D1', icon: 'trophy' };
  if (rank === 3) return { color: '#CD7F32', icon: 'trophy' };
  return null;
}

const BattleLeaderboardScreen = ({ navigation }) => {
  const { uid } = useAuth();
  const [scope, setScope] = useState('alltime');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (nextScope) => {
    setLoading(true);
    const res = await fetchLeaderboardPage({ scope: nextScope, pageSize: 25, cursor: null });
    setRows(res.rows);
    setCursor(res.cursor);
    // Weekly view is a single filtered page; only all-time paginates.
    setHasMore(nextScope === 'alltime' && res.hasMore);
    setLoading(false);
  }, []);

  useEffect(() => {
    load(scope);
  }, [scope, load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || scope !== 'alltime' || !cursor) return;
    setLoadingMore(true);
    const res = await fetchLeaderboardPage({ scope, pageSize: 25, cursor });
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.uid));
      return [...prev, ...res.rows.filter((r) => !seen.has(r.uid))];
    });
    setCursor(res.cursor);
    setHasMore(res.hasMore);
    setLoadingMore(false);
  }, [loadingMore, hasMore, scope, cursor]);

  const renderItem = useCallback(({ item, index }) => {
    const rank = index + 1;
    const mine = item.uid === uid;
    const badge = rankBadge(rank);
    const points = scope === 'week' ? item.weeklyGloryPoints : item.gloryPoints;
    const played = scope === 'week' ? item.weeklyBattlesPlayed : item.battlesPlayed;
    const wins = scope === 'week' ? item.weeklyWins : item.wins;
    const rate = scope === 'week' ? (played > 0 ? Math.round((wins / played) * 100) : 0) : winRate(item);
    return (
      <View style={[styles.row, mine && styles.rowMine]}>
        <View style={styles.rankWrap}>
          {badge ? (
            <Icon name={badge.icon} size={responsiveFont(18)} color={badge.color} />
          ) : (
            <Text style={styles.rank}>{rank}</Text>
          )}
        </View>
        <Avatar uri={item.photoURL} name={item.displayName} />
        <View style={styles.identity}>
          <Text style={[styles.name, mine && styles.nameMine]} numberOfLines={1}>
            {item.displayName}{mine ? ' (you)' : ''}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {item.handle ? `@${item.handle} · ` : ''}{wins}W · {played} {played === 1 ? 'battle' : 'battles'} · {rate}%
          </Text>
        </View>
        <View style={styles.pointsWrap}>
          <Text style={styles.points}>{points}</Text>
          <Text style={styles.pointsLabel}>glory</Text>
        </View>
      </View>
    );
  }, [uid, scope]);

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
        <Text style={styles.title}>Battle leaderboard</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.uid}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <Segmented value={scope} onChange={setScope} />
            <HowPointsWork />
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Icon name="trophy-outline" size={responsiveFont(40)} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>
                {scope === 'week' ? 'No glory earned yet this week.' : 'No battle glory yet.'}
              </Text>
              <Text style={styles.emptySub}>Win battles to climb the board.</Text>
            </View>
          )
        }
        ListFooterComponent={
          loading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginTop: responsiveSize(24) }} />
          ) : loadingMore ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginVertical: responsiveSize(16) }} />
          ) : null
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
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
  segmented: {
    flexDirection: 'row',
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(12),
    padding: responsiveSize(4),
    marginBottom: responsiveSize(12),
  },
  segment: { flex: 1, paddingVertical: responsiveSize(9), borderRadius: responsiveSize(9), alignItems: 'center' },
  segmentOn: { backgroundColor: COLORS.primary },
  segmentText: { color: COLORS.textSecondary, fontWeight: '700', fontSize: responsiveFont(13) },
  segmentTextOn: { color: '#FFFFFF' },
  howCard: {
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(12),
    marginBottom: responsiveSize(16),
    borderWidth: 1,
    borderColor: 'rgba(255, 45, 85,0.18)',
    overflow: 'hidden',
  },
  howHeader: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(8), padding: responsiveSize(14) },
  howTitle: { flex: 1, color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(13) },
  howBody: { paddingHorizontal: responsiveSize(14), paddingBottom: responsiveSize(14), gap: responsiveSize(10) },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(10) },
  howLabel: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(13) },
  howValue: { color: COLORS.primary, fontWeight: '800', fontSize: responsiveFont(13) },
  howNote: { color: COLORS.textMuted, fontSize: responsiveFont(11), marginTop: responsiveSize(4), lineHeight: responsiveFont(16) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(10),
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(12),
    padding: responsiveSize(12),
    marginBottom: responsiveSize(8),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  rowMine: { borderColor: 'rgba(255, 45, 85,0.55)', backgroundColor: 'rgba(255, 45, 85,0.08)' },
  rankWrap: { width: responsiveSize(28), alignItems: 'center', justifyContent: 'center' },
  rank: { color: COLORS.textSecondary, fontWeight: '900', fontSize: responsiveFont(15) },
  avatar: { backgroundColor: '#222' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: COLORS.textPrimary, fontWeight: '800' },
  identity: { flex: 1 },
  name: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '700' },
  nameMine: { color: COLORS.primary },
  meta: { color: COLORS.textMuted, fontSize: responsiveFont(11), marginTop: 2 },
  pointsWrap: { alignItems: 'flex-end' },
  points: { color: COLORS.primary, fontWeight: '900', fontSize: responsiveFont(18) },
  pointsLabel: { color: COLORS.textMuted, fontSize: responsiveFont(10), textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { alignItems: 'center', paddingVertical: responsiveSize(50), gap: responsiveSize(8) },
  emptyText: { color: COLORS.textSecondary, fontSize: responsiveFont(14), fontWeight: '600' },
  emptySub: { color: COLORS.textSecondary, fontSize: responsiveFont(12), opacity: 0.7 },
});

export default BattleLeaderboardScreen;
