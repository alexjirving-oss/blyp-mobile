// HomeScreen.js
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { Alert, Animated, Dimensions, FlatList, Image, Modal, PanResponder, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { sharePost as shareServiceSharePost } from '../services/shareService';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { db, auth, firebaseEnabled } from '../config/firebase';
import EnhancedVideo from '../components/EnhancedVideo';
import { addTestPostsWithMultiplePhotos } from '../utils/testDataHelper';
import CategoriesTab from '../components/CategoriesTab';
import HashtagsTab from '../components/HashtagsTab';
import WhatsAppPopularTab from '../components/WhatsAppPopularTab';
import LiveReactionsHearts from '../components/live/LiveReactionsHearts';
import GiftSystem from '../components/GiftSystem';
import CommentsModal from '../components/CommentsModal';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { fixStorageUrl } from '../utils/urlUtils';
import AudioTile from '../components/AudioTile';
import { prefetchPostWindow } from '../utils/mediaPrefetch';
import { mediaViewerParams } from '../utils/mediaViewerPlaylist';
import { COLORS } from '../styles/theme';
import BlypHeaderFlow from '../components/BlypHeaderFlow';
import FeedEmptyState from '../components/Feed/FeedEmptyState';
import FeedCommentOverlay from '../components/Feed/FeedCommentOverlay';
import FeedActionBar, { feedOverlayBottomInset } from '../components/Feed/FeedActionBar';
import { FeedActionButton, FeedStatBadge } from '../components/Feed/FeedActionButton';
import PremiumFeedVideo from '../components/Feed/PremiumFeedVideo';
import FeedTopStatPills from '../components/Feed/FeedTopStatPills';
import HomeBasePanel from '../components/HomeBase/HomeBasePanel';
import HomeNextPanel from '../components/HomeBase/HomeNextPanel';
import { subscribeHomeEdition, setHomeEdition } from '../services/homeEditionService';
import TopicFeedPanel from '../components/HomeBase/TopicFeedPanel';
import SportPagePanel from '../components/HomeBase/SportPagePanel';
import FollowingFeedPanel from '../components/HomeBase/FollowingFeedPanel';
import ScreenErrorBoundary from '../components/ScreenErrorBoundary';
import {
  subscribePreferences,
  getEnabledPages,
  getFirstEnabledPageKey,
  isTopicPageKey,
  topicIdFromKey,
  getHomeRibbonPages,
} from '../services/userPreferencesService';
import { subscribeToFollowingList, followUser, unfollowUser } from '../utils/followUtils';
import { useTabReset } from '../utils/tabResetBus';
import { subscribeTourSelect } from '../tour/tourBus';
import { requireAccount } from '../services/guestSessionService';
import { filterBlocked, loadBlockedUsers } from '../services/BlockService';
import { isForYouFeedPost, isVideoWithSoundPost } from '../utils/forYouFeedFilter';
import {
  dedupePostsById,
  ensureFocusPostInList,
  feedInventoryStats,
  resolveFeedVideoUri,
  resolveForYouBootWidenApply,
  shufflePostsVaried,
} from '../utils/forYouFeedList';
import {
  resolvePlayableUri,
  shouldLoadCell,
  roleForIndex,
  playbackFlags,
  prefetchShortsUri,
  isShortsAvailable,
} from '../feed';
import {
  claimFeedAudio,
  releaseFeedAudio,
  markFeedAudioRouteDirty,
} from '../services/feedAudioSession';
import { invalidateMediaPlaybackAudioMode } from '../services/notifySound';
import {
  getPendingOptimisticPosts,
  subscribePostUploads,
} from '../services/postUploadQueue';
import { setPostLiked } from '../services/LikeService';
import { recordPostView, getPostViewCount } from '../services/PostViewService';
import {
  setReachSession,
  reportImpression,
  reportEngagement,
  flushReachEvents,
} from '../services/blypReachClient';
import { useAuth, hardLogout } from '../hooks/useCommon';
import { ensureFirebaseAuthReady } from '../utils/firebaseAuthHelper';
import {
  attachAccountFeedPriority,
  filterSuppressedAccounts,
  isAccountFeedSuppressed,
} from '../services/feedRankingService';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const DEFAULT_HEADER_HEIGHT = responsiveSize(120);

// All mock/fallback video content removed. Feed now relies solely on Firestore.

const randomCommentsData = [
  { user: 'sarah_m', text: 'This is amazing! ðŸ”¥', time: '2m' },
  { user: 'john_doe', text: 'Love the vibes âœ¨', time: '5m' },
  { user: 'creative_mind', text: 'So inspiring!', time: '8m' },
  { user: 'photo_lover', text: 'Goals! ðŸ’¯', time: '12m' },
  { user: 'daily_content', text: 'Need more like this', time: '15m' },
  { user: 'wanderlust_soul', text: 'Perfect timing', time: '18m' },
  { user: 'art_enthusiast', text: 'Incredible work', time: '22m' },
  { user: 'lifestyle_blogger', text: 'Obsessed with this!', time: '25m' },
  { user: 'travel_addict', text: 'Where is this?', time: '28m' },
  { user: 'foodie_life', text: 'Recipe please! ðŸ™', time: '30m' },
  { user: 'fitness_guru', text: 'Motivation right here', time: '35m' },
  { user: 'tech_lover', text: 'Mind blown ðŸ¤¯', time: '40m' },
  { user: 'music_fan', text: 'What song is this?', time: '45m' },
  { user: 'nature_lover', text: 'Absolutely beautiful', time: '1h' },
  { user: 'creative_studio', text: 'Pure artistry', time: '1h' },
];

// === MediaCarousel (fixed) ===
const MediaCarousel = ({ media, style, feedIndex, isDiscoverItemActive, isMuted = true }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  // Use the live window width so horizontal paging stays aligned after a fold/
  // unfold (Z Fold tablet mode) instead of a width frozen at module load.
  const { width: winWidth } = useWindowDimensions();

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems && viewableItems.length > 0) {
      const vi = viewableItems[0];
      if (typeof vi.index === 'number') setCurrentIndex(vi.index);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  if (!media || !Array.isArray(media) || media.length === 0) {
    return null;
  }

  const renderMediaItem = ({ item, index }) => {
    const isVideo =
      item.type === 'video' ||
      (item.type && item.type.includes && item.type.includes('video')) ||
      !!item.videoUrl;

    // Disk warm via mediaPrefetch; EnhancedVideo resolves cache without list setState.
    const mediaUri = fixStorageUrl(item.url || item.uri || item.videoUrl || item.imageUrl);
    const cellActive = isDiscoverItemActive
      ? isDiscoverItemActive(feedIndex) && index === currentIndex
      : index === currentIndex;

    if (isVideo) {
      return (
        <View style={[styles.carouselItemContainer, { width: winWidth }]}>
          <PremiumFeedVideo
            uri={mediaUri}
            poster={item.thumbnail}
            style={StyleSheet.absoluteFill}
            shouldPlay={cellActive}
            shouldLoad={Math.abs(currentIndex - index) <= 2}
            isLooping={true}
            // Sticky feed mute from parent; inactive slides always silent.
            isMuted={!!isMuted || !cellActive}
            showChrome={false}
            audioOwnerId={cellActive ? `carousel:${feedIndex}:${index}` : null}
          />
        </View>
      );
    }

    return (
      <View style={[styles.carouselItemContainer, { width: winWidth }]}>
        <Image source={{ uri: mediaUri }} style={[styles.carouselMedia, { width: winWidth }, style]} resizeMode="cover" resizeMethod="resize" />
        <View style={styles.imageEnhancementOverlay} />
      </View>
    );
  };

  return (
    <View style={styles.carouselContainer}>
      <FlatList
        data={media}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={renderMediaItem}
        keyExtractor={(item, index) => `media-${index}`}
      />

      <View style={styles.mediaCounter}>
        <Text style={styles.mediaCounterText} allowFontScaling={false}>
          {currentIndex + 1}/{media.length}
        </Text>
      </View>

      {media.length > 1 && (
        <View style={styles.paginationDots}>
          {media.map((_, idx) => (
            <View
              key={idx}
              style={[styles.paginationDot, idx === currentIndex && styles.paginationDotActive]}
            />
          ))}
        </View>
      )}
    </View>
  );
};
// === end MediaCarousel ===

const formatBalance = (balance) => {
  if (balance >= 1000000) return (balance / 1000000).toFixed(1) + 'M';
  if (balance >= 1000) return (balance / 1000).toFixed(1) + 'K';
  return balance.toString();
};

const getPostGiftCoins = (post) => {
  const a = Number(post?.giftCoins);
  const b = Number(post?.coinsReceived);
  const c = Number(post?.giftTotalCoins);
  return Math.max(
    Number.isFinite(a) ? Math.trunc(a) : 0,
    Number.isFinite(b) ? Math.trunc(b) : 0,
    Number.isFinite(c) ? Math.trunc(c) : 0,
  );
};

// NOTE: Per-post comment counts are now driven by real Firestore comments.

// How many posts we pull per Firestore page. Many rows are images/silent clips
// filtered out for For You, so we over-fetch and keep paging until we have enough
// playable videos. Boot/refresh uses a wider window so shuffle has a real pool.
const FEED_PAGE_SIZE = 15;
const FEED_BOOT_FETCH = 60;
const FEED_GATHER_TARGET = 12;
const FEED_PREFETCH_REMAINING = 4;

const isValidFeedPost = (p) => isForYouFeedPost(p);

const isPlayableVideoPost = (p) => isVideoWithSoundPost(p);

/**
 * Simple For You order: drop suppressed accounts, then shuffle.
 * No follow-mix hydrate, promote fair-cap, score, or diversity pass.
 * @param {any[]} posts
 * @param {{ avoidCount?: number, remember?: boolean }} [opts]
 */
async function prepareForYouOrder(posts, opts = {}) {
  const candidates = Array.isArray(posts) ? posts : [];
  if (!candidates.length) return [];
  const shuffleOpts = {
    avoidCount: Number.isFinite(opts.avoidCount) ? opts.avoidCount : 3,
    remember: opts.remember !== false,
  };
  try {
    const withAccount = await attachAccountFeedPriority(candidates);
    return shufflePostsVaried(filterSuppressedAccounts(withAccount), shuffleOpts);
  } catch (_) {
    return shufflePostsVaried(candidates, shuffleOpts);
  }
}

function likeCountFromPost(post) {
  if (!post) return null;
  if (Number.isFinite(Number(post.likeCount))) return Math.max(0, Math.trunc(Number(post.likeCount)));
  if (Number.isFinite(Number(post.likes))) return Math.max(0, Math.trunc(Number(post.likes)));
  if (Array.isArray(post.likedBy)) return post.likedBy.length;
  return null;
}

function displayLikeCount(post, likeCounts) {
  const id = post?.id;
  const mapped = id != null ? likeCounts?.[id] : undefined;
  if (mapped != null && Number.isFinite(Number(mapped))) return Number(mapped);
  return likeCountFromPost(post) ?? 0;
}

function commentCountFromPost(post) {
  if (!post) return null;
  const raw =
    post.commentCount ??
    post.commentsCount ??
    post.comment_count ??
    post.numComments;
  if (Number.isFinite(Number(raw))) return Math.max(0, Math.trunc(Number(raw)));
  if (Array.isArray(post.comments)) return post.comments.length;
  return null;
}

const SHOW_DETAILS_TOP = 58;

function logForYouInventory(label, posts) {
  if (!__DEV__) return;
  try {
    const stats = feedInventoryStats(posts);
    if (stats.duplicates > 0 || stats.unique < 8) {
      console.log(`[ForYou] ${label}`, stats);
    }
  } catch {
    /* ignore */
  }
}

const HomeScreen = ({ navigation, route }) => {
  const [videos, setVideos] = useState([]);
  const [isEmptyFeed, setIsEmptyFeed] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [liked, setLiked] = useState({});
  const [likeCounts, setLikeCounts] = useState({});
  // postId -> coins gifted (optimistic + snapshot).
  const [giftCoinCounts, setGiftCoinCounts] = useState({});
  // Which feed video is manually paused (tap-to-pause).
  const [pausedFeedId, setPausedFeedId] = useState(null);
  // Sticky For You mute preference — survives swipe / soft re-rank / app blur.
  // Default unmuted (TikTok-style); neighbors stay silent via cellActive gate.
  const [feedAudioMuted, setFeedAudioMuted] = useState(false);
  const feedAudioMutedRef = useRef(false);
  // False only while we re-assert loudspeaker mode after Call / blur.
  const [feedAudioSessionReady, setFeedAudioSessionReady] = useState(true);
  const [commentCounts, setCommentCounts] = useState({});
  const [following, setFollowing] = useState({}); // keyed by creator userId
  const followingBusyRef = useRef(new Set());
  const [selectedTab, setSelectedTab] = useState('home');
  const selectedTabRef = useRef('home');
  const [homeEdition, setHomeEditionState] = useState('next');
  useEffect(() => subscribeHomeEdition(setHomeEditionState), []);
  const uidRef = useRef(null);
  const [prefs, setPrefs] = useState(null);
  const [randomPosts, setRandomPosts] = useState([]);
  // Start true so first paint / fresh install shows the teal spinner instead of
  // a dead frame or a premature "feed is quiet" empty state while we fetch.
  const [loading, setLoading] = useState(true);
  // Mirrors `loading` for synchronous reads inside callbacks (e.g. deciding
  // whether a Home-rail focus request should wait for the real feed page
  // instead of injecting into a still-empty/stale list).
  const loadingRef = useRef(true);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  const [currentDiscoverIndex, setCurrentDiscoverIndex] = useState(0);
  // Prefetch center may lead during swipe (ref-only). Native decode window
  // stays locked to currentDiscoverIndex so mid-swipe setState cannot remount
  // ExoPlayers and freeze the Fold.
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const [isTitleBarMinimized, setIsTitleBarMinimized] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedHashtags, setSelectedHashtags] = useState([]);
  const [filteredPosts, setFilteredPosts] = useState([]);
  const [heartsBurst, setHeartsBurst] = useState({ postId: null, key: 0 });
  const [menuVisible, setMenuVisible] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  // Header height state (measured). Use a default until first layout pass.
  const [headerHeight, setHeaderHeight] = useState(0);
  const [descriptionVisibleIndex, setDescriptionVisibleIndex] = useState(null); // only after "Show details"
  const descriptionHideTimeout = useRef(null);
  const [feedHeight, setFeedHeight] = useState(0);
  // feedHeight will be measured from the available content area (between header and bottom tabs)
  const flatListRef = useRef(null);
  const likePendingRef = useRef(new Set());
  const seedLikeSnapshot = useCallback((posts) => {
    if (!Array.isArray(posts) || posts.length === 0) return;
    setLiked((prev) => {
      const next = { ...prev };
      let changed = false;
      posts.forEach((post) => {
        if (!post?.id || likePendingRef.current.has(post.id)) return;
        const isLiked = uid ? !!post.likedBy?.includes(uid) : false;
        if (next[post.id] === isLiked) return;
        next[post.id] = isLiked;
        changed = true;
      });
      return changed ? next : prev;
    });
    setLikeCounts((prev) => {
      const next = { ...prev };
      let changed = false;
      posts.forEach((post) => {
        if (!post?.id || likePendingRef.current.has(post.id)) return;
        const n = likeCountFromPost(post);
        if (n == null) return;
        if (next[post.id] === n) return;
        next[post.id] = n;
        changed = true;
      });
      return changed ? next : prev;
    });
    setCommentCounts((prev) => {
      const next = { ...prev };
      let changed = false;
      posts.forEach((post) => {
        if (!post?.id) return;
        const n = commentCountFromPost(post);
        if (n == null) return;
        if (next[post.id] === n) return;
        next[post.id] = n;
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [uid]);
  const commentScrollValue = useRef(new Animated.Value(0)).current;
  const currentDiscoverIndexRef = useRef(0);
  const discoverLoadIndexRef = useRef(0);
  const lastForYouPrefetchAtRef = useRef(0);
  const feedScrollVelocityRef = useRef(0);
  const feedScrollSampleRef = useRef({ y: 0, t: 0 });
  const feedSettledRef = useRef(true);
  const hasLoggedFirebaseAuthNotReadyRef = useRef(false);

  // For You pagination: cursor = last Firestore doc loaded (by date), used to
  // fetch the next, older page. hasMore stops us querying past the end.
  const forYouCursorRef = useRef(null);
  const forYouHasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  // Phase 2 of the feed: once the date-ordered posts are exhausted we keep
  // paginating through EVERY post by document id (implicit __name__ order). This
  // surfaces posts that have no `date` field — which orderBy('date') silently
  // drops — so the feed shows all content and scrolls endlessly.
  const forYouPhaseRef = useRef('date'); // 'date' -> 'all'
  const forYouAllCursorRef = useRef(null);
  const forYouAllHasMoreRef = useRef(true);
  const forYouShownIdsRef = useRef(new Set());
  // When the corpus is exhausted we stop appending (hard id dedupe). Re-walking
  // and re-stamping the same posts made scroll feel like endless repeats.
  const forYouCycleRef = useRef(0);
  const randomPostsRef = useRef([]);
  // Home For You rail (and deep-links) ask to land on a specific post in the
  // ranked feed. Kept until FlatList can scroll there; pin suppresses soft
  // re-ranks that would yank the focused clip while still on index 0.
  // Post ref survives snapshot/rank rebuilds that would otherwise wipe inject.
  const pendingForYouFocusRef = useRef(null); // { postId, post? }
  const forYouFocusPinIdRef = useRef(null);
  const forYouFocusPostRef = useRef(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const { uid, authReady, isAuthenticated } = useAuth();
  // Tab bar is absolute-positioned; sticky actions sit just above it.
  const tabBarHeight = useBottomTabBarHeight();
  const forYouActionBottom = tabBarHeight;
  const forYouOverlayInset = feedOverlayBottomInset(forYouActionBottom);
  const activeForYouPost =
    selectedTab === 'A' && randomPosts?.length
      ? randomPosts[Math.min(Math.max(0, currentDiscoverIndex), randomPosts.length - 1)]
      : null;

  useEffect(() => {
    feedAudioMutedRef.current = feedAudioMuted;
  }, [feedAudioMuted]);

  // Avoid fighting Spotify when For You is unmuted and focused.
  useEffect(() => {
    if (feedAudioMuted || selectedTab !== 'A' || !isScreenFocused) return undefined;
    try {
      const { pauseSpotifyForBlypAudio } = require('../services/spotifyAudioCoordinator');
      pauseSpotifyForBlypAudio('for_you_unmuted').catch(() => {});
    } catch { /* optional */ }
    return undefined;
  }, [feedAudioMuted, selectedTab, isScreenFocused, currentDiscoverIndex]);

  // One audible owner for For You: reclaim speaker once on enter; swipe only
  // swaps the owner token (routeDirty latch skips setAudioMode).
  const forYouSessionActiveRef = useRef(false);
  useEffect(() => {
    const postId = activeForYouPost?.id != null ? String(activeForYouPost.id) : '';
    const onForYou = selectedTab === 'A' && isScreenFocused;
    const shouldOwn =
      !!postId
      && onForYou
      && !feedAudioMuted
      && pausedFeedId !== postId;

    if (!onForYou) {
      forYouSessionActiveRef.current = false;
      if (postId) releaseFeedAudio(postId);
      return undefined;
    }

    if (!shouldOwn) {
      if (postId) releaseFeedAudio(postId);
      return undefined;
    }

    const enteredForYou = !forYouSessionActiveRef.current;
    forYouSessionActiveRef.current = true;
    if (enteredForYou) {
      // One reclaim per For You enter (tab or screen focus) — not per swipe.
      invalidateMediaPlaybackAudioMode();
      markFeedAudioRouteDirty();
      setFeedAudioSessionReady(false);
    }

    let cancelled = false;
    claimFeedAudio(postId).then((ok) => {
      if (cancelled || !ok) return;
      // Mode is applied inside claimFeedAudio (latched). Hold unmute until
      // this resolves so setAudioModeAsync cannot kill an already-audible cell.
      setFeedAudioSessionReady(true);
    });
    return () => {
      cancelled = true;
      releaseFeedAudio(postId);
    };
  }, [
    activeForYouPost?.id,
    selectedTab,
    isScreenFocused,
    feedAudioMuted,
    pausedFeedId,
  ]);


  const enabledPages = useMemo(() => getEnabledPages(prefs), [prefs]);
  const ribbonPages = useMemo(
    () => getHomeRibbonPages(prefs?.pages || enabledPages),
    [prefs, enabledPages],
  );
  const firstEnabledPageKey = useMemo(() => getFirstEnabledPageKey(prefs), [prefs]);
  const enabledPagesRef = useRef(enabledPages);
  const ribbonPagesRef = useRef(ribbonPages);
  useEffect(() => { enabledPagesRef.current = enabledPages; }, [enabledPages]);
  useEffect(() => { ribbonPagesRef.current = ribbonPages; }, [ribbonPages]);

  const followingRef = useRef(new Set());
  // Local impression dedupe (not used for ordering).
  const forYouRecentlySeenIdsRef = useRef(new Set());
  const forYouRecentlySeenOrderRef = useRef([]);

  /** Stamp + hard-dedupe + keep Home-rail focus post through list rebuilds. */
  const buildForYouList = useCallback((posts, cycle = forYouCycleRef.current) => {
    const pinId = forYouFocusPinIdRef.current
      || pendingForYouFocusRef.current?.postId
      || null;
    const pinPost =
      forYouFocusPostRef.current
      || pendingForYouFocusRef.current?.post
      || null;
    const next = ensureFocusPostInList(posts, {
      postId: pinId,
      post: pinPost,
      cycle,
      isEligible: isValidFeedPost,
    });
    logForYouInventory('list', next);
    return next;
  }, []);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribeToFollowingList(uid, (set) => {
      followingRef.current = set || new Set();
      // Keep the For You follow-pill map in sync with the live graph.
      const next = {};
      (set || new Set()).forEach((id) => { next[id] = true; });
      setFollowing(next);
    });
    return unsub;
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribePreferences(uid, setPrefs);
    return unsub;
  }, [uid]);

  // Position the For You FlatList on a deep-linked / Home-rail post. Prefer the
  // post's place in the loaded continuum; if it isn't in the window yet,
  // inject it at the front and keep the rest of the feed after it.
  const applyPendingForYouFocus = useCallback(() => {
    const pending = pendingForYouFocusRef.current;
    const postId = String(
      pending?.postId || forYouFocusPinIdRef.current || '',
    );
    if (!postId) return false;
    if (selectedTabRef.current !== 'A') return false;

    let list = randomPostsRef.current || [];
    let idx = list.findIndex((p) => p && String(p.id) === postId);
    const candidate =
      pending?.post || forYouFocusPostRef.current || null;

    if (idx < 0) {
      if (!candidate || !isValidFeedPost(candidate)) {
        // No injectable post yet — keep waiting only while the feed is empty.
        if ((randomPostsRef.current || []).length === 0) return false;
        pendingForYouFocusRef.current = null;
        return false;
      }
      const cycle = forYouCycleRef.current;
      const injected = buildForYouList(
        [candidate, ...list.filter((p) => p && String(p.id) !== postId)],
        cycle,
      );
      randomPostsRef.current = injected;
      setRandomPosts(injected);
      list = injected;
      idx = list.findIndex((p) => p && String(p.id) === postId);
      if (idx < 0) idx = 0;
    }

    pendingForYouFocusRef.current = null;
    forYouFocusPinIdRef.current = postId;
    if (candidate) forYouFocusPostRef.current = candidate;
    currentDiscoverIndexRef.current = idx;
    setCurrentDiscoverIndex(idx);
    setPausedFeedId(null);

    const scroll = () => {
      try {
        if (feedHeight > 0) {
          flatListRef.current?.scrollToIndex?.({ index: idx, animated: false });
        } else {
          flatListRef.current?.scrollToOffset?.({
            offset: 0,
            animated: false,
          });
        }
      } catch {
        try {
          flatListRef.current?.scrollToOffset?.({
            offset: Math.max(0, idx) * (feedHeight || 0),
            animated: false,
          });
        } catch { /* no-op */ }
      }
    };
    // FlatList may not be mounted on the same tick we switch to tab A.
    requestAnimationFrame(() => {
      scroll();
      setTimeout(scroll, 50);
    });
    return true;
  }, [feedHeight, buildForYouList]);

  const openForYouAtPost = useCallback((post) => {
    const postId = post?.id != null ? String(post.id) : '';
    if (!postId) {
      setSelectedTab('A');
      return;
    }
    pendingForYouFocusRef.current = { postId, post };
    forYouFocusPinIdRef.current = postId;
    forYouFocusPostRef.current = post;
    setSelectedTab('A');
  }, []);

  // Tie the earn-your-reach session to this user (hashed server-side) and make sure
  // any queued post signals are flushed when the feed unmounts.
  useEffect(() => {
    setReachSession(uid || 'anon');
    return () => flushReachEvents();
  }, [uid]);

  // Versioned terms acceptance — if the user hasn't accepted the current "How Blyp
  // works" version, show it once (non-blocking; they land back here after).
  const termsPromptedRef = useRef(false);
  useEffect(() => {
    if (!uid || !authReady) return;
    if (termsPromptedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const { needsAcceptance } = require('../services/termsService');
        if (await needsAcceptance(uid)) {
          if (!cancelled) {
            termsPromptedRef.current = true;
            navigation.navigate('HowBlypWorks', {
              mode: 'accept',
              onAccepted: () => {
                termsPromptedRef.current = true;
              },
            });
          }
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, authReady, navigation]);

  // The first shown header page is the landing page. Follow a newer local/remote
  // preference only while the user is still on the previous landing page, so a
  // late Firestore hydrate cannot yank them away after they start browsing.
  const previousFirstPageRef = useRef(null);
  const landingUidRef = useRef(null);
  useEffect(() => {
    if (!prefs) return;
    const userKey = uid || 'anon';
    const userChanged = landingUidRef.current !== userKey;
    const previousFirst = userChanged ? null : previousFirstPageRef.current;
    const selectedStillEnabled =
      ribbonPages.some((page) => page.key === selectedTab) ||
      enabledPages.some((page) => page.key === selectedTab);

    landingUidRef.current = userKey;
    previousFirstPageRef.current = firstEnabledPageKey;
    if (
      userChanged ||
      previousFirst === null ||
      selectedTab === previousFirst ||
      !selectedStillEnabled
    ) {
      setSelectedTab(firstEnabledPageKey);
    }
  }, [uid, prefs, enabledPages, ribbonPages, firstEnabledPageKey, selectedTab]);

  // Double-tap the bottom Home button → first shown header page (never hard-coded).
  useTabReset('Home', () => {
    const targetKey = enabledPagesRef.current?.[0]?.key || 'home';
    setSelectedTab(targetKey);
    setCurrentIndex(0);
    setCurrentDiscoverIndex(0);
    try { flatListRef.current?.scrollToOffset?.({ offset: 0, animated: true }); } catch { }
  });

  // Guided tour: jump to For You / Home hub without fighting local tab state.
  useEffect(() => {
    return subscribeTourSelect((payload) => {
      if (payload?.screen !== 'Home' || !payload?.tab) return;
      setSelectedTab(payload.tab);
    });
  }, []);

  // --- Horizontal swipe between header tabs --------------------------------
  // Gesture-handler is shimmed to a no-op for stability, so we use the built-in
  // PanResponder. Its responder negotiation is exactly what we want: a child
  // horizontal carousel (the Home rails) claims the touch first and keeps
  // scrolling, while a decisive horizontal swipe over empty/vertical areas
  // flips to the adjacent header tab. Vertical feed scrolling is never claimed.
  const goToAdjacentTab = useCallback((dir) => {
    const keys = (ribbonPagesRef.current || []).map((p) => p.key);
    const i = keys.indexOf(selectedTabRef.current);
    if (i < 0) return;
    const ni = i + dir;
    if (ni < 0 || ni >= keys.length) return;
    setSelectedTab(keys[ni]);
    setCurrentDiscoverIndex(0);
    setCurrentIndex(0);
  }, []);

  const tabSwipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, g) =>
        Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
      onPanResponderRelease: (_evt, g) => {
        const fast = Math.abs(g.vx) > 0.35;
        if (g.dx <= -55 || (fast && g.vx < 0)) goToAdjacentTab(1); // swipe left → next
        else if (g.dx >= 55 || (fast && g.vx > 0)) goToAdjacentTab(-1); // swipe right → prev
      },
    }),
  ).current;

  useEffect(() => {
    selectedTabRef.current = selectedTab;
    if (selectedTab !== 'A') {
      // Leaving For You — drop soft-rerank pin and any unconsumed focus request
      // from a prior visit. openForYouAtPost sets pending while still on Home,
      // then switches to A in the same event; this effect then runs with A and
      // does not clear that fresh pending.
      forYouFocusPinIdRef.current = null;
      forYouFocusPostRef.current = null;
      pendingForYouFocusRef.current = null;
    } else {
      applyPendingForYouFocus();
    }
  }, [selectedTab, applyPendingForYouFocus]);

  // After publishing a post, ReviewScreen routes here with `focusFeed` so the
  // user lands on the For You feed (key 'A') instead of the HomeBase hub — they
  // were previously dropped on the hub with no way to see what they just posted
  // (P7.7). Clear the param so a later tab switch doesn't get yanked back.
  // Also honor initialPostId / focusPostId / focusPost for Home-rail deep links.
  useEffect(() => {
    const params = route?.params || {};
    const focusId =
      params.initialPostId ||
      params.focusPostId ||
      params.focusPost?.id ||
      null;
    const focusPost = params.focusPost || null;
    if (params.focusFeed || focusId) {
      if (focusId) {
        pendingForYouFocusRef.current = {
          postId: String(focusId),
          post: focusPost,
        };
        forYouFocusPinIdRef.current = String(focusId);
        if (focusPost) forYouFocusPostRef.current = focusPost;
      }
      setSelectedTab('A');
      try {
        navigation?.setParams?.({
          focusFeed: undefined,
          initialPostId: undefined,
          focusPostId: undefined,
          focusPost: undefined,
        });
      } catch { /* no-op */ }
    }
  }, [
    route?.params?.focusFeed,
    route?.params?.initialPostId,
    route?.params?.focusPostId,
    route?.params?.focusPost,
    navigation,
  ]);

  // When the feed finishes loading after a Home-rail tap, seek to the pending post.
  useEffect(() => {
    if (selectedTab !== 'A') return;
    if (!randomPosts.length) return;
    applyPendingForYouFocus();
  }, [selectedTab, randomPosts.length, applyPendingForYouFocus]);

  // Notification taps can deep-link straight back to the opted-in topic page.
  // Wait until cross-device preferences have hydrated so the page key exists.
  useEffect(() => {
    const topicPageKey = route?.params?.topicPageKey;
    if (!isTopicPageKey(topicPageKey)) return;
    if (!enabledPages.some((page) => page.key === topicPageKey)) return;
    setSelectedTab(topicPageKey);
    try {
      navigation?.setParams?.({ topicPageKey: undefined });
    } catch {
      // no-op
    }
  }, [route?.params?.topicPageKey, enabledPages, navigation]);

  // Prepend in-flight background publishes (local video URI) until Firestore lands.
  useEffect(() => {
    const mergePending = () => {
      const pending = getPendingOptimisticPosts().filter(isValidFeedPost);
      if (!pending.length) return;
      setRandomPosts((prev) => {
        const have = new Set((prev || []).map((p) => String(p.id)));
        const cycle = forYouCycleRef.current;
        const fresh = pending.filter((p) => p?.id && !have.has(String(p.id)));
        if (!fresh.length) return prev;
        const next = buildForYouList([...fresh, ...(prev || [])], cycle);
        randomPostsRef.current = next;
        setIsEmptyFeed(false);
        return next;
      });
      setVideos((prev) => {
        const have = new Set((prev || []).map((p) => p.id));
        const vids = pending.filter(isPlayableVideoPost).filter((p) => !have.has(p.id));
        return vids.length ? [...vids, ...(prev || [])] : prev;
      });
    };
    mergePending();
    return subscribePostUploads(() => {
      mergePending();
      setRandomPosts((prev) => {
        const still = new Set(getPendingOptimisticPosts().map((p) => p.id));
        const next = (prev || []).filter((p) => !p._pendingUpload || still.has(p.id));
        if (next.length === (prev || []).length) return prev;
        randomPostsRef.current = next;
        return next;
      });
      setVideos((prev) => {
        const still = new Set(getPendingOptimisticPosts().map((p) => p.id));
        const next = (prev || []).filter((p) => !p._pendingUpload || still.has(p.id));
        return next.length === (prev || []).length ? prev : next;
      });
    });
  }, []);

  useEffect(() => {
    uidRef.current = uid || null;
  }, [uid]);

  useEffect(() => {
    currentDiscoverIndexRef.current = currentDiscoverIndex;
  }, [currentDiscoverIndex]);

  // Keep prefetch center aligned when audible index jumps (refresh / focus pin).
  useEffect(() => {
    discoverLoadIndexRef.current = currentDiscoverIndex;
  }, [currentDiscoverIndex]);

  const warmForYouOpenings = useCallback((center) => {
    const list = randomPostsRef.current;
    if (!Array.isArray(list) || !list.length || !isShortsAvailable()) return;
    const c = Math.max(0, Math.min(list.length - 1, Number(center) || 0));
    // Light cache warm only (±2 × 512KB). Full decode stays on settled ±1 pool.
    for (let d = 0; d <= 2; d += 1) {
      const idxs = d === 0 ? [c] : [c + d, c - d];
      for (const i of idxs) {
        if (i < 0 || i >= list.length) continue;
        const playUri = resolvePlayableUri(list[i]).playUri;
        if (playUri) prefetchShortsUri(playUri, 524_288).catch(() => {});
      }
    }
  }, []);

  // Details stay off by default. "Show details" reveals them briefly, then hides again.
  const showDescriptionForIndex = useCallback((index) => {
    setDescriptionVisibleIndex(index);
    if (descriptionHideTimeout.current) {
      clearTimeout(descriptionHideTimeout.current);
    }
    descriptionHideTimeout.current = setTimeout(() => {
      setDescriptionVisibleIndex(null);
    }, 3500);
  }, []);

  const handleShowDescription = (index) => {
    showDescriptionForIndex(index);
  };

  // Clear any open details overlay when leaving For You / losing focus.
  useEffect(() => {
    if (selectedTab !== 'A' || !isScreenFocused) {
      setDescriptionVisibleIndex(null);
      if (descriptionHideTimeout.current) {
        clearTimeout(descriptionHideTimeout.current);
        descriptionHideTimeout.current = null;
      }
    }
  }, [selectedTab, isScreenFocused]);

  useEffect(() => {
    const animateComments = () => {
      commentScrollValue.setValue(0);
      Animated.loop(
        Animated.timing(commentScrollValue, {
          toValue: 1,
          duration: 19500,
          useNativeDriver: true,
        }),
        { iterations: -1 }
      ).start();
    };
    animateComments();
  }, []);

  const handleUserProfilePress = (user, post = null) => {
    const userId = post?.userId || user?.userId || user?.id || user?.username || Math.random().toString(36);
    const username = user?.username || '@user';
    console.log('ðŸ“± HomeScreen: Navigating to user profile:', { userId, username, userObj: user });
    navigation.navigate('UserProfile', {
      userId: userId,
      username: username,
    });
  };

  const handlePostPress = (post) => {
    console.log('ðŸ” Opening media viewer for post:', post.id);
    const list = selectedTab === 'A' ? randomPosts : videos;
    navigation.navigate('MediaViewer', mediaViewerParams(post, list));
  };

  const feedVideoTapRef = useRef({ at: 0, postId: null, timer: null });

  const handleAddTestPosts = async () => {
    console.log('ðŸ§ª Adding test posts with multiple photos...');
    try {
      const result = await addTestPostsWithMultiplePhotos();
      if (result.success) {
        console.log('âœ… Test posts added successfully!');
        Alert.alert('Test Posts Added', 'Two test posts with multiple photos have been added! Switch to the "Discover" tab to see them.');
      } else {
        console.error('âŒ Failed to add test posts:', result.error);
        Alert.alert('Error', 'Failed to add test posts: ' + result.error);
      }
    } catch (error) {
      console.error('âŒ Error adding test posts:', error);
      Alert.alert('Error', 'Failed to add test posts: ' + error.message);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      return () => {
        setIsScreenFocused(false);
      };
    }, [])
  );

  // NOTE: The Videos-tab feed used to have its own `posts` onSnapshot listener
  // (limit 20) that overlapped with the For You listener below (limit 30, same
  // collection + order). They've been merged into the single listener below,
  // which now also derives `videos` from the same snapshot — halving Firestore
  // bandwidth and the per-change JS work on Home.

  useEffect(() => {
    const t = setTimeout(() => {
      if (selectedTab === 'A') {
        setCurrentDiscoverIndex((idx) => idx);
      } else if (selectedTab === 'B' && currentIndex === 0) {
        setCurrentIndex(0);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [selectedTab]);

  useEffect(() => {
    if (!authReady) {
      // Stay in the loading state until auth resolves — avoid a frozen blank frame.
      setLoading(true);
      return;
    }
    if (!isAuthenticated || !uid) {
      setRandomPosts([]);
      setIsEmptyFeed(false);
      setLoading(false);
      return;
    }
    if (!isScreenFocused || (selectedTab !== 'A' && selectedTab !== 'B')) {
      return;
    }
    if (!firebaseEnabled || !db || typeof db.collection !== 'function') {
      console.warn('WARN [HOME] Firebase disabled or db unavailable (randomPosts).');
      setRandomPosts([]);
      setIsEmptyFeed(true);
      setLoading(false);
      return;
    }
    let mounted = true;
    let isInitialLoad = true;
    let unsubscribe = null;
    // Show spinner until first content (or confirmed empty) is ready.
    setLoading(true);

    (async () => {
      try {
        await ensureFirebaseAuthReady({ uid, timeoutMs: 12000 });
        if (!mounted) return;
        // Warm the block cache so blocked authors are filtered on the first snapshot.
        await loadBlockedUsers().catch(() => {});
        if (!mounted) return;
        unsubscribe = db
          .collection('posts')
          .orderBy('date', 'desc')
          .limit(FEED_PAGE_SIZE)
          .onSnapshot(
            (snapshot) => {
              if (!mounted) return;
              const rawPosts = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
              // Hide posts from users you've blocked.
              const allPosts = filterBlocked(rawPosts, (p) => p.userId || p.uid);
              // Seed the pagination cursor ONCE from the first (live) page. This
              // listener re-fires on every like/view/comment change to a top post,
              // so re-seeding here would rewind the cursor back to post ~30 and
              // make "load more" re-fetch the same page forever (feed appeared to
              // stop after one page). We only set it on the initial load; from then
              // on loadMoreForYou advances the cursor as the viewer scrolls.
              if (isInitialLoad) {
                const liveDocs = snapshot.docs || [];
                forYouCursorRef.current = liveDocs.length ? liveDocs[liveDocs.length - 1] : null;
                forYouHasMoreRef.current = liveDocs.length >= FEED_PAGE_SIZE;
                // Reset the "all posts" phase 2 paginator for this fresh feed.
                forYouPhaseRef.current = 'date';
                forYouAllCursorRef.current = null;
                forYouAllHasMoreRef.current = true;
                forYouCycleRef.current = 0;
                forYouShownIdsRef.current = new Set(liveDocs.map((d) => d.id));
              }
              // Derive the Videos-tab feed from this same snapshot (previously a
              // separate listener). Only playable videos with a real URL.
              const validVideos = allPosts.filter(isPlayableVideoPost);
              setVideos((prev) => {
                // Preserve any older videos already appended by pagination.
                const have = new Set(validVideos.map((p) => p.id));
                const olderKept = (Array.isArray(prev) ? prev : []).filter((p) => !have.has(p.id));
                return [...validVideos, ...olderKept];
              });
              // Show ALL posts (images and videos)
              const validPosts = allPosts.filter(isValidFeedPost);
              if (validPosts.length === 0) {
                console.warn('WARN [HOME] No posts found in Firestore.');
                setRandomPosts([]);
                setIsEmptyFeed(true);
                setLoading(false);
                isInitialLoad = false;
              } else {
                // IMPORTANT: Keep a stable random order while the user is browsing.
                // Liking a post updates the doc, which triggers this snapshot; if we reshuffle
                // every time, the feed appears to "jump" to a different post.
                const cycle = forYouCycleRef.current;
                const initial = isInitialLoad;
                isInitialLoad = false;
                (async () => {
                  try {
                    if (initial) {
                      // Paint a shuffled first page immediately, then widen the
                      // pool with a one-shot boot fetch so reload has variety.
                      const provisional = buildForYouList(
                        await prepareForYouOrder(validPosts),
                        cycle,
                      );
                      setRandomPosts(provisional);
                      randomPostsRef.current = provisional;
                      seedLikeSnapshot(provisional);
                      setCurrentIndex(0);
                      if (!forYouFocusPinIdRef.current && !pendingForYouFocusRef.current) {
                        setCurrentDiscoverIndex(0);
                        currentDiscoverIndexRef.current = 0;
                      }
                      setIsEmptyFeed(false);
                      setLoading(false);
                      logForYouInventory('boot-provisional', provisional);

                      try {
                        const bootSnap = await db
                          .collection('posts')
                          .orderBy('date', 'desc')
                          .limit(FEED_BOOT_FETCH)
                          .get();
                        if (!mounted) return;
                        const bootDocs = bootSnap?.docs || [];
                        if (bootDocs.length) {
                          forYouCursorRef.current = bootDocs[bootDocs.length - 1];
                          forYouHasMoreRef.current = bootDocs.length >= FEED_BOOT_FETCH;
                          forYouShownIdsRef.current = new Set(bootDocs.map((d) => d.id));
                        }
                        const bootPosts = filterBlocked(
                          bootDocs.map((d) => ({ id: d.id, ...d.data() })),
                          (p) => p.userId || p.uid,
                        ).filter(isValidFeedPost);
                        if (!bootPosts.length) return;
                        if (forYouFocusPinIdRef.current || pendingForYouFocusRef.current) return;
                        // Capture head before the async shuffle gap so mid-swipe
                        // apply can refuse a full replace under the playing clip.
                        const provisionalHeadId = randomPostsRef.current?.[0]?.id != null
                          ? String(randomPostsRef.current[0].id)
                          : null;
                        const ordered = await prepareForYouOrder(bootPosts);
                        if (!mounted) return;
                        if (forYouFocusPinIdRef.current || pendingForYouFocusRef.current) return;
                        const shuffled = buildForYouList(ordered, cycle);
                        const decision = resolveForYouBootWidenApply({
                          currentList: randomPostsRef.current,
                          widenedList: shuffled,
                          discoverIndex: currentDiscoverIndexRef.current,
                          focusPinned: Boolean(
                            forYouFocusPinIdRef.current || pendingForYouFocusRef.current,
                          ),
                          provisionalHeadId,
                        });
                        if (decision.mode === 'skip' || !decision.list) return;
                        const next = decision.mode === 'append'
                          ? buildForYouList(decision.list, cycle)
                          : decision.list;
                        randomPostsRef.current = next;
                        setRandomPosts(next);
                        seedLikeSnapshot(next);
                        logForYouInventory(
                          decision.mode === 'append' ? 'boot-append' : 'boot',
                          next,
                        );
                      } catch (bootErr) {
                        console.warn(
                          'HOME: For You boot widen failed',
                          bootErr?.message || String(bootErr),
                        );
                      }
                    } else {
                      // Fast path: likes/views/gifts on the live page must not
                      // reshuffle the feed under the user's finger.
                      const liveIds = new Set(validPosts.map((p) => p.id));
                      const prev = randomPostsRef.current || [];
                      const prevIds = new Set(prev.map((p) => String(p.id)));
                      const hasBrandNew = validPosts.some((p) => !prevIds.has(String(p.id)));

                      if (!hasBrandNew && prev.length > 0) {
                        let changed = false;
                        const byId = new Map(validPosts.map((p) => [p.id, p]));
                        const next = prev.map((existing) => {
                          if (!liveIds.has(existing.id)) return existing;
                          const updated = byId.get(existing.id);
                          if (!updated) return existing;
                          const nextLike = Number(
                            updated.likeCount ?? updated.likes ?? updated.likedBy?.length ?? 0,
                          );
                          const prevLike = Number(
                            existing.likeCount ?? existing.likes ?? existing.likedBy?.length ?? 0,
                          );
                          const nextGift = getPostGiftCoins(updated);
                          const prevGift = getPostGiftCoins(existing);
                          const nextViews = getPostViewCount(updated);
                          const prevViews = getPostViewCount(existing);
                          if (
                            nextLike === prevLike &&
                            nextGift === prevGift &&
                            nextViews === prevViews &&
                            updated.likedBy === existing.likedBy
                          ) {
                            return existing;
                          }
                          changed = true;
                          return {
                            ...existing,
                            likeCount: updated.likeCount ?? existing.likeCount,
                            likes: updated.likes ?? existing.likes,
                            likedBy: updated.likedBy ?? existing.likedBy,
                            giftCoins: updated.giftCoins ?? existing.giftCoins,
                            gifts: updated.gifts ?? existing.gifts,
                            viewCount: updated.viewCount ?? existing.viewCount,
                            views: updated.views ?? existing.views,
                          };
                        });
                        if (changed) {
                          const stamped = buildForYouList(next, cycle);
                          randomPostsRef.current = stamped;
                          setRandomPosts(stamped);
                        }
                      } else {
                        const withAccount = await attachAccountFeedPriority(validPosts);
                        if (!mounted) return;
                        const visible = filterSuppressedAccounts(withAccount);
                        setRandomPosts((prevList) => {
                          if (!Array.isArray(prevList) || prevList.length === 0) {
                            const stamped = buildForYouList(
                              shufflePostsVaried(visible, { avoidCount: 3 }),
                              cycle,
                            );
                            randomPostsRef.current = stamped;
                            return stamped;
                          }

                          const byId = new Map(visible.map((p) => [String(p.id), p]));
                          const next = [];
                          const seen = new Set();

                          prevList.forEach((existing) => {
                            const eid = String(existing.id);
                            if (seen.has(eid)) return;
                            const updated = byId.get(eid);
                            if (updated) {
                              seen.add(eid);
                              next.push({
                                ...updated,
                                feedKey: existing.feedKey || `${updated.id}__${cycle}`,
                              });
                              byId.delete(eid);
                            } else if (!isAccountFeedSuppressed(existing)) {
                              seen.add(eid);
                              next.push(existing);
                            }
                          });

                          const brandNew = shufflePostsVaried(
                            visible.filter((p) => byId.has(String(p.id))),
                            { avoidCount: 0, remember: false },
                          );
                          brandNew.forEach((p) => {
                            const id = String(p.id);
                            if (seen.has(id)) return;
                            seen.add(id);
                            next.push({ ...p, feedKey: `${p.id}__${cycle}` });
                          });

                          const stamped = buildForYouList(next, cycle);
                          randomPostsRef.current = stamped;
                          return stamped;
                        });
                      }
                      if (!mounted) return;
                      setIsEmptyFeed(false);
                      setLoading(false);
                    }
                  } catch (e) {
                    console.warn('HOME: For You order failed', e?.message || String(e));
                    if (!mounted) return;
                    setIsEmptyFeed(false);
                    setLoading(false);
                  }
                })();
              }
              seedLikeSnapshot(validPosts);
              setGiftCoinCounts((prev) => {
                const next = { ...prev };
                validPosts.forEach((post) => {
                  const server = getPostGiftCoins(post);
                  const local = Number(prev[post.id] || 0);
                  next[post.id] = Math.max(server, local);
                });
                return next;
              });
            },
            (error) => {
              console.warn('HOME: Error in randomPosts listener:', error?.message || String(error));
              setRandomPosts([]);
              setIsEmptyFeed(true);
              setLoading(false);
            }
          );
      } catch (e) {
        if (!hasLoggedFirebaseAuthNotReadyRef.current) {
          hasLoggedFirebaseAuthNotReadyRef.current = true;
          console.log('HOME: Firebase auth not ready; skipping feed listener', e?.message || String(e));
        }
        setRandomPosts([]);
        setIsEmptyFeed(true);
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      try { unsubscribe && unsubscribe(); } catch { }
    };
  }, [
    firebaseEnabled,
    uid,
    authReady,
    isAuthenticated,
    isScreenFocused,
    selectedTab,
    buildForYouList,
    seedLikeSnapshot,
  ]);

  // Pull-to-refresh: re-fetch a wider candidate window, shuffle, reset cursors.
  const loadRandomPosts = useCallback(async () => {
    if (!firebaseEnabled || !db || typeof db.collection !== 'function') {
      setRandomPosts((prev) => {
        const next = buildForYouList(
          shufflePostsVaried(prev, { avoidCount: 3 }),
          forYouCycleRef.current,
        );
        randomPostsRef.current = next;
        return next;
      });
      return;
    }
    setLoading(true);
    try {
      await loadBlockedUsers().catch(() => {});
      const snap = await db
        .collection('posts')
        .orderBy('date', 'desc')
        .limit(FEED_BOOT_FETCH)
        .get();
      const docs = snap?.docs || [];
      forYouCursorRef.current = docs.length ? docs[docs.length - 1] : null;
      forYouHasMoreRef.current = docs.length >= FEED_BOOT_FETCH;
      // Reset phase 2 (all-posts) paginator on refresh.
      forYouPhaseRef.current = 'date';
      forYouAllCursorRef.current = null;
      forYouAllHasMoreRef.current = true;
      forYouCycleRef.current += 1;
      forYouShownIdsRef.current = new Set(docs.map((d) => d.id));

      const fresh = filterBlocked(
        docs.map((d) => ({ id: d.id, ...d.data() })),
        (p) => p.userId || p.uid
      ).filter(isValidFeedPost);

      if (fresh.length === 0) {
        setRandomPosts([]);
        randomPostsRef.current = [];
        setIsEmptyFeed(true);
      } else {
        const ordered = await prepareForYouOrder(fresh);
        const shuffled = buildForYouList(ordered, forYouCycleRef.current);
        setRandomPosts(shuffled);
        randomPostsRef.current = shuffled;
        seedLikeSnapshot(shuffled);
        setIsEmptyFeed(false);
        setCurrentDiscoverIndex(0);
        currentDiscoverIndexRef.current = 0;
        logForYouInventory('refresh', shuffled);
      }
    } catch (e) {
      console.warn('[HOME] pull-to-refresh failed', e?.message);
    } finally {
      setLoading(false);
    }
  }, [buildForYouList, seedLikeSnapshot]);

  // Load the next (older) page of the For You feed and append it. Called as the
  // viewer nears the end of the list, which makes the feed effectively endless.
  const appendFeedPosts = useCallback(async (newPosts) => {
    if (!newPosts.length) return;
    newPosts.forEach((p) => forYouShownIdsRef.current.add(p.id));
    // Shuffle only the new page; do not re-order clips already on screen
    // or overwrite the session head used by the next pull-to-refresh.
    const ordered = await prepareForYouOrder(newPosts, { avoidCount: 0, remember: false });
    const stamped = buildForYouList(ordered, forYouCycleRef.current);
    setRandomPosts((prev) => {
      const haveIds = new Set(
        (Array.isArray(prev) ? prev : []).map((p) => String(p?.id || '')).filter(Boolean),
      );
      const toAdd = stamped.filter((p) => p?.id && !haveIds.has(String(p.id)));
      const next = toAdd.length ? buildForYouList([...prev, ...toAdd], forYouCycleRef.current) : prev;
      randomPostsRef.current = next;
      logForYouInventory('append', next);
      return next;
    });
    setVideos((prev) => {
      const have = new Set((Array.isArray(prev) ? prev : []).map((p) => p.id));
      const vids = newPosts.filter(isPlayableVideoPost).filter((p) => !have.has(p.id));
      return vids.length ? [...prev, ...vids] : prev;
    });
    seedLikeSnapshot(newPosts);
  }, [seedLikeSnapshot, buildForYouList]);

  const loadMoreForYou = useCallback(async () => {
    if (loadingMoreRef.current) return;
    if (!firebaseEnabled || !db || typeof db.collection !== 'function') return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      let gathered = [];
      let safety = 0;

      while (gathered.length < FEED_GATHER_TARGET && safety < 24) {
        safety += 1;

        if (forYouPhaseRef.current === 'date' && !forYouHasMoreRef.current) {
          forYouPhaseRef.current = 'all';
        }

        if (forYouPhaseRef.current === 'date') {
          const cursor = forYouCursorRef.current;
          if (!cursor) {
            forYouPhaseRef.current = 'all';
            continue;
          }
          const snap = await db
            .collection('posts')
            .orderBy('date', 'desc')
            .startAfter(cursor)
            .limit(FEED_PAGE_SIZE)
            .get();
          const docs = snap?.docs || [];
          if (docs.length > 0) forYouCursorRef.current = docs[docs.length - 1];
          forYouHasMoreRef.current = docs.length >= FEED_PAGE_SIZE;
          const olderPosts = filterBlocked(
            docs.map((d) => ({ id: d.id, ...d.data() })),
            (p) => p.userId || p.uid,
          )
            .filter((p) => !forYouShownIdsRef.current.has(p.id))
            .filter((p) => {
              const list = randomPostsRef.current || [];
              return !list.some((x) => x && String(x.id) === String(p.id));
            })
            .filter(isValidFeedPost);
          gathered = gathered.concat(olderPosts);
          if (!forYouHasMoreRef.current) forYouPhaseRef.current = 'all';
          continue;
        }

        // Phase 2 (all): posts without `date` + anything missed earlier.
        if (!forYouAllHasMoreRef.current && !forYouCursorRef.current) {
          break;
        }
        if (!forYouAllHasMoreRef.current) break;

        let q = db.collection('posts').limit(FEED_PAGE_SIZE);
        if (forYouAllCursorRef.current) q = q.startAfter(forYouAllCursorRef.current);
        const snap = await q.get();
        const docs = snap?.docs || [];
        if (docs.length > 0) forYouAllCursorRef.current = docs[docs.length - 1];
        forYouAllHasMoreRef.current = docs.length >= FEED_PAGE_SIZE;
        const fresh = filterBlocked(
          docs.map((d) => ({ id: d.id, ...d.data() })),
          (p) => p.userId || p.uid,
        )
          .filter((p) => !forYouShownIdsRef.current.has(p.id))
          .filter((p) => {
            const list = randomPostsRef.current || [];
            return !list.some((x) => x && String(x.id) === String(p.id));
          })
          .filter(isValidFeedPost);
        gathered = gathered.concat(fresh);
      }

      if (gathered.length > 0) {
        await appendFeedPosts(gathered);
      } else if (
        !forYouHasMoreRef.current &&
        !forYouAllHasMoreRef.current &&
        (randomPostsRef.current || []).length > 0
      ) {
        // Corpus exhausted. Do NOT re-append the same post ids — that made
        // scroll feel like a broken loop of repeats when inventory is small.
        logForYouInventory('exhausted', randomPostsRef.current);
      }
    } catch (e) {
      console.warn('[HOME] loadMoreForYou failed:', e?.message || String(e));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [
    firebaseEnabled,
    appendFeedPosts,
  ]);

  // Keep the first screen full even when the opening Firestore page is mostly images.
  useEffect(() => {
    if (selectedTab !== 'A') return;
    if (!randomPosts.length || randomPosts.length >= FEED_GATHER_TARGET) return;
    loadMoreForYou();
  }, [selectedTab, randomPosts.length, loadMoreForYou]);

  const handleLike = async (postId) => {
    if (requireAccount(navigation, 'like posts')) return;
    if (!authReady || !isAuthenticated || !uid) return;
    if (!postId) return;
    if (likePendingRef.current.has(postId)) return;
    likePendingRef.current.add(postId);

    const userId = uid;
    const post =
      (videos || []).find((v) => v.id === postId) ||
      (randomPosts || []).find((v) => v.id === postId) ||
      (filteredPosts || []).find((v) => v.id === postId);
    const wasLiked = !!liked[postId];
    const prevLikeCount = displayLikeCount(post, likeCounts);
    const nextLikeCount = Math.max(0, prevLikeCount + (wasLiked ? -1 : 1));

    // optimistic
    setLiked((prev) => ({ ...prev, [postId]: !wasLiked }));
    setLikeCounts((prev) => ({ ...prev, [postId]: nextLikeCount }));

    try {
      const res = await setPostLiked({
        postId,
        userId,
        metadata: {
          postTitle: post?.title || post?.caption || post?.description,
        },
      });
      if (!res?.ok) {
        throw res?.error || new Error(res?.reason || 'LIKE_FAILED');
      }

      // Reconcile to the server's actual post-toggle state (self-heals any drift
      // between our optimistic guess and what the transaction committed).
      if (typeof res.liked === 'boolean') {
        setLiked((prev) => ({ ...prev, [postId]: res.liked }));
      }
      if (Number.isFinite(res.count)) {
        setLikeCounts((prev) => ({ ...prev, [postId]: res.count }));
      }

      if (!wasLiked) {
        setHeartsBurst((prev) => ({ postId, key: prev.key + 1 }));
        // Earn-your-reach: a genuine like is a positive merit signal.
        reportEngagement('like', postId, post?.userId || post?.uid);
      }
      // Activity timestamps: LikeService.setPostLiked writes trackActivity(LIKE|UNLIKE).
    } catch (error) {
      console.error('Error updating like:', error);
      // revert explicitly
      setLiked((prev) => ({ ...prev, [postId]: wasLiked }));
      setLikeCounts((prev) => ({ ...prev, [postId]: prevLikeCount }));
      const reason = error?.code || error?.message || String(error || 'LIKE_FAILED');
      if (/permission|PERMISSION|insufficient/i.test(reason)) {
        Alert.alert('Couldn’t like', 'Please sign in again, then try liking once more.');
      }
    } finally {
      likePendingRef.current.delete(postId);
    }
  };

  const onFeedVideoPress = useCallback((item) => {
    const postId = item?.id;
    if (!postId) return;
    const now = Date.now();
    // Double-tap → like. Single-tap → pause / resume (premium player chrome).
    if (feedVideoTapRef.current.postId === postId && now - feedVideoTapRef.current.at < 320) {
      if (feedVideoTapRef.current.timer) clearTimeout(feedVideoTapRef.current.timer);
      feedVideoTapRef.current = { at: 0, postId: null, timer: null };
      handleLike(postId);
      return;
    }
    if (feedVideoTapRef.current.timer) clearTimeout(feedVideoTapRef.current.timer);
    feedVideoTapRef.current = { at: now, postId, timer: null };
    feedVideoTapRef.current.timer = setTimeout(() => {
      feedVideoTapRef.current = { at: 0, postId: null, timer: null };
      setPausedFeedId((prev) => (prev === postId ? null : postId));
    }, 300);
  }, [handleLike]);

  const handleFollow = async (creatorId) => {
    if (requireAccount(navigation, 'follow creators')) return;
    const targetId = String(creatorId || '').trim();
    if (!uid || !targetId || targetId === uid) return;
    if (followingBusyRef.current.has(targetId)) return;

    const wasFollowing = !!following[targetId] || followingRef.current?.has?.(targetId);
    const newFollowStatus = !wasFollowing;
    followingBusyRef.current.add(targetId);
    setFollowing((prev) => ({ ...prev, [targetId]: newFollowStatus }));
    // Keep ranking ref in sync for the current session.
    if (followingRef.current) {
      if (newFollowStatus) followingRef.current.add(targetId);
      else followingRef.current.delete(targetId);
    }
    try {
      const res = wasFollowing
        ? await unfollowUser(uid, targetId)
        : await followUser(uid, targetId);
      if (!res?.success) throw res?.error || new Error('follow write failed');
    } catch (error) {
      console.error('Error updating follow status:', error);
      setFollowing((prev) => ({ ...prev, [targetId]: wasFollowing }));
      if (followingRef.current) {
        if (wasFollowing) followingRef.current.add(targetId);
        else followingRef.current.delete(targetId);
      }
    } finally {
      followingBusyRef.current.delete(targetId);
    }
  };

  const handleOpenComments = (post) => {
    if (requireAccount(navigation, 'comment')) return;
    setSelectedPost(post);
    setCommentsVisible(true);
  };

  const handleSharePost = async (post) => {
    try {
      // Share an HTTPS blyp.world link so chat apps render a preview tile.
      const ok = await shareServiceSharePost(post);
      // Earn-your-reach: a share is the strongest positive signal a post can get.
      if (ok && post?.id) reportEngagement('share', post.id, post?.userId || post?.uid);
    } catch (error) {
      console.warn('[HOME] Share failed:', error);
    }
  };

  const handleCloseComments = () => {
    setCommentsVisible(false);
    setSelectedPost(null);
  };

  const getPostCommentCount = useCallback(
    (post) => {
      if (!post) return 0;
      const postId = post?.id;
      const fromModal = postId ? commentCounts?.[postId] : undefined;
      if (typeof fromModal === 'number' && Number.isFinite(fromModal)) return Math.max(0, fromModal);

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
    },
    [commentCounts]
  );

  // Viewability is for impressions/views ONLY. Active playback index comes from
  // scroll snap (handleDiscoverScrollEnd). Updating currentDiscoverIndex from
  // viewableItems[0] fought scroll-end and oscillated between adjacent cells
  // during paging / 60%-visible overlap → shouldPlay/mute flicker on For You.
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (selectedTabRef.current !== 'A') return;
    if (!viewableItems || viewableItems.length === 0) return;
    // Earn-your-reach: a post actually shown is an audition impression.
    viewableItems.forEach((vi) => {
      const p = vi?.item;
      if (!p?.id) return;
      if (!forYouRecentlySeenIdsRef.current.has(p.id)) {
        forYouRecentlySeenIdsRef.current.add(p.id);
        forYouRecentlySeenOrderRef.current.push(p.id);
        if (forYouRecentlySeenOrderRef.current.length > 200) {
          const expired = forYouRecentlySeenOrderRef.current.shift();
          if (expired) forYouRecentlySeenIdsRef.current.delete(expired);
        }
      }
      const authorId = p.userId || p.uid || p.authorId;
      reportImpression(p.id, authorId);
      // What counts as a view: the post must have dwelled on screen (enforced by
      // viewabilityConfig.minimumViewTime), it's deduped to one per user/post in
      // the service, and a creator's own post never counts as a view.
      if (authorId && authorId === uidRef.current) return;
      recordPostView(p.id, uidRef.current).catch(() => {});
    });
  }).current;

  const handleDiscoverScroll = useCallback(
    (e) => {
      if (selectedTabRef.current !== 'A') return;
      const y = e?.nativeEvent?.contentOffset?.y;
      if (!Number.isFinite(y) || !feedHeight) return;
      const now = Date.now();
      const prev = feedScrollSampleRef.current;
      if (prev.t > 0 && now > prev.t) {
        const dy = y - prev.y;
        const dtSec = (now - prev.t) / 1000;
        if (dtSec > 0.016) {
          feedScrollVelocityRef.current = Math.abs(dy / feedHeight) / dtSec;
        }
      }
      feedScrollSampleRef.current = { y, t: now };
      if (feedSettledRef.current) {
        feedSettledRef.current = false;
      }
      const maxIndex = Math.max(0, (randomPostsRef.current?.length || 0) - 1);
      // Ref-only mid-swipe prefetch — never setState here (that remounted pool slots).
      const raw = Math.floor(y / feedHeight + 0.5);
      const loadIndex = Math.min(maxIndex, Math.max(0, raw));
      if (loadIndex !== discoverLoadIndexRef.current) {
        discoverLoadIndexRef.current = loadIndex;
      }
      if (now - lastForYouPrefetchAtRef.current > 180) {
        lastForYouPrefetchAtRef.current = now;
        warmForYouOpenings(loadIndex);
      }
    },
    [feedHeight, warmForYouOpenings],
  );

  const handleDiscoverScrollEnd = useCallback(
    (e) => {
      if (selectedTabRef.current !== 'A') return;
      const y = e?.nativeEvent?.contentOffset?.y;
      if (!Number.isFinite(y) || !feedHeight) return;
      feedScrollSampleRef.current = { y, t: Date.now() };
      feedScrollVelocityRef.current = 0;
      if (!feedSettledRef.current) {
        feedSettledRef.current = true;
      }
      // Plain vertical paging feed: post index maps directly to the offset.
      const rawIndex = Math.round(y / feedHeight);
      const maxIndex = Math.max(0, (randomPosts?.length || 0) - 1);
      const nextIndex = Math.min(maxIndex, Math.max(0, rawIndex));
      discoverLoadIndexRef.current = nextIndex;
      warmForYouOpenings(nextIndex);
      if (nextIndex !== currentDiscoverIndexRef.current) {
        currentDiscoverIndexRef.current = nextIndex;
        setDescriptionVisibleIndex(null);
        setCurrentDiscoverIndex(nextIndex);
        setPausedFeedId(null);
      }
      // Drop Home-rail soft-rerank pin once the viewer leaves the focused clip.
      const pinId = forYouFocusPinIdRef.current;
      if (pinId) {
        const focused = randomPostsRef.current?.[nextIndex];
        if (!focused || String(focused.id) !== String(pinId)) {
          forYouFocusPinIdRef.current = null;
          forYouFocusPostRef.current = null;
        }
      }
      // Paging FlatLists often miss onEndReached — prefetch while a few clips remain.
      if (maxIndex - nextIndex <= FEED_PREFETCH_REMAINING) {
        loadMoreForYou();
      }
    },
    [feedHeight, randomPosts?.length, loadMoreForYou, warmForYouOpenings]
  );

  // Active item resolver for #4ME feed
  const isDiscoverItemActive = (index) => {
    if (!isScreenFocused) return false;
    if (selectedTab !== 'A') return false;
    if (currentDiscoverIndex == null || currentDiscoverIndex < 0) {
      return index === 0; // fallback
    }
    return index === currentDiscoverIndex;
  };

  // Disk / poster warm around the settled active. Opening-byte warm is throttled
  // from scroll (warmForYouOpenings) — never remount native players mid-swipe.
  useEffect(() => {
    const isRandomFeed = selectedTab === 'A';
    const list = isRandomFeed ? randomPosts : videos;
    const current = isRandomFeed ? currentDiscoverIndex : currentIndex;
    if (!list?.length) return;
    prefetchPostWindow(list, current, { radius: 2, images: true });
    if (isRandomFeed) warmForYouOpenings(current);
  }, [currentIndex, currentDiscoverIndex, selectedTab, videos, randomPosts, warmForYouOpenings]);

  const renderRandomPostItem = useCallback(({ item, index }) => {
    const mediaItems = item.media || [{ url: fixStorageUrl(item.imageUrl || item.videoUrl), type: item.type }];
    const hasMultipleMedia = mediaItems.length > 1;
    const isActive = isScreenFocused && selectedTab === 'A' && index === currentDiscoverIndex;
    const cellActive = isDiscoverItemActive(index);
    const cellMuted = feedAudioMuted || !feedAudioSessionReady || !cellActive;
    const showFullDescription = isActive && descriptionVisibleIndex === index;
    const giftTotal = getPostGiftCoins(item);
    const viewTotal = getPostViewCount(item);
    const showDetailsTop = SHOW_DETAILS_TOP;
    // Decode window locked to settled active — mid-swipe loadIndex must not remount.
    const commentsWarm = shouldLoadCell(index, currentDiscoverIndex, currentDiscoverIndex);

    // Diagnostic: no cover/contain / mediaDisplay framing.
    const cellHeight = feedHeight || screenHeight;

    return (
      <View style={[styles.videoContainer, { height: cellHeight }]}>
        <View style={styles.topMetaRow} pointerEvents="box-none">
          <View style={styles.userPillInRow} pointerEvents="box-none">
            <View style={styles.creatorPillRow} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.creatorPill}
              activeOpacity={0.88}
              onPress={() => handleUserProfilePress(item.user, item)}
            >
              <Image
                source={{
                  uri:
                    item.userPhotoURL ||
                    item.user?.avatar ||
                    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face',
                }}
                style={styles.creatorAvatar}
                resizeMethod="resize"
              />
              <View style={styles.creatorMeta}>
                <Text style={styles.creatorHandle} allowFontScaling={false} numberOfLines={1}>
                  @{item.userDisplayName || item.user?.displayName || item.user?.username || item.username || 'user'}
                </Text>
              </View>
            </TouchableOpacity>
              {(() => {
                const creatorId = String(item.userId || item.uid || item.user?.id || item.user?.uid || '').trim();
                const isOwn = !!uid && creatorId && creatorId === uid;
                const isF = !!creatorId && (!!following[creatorId] || followingRef.current?.has?.(creatorId));
                if (!creatorId || isOwn || isF) return null;
                return (
                  <TouchableOpacity
                    style={styles.followBadge}
                    onPress={() => handleFollow(creatorId)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Follow creator"
                  >
                    <LinearGradient colors={['#00D2BE', '#00A89E']} style={styles.followBadgeInner}>
                      <Icon name="add" size={12} color="#0A0A0C" />
                    </LinearGradient>
                  </TouchableOpacity>
                );
              })()}
            </View>
          </View>

          <FeedTopStatPills
            style={styles.topStatCluster}
            views={viewTotal}
            gifts={giftTotal}
          />
        </View>

        {hasMultipleMedia ? (
          <MediaCarousel
            media={mediaItems}
            style={StyleSheet.absoluteFill}
            feedIndex={index}
            isDiscoverItemActive={isDiscoverItemActive}
            isMuted={cellMuted}
          />
        ) : (
          (() => {
            const isVideo = item.type === 'video' || mediaItems[0]?.type === 'video' || (mediaItems[0]?.type && String(mediaItems[0]?.type).includes('video'));
            const isAudio = item.type === 'audio' || mediaItems[0]?.type === 'audio';
            // Progressive-first only — never prefer dead startUrl (resolvePlayableUri).
            const playback = resolvePlayableUri(item);
            const videoUri = playback.playUri || null;
            const fallbackUris = (playback.ladder || []).filter((u) => u && u !== videoUri);
            const shouldLoad = shouldLoadCell(index, currentDiscoverIndex, currentDiscoverIndex);
            const role = roleForIndex(index, currentDiscoverIndex);
            const flags = playbackFlags({
              index,
              activeIndex: currentDiscoverIndex,
              cellActive,
              feedMuted: feedAudioMuted || !feedAudioSessionReady,
              paused: pausedFeedId === item.id,
            });
            return isVideo ? (
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => onFeedVideoPress(item)}>
                <PremiumFeedVideo
                  uri={videoUri}
                  fallbackUris={fallbackUris}
                  poster={item.thumbnail || item.imageUrl || item.user?.avatar}
                  style={StyleSheet.absoluteFill}
                  shouldPlay={flags.shouldPlay}
                  shouldLoad={shouldLoad}
                  role={role}
                  seekToZero={false}
                  paused={pausedFeedId === item.id}
                  isLooping
                  isMuted={flags.isMuted}
                  audioOwnerId={null}
                  mediaDisplay={null}
                  onError={(e) => {
                    console.log('[FEED] Video error', { id: item.id, uri: videoUri, error: e });
                  }}
                />
              </TouchableOpacity>
            ) : isAudio ? (
              <AudioTile
                uri={fixStorageUrl(item.audioUrl || mediaItems[0]?.url)}
                user={item.user}
                title={item.title}
                autoPlay={cellActive && !feedAudioMuted}
                shouldLoad={shouldLoad}
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => onFeedVideoPress(item)}>
                <View style={{ position: 'relative', width: '100%', height: '100%' }}>
                  {(() => {
                    const imageUri = fixStorageUrl(item.imageUrl || mediaItems[0]?.url);
                    const hasValidImage = typeof imageUri === 'string' && imageUri.trim().length > 0;

                    if (!hasValidImage) {
                      return (
                        <View style={[styles.video, { backgroundColor: COLORS.pageBackground, alignItems: 'center', justifyContent: 'center' }]}>
                          <Text style={{ color: COLORS.textDisabled, fontSize: 14 }}>Image unavailable</Text>
                        </View>
                      );
                    }

                    return (
                      <Image
                        source={{ uri: imageUri }}
                        style={styles.video}
                        resizeMode="cover"
                        resizeMethod="resize"
                      />
                    );
                  })()}
                  <LinearGradient
                    pointerEvents="none"
                    colors={['transparent', 'rgba(10,10,12,0.45)', 'rgba(10,10,12,0.9)']}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
              </TouchableOpacity>
            );
          })()
        )}

        <FeedCommentOverlay
          postId={item.id}
          active={isActive}
          warm={commentsWarm}
          bottomInset={forYouOverlayInset}
          onCountChange={(postId, count) => {
            setCommentCounts((prev) => {
              if (prev?.[postId] === count) return prev;
              return { ...prev, [postId]: count };
            });
          }}
        />

        {/* Full description overlay — only after Show details */}
        {showFullDescription && (
          <View
            style={[
              styles.descriptionOverlayTop,
              { top: showDetailsTop, left: 12, right: 12 },
            ]}
          >
            <Text style={styles.postTitle} numberOfLines={1} allowFontScaling={false}>
              {item.title || item.captionTitle || 'Untitled'}
            </Text>
            {(item.caption || item.description) && (
              <Text style={styles.postDescription} numberOfLines={3} allowFontScaling={false}>
                {item.caption || item.description}
              </Text>
            )}
          </View>
        )}

        {/* Collapsed info chip — default state */}
        {isActive && !showFullDescription && (
          <TouchableOpacity
            style={[
              styles.descriptionInfoChipUnderPill,
              { top: showDetailsTop },
            ]}
            onPress={() => handleShowDescription(index)}
            activeOpacity={0.85}
          >
            <Text style={styles.descriptionInfoChipText} allowFontScaling={false}>Show details</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [
    isScreenFocused,
    selectedTab,
    currentDiscoverIndex,
    descriptionVisibleIndex,
    feedHeight,
    pausedFeedId,
    feedAudioMuted,
    feedAudioSessionReady,
    following,
    uid,
    forYouOverlayInset,
  ]);

  const renderForYouItem = useCallback(
    ({ item, index }) => renderRandomPostItem({ item, index }),
    [renderRandomPostItem],
  );

  const renderHeader = () => (
    <BlypHeaderFlow
      tabs={ribbonPages.map((p) => ({ key: p.key, label: p.label }))}
      matchHomePadding={true}
      activeKey={selectedTab}
      onTabChange={setSelectedTab}
      onMenuPress={() => setMenuVisible(true)}
      onLogoPress={() => setSelectedTab('home')}
      searchLabel="Search"
      onSearchPress={() => navigation.navigate('Search')}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h && h !== headerHeight) setHeaderHeight(h);
      }}
    />
  );

  const renderTopNavigation = () => (
    <View style={styles.topNav}>
      <TouchableOpacity style={styles.navButton}>
        <Text style={[styles.navText, styles.inactiveNavText]} allowFontScaling={false}>
          Following
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.navButton}>
        <Text style={[styles.navText, styles.activeNavText]} allowFontScaling={false}>
          #4ME
        </Text>
        <View style={styles.activeIndicator} />
      </TouchableOpacity>
    </View>
  );

  const renderVideoItem = ({ item, index }) => (
    <View style={styles.videoContainer}>
      <View style={styles.userPillTopLeft} pointerEvents="box-none">
        <LinearGradient colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.15)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.userInfoHighlight}>
          <TouchableOpacity style={styles.profileMenuBarSection} onPress={() => handleUserProfilePress(item.user, item)}>
            <Text style={styles.profileMenuBarUsername} allowFontScaling={false} numberOfLines={1}>
              @{item.userDisplayName || item.user?.displayName || item.user?.username || item.username || 'user'}
            </Text>
            <Image source={{ uri: item.userPhotoURL || item.user?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face' }} style={styles.profileMenuBarAvatar} resizeMethod="resize" />
          </TouchableOpacity>
        </LinearGradient>
      </View>
      {item.type === 'audio' ? (
        <AudioTile
          uri={fixStorageUrl(item.audioUrl || item.media?.[0]?.url)}
          user={item.user}
          title={item.title}
          autoPlay={isScreenFocused && selectedTab === 'B' && index === currentIndex}
          shouldLoad={Math.abs(currentIndex - index) <= 2}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : (
        <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={() => onFeedVideoPress(item)}>
          <EnhancedVideo
            uri={fixStorageUrl(item.videoUrl)}
            poster={item.thumbnail || item.user?.avatar}
            style={styles.video}
            shouldPlay={isScreenFocused && selectedTab === 'B' && index === currentIndex}
            shouldLoad={Math.abs(currentIndex - index) <= 2}
            isLooping={true}
            isMuted={!(isScreenFocused && selectedTab === 'B' && index === currentIndex)}
            resizeMode="contain"
          />
        </TouchableOpacity>
      )}

      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.8)']} style={styles.videoOverlay} />

      <FeedActionBar bottomOffset={forYouActionBottom}>
        <FeedActionButton
          onPress={() => handleLike(item.id)}
          active={!!liked[item.id]}
          count={displayLikeCount(item, likeCounts)}
        >
          <Icon name={liked[item.id] ? 'heart' : 'heart-outline'} size={24} color={COLORS.white} />
        </FeedActionButton>

        <FeedActionButton
          onPress={() => handleOpenComments(item)}
          count={getPostCommentCount(item)}
        >
          <Icon name="chatbubble" size={22} color={COLORS.white} />
        </FeedActionButton>

        <FeedActionButton
          onPress={() => handleSharePost(item)}
          count={item.shareCount ?? item.sharesCount ?? item.shares ?? 0}
        >
          <Icon name="share" size={22} color={COLORS.white} />
        </FeedActionButton>

        <FeedStatBadge count={getPostViewCount(item)}>
          <Icon name="eye-outline" size={22} color={COLORS.white} />
        </FeedStatBadge>

        <GiftSystem
          postId={item.id}
          creatorId={item.uid || item.userId}
          creatorName={typeof item.user === 'object' ? item.user.username : item.user || item.username}
          triggerVariant="feed"
          giftCoins={giftCoinCounts?.[item.id] ?? getPostGiftCoins(item)}
          onGiftSent={({ postId, coinSpent }) => {
            const id = String(postId || item.id);
            const spent = Math.max(0, Math.floor(Number(coinSpent) || 0));
            if (!id || spent <= 0) return;
            setGiftCoinCounts((prev) => ({
              ...prev,
              [id]: Math.max(0, Number(prev[id] || getPostGiftCoins(item) || 0)) + spent,
            }));
          }}
        />
      </FeedActionBar>

      <View style={styles.bottomContent}>
        <View style={styles.descriptionContainerBottom}>
          <Text style={styles.description} allowFontScaling={false}>{item.description || item.transcript}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.postInfoContainer} activeOpacity={0.7} onPress={() => setIsTitleBarMinimized(!isTitleBarMinimized)}>
        <View style={styles.minimizeButton}>
          <Icon name={isTitleBarMinimized ? 'chevron-up' : 'chevron-down'} size={20} color="#fff" />
        </View>
        {!isTitleBarMinimized && (
          <>
            <Text style={styles.postName}>{item.title || ''}</Text>
            <Text style={styles.postDescription}>{item.description || ''}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderTabContent = () => {
    if (isTopicPageKey(selectedTab)) {
      const page = enabledPages.find((p) => p.key === selectedTab);
      const topicId = topicIdFromKey(selectedTab);
      // Football and F1 get bespoke, individually-themed pages.
      if (topicId === 'football' || topicId === 'f1') {
        return (
          <SportPagePanel
            navigation={navigation}
            uid={uid}
            sportId={topicId}
            label={page?.label}
          />
        );
      }
      return (
        <TopicFeedPanel
          navigation={navigation}
          uid={uid}
          topicId={topicId}
          label={page?.label || 'Topic'}
        />
      );
    }
    switch (selectedTab) {
      case 'home':
        return (
          <ScreenErrorBoundary label="HomeBase" onReset={() => setSelectedTab('home')}>
            {homeEdition === 'classic' ? (
              <HomeBasePanel
                navigation={navigation}
                uid={uid}
                interests={prefs?.interests || []}
                pages={enabledPages}
                edition={homeEdition}
                onEditionChange={setHomeEdition}
                onOpenPage={(key) => setSelectedTab(key)}
                onOpenForYouPost={openForYouAtPost}
                onEditPages={() => navigation.navigate('PagesEditor')}
              />
            ) : (
              <HomeNextPanel
                navigation={navigation}
                uid={uid}
                interests={prefs?.interests || []}
                edition={homeEdition}
                onEditionChange={setHomeEdition}
                onOpenPage={(key) => setSelectedTab(key)}
                onOpenForYouPost={openForYouAtPost}
              />
            )}
          </ScreenErrorBoundary>
        );
      case 'following':
        return <FollowingFeedPanel navigation={navigation} uid={uid} />;
      case 'A':
        // Spinner while measuring layout OR while the initial fetch/rank is in
        // flight with no posts yet. Never leave a dead frozen frame.
        if (!feedHeight || (loading && randomPosts.length === 0)) {
          return <FeedEmptyState mode="loading" />;
        }
        if (isEmptyFeed || randomPosts.length === 0) {
          return <FeedEmptyState mode="empty" />;
        }
        return (
          <View style={{ height: feedHeight, position: 'relative' }}>
            <FlatList
              ref={flatListRef}
              data={randomPosts}
              renderItem={renderForYouItem}
              keyExtractor={(item) => String(item.id)}
              showsVerticalScrollIndicator={false}
              refreshing={loading}
              onRefresh={loadRandomPosts}
              scrollEventThrottle={32}
              pagingEnabled
              snapToInterval={feedHeight}
              snapToAlignment="start"
              decelerationRate="fast"
              removeClippedSubviews={false}
              maxToRenderPerBatch={3}
              windowSize={5}
              initialNumToRender={3}
              updateCellsBatchingPeriod={40}
              extraData={`${currentDiscoverIndex}:${feedAudioMuted ? 1 : 0}:${feedAudioSessionReady ? 1 : 0}:${pausedFeedId || ''}`}
              getItemLayout={(data, index) => ({
                length: feedHeight,
                offset: feedHeight * index,
                index,
              })}
              onScroll={handleDiscoverScroll}
              onMomentumScrollEnd={handleDiscoverScrollEnd}
              onScrollEndDrag={handleDiscoverScrollEnd}
              onEndReached={loadMoreForYou}
              onEndReachedThreshold={2}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={{
                itemVisiblePercentThreshold: 60,
                // A countable view requires ~1s of dwell, so a fast scroll-past
                // doesn't inflate counts.
                minimumViewTime: 1000,
              }}
            />
            {activeForYouPost ? (
              <>
                <LiveReactionsHearts
                  burstKey={
                    heartsBurst?.postId === activeForYouPost.id ? heartsBurst.key : null
                  }
                  bottomOffset={forYouOverlayInset}
                  rightOffset={24}
                  heartSize={66}
                />
              <FeedActionBar bottomOffset={forYouActionBottom}>
                <FeedActionButton
                  onPress={() => handleLike(activeForYouPost.id)}
                  active={!!liked[activeForYouPost.id]}
                  count={
                    likeCounts?.[activeForYouPost.id] ??
                    activeForYouPost.likeCount ??
                    activeForYouPost.likes ??
                    activeForYouPost.likedBy?.length ??
                    0
                  }
                >
                  <Icon
                    name={liked[activeForYouPost.id] ? 'heart' : 'heart-outline'}
                    size={24}
                    color={COLORS.white}
                  />
                </FeedActionButton>

                <FeedActionButton
                  onPress={() => handleOpenComments(activeForYouPost)}
                  count={getPostCommentCount(activeForYouPost)}
                >
                  <Icon name="chatbubble" size={22} color={COLORS.white} />
                </FeedActionButton>

                <FeedActionButton
                  onPress={() => setFeedAudioMuted((m) => !m)}
                  accessibilityLabel={feedAudioMuted ? 'Unmute For You audio' : 'Mute For You audio'}
                >
                  <Icon
                    name={feedAudioMuted ? 'volume-mute' : 'volume-high'}
                    size={22}
                    color={COLORS.white}
                  />
                </FeedActionButton>

                <FeedActionButton
                  onPress={() => handleSharePost(activeForYouPost)}
                  count={
                    activeForYouPost.shareCount ??
                    activeForYouPost.sharesCount ??
                    activeForYouPost.shares ??
                    0
                  }
                >
                  <Icon name="share" size={22} color={COLORS.white} />
                </FeedActionButton>

                <GiftSystem
                  key={`fy-gift-${activeForYouPost.id}`}
                  postId={activeForYouPost.id}
                  creatorId={activeForYouPost.uid || activeForYouPost.userId}
                  creatorName={
                    typeof activeForYouPost.user === 'object'
                      ? activeForYouPost.user.username
                      : activeForYouPost.user || activeForYouPost.username
                  }
                  triggerVariant="feed"
                  giftCoins={
                    giftCoinCounts?.[activeForYouPost.id] ?? getPostGiftCoins(activeForYouPost)
                  }
                  onGiftSent={({ postId, coinSpent }) => {
                    const id = String(postId || activeForYouPost.id);
                    const spent = Math.max(0, Math.floor(Number(coinSpent) || 0));
                    if (!id || spent <= 0) return;
                    setGiftCoinCounts((prev) => ({
                      ...prev,
                      [id]:
                        Math.max(
                          0,
                          Number(prev[id] || getPostGiftCoins(activeForYouPost) || 0),
                        ) + spent,
                    }));
                  }}
                />

                <TouchableOpacity
                  style={styles.expandBtn}
                  activeOpacity={0.85}
                  onPress={() => handlePostPress(activeForYouPost)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Open post"
                >
                  <View style={styles.expandStack}>
                    <View style={styles.expandRing}>
                      <Icon name="open-outline" size={20} color={COLORS.white} />
                    </View>
                    <Text style={styles.expandSpacer} allowFontScaling={false}>
                      {' '}
                    </Text>
                  </View>
                </TouchableOpacity>
              </FeedActionBar>
              </>
            ) : null}
          </View>
        );
      case 'B':
        return (
          <WhatsAppPopularTab
            posts={randomPosts}
            videos={randomPosts.filter((post) => post.type === 'video')}
            onPopularPostSelect={(category, popularPosts) => {
              console.log("What's Hot popular category selected:", category.name, 'Posts:', popularPosts.length);
            }}
            navigation={navigation}
          />
        );
      case 'C':
        return (
          <CategoriesTab
            posts={randomPosts}
            onCategorySelect={(category, filtered) => {
              console.log('ðŸ“‚ Category selected:', category.name, 'Posts:', filtered.length);
              setSelectedCategory(category);
              setFilteredPosts(filtered);
            }}
            navigation={navigation}
          />
        );
      case 'D':
        return (
          <HashtagsTab
            posts={randomPosts}
            userInteractions={[]}
            onHashtagSelect={(hashtags, filtered) => {
              console.log('ðŸ·ï¸ Hashtags selected:', hashtags, 'Posts:', filtered.length);
              setSelectedHashtags(hashtags);
              setFilteredPosts(filtered);
            }}
            navigation={navigation}
          />
        );
      default:
        return null;
    }
  };

  // Other tabs still use flex fill; feedHeight applies only to #4ME list items.
  const useSectionGradient = selectedTab === 'B' || selectedTab === 'C' || selectedTab === 'D';

  return (
    <ScreenContainer noSafeArea statusBarColor="#0A0A0C">
      <View testID="HOME_FEED" accessible={false} accessibilityLabel="HOME_FEED" style={styles.container}>
        {renderHeader()}
        <View
          style={styles.fullscreenContent}
          {...tabSwipeResponder.panHandlers}
          onLayout={(e) => {
            const { height } = e.nativeEvent.layout;
            if (height > 0 && height !== feedHeight) {
              setFeedHeight(height);
            }
          }}
        >
          {useSectionGradient && (
            <LinearGradient
              pointerEvents="none"
              colors={[COLORS.pageBackground, COLORS.pageBackground, COLORS.pageBackground]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sectionGradientBackground}
            />
          )}
          {renderTabContent()}
        </View>

        <CommentsModal
          visible={commentsVisible}
          onClose={handleCloseComments}
          postId={selectedPost?.id}
          postData={selectedPost}
          onCommentCountChange={(id, count) => {
            if (!id) return;
            const n = Number(count);
            if (!Number.isFinite(n)) return;
            setCommentCounts((prev) => ({ ...prev, [id]: Math.max(0, Math.trunc(n)) }));
          }}
        />

        <Modal visible={menuVisible} transparent={true} animationType="fade" onRequestClose={() => setMenuVisible(false)}>
          <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
            <View style={styles.menuContainer}>
              <TouchableOpacity style={styles.menuCloseButton} onPress={() => setMenuVisible(false)}>
                <Icon name="close" size={24} color="#d1d5db" />
              </TouchableOpacity>
              <Text style={styles.menuTitle}>Menu</Text>

              <TouchableOpacity
                style={styles.menuActionButton}
                onPress={() => {
                  setMenuVisible(false);
                  setSelectedTab('home');
                }}
              >
                <Text style={styles.menuButtonText}>Home</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuActionButton}
                onPress={() => {
                  setMenuVisible(false);
                  navigation.navigate('Dating');
                }}
              >
                <Text style={styles.menuButtonText}>Dating</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuActionButton}
                onPress={() => {
                  setMenuVisible(false);
                  navigation.navigate('HowBlypWorks', { mode: 'review' });
                }}
              >
                <Text style={styles.menuButtonText}>Help</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuLogoutButton}
                onPress={() => {
                  setMenuVisible(false);
                  hardLogout();
                }}
              >
                <Text style={styles.menuLogoutText}>Log out</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTop: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 },
  menuButton: { padding: 8, position: 'absolute', left: 16 },
  headerBalances: { position: 'absolute', left: 56, height: '100%', justifyContent: 'center' },
  logoContainer: { justifyContent: 'center', alignItems: 'center', flex: 1 },
  searchButton: { padding: 8, position: 'absolute', right: 16 },
  tabContainer: { paddingHorizontal: 16, paddingBottom: 12 },
  tabSelector: { position: 'relative', backgroundColor: COLORS.tabStripBackground, borderRadius: 9999, padding: 4, flexDirection: 'row' },
  tab: { flex: 1, paddingVertical: 6, alignItems: 'center', zIndex: 2 },
  tabText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600', includeFontPadding: false },
  activeTabText: { color: COLORS.textPrimary },
  tabIndicator: { position: 'absolute', top: 2, bottom: 2, width: '25%', borderRadius: 9999, zIndex: 1 },
  tabIndicatorGradient: { flex: 1, borderRadius: 9999 },
  fullscreenContent: { flex: 1, backgroundColor: COLORS.pageBackground, position: 'relative' },
  sectionGradientBackground: { ...StyleSheet.absoluteFillObject },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: COLORS.textMuted, fontSize: responsiveFont(15) },
  topNav: { position: 'absolute', top: 50, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', zIndex: 1000, paddingHorizontal: 20 },
  navButton: { paddingHorizontal: 20, paddingVertical: 10, position: 'relative' },
  navText: { fontSize: 18, fontWeight: '700' },
  activeNavText: { color: 'white' },
  inactiveNavText: { color: 'rgba(255, 255, 255, 0.6)' },
  activeIndicator: { position: 'absolute', bottom: 5, left: 20, right: 20, height: 2, backgroundColor: 'white' },
  videoContainer: { width: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.pageBackground, overflow: 'hidden' },
  video: { width: '100%', height: '100%', backgroundColor: COLORS.pageBackground },
  videoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bottomContent: { position: 'absolute', top: 24, left: 20, right: 80 }, // retained for other tabs (#B) but not used in #4ME now
  description: { color: 'white', fontSize: 15, lineHeight: 20, marginBottom: 8, fontWeight: '800' },
  descriptionContainerBottom: { position: 'absolute', top: 164, left: 15, right: 200, paddingHorizontal: 10 },
  profileMenuBar: { position: 'absolute', bottom: 80, left: 10, right: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', zIndex: 1000, gap: 15 },
  expandBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
  },
  expandStack: {
    alignItems: 'center',
  },
  expandRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(10,10,12,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandSpacer: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    opacity: 0,
  },
  topMetaRow: {
    position: 'absolute',
    top: 12,
    left: 12,
    // Sit against the video frame right edge (action rail is mid-height).
    right: 12,
    zIndex: 1200,
    elevation: 1200,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userPillInRow: {
    flexShrink: 1,
    maxWidth: '58%',
  },
  topStatCluster: {
    marginLeft: 8,
  },
  creatorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,12,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.28)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  creatorPillActive: {
    borderColor: 'rgba(0,210,190,0.55)',
    borderTopColor: 'rgba(255,255,255,0.2)',
    shadowOpacity: 0.28,
    elevation: 4,
  },
  creatorPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
  },
  followBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 5,
    elevation: 3,
  },
  followBadgeInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  creatorMeta: { flexShrink: 1, maxWidth: 180 },
  creatorHandle: { color: COLORS.white, fontWeight: '800', fontSize: 14 },
  creatorCaption: { color: 'rgba(255,255,255,0.72)', fontSize: 11, fontWeight: '500', marginTop: 1 },
  userInfoHighlight: { borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 6 },
  userPillTopLeft: { position: 'absolute', top: 12, left: 12, zIndex: 1200, elevation: 1200, maxWidth: '72%' },
  profileMenuBarSection: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  profileMenuBarUsername: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  profileMenuBarAvatar: { width: 30, height: 30, borderRadius: 15 },

  commentPreviewBand: {
    position: 'absolute',
    right: 12,
    zIndex: 1100,
    elevation: 1100,
  },
  commentPreviewBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  commentPreviewText: {
    flexShrink: 1,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '600',
    includeFontPadding: false,
  },
  postInfoContainer: { position: 'absolute', top: 0, left: 20, right: 20, padding: 12, backgroundColor: 'rgba(30,30,40,0.3)', borderRadius: 14 },
  descriptionOverlayTop: { position: 'absolute', left: 16, right: 16, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, backgroundColor: 'rgba(10,10,12,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  descriptionInfoChip: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(10,10,12,0.9)' },
  descriptionInfoChipUnderPill: {
    position: 'absolute',
    left: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,12,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.28)',
    zIndex: 1200,
    elevation: 1200,
  },
  descriptionInfoChipText: { color: COLORS.electric, fontSize: 12, fontWeight: '600' },
  postTitle: { fontWeight: '700', fontSize: 16, color: COLORS.textPrimary, marginBottom: 6 },
  postName: { fontWeight: 'bold', fontSize: 18, color: COLORS.textPrimary, marginBottom: 6, textAlign: 'center' },
  postDescription: { fontSize: 15, color: COLORS.textSecondary, textAlign: 'center' },
  minimizeButton: { position: 'absolute', top: -8, right: -8, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 15, width: 30, height: 30, justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  carouselContainer: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  carouselItemContainer: { width: Dimensions.get('window').width, height: '100%' },
  carouselMedia: { width: Dimensions.get('window').width, height: '100%', borderRadius: 0 },
  imageEnhancementOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255, 255, 255, 0.03)', pointerEvents: 'none' },
  mediaCounter: { position: 'absolute', top: 15, right: 15, backgroundColor: 'rgba(0, 0, 0, 0.7)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 15 },
  mediaCounterText: { color: COLORS.white, fontSize: 12, fontWeight: '600' },
  paginationDots: { position: 'absolute', bottom: 20, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  paginationDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255, 255, 255, 0.5)', marginHorizontal: 4 },
  paginationDotActive: { backgroundColor: COLORS.primary, width: 10, height: 10, borderRadius: 5 },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-start', alignItems: 'flex-start' },
  menuContainer: { width: 250, backgroundColor: COLORS.backgroundLight, borderRadius: 14, padding: 16, margin: 16, marginTop: 8, shadowColor: COLORS.black, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5 },
  menuCloseButton: { alignSelf: 'flex-end', padding: 8 },
  menuTitle: { fontSize: responsiveFont(18), fontWeight: 'bold', color: COLORS.textPrimary, marginBottom: 16, textAlign: 'center' },
  balanceItems: { marginVertical: 8 },
  menuBalanceItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.1)', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginVertical: 6 },
  balanceIcon: { fontSize: responsiveFont(20), marginRight: 8 },
  balanceLabel: { flex: 1, fontSize: responsiveFont(14), color: COLORS.textSecondary },
  balanceValue: { fontSize: responsiveFont(16), fontWeight: 'bold', color: COLORS.textPrimary },
  menuActionButton: { backgroundColor: '#00D2BE', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, marginTop: 8, alignItems: 'center' },
  menuSecondaryButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#00D2BE', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, marginTop: 10, alignItems: 'center' },
  menuSecondaryButtonText: { color: '#00D2BE', fontWeight: '700', fontSize: 14 },
  menuButtonText: { color: '#0A0A0C', fontSize: responsiveFont(14), fontWeight: 'bold' },
  menuLogoutButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#FF5A5F', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, marginTop: 10, alignItems: 'center' },
  menuLogoutText: { color: '#FF5A5F', fontWeight: '700', fontSize: responsiveFont(14) },
});

export default HomeScreen;


