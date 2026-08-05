import React, { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, ScrollView, TouchableOpacity, Image, StyleSheet, ActivityIndicator, RefreshControl, Modal } from "react-native";
import { subscribeToLiveStreams } from "../services/LiveService";
import { useNavigation, CommonActions, StackActions } from "@react-navigation/native";
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';
import AvatarRing from './motion/AvatarRing';
import { COLORS, SHADOWS, SURFACE_DEPTH } from '../styles/theme';
import { useAuth } from '../hooks/useCommon';
import { isFollowing, followUser, unfollowUser, getFollowersCount } from '../utils/followUtils';

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
    if (!item?.id) return;
    const params = {
      mode: 'viewer',
      streamId: item.streamId || item.id || item.liveId || item.sessionId || null,
      hostUid: item.hostUid || item.userId || item.uid || item.creatorId || null,
      hostDisplayName: item.hostDisplayName || item.hostUsername || 'Live Stream',
      source: 'LiveUsersTab',
      liveViewerIntent: true,
      implicitViewerIntent: true,
      __BLYP_LIVE_VIEWER_INTENT: 'viewer_tap_live_card',
    };
    setPreviewItem(null);
    try {
      const parentNav = typeof navigation?.getParent === 'function' ? navigation.getParent() : null;
      if (parentNav && typeof parentNav.dispatch === 'function') {
        parentNav.dispatch(StackActions.push('LiveStreamScreen', params));
      } else if (typeof navigation?.dispatch === 'function') {
        navigation.dispatch(StackActions.push('LiveStreamScreen', params));
      } else {
        navigation.dispatch(CommonActions.navigate({ name: 'LiveStreamScreen', params }));
      }
    } catch (e) {
      console.warn('[LiveUsersTab][NAVIGATE_ERROR]', e);
    }
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
    console.log('Ã¢Å¡Â Ã¯Â¸Â LiveUsersTab: No live users, showing empty state');
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
      </ScrollView>
    );
  }

  console.log('Ã¢Å“â€¦ LiveUsersTab: Rendering FlatList with', liveUsers.length, 'users');

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
                  <Text style={styles.liveIndicator}>ðŸ”´</Text>
                  <Text style={styles.status}>Broadcasting now</Text>
                </View>
                {item.title && (
                  <Text style={styles.streamTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                )}
              </View>
              <View style={styles.chevron}>
                <Text style={styles.chevronText}>â€º</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* Profile preview overlay â€” shown on tap, before entering the room. */}
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
                    <Text style={styles.previewStatValue}>{rel.loading ? 'â€¦' : rel.followers}</Text>
                    <Text style={styles.previewStatLabel}>Followers</Text>
                  </View>
                  <View style={styles.previewLivePill}>
                    <Text style={styles.previewLivePillText}>â— LIVE</Text>
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderTopColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
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
  liveIndicator: {
    fontSize: 12,
    marginRight: 4,
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
  },
  chevronText: {
    fontSize: 32,
    color: COLORS.gradientEnd,
    fontWeight: '300',
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
    backgroundColor: '#FF0000',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
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

