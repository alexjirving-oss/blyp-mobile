// RankingsHubScreen.js
//
// Phase 0 Rankings hub: live boards (coin spend, gem earn, most followed) plus
// Coming soon tiles for the full catalog. Battle glory deep-links the existing
// BattleLeaderboard screen.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import {
  COMING_SOON_BOARDS,
  LIVE_BOARDS,
  fetchRankingBoard,
  formatScore,
} from '../services/rankingsService';

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

function rankBadge(rank) {
  if (rank === 1) return { color: '#FFD24A', icon: 'trophy' };
  if (rank === 2) return { color: '#C0C7D1', icon: 'trophy' };
  if (rank === 3) return { color: '#CD7F32', icon: 'trophy' };
  return null;
}

const RankingsHubScreen = ({ navigation, route }) => {
  const { uid } = useAuth();
  const initialBoard = route?.params?.board || null;
  const [selected, setSelected] = useState(initialBoard);
  const [entries, setEntries] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const liveBoard = useMemo(
    () => LIVE_BOARDS.find((b) => b.id === selected) || null,
    [selected],
  );

  const loadBoard = useCallback(async (boardId) => {
    const def = LIVE_BOARDS.find((b) => b.id === boardId);
    if (!def || def.source !== 'economy') return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchRankingBoard(boardId, { limit: 25 });
      setEntries(Array.isArray(res?.entries) ? res.entries : []);
      setMeta(res || null);
    } catch (e) {
      setEntries([]);
      setMeta(null);
      setError(e?.message || 'Could not load this board.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected && liveBoard?.source === 'economy') {
      loadBoard(selected);
    }
  }, [selected, liveBoard, loadBoard]);

  const openBoard = useCallback(
    (board) => {
      if (board.source === 'navigate' && board.route) {
        navigation.navigate(board.route);
        return;
      }
      setSelected(board.id);
    },
    [navigation],
  );

  const renderRow = useCallback(
    ({ item }) => {
      const badge = rankBadge(item.rank);
      const mine = item.userId === uid;
      return (
        <TouchableOpacity
          style={[styles.row, mine && styles.rowMine]}
          activeOpacity={0.85}
          onPress={() => {
            if (item.userId) {
              navigation.navigate('UserProfile', { userId: item.userId });
            }
          }}
        >
          <View style={styles.rankWrap}>
            {badge ? (
              <Icon name={badge.icon} size={responsiveFont(18)} color={badge.color} />
            ) : (
              <Text style={styles.rank}>{item.rank}</Text>
            )}
          </View>
          <Avatar uri={item.photoURL} name={item.displayName} />
          <View style={styles.identity}>
            <Text style={[styles.name, mine && styles.nameMine]} numberOfLines={1}>
              {item.displayName}
              {mine ? ' (you)' : ''}
            </Text>
            {!!item.handle && (
              <Text style={styles.meta} numberOfLines={1}>
                @{item.handle}
              </Text>
            )}
          </View>
          <View style={styles.pointsWrap}>
            <Text style={styles.points}>{formatScore(item.score, liveBoard?.unit)}</Text>
            <Text style={styles.pointsLabel}>{liveBoard?.unit || meta?.unit || ''}</Text>
          </View>
        </TouchableOpacity>
      );
    },
    [uid, navigation, liveBoard, meta],
  );

  if (selected && liveBoard?.source === 'economy') {
    return (
      <ScreenContainer>
        <View style={styles.topRow}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => setSelected(null)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {liveBoard.title}
          </Text>
          <View style={styles.backBtn} />
        </View>
        <Text style={styles.boardBlurb}>{liveBoard.blurb}</Text>
        <Text style={styles.windowChip}>All time · refreshed on open</Text>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => loadBoard(selected)}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(item) => item.userId}
            renderItem={renderRow}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <Text style={styles.empty}>No rankings yet — be the first.</Text>
            }
          />
        )}
      </ScreenContainer>
    );
  }

  const byCategory = useMemo(() => {
    const map = {};
    for (const b of COMING_SOON_BOARDS) {
      if (!map[b.category]) map[b.category] = [];
      map[b.category].push(b);
    }
    return map;
  }, []);

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
        <Text style={styles.title}>Rankings</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.hubContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.hubLead}>
          See who&apos;s leading across Blyp — economy, social, live and games. More boards unlock as we roll out server aggregates.
        </Text>

        <Text style={styles.sectionTitle}>Live now</Text>
        {LIVE_BOARDS.map((board) => (
          <TouchableOpacity
            key={board.id}
            style={styles.liveTile}
            activeOpacity={0.85}
            onPress={() => openBoard(board)}
          >
            <View style={styles.liveIcon}>
              <Icon name={board.icon} size={responsiveFont(20)} color={COLORS.primary} />
            </View>
            <View style={styles.liveBody}>
              <Text style={styles.liveTitle}>{board.title}</Text>
              <Text style={styles.liveBlurb} numberOfLines={2}>
                {board.blurb}
              </Text>
            </View>
            <Icon name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        ))}

        <Text style={[styles.sectionTitle, { marginTop: responsiveSize(20) }]}>Coming soon</Text>
        {Object.keys(byCategory).map((cat) => (
          <View key={cat} style={styles.soonBlock}>
            <Text style={styles.soonCat}>{cat}</Text>
            {byCategory[cat].map((b) => (
              <View key={b.id} style={styles.soonRow}>
                <View style={styles.soonText}>
                  <Text style={styles.soonTitle}>{b.title}</Text>
                  <Text style={styles.soonWindows}>{b.windows}</Text>
                </View>
                <View style={styles.soonPill}>
                  <Text style={styles.soonPillText}>Soon</Text>
                </View>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: responsiveSize(12),
    paddingTop: responsiveSize(4),
    paddingBottom: responsiveSize(8),
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: responsiveFont(18),
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  hubContent: {
    paddingHorizontal: responsiveSize(16),
    paddingBottom: responsiveSize(40),
  },
  hubLead: {
    fontSize: responsiveFont(14),
    lineHeight: responsiveFont(20),
    color: COLORS.textSecondary,
    marginBottom: responsiveSize(16),
  },
  sectionTitle: {
    fontSize: responsiveFont(15),
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: responsiveSize(10),
  },
  liveTile: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: responsiveSize(12),
    paddingHorizontal: responsiveSize(12),
    borderRadius: 12,
    backgroundColor: COLORS.surface || COLORS.card || '#F4F5F7',
    marginBottom: responsiveSize(8),
    gap: 10,
  },
  liveIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background || '#fff',
  },
  liveBody: { flex: 1 },
  liveTitle: {
    fontSize: responsiveFont(15),
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  liveBlurb: {
    marginTop: 2,
    fontSize: responsiveFont(12),
    color: COLORS.textSecondary,
  },
  soonBlock: { marginBottom: responsiveSize(14) },
  soonCat: {
    fontSize: responsiveFont(12),
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: responsiveSize(6),
  },
  soonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: responsiveSize(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border || '#E5E7EB',
  },
  soonText: { flex: 1, paddingRight: 8 },
  soonTitle: {
    fontSize: responsiveFont(14),
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  soonWindows: {
    marginTop: 2,
    fontSize: responsiveFont(11),
    color: COLORS.textMuted,
  },
  soonPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: COLORS.surface || '#EEF0F3',
  },
  soonPillText: {
    fontSize: responsiveFont(11),
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  boardBlurb: {
    paddingHorizontal: responsiveSize(16),
    fontSize: responsiveFont(13),
    color: COLORS.textSecondary,
  },
  windowChip: {
    paddingHorizontal: responsiveSize(16),
    marginTop: 4,
    marginBottom: 8,
    fontSize: responsiveFont(12),
    color: COLORS.textMuted,
  },
  listContent: {
    paddingHorizontal: responsiveSize(12),
    paddingBottom: responsiveSize(32),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: responsiveSize(10),
    paddingHorizontal: responsiveSize(8),
    gap: 10,
  },
  rowMine: {
    backgroundColor: COLORS.surface || '#F4F5F7',
    borderRadius: 10,
  },
  rankWrap: {
    width: 28,
    alignItems: 'center',
  },
  rank: {
    fontSize: responsiveFont(14),
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  avatar: { backgroundColor: COLORS.surface || '#E5E7EB' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontWeight: '700', color: COLORS.textSecondary },
  identity: { flex: 1 },
  name: {
    fontSize: responsiveFont(14),
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  nameMine: { color: COLORS.primary },
  meta: {
    marginTop: 1,
    fontSize: responsiveFont(12),
    color: COLORS.textMuted,
  },
  pointsWrap: { alignItems: 'flex-end', minWidth: 56 },
  points: {
    fontSize: responsiveFont(15),
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  pointsLabel: {
    fontSize: responsiveFont(10),
    color: COLORS.textMuted,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
  },
  retryText: { color: '#fff', fontWeight: '600' },
  empty: {
    textAlign: 'center',
    color: COLORS.textMuted,
    marginTop: 40,
    fontSize: responsiveFont(14),
  },
});

export default RankingsHubScreen;
