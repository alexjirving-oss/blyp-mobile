// YourBlypContent.js
//
// The body of the "Your Blyp" recap (stats, creator analytics, interests and
// quick links). It is shared by the full screen and the Chat/Games tab.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../Icon';
import PressableLift from '../motion/PressableLift';
import { COLORS, SHADOWS } from '../../styles/theme';
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
  {
    id: 'saved',
    label: 'Saved',
    detail: 'Your keepers',
    icon: 'bookmark',
    route: 'Saved',
  },
  {
    id: 'activity',
    label: 'Activity',
    detail: 'What is new',
    icon: 'notifications',
    route: 'Activity',
  },
  {
    id: 'pages',
    label: 'Customize Home',
    detail: 'Make it yours',
    icon: 'grid',
    route: 'PagesEditor',
  },
  {
    id: 'blyp',
    label: 'Ask Blyp',
    detail: 'Find your next thing',
    icon: 'sparkles',
    route: 'Blyp',
  },
];

const RHYTHM_STATS = [
  { key: 'following', label: 'Following', icon: 'person-add', color: COLORS.electric },
  { key: 'saved', label: 'Saved', icon: 'bookmark', color: COLORS.warning },
  { key: 'watched', label: 'Watched', icon: 'play-circle', color: COLORS.success },
];

const CREATOR_STATS = [
  { key: 'totalViews', label: 'Views' },
  { key: 'totalComments', label: 'Comments' },
  { key: 'avgLikes', label: 'Avg likes' },
  { key: 'postsLast30', label: 'Last 30 days' },
];

