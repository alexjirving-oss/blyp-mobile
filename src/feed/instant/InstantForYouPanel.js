/**
 * Instant For You panel — ground-up vertical swipe feed.
 * Wired as HomeScreen case 'A' (replaces the old FlatList path).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Icon from '../../components/Icon';
import FeedEmptyState from '../../components/Feed/FeedEmptyState';
import FeedActionBar from '../../components/Feed/FeedActionBar';
import { FeedActionButton } from '../../components/Feed/FeedActionButton';
import { COLORS } from '../../styles/theme';
import { getForYouPosts } from '../../services/discoveryService';
import { setPostLiked } from '../../services/LikeService';
import { sharePost as shareServiceSharePost } from '../../services/shareService';
import { requireAccount } from '../../services/guestSessionService';
import { mediaViewerParams } from '../../utils/mediaViewerPlaylist';
import { resolvePlayableUri } from '../resolvePlayableUri';
import { isShortsAvailable, prefetchShortsUri } from '../ShortsNative';
import InstantCell from './InstantCell';
import { ensureInstantAudio, releaseInstantAudio } from './audio';

const PAGE = 24;

function likeCountOf(post, overrides) {
  const id = post?.id;
  if (id != null && overrides && Number.isFinite(overrides[id])) {
    return Math.max(0, overrides[id]);
  }
  const fromLikedBy = Array.isArray(post?.likedBy) ? post.likedBy.length : 0;
  const likes = Number(post?.likes);
  const likeCount = Number(post?.likeCount);
  return Math.max(
    Number.isFinite(likes) ? Math.trunc(likes) : 0,
    Number.isFinite(likeCount) ? Math.trunc(likeCount) : 0,
    fromLikedBy,
  );
}

function commentCountOf(post, overrides) {
  const id = post?.id;
  if (id != null && overrides && Number.isFinite(overrides[id])) {
    return Math.max(0, overrides[id]);
  }
  const raw =
    post?.commentCount ??
    post?.commentsCount ??
    post?.comment_count ??
    post?.numComments ??
    post?.comments;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.max(0, n);
  if (Array.isArray(post?.comments)) return post.comments.length;
  return 0;
}

export default function InstantForYouPanel({
  navigation,
  uid,
  authReady,
  isAuthenticated,
  focusPost = null,
  onFocusConsumed,
  onOpenComments,
  commentCounts = {},
}) {
  const focused = useIsFocused();
  const tabBarHeight = useBottomTabBarHeight();
  const listRef = useRef(null);
  const postsRef = useRef([]);
  const activeRef = useRef(0);
  const heightRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const likePendingRef = useRef(new Set());
  const tapRef = useRef({ at: 0, postId: null, timer: null });

  const [height, setHeight] = useState(0);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadIndex, setLoadIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [pausedId, setPausedId] = useState(null);
  const [liked, setLiked] = useState({});
  const [likeCounts, setLikeCounts] = useState({});

  postsRef.current = posts;
  activeRef.current = activeIndex;
  heightRef.current = height;

  const actionBottom = tabBarHeight;

  const activePost =
    posts.length > 0
      ? posts[Math.min(Math.max(0, activeIndex), posts.length - 1)]
      : null;

  const seedLikes = useCallback((list, userId) => {
    const nextLiked = {};
    const nextCounts = {};
    (list || []).forEach((p) => {
      if (!p?.id) return;
      nextLiked[p.id] = !!(userId && Array.isArray(p.likedBy) && p.likedBy.includes(userId));
      nextCounts[p.id] = likeCountOf(p);
    });
    setLiked((prev) => ({ ...nextLiked, ...prev }));
    setLikeCounts((prev) => ({ ...nextCounts, ...prev }));
  }, []);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getForYouPosts([], [], PAGE);
      const clean = (list || []).filter((p) => p?.id && resolvePlayableUri(p).playUri);
      postsRef.current = clean;
      setPosts(clean);
      seedLikes(clean, uid);
      setActiveIndex(0);
      setLoadIndex(0);
      activeRef.current = 0;
    } catch (e) {
      console.warn('[InstantFY] load failed', e?.message || String(e));
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [seedLikes, uid]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const more = await getForYouPosts([], [], PAGE);
      const have = new Set((postsRef.current || []).map((p) => String(p.id)));
      const fresh = (more || []).filter(
        (p) => p?.id && !have.has(String(p.id)) && resolvePlayableUri(p).playUri,
      );
      if (!fresh.length) return;
      const next = [...postsRef.current, ...fresh];
      postsRef.current = next;
      setPosts(next);
      seedLikes(fresh, uid);
    } catch (e) {
      console.warn('[InstantFY] loadMore failed', e?.message || String(e));
    } finally {
      loadingMoreRef.current = false;
    }
  }, [seedLikes, uid]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  // Focus a specific post from Home rail / deep link (once).
  const focusConsumedRef = useRef(null);
  useEffect(() => {
    if (!focusPost?.id) return;
    const id = String(focusPost.id);
    if (focusConsumedRef.current === id) return;
    if (!posts.length && !focusPost) return;

    let list = postsRef.current || [];
    let idx = list.findIndex((p) => p && String(p.id) === id);
    if (idx < 0) {
      const injected = [focusPost, ...list.filter((p) => String(p?.id) !== id)];
      postsRef.current = injected;
      setPosts(injected);
      seedLikes([focusPost], uid);
      list = injected;
      idx = 0;
    }
    focusConsumedRef.current = id;
    setActiveIndex(idx);
    setLoadIndex(idx);
    activeRef.current = idx;
    if (height > 0 && listRef.current) {
      try {
        listRef.current.scrollToOffset({ offset: idx * height, animated: false });
      } catch { /* ignore */ }
    }
    onFocusConsumed?.();
  }, [focusPost?.id, posts.length, height, seedLikes, uid, onFocusConsumed, focusPost]);

  // Claim speaker once when For You is focused and unmuted.
  useEffect(() => {
    if (!focused) {
      releaseInstantAudio();
      return undefined;
    }
    if (muted) return undefined;
    ensureInstantAudio({ force: true }).catch(() => {});
    return () => {
      releaseInstantAudio();
    };
  }, [focused, muted]);

  // Prefetch next URIs aggressively.
  useEffect(() => {
    if (!isShortsAvailable() || !posts.length) return;
    for (let d = 0; d <= 2; d += 1) {
      const idxs = d === 0 ? [activeIndex] : [activeIndex + d, activeIndex - d];
      for (const i of idxs) {
        if (i < 0 || i >= posts.length) continue;
        const uri = resolvePlayableUri(posts[i]).playUri;
        if (uri) prefetchShortsUri(uri).catch(() => {});
      }
    }
  }, [activeIndex, posts]);

  const onScroll = useCallback((e) => {
    const y = e?.nativeEvent?.contentOffset?.y;
    const h = heightRef.current;
    if (!Number.isFinite(y) || !h) return;
    const mid = Math.floor(y / h + 0.5);
    const clamped = Math.max(0, Math.min(mid, (postsRef.current?.length || 1) - 1));
    if (clamped !== loadIndex) setLoadIndex(clamped);
  }, [loadIndex]);

  const onScrollEnd = useCallback((e) => {
    const y = e?.nativeEvent?.contentOffset?.y;
    const h = heightRef.current;
    if (!Number.isFinite(y) || !h) return;
    const next = Math.max(
      0,
      Math.min(Math.round(y / h), (postsRef.current?.length || 1) - 1),
    );
    if (next !== activeRef.current) {
      activeRef.current = next;
      setActiveIndex(next);
      setPausedId(null);
    }
    if (next !== loadIndex) setLoadIndex(next);
    if ((postsRef.current?.length || 0) - next <= 4) loadMore();
  }, [loadIndex, loadMore]);

  const handleLike = useCallback(async (postId) => {
    if (requireAccount(navigation, 'like posts')) return;
    if (!authReady || !isAuthenticated || !uid || !postId) return;
    if (likePendingRef.current.has(postId)) return;
    likePendingRef.current.add(postId);
    const post = (postsRef.current || []).find((p) => p.id === postId);
    const wasLiked = !!liked[postId];
    const prev = likeCountOf(post, likeCounts);
    const next = Math.max(0, prev + (wasLiked ? -1 : 1));
    setLiked((p) => ({ ...p, [postId]: !wasLiked }));
    setLikeCounts((p) => ({ ...p, [postId]: next }));
    try {
      const res = await setPostLiked({
        postId,
        userId: uid,
        metadata: { postTitle: post?.title || post?.caption || post?.description },
      });
      if (!res?.ok) throw res?.error || new Error(res?.reason || 'LIKE_FAILED');
      if (typeof res.liked === 'boolean') {
        setLiked((p) => ({ ...p, [postId]: res.liked }));
      }
      if (Number.isFinite(res.count)) {
        setLikeCounts((p) => ({ ...p, [postId]: res.count }));
      }
    } catch (e) {
      setLiked((p) => ({ ...p, [postId]: wasLiked }));
      setLikeCounts((p) => ({ ...p, [postId]: prev }));
      console.warn('[InstantFY] like failed', e?.message || String(e));
    } finally {
      likePendingRef.current.delete(postId);
    }
  }, [navigation, authReady, isAuthenticated, uid, liked, likeCounts]);

  const onPressVideo = useCallback((item) => {
    const postId = item?.id;
    if (!postId) return;
    const now = Date.now();
    if (tapRef.current.postId === postId && now - tapRef.current.at < 320) {
      if (tapRef.current.timer) clearTimeout(tapRef.current.timer);
      tapRef.current = { at: 0, postId: null, timer: null };
      handleLike(postId);
      return;
    }
    if (tapRef.current.timer) clearTimeout(tapRef.current.timer);
    tapRef.current = {
      at: now,
      postId,
      timer: setTimeout(() => {
        tapRef.current = { at: 0, postId: null, timer: null };
        setPausedId((prev) => (prev === postId ? null : postId));
      }, 280),
    };
  }, [handleLike]);

  const onPressCreator = useCallback((item) => {
    const userId = item?.userId || item?.uid || item?.user?.id || item?.user?.uid;
    if (!userId) return;
    navigation?.navigate?.('UserProfile', {
      userId,
      username: item?.userDisplayName || item?.user?.username || item?.username,
    });
  }, [navigation]);

  const handleShare = useCallback(async (post) => {
    try {
      await shareServiceSharePost(post);
    } catch (e) {
      console.warn('[InstantFY] share failed', e?.message || String(e));
    }
  }, []);

  const renderItem = useCallback(({ item, index }) => (
    <InstantCell
      item={item}
      index={index}
      activeIndex={focused ? activeIndex : -1}
      loadIndex={focused ? loadIndex : -1}
      height={height}
      feedMuted={muted || !focused}
      paused={pausedId === item.id}
      onPressVideo={onPressVideo}
      onPressCreator={onPressCreator}
    />
  ), [focused, activeIndex, loadIndex, height, muted, pausedId, onPressVideo, onPressCreator]);

  const keyExtractor = useCallback((item) => String(item.id), []);

  if (!height) {
    return (
      <View
        style={styles.fill}
        onLayout={(e) => {
          const h = e?.nativeEvent?.layout?.height || 0;
          if (h > 0) setHeight(h);
        }}
      >
        <FeedEmptyState mode="loading" />
      </View>
    );
  }

  if (loading && posts.length === 0) {
    return (
      <View style={[styles.fill, { height }]}>
        <FeedEmptyState mode="loading" />
      </View>
    );
  }

  if (!posts.length) {
    return (
      <View style={[styles.fill, { height }]}>
        <FeedEmptyState mode="empty" />
      </View>
    );
  }

  return (
    <View
      style={{ height, position: 'relative' }}
      onLayout={(e) => {
        const h = e?.nativeEvent?.layout?.height || 0;
        if (h > 0 && h !== height) setHeight(h);
      }}
    >
      <FlatList
        ref={listRef}
        data={posts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsVerticalScrollIndicator={false}
        refreshing={loading}
        onRefresh={loadFeed}
        pagingEnabled
        snapToInterval={height}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        removeClippedSubviews={false}
        maxToRenderPerBatch={3}
        windowSize={5}
        initialNumToRender={2}
        updateCellsBatchingPeriod={16}
        extraData={`${activeIndex}:${loadIndex}:${muted ? 1 : 0}:${pausedId || ''}:${focused ? 1 : 0}`}
        getItemLayout={(_, index) => ({
          length: height,
          offset: height * index,
          index,
        })}
        onScroll={onScroll}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        onEndReached={loadMore}
        onEndReachedThreshold={1.5}
        scrollEventThrottle={16}
      />

      {activePost ? (
        <FeedActionBar bottomOffset={actionBottom}>
          <FeedActionButton
            onPress={() => handleLike(activePost.id)}
            active={!!liked[activePost.id]}
            count={likeCountOf(activePost, likeCounts)}
          >
            <Icon
              name={liked[activePost.id] ? 'heart' : 'heart-outline'}
              size={24}
              color={COLORS.white}
            />
          </FeedActionButton>

          <FeedActionButton
            onPress={() => {
              if (requireAccount(navigation, 'comment')) return;
              onOpenComments?.(activePost);
            }}
            count={commentCountOf(activePost, commentCounts)}
          >
            <Icon name="chatbubble" size={22} color={COLORS.white} />
          </FeedActionButton>

          <FeedActionButton
            onPress={() => setMuted((m) => !m)}
            accessibilityLabel={muted ? 'Unmute' : 'Mute'}
          >
            <Icon
              name={muted ? 'volume-mute' : 'volume-high'}
              size={22}
              color={COLORS.white}
            />
          </FeedActionButton>

          <FeedActionButton
            onPress={() => handleShare(activePost)}
            count={
              activePost.shareCount
                ?? activePost.sharesCount
                ?? activePost.shares
                ?? 0
            }
          >
            <Icon name="share" size={22} color={COLORS.white} />
          </FeedActionButton>

          <TouchableOpacity
            style={styles.expandBtn}
            activeOpacity={0.85}
            onPress={() => {
              navigation?.navigate?.('MediaViewer', mediaViewerParams(activePost, posts));
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Open post"
          >
            <View style={styles.expandRing}>
              <Icon name="open-outline" size={20} color={COLORS.white} />
            </View>
          </TouchableOpacity>
        </FeedActionBar>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: '#000',
  },
  expandBtn: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  expandRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: COLORS.primary || '#00D2BE',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.45)',
  },
});
