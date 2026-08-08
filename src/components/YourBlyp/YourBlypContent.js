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
import { getProfileStats } from '../../services/profileStatsService';
import { getCreatorInsights } from '../../api/economyLiveApi';
import { fixStorageUrl } from '../../utils/urlUtils';

const fmt = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
};

const fmtDuration = (seconds) => {
  const totalMinutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

const PERIODS = [
  { key: 'week', label: '7 days', detail: 'the last 7 days' },
  { key: 'month', label: '30 days', detail: 'the last 30 days' },
  { key: 'all', label: 'All time', detail: 'all time' },
];

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

const InsightMetric = ({ icon, label, value, detail, color = COLORS.primary }) => (
  <View style={styles.insightMetric}>
    <View style={[styles.insightIcon, { backgroundColor: `${color}18` }]}>
      <Icon name={icon} size={17} color={color} />
    </View>
    <Text style={styles.insightValue} numberOfLines={1} adjustsFontSizeToFit>
      {value}
    </Text>
    <Text style={styles.insightLabel}>{label}</Text>
    {detail ? <Text style={styles.insightDetail}>{detail}</Text> : null}
  </View>
);

const GiftMetric = ({ icon, label, count, coins, detail, color }) => (
  <View style={styles.giftMetric}>
    <View style={[styles.giftMetricIcon, { backgroundColor: `${color}18` }]}>
      <Icon name={icon} size={18} color={color} />
    </View>
    <View style={styles.giftMetricCopy}>
      <Text style={styles.giftMetricLabel}>{label}</Text>
      <View style={styles.giftMetricValues}>
        <Text style={styles.giftMetricValue}>{fmt(count)} gifts</Text>
        <View style={styles.giftMetricDot} />
        <Text style={styles.giftMetricCoins}>{fmt(coins)} coins</Text>
      </View>
      {detail ? <Text style={styles.giftMetricDetail}>{detail}</Text> : null}
    </View>
  </View>
);

const PeopleList = ({ title, eyebrow, people, emptyText }) => (
  <View style={styles.peoplePanel}>
    <View style={styles.peopleHeading}>
      <Text style={styles.peopleEyebrow}>{eyebrow}</Text>
      <Text style={styles.peopleTitle}>{title}</Text>
    </View>
    {people.length > 0 ? (
      people.map((person, index) => {
        const avatar = person.photoURL ? fixStorageUrl(person.photoURL) : null;
        return (
          <View
            key={person.userId}
            style={[styles.personRow, index === people.length - 1 && styles.personRowLast]}
          >
            <View style={styles.personRank}>
              <Text style={styles.personRankText}>{index + 1}</Text>
            </View>
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.personAvatar} />
            ) : (
              <View style={[styles.personAvatar, styles.personAvatarFallback]}>
                <Icon name="person-outline" size={17} color={COLORS.textMuted} />
              </View>
            )}
            <View style={styles.personCopy}>
              <Text style={styles.personName} numberOfLines={1}>
                {person.displayName}
              </Text>
              <Text style={styles.personMeta} numberOfLines={1}>
                {person.handle ? `@${person.handle} · ` : ''}
                {fmt(person.giftCount)} gifts
              </Text>
            </View>
            <View style={styles.personCoins}>
              <Icon name="sparkles" size={12} color={COLORS.warning} />
              <Text style={styles.personCoinsText}>{fmt(person.coins)}</Text>
            </View>
          </View>
        );
      })
    ) : (
      <View style={styles.peopleEmpty}>
        <Icon name="gift" size={19} color={COLORS.textMuted} />
        <Text style={styles.peopleEmptyText}>{emptyText}</Text>
      </View>
    )}
  </View>
);