const SectionHeading = ({ eyebrow, title, detail }) => (
  <View style={styles.sectionHeading}>
    <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
    <Text style={styles.sectionTitle}>{title}</Text>
    {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
  </View>
);

const HeroMetric = ({ label, value, color }) => (
  <View style={styles.heroMetric}>
    <View style={[styles.metricSignal, { backgroundColor: color }]} />
    <Text style={styles.heroMetricValue}>{fmt(value)}</Text>
    <Text style={styles.heroMetricLabel}>{label}</Text>
  </View>
);

const YourBlypContent = ({ navigation }) => {
  const { uid } = useAuth();
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const entrance = useRef(new Animated.Value(0)).current;

  const requestData = useCallback(async () => {
    const [nextStats, nextAnalytics] = await Promise.all([
      getProfileStats(uid),
      getCreatorAnalytics(uid),
    ]);
    return { nextStats, nextAnalytics };
  }, [uid]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setStats(null);
    setAnalytics(null);

    requestData()
      .then(({ nextStats, nextAnalytics }) => {
        if (!active) return;
        setStats(nextStats);
        setAnalytics(nextAnalytics);
      })
      .catch(() => {
        if (active) setError('Your recap could not be loaded right now.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [requestData]);

  useEffect(() => {
    if (loading || error) return undefined;
    let active = true;
    entrance.setValue(0);

    const reveal = (reduceMotion = false) => {
      if (!active) return;
      if (reduceMotion) {
        entrance.setValue(1);
        return;
      }
      Animated.timing(entrance, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    };

    AccessibilityInfo.isReduceMotionEnabled().then(reveal).catch(() => reveal(false));
    return () => {
      active = false;
      entrance.stopAnimation();
    };
  }, [entrance, error, loading]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { nextStats, nextAnalytics } = await requestData();
      setStats(nextStats);
      setAnalytics(nextAnalytics);
      setError('');
    } catch {
      if (!stats) setError('Your recap could not be refreshed right now.');
    } finally {
      setRefreshing(false);
    }
  }, [requestData, stats]);

  const retry = useCallback(() => {
    setLoading(true);
    setError('');
    requestData()
      .then(({ nextStats, nextAnalytics }) => {
        setStats(nextStats);
        setAnalytics(nextAnalytics);
      })
      .catch(() => setError('Your recap could not be loaded right now.'))
      .finally(() => setLoading(false));
  }, [requestData]);

  const navigate = useCallback(
    (route, params) => {
      navigation?.navigate?.(route, params);
    },
    [navigation],
  );

  if (loading) {
    return (
      <View style={styles.stateWrap}>
        <View style={styles.loadingCard}>
          <View style={styles.loadingMark}>
            <ActivityIndicator size="small" color={COLORS.primary} />
          </View>
          <Text style={styles.stateEyebrow}>YOUR BLYP</Text>
          <Text style={styles.stateTitle}>Gathering your signal</Text>
          <Text style={styles.stateCopy}>
            Pulling together the moments, people and ideas that make Blyp yours.
          </Text>
          <View style={styles.loadingBars}>
            <View style={[styles.loadingBar, styles.loadingBarWide]} />
            <View style={[styles.loadingBar, styles.loadingBarShort]} />
          </View>
        </View>
      </View>
    );
  }

  if (error && !stats) {
    return (
      <View style={styles.stateWrap}>
        <View style={styles.errorCard}>
          <View style={styles.errorIcon}>
            <Icon name="cloud-offline-outline" size={26} color={COLORS.primary} />
          </View>
          <Text style={styles.stateEyebrow}>SIGNAL INTERRUPTED</Text>
          <Text style={styles.stateTitle}>Your recap is still here</Text>
          <Text style={styles.stateCopy}>{error} Check your connection and try again.</Text>
          <PressableLift
            accessibilityRole="button"
            accessibilityLabel="Try loading Your Blyp again"
            style={styles.retryLift}
            contentStyle={styles.retryButton}
            onPress={retry}
          >
            <Icon name="refresh" size={16} color={COLORS.black} />
            <Text style={styles.retryText}>Try again</Text>
          </PressableLift>
        </View>
      </View>
    );
  }

  const hasActivity = [
    stats?.posts,
    stats?.likes,
    stats?.followers,
    stats?.following,
    stats?.saved,
    stats?.watched,
  ].some((value) => Number(value) > 0);
  const interests = Array.isArray(stats?.interests) ? stats.interests : [];
  const bestThumb = analytics?.bestPost?.thumbnail
    ? fixStorageUrl(analytics.bestPost.thumbnail)
    : null;

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={COLORS.primary}
          colors={[COLORS.primary]}
          progressBackgroundColor={COLORS.surfaceAlt}
        />
      }
    >
      <Animated.View
        style={[
          styles.reveal,
          {
            opacity: entrance,
            transform: [
              {
                translateY: entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, 0],
                }),
              },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={['rgba(0,210,190,0.18)', 'rgba(18,18,22,0.98)', COLORS.backgroundCard]}
          locations={[0, 0.58, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View pointerEvents="none" style={styles.heroGlow} />
          <View style={styles.heroTop}>
            <View style={styles.heroMark}>
              <Icon name="pulse" size={22} color={COLORS.primary} />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>YOUR SIGNAL</Text>
              <Text style={styles.heroTitle}>Your corner of Blyp</Text>
              <Text style={styles.heroSubtitle}>
                {hasActivity
                  ? 'A live view of what you create, collect and connect with.'
                  : 'Explore, save and create. Your story will take shape here.'}
              </Text>
            </View>
          </View>

          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>
              {analytics?.hasPosts ? 'CREATOR MODE' : hasActivity ? 'TAKING SHAPE' : 'READY WHEN YOU ARE'}
            </Text>
          </View>

          <View style={styles.heroMetrics}>
            <HeroMetric label="Posts" value={stats?.posts} color={COLORS.primary} />
            <View style={styles.metricDivider} />
            <HeroMetric label="Likes" value={stats?.likes} color={COLORS.error} />
            <View style={styles.metricDivider} />
            <HeroMetric label="Followers" value={stats?.followers} color={COLORS.info} />
          </View>
        </LinearGradient>

        <SectionHeading
          eyebrow="YOUR RHYTHM"
          title="What you keep close"
          detail="The people and moments shaping your feed."
        />
        <View style={styles.rhythmRow}>
          {RHYTHM_STATS.map((item) => (
            <View key={item.key} style={styles.rhythmCard}>
              <View style={[styles.rhythmIcon, { backgroundColor: `${item.color}18` }]}>
                <Icon name={item.icon} size={17} color={item.color} />
              </View>
              <Text style={styles.rhythmValue}>{fmt(stats?.[item.key])}</Text>
              <Text style={styles.rhythmLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <SectionHeading
          eyebrow="CREATOR SIGNAL"
          title="How your work is landing"
          detail={
            analytics?.hasPosts
              ? 'A clear read on the response to your posts.'
              : 'Your creator insights will grow with your first post.'
          }
        />
        {analytics?.hasPosts ? (
          <View style={styles.creatorPanel}>
            <View style={styles.creatorGrid}>
              {CREATOR_STATS.map((item) => (
                <View key={item.key} style={styles.creatorMetric}>
                  <Text style={styles.creatorMetricValue}>{fmt(analytics?.[item.key])}</Text>
                  <Text style={styles.creatorMetricLabel}>{item.label}</Text>
                </View>
              ))}
            </View>

            {analytics.bestPost ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Open top post: ${analytics.bestPost.title || 'Post'}`}
                style={styles.bestCard}
                activeOpacity={0.86}
                onPress={() => navigate('MediaViewer', { post: { ...analytics.bestPost } })}
              >
                {bestThumb ? (
                  <Image source={{ uri: bestThumb }} style={styles.bestThumb} />
                ) : (
                  <View style={[styles.bestThumb, styles.bestThumbFallback]}>
                    <Icon name="image-outline" size={25} color={COLORS.textMuted} />
                  </View>
                )}
                <View style={styles.bestInfo}>
                  <View style={styles.bestLabelRow}>
                    <View style={styles.bestSignal} />
                    <Text style={styles.bestEyebrow}>TOP POST</Text>
                  </View>
                  <Text style={styles.bestTitle} numberOfLines={2}>
                    {analytics.bestPost.title}
                  </Text>
                  <View style={styles.bestMeta}>
                    <Icon name="heart" size={13} color={COLORS.error} />
                    <Text style={styles.bestMetaText}>{fmt(analytics.bestPost.likes)}</Text>
                    <Icon name="chatbubble" size={13} color={COLORS.info} style={styles.bestMetaIcon} />
                    <Text style={styles.bestMetaText}>{fmt(analytics.bestPost.comments)}</Text>
                    <Icon name="chevron-forward" size={16} color={COLORS.textMuted} style={styles.bestChevron} />
                  </View>
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <View style={styles.creatorEmpty}>
            <View style={styles.creatorEmptyIcon}>
              <Icon name="create-outline" size={25} color={COLORS.primary} />
            </View>
            <View style={styles.creatorEmptyCopy}>
              <Text style={styles.creatorEmptyTitle}>Your creator story starts here</Text>
              <Text style={styles.creatorEmptyText}>
                Share something you care about and this space becomes your performance snapshot.
              </Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.creatorEmptyAction}
              activeOpacity={0.82}
              onPress={() =>
                navigate('Blyp', { initialQuery: 'Help me find an idea for my next Blyp post' })
              }
            >
              <Text style={styles.creatorEmptyActionText}>Find an idea</Text>
              <Icon name="arrow-forward" size={15} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
        )}

        <SectionHeading
          eyebrow="YOUR TOPICS"
          title="Built around you"
          detail="Tap a topic to explore it with Blyp."
        />
        {interests.length > 0 ? (
          <View style={styles.interestWrap}>
            {interests.map((label) => (
              <TouchableOpacity
                key={label}
                accessibilityRole="button"
                style={styles.interestChip}
                activeOpacity={0.82}
                onPress={() => navigate('Blyp', { initialQuery: label })}
              >
                <View style={styles.interestDot} />
                <Text style={styles.interestText}>{label}</Text>
                <Icon name="arrow-forward" size={13} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.interestEmpty}>
            <Icon name="sparkles-outline" size={20} color={COLORS.primary} />
            <View style={styles.interestEmptyCopy}>
              <Text style={styles.interestEmptyTitle}>Still finding your mix</Text>
              <Text style={styles.interestEmptyText}>
                The topics you choose and explore will appear here.
              </Text>
            </View>
          </View>
        )}

        <SectionHeading
          eyebrow="SHORTCUTS"
          title="Pick up where you left off"
          detail="Your most useful Blyp spaces, one tap away."
        />
        <View style={styles.linkGrid}>
          {QUICK_LINKS.map((item) => (
            <TouchableOpacity
              key={item.id}
              accessibilityRole="button"
              style={styles.linkCard}
              activeOpacity={0.84}
              onPress={() => navigate(item.route)}
            >
              <View style={styles.linkTopRow}>
                <View style={styles.linkIcon}>
                  <Icon name={item.icon} size={18} color={COLORS.primary} />
                </View>
                <Icon name="arrow-forward" size={15} color={COLORS.textMuted} />
              </View>
              <Text style={styles.linkText}>{item.label}</Text>
              <Text style={styles.linkDetail}>{item.detail}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>

      <View style={styles.scrollTail} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scroll: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: responsiveSize(14),
    paddingTop: responsiveSize(8),
  },
  reveal: {
    width: '100%',
  },
  scrollTail: {
    height: responsiveSize(40),
  },

  stateWrap: {
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    justifyContent: 'center',
    paddingHorizontal: responsiveSize(18),
    paddingVertical: responsiveSize(36),
  },
  loadingCard: {
    minHeight: responsiveSize(270),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: responsiveSize(24),
    paddingHorizontal: responsiveSize(28),
    paddingVertical: responsiveSize(32),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    overflow: 'hidden',
  },
  errorCard: {
    alignItems: 'center',
    borderRadius: responsiveSize(24),
    paddingHorizontal: responsiveSize(26),
    paddingVertical: responsiveSize(32),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  loadingMark: {
    width: responsiveSize(52),
    height: responsiveSize(52),
    borderRadius: responsiveSize(18),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: responsiveSize(18),
    backgroundColor: 'rgba(0,210,190,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.24)',
  },
  errorIcon: {
    width: responsiveSize(54),
    height: responsiveSize(54),
    borderRadius: responsiveSize(18),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: responsiveSize(18),
    backgroundColor: 'rgba(0,210,190,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.24)',
  },
  stateEyebrow: {
    color: COLORS.primary,
    fontSize: responsiveFont(10),
    fontWeight: '900',
    letterSpacing: 1.7,
  },
  stateTitle: {
    marginTop: responsiveSize(8),
    color: COLORS.textPrimary,
    fontSize: responsiveFont(22),
    lineHeight: responsiveFont(28),
    fontWeight: '900',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  stateCopy: {
    maxWidth: 370,
    marginTop: responsiveSize(9),
    color: COLORS.textSecondary,
    fontSize: responsiveFont(13),
    lineHeight: responsiveFont(20),
    textAlign: 'center',
  },
  loadingBars: {
    width: '70%',
    alignItems: 'center',
    marginTop: responsiveSize(25),
    gap: responsiveSize(8),
  },
  loadingBar: {
    height: responsiveSize(7),
    borderRadius: responsiveSize(4),
    backgroundColor: COLORS.surfaceAlt,
  },
  loadingBarWide: {
    width: '100%',
  },
  loadingBarShort: {
    width: '62%',
  },
  retryLift: {
    marginTop: responsiveSize(22),
    borderRadius: responsiveSize(12),
  },
  retryButton: {
    minWidth: responsiveSize(126),
    minHeight: responsiveSize(44),
    paddingHorizontal: responsiveSize(20),
    borderRadius: responsiveSize(12),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: responsiveSize(8),
    backgroundColor: COLORS.primary,
  },
  retryText: {
    color: COLORS.black,
    fontSize: responsiveFont(13),
    fontWeight: '900',
  },

  heroCard: {
    position: 'relative',
    padding: responsiveSize(20),
    borderRadius: responsiveSize(24),
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.24)',
    overflow: 'hidden',
    ...SHADOWS.medium,
  },
  heroGlow: {
    position: 'absolute',
    width: responsiveSize(160),
    height: responsiveSize(160),
    borderRadius: responsiveSize(80),
    right: responsiveSize(-72),
    top: responsiveSize(-82),
    backgroundColor: 'rgba(103,232,249,0.08)',
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  heroMark: {
    width: responsiveSize(46),
    height: responsiveSize(46),
    borderRadius: responsiveSize(15),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: responsiveSize(13),
    backgroundColor: 'rgba(0,210,190,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.26)',
  },
  heroCopy: {
    flex: 1,
    paddingRight: responsiveSize(2),
  },
  heroEyebrow: {
    color: COLORS.primary,
    fontSize: responsiveFont(10),
    fontWeight: '900',
    letterSpacing: 1.7,
  },
  heroTitle: {
    marginTop: responsiveSize(5),
    color: COLORS.textPrimary,
    fontSize: responsiveFont(24),
    lineHeight: responsiveFont(29),
    fontWeight: '900',
    letterSpacing: -0.7,
  },
  heroSubtitle: {
    marginTop: responsiveSize(7),
    color: COLORS.textSecondary,
    fontSize: responsiveFont(12),
    lineHeight: responsiveFont(18),
  },
  statusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: responsiveSize(17),
    paddingHorizontal: responsiveSize(10),
    paddingVertical: responsiveSize(6),
    borderRadius: responsiveSize(20),
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statusDot: {
    width: responsiveSize(6),
    height: responsiveSize(6),
    borderRadius: responsiveSize(3),
    marginRight: responsiveSize(7),
    backgroundColor: COLORS.primary,
  },
  statusText: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(9),
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  heroMetrics: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: responsiveSize(20),
    paddingTop: responsiveSize(18),
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  heroMetric: {
    flex: 1,
    alignItems: 'center',
  },
  metricSignal: {
    width: responsiveSize(16),
    height: responsiveSize(3),
    borderRadius: responsiveSize(2),
    marginBottom: responsiveSize(8),
  },
  heroMetricValue: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(22),
    lineHeight: responsiveFont(25),
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  heroMetricLabel: {
    marginTop: responsiveSize(3),
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    fontWeight: '700',
  },
  metricDivider: {
    width: 1,
    marginVertical: responsiveSize(4),
    backgroundColor: COLORS.divider,
  },

  sectionHeading: {
    marginTop: responsiveSize(28),
    marginBottom: responsiveSize(13),
  },
  sectionEyebrow: {
    color: COLORS.primary,
    fontSize: responsiveFont(9),
    fontWeight: '900',
    letterSpacing: 1.65,
  },
  sectionTitle: {
    marginTop: responsiveSize(5),
    color: COLORS.textPrimary,
    fontSize: responsiveFont(19),
    lineHeight: responsiveFont(24),
    fontWeight: '900',
    letterSpacing: -0.35,
  },
  sectionDetail: {
    marginTop: responsiveSize(4),
    color: COLORS.textMuted,
    fontSize: responsiveFont(12),
    lineHeight: responsiveFont(18),
  },

  rhythmRow: {
    flexDirection: 'row',
    gap: responsiveSize(8),
  },
  rhythmCard: {
    flex: 1,
    minWidth: 0,
    minHeight: responsiveSize(116),
    paddingHorizontal: responsiveSize(10),
    paddingVertical: responsiveSize(13),
    borderRadius: responsiveSize(17),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rhythmIcon: {
    width: responsiveSize(32),
    height: responsiveSize(32),
    borderRadius: responsiveSize(11),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: responsiveSize(11),
  },
  rhythmValue: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(18),
    lineHeight: responsiveFont(21),
    fontWeight: '900',
  },
  rhythmLabel: {
    marginTop: responsiveSize(3),
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    fontWeight: '700',
  },

  creatorPanel: {
    padding: responsiveSize(12),
    borderRadius: responsiveSize(20),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  creatorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: responsiveSize(8),
  },
  creatorMetric: {
    width: '48.5%',
    minHeight: responsiveSize(76),
    justifyContent: 'center',
    paddingHorizontal: responsiveSize(14),
    paddingVertical: responsiveSize(12),
    borderRadius: responsiveSize(14),
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  creatorMetricValue: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(18),
    fontWeight: '900',
  },
  creatorMetricLabel: {
    marginTop: responsiveSize(4),
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    fontWeight: '700',
  },
  bestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(13),
    marginTop: responsiveSize(10),
    padding: responsiveSize(10),
    borderRadius: responsiveSize(16),
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  bestThumb: {
    width: responsiveSize(82),
    height: responsiveSize(82),
    borderRadius: responsiveSize(13),
    backgroundColor: COLORS.surfaceAlt,
  },
  bestThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bestInfo: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  bestLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bestSignal: {
    width: responsiveSize(13),
    height: responsiveSize(3),
    borderRadius: responsiveSize(2),
    marginRight: responsiveSize(6),
    backgroundColor: COLORS.primary,
  },
  bestEyebrow: {
    color: COLORS.primary,
    fontSize: responsiveFont(9),
    fontWeight: '900',
    letterSpacing: 1.15,
  },
  bestTitle: {
    marginTop: responsiveSize(5),
    color: COLORS.textPrimary,
    fontSize: responsiveFont(14),
    lineHeight: responsiveFont(19),
    fontWeight: '800',
  },
  bestMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: responsiveSize(8),
  },
  bestMetaIcon: {
    marginLeft: responsiveSize(11),
  },
  bestMetaText: {
    marginLeft: responsiveSize(4),
    color: COLORS.textSecondary,
    fontSize: responsiveFont(11),
    fontWeight: '700',
  },
  bestChevron: {
    marginLeft: 'auto',
  },
  creatorEmpty: {
    padding: responsiveSize(18),
    borderRadius: responsiveSize(20),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  creatorEmptyIcon: {
    width: responsiveSize(46),
    height: responsiveSize(46),
    borderRadius: responsiveSize(15),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: responsiveSize(15),
    backgroundColor: 'rgba(0,210,190,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.22)',
  },
  creatorEmptyCopy: {
    maxWidth: 470,
  },
  creatorEmptyTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(16),
    fontWeight: '900',
  },
  creatorEmptyText: {
    marginTop: responsiveSize(6),
    color: COLORS.textMuted,
    fontSize: responsiveFont(12),
    lineHeight: responsiveFont(18),
  },
  creatorEmptyAction: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(7),
    marginTop: responsiveSize(17),
    paddingVertical: responsiveSize(8),
    paddingHorizontal: responsiveSize(11),
    borderRadius: responsiveSize(10),
    backgroundColor: 'rgba(0,210,190,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.18)',
  },
  creatorEmptyActionText: {
    color: COLORS.primary,
    fontSize: responsiveFont(11),
    fontWeight: '900',
  },

  interestWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: responsiveSize(8),
  },
  interestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(7),
    minHeight: responsiveSize(42),
    paddingHorizontal: responsiveSize(13),
    paddingVertical: responsiveSize(9),
    borderRadius: responsiveSize(13),
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  interestDot: {
    width: responsiveSize(6),
    height: responsiveSize(6),
    borderRadius: responsiveSize(3),
    backgroundColor: COLORS.primary,
  },
  interestText: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(12),
    fontWeight: '700',
  },
  interestEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(13),
    padding: responsiveSize(16),
    borderRadius: responsiveSize(17),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  interestEmptyCopy: {
    flex: 1,
  },
  interestEmptyTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(13),
    fontWeight: '800',
  },
  interestEmptyText: {
    marginTop: responsiveSize(3),
    color: COLORS.textMuted,
    fontSize: responsiveFont(11),
    lineHeight: responsiveFont(16),
  },

  linkGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: responsiveSize(9),
  },
  linkCard: {
    width: '48.5%',
    minHeight: responsiveSize(118),
    padding: responsiveSize(14),
    borderRadius: responsiveSize(17),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  linkTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  linkIcon: {
    width: responsiveSize(34),
    height: responsiveSize(34),
    borderRadius: responsiveSize(11),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,210,190,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.18)',
  },
  linkText: {
    marginTop: responsiveSize(14),
    color: COLORS.textPrimary,
    fontSize: responsiveFont(13),
    fontWeight: '900',
  },
  linkDetail: {
    marginTop: responsiveSize(3),
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    fontWeight: '600',
  },
});

export default YourBlypContent;
