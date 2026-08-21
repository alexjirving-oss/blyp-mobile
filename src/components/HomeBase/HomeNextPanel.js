import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import {
  getForYouPosts,
  getTrendingPosts,
  getFollowingPosts,
  getLiveNow,
  streamThumbnail,
} from '../../services/discoveryService';
import { postThumbnail } from '../../services/blypAiService';
import { subscribeWatchHistory } from '../../services/watchHistoryService';
import { mediaViewerParams } from '../../utils/mediaViewerPlaylist';
import { fixStorageUrl } from '../../utils/urlUtils';
import { firestore, firebaseEnabled } from '../../config/firebase';
import { conversationsMessagingService } from '../../services/messaging';
import {
  fetchMessengerUserProfiles,
  resolveUserPhoto,
} from '../../services/messaging/resolveMessengerUser';
import { getLiveSessionStatus } from '../../api/ivsLiveApi';
import {
  getRootishNavigationState,
  shouldEjectEndedLiveProbe,
} from '../../live/joinStatusPreflight';
import { subscribeToFollowingList } from '../../utils/followUtils';
import HomeNextRail from './HomeNextRail';
import HomeStatusBubbles from './HomeStatusBubbles';

const CARD_W = 148;
const CARD_H = 214;
const GAP = 12;
const CHIPS = [
  { key: 'trending', label: 'Trending' },
  { key: 'friends', label: 'Friends watched' },
  { key: 'tonight', label: 'Tonight' },
];

function isHashtagDump(s) {
  const t = String(s || '').trim();
  if (!t) return true;
  const tags = t.match(/#\w+/g) || [];
  if (tags.length < 2) return false;
  return tags.join('').length >= t.replace(/\s+/g, '').length * 0.55;
}

function railCaption(item) {
  const raw = item?.title || item?.captionTitle || item?.caption || item?.description || '';
  const user =
    item?.username ||
    item?.userDisplayName ||
    item?.user?.username ||
    item?.user?.displayName ||
    item?.hostUsername ||
    item?.hostDisplayName;
  if (raw && !isHashtagDump(raw)) return raw;
  if (user) return `@${String(user).replace(/^@/, '')}`;
  return raw || 'Video';
}

function otherPeer(thread, uid) {
  const parts = thread?.participants || thread?.participantIds || [];
  const otherId = parts.find((id) => id && id !== uid) || null;
  const profiles = thread?.participantProfiles || thread?.participantsData || {};
  const profile = (otherId && (profiles[otherId] || profiles[String(otherId)])) || {};
  return {
    id: otherId,
    threadId: thread?.id,
    displayName: profile.displayName || profile.username || thread?.otherDisplayName || 'Chat',
    username: profile.username || '',
    photoURL: resolveUserPhoto(profile) || fixStorageUrl(profile.photoURL || '') || null,
    lastMessage: thread?.lastMessage || '',
  };
}

function formatCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(v));
}

function formatDuration(item) {
  const s = Number(item?.duration || item?.durationSeconds || item?.length || 0);
  if (!Number.isFinite(s) || s <= 0) return '';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function streamViewers(stream) {
  return formatCount(
    stream?.viewerCount ?? stream?.viewers ?? stream?.concurrentViews ?? stream?.watchers,
  );
}

function streamPlace(stream) {
  return stream?.location || stream?.city || stream?.place || '';
}

function SectionHead({ title, icon, action, onPress }) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionTitleRow}>
        {icon ? <Icon name={icon} size={16} color={COLORS.primary} /> : null}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {action ? (
        <TouchableOpacity onPress={onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.sectionAction}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function LivePill() {
  return (
    <View style={styles.liveBadge}>
      <View style={styles.liveDot} />
      <Text style={styles.liveBadgeText}>LIVE</Text>
    </View>
  );
}

function ClipCard({ uri, title, views, duration, wide, height, onPress }) {
  return (
    <TouchableOpacity style={{ width: wide ? '100%' : undefined, flex: wide ? 1 : undefined }} activeOpacity={0.88} onPress={onPress}>
      <View style={[styles.clip, { height }]}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.posterFallback]}>
            <Icon name="play" size={22} color={COLORS.primary} />
          </View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.82)']}
          locations={[0.45, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.playOrb}>
          <Icon name="play" size={12} color={COLORS.white} />
        </View>
        {duration ? <Text style={styles.clipDuration}>{duration}</Text> : null}
        <Text style={styles.clipTitle} numberOfLines={2}>
          {title}
        </Text>
        {views ? <Text style={styles.clipViews}>{views} views</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

function RailSkeleton({ tall }) {
  const w = tall ? 176 : CARD_W;
  const h = tall ? 268 : CARD_H;
  return (
    <View style={styles.skelRow}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.skelCard, { width: w, height: h }]} />
      ))}
    </View>
  );
}