const YourBlypContent = ({ navigation }) => {
  const { uid } = useAuth();
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const entrance = useRef(new Animated.Value(0)).current;

  const requestData = useCallback(async (selectedPeriod = 'month') => {
    const [nextStats, nextAnalytics] = await Promise.all([
      getProfileStats(uid),
      getCreatorInsights(selectedPeriod),
    ]);
    return { nextStats, nextAnalytics };
  }, [uid]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setStats(null);
    setAnalytics(null);
    setPeriod('month');

    requestData('month')
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
    if (loading || (error && !analytics)) return undefined;
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
  }, [analytics, entrance, error, loading]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { nextStats, nextAnalytics } = await requestData(period);
      setStats(nextStats);
      setAnalytics(nextAnalytics);
      setError('');
    } catch {
      setError(
        analytics
          ? 'This snapshot could not be refreshed right now.'
          : 'Your creator insights could not be refreshed right now.',
      );
    } finally {
      setRefreshing(false);
    }
  }, [analytics, period, requestData]);

  const retry = useCallback(() => {
    setLoading(true);
    setError('');
    requestData(period)
      .then(({ nextStats, nextAnalytics }) => {
        setStats(nextStats);
        setAnalytics(nextAnalytics);
      })
      .catch(() => setError('Your creator insights could not be loaded right now.'))
      .finally(() => setLoading(false));
  }, [period, requestData]);

  const selectPeriod = useCallback(
    async (nextPeriod) => {
      if (nextPeriod === period || periodLoading) return;
      setPeriodLoading(true);
      setError('');
      try {
        const nextAnalytics = await getCreatorInsights(nextPeriod);
        setAnalytics(nextAnalytics);
        setPeriod(nextPeriod);
      } catch {
        setError('That time range could not be loaded. Your previous snapshot is still shown.');
      } finally {
        setPeriodLoading(false);
      }
    },
    [period, periodLoading],
  );

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

  if (error && !analytics) {
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

  const content = analytics?.content || {};
  const live = analytics?.live || {};
  const audience = analytics?.audience || {};
  const gifts = analytics?.gifts || {};
  const battles = analytics?.battles || {};
  const periodMeta = PERIODS.find((item) => item.key === period) || PERIODS[1];
  const likesReceived = (Number(content.likesReceived) || 0) + (Number(live.likesReceived) || 0);
  const viewsReceived = (Number(content.views) || 0) + (Number(live.views) || 0);
  const followerValue =
    period === 'all' ? Number(audience.followersTotal) || 0 : Number(audience.followersGained) || 0;
  const followerLabel = period === 'all' ? 'Followers' : 'New followers';
  const hasCreatorActivity = [
    content.publishedCount,
    live.sessionCount,
    likesReceived,
    gifts?.posts?.count,
    gifts?.live?.count,
    gifts?.sent?.count,
    battles.played,
  ].some((value) => Number(value) > 0);
  const hasGiftActivity = [
    gifts?.posts?.count,
    gifts?.live?.count,
    gifts?.sent?.count,
  ].some((value) => Number(value) > 0);
  const interests = Array.isArray(stats?.interests) ? stats.interests : [];
  const bestThumb = content?.bestPost?.thumbnail
    ? fixStorageUrl(content.bestPost.thumbnail)
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
              <Text style={styles.heroEyebrow}>CREATOR INSIGHTS</Text>
              <Text style={styles.heroTitle}>Your Blyp, in focus</Text>
              <Text style={styles.heroSubtitle}>
                {hasCreatorActivity
                  ? `Your output, audience and support across ${periodMeta.detail}.`
                  : `Create, go live or join a battle. Your ${periodMeta.label.toLowerCase()} signal will build here.`}
              </Text>
            </View>
          </View>

          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>
              {periodLoading ? 'UPDATING SIGNAL' : hasCreatorActivity ? 'LIVE DATA' : 'READY WHEN YOU ARE'}
            </Text>
            {periodLoading ? (
              <ActivityIndicator style={styles.statusSpinner} size="small" color={COLORS.primary} />
            ) : null}
          </View>

          <View style={styles.periodTabs} accessibilityRole="tablist">
            {PERIODS.map((item) => {
              const active = period === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active, disabled: periodLoading }}
                  accessibilityLabel={`Show creator insights for ${item.label}`}
                  style={[styles.periodTab, active && styles.periodTabActive]}
                  activeOpacity={0.82}
                  disabled={periodLoading}
                  onPress={() => selectPeriod(item.key)}
                >
                  <Text style={[styles.periodTabText, active && styles.periodTabTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.heroMetrics}>
            <HeroMetric label="Published" value={content.publishedCount} color={COLORS.primary} />
            <View style={styles.metricDivider} />
            <HeroMetric label="Likes" value={likesReceived} color={COLORS.error} />
            <View style={styles.metricDivider} />
            <HeroMetric label={followerLabel} value={followerValue} color={COLORS.info} />
          </View>
        </LinearGradient>

        {error ? (
          <View style={styles.inlineNotice}>
            <Icon name="cloud-offline-outline" size={17} color={COLORS.warning} />
            <Text style={styles.inlineNoticeText}>{error}</Text>
          </View>
        ) : null}

        {analytics?.availability?.resultCapped ? (
          <View style={styles.inlineNotice}>
            <Icon name="alert-circle-outline" size={17} color={COLORS.warning} />
            <Text style={styles.inlineNoticeText}>
              Very large account: totals include the most recent 1,000 posts and live sessions.
            </Text>
          </View>
        ) : null}

        <SectionHeading
          eyebrow="CREATOR SIGNAL"
          title="What you made happen"
          detail={`Engagement totals are from posts published in ${periodMeta.detail}; gifts and live time use events inside the window.`}
        />
        <View style={styles.insightGrid}>
          <InsightMetric
            icon="radio-outline"
            label="Time live"
            value={fmtDuration(live.durationSeconds)}
            detail={`${fmt(live.sessionCount)} sessions`}
            color={COLORS.primary}
          />
          <InsightMetric
            icon="create-outline"
            label="Published"
            value={fmt(content.publishedCount)}
            detail={`${fmt(content.videoCount)} videos · ${fmt(content.postCount)} posts`}
            color={COLORS.electric}
          />
          <InsightMetric
            icon="heart"
            label="Likes received"
            value={fmt(likesReceived)}
            detail={`${fmt(content.likesReceived)} posts · ${fmt(live.likesReceived)} live`}
            color={COLORS.error}
          />
          <InsightMetric
            icon="eye-outline"
            label="Views"
            value={fmt(viewsReceived)}
            detail={`Best live peak ${fmt(live.peakViewers)}`}
            color={COLORS.info}
          />
          <InsightMetric
            icon="time-outline"
            label="Watch time"
            value={fmtDuration(content.watchTimeSeconds)}
            detail={`${fmt(content.completions)} completions`}
            color={COLORS.electric}
          />
          <InsightMetric
            icon="chatbubble-outline"
            label="Comments"
            value={fmt(content.commentsReceived)}
            detail="On published posts"
            color={COLORS.success}
          />
          <InsightMetric
            icon="share-social-outline"
            label="Shares"
            value={fmt(content.shares)}
            detail="On published posts"
            color={COLORS.warning}
          />
          <InsightMetric
            icon="person-add"
            label={followerLabel}
            value={fmt(followerValue)}
            detail={`${fmt(audience.followersTotal)} total`}
            color={COLORS.info}
          />
          <InsightMetric
            icon="trophy-outline"
            label="Battle record"
            value={`${fmt(battles.wins)}-${fmt(battles.losses)}`}
            detail={`${fmt(battles.draws)} draws · ${fmt(battles.played)} played`}
            color={COLORS.warning}
          />
        </View>

        {!hasCreatorActivity ? (
          <View style={styles.sectionEmpty}>
            <View style={styles.sectionEmptyIcon}>
              <Icon name="pulse-outline" size={23} color={COLORS.primary} />
            </View>
            <View style={styles.sectionEmptyCopy}>
              <Text style={styles.sectionEmptyTitle}>No creator activity in this window</Text>
              <Text style={styles.sectionEmptyText}>
                Try another range, publish a post or start a live to begin building your signal.
              </Text>
            </View>
          </View>
        ) : null}

        <SectionHeading
          eyebrow="GIFTS & SUPPORT"
          title="How support is moving"
          detail={`Gift ledger activity across ${periodMeta.detail}. Counts are gift items, not taps.`}
        />
        <View style={styles.giftPanel}>
          <GiftMetric
            icon="play-circle-outline"
            label="On your videos & posts"
            count={gifts?.posts?.count}
            coins={gifts?.posts?.coins}
            detail={`${fmt(gifts?.posts?.events)} gift sends`}
            color={COLORS.electric}
          />
          <GiftMetric
            icon="radio-outline"
            label="During live sessions"
            count={gifts?.live?.count}
            coins={gifts?.live?.coins}
            detail={`${fmt(gifts?.live?.events)} gift sends`}
            color={COLORS.primary}
          />
          <GiftMetric
            icon="send-outline"
            label="You sent"
            count={gifts?.sent?.count}
            coins={gifts?.sent?.coins}
            detail={`${fmt(gifts?.sent?.people)} people gifted`}
            color={COLORS.warning}
          />
        </View>

        {!hasGiftActivity ? (
          <View style={styles.sectionEmpty}>
            <View style={styles.sectionEmptyIcon}>
              <Icon name="gift" size={23} color={COLORS.primary} />
            </View>
            <View style={styles.sectionEmptyCopy}>
              <Text style={styles.sectionEmptyTitle}>No gifts in this window</Text>
              <Text style={styles.sectionEmptyText}>
                Gifts you receive and send will appear here with their real coin totals.
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.peopleStack}>
          <PeopleList
            eyebrow="TOP GIFTERS"
            title="Who supports you"
            people={Array.isArray(gifts.topGifters) ? gifts.topGifters : []}
            emptyText="No supporters to rank in this window yet."
          />
          <PeopleList
            eyebrow="TOP GIFTED"
            title="Who you support"
            people={Array.isArray(gifts.topGifted) ? gifts.topGifted : []}
            emptyText="People you gift will be ranked here."
          />
        </View>

        <SectionHeading
          eyebrow="TOP CONTENT"
          title="Your strongest post"
          detail={`Ranked by likes, comments, shares and views among work published in ${periodMeta.detail}.`}
        />
        {content.bestPost ? (
          <View style={styles.creatorPanel}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Open top post: ${content.bestPost.title || 'Post'}`}
                style={styles.bestCard}
                activeOpacity={0.86}
                onPress={() => navigate('MediaViewer', { post: { ...content.bestPost } })}
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
                    <Text style={styles.bestEyebrow}>BEST IN THIS WINDOW</Text>
                  </View>
                  <Text style={styles.bestTitle} numberOfLines={2}>
                    {content.bestPost.title}
                  </Text>
                  <View style={styles.bestMeta}>
                    <Icon name="heart" size={13} color={COLORS.error} />
                    <Text style={styles.bestMetaText}>{fmt(content.bestPost.likes)}</Text>
                    <Icon name="chatbubble" size={13} color={COLORS.info} style={styles.bestMetaIcon} />
                    <Text style={styles.bestMetaText}>{fmt(content.bestPost.comments)}</Text>
                    <Icon name="eye-outline" size={13} color={COLORS.success} style={styles.bestMetaIcon} />
                    <Text style={styles.bestMetaText}>{fmt(content.bestPost.views)}</Text>
                    <Icon name="chevron-forward" size={16} color={COLORS.textMuted} style={styles.bestChevron} />
                  </View>
                </View>
              </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.creatorEmpty}>
            <View style={styles.creatorEmptyIcon}>
              <Icon name="create-outline" size={25} color={COLORS.primary} />
            </View>
            <View style={styles.creatorEmptyCopy}>
              <Text style={styles.creatorEmptyTitle}>Nothing published in this window</Text>
              <Text style={styles.creatorEmptyText}>
                Switch ranges to find older work, or publish your next Blyp to start a new signal.
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
          eyebrow="YOUR RHYTHM"
          title="What you keep close"
          detail="Personal totals that sit outside the creator time filter."
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
  statusSpinner: {
    marginLeft: responsiveSize(7),
    transform: [{ scale: 0.68 }],
  },
  periodTabs: {
    flexDirection: 'row',
    marginTop: responsiveSize(15),
    padding: responsiveSize(3),
    borderRadius: responsiveSize(13),
    backgroundColor: 'rgba(0,0,0,0.24)',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  periodTab: {
    flex: 1,
    minHeight: responsiveSize(34),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: responsiveSize(10),
  },
  periodTabActive: {
    backgroundColor: 'rgba(0,210,190,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.28)',
  },
  periodTabText: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    fontWeight: '800',
  },
  periodTabTextActive: {
    color: COLORS.primaryLight,
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

  inlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(9),
    marginTop: responsiveSize(10),
    paddingHorizontal: responsiveSize(13),
    paddingVertical: responsiveSize(11),
    borderRadius: responsiveSize(13),
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.18)',
  },
  inlineNoticeText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: responsiveFont(10),
    lineHeight: responsiveFont(15),
    fontWeight: '600',
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

  insightGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: responsiveSize(9),
  },
  insightMetric: {
    width: '48.5%',
    minHeight: responsiveSize(132),
    paddingHorizontal: responsiveSize(13),
    paddingVertical: responsiveSize(13),
    borderRadius: responsiveSize(17),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  insightIcon: {
    width: responsiveSize(32),
    height: responsiveSize(32),
    borderRadius: responsiveSize(11),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: responsiveSize(10),
  },
  insightValue: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(20),
    lineHeight: responsiveFont(23),
    fontWeight: '900',
    letterSpacing: -0.35,
  },
  insightLabel: {
    marginTop: responsiveSize(4),
    color: COLORS.textSecondary,
    fontSize: responsiveFont(11),
    fontWeight: '800',
  },
  insightDetail: {
    marginTop: responsiveSize(4),
    color: COLORS.textMuted,
    fontSize: responsiveFont(9),
    lineHeight: responsiveFont(13),
    fontWeight: '600',
  },
  sectionEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(12),
    marginTop: responsiveSize(10),
    padding: responsiveSize(14),
    borderRadius: responsiveSize(16),
    backgroundColor: 'rgba(0,210,190,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.14)',
  },
  sectionEmptyIcon: {
    width: responsiveSize(42),
    height: responsiveSize(42),
    borderRadius: responsiveSize(14),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,210,190,0.10)',
  },
  sectionEmptyCopy: {
    flex: 1,
  },
  sectionEmptyTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(12),
    fontWeight: '900',
  },
  sectionEmptyText: {
    marginTop: responsiveSize(3),
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    lineHeight: responsiveFont(15),
  },

  giftPanel: {
    borderRadius: responsiveSize(20),
    paddingHorizontal: responsiveSize(13),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  giftMetric: {
    minHeight: responsiveSize(91),
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: responsiveSize(13),
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  giftMetricIcon: {
    width: responsiveSize(39),
    height: responsiveSize(39),
    borderRadius: responsiveSize(13),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: responsiveSize(12),
  },
  giftMetricCopy: {
    flex: 1,
    minWidth: 0,
  },
  giftMetricLabel: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(10),
    fontWeight: '800',
  },
  giftMetricValues: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: responsiveSize(4),
  },
  giftMetricValue: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(15),
    fontWeight: '900',
  },
  giftMetricDot: {
    width: responsiveSize(3),
    height: responsiveSize(3),
    borderRadius: responsiveSize(2),
    marginHorizontal: responsiveSize(7),
    backgroundColor: COLORS.textDisabled,
  },
  giftMetricCoins: {
    color: COLORS.warning,
    fontSize: responsiveFont(12),
    fontWeight: '800',
  },
  giftMetricDetail: {
    marginTop: responsiveSize(4),
    color: COLORS.textMuted,
    fontSize: responsiveFont(9),
    fontWeight: '600',
  },

  peopleStack: {
    gap: responsiveSize(10),
    marginTop: responsiveSize(12),
  },
  peoplePanel: {
    paddingHorizontal: responsiveSize(13),
    paddingTop: responsiveSize(14),
    borderRadius: responsiveSize(20),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  peopleHeading: {
    paddingBottom: responsiveSize(10),
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  peopleEyebrow: {
    color: COLORS.primary,
    fontSize: responsiveFont(8),
    fontWeight: '900',
    letterSpacing: 1.25,
  },
  peopleTitle: {
    marginTop: responsiveSize(3),
    color: COLORS.textPrimary,
    fontSize: responsiveFont(14),
    fontWeight: '900',
  },
  personRow: {
    minHeight: responsiveSize(66),
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  personRowLast: {
    borderBottomWidth: 0,
  },
  personRank: {
    width: responsiveSize(22),
    alignItems: 'flex-start',
  },
  personRankText: {
    color: COLORS.textDisabled,
    fontSize: responsiveFont(9),
    fontWeight: '900',
  },
  personAvatar: {
    width: responsiveSize(37),
    height: responsiveSize(37),
    borderRadius: responsiveSize(13),
    backgroundColor: COLORS.surfaceAlt,
  },
  personAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  personCopy: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: responsiveSize(10),
  },
  personName: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(11),
    fontWeight: '800',
  },
  personMeta: {
    marginTop: responsiveSize(3),
    color: COLORS.textMuted,
    fontSize: responsiveFont(9),
    fontWeight: '600',
  },
  personCoins: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(4),
    paddingHorizontal: responsiveSize(8),
    paddingVertical: responsiveSize(6),
    borderRadius: responsiveSize(10),
    backgroundColor: 'rgba(251,191,36,0.08)',
  },
  personCoinsText: {
    color: COLORS.warning,
    fontSize: responsiveFont(10),
    fontWeight: '900',
  },
  peopleEmpty: {
    minHeight: responsiveSize(70),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: responsiveSize(8),
  },
  peopleEmptyText: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    fontWeight: '600',
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
