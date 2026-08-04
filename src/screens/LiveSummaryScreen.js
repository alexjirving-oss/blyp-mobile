import React, { useCallback, useEffect, useMemo, useState } from 'react';
import BlueScreen from '../ui/BlueScreen';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  return String(value);
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

export default function LiveSummaryScreen({ route, navigation }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const streamId = String(route?.params?.streamId || '').trim();
  const routeTitle = String(route?.params?.title || '').trim();
  const routeStartedAt = route?.params?.startedAt;
  const routeLikes = Number(route?.params?.likes || 0);
  const routePeak = Number(route?.params?.peakViewers || 0);

  const provisionalStats = useMemo(() => {
    const startMs = typeof routeStartedAt === 'number' ? routeStartedAt : null;
    const durationMs = startMs ? Math.max(0, Date.now() - startMs) : null;
    // Always have something to render when we at least know the stream id,
    // so "Loading summary…" never traps the host after End Live.
    if (!routeTitle && !startMs && !routeLikes && !routePeak && !streamId) return null;
    return {
      title: routeTitle || '',
      hostName: null,
      likes: Number.isFinite(routeLikes) ? routeLikes : 0,
      peakViewers: Number.isFinite(routePeak) ? routePeak : 0,
      totalViews: Number.isFinite(routePeak) ? routePeak : 0,
      durationMs,
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

  const onDone = () => {
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

  const viewer = economy?.viewer;
  const creator = economy?.creator;
  const hasEconomy = !!(viewer || creator);
  const shownStats = stats || provisionalStats;

  return (
    <BlueScreen>
      <View style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Live ended</Text>
            <Text style={styles.subtitle}>Here’s how your live performed</Text>
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
            <View style={styles.body}>
              {shownStats && (shownStats.title || shownStats.hostName) ? (
                <View style={styles.streamHeader}>
                  {!!shownStats.title && <Text style={styles.streamTitle}>{shownStats.title}</Text>}
                  {!!shownStats.hostName && (
                    <Text style={styles.streamHost}>@{String(shownStats.hostName).replace(/^@/, '')}</Text>
                  )}
                </View>
              ) : null}

              <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{formatDuration(shownStats?.durationMs)}</Text>
                  <Text style={styles.statLabel}>Duration</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{formatCount(shownStats?.peakViewers)}</Text>
                  <Text style={styles.statLabel}>Peak viewers</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{formatCount(shownStats?.totalViews)}</Text>
                  <Text style={styles.statLabel}>Total views</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{formatCount(shownStats?.likes)}</Text>
                  <Text style={styles.statLabel}>Likes</Text>
                </View>
              </View>

              {refreshing ? <Text style={styles.muted}>Refreshing earnings…</Text> : null}

              {hasEconomy ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Earnings & gifts</Text>
                  {creator ? (
                    <>
                      <Text style={styles.row}>
                        Coins received: <Text style={styles.value}>{Number(creator.coinsReceived || 0)}</Text>
                      </Text>
                      <Text style={styles.row}>
                        Gems earned: <Text style={styles.value}>{Number(creator.gemsEarned || 0)}</Text>
                      </Text>
                    </>
                  ) : null}
                  {viewer ? (
                    <>
                      <Text style={styles.row}>
                        Coins spent: <Text style={styles.value}>{Number(viewer.coinSpent || 0)}</Text>
                      </Text>
                      <Text style={styles.row}>
                        Gifts sent: <Text style={styles.value}>{Number(viewer.giftCount || 0)}</Text>
                      </Text>
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
          )}

          <TouchableOpacity style={styles.doneBtn} onPress={onDone} accessibilityRole="button" accessibilityLabel="Done">
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
      marginBottom: theme.spacing.lg,
    },
    title: {
      color: theme.colors.textPrimary,
      fontSize: 24,
      fontWeight: '800',
    },
    subtitle: {
      color: theme.colors.textMuted,
      marginTop: 6,
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
    body: {
      flex: 1,
      gap: theme.spacing.md,
    },
    streamHeader: {
      marginBottom: theme.spacing.xs,
    },
    streamTitle: {
      color: theme.colors.textPrimary,
      fontSize: 18,
      fontWeight: '700',
    },
    streamHost: {
      color: theme.colors.textMuted,
      marginTop: 2,
      fontSize: 14,
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
    statValue: {
      color: theme.colors.textPrimary,
      fontSize: 20,
      fontWeight: '800',
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
    },
    row: {
      color: theme.colors.textMuted,
    },
    value: {
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
