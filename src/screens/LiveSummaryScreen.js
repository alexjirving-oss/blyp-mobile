import React, { useCallback, useEffect, useMemo, useState } from 'react';
import BlueScreen from '../ui/BlueScreen';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CommonActions } from '@react-navigation/native';
import { useTheme } from '../styles/useTheme';
import { getEconomyStreamSummary } from '../api/economyLiveApi';
import { BLYP_LOGO_GRADIENT_COLORS } from '../components/BlypLogo';
import { db } from '../config/firebase';
import { snapData } from '../utils/firestoreSnap';

function tsToMillis(ts) {
  if (!ts) return null;
  try {
    if (typeof ts === 'number') return ts;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  } catch {
    // fall through
  }
  return null;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

function formatCount(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  return String(Math.floor(value));
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label || 'operation'}_timeout`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function StatTile({ styles, value, label, emphasize }) {
  return (
    <View style={[styles.statCard, emphasize ? styles.statCardEmphasize : null]}>
      <Text style={[styles.statValue, emphasize ? styles.statValueEmphasize : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function LiveSummaryScreen({ route, navigation }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const streamId = String(route?.params?.streamId || '').trim();
  const routeTitle = String(route?.params?.title || '').trim();
  const routeStartedAt = route?.params?.startedAt;
  const routeLikes = Number(route?.params?.likes || 0);
  const routePeak = Number(route?.params?.peakViewers || 0);
  const routeRole = String(route?.params?.role || route?.params?.mode || '').trim().toLowerCase();
  const battleId = String(route?.params?.battleId || '').trim();
  const gameName = String(route?.params?.gameName || route?.params?.lastGame || '').trim();
  const gamePrizeCoins = Number(route?.params?.gamePrizeCoins || 0);
  const gameWon = route?.params?.gameWon === true || route?.params?.gameWon === 'true';

  const provisionalStats = useMemo(() => {
    const startMs = typeof routeStartedAt === 'number' ? routeStartedAt : null;
    const durationMs = startMs ? Math.max(0, Date.now() - startMs) : null;
    if (!routeTitle && !startMs && !routeLikes && !routePeak && !streamId) return null;
    return {
      title: routeTitle || '',
      hostName: null,
      likes: Number.isFinite(routeLikes) ? routeLikes : 0,
      peakViewers: Number.isFinite(routePeak) ? routePeak : 0,
      totalViews: Number.isFinite(routePeak) ? routePeak : 0,
      durationMs,
      guestCount: 0,
      commentCount: 0,
    };
  }, [routeTitle, routeStartedAt, routeLikes, routePeak, streamId]);

  const [refreshing, setRefreshing] = useState(!!streamId);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(provisionalStats);
  const [economy, setEconomy] = useState(null);

  const load = useCallback(async () => {
    if (!streamId) {
      setStats(provisionalStats);
      setEconomy(null);
      setError(provisionalStats ? null : 'Missing stream id');
      setRefreshing(false);
      return;
    }

    setRefreshing(true);
    setError(null);
    if (provisionalStats) setStats(provisionalStats);

    let streamData = null;
    try {
      const snap = await withTimeout(db.collection('streams').doc(streamId).get(), 2500, 'streams_get');
      streamData = snapData(snap);
      if (!streamData) {
        const mirror = await withTimeout(db.collection('liveStreams').doc(streamId).get(), 2500, 'liveStreams_get');
        streamData = snapData(mirror);
      }
    } catch (e) {
      console.warn('[LiveSummary] Failed to read stream stats', e?.message || String(e));
    }

    if (streamData) {
      const startMs = tsToMillis(streamData.createdAt) || (typeof routeStartedAt === 'number' ? routeStartedAt : null);
      const endMs = tsToMillis(streamData.endedAt) || Date.now();
      const durationMs = startMs ? Math.max(0, endMs - startMs) : provisionalStats?.durationMs || null;

      const peak = Number(
        streamData.peakViewerCount ??
          streamData.totalViews ??
          streamData.viewerCount ??
          routePeak ??
          0
      );
      const total = Number(streamData.totalViews ?? streamData.peakViewerCount ?? routePeak ?? 0);

      setStats({
        title: streamData.title || routeTitle || '',
        hostName:
          streamData.hostUsername ||
          streamData.hostDisplayName ||
          streamData.displayName ||
          null,
        likes: Number(streamData.likes || routeLikes || 0),
        peakViewers: peak,
        totalViews: total,
        durationMs,
        guestCount: Number(streamData.guestCount || streamData.maxGuestsSeen || 0),
        commentCount: Number(streamData.commentCount || streamData.commentsCount || 0),
      });
    } else if (!provisionalStats) {
      setStats(null);
    }

    try {
      const s = await withTimeout(getEconomyStreamSummary(streamId), 4000, 'economy_summary');
      setEconomy(s || null);
    } catch (e) {
      console.warn('[LiveSummary] economy summary unavailable', e?.message || String(e));
      setEconomy(null);
    }

    if (!streamData && !provisionalStats) {
      setError('We couldn’t find stats for this live.');
    }
    setRefreshing(false);
  }, [streamId, provisionalStats, routeStartedAt, routeTitle, routeLikes, routePeak]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    const hardStop = setTimeout(() => {
      if (!cancelled) setRefreshing(false);
    }, 7000);
    return () => {
      cancelled = true;
      clearTimeout(hardStop);
    };
  }, [load]);

  const goHome = () => {
    try {
      if (typeof navigation?.dispatch === 'function') {
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'MainTabs' }],
          })
        );
        return;
      }
      if (typeof navigation?.navigate === 'function') {
        navigation.navigate('MainTabs');
        return;
      }
    } catch (e) {
      console.warn('[LiveSummary] Done navigation failed', e?.message || String(e));
    }
    if (typeof navigation?.goBack === 'function') {
      navigation.goBack();
    }
  };

  const goWallet = () => {
    try {
      if (typeof navigation?.navigate === 'function') {
        navigation.navigate('CoinStore');
        return;
      }
    } catch {
      // fall through
    }
    goHome();
  };

  const goLiveAgain = () => {
    try {
      if (typeof navigation?.navigate === 'function') {
        navigation.navigate('LiveStreamScreen', { mode: 'host' });
        return;
      }
    } catch {
      // fall through
    }
    goHome();
  };

  const viewer = economy?.viewer;
  const creator = economy?.creator;
  const hasEconomy = !!(viewer || creator);
  const shownStats = stats || provisionalStats;
  const isBroadcaster =
    routeRole === 'host' ||
    routeRole === 'broadcaster' ||
    !!creator ||
    (!viewer?.coinSpent && !routeRole);

  const coinsReceived = Number(creator?.coinsReceived || 0);
  const gemsEarned = Number(creator?.gemsEarned || 0);
  const giftsSent = Number(viewer?.giftCount || 0);
  const coinsSpent = Number(viewer?.coinSpent || 0);
  const facePence = gemsEarned; // 1 gem face = 1p
  const halfCheck =
    coinsReceived > 0 ? `≈ ${Math.floor(coinsReceived / 2)} gems expected at 50% gift share` : null;

  return (
    <BlueScreen>
      <View style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>{isBroadcaster ? 'Broadcast summary' : 'Live summary'}</Text>
            <Text style={styles.subtitle}>
              {isBroadcaster
                ? 'Gems, gifts, and audience — then cash out or go again'
                : 'What you spent and how the room performed'}
            </Text>
          </View>

          {!shownStats ? (
            <View style={styles.center}>
              {refreshing ? (
                <>
                  <ActivityIndicator color={theme.colors.accent} size="large" />
                  <Text style={styles.muted}>Loading summary…</Text>
                </>
              ) : (
                <>
                  <Text style={styles.errorTitle}>Couldn’t load summary</Text>
                  <Text style={styles.errorText}>{String(error || 'Missing stream data')}</Text>
                  <TouchableOpacity style={styles.retryBtn} onPress={load}>
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {shownStats && (shownStats.title || shownStats.hostName) ? (
                <View style={styles.streamHeader}>
                  {!!shownStats.title && <Text style={styles.streamTitle}>{shownStats.title}</Text>}
                  {!!shownStats.hostName && (
                    <Text style={styles.streamHost}>@{String(shownStats.hostName).replace(/^@/, '')}</Text>
                  )}
                  {battleId ? <Text style={styles.badge}>Battle live</Text> : null}
                  {gameName ? <Text style={styles.badge}>Game: {gameName}</Text> : null}
                </View>
              ) : null}

              <View style={styles.statsGrid}>
                <StatTile styles={styles} value={formatDuration(shownStats?.durationMs)} label="Duration" />
                <StatTile
                  styles={styles}
                  value={formatCount(shownStats?.peakViewers)}
                  label="Peak viewers"
                  emphasize
                />
                <StatTile styles={styles} value={formatCount(shownStats?.totalViews)} label="Total views" />
                <StatTile styles={styles} value={formatCount(shownStats?.likes)} label="Likes" />
              </View>

              {refreshing ? <Text style={styles.muted}>Refreshing earnings…</Text> : null}

              {isBroadcaster ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Creator earnings</Text>
                  <View style={styles.heroRow}>
                    <View style={styles.heroMetric}>
                      <Text style={styles.heroValue}>{formatCount(gemsEarned)}</Text>
                      <Text style={styles.heroLabel}>Gems earned</Text>
                      <Text style={styles.heroHint}>1 gem = 1p face</Text>
                    </View>
                    <View style={styles.heroMetric}>
                      <Text style={styles.heroValue}>{formatCount(coinsReceived)}</Text>
                      <Text style={styles.heroLabel}>Gift coins in</Text>
                      <Text style={styles.heroHint}>Fans spent these</Text>
                    </View>
                  </View>
                  <Text style={styles.row}>
                    Cash face value: <Text style={styles.value}>£{(facePence / 100).toFixed(2)}</Text>
                    {' '}(clears after hold before withdraw)
                  </Text>
                  {halfCheck ? <Text style={styles.hint}>{halfCheck} (platform half → gems)</Text> : null}
                  {!hasEconomy ? (
                    <Text style={styles.hint}>No gift earnings recorded for this session yet.</Text>
                  ) : null}
                </View>
              ) : null}

              {viewer && (giftsSent > 0 || coinsSpent > 0) ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Your gifts</Text>
                  <Text style={styles.row}>
                    Coins spent: <Text style={styles.value}>{formatCount(coinsSpent)}</Text>
                  </Text>
                  <Text style={styles.row}>
                    Gifts sent: <Text style={styles.value}>{formatCount(giftsSent)}</Text>
                  </Text>
                </View>
              ) : null}

              {(gameName || gamePrizeCoins > 0 || battleId) ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Games & battles</Text>
                  {battleId ? (
                    <Text style={styles.row}>
                      Battle session: <Text style={styles.value}>linked</Text>
                    </Text>
                  ) : null}
                  {gameName ? (
                    <Text style={styles.row}>
                      Last game: <Text style={styles.value}>{gameName}</Text>
                      {gameWon ? ' · you won' : ''}
                    </Text>
                  ) : null}
                  {gamePrizeCoins > 0 ? (
                    <Text style={styles.row}>
                      Prize coins: <Text style={styles.value}>{formatCount(gamePrizeCoins)}</Text>
                      {' '}(spendable COIN — gift path still halves → gems)
                    </Text>
                  ) : null}
                  <Text style={styles.hint}>
                    Game-won coins are real spendable balance. If gifted on live, creators still get half as gems.
                  </Text>
                </View>
              ) : null}

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Next steps</Text>
                {isBroadcaster && gemsEarned > 0 ? (
                  <Text style={styles.hint}>
                    Cleared gems can withdraw via Bank (Stripe primary) or PayPal backup in Wallet. Pending gems wait the clearance hold.
                  </Text>
                ) : (
                  <Text style={styles.hint}>
                    Go live again, or open Wallet to buy coins / convert gems.
                  </Text>
                )}
                <View style={styles.actionsCol}>
                  {isBroadcaster ? (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={goLiveAgain} activeOpacity={0.85}>
                      <Text style={styles.secondaryBtnText}>Go live again</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={styles.secondaryBtn} onPress={goWallet} activeOpacity={0.85}>
                    <Text style={styles.secondaryBtnText}>
                      {isBroadcaster ? 'Wallet · withdraw / convert' : 'Open wallet'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          )}

          <TouchableOpacity style={styles.doneBtn} onPress={goHome} accessibilityRole="button" accessibilityLabel="Done">
            <LinearGradient
              colors={BLYP_LOGO_GRADIENT_COLORS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.doneBtnGradient}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </BlueScreen>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    container: {
      flex: 1,
      padding: theme.spacing.lg,
    },
    header: {
      marginBottom: theme.spacing.md,
    },
    title: {
      color: theme.colors.textPrimary,
      fontSize: 24,
      fontWeight: '800',
    },
    subtitle: {
      color: theme.colors.textMuted,
      marginTop: 6,
      lineHeight: 20,
    },
    scroll: { flex: 1 },
    scrollContent: {
      gap: theme.spacing.md,
      paddingBottom: theme.spacing.md,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    muted: {
      color: theme.colors.textMuted,
      marginTop: theme.spacing.sm,
      textAlign: 'center',
    },
    errorTitle: {
      color: theme.colors.textPrimary,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: theme.spacing.sm,
      textAlign: 'center',
    },
    errorText: {
      color: theme.colors.error,
      textAlign: 'center',
      marginBottom: theme.spacing.md,
    },
    retryBtn: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.sm,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    retryText: {
      color: theme.colors.textPrimary,
      fontWeight: '600',
    },
    streamHeader: {
      marginBottom: 2,
      gap: 4,
    },
    streamTitle: {
      color: theme.colors.textPrimary,
      fontSize: 18,
      fontWeight: '700',
    },
    streamHost: {
      color: theme.colors.textMuted,
      fontSize: 14,
    },
    badge: {
      alignSelf: 'flex-start',
      marginTop: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      overflow: 'hidden',
      color: '#04201D',
      backgroundColor: theme.colors.accent || '#00D2BE',
      fontSize: 12,
      fontWeight: '700',
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    statCard: {
      width: '48%',
      backgroundColor: theme.colors.surface || 'rgba(255,255,255,0.06)',
      borderRadius: 14,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.sm,
      alignItems: 'center',
    },
    statCardEmphasize: {
      borderWidth: 1,
      borderColor: 'rgba(0,210,190,0.35)',
    },
    statValue: {
      color: theme.colors.textPrimary,
      fontSize: 20,
      fontWeight: '800',
    },
    statValueEmphasize: {
      color: theme.colors.accent || '#00D2BE',
    },
    statLabel: {
      color: theme.colors.textMuted,
      marginTop: 4,
      fontSize: 12,
    },
    card: {
      backgroundColor: theme.colors.surface || 'rgba(255,255,255,0.06)',
      borderRadius: 14,
      padding: theme.spacing.md,
      gap: 6,
    },
    cardTitle: {
      color: theme.colors.textPrimary,
      fontWeight: '700',
      marginBottom: 4,
      fontSize: 16,
    },
    heroRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginBottom: 6,
    },
    heroMetric: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.22)',
      borderRadius: 12,
      padding: theme.spacing.sm,
    },
    heroValue: {
      color: theme.colors.accent || '#00D2BE',
      fontSize: 28,
      fontWeight: '800',
    },
    heroLabel: {
      color: theme.colors.textPrimary,
      fontWeight: '700',
      marginTop: 2,
    },
    heroHint: {
      color: theme.colors.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    row: {
      color: theme.colors.textMuted,
      lineHeight: 20,
    },
    value: {
      color: theme.colors.textPrimary,
      fontWeight: '700',
    },
    hint: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 4,
    },
    actionsCol: {
      marginTop: 8,
      gap: 8,
    },
    secondaryBtn: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.border || 'rgba(255,255,255,0.16)',
      paddingVertical: 12,
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.04)',
    },
    secondaryBtnText: {
      color: theme.colors.textPrimary,
      fontWeight: '700',
    },
    doneBtn: {
      marginTop: theme.spacing.md,
      borderRadius: 999,
      overflow: 'hidden',
    },
    doneBtnGradient: {
      paddingVertical: 14,
      alignItems: 'center',
    },
    doneBtnText: {
      color: '#041016',
      fontWeight: '800',
      fontSize: 16,
    },
  });
}
