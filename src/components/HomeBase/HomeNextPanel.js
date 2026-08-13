import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import {
  getForYouPosts,
  getTrendingPosts,
  getSuggestedCreators,
  getLiveNow,
  creatorAvatar,
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
import HomeNextRail from './HomeNextRail';
import HomePhoneStrip from './HomePhoneStrip';

const HERO_W = 176;
const HERO_H = 268;
const CARD_W = 148;
const CARD_H = 214;
const GAP = 12;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

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

function SectionHead({ title, action, onPress }) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionTitleRow}>
        <View style={styles.sectionAccent} />
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

function PosterCard({ uri, label, badge, tall, onPress }) {
  const w = tall ? HERO_W : CARD_W;
  const h = tall ? HERO_H : CARD_H;
  return (
    <TouchableOpacity style={{ width: w }} activeOpacity={0.88} onPress={onPress}>
      <View style={[styles.poster, { width: w, height: h }]}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.posterFallback]}>
            <Icon name="play" size={22} color={COLORS.primary} />
          </View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.82)']}
          locations={[0.45, 0.7, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {badge ? (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveBadgeText}>{badge}</Text>
          </View>
        ) : null}
        <Text style={styles.posterLabel} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function RailSkeleton({ tall }) {
  const w = tall ? HERO_W : CARD_W;
  const h = tall ? HERO_H : CARD_H;
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forYou, setForYou] = useState([]);
  const [watch, setWatch] = useState([]);
  const [live, setLive] = useState([]);
  const [trending, setTrending] = useState([]);
  const [creators, setCreators] = useState([]);
  const [people, setPeople] = useState([]);
  const liveProbeGenRef = useRef(0);

  const interestTerms = useMemo(
    () => (interests || []).map((id) => String(id).toLowerCase()).filter(Boolean),
    [interests],
  );

  const loadRails = useCallback(async () => {
    const [fy, trend, creator, liveRes] = await Promise.all([
      getForYouPosts(interestTerms, [], 14),
      getTrendingPosts(12, interestTerms),
      getSuggestedCreators(12, interestTerms, uid),
      getLiveNow(10),
    ]);
    setForYou(Array.isArray(fy) ? fy : []);
    setTrending(Array.isArray(trend) ? trend : []);
    setCreators(Array.isArray(creator) ? creator : []);
    setLive(Array.isArray(liveRes) ? liveRes : []);
  }, [interestTerms, uid]);

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

  const openCreator = (user) =>
    navigation.navigate('UserProfile', {
      userId: user.id || user.uid || user.userId,
      username: user.username || user.displayName || '@user',
    });

  const openChat = (person) => {
    navigation.navigate('ChatConversation', {
      chatId: person.threadId,
      conversationId: person.threadId,
      otherUser: {
        id: person.id,
        displayName: person.displayName,
        username: person.username,
        photoURL: person.photoURL,
      },
    });
  };

  const renderHero = useCallback(
    ({ item }) => (
      <PosterCard
        tall
        uri={postThumbnail(item)}
        label={railCaption(item)}
        onPress={() => openForYou(item)}
      />
    ),
    [onOpenForYouPost, onOpenPage],
  );

  const renderWatch = useCallback(
    ({ item }) => (
      <PosterCard
        uri={fixStorageUrl(item.thumbnail)}
        label={railCaption(item)}
        onPress={() => openPost(item, watch)}
      />
    ),
    [watch],
  );

  const renderLive = useCallback(
    ({ item }) => (
      <PosterCard
        uri={streamThumbnail(item)}
        label={item.title || item.hostDisplayName || item.hostUsername || 'Live'}
        badge="LIVE"
        onPress={() => openLive(item)}
      />
    ),
    [],
  );

  const renderTrend = useCallback(
    ({ item }) => (
      <PosterCard
        uri={postThumbnail(item)}
        label={railCaption(item)}
        onPress={() => openPost(item, trending)}
      />
    ),
    [trending],
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
      <LinearGradient
        colors={['rgba(0,210,190,0.08)', 'transparent']}
        locations={[0, 1]}
        style={styles.glow}
        pointerEvents="none"
      />

      <View style={styles.topRow}>
        <Text style={styles.greet}>{greeting()}</Text>
      </View>

      <TouchableOpacity
        style={styles.search}
        activeOpacity={0.9}
        onPress={() => navigation.navigate('Blyp')}
      >
        <View style={styles.searchInner}>
          <Icon name="sparkles" size={18} color={COLORS.primary} />
          <Text style={styles.searchText}>Search or ask Blyp…</Text>
          <View style={styles.micOrb}>
            <Icon name="mic" size={14} color="#0A0A0C" />
          </View>
        </View>
      </TouchableOpacity>

      <HomePhoneStrip navigation={navigation} uid={uid} />

      <View style={styles.block}>
        <SectionHead title="For you" action="Open feed" onPress={() => onOpenPage?.('A')} />
        {loading && forYou.length === 0 ? (
          <RailSkeleton tall />
        ) : forYou.length > 0 ? (
          <HomeNextRail
            data={forYou}
            itemWidth={HERO_W}
            gap={GAP}
            height={HERO_H + 4}
            keyExtractor={(p) => String(p.id)}
            renderCard={renderHero}
          />
        ) : null}
      </View>

      {watch.length > 0 ? (
        <View style={styles.block}>
          <SectionHead title="Continue watching" />
          <HomeNextRail
            data={watch}
            itemWidth={CARD_W}
            gap={GAP}
            height={CARD_H + 4}
            keyExtractor={(p) => String(p.id)}
            renderCard={renderWatch}
          />
        </View>
      ) : null}

      {live.length > 0 ? (
        <View style={styles.block}>
          <SectionHead title="Live now" />
          <HomeNextRail
            data={live}
            itemWidth={CARD_W}
            gap={GAP}
            height={CARD_H + 4}
            keyExtractor={(s) => String(s.id || s.streamId)}
            renderCard={renderLive}
          />
        </View>
      ) : null}

      {people.length > 0 ? (
        <View style={styles.block}>
          <SectionHead title="Messages" action="See all" onPress={() => navigation.navigate('Messenger')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.peopleRow}
          >
            {people.map((p) => {
              const initial = (p.displayName || '?').slice(0, 1).toUpperCase();
              return (
                <TouchableOpacity key={p.id} style={styles.person} onPress={() => openChat(p)} activeOpacity={0.88}>
                  {p.photoURL ? (
                    <Image source={{ uri: p.photoURL }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarFallback]}>
                      <Text style={styles.avatarInitial}>{initial}</Text>
                    </View>
                  )}
                  <Text style={styles.personName} numberOfLines={1}>
                    {p.displayName}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {loading && trending.length === 0 ? (
        <View style={styles.block}>
          <SectionHead title="Trending" />
          <RailSkeleton />
        </View>
      ) : trending.length > 0 ? (
        <View style={styles.block}>
          <SectionHead title="Trending" />
          <HomeNextRail
            data={trending}
            itemWidth={CARD_W}
            gap={GAP}
            height={CARD_H + 4}
            keyExtractor={(p) => String(p.id)}
            renderCard={renderTrend}
          />
        </View>
      ) : null}

      {creators.length > 0 ? (
        <View style={styles.block}>
          <SectionHead title="Creators" action="See all" onPress={() => navigation.navigate('FindPeople')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.peopleRow}
          >
            {creators.map((u) => {
              const id = u.id || u.uid || u.userId;
              const name = u.displayName || u.username || u.name || 'Creator';
              const uri = creatorAvatar(u);
              return (
                <TouchableOpacity key={String(id)} style={styles.person} onPress={() => openCreator(u)} activeOpacity={0.88}>
                  <View style={styles.creatorRing}>
                    {uri ? (
                      <Image source={{ uri }} style={styles.creatorAvatar} />
                    ) : (
                      <View style={[styles.creatorAvatar, styles.avatarFallback]}>
                        <Text style={styles.avatarInitial}>{String(name).slice(0, 1).toUpperCase()}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.personName} numberOfLines={1}>
                    {name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <View style={{ height: responsiveSize(108) }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.pageBackground },
  content: { paddingTop: 6 },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  topRow: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  greet: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(22),
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  search: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#101014',
  },
  searchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#101014',
  },
  searchText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: responsiveFont(15),
    fontWeight: '600',
  },
  micOrb: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: { marginBottom: 22 },
  sectionHead: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionAccent: {
    width: 3,
    height: 16,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
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
  poster: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#141418',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16161C',
  },
  posterLabel: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    color: '#fff',
    fontSize: responsiveFont(13),
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  liveBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#E11D48',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  liveBadgeText: {
    color: '#fff',
    fontSize: responsiveFont(10),
    fontWeight: '900',
    letterSpacing: 0.6,
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
  peopleRow: {
    paddingHorizontal: 16,
    gap: 14,
  },
  person: {
    width: 72,
    alignItems: 'center',
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#1A1A20',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: COLORS.primary,
    fontSize: responsiveFont(18),
    fontWeight: '800',
  },
  personName: {
    marginTop: 6,
    color: COLORS.textPrimary,
    fontSize: responsiveFont(11),
    fontWeight: '700',
    width: '100%',
    textAlign: 'center',
  },
  creatorRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  creatorAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#101014',
  },
});
