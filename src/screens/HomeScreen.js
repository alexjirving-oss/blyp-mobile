// HomeScreen.js
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { Alert, Animated, Dimensions, FlatList, Image, Modal, PanResponder, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { sharePost as shareServiceSharePost } from '../services/shareService';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { db, auth, firebaseEnabled } from '../config/firebase';
import EnhancedVideo from '../components/EnhancedVideo';
import { trackActivity, ACTIVITY_TYPES } from '../utils/activityTracker';
import BlypLogo from '../components/BlypLogo';
import { addTestPostsWithMultiplePhotos } from '../utils/testDataHelper';
import CategoriesTab from '../components/CategoriesTab';
import HashtagsTab from '../components/HashtagsTab';
import WhatsAppPopularTab from '../components/WhatsAppPopularTab';
import LiveReactionsHearts from '../components/live/LiveReactionsHearts';
import GiftSystem from '../components/GiftSystem';
import CommentsModal from '../components/CommentsModal';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';
import { fixStorageUrl } from '../utils/urlUtils';
import AudioTile from '../components/AudioTile';
import { getPlayableVideoUri } from '../utils/videoCache';
import { COLORS } from '../styles/theme';
import HeaderMenuTabs from '../components/HeaderMenuTabs';
import HeaderWalletBalances from '../components/HeaderWalletBalances';
import HeaderContainer, { HEADER_ICON_COLOR } from '../components/HeaderContainer';
import BlypHeaderFlow from '../components/BlypHeaderFlow';
import FeedEmptyState from '../components/Feed/FeedEmptyState';
import HomeBasePanel from '../components/HomeBase/HomeBasePanel';
import TopicFeedPanel from '../components/HomeBase/TopicFeedPanel';
import SportPagePanel from '../components/HomeBase/SportPagePanel';
import FollowingFeedPanel from '../components/HomeBase/FollowingFeedPanel';
import { subscribePreferences, getEnabledPages, isTopicPageKey, topicIdFromKey, INTEREST_CATALOG } from '../services/userPreferencesService';
import { subscribeToFollowingList } from '../utils/followUtils';
import { useTabReset } from '../utils/tabResetBus';
import { requireAccount } from '../services/guestSessionService';
import { rankPosts } from '../services/feedRankingService';
import { filterBlocked, loadBlockedUsers } from '../services/BlockService';
import { isForYouFeedPost, isVideoWithSoundPost } from '../utils/forYouFeedFilter';
import { setPostLiked } from '../services/LikeService';
import { recordPostView, getPostViewCount } from '../services/PostViewService';
import {
  setReachSession,
  reportImpression,
  reportEngagement,
  flushReachEvents,
} from '../services/blypReachClient';
import { BLYP_LOGO_GRADIENT_COLORS } from '../components/BlypLogo';
import { useAuth, hardLogout } from '../hooks/useCommon';
import { getEconomyWallet } from '../api/economyLiveApi';
import { ensureFirebaseAuthReady } from '../utils/firebaseAuthHelper';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const DEFAULT_HEADER_HEIGHT = responsiveSize(120);
const footerHeight = responsiveSize(88);

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
const MediaCarousel = ({ media, style, feedIndex, isDiscoverItemActive }) => {
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

    const mediaUri = fixStorageUrl(item.url || item.uri || item.videoUrl || item.imageUrl);

    if (isVideo) {
      return (
        <View style={[styles.carouselItemContainer, { width: winWidth }]}>
          <EnhancedVideo
            uri={mediaUri}
            poster={item.thumbnail}
            style={[styles.carouselMedia, { width: winWidth }, style]}
            shouldPlay={isDiscoverItemActive ? isDiscoverItemActive(feedIndex) && index === currentIndex : index === currentIndex}
            shouldLoad={Math.abs(currentIndex - index) <= 1}
            isLooping={true}
            isMuted={true}
            resizeMode="contain"
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

const formatCount = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.max(0, Math.trunc(n)));
};

// NOTE: Per-post comment counts are now driven by real Firestore comments.

import { shouldUseLiveServiceWallet } from '../utils/walletSource';

// How many posts we pull per page of the For You feed. The first page is a live
// listener (so new posts / like counts update in realtime); subsequent pages are
// fetched on demand as the viewer scrolls, making the feed effectively endless.
const FEED_PAGE_SIZE = 30;

const isValidFeedPost = (p) => isForYouFeedPost(p);

const isPlayableVideoPost = (p) => isVideoWithSoundPost(p);

const HomeScreen = ({ navigation, route }) => {
  const [videos, setVideos] = useState([]);
  const [isEmptyFeed, setIsEmptyFeed] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [liked, setLiked] = useState({});
  const [likeCounts, setLikeCounts] = useState({});
  // postId -> intrinsic aspect ratio (width / height) reported by the player,
  // used to top-anchor "contain" videos under the header in the For You feed.
  const [videoAspect, setVideoAspect] = useState({});
  const [commentCounts, setCommentCounts] = useState({});
  const [following, setFollowing] = useState({});
  const [selectedTab, setSelectedTab] = useState('home');
  const selectedTabRef = useRef('home');
  const uidRef = useRef(null);
  const [prefs, setPrefs] = useState(null);
  const [randomPosts, setRandomPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentDiscoverIndex, setCurrentDiscoverIndex] = useState(0);
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const [isTitleBarMinimized, setIsTitleBarMinimized] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedHashtags, setSelectedHashtags] = useState([]);
  const [filteredPosts, setFilteredPosts] = useState([]);
  const [heartsBurst, setHeartsBurst] = useState({ postId: null, key: 0 });
  const [coinBalance, setCoinBalance] = useState(0);
  const [gemBalance, setGemBalance] = useState(0);
  const [menuVisible, setMenuVisible] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  // Header height state (measured). Use a default until first layout pass.
  const [headerHeight, setHeaderHeight] = useState(0);
  const [descriptionVisibleIndex, setDescriptionVisibleIndex] = useState(0); // active index showing full description
  const descriptionHideTimeout = useRef(null);
  const [userPillLayout, setUserPillLayout] = useState({ width: 0, height: 0 });
  const [feedHeight, setFeedHeight] = useState(0);
  // feedHeight will be measured from the available content area (between header and bottom tabs)
  const [prefetchedUris, setPrefetchedUris] = useState({});

  const flatListRef = useRef(null);
  const prefetchingRef = useRef({});
  const likePendingRef = useRef(new Set());
  const commentScrollValue = useRef(new Animated.Value(0)).current;
  const currentDiscoverIndexRef = useRef(0);
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
  const [loadingMore, setLoadingMore] = useState(false);

  const { uid, authReady, isAuthenticated } = useAuth();

  const enabledPages = useMemo(() => getEnabledPages(prefs), [prefs]);

  // Personalization signals for the For You ranking, kept in refs so the live
  // Firestore feed listener can read the latest values without re-subscribing.
  const interestTermsRef = useRef([]);
  const followingRef = useRef(new Set());

  useEffect(() => {
    const byId = new Map(INTEREST_CATALOG.map((i) => [i.id, i.label]));
    interestTermsRef.current = (prefs?.interests || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .flatMap((label) => String(label).toLowerCase().split(/\s+/));
  }, [prefs]);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribeToFollowingList(uid, (set) => {
      followingRef.current = set || new Set();
    });
    return unsub;
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribePreferences(uid, setPrefs);
    return unsub;
  }, [uid]);

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

  // Keep the active tab valid if pages get reordered/hidden in the editor.
  useEffect(() => {
    const keys = enabledPages.map((p) => p.key);
    if (!keys.includes(selectedTab)) {
      setSelectedTab(keys[0] || 'A');
    }
  }, [enabledPages, selectedTab]);

  // Double-tap the Home tab → jump back to the first sub-page ("For You") and
  // scroll to the top.
  useTabReset('Home', () => {
    setSelectedTab(enabledPages?.[0]?.key || 'home');
    setCurrentIndex(0);
    setCurrentDiscoverIndex(0);
    try { flatListRef.current?.scrollToOffset?.({ offset: 0, animated: true }); } catch { }
  });

  // --- Horizontal swipe between header tabs --------------------------------
  // Gesture-handler is shimmed to a no-op for stability, so we use the built-in
  // PanResponder. Its responder negotiation is exactly what we want: a child
  // horizontal carousel (the Home rails) claims the touch first and keeps
  // scrolling, while a decisive horizontal swipe over empty/vertical areas
  // flips to the adjacent header tab. Vertical feed scrolling is never claimed.
  const enabledPagesRef = useRef(enabledPages);
  useEffect(() => { enabledPagesRef.current = enabledPages; }, [enabledPages]);

  const goToAdjacentTab = useCallback((dir) => {
    const keys = (enabledPagesRef.current || []).map((p) => p.key);
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
  }, [selectedTab]);

  // After publishing a post, ReviewScreen routes here with `focusFeed` so the
  // user lands on the For You feed (key 'A') instead of the HomeBase hub — they
  // were previously dropped on the hub with no way to see what they just posted
  // (P7.7). Clear the param so a later tab switch doesn't get yanked back.
  useEffect(() => {
    if (route?.params?.focusFeed) {
      setSelectedTab('A');
      try {
        navigation?.setParams?.({ focusFeed: undefined });
      } catch { /* no-op */ }
    }
  }, [route?.params?.focusFeed]);

  useEffect(() => {
    uidRef.current = uid || null;
  }, [uid]);

  useEffect(() => {
    currentDiscoverIndexRef.current = currentDiscoverIndex;
  }, [currentDiscoverIndex]);

  const showDescriptionForIndex = useCallback((index) => {
    setDescriptionVisibleIndex(index);
    if (descriptionHideTimeout.current) {
      clearTimeout(descriptionHideTimeout.current);
    }
    descriptionHideTimeout.current = setTimeout(() => {
      setDescriptionVisibleIndex(null);
    }, 2000);
  }, []);

  const handleShowDescription = (index) => {
    showDescriptionForIndex(index);
  };

  // Ensure the active #4ME post shows details immediately when the tab/screen becomes active.
  useEffect(() => {
    if (selectedTab !== 'A' || !isScreenFocused) return;
    if (randomPosts.length === 0) return;
    showDescriptionForIndex(currentDiscoverIndex);

    return () => {
      if (descriptionHideTimeout.current) {
        clearTimeout(descriptionHideTimeout.current);
        descriptionHideTimeout.current = null;
      }
    };
  }, [selectedTab, isScreenFocused, randomPosts.length, currentDiscoverIndex, showDescriptionForIndex]);

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
    navigation.navigate('MediaViewer', { post });
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
    if (!authReady || !isAuthenticated || !uid) {
      setCoinBalance(0);
      setGemBalance(0);
      return;
    }

    if (shouldUseLiveServiceWallet()) {
      let cancelled = false;

      const refresh = async () => {
        try {
          const wallet = await getEconomyWallet();
          const nextCoins = Number(wallet?.coinBalance || 0) + Number(wallet?.bonusCoinBalance || 0);
          const nextGems = Number(wallet?.gemAvailable || 0) + Number(wallet?.gemPending || 0);
          if (cancelled) return;
          if (Number.isFinite(nextCoins)) setCoinBalance(nextCoins);
          if (Number.isFinite(nextGems)) setGemBalance(nextGems);
        } catch {
          // ignore; keep last-known values
        }
      };

      refresh();
      const t = setInterval(refresh, 5000);
      return () => {
        cancelled = true;
        clearInterval(t);
      };
    }

    let isMounted = true;
    const unsubCoins = BlypCoinService.subscribeToBalance(uid, (balance) => {
      if (isMounted) setCoinBalance(balance);
    });
    const unsubGems = GemService.subscribeToGems(uid, (balance) => {
      if (isMounted) setGemBalance(balance);
    });

    return () => {
      isMounted = false;
      try { unsubCoins?.(); } catch { }
      try { unsubGems?.(); } catch { }
    };
  }, [uid, authReady, isAuthenticated]);

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
    if (!authReady || !isAuthenticated || !uid) {
      setRandomPosts([]);
      setIsEmptyFeed(false);
      setLoading(false);
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
                if (isInitialLoad) {
                  // Personalized "For You" order: follows + interests + light
                  // popularity, with a freshness jitter (falls back to shuffle).
                  const ranked = rankPosts(validPosts, interestTermsRef.current, followingRef.current);
                  setRandomPosts(ranked);
                  // Reset the Videos-tab cursor on first load (previously done by
                  // the now-merged video listener).
                  setCurrentIndex(0);
                } else {
                  setRandomPosts((prev) => {
                    if (!Array.isArray(prev) || prev.length === 0) return validPosts;

                    const byId = new Map(validPosts.map((p) => [p.id, p]));
                    const next = [];

                    // Preserve the existing visual order, refreshing doc data for
                    // posts in the live page and keeping older paginated posts
                    // (not in this snapshot) so the feed doesn't snap back to 30.
                    prev.forEach((existing) => {
                      const updated = byId.get(existing.id);
                      if (updated) {
                        next.push(updated);
                        byId.delete(existing.id);
                      } else {
                        next.push(existing);
                      }
                    });

                    // Append any brand new posts (in snapshot order).
                    validPosts.forEach((p) => {
                      if (byId.has(p.id)) next.push(p);
                    });

                    return next;
                  });
                }
                setIsEmptyFeed(false);
                setLoading(false);
                isInitialLoad = false;
              }
              if (uid) {
                // Don't overwrite a post whose like is mid-flight: a snapshot
                // can arrive with pre-write data and make the heart/count snap
                // back, which is the "inconsistent likes" the user saw.
                setLiked((prev) => {
                  const next = { ...prev };
                  validPosts.forEach((post) => {
                    if (likePendingRef.current.has(post.id)) return;
                    next[post.id] = post.likedBy?.includes(uid) || false;
                  });
                  return next;
                });
                setLikeCounts((prev) => {
                  const next = { ...prev };
                  validPosts.forEach((post) => {
                    if (likePendingRef.current.has(post.id)) return;
                    next[post.id] = Number(
                      post.likeCount ?? post.likes ?? post.likedBy?.length ?? 0
                    );
                  });
                  return next;
                });
              }
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
  }, [firebaseEnabled, uid, authReady, isAuthenticated]);

  // Pull-to-refresh: actually re-fetch the freshest page from Firestore (not just
  // a local reshuffle), re-rank it, and reset the pagination cursor so "load more"
  // continues correctly from the new top.
  const loadRandomPosts = useCallback(async () => {
    if (!firebaseEnabled || !db || typeof db.collection !== 'function') {
      // Fall back to a local reshuffle if Firestore isn't available.
      setRandomPosts((prev) => [...prev].sort(() => 0.5 - Math.random()));
      return;
    }
    setLoading(true);
    try {
      await loadBlockedUsers().catch(() => {});
      const snap = await db
        .collection('posts')
        .orderBy('date', 'desc')
        .limit(FEED_PAGE_SIZE)
        .get();
      const docs = snap?.docs || [];
      forYouCursorRef.current = docs.length ? docs[docs.length - 1] : null;
      forYouHasMoreRef.current = docs.length >= FEED_PAGE_SIZE;
      // Reset phase 2 (all-posts) paginator on refresh.
      forYouPhaseRef.current = 'date';
      forYouAllCursorRef.current = null;
      forYouAllHasMoreRef.current = true;
      forYouShownIdsRef.current = new Set(docs.map((d) => d.id));

      const fresh = filterBlocked(
        docs.map((d) => ({ id: d.id, ...d.data() })),
        (p) => p.userId || p.uid
      ).filter(isValidFeedPost);

      if (fresh.length === 0) {
        setRandomPosts([]);
        setIsEmptyFeed(true);
      } else {
        const ranked = rankPosts(fresh, interestTermsRef.current, followingRef.current);
        setRandomPosts(ranked);
        setIsEmptyFeed(false);
      }
    } catch (e) {
      console.warn('[HOME] pull-to-refresh failed', e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the next (older) page of the For You feed and append it. Called as the
  // viewer nears the end of the list, which makes the feed effectively endless.
  const appendFeedPosts = useCallback((newPosts) => {
    if (!newPosts.length) return;
    newPosts.forEach((p) => forYouShownIdsRef.current.add(p.id));
    const ranked = rankPosts(newPosts, interestTermsRef.current, followingRef.current);
    setRandomPosts((prev) => {
      const have = new Set((Array.isArray(prev) ? prev : []).map((p) => p.id));
      const toAdd = ranked.filter((p) => !have.has(p.id));
      return toAdd.length ? [...prev, ...toAdd] : prev;
    });
    setVideos((prev) => {
      const have = new Set((Array.isArray(prev) ? prev : []).map((p) => p.id));
      const vids = newPosts.filter(isPlayableVideoPost).filter((p) => !have.has(p.id));
      return vids.length ? [...prev, ...vids] : prev;
    });
    if (uid) {
      setLiked((prev) => {
        const next = { ...prev };
        newPosts.forEach((post) => {
          if (likePendingRef.current.has(post.id)) return;
          next[post.id] = post.likedBy?.includes(uid) || false;
        });
        return next;
      });
      setLikeCounts((prev) => {
        const next = { ...prev };
        newPosts.forEach((post) => {
          if (likePendingRef.current.has(post.id)) return;
          next[post.id] = Number(
            post.likeCount ?? post.likes ?? post.likedBy?.length ?? 0
          );
        });
        return next;
      });
    }
  }, [uid]);

  const loadMoreForYou = useCallback(async () => {
    if (loadingMoreRef.current) return;
    if (!firebaseEnabled || !db || typeof db.collection !== 'function') return;

    // Phase 1 (date): newest-first posts that have a `date`. When exhausted we
    // flip to phase 2 instead of stopping.
    if (forYouPhaseRef.current === 'date' && !forYouHasMoreRef.current) {
      forYouPhaseRef.current = 'all';
    }
    if (forYouPhaseRef.current === 'all' && !forYouAllHasMoreRef.current) return; // truly done

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      if (forYouPhaseRef.current === 'date') {
        const cursor = forYouCursorRef.current;
        if (!cursor) { forYouPhaseRef.current = 'all'; }
        else {
          const snap = await db
            .collection('posts')
            .orderBy('date', 'desc')
            .startAfter(cursor)
            .limit(FEED_PAGE_SIZE)
            .get();
          const docs = snap?.docs || [];
          if (docs.length > 0) forYouCursorRef.current = docs[docs.length - 1];
          forYouHasMoreRef.current = docs.length >= FEED_PAGE_SIZE;
          const olderPosts = docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((p) => !forYouShownIdsRef.current.has(p.id))
            .filter(isValidFeedPost);
          appendFeedPosts(olderPosts);
          return;
        }
      }

      // Phase 2 (all): every remaining post by implicit document-id order, so
      // posts WITHOUT a `date` field (which orderBy('date') hides) still appear.
      // Loop a few pages per call so a run of already-seen posts doesn't look
      // like the feed stopped.
      let gathered = [];
      let pages = 0;
      while (gathered.length === 0 && pages < 6 && forYouAllHasMoreRef.current) {
        pages += 1;
        let q = db.collection('posts').limit(FEED_PAGE_SIZE);
        if (forYouAllCursorRef.current) q = q.startAfter(forYouAllCursorRef.current);
        const snap = await q.get();
        const docs = snap?.docs || [];
        if (docs.length > 0) forYouAllCursorRef.current = docs[docs.length - 1];
        forYouAllHasMoreRef.current = docs.length >= FEED_PAGE_SIZE;
        const fresh = docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => !forYouShownIdsRef.current.has(p.id));
        const blockedFiltered = filterBlocked(fresh, (p) => p.userId || p.uid).filter(isValidFeedPost);
        gathered = gathered.concat(blockedFiltered);
      }
      appendFeedPosts(gathered);
    } catch (e) {
      console.warn('[HOME] loadMoreForYou failed:', e?.message || String(e));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [firebaseEnabled, uid, appendFeedPosts]);

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
    const prevLikeCount = Number(
      likeCounts?.[postId] ?? post?.likeCount ?? post?.likes ?? post?.likedBy?.length ?? 0
    );
    const nextLikeCount = Math.max(0, prevLikeCount + (wasLiked ? -1 : 1));

    // optimistic
    setLiked((prev) => ({ ...prev, [postId]: !wasLiked }));
    setLikeCounts((prev) => ({ ...prev, [postId]: nextLikeCount }));

    try {
      const res = await setPostLiked({ postId, userId, like: !wasLiked });
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

      if (wasLiked) {
        if (post?.userId) {
          await trackActivity(ACTIVITY_TYPES.UNLIKE, userId, post.userId, {
            postId,
            postTitle: post.title || post.caption || post.description,
          });
        }
      } else {
        setHeartsBurst((prev) => ({ postId, key: prev.key + 1 }));
        // Earn-your-reach: a genuine like is a positive merit signal.
        reportEngagement('like', postId, post?.userId || post?.uid);
        if (post?.userId) {
          await trackActivity(ACTIVITY_TYPES.LIKE, userId, post.userId, {
            postId,
            postTitle: post.title || post.caption || post.description,
          });
        }
      }
    } catch (error) {
      console.error('Error updating like:', error);
      // revert explicitly
      setLiked((prev) => ({ ...prev, [postId]: wasLiked }));
      setLikeCounts((prev) => ({ ...prev, [postId]: prevLikeCount }));
    } finally {
      likePendingRef.current.delete(postId);
    }
  };

  const onFeedVideoPress = useCallback((item) => {
    const postId = item?.id;
    if (!postId) return;
    const now = Date.now();
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
      handlePostPress(item);
    }, 300);
  }, [handleLike, handlePostPress]);

  const handleFollow = async (username) => {
    if (requireAccount(navigation, 'follow creators')) return;
    const userId = username;
    const wasFollowing = following[username];
    const newFollowStatus = !wasFollowing;
    setFollowing((prev) => ({ ...prev, [username]: newFollowStatus }));
    try {
      console.log(newFollowStatus ? `Following ${username}!` : `Unfollowed ${username}`);
    } catch (error) {
      console.error('Error updating follow status:', error);
      setFollowing((prev) => ({ ...prev, [username]: wasFollowing }));
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

  const FeedActionButton = ({ onPress, children, active = false, count = 0 }) => {
    return (
      <TouchableOpacity
        style={styles.actionButtonOuter}
        activeOpacity={0.85}
        delayPressIn={0}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        onPress={(event) => {
          event?.stopPropagation?.();
          onPress?.(event);
        }}
      >
        <View style={styles.actionButtonStack}>
          <LinearGradient
            colors={BLYP_LOGO_GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.actionButtonRing}
          >
            {active ? (
              <LinearGradient
                colors={BLYP_LOGO_GRADIENT_COLORS}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.actionButtonInner}
              >
                <View style={styles.actionButtonGloss} pointerEvents="none" />
                {children}
              </LinearGradient>
            ) : (
              <View style={styles.actionButtonInner}>
                <View style={styles.actionButtonGloss} pointerEvents="none" />
                {children}
              </View>
            )}
          </LinearGradient>
          <Text style={styles.actionButtonCount} allowFontScaling={false}>
            {formatCount(count)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  // Non-interactive stat (e.g. views) that matches the themed action buttons so
  // the row reads as one consistent set instead of a stray icon.
  const FeedStatBadge = ({ children, count = 0 }) => (
    <View style={styles.actionButtonOuter} pointerEvents="none">
      <View style={styles.actionButtonStack}>
        <LinearGradient
          colors={BLYP_LOGO_GRADIENT_COLORS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.actionButtonRing}
        >
          <View style={styles.actionButtonInner}>
            <View style={styles.actionButtonGloss} pointerEvents="none" />
            {children}
          </View>
        </LinearGradient>
        <Text style={styles.actionButtonCount} allowFontScaling={false}>
          {formatCount(count)}
        </Text>
      </View>
    </View>
  );

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

  // onViewableItemsChanged used for the main feed lists
  // Viewability handler for #4ME feed only (ensures single active item)
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (selectedTabRef.current !== 'A') return;
    if (!viewableItems || viewableItems.length === 0) return;
    // Earn-your-reach: a post actually shown is an audition impression.
    viewableItems.forEach((vi) => {
      const p = vi?.item;
      if (!p?.id) return;
      const authorId = p.userId || p.uid || p.authorId;
      reportImpression(p.id, authorId);
      // What counts as a view: the post must have dwelled on screen (enforced by
      // viewabilityConfig.minimumViewTime), it's deduped to one per user/post in
      // the service, and a creator's own post never counts as a view.
      if (authorId && authorId === uidRef.current) return;
      recordPostView(p.id, uidRef.current).catch(() => {});
    });
    const first = viewableItems[0];
    if (typeof first.index === 'number') {
      showDescriptionForIndex(first.index);
      setCurrentDiscoverIndex(first.index);
      console.log('ðŸŽ¯ #4ME active index updated', first.index);
    }
  }).current;

  const handleDiscoverScrollEnd = useCallback(
    (e) => {
      if (selectedTabRef.current !== 'A') return;
      const y = e?.nativeEvent?.contentOffset?.y;
      if (!Number.isFinite(y) || !feedHeight) return;
      // Plain vertical paging feed: post index maps directly to the offset.
      const rawIndex = Math.round(y / feedHeight);
      const maxIndex = Math.max(0, (randomPosts?.length || 0) - 1);
      const nextIndex = Math.min(maxIndex, Math.max(0, rawIndex));
      if (nextIndex === currentDiscoverIndexRef.current) return;
      currentDiscoverIndexRef.current = nextIndex;
      showDescriptionForIndex(nextIndex);
      setCurrentDiscoverIndex(nextIndex);
    },
    [feedHeight, randomPosts?.length, showDescriptionForIndex]
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

  // Prefetch next video's file for active feed
  useEffect(() => {
    let isMounted = true;
    const isRandomFeed = selectedTab === 'A';
    const list = isRandomFeed ? randomPosts : videos;
    const current = isRandomFeed ? currentDiscoverIndex : currentIndex;
    const nextIndex = current + 1;

    if (!list || list.length === 0 || nextIndex >= list.length) {
      return () => {
        isMounted = false;
      };
    }

    const nextItem = list[nextIndex];
    const isVideo = nextItem?.type === 'video' || nextItem?.media?.[0]?.type?.includes('video');
    const nextUriCandidate = fixStorageUrl(nextItem?.videoUrl || nextItem?.media?.[0]?.url);

    if (
      isVideo &&
      nextUriCandidate &&
      !prefetchingRef.current[nextUriCandidate] &&
      !prefetchedUris[nextUriCandidate]
    ) {
      console.log('ðŸŽžï¸ HOME: Prefetching next video:', nextIndex);
      prefetchingRef.current[nextUriCandidate] = true;

      getPlayableVideoUri(nextUriCandidate)
        .then((playableUri) => {
          if (!isMounted) return;
          setPrefetchedUris((prev) => {
            if (prev[nextUriCandidate]) return prev;
            return { ...prev, [nextUriCandidate]: playableUri };
          });
        })
        .catch((error) => {
          if (isMounted) {
            console.log('âŒ HOME: Error prefetching video:', error);
            prefetchingRef.current[nextUriCandidate] = false;
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [currentIndex, currentDiscoverIndex, selectedTab, videos, randomPosts, prefetchedUris]);

  // Warm TCP/SSL connections for next two videos in active feed
  useEffect(() => {
    let isMounted = true;
    const isRandomFeed = selectedTab === 'A';
    const list = isRandomFeed ? randomPosts : videos;
    const current = isRandomFeed ? currentDiscoverIndex : currentIndex;

    if (!list || list.length === 0) return () => {
      isMounted = false;
    };

    const targets = [current + 1, current + 2].filter((i) => i < list.length);
    const activeConnections = [];

    targets.forEach((i) => {
      const item = list[i];
      const uriCandidate = fixStorageUrl(item?.videoUrl || item?.media?.[0]?.url);
      const isVideo = item?.type === 'video' || item?.media?.[0]?.type?.includes('video');

      if (isVideo && uriCandidate && prefetchedUris[uriCandidate]) {
        return; // Already cached locally; no need to warm HEAD request.
      }

      if (isVideo && uriCandidate) {
        console.log('ðŸ”Œ HOME: Warming connection for video:', i);
        const controller = new AbortController();
        const { signal } = controller;
        activeConnections.push(controller);

        fetch(uriCandidate, {
          method: 'HEAD',
          signal,
        }).catch((error) => {
          if (isMounted && error.name !== 'AbortError') {
            console.log('âŒ HOME: Connection warm-up failed:', error);
          }
        });
      }
    });

    return () => {
      isMounted = false;
      activeConnections.forEach((c) => {
        try {
          c.abort();
        } catch (e) {
          console.log('Error aborting connection:', e);
        }
      });
    };
  }, [currentIndex, currentDiscoverIndex, selectedTab, videos, randomPosts, prefetchedUris]);

  const renderRandomPostItem = ({ item, index, feedHeight }) => {
    const mediaItems = item.media || [{ url: fixStorageUrl(item.imageUrl || item.videoUrl), type: item.type }];
    const hasMultipleMedia = mediaItems.length > 1;
    const isActive = isScreenFocused && selectedTab === 'A' && index === currentDiscoverIndex;
    const showFullDescription = isActive && descriptionVisibleIndex === index;
    const pillTop = 12;
    const pillLeft = 12;
    const pillRightGap = 10;
    const showDetailsTop = pillTop + (userPillLayout?.height || 0) + 10;
    const reservedLeft = pillLeft + (userPillLayout?.width || 0) + pillRightGap;
    const availableRightSpace = screenWidth - reservedLeft - 12;
    const canPlaceDescriptionRight = availableRightSpace >= 160;

    // Top-anchor "contain" videos directly under the header. Once we know the
    // clip's intrinsic aspect we size the player to its rendered height pinned
    // to the top of the cell, so any leftover space sits at the BOTTOM (faded
    // into the dark theme behind the action buttons) instead of as a gap above.
    const cellHeight = feedHeight || screenHeight;
    const isVideoItem =
      item.type === 'video' ||
      mediaItems[0]?.type === 'video' ||
      (mediaItems[0]?.type && String(mediaItems[0]?.type).includes('video'));
    const itemAspect = videoAspect[item.id];
    let videoBottomGap = 0;
    if (isVideoItem && itemAspect > 0 && cellHeight > 0) {
      const fittedHeight = Math.round(screenWidth / itemAspect);
      videoBottomGap = Math.max(0, cellHeight - Math.min(cellHeight, fittedHeight));
    }
    const videoFillStyle =
      videoBottomGap > 0
        ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: videoBottomGap }
        : StyleSheet.absoluteFill;

    return (
      <View style={[styles.videoContainer, { height: feedHeight || screenHeight }]}>
        <View
          style={styles.userPillTopLeft}
          pointerEvents="box-none"
          onLayout={
            isActive
              ? (e) => {
                const { width, height } = e?.nativeEvent?.layout || {};
                if (!width || !height) return;
                setUserPillLayout((prev) => {
                  if (prev.width === width && prev.height === height) return prev;
                  return { width, height };
                });
              }
              : undefined
          }
        >
          <LinearGradient colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.15)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.userInfoHighlight}>
            <TouchableOpacity style={styles.profileMenuBarSection} onPress={() => handleUserProfilePress(item.user, item)}>
              <Text style={styles.profileMenuBarUsername} allowFontScaling={false} numberOfLines={1}>
                @{item.userDisplayName || item.user?.displayName || item.user?.username || item.username || 'user'}
              </Text>
              <Image source={{ uri: item.userPhotoURL || item.user?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face' }} style={styles.profileMenuBarAvatar} resizeMethod="resize" />
            </TouchableOpacity>
          </LinearGradient>
        </View>

        {hasMultipleMedia ? (
          <MediaCarousel media={mediaItems} style={StyleSheet.absoluteFill} feedIndex={index} isDiscoverItemActive={isDiscoverItemActive} />
        ) : (
          (() => {
            const isVideo = item.type === 'video' || mediaItems[0]?.type === 'video' || (mediaItems[0]?.type && String(mediaItems[0]?.type).includes('video'));
            const isAudio = item.type === 'audio' || mediaItems[0]?.type === 'audio';
            const videoUri = fixStorageUrl(item.videoUrl || mediaItems[0]?.url);
            const cachedUri = prefetchedUris[videoUri];
            const shouldLoad = Math.abs(currentDiscoverIndex - index) <= 1;

            return isVideo ? (
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => onFeedVideoPress(item)}>
                {console.log('ðŸŽ¥ HOME: Rendering #4ME video item', {
                  id: item.id,
                  index,
                  isFocused: isScreenFocused && selectedTab === 'A' && index === currentDiscoverIndex,
                  videoUrl: videoUri,
                  hasCachedUri: !!cachedUri,
                })}
                <EnhancedVideo
                  uri={videoUri}
                  cachedUri={cachedUri}
                  poster={item.thumbnail || item.user?.avatar}
                  style={videoFillStyle}
                  resizeMode="contain"
                  shouldPlay={isDiscoverItemActive(index)}
                  shouldLoad={shouldLoad}
                  isLooping
                  isMuted={false}
                  onNaturalSize={(ns) => {
                    const a = ns.width / ns.height;
                    if (!(a > 0)) return;
                    setVideoAspect((prev) =>
                      Math.abs((prev[item.id] || 0) - a) < 0.001
                        ? prev
                        : { ...prev, [item.id]: a }
                    );
                  }}
                  onError={(e) => {
                    console.log('âŒ Feed Video error', { id: item.id, uri: videoUri, error: e });
                  }}
                  onReady={() => {
                    console.log('ðŸŽ¥ Feed Video ready', { id: item.id, uri: videoUri, cached: !!cachedUri });
                  }}
                />
              </TouchableOpacity>
            ) : isAudio ? (
              <AudioTile
                uri={fixStorageUrl(item.audioUrl || mediaItems[0]?.url)}
                user={item.user}
                title={item.title}
                autoPlay={isDiscoverItemActive(index)}
                shouldLoad={Math.abs(currentDiscoverIndex - index) <= 2}
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
                        <View style={[styles.video, { backgroundColor: COLORS.backgroundLight, alignItems: 'center', justifyContent: 'center' }]}>
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
                        onLoadStart={() => console.log('ðŸ“· HomeScreen: Image loading started')}
                        onLoad={() => console.log('âœ… HomeScreen: Image loaded successfully')}
                        onError={(error) => {
                          console.warn('[HOME] Image failed to load', {
                            uri: imageUri,
                            error: error?.nativeEvent ?? null
                          });
                        }}
                      />
                    );
                  })()}
                  <View style={styles.imageEnhancementOverlay} />
                </View>
              </TouchableOpacity>
            );
          })()
        )}

        {videoBottomGap > 2 && (
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.85)', '#000']}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: videoBottomGap + 160 }}
            pointerEvents="none"
          />
        )}

        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.8)']} style={styles.videoOverlay} />

        <View style={[styles.profileMenuBar, { zIndex: 1000, elevation: 1000 }]} pointerEvents="box-none">
          <View style={styles.profileMenuBarSection}>
            <View style={{ zIndex: 1000 }}>
              <FeedActionButton
                onPress={() => handleLike(item.id)}
                active={!!liked[item.id]}
                count={likeCounts?.[item.id] ?? item.likeCount ?? item.likes ?? item.likedBy?.length ?? 0}
              >
                <Icon name={liked[item.id] ? 'heart' : 'heart-outline'} size={30} color={COLORS.white} />
              </FeedActionButton>
            </View>

            <FeedActionButton
              onPress={() => handleOpenComments(item)}
              count={getPostCommentCount(item)}
            >
              <Icon name="chatbubble" size={28} color={COLORS.white} />
            </FeedActionButton>

            <FeedActionButton
              onPress={() => handleSharePost(item)}
              count={item.shareCount ?? item.sharesCount ?? item.shares ?? 0}
            >
              <Icon name="share" size={28} color={COLORS.white} />
            </FeedActionButton>

            <FeedStatBadge count={getPostViewCount(item)}>
              <Icon name="eye-outline" size={26} color={COLORS.white} />
            </FeedStatBadge>

            <View style={styles.actionButton}>
              <GiftSystem
                postId={item.id}
                creatorId={item.uid || item.userId}
                creatorName={typeof item.user === 'object' ? item.user.username : item.user || item.username}
                triggerVariant="feed"
              />
            </View>
          </View>
        </View>

        {/* Full description overlay (auto hides after 2s) */}
        {showFullDescription && (
          <View
            style={[
              styles.descriptionOverlayTop,
              canPlaceDescriptionRight
                ? { top: pillTop, left: reservedLeft, right: 12 }
                : { top: showDetailsTop },
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

        {/* Collapsed info chip */}
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

        <LiveReactionsHearts
          burstKey={heartsBurst?.postId === item.id ? heartsBurst.key : null}
          bottomOffset={96}
          rightOffset={24}
          heartSize={66}
        />
      </View>
    );
  };

  const renderHeader = () => (
    <BlypHeaderFlow
      tabs={enabledPages.map((p) => ({ key: p.key, label: p.label }))}
      matchHomePadding={true}
      activeKey={selectedTab}
      onTabChange={setSelectedTab}
      onMenuPress={() => setMenuVisible(true)}
      searchLabel="blyp it"
      onSearchPress={() => navigation.navigate('Blyp')}
      rightAction={(
        <View style={styles.headerRightRow}>
          <TouchableOpacity
            style={styles.hubHeaderBtn}
            onPress={() => navigation.navigate('Hub')}
            accessibilityRole="button"
            accessibilityLabel="Open Social Hub"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="grid-outline" size={20} color={HEADER_ICON_COLOR} />
          </TouchableOpacity>
          {selectedTab !== 'home' ? (
            <TouchableOpacity style={styles.headerSearchPill} onPress={() => navigation.navigate('Blyp')}>
              <Icon name="search" size={16} color={HEADER_ICON_COLOR} />
              <Text style={styles.headerSearchPillText} allowFontScaling={false}>blyp it</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
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
            isMuted={false}
            resizeMode="cover"
          />
        </TouchableOpacity>
      )}

      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.8)']} style={styles.videoOverlay} />

      <View style={styles.profileMenuBarContainer} pointerEvents="box-none">
        <View style={[styles.profileMenuBar, { zIndex: 1000, elevation: 1000 }]}>
          <View style={styles.profileMenuBarSection}>
            <View style={{ zIndex: 1000 }}>
              <FeedActionButton
                onPress={() => handleLike(item.id)}
                active={!!liked[item.id]}
                count={likeCounts?.[item.id] ?? item.likeCount ?? item.likes ?? item.likedBy?.length ?? 0}
              >
                <Icon name={liked[item.id] ? 'heart' : 'heart-outline'} size={30} color={COLORS.white} />
              </FeedActionButton>
            </View>

            <FeedActionButton
              onPress={() => handleOpenComments(item)}
              count={getPostCommentCount(item)}
            >
              <Icon name="chatbubble" size={28} color={COLORS.white} />
            </FeedActionButton>

            <FeedActionButton
              onPress={() => handleSharePost(item)}
              count={item.shareCount ?? item.sharesCount ?? item.shares ?? 0}
            >
              <Icon name="share" size={28} color={COLORS.white} />
            </FeedActionButton>

            <FeedStatBadge count={getPostViewCount(item)}>
              <Icon name="eye-outline" size={26} color={COLORS.white} />
            </FeedStatBadge>

            <View style={styles.actionButton}>
              <GiftSystem
                postId={item.id}
                creatorId={item.uid || item.userId}
                creatorName={typeof item.user === 'object' ? item.user.username : item.user || item.username}
                triggerVariant="feed"
              />
            </View>
          </View>
        </View>
      </View>

      <View style={styles.bottomContent}>
        <View style={styles.descriptionContainerBottom}>
          <Text style={styles.description} allowFontScaling={false}>{item.description || item.transcript}</Text>
        </View>
      </View>

      <HeartAnimation key={heartAnimationKey} visible={showHeartAnimation} onAnimationComplete={() => setShowHeartAnimation(false)} />

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
      return <TopicFeedPanel navigation={navigation} label={page?.label || 'Topic'} />;
    }
    switch (selectedTab) {
      case 'home':
        return (
          <HomeBasePanel
            navigation={navigation}
            uid={uid}
            interests={prefs?.interests || []}
            pages={enabledPages}
            onOpenPage={(key) => setSelectedTab(key)}
            onEditPages={() => navigation.navigate('PagesEditor')}
          />
        );
      case 'following':
        return <FollowingFeedPanel navigation={navigation} uid={uid} />;
      case 'A':
        if (loading || !feedHeight) {
          return <FeedEmptyState mode="loading" />;
        }
        if (isEmptyFeed || randomPosts.length === 0) {
          return <FeedEmptyState mode="empty" />;
        }
        return (
          <View style={{ height: feedHeight }}>
            <FlatList
              ref={flatListRef}
              data={randomPosts}
              renderItem={(props) => renderRandomPostItem({ ...props, feedHeight })}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              refreshing={loading}
              onRefresh={loadRandomPosts}
              scrollEventThrottle={16}
              pagingEnabled
              snapToInterval={feedHeight}
              snapToAlignment="start"
              decelerationRate="fast"
              removeClippedSubviews
              maxToRenderPerBatch={1}
              windowSize={2}
              initialNumToRender={1}
              updateCellsBatchingPeriod={100}
              getItemLayout={(data, index) => ({
                length: feedHeight,
                offset: feedHeight * index,
                index,
              })}
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
              colors={['#0A0A0C', '#141418', '#1C1C22']}
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
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hubHeaderBtn: {
    minHeight: 32,
    minWidth: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  headerSearchPill: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  headerSearchPillText: { color: HEADER_ICON_COLOR, fontSize: 12, fontWeight: '700', includeFontPadding: false },
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
  videoContainer: { width: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: 'black', overflow: 'hidden' },
  video: { width: '100%', height: '100%', backgroundColor: 'black' },
  videoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bottomContent: { position: 'absolute', top: 24, left: 20, right: 80 }, // retained for other tabs (#B) but not used in #4ME now
  description: { color: 'white', fontSize: 15, lineHeight: 20, marginBottom: 8, fontWeight: '800' },
  descriptionContainerBottom: { position: 'absolute', top: 164, left: 15, right: 200, paddingHorizontal: 10 },
  profileMenuBar: { position: 'absolute', bottom: 80, left: 10, right: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', zIndex: 1000, gap: 15 },
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
  descriptionOverlayTop: { position: 'absolute', left: 16, right: 16, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, backgroundColor: 'rgba(15,23,42,0.75)' },
  descriptionInfoChip: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.9)' },
  descriptionInfoChipUnderPill: {
    position: 'absolute',
    left: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    zIndex: 1200,
    elevation: 1200,
  },
  descriptionInfoChipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '500' },
  postTitle: { fontWeight: '700', fontSize: 16, color: COLORS.textPrimary, marginBottom: 6 },
  postName: { fontWeight: 'bold', fontSize: 18, color: COLORS.textPrimary, marginBottom: 6, textAlign: 'center' },
  postDescription: { fontSize: 15, color: COLORS.textSecondary, textAlign: 'center' },
  minimizeButton: { position: 'absolute', top: -8, right: -8, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 15, width: 30, height: 30, justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  carouselContainer: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  carouselItemContainer: { width: Dimensions.get('window').width, height: '100%' },
  carouselMedia: { width: Dimensions.get('window').width, height: '100%', borderRadius: 15 },
  imageEnhancementOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255, 255, 255, 0.03)', pointerEvents: 'none' },
  mediaCounter: { position: 'absolute', top: 15, right: 15, backgroundColor: 'rgba(0, 0, 0, 0.7)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 15 },
  mediaCounterText: { color: COLORS.white, fontSize: 12, fontWeight: '600' },
  paginationDots: { position: 'absolute', bottom: 20, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  paginationDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255, 255, 255, 0.5)', marginHorizontal: 4 },
  paginationDotActive: { backgroundColor: COLORS.white, width: 10, height: 10, borderRadius: 5 },
  actionButton: { alignItems: 'center', marginHorizontal: 8 },
  actionButtonOuter: {
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  actionButtonStack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    padding: 2,
  },
  actionButtonInner: {
    flex: 1,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,24,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  actionButtonGloss: {
    position: 'absolute',
    top: 5,
    left: 6,
    right: 6,
    height: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  actionButtonCount: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
    textAlign: 'center',
  },
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


