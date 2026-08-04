// MatchdayLeaderboard
//
// Per-match and season standings ranked by net coins. A Friends filter narrows
// to the existing follow graph (subscribeToFollowingList). Includes a share /
// bragging surface for the current user's standing.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import { getMatchdayLeaderboard } from '../../api/economyLiveApi';
import { subscribeToFollowingList } from '../../utils/followUtils';
import { logMatchdayEvent } from '../../services/matchdayAnalytics';

const ACCENT = '#19D27C';

function Segmented({ options, value, onChange }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <TouchableOpacity
          key={o.key}
          style={[styles.segment, value === o.key && styles.segmentOn]}
          onPress={() => onChange(o.key)}
        >
          <Text style={[styles.segmentText, value === o.key && styles.segmentTextOn]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function shortId(id) {
  if (!id) return 'fan';
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

export default function MatchdayLeaderboard({ eventId, eventMeta, uid, refreshSignal }) {
  const [scope, setScope] = useState('match'); // match | season
  const [audience, setAudience] = useState('global'); // global | friends
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);
  const [following, setFollowing] = useState(new Set());

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribeToFollowingList(uid, (set) => setFollowing(set || new Set()));
    return unsub;
  }, [uid]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMatchdayLeaderboard(scope === 'match' ? eventId : undefined);
      setEntries(res.entries || []);
      setError(null);
    } catch (e) {
      setError(e?.message || 'Could not load the leaderboard.');
    } finally {
      setLoading(false);
    }
  }, [scope, eventId]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  const visible = useMemo(() => {
    let list = entries;
    if (audience === 'friends') {
      list = entries.filter((e) => e.userId === uid || following.has(e.userId));
    }
    return list.map((e, idx) => ({ ...e, displayRank: idx + 1 }));
  }, [entries, audience, following, uid]);

  const me = useMemo(() => entries.find((e) => e.userId === uid), [entries, uid]);

  const share = useCallback(async () => {
    const where = scope === 'match' ? (eventMeta?.homeTeam ? `${eventMeta.homeTeam} v ${eventMeta.awayTeam}` : 'this match') : 'the season';
    const net = me ? (me.net >= 0 ? `+${me.net}` : `${me.net}`) : '0';
    const rankLine = me ? `ranked #${me.rank} with ${net} coins` : 'getting started';
    try {
      logMatchdayEvent('leaderboard_share', { eventId, scope });
      await Share.share({ message: `I'm ${rankLine} on Blyp Matchday Live for ${where} ⚽🔥` });
    } catch {
      // user dismissed share sheet
    }
  }, [scope, eventMeta, me, eventId]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Segmented
        options={[{ key: 'match', label: 'This match' }, { key: 'season', label: 'Season' }]}
        value={scope}
        onChange={setScope}
      />
      <Segmented
        options={[{ key: 'global', label: 'Global' }, { key: 'friends', label: 'Friends' }]}
        value={audience}
        onChange={setAudience}
      />

      <TouchableOpacity style={styles.shareBtn} activeOpacity={0.85} onPress={share}>
        <Icon name="share-social" size={responsiveFont(15)} color={ACCENT} />
        <Text style={styles.shareText}>Share my standing</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator color={ACCENT} style={{ marginTop: responsiveSize(24) }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : visible.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="trophy-outline" size={responsiveFont(32)} color={COLORS.textMuted} />
          <Text style={styles.emptyText}>
            {audience === 'friends' ? 'No friends on the board yet.' : 'No predictions settled yet.'}
          </Text>
        </View>
      ) : (
        visible.map((e) => {
          const mine = e.userId === uid;
          return (
            <View key={e.userId} style={[styles.row, mine && styles.rowMine]}>
              <Text style={[styles.rank, e.displayRank <= 3 && styles.rankTop]}>{e.displayRank}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, mine && styles.nameMine]} numberOfLines={1}>
                  {mine ? 'You' : shortId(e.userId)}
                </Text>
                <Text style={styles.meta}>{e.plays} {e.plays === 1 ? 'play' : 'plays'} · {e.won} won</Text>
              </View>
              <Text style={[styles.net, { color: e.net >= 0 ? '#34D399' : '#F87171' }]}>
                {e.net >= 0 ? '+' : ''}{e.net}
              </Text>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: responsiveSize(14), paddingBottom: responsiveSize(30) },
  segmented: {
    flexDirection: 'row',
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(12),
    padding: responsiveSize(4),
    marginBottom: responsiveSize(10),
  },
  segment: { flex: 1, paddingVertical: responsiveSize(9), borderRadius: responsiveSize(9), alignItems: 'center' },
  segmentOn: { backgroundColor: ACCENT },
  segmentText: { color: COLORS.textSecondary, fontWeight: '700', fontSize: responsiveFont(13) },
  segmentTextOn: { color: COLORS.background },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: responsiveSize(8),
    borderWidth: 1,
    borderColor: `${ACCENT}66`,
    borderRadius: responsiveSize(12),
    paddingVertical: responsiveSize(11),
    marginTop: responsiveSize(2),
    marginBottom: responsiveSize(12),
  },
  shareText: { color: ACCENT, fontWeight: '800', fontSize: responsiveFont(13) },
  error: { color: '#F87171', fontSize: responsiveFont(13), textAlign: 'center', marginTop: responsiveSize(20) },
  empty: { alignItems: 'center', gap: responsiveSize(8), marginTop: responsiveSize(30) },
  emptyText: { color: COLORS.textMuted, fontSize: responsiveFont(13) },
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
  rowMine: { borderColor: `${ACCENT}88`, backgroundColor: `${ACCENT}14` },
  rank: { color: COLORS.textSecondary, fontWeight: '900', fontSize: responsiveFont(15), width: responsiveSize(26), textAlign: 'center' },
  rankTop: { color: '#FFD24A' },
  name: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '700' },
  nameMine: { color: ACCENT },
  meta: { color: COLORS.textMuted, fontSize: responsiveFont(11), marginTop: 1 },
  net: { fontWeight: '900', fontSize: responsiveFont(15) },
});
