import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, FlatList, ScrollView, TouchableOpacity, Image, StyleSheet, ActivityIndicator, RefreshControl, Modal, Alert } from "react-native";
import { subscribeToLiveStreams } from "../services/LiveService";
import { useNavigation, CommonActions, StackActions } from "@react-navigation/native";
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';
import AvatarRing from './motion/AvatarRing';
import { COLORS, SHADOWS, SURFACE_DEPTH } from '../styles/theme';
import { useAuth } from '../hooks/useCommon';
import { isFollowing, followUser, unfollowUser, getFollowersCount } from '../utils/followUtils';
import { getLiveSessionStatus } from '../api/ivsLiveApi';
import {
  getRootishNavigationState,
  shouldEjectEndedLiveProbe,
} from '../live/joinStatusPreflight';

export default function LiveUsersTab() {
  const [liveUsers, setLiveUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  // Bumped on a timer to force a fresh subscription. The directory query's
  // "recent heartbeat" cutoff is fixed at subscription time, so without this a
  // stream that goes stale while the list is open would never drop off. Periodic
  // re-subscription re-evaluates the cutoff and removes ended/crashed streams.
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const navigation = useNavigation();
  const joinLiveProbeGenRef = useRef(0);
  const insets = useSafeAreaInsets();
  const { uid } = useAuth();

  // Tapping a live opens a profile preview first (don't drop straight into the
  // room). Only the "Join live" button actually enters.
  const [previewItem, setPreviewItem] = useState(null);
  const [rel, setRel] = useState({ loading: false, iFollow: false, followers: 0 });
  const [relBusy, setRelBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setRefreshTick((n) => n + 1), 45 * 1000);
    return () => clearInterval(t);
  }, []);

  const previewHostUid = previewItem
    ? previewItem.hostUid || previewItem.userId || previewItem.uid || previewItem.creatorId || null
    : null;

  useEffect(() => {
    if (!previewItem || !previewHostUid) return undefined;
    let cancelled = false;
    setRel({ loading: true, iFollow: false, followers: 0 });
    (async () => {
      try {
        const [iFollow, followers] = await Promise.all([
          uid && uid !== previewHostUid ? isFollowing(uid, previewHostUid) : Promise.resolve(false),
          getFollowersCount(previewHostUid),
        ]);
        if (!cancelled) setRel({ loading: false, iFollow, followers });
      } catch {
        if (!cancelled) setRel({ loading: false, iFollow: false, followers: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [previewItem, previewHostUid, uid]);

  const togglePreviewFollow = useCallback(async () => {
    if (!uid || !previewHostUid || relBusy || uid === previewHostUid) return;
    const next = !rel.iFollow;
    setRelBusy(true);
    setRel((p) => ({ ...p, iFollow: next, followers: Math.max(0, (p.followers || 0) + (next ? 1 : -1)) }));
    try {
      const res = next
        ? await followUser(uid, previewHostUid)
        : await unfollowUser(uid, previewHostUid);
      if (!res?.success) throw res?.error || new Error('follow write failed');
    } catch {
      setRel((p) => ({ ...p, iFollow: !next, followers: Math.max(0, (p.followers || 0) + (next ? -1 : 1)) }));
    } finally {
      setRelBusy(false);
    }
  }, [uid, previewHostUid, rel.iFollow, relBusy]);

  const joinLive = useCallback((item) => {
    if (!item?.id && !item?.streamId) return;
    const streamId = item.streamId || item.id || item.liveId || item.sessionId || null;
    if (!streamId) return;

    // Navigate immediately so join-realtime / stage subscribe start in parallel
    // with the status probe. Blocking on Cognito+status added a full RTT before
    // first frame; join-realtime still clears ghosts on SESSION_NOT_FOUND.
    const probeGeneration = ++joinLiveProbeGenRef.current;
    const params = {
      mode: 'viewer',
      streamId,
      // hostUid may be missing on legacy/partial docs — LiveStreamScreen still
      // treats explicit mode:'viewer' + streamId as viewer (not Go Live).
      hostUid: item.hostUid || item.userId || item.uid || item.creatorId || null,
      hostDisplayName: item.hostDisplayName || item.hostUsername || 'Live Stream',
      source: 'LiveUsersTab',
      liveViewerIntent: true,
      implicitViewerIntent: true,
      __BLYP_LIVE_VIEWER_INTENT: 'viewer_tap_live_card',
    };
    setPreviewItem(null);
    // Pop must target the same navigator that received the push.
    let liveNav = navigation;
    try {
      const parentNav = typeof navigation?.getParent === 'function' ? navigation.getParent() : null;
      if (parentNav && typeof parentNav.dispatch === 'function') {
        parentNav.dispatch(StackActions.push('LiveStreamScreen', params));
        liveNav = parentNav;
      } else if (typeof navigation?.dispatch === 'function') {
        navigation.dispatch(StackActions.push('LiveStreamScreen', params));
      } else {
        navigation.dispatch(CommonActions.navigate({ name: 'LiveStreamScreen', params }));
      }
    } catch (e) {
      console.warn('[LiveUsersTab][NAVIGATE_ERROR]', e);
    }

    void getLiveSessionStatus(String(streamId))
      .then((status) => {
        if (status?.live) return;
        setRefreshTick((n) => n + 1);
        // Late !live must not eject after leave / another live / superseded open.
        // Pop on the same navigator that received the push (parent stack vs tab).
        if (!shouldEjectEndedLiveProbe({
          probeGeneration,
          currentGeneration: joinLiveProbeGenRef.current,
          expectedStreamId: streamId,
          navigationState: getRootishNavigationState(liveNav),
        })) {
          return;
        }
        Alert.alert(
          'Stream ended',
          'This live is no longer available. Pull to refresh the Live list.',
        );
        try {
          if (typeof liveNav?.canGoBack === 'function' && liveNav.canGoBack()) {
            liveNav.goBack();
          }
        } catch {
          // ignore
        }
      })
      .catch((probeErr) => {
        // Probe network failure: fall through (do not eject).
        console.warn('[LiveUsersTab][JOIN_PREFLIGHT_FAIL]', probeErr?.message || String(probeErr));
      });
  }, [navigation]);

  const openProfile = useCallback((item) => {
    const id = item?.hostUid || item?.userId || item?.uid || item?.creatorId;
    if (!id) return;
    setPreviewItem(null);
    try {
      navigation.navigate('UserProfile', { userId: String(id), username: item.hostUsername || item.hostDisplayName || '@user' });
    } catch { /* ignore */ }
  }, [navigation]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Force a fresh subscription (re-evaluates the "recent heartbeat" cutoff so
    // ended streams drop off immediately).
    setRefreshTick((n) => n + 1);
    // The subscription pushes new data asynchronously; clear the spinner shortly.
    setTimeout(() => setRefreshing(false), 900);
  }, []);

  useEffect(() => {
    console.log('[LiveUsersTab] subscribing to live streams');

    const unsub = subscribeToLiveStreams({
      onChange: (streams) => {
        console.log('[LiveUsersTab][DIRECTORY][SET_STREAMS]', {
          count: streams.length,
          ids: streams.map(s => s.id),
        });
        setLiveUsers(streams);
        setLoading(false);
      },
      onError: (error) => {
        console.warn('[LiveUsersTab][DIRECTORY][ERROR]', error);
        setLoading(false);
      },
    });

    return () => {
      if (typeof unsub === 'function') {
        console.log('[LiveUsersTab] unsubscribing from live streams');
        unsub();
      } else {
        console.warn('[LiveUsersTab] no unsubscribe function returned');
      }
    };
  }, [refreshTick]);

  if (loading) {
    return (
      <View style={[styles.centerContainer, { paddingTop: 0, backgroundColor: 'transparent' }]}>
        <ActivityIndicator size="large" color={COLORS.gradientEnd} />
        <Text style={styles.loadingText}>Loading live users...</Text>
      </View>
    );
  }

  if (!liveUsers.length) {
    console.log('LiveUsersTab: No live users, showing empty state');
    return (
      <ScrollView
        contentContainerStyle={[styles.centerContainer, { flexGrow: 1, backgroundColor: 'transparent' }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.gradientEnd} />
        }
      >
        <Icon name="radio-outline" size={56} color={COLORS.primary} style={styles.emptyIcon} />
        <Text style={styles.emptyTitle}>Nobody is live right now</Text>
        <Text style={styles.emptySubtitle}>Be the first to go live!</Text>
        <TouchableOpacity
          style={styles.prearrangeBtn}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('CreateBattle')}
        >
          <Icon name="flash" size={18} color="#0A0A0C" />
          <Text style={styles.prearrangeBtnText}>Prearrange a battle</Text>
        </TouchableOpacity>
        <Text style={styles.prearrangeHint}>Schedule vs a competitor with an optional forfeit stake</Text>
      </ScrollView>
    );
  }

  console.log('LiveUsersTab: Rendering FlatList with', liveUsers.length, 'users');

  const formatHandle = (handle) => {
    if (!handle) return null;
    const trimmed = String(handle).trim();
    if (!trimmed) return null;
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={liveUsers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContainer, { paddingTop: 0 }]}
        ListHeaderComponent={
          <TouchableOpacity
            style={styles.prearrangeBanner}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('CreateBattle')}
          >
            <Icon name="flash" size={18} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.prearrangeBannerTitle}>Prearrange a battle</Text>
              <Text style={styles.prearrangeBannerSub}>Pick opponent, time & forfeit stake</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.gradientEnd} />
        }
        renderItem={({ item }) => {
          const displayHandle = formatHandle(item.hostUsername);
          const displayName =
            displayHandle ||
            item.hostDisplayName ||
            item.hostUid ||
            item.userId ||
            'Unknown';

          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => setPreviewItem(item)}
              activeOpacity={0.7}
            >
              <View style={styles.avatarContainer}>
                <AvatarRing variant="live" size={60} ringWidth={2}>
                  <Image
                    source={{ uri: item.photoURL || "https://ui-avatars.com/api/?name=" + encodeURIComponent(displayName || "Live") }}
                    style={styles.avatar}
                  />
                </AvatarRing>
                <View style={styles.liveBadge}>
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
              </View>
              <View style={styles.infoContainer}>
                <Text style={styles.name} numberOfLines={1}>
                  {displayName}
                </Text>
                <View style={styles.statusRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.status}>Broadcasting now</Text>
                </View>
                {item.title && (
                  <Text style={styles.streamTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                )}
              </View>
              <View style={styles.chevron}>
                <Icon name="chevron-forward" size={22} color={COLORS.gradientEnd} />
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* Profile preview overlay — shown on tap, before entering the room. */}
      <Modal
        visible={!!previewItem}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewItem(null)}
      >
        <TouchableOpacity style={styles.previewBackdrop} activeOpacity={1} onPress={() => setPreviewItem(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.previewCard} onPress={() => {}}>
            {previewItem ? (
              <>
                <Image
                  source={{
                    uri:
                      previewItem.photoURL ||
                      'https://ui-avatars.com/api/?name=' +
                        encodeURIComponent(previewItem.hostDisplayName || previewItem.hostUsername || 'Live'),
                  }}
                  style={styles.previewAvatar}
                />
                <Text style={styles.previewName} numberOfLines={1}>
                  {formatHandle(previewItem.hostUsername) || previewItem.hostDisplayName || 'Live'}
                </Text>
                {previewItem.title ? (
                  <Text style={styles.previewTitle} numberOfLines={2}>{previewItem.title}</Text>
                ) : null}
                <View style={styles.previewStatsRow}>
                  <View style={styles.previewStat}>
                    <Text style={styles.previewStatValue}>{rel.loading ? '...' : rel.followers}</Text>
                    <Text style={styles.previewStatLabel}>Followers</Text>
                  </View>
                  <View style={styles.previewLivePill}>
                    <View style={styles.previewLiveDot} />
                    <Text style={styles.previewLivePillText}>LIVE</Text>
                  </View>
                </View>

                {uid && uid !== previewHostUid ? (
                  <TouchableOpacity
                    style={[styles.previewFollowBtn, rel.iFollow && styles.previewFollowBtnActive]}
                    onPress={togglePreviewFollow}
                    disabled={relBusy}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.previewFollowText, rel.iFollow && { color: '#fff' }]}>
                      {rel.iFollow ? 'Following' : 'Follow'}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity style={styles.previewJoinBtn} onPress={() => joinLive(previewItem)} activeOpacity={0.9}>
                  <Icon name="radio" size={18} color="#0A0A0C" />
                  <Text style={styles.previewJoinText}>Join live</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.previewProfileLink} onPress={() => openProfile(previewItem)} activeOpacity={0.7}>
                  <Text style={styles.previewProfileLinkText}>View profile</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  gradient: {
    flex: 1,
  },
  listContainer: {
    padding: 16,
  },
  comingSoon: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  comingSoonTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  comingSoonText: {
    color: '#e5e7eb',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#fff',
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
  },
  prearrangeBtn: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  prearrangeBtnText: {
    color: '#0A0A0C',
    fontWeight: '800',
    fontSize: 15,
  },
  prearrangeHint: {
    marginTop: 10,
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  prearrangeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.backgroundCard || '#121216',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.28)',
  },
  prearrangeBannerTitle: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  prearrangeBannerSub: {
    color: '#A1A1AA',
    fontSize: 12,
    marginTop: 2,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundCard || '#121216',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: SURFACE_DEPTH.highlightBorder,
    borderTopColor: SURFACE_DEPTH.highlightBorderStrong,
    ...SHADOWS.small,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 16,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  liveBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: '#FF0000',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 2,
    borderColor: '#1a1a2e',
  },
  liveText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  infoContainer: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF2D55',
    marginRight: 6,
  },
  status: {
    fontSize: 14,
    color: COLORS.gradientEnd,
    fontWeight: '600',
  },
  streamTitle: {
    fontSize: 13,
    color: '#aaa',
    marginTop: 4,
    fontStyle: 'italic',
  },
  chevron: {
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  previewCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#121214',
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: SURFACE_DEPTH.highlightBorderStrong,
    ...SHADOWS.medium,
  },
  previewAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  previewName: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 12,
  },
  previewTitle: {
    color: '#A1A1AA',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
  },
  previewStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginTop: 14,
  },
  previewStat: {
    alignItems: 'center',
  },
  previewStatValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  previewStatLabel: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 2,
  },
  previewLivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF0000',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 5,
  },
  previewLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  previewLivePillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  previewFollowBtn: {
    marginTop: 16,
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  previewFollowBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  previewFollowText: {
    color: COLORS.gradientEnd,
    fontWeight: '800',
    fontSize: 14,
  },
  previewJoinBtn: {
    marginTop: 10,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.gradientEnd,
  },
  previewJoinText: {
    color: '#0A0A0C',
    fontWeight: '800',
    fontSize: 16,
  },
  previewProfileLink: {
    marginTop: 12,
    paddingVertical: 4,
  },
  previewProfileLinkText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '600',
  },
});

