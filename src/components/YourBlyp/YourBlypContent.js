// YourBlypContent.js
//
// The body of the "Your Blyp" recap (stats, creator analytics, interests and
// quick links). Extracted from YourBlypScreen so it can be reused both as a
// full screen and as a tab inside the Chat/Games surface — single source of
// truth for the recap UI and data fetching.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import { useAuth } from '../../hooks/useCommon';
import { getProfileStats, getCreatorAnalytics } from '../../services/profileStatsService';
import { fixStorageUrl } from '../../utils/urlUtils';

const fmt = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
};

const QUICK_LINKS = [
  { id: 'saved', label: 'Saved', icon: 'bookmark', route: 'Saved' },
  { id: 'activity', label: 'Activity', icon: 'notifications', route: 'Activity' },
  { id: 'pages', label: 'Customize Home', icon: 'grid', route: 'PagesEditor' },
  { id: 'blyp', label: 'Ask Blyp', icon: 'sparkles', route: 'Blyp' },
];

const YourBlypContent = ({ navigation }) => {
  const { uid } = useAuth();
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const [s, a] = await Promise.all([getProfileStats(uid), getCreatorAnalytics(uid)]);
    setStats(s);
    setAnalytics(a);
  }, [uid]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getProfileStats(uid), getCreatorAnalytics(uid)])
      .then(([s, a]) => {
        if (!active) return;
        setStats(s);
        setAnalytics(a);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [uid]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
    } catch {
      // keep last-known data on failure
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  const STAT_CARDS = stats
    ? [
        { label: 'Posts', value: stats.posts, icon: 'albums', color: '#00D2BE' },
        { label: 'Likes received', value: stats.likes, icon: 'heart', color: '#FF3B30' },
        { label: 'Followers', value: stats.followers, icon: 'people', color: '#4DA3FF' },
        { label: 'Following', value: stats.following, icon: 'person-add', color: '#A78BFA' },
        { label: 'Saved', value: stats.saved, icon: 'bookmark', color: '#F5A623' },
        { label: 'Watched', value: stats.watched, icon: 'play-circle', color: '#34C759' },
      ]
    : [];

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
    >
      <Text style={styles.sectionTitle}>Your numbers</Text>
      <View style={styles.statGrid}>
        {STAT_CARDS.map((s) => (
          <View key={s.label} style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: `${s.color}22` }]}>
              <Icon name={s.icon} size={20} color={s.color} />
            </View>
            <Text style={styles.statValue}>{fmt(s.value)}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {analytics?.hasPosts && (
        <>
          <Text style={styles.sectionTitle}>Creator analytics</Text>
          <View style={styles.analyticsRow}>
            <View style={styles.miniStat}>
              <Text style={styles.miniValue}>{fmt(analytics.totalViews)}</Text>
              <Text style={styles.miniLabel}>Views</Text>
            </View>
            <View style={styles.miniStat}>
              <Text style={styles.miniValue}>{fmt(analytics.totalComments)}</Text>
              <Text style={styles.miniLabel}>Comments</Text>
            </View>
            <View style={styles.miniStat}>
              <Text style={styles.miniValue}>{fmt(analytics.avgLikes)}</Text>
              <Text style={styles.miniLabel}>Avg likes</Text>
            </View>
            <View style={styles.miniStat}>
              <Text style={styles.miniValue}>{fmt(analytics.postsLast30)}</Text>
              <Text style={styles.miniLabel}>Last 30d</Text>
            </View>
          </View>

          {analytics.bestPost && (
            <TouchableOpacity
              style={styles.bestCard}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('MediaViewer', { post: { ...analytics.bestPost } })}
            >
              {fixStorageUrl(analytics.bestPost.thumbnail) ? (
                <Image source={{ uri: fixStorageUrl(analytics.bestPost.thumbnail) }} style={styles.bestThumb} />
              ) : (
                <View style={[styles.bestThumb, styles.bestThumbFallback]}>
                  <Icon name="image-outline" size={24} color={COLORS.textMuted} />
                </View>
              )}
              <View style={styles.bestInfo}>
                <Text style={styles.bestEyebrow}>TOP POST</Text>
                <Text style={styles.bestTitle} numberOfLines={2}>{analytics.bestPost.title}</Text>
                <View style={styles.bestMeta}>
                  <Icon name="heart" size={13} color="#FF3B30" />
                  <Text style={styles.bestMetaText}>{fmt(analytics.bestPost.likes)}</Text>
                  <Icon name="chatbubble" size={13} color="#4DA3FF" style={{ marginLeft: 10 }} />
                  <Text style={styles.bestMetaText}>{fmt(analytics.bestPost.comments)}</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
        </>
      )}

      {stats?.interests?.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Your top interests</Text>
          <View style={styles.interestWrap}>
            {stats.interests.map((label) => (
              <TouchableOpacity
                key={label}
                style={styles.interestChip}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('Blyp', { initialQuery: label })}
              >
                <Text style={styles.interestText}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>Jump back in</Text>
      <View style={styles.linkList}>
        {QUICK_LINKS.map((l) => (
          <TouchableOpacity key={l.id} style={styles.linkRow} activeOpacity={0.85} onPress={() => navigation.navigate(l.route)}>
            <View style={styles.linkIcon}>
              <Icon name={l.icon} size={18} color={COLORS.primary} />
            </View>
            <Text style={styles.linkText}>{l.label}</Text>
            <Icon name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ height: responsiveSize(40) }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: responsiveSize(80) },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },

  sectionTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(17), fontWeight: '800', marginTop: 22, marginBottom: 14 },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  statCard: {
    width: '31.5%',
    alignItems: 'center',
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
  },
  statIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  statValue: { color: COLORS.textPrimary, fontSize: responsiveFont(20), fontWeight: '800' },
  statLabel: { color: COLORS.textMuted, fontSize: responsiveFont(11), marginTop: 2, textAlign: 'center' },

  analyticsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  miniStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  miniValue: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '800' },
  miniLabel: { color: COLORS.textMuted, fontSize: responsiveFont(10), marginTop: 3 },
  bestCard: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  bestThumb: { width: 72, height: 72, borderRadius: 12, backgroundColor: COLORS.surface },
  bestThumbFallback: { alignItems: 'center', justifyContent: 'center' },
  bestInfo: { flex: 1, justifyContent: 'center' },
  bestEyebrow: { color: COLORS.primary, fontSize: responsiveFont(10), fontWeight: '800', letterSpacing: 1 },
  bestTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '700', marginTop: 3, lineHeight: responsiveFont(19) },
  bestMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  bestMetaText: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '600', marginLeft: 4 },

  interestWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  interestChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  interestText: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '600' },

  linkList: { gap: 8 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  linkIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,210,190,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '600' },
});

export default YourBlypContent;