export default function HomeNextPanel({
  navigation,
  uid,
  interests = [],
  onOpenPage,
  onOpenForYouPost,
}) {
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forYou, setForYou] = useState([]);
  const [watch, setWatch] = useState([]);
  const [live, setLive] = useState([]);
  const [trending, setTrending] = useState([]);
  const [friendsPosts, setFriendsPosts] = useState([]);
  const [people, setPeople] = useState([]);
  const [followingIds, setFollowingIds] = useState([]);
  const [chip, setChip] = useState('trending');
  const liveProbeGenRef = useRef(0);

  const interestTerms = useMemo(
    () => (interests || []).map((id) => String(id).toLowerCase()).filter(Boolean),
    [interests],
  );

  const loadRails = useCallback(async () => {
    const [fy, trend, liveRes, following] = await Promise.all([
      getForYouPosts(interestTerms, [], 14),
      getTrendingPosts(12, interestTerms),
      getLiveNow(12),
      followingIds.length ? getFollowingPosts(followingIds, 12) : Promise.resolve([]),
    ]);
    setForYou(Array.isArray(fy) ? fy : []);
    setTrending(Array.isArray(trend) ? trend : []);
    setLive(Array.isArray(liveRes) ? liveRes : []);
    setFriendsPosts(Array.isArray(following) ? following : []);
  }, [interestTerms, followingIds]);

  useEffect(() => {
    if (!uid) return undefined;
    return subscribeToFollowingList(uid, (set) => {
      setFollowingIds([...(set || [])].map(String).filter(Boolean));
    });
  }, [uid]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadRails()
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadRails]);

  useEffect(() => {
    if (!uid) return undefined;
    return subscribeWatchHistory(uid, (list) => setWatch(Array.isArray(list) ? list : []));
  }, [uid]);

  useEffect(() => {
    if (!uid || !firebaseEnabled || !firestore) return undefined;
    const unsub = conversationsMessagingService.subscribeToThreads(
      firestore,
      uid,
      (list) => {
        const rows = (Array.isArray(list) ? list : []).slice(0, 12).map((t) => otherPeer(t, uid));
        const ids = rows.map((r) => r.id).filter(Boolean);
        if (!ids.length) {
          setPeople(rows.filter((r) => r.id));
          return;
        }
        fetchMessengerUserProfiles(ids).then((map) => {
          setPeople(
            rows
              .filter((r) => r.id)
              .map((r) => {
                const liveP = map.get(r.id) || map.get(String(r.id));
                return {
                  ...r,
                  displayName: liveP?.displayName || liveP?.username || r.displayName,
                  photoURL: resolveUserPhoto(liveP) || r.photoURL,
                };
              }),
          );
        });
      },
      () => {},
    );
    return () => {
      try {
        if (typeof unsub === 'function') unsub();
      } catch {
        /* ignore */
      }
    };
  }, [uid]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadRails();
    } finally {
      setRefreshing(false);
    }
  }, [loadRails]);

  const openPost = (post, list) =>
    navigation.navigate('MediaViewer', mediaViewerParams(post, list));

  const openForYou = (post) => {
    if (typeof onOpenForYouPost === 'function') {
      onOpenForYouPost(post);
      return;
    }
    onOpenPage?.('A');
  };

  const openLive = (stream) => {
    const streamId = stream.streamId || stream.id || stream.liveId;
    if (!streamId) return;
    const probeGeneration = ++liveProbeGenRef.current;
    navigation.navigate('LiveStreamScreen', {
      mode: 'viewer',
      streamId,
      hostUid: stream.hostUid || stream.userId || stream.uid || stream.creatorId,
      hostDisplayName: stream.hostDisplayName || stream.hostUsername || stream.title || 'Live',
      source: 'home_next',
      liveViewerIntent: true,
    });
    void getLiveSessionStatus(String(streamId))
      .then((status) => {
        if (status?.live) return;
        if (
          !shouldEjectEndedLiveProbe({
            probeGeneration,
            currentGeneration: liveProbeGenRef.current,
            expectedStreamId: streamId,
            navigationState: getRootishNavigationState(navigation),
          })
        ) {
          return;
        }
        Alert.alert('Stream ended', 'This live is no longer available.');
        try {
          if (navigation?.canGoBack?.()) navigation.goBack();
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  };

  const openProfile = (userId, username) => {
    if (!userId) return;
    navigation.navigate('UserProfile', { userId, username: username || '@user' });
  };

  const featured = live[0] || null;
  const liveRooms = featured ? live.slice(1, 5) : live.slice(0, 4);
  const mosaic = chip === 'friends' ? friendsPosts : chip === 'tonight' ? forYou : trending;
  const mosaicItems = mosaic.length ? mosaic : forYou;
  const leftH = Math.round((width - 40) * 0.72);
  const rightH = Math.round((leftH - 10) / 2);

  const renderWatch = useCallback(
    ({ item }) => (
      <TouchableOpacity
        style={{ width: CARD_W }}
        activeOpacity={0.88}
        onPress={() => openPost(item, watch)}
      >
        <View style={[styles.clip, { width: CARD_W, height: CARD_H }]}>
          {item.thumbnail ? (
            <Image
              source={{ uri: fixStorageUrl(item.thumbnail) }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.posterFallback]}>
              <Icon name="play" size={22} color={COLORS.primary} />
            </View>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.82)']}
            locations={[0.5, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>
        <Text style={styles.watchTitle} numberOfLines={1}>
          {railCaption(item)}
        </Text>
      </TouchableOpacity>
    ),
    [watch],
  );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={COLORS.primary}
          colors={[COLORS.primary]}
        />
      }
    >
      <View style={styles.bubbles}>
        <HomeStatusBubbles
          uid={uid}
          liveStreams={live}
          recentPeers={people}
          onOpenLive={openLive}
          onOpenProfile={openProfile}
        />
      </View>

      {featured ? (
        <View style={styles.block}>
          <SectionHead title="Featured Now" />
          <TouchableOpacity style={styles.featured} activeOpacity={0.9} onPress={() => openLive(featured)}>
            {streamThumbnail(featured) ? (
              <Image
                source={{ uri: streamThumbnail(featured) }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.posterFallback]} />
            )}
            <LinearGradient
              colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.82)']}
              locations={[0.35, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View style={styles.featuredTop}>
              <LivePill />
              {streamViewers(featured) ? (
                <View style={styles.viewerPill}>
                  <Icon name="eye" size={12} color={COLORS.white} />
                  <Text style={styles.viewerText}>{streamViewers(featured)}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.featuredBottom}>
              <View style={styles.featuredHost}>
                {streamThumbnail(featured) ? (
                  <Image source={{ uri: streamThumbnail(featured) }} style={styles.hostAvatar} />
                ) : (
                  <View style={styles.hostAvatar} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.hostName} numberOfLines={1}>
                    {featured.hostUsername || featured.hostDisplayName || 'Live'}
                  </Text>
                  {streamPlace(featured) ? (
                    <Text style={styles.hostPlace} numberOfLines={1}>
                      {streamPlace(featured)}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Text style={styles.featuredTitle} numberOfLines={2}>
                {featured.title || railCaption(featured)}
              </Text>
              {featured.description ? (
                <Text style={styles.featuredDesc} numberOfLines={2}>
                  {featured.description}
                </Text>
              ) : null}
              <View style={styles.watchLive}>
                <Icon name="radio" size={14} color={COLORS.white} />
                <Text style={styles.watchLiveText}>Watch Live</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.block}>
        <SectionHead
          title="For you"
          icon="sparkles"
          action="See all"
          onPress={() => onOpenPage?.('A')}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {CHIPS.map((c) => {
            const on = chip === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => setChip(c.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {loading && mosaicItems.length === 0 ? (
          <RailSkeleton tall />
        ) : mosaicItems.length > 0 ? (
          <View style={styles.mosaic}>
            <View style={styles.mosaicLeft}>
              <ClipCard
                uri={postThumbnail(mosaicItems[0])}
                title={railCaption(mosaicItems[0])}
                views={formatCount(mosaicItems[0]?.views || mosaicItems[0]?.viewCount)}
                duration={formatDuration(mosaicItems[0])}
                height={leftH}
                wide
                onPress={() => openForYou(mosaicItems[0])}
              />
            </View>
            <View style={styles.mosaicRight}>
              {mosaicItems.slice(1, 3).map((item) => (
                <ClipCard
                  key={String(item.id)}
                  uri={postThumbnail(item)}
                  title={railCaption(item)}
                  views={formatCount(item?.views || item?.viewCount)}
                  duration={formatDuration(item)}
                  height={rightH}
                  wide
                  onPress={() => openForYou(item)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>

      {liveRooms.length > 0 ? (
        <View style={styles.block}>
          <SectionHead title="Live rooms for you" icon="radio" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.roomsRow}
          >
            {liveRooms.map((stream) => {
              const id = String(stream.id || stream.streamId);
              return (
                <TouchableOpacity
                  key={id}
                  style={styles.roomCard}
                  activeOpacity={0.88}
                  onPress={() => openLive(stream)}
                >
                  {streamThumbnail(stream) ? (
                    <Image
                      source={{ uri: streamThumbnail(stream) }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, styles.posterFallback]} />
                  )}
                  <LinearGradient
                    colors={['rgba(0,0,0,0.1)', 'rgba(0,0,0,0.78)']}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                  />
                  <View style={styles.roomTop}>
                    <LivePill />
                    {streamViewers(stream) ? (
                      <View style={styles.viewerPill}>
                        <Icon name="eye" size={11} color={COLORS.white} />
                        <Text style={styles.viewerText}>{streamViewers(stream)}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.roomTitle} numberOfLines={1}>
                    {stream.title || 'Live room'}
                  </Text>
                  <Text style={styles.roomHost} numberOfLines={1}>
                    {stream.hostUsername || stream.hostDisplayName || 'Host'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {watch.length > 0 ? (
        <View style={styles.block}>
          <SectionHead title="Continue watching" />
          <HomeNextRail
            data={watch}
            itemWidth={CARD_W}
            gap={GAP}
            height={CARD_H + 28}
            keyExtractor={(p) => String(p.id)}
            renderCard={renderWatch}
          />
        </View>
      ) : null}

      <View style={{ height: responsiveSize(108) }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.pageBackground },
  content: { paddingTop: 4 },
  bubbles: { marginBottom: 18 },
  block: { marginBottom: 22 },
  sectionHead: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(18),
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  sectionAction: {
    color: COLORS.primary,
    fontSize: responsiveFont(13),
    fontWeight: '800',
  },
  featured: {
    marginHorizontal: 16,
    height: responsiveSize(280),
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundCard,
  },
  featuredTop: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featuredBottom: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
  },
  featuredHost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  hostAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundLight,
  },
  hostName: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: responsiveFont(13),
  },
  hostPlace: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: responsiveFont(11),
  },
  featuredTitle: {
    color: COLORS.white,
    fontSize: responsiveFont(22),
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  featuredDesc: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: responsiveFont(13),
    marginTop: 4,
  },
  watchLive: {
    alignSelf: 'flex-end',
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  watchLiveText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: responsiveFont(13),
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.white,
  },
  liveBadgeText: {
    color: COLORS.white,
    fontSize: responsiveFont(10),
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  viewerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  viewerText: {
    color: COLORS.white,
    fontSize: responsiveFont(11),
    fontWeight: '700',
  },
  chipRow: {
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.backgroundLight,
  },
  chipOn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  chipText: {
    color: COLORS.textMuted,
    fontWeight: '700',
    fontSize: responsiveFont(13),
  },
  chipTextOn: {
    color: COLORS.primary,
  },
  mosaic: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 10,
  },
  mosaicLeft: { flex: 1.05 },
  mosaicRight: { flex: 1, gap: 10 },
  clip: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundCard,
    justifyContent: 'flex-end',
    padding: 10,
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundLight,
  },
  playOrb: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipDuration: {
    position: 'absolute',
    top: 10,
    right: 10,
    color: COLORS.white,
    fontSize: responsiveFont(10),
    fontWeight: '800',
  },
  clipTitle: {
    color: COLORS.white,
    fontSize: responsiveFont(13),
    fontWeight: '800',
  },
  clipViews: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: responsiveFont(11),
    marginTop: 2,
  },
  roomsRow: {
    paddingHorizontal: 16,
    gap: 12,
  },
  roomCard: {
    width: responsiveSize(210),
    height: responsiveSize(132),
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: COLORS.backgroundCard,
    padding: 12,
    justifyContent: 'flex-end',
  },
  roomTop: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roomTitle: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: responsiveFont(15),
  },
  roomHost: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: responsiveFont(12),
    marginTop: 2,
  },
  watchTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(12),
    fontWeight: '700',
    marginTop: 8,
  },
  skelRow: {
    flexDirection: 'row',
    gap: GAP,
    paddingHorizontal: 16,
  },
  skelCard: {
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
});
