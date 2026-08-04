import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Alert,
  StatusBar,
  Animated,
  FlatList,
  ActivityIndicator,
  Modal,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import PremiumFeedVideo from '../components/Feed/PremiumFeedVideo';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from 'react-native-toast-message';
import { db, auth, firebaseEnabled } from '../config/firebase';
import { setPostLiked } from '../services/LikeService';
import { recordPostView, getPostViewCount } from '../services/PostViewService';
import PhotoGallery from '../components/PhotoGallery';
import HeartAnimation from '../components/HeartAnimation';
import CommentsModal from '../components/CommentsModal';
import PostReachSheet from '../components/PostReachSheet';
import VideoFramingSheet from '../components/VideoFramingSheet';
import ReportModal from '../components/ReportModal';
import GiftSystem from '../components/GiftSystem';
import { blockUser } from '../services/BlockService';
import { fixStorageUrl } from '../utils/urlUtils';
import { sharePost as sharePostLink } from '../services/shareService';
import { COLORS } from '../styles/theme';
import { BLYP_LOGO_GRADIENT_COLORS } from '../components/BlypLogo';
import { followUser, unfollowUser, subscribeToFollowingList } from '../utils/followUtils';
import { useAuth } from '../hooks/useCommon';
import { recordWatch } from '../services/watchHistoryService';
import { setReachSession, reportWatch, reportEngagement, flushReachEvents, reachSummary } from '../services/blypReachClient';
import { getPlayableVideoUri } from '../utils/videoCache';
import { isVideoPost } from '../utils/mediaViewerPlaylist';
import { updatePostCategory } from '../services/postEditService';
import { normalizeProfileCategories } from '../utils/profileCategories';

async function downloadRawVideo(remoteUrl) {
  const url = fixStorageUrl(remoteUrl);
  if (!url) throw new Error('No video URL');
  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm?.granted) {
    const err = new Error('permission-denied');
    err.code = 'permission-denied';
    throw err;
  }
  const dest = `${FileSystem.cacheDirectory}blyp_dl_${Date.now()}.mp4`;
  const result = await FileSystem.downloadAsync(url, dest);
  if (!result?.uri) throw new Error('Download failed');
  await MediaLibrary.saveToLibraryAsync(result.uri);
  try {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
  } catch {
    /* ignore */
  }
  return true;
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// A value "looks like a raw id" (Cognito sub / UUID / opaque token) when we
// should NOT show it as a human name. Used so the viewer never displays
// "@96b24294-6051-70bb-..." instead of a real display name.
const looksLikeRawId = (s) => {
  const t = String(s || '').trim();
  if (!t) return true;
  if (/\s/.test(t)) return false; // contains spaces -> definitely a real name
  // UUID-ish, e.g. 96b24294-6051-70bb-3f4c-a40185e033cf
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(t)) return true;
  // Long opaque, hyphen/hex-heavy token with no spaces (Cognito sub etc.)
  if (t.length >= 20 && /[0-9]/.test(t) && /[a-f]/i.test(t) && /[-_]/.test(t)) return true;
  return false;
};

// Pick the best human-readable name from a post's many possible fields.
const pickAuthorName = (p) => {
  const cands = [
    p?.userDisplayName, p?.displayName, p?.user?.displayName,
    p?.user?.username, p?.userName, p?.username, p?.name, p?.author,
  ];
  for (const c of cands) {
    const t = typeof c === 'string' ? c.trim() : '';
    if (t && !looksLikeRawId(t)) return t;
  }
  return '';
};

// Compact count formatter (1.2K / 3.4M) — same rules as the For You feed.
const formatCount = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.max(0, Math.trunc(n)));
};

// Identical to the Home "For You" FeedActionButton (teal gradient ring + dark
// inner + gloss, count underneath) so the player reads as the same surface.
const FeedActionButton = ({ onPress, children, active = false, count = 0 }) => (
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

// Non-interactive stat (views) matching the action buttons — same as Home.
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

// A single full-screen video/post "page" inside the vertical pager.
const MediaViewerItem = ({
  post: actualPost,
  isActive,
  shouldLoadVideo = true,
  pageHeight,
  navigation,
  effectiveOwnerIds = [],
  followingSet,
  onToggleFollow,
}) => {
  // useAuth().uid is the app's primary identity id (Cognito user id)
  const { uid, authReady, isAuthenticated } = useAuth();

  // Alias kept so the (large) body below continues to reference `post`.
  const post = actualPost;

  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [giftCoinsLocal, setGiftCoinsLocal] = useState(() =>
    Math.max(
      Number(actualPost?.giftCoins) || 0,
      Number(actualPost?.coinsReceived) || 0,
    ),
  );
  const [videoStatus, setVideoStatus] = useState({});
  // Intrinsic video aspect (w/h) — used by PremiumFeedVideo sizing hooks.
  const [videoAspectRatio, setVideoAspectRatio] = useState(0);
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const [heartAnimationKey, setHeartAnimationKey] = useState(0);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [reachSheetVisible, setReachSheetVisible] = useState(false);
  const [framingSheetVisible, setFramingSheetVisible] = useState(false);
  const [mediaDisplay, setMediaDisplay] = useState(() => actualPost?.mediaDisplay || null);
  const [reportVisible, setReportVisible] = useState(false);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Tap-to-pause: paused mirrors the user's manual toggle for this page.
  const [paused, setPaused] = useState(false);
  // Pause/mute playback when this screen loses navigation focus (e.g. the user
  // opens a post video then goes live). Without this the unmuted video keeps
  // playing in the background — its audio bleeds behind the live broadcast —
  // because `isActive` only tracks the active page, not whether the screen is
  // still on top.
  const isScreenFocused = useIsFocused();
  // Resolved human-readable author name (never a raw id).
  const [authorName, setAuthorName] = useState(() => pickAuthorName(actualPost));
  // "Show details" chip → temporary title/caption overlay (mirrors For You).
  const [showDetails, setShowDetails] = useState(false);
  const detailsTimerRef = useRef(null);

  // Animation refs
  const likeAnimation = useRef(new Animated.Value(1)).current;
  const heartAnimation = useRef(new Animated.Value(0)).current;
  const uiOpacity = useRef(new Animated.Value(1)).current;
  const likePendingRef = useRef(false);
  const videoRef = useRef(null);

  const displayName = authorName || 'user';
  // The creator this post belongs to (used for follow + profile navigation).
  const creatorId = actualPost.userId || actualPost.uid || actualPost.user?.uid || actualPost.user?.id || null;
  // Follow state is derived from the screen-level following set, so it persists
  // correctly as you swipe through more of the same creator's videos.
  const isOwnPost = !!uid && !!creatorId && creatorId === uid;
  const isFollowing = !!creatorId && !!followingSet && followingSet.has(creatorId);

  useEffect(() => {
    setIsLiked(uid ? (actualPost.likedBy?.includes(uid) || false) : false);
    setLikeCount(actualPost.likeCount || actualPost.likes || 0);
    setGiftCoinsLocal((prev) =>
      Math.max(
        Number(prev) || 0,
        Number(actualPost?.giftCoins) || 0,
        Number(actualPost?.coinsReceived) || 0,
      ),
    );
  }, [actualPost, uid]);

  useEffect(() => {
    setMediaDisplay(actualPost?.mediaDisplay || null);
  }, [actualPost?.id, actualPost?.mediaDisplay]);

  const openCreatorProfile = () => {
    if (!creatorId) return;
    try {
      navigation.navigate('UserProfile', { userId: creatorId, username: displayName });
    } catch { /* ignore */ }
  };

  // A freshly-activated page (or new post) should start playing.
  useEffect(() => { setPaused(false); }, [isActive, actualPost?.id]);

  // Keep the displayed name in sync with the post, and resolve from the users
  // collection when the post itself only carries a raw id.
  useEffect(() => {
    const fromPost = pickAuthorName(actualPost);
    if (fromPost) { setAuthorName(fromPost); return undefined; }
    const authorId = actualPost?.userId || actualPost?.uid || actualPost?.user?.uid;
    if (!authorId || !firebaseEnabled || !db || typeof db.collection !== 'function') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const snap = await db.collection('users').doc(String(authorId)).get();
        const data = snap && typeof snap.data === 'function' ? snap.data() : null;
        const nm = [data?.displayName, data?.username, data?.name]
          .map((v) => (typeof v === 'string' ? v.trim() : ''))
          .find((v) => v && !looksLikeRawId(v));
        if (!cancelled && nm) setAuthorName(nm);
      } catch { /* keep fallback */ }
    })();
    return () => { cancelled = true; };
  }, [actualPost?.id, actualPost?.userId]);

  // Live like state: read the post doc so likes PERSIST and reflect the server,
  // instead of trusting the (possibly stale) object we were navigated with.
  useEffect(() => {
    const id = actualPost?.id;
    if (!id || !firebaseEnabled || !db || typeof db.collection !== 'function') return undefined;
    let cancelled = false;
    let unsub = null;
    try {
      unsub = db.collection('posts').doc(String(id)).onSnapshot((snap) => {
        if (cancelled || likePendingRef.current) return; // don't fight an in-flight toggle
        const data = snap && typeof snap.data === 'function' ? snap.data() : null;
        if (!data) return;
        const cnt = typeof data.likeCount === 'number'
          ? data.likeCount
          : (typeof data.likes === 'number' ? data.likes : (Array.isArray(data.likedBy) ? data.likedBy.length : 0));
        setLikeCount(Math.max(0, cnt || 0));
        setIsLiked(uid && Array.isArray(data.likedBy) ? data.likedBy.includes(uid) : false);
        const giftCoins = Math.max(
          Number(data.giftCoins) || 0,
          Number(data.coinsReceived) || 0,
        );
        setGiftCoinsLocal((prev) => Math.max(Number(prev) || 0, giftCoins));
      }, () => {});
    } catch { /* ignore */ }
    return () => { cancelled = true; try { unsub && unsub(); } catch {} };
  }, [actualPost?.id, uid]);

  // Latest playback status, read at the moment a page stops being active so we can
  // report how much of the video was actually watched (the key merit signal).
  const videoStatusRef = useRef({});
  useEffect(() => {
    videoStatusRef.current = videoStatus || {};
  }, [videoStatus]);

  // Record into "Continue watching" history when this page becomes active, and
  // measure watch dwell + completion for earn-your-reach.
  const watchStartRef = useRef(0);
  useEffect(() => {
    if (isActive && actualPost?.id) {
      setReachSession(uid || 'anon');
      recordWatch(uid, actualPost);
      // A deliberate open of a post is itself a strong signal of interest.
      reportWatch(actualPost.id, actualPost.userId || actualPost.uid, 0, undefined);
      // Count a unique public view (deduped per user/post inside the service).
      recordPostView(actualPost.id, uid).catch(() => {});
      watchStartRef.current = Date.now();
      return () => {
        const dwellMs = watchStartRef.current ? Date.now() - watchStartRef.current : 0;
        watchStartRef.current = 0;
        const st = videoStatusRef.current || {};
        const completion =
          st.durationMillis > 0 ? Math.min(1, (st.positionMillis || 0) / st.durationMillis) : undefined;
        if (dwellMs > 800) {
          reportWatch(actualPost.id, actualPost.userId || actualPost.uid, dwellMs, completion);
        }
        flushReachEvents();
      };
    }
    return undefined;
  }, [isActive, actualPost?.id, uid]);

  const canDeletePost = (() => {
    const owner = String(actualPost?.userId || '').trim();
    if (!owner) return false;
    return effectiveOwnerIds.includes(owner);
  })();

  const videoDownloadUrl = (() => {
    if (actualPost?.videoUrl) return fixStorageUrl(actualPost.videoUrl);
    const mediaVid = (actualPost?.media || []).find(
      (m) =>
        m?.type === 'video' ||
        m?.type === 'video/mp4' ||
        String(m?.type || '').includes('video') ||
        String(m?.type || '').includes('mp4'),
    );
    return fixStorageUrl(mediaVid?.url || mediaVid?.uri || null);
  })();

  const closeOptions = () => setOptionsVisible(false);

  const handleDownloadVideo = async () => {
    if (!videoDownloadUrl) {
      Alert.alert('Download', 'No video file on this post.');
      return;
    }
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadRawVideo(videoDownloadUrl);
      closeOptions();
      Toast.show({
        type: 'success',
        text1: 'Saved',
        text2: 'Video saved to your gallery',
        position: 'bottom',
        visibilityTime: 1800,
      });
    } catch (e) {
      if (e?.code === 'permission-denied' || String(e?.message || '').includes('permission')) {
        Alert.alert('Permission needed', 'Allow photo/video access so Blyp can save the download.');
      } else {
        Alert.alert('Download failed', e?.message || 'Could not download this video.');
      }
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenMenu = () => {
    setOptionsVisible(true);
  };

  const runWhySeeing = () => {
    closeOptions();
    const summary = reachSummary(actualPost);
    const base =
      'Posts earn their reach on Blyp — this one was shown to you based on how well people who saw it reacted (watch-through, likes, shares), your follows and interests, plus a small random mix so good new content can break out. Paying never buys reach.';
    let message = base;
    if (summary && summary.has) {
      const lines = [
        `This post is "${summary.label}" — shown to about ${summary.exposurePct}% of its potential audience.`,
        summary.headline + '.',
        `It reached you because it earned a Blyp Score of ${summary.score} from genuine engagement, not because anyone paid.`,
      ];
      message = lines.join('\n\n');
    }
    Alert.alert('Why am I seeing this?', message, [
      { text: 'Close', style: 'cancel' },
      { text: 'Open Transparency', onPress: () => navigation.navigate('Transparency') },
    ]);
  };

  // TikTok-style like animation
  const triggerLikeAnimation = () => {
    // Scale animation for button
    Animated.sequence([
      Animated.timing(likeAnimation, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(likeAnimation, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    // Heart animation for screen center
    if (!isLiked) {
      Animated.sequence([
        Animated.timing(heartAnimation, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(heartAnimation, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  const handleLike = async () => {
    if (!authReady || !isAuthenticated || !uid) {
      Alert.alert('Error', 'Please log in to like posts');
      return;
    }

    if (likePendingRef.current) return;
    likePendingRef.current = true;

    triggerLikeAnimation();

    if (!firebaseEnabled || !db || typeof db.collection !== 'function') {
      console.log('⚠️ MediaViewer: Firebase disabled or db unavailable, skipping like write');
      likePendingRef.current = false;
      return;
    }

    const wasLiked = isLiked;

    // Optimistic update
    setIsLiked(!wasLiked);
    setLikeCount((prev) => (wasLiked ? prev - 1 : prev + 1));

    try {
      const res = await setPostLiked({ postId: actualPost.id, userId: uid, like: !wasLiked });
      if (!res?.ok) {
        throw res?.error || new Error(res?.reason || 'LIKE_FAILED');
      }
      // Reconcile optimistic state with the server's authoritative result.
      // The transaction derives the new state from server truth, which can
      // differ from our optimistic guess if local state was stale — without
      // this, the heart/count can drift (the "flash off" symptom).
      if (typeof res.liked === 'boolean') setIsLiked(res.liked);
      if (Number.isFinite(res.count)) setLikeCount(res.count);
      if (res.liked) {
        setShowHeartAnimation(true);
        setHeartAnimationKey((prev) => prev + 1);
        reportEngagement('like', actualPost.id, actualPost.userId || actualPost.uid);
      }
    } catch (error) {
      console.error('Error updating like:', error);
      // Revert optimistic update
      setIsLiked(wasLiked);
      setLikeCount((prev) => (wasLiked ? prev + 1 : prev - 1));
    } finally {
      likePendingRef.current = false;
    }
  };

  const handleFollow = async () => {
    if (!uid) {
      Toast.show({ type: 'info', text1: 'Sign in to follow creators', position: 'bottom', visibilityTime: 1500 });
      return;
    }
    if (!creatorId || isOwnPost) return;
    const wasFollowing = isFollowing;
    // Parent owns the optimistic update + Firestore write so the change persists
    // across every page of this creator's feed.
    onToggleFollow?.(creatorId, wasFollowing);
    Toast.show({
      type: 'success',
      text1: wasFollowing ? 'Unfollowed' : 'Following!',
      text2: wasFollowing ? `Removed @${displayName}` : `Now following @${displayName}`,
      position: 'bottom',
      visibilityTime: 1500,
    });
  };

  // Tap anywhere on the video: double-tap to like (TikTok-style), single tap pauses.
  const screenTapRef = useRef({ at: 0, timer: null });
  const handleScreenTap = () => {
    const now = Date.now();
    if (now - screenTapRef.current.at < 320) {
      if (screenTapRef.current.timer) clearTimeout(screenTapRef.current.timer);
      screenTapRef.current = { at: 0, timer: null };
      handleLike();
      return;
    }
    screenTapRef.current.at = now;
    if (screenTapRef.current.timer) clearTimeout(screenTapRef.current.timer);
    screenTapRef.current.timer = setTimeout(() => {
      screenTapRef.current = { at: 0, timer: null };
      setPaused((prev) => {
        const next = !prev;
        const v = videoRef.current;
        try {
          if (next) v?.pauseAsync?.();
          else v?.playAsync?.();
        } catch { /* best-effort */ }
        return next;
      });
    }, 300);
  };

  const handleShare = async () => {
    try {
      // Share an HTTPS blyp.world link (with the post title + thumbnail baked in)
      // so WhatsApp/iMessage show a proper preview tile, not a raw file URL.
      const ok = await sharePostLink({ ...actualPost, username: displayName });
      if (ok) {
        reportEngagement('share', actualPost.id, actualPost.userId || actualPost.uid);
        Toast.show({
          type: 'success',
          text1: '📤 Shared!',
          text2: 'Post shared successfully',
          position: 'bottom',
          visibilityTime: 1500,
        });
      }
    } catch (error) {
      console.error('Error sharing:', error);
      Alert.alert('Error', 'Failed to share post');
    }
  };

  // Every video fills the frame via PremiumFeedVideo (cover / smart contain).
  const handleVideoLoad = (eventOrStatus) => {
    const ns = eventOrStatus?.naturalSize;
    if (ns && ns.width > 0 && ns.height > 0) {
      const a = ns.width / ns.height;
      if (a > 0) {
        setVideoAspectRatio((prev) => (Math.abs(prev - a) < 0.001 ? prev : a));
      }
    }
  };

  const handleShowDetails = () => {
    setShowDetails(true);
    if (detailsTimerRef.current) clearTimeout(detailsTimerRef.current);
    detailsTimerRef.current = setTimeout(() => setShowDetails(false), 2500);
  };
  useEffect(() => () => {
    if (detailsTimerRef.current) clearTimeout(detailsTimerRef.current);
  }, []);

  // Full-bleed premium player — no letterbox gap math.
  const mediaFillStyle = styles.media;

  const renderMedia = () => {
    // Handle video content
    if (post.videoUrl) {
      const fixedUrl = fixStorageUrl(post.videoUrl);
      return (
        <PremiumFeedVideo
          uri={fixedUrl}
          poster={actualPost.thumbnail || actualPost.imageUrl}
          style={mediaFillStyle}
          shouldPlay={isActive && isScreenFocused}
          shouldLoad={shouldLoadVideo}
          paused={paused}
          isLooping
          isMuted={false}
          mediaDisplay={mediaDisplay}
          onNaturalSize={(ns) => {
            if (ns?.width > 0 && ns?.height > 0) {
              const a = ns.width / ns.height;
              if (a > 0) setVideoAspectRatio((prev) => (Math.abs(prev - a) < 0.001 ? prev : a));
            }
          }}
          onProgress={(_p, status) => {
            if (status) setVideoStatus(status);
          }}
          onError={(error) => console.error('Video playback error:', error)}
        />
      );
    }

    // Handle media array (photos and videos)
    if (actualPost.media && actualPost.media.length > 0) {
      const photos = actualPost.media.filter(item =>
        item.type === 'photo' ||
        item.type === 'image' ||
        item.type === 'image/jpeg' ||
        item.type === 'image/png' ||
        item.type?.startsWith('image/') ||
        (!item.type?.includes('video') && !item.type?.includes('mp4') && !item.type?.startsWith('video/'))
      );

      const videos = actualPost.media.filter(item =>
        item.type === 'video' ||
        item.type === 'video/mp4' ||
        item.type?.includes('video') ||
        item.type?.includes('mp4') ||
        item.type?.startsWith('video/')
      );

      // If there are multiple photos, show gallery
      if (photos.length > 1) {
        return <PhotoGallery photos={photos} style={styles.media} />;
      }

      // If there's a video, show it
      if (videos.length > 0) {
        const firstVideo = videos[0];
        const fixedUrl = fixStorageUrl(firstVideo.url || firstVideo.uri);
        return (
          <PremiumFeedVideo
            uri={fixedUrl}
            poster={firstVideo.thumbnail || actualPost.thumbnail}
            style={mediaFillStyle}
            shouldPlay={isActive && isScreenFocused}
            shouldLoad={shouldLoadVideo}
            paused={paused}
            isLooping
            isMuted={false}
            mediaDisplay={mediaDisplay}
            onNaturalSize={(ns) => {
              if (ns?.width > 0 && ns?.height > 0) {
                const a = ns.width / ns.height;
                if (a > 0) setVideoAspectRatio((prev) => (Math.abs(prev - a) < 0.001 ? prev : a));
              }
            }}
            onProgress={(_p, status) => {
              if (status) setVideoStatus(status);
            }}
            onError={(error) => console.error('Video playback error:', error)}
          />
        );
      }

      // Single photo
      if (photos.length === 1) {
        return (
          <Image
            source={{ uri: photos[0].url || photos[0].uri }}
            style={styles.media}
            resizeMode="cover"
          />
        );
      }
    }

    // Handle single image URL
    if (actualPost.imageUrl) {
      return (
        <Image
          source={{ uri: actualPost.imageUrl }}
          style={styles.media}
          resizeMode="cover"
        />
      );
    }

    // Handle thumbnail fallback
    if (post.thumbnail) {
      return (
        <Image
          source={{ uri: post.thumbnail }}
          style={styles.media}
          resizeMode="cover"
        />
      );
    }

    // Fallback for text-only posts
    return (
      <View style={styles.textOnlyMedia}>
        <LinearGradient
          colors={[COLORS.primaryDark, COLORS.primary, COLORS.electric]}
          style={styles.textOnlyGradient}
        >
          <Text style={styles.textOnlyEmoji}>{actualPost.emoji || '📝'}</Text>
          <Text style={styles.textOnlyTitle}>{actualPost.title || 'Text Post'}</Text>
        </LinearGradient>
      </View>
    );
  };

  const formatHashtags = (hashtags) => {
    if (!hashtags || !Array.isArray(hashtags)) return '';
    return hashtags.map(tag => `#${tag.replace('#', '')}`).join(' ');
  };

  return (
    <View style={[styles.container, { height: pageHeight, width: screenWidth }]}>
      <StatusBar barStyle="light-content" backgroundColor="#000" translucent />

      {/* Full-Screen Media Background */}
      <TouchableOpacity
        style={styles.mediaContainer}
        activeOpacity={1}
        onPress={handleScreenTap}
      >
        {renderMedia()}
      </TouchableOpacity>

      {/* Floating Heart Animation */}
      <Animated.View
        style={[
          styles.floatingHeart,
          {
            opacity: heartAnimation,
            transform: [
              {
                scale: heartAnimation.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 1.5],
                }),
              },
            ],
          },
        ]}
        pointerEvents="none"
      >
        <Icon name="heart" size={80} color={COLORS.gradientEnd} />
      </Animated.View>

      {/* Multiple Hearts Animation */}
      <HeartAnimation
        key={heartAnimationKey}
        visible={showHeartAnimation}
        onAnimationComplete={() => setShowHeartAnimation(false)}
      />

      {/* Top row: back button + creator pill (For You style) + options menu */}
      <Animated.View style={[styles.topUI, { opacity: uiOpacity }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>

        <View style={styles.userPillWrap} pointerEvents="box-none">
          <TouchableOpacity style={styles.creatorPill} onPress={openCreatorProfile} activeOpacity={0.85}>
            {actualPost.user?.avatar || actualPost.userPhotoURL ? (
              <Image
                source={{ uri: actualPost.user?.avatar || actualPost.userPhotoURL }}
                style={styles.creatorAvatar}
              />
            ) : (
              <LinearGradient colors={[COLORS.primary, COLORS.electric]} style={styles.creatorAvatarFallback}>
                <Icon name="person" size={16} color="#0A0A0C" />
              </LinearGradient>
            )}
            <Text style={styles.creatorHandle} allowFontScaling={false} numberOfLines={1}>
              @{displayName}
            </Text>
            {!isFollowing && !isOwnPost && (
              <TouchableOpacity
                style={styles.followBadge}
                onPress={(e) => { e?.stopPropagation?.(); handleFollow(); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <LinearGradient colors={['#00D2BE', '#00A89E']} style={styles.followBadgeInner}>
                  <Icon name="add" size={12} color="#0A0A0C" />
                </LinearGradient>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.menuButton}
          onPress={handleOpenMenu}
        >
          <Icon name="more" size={26} color="#fff" />
        </TouchableOpacity>
      </Animated.View>

      {/* "Show details" chip + expanded description (For You style) */}
      {showDetails ? (
        <View style={styles.descriptionOverlayTop}>
          <Text style={styles.detailsTitle} numberOfLines={1} allowFontScaling={false}>
            {actualPost.title || actualPost.captionTitle || `@${displayName}`}
          </Text>
          {(actualPost.caption || actualPost.description) ? (
            <Text style={styles.detailsDescription} numberOfLines={3} allowFontScaling={false}>
              {actualPost.caption || actualPost.description}
            </Text>
          ) : null}
          {(post.hashtags || post.tags) ? (
            <Text style={styles.detailsHashtags} numberOfLines={2} allowFontScaling={false}>
              {formatHashtags(post.hashtags || post.tags)}
            </Text>
          ) : null}
        </View>
      ) : (
        <TouchableOpacity
          style={styles.descriptionInfoChip}
          onPress={handleShowDetails}
          activeOpacity={0.85}
        >
          <Text style={styles.descriptionInfoChipText} allowFontScaling={false}>Show details</Text>
        </TouchableOpacity>
      )}

      {/* Bottom action row — identical to the For You feed */}
      <Animated.View style={[styles.actionRow, { opacity: uiOpacity }]} pointerEvents="box-none">
        <View style={styles.actionRowInner}>
          <Animated.View style={{ transform: [{ scale: likeAnimation }] }}>
            <FeedActionButton
              onPress={handleLike}
              active={isLiked}
              count={likeCount}
            >
              <Icon name={isLiked ? 'heart' : 'heart-outline'} size={30} color={COLORS.white} />
            </FeedActionButton>
          </Animated.View>

          <FeedActionButton
            onPress={() => setCommentsVisible(true)}
            count={actualPost.commentCount || (Array.isArray(actualPost.comments) ? actualPost.comments.length : actualPost.comments) || 0}
          >
            <Icon name="chatbubble" size={28} color={COLORS.white} />
          </FeedActionButton>

          <FeedActionButton
            onPress={handleShare}
            count={actualPost.shareCount ?? actualPost.sharesCount ?? actualPost.shares ?? 0}
          >
            <Icon name="share" size={28} color={COLORS.white} />
          </FeedActionButton>

          <FeedStatBadge count={getPostViewCount(actualPost)}>
            <Icon name="eye-outline" size={26} color={COLORS.white} />
          </FeedStatBadge>

          <View style={styles.giftSlot}>
            <GiftSystem
              postId={actualPost.id}
              creatorId={actualPost.uid || actualPost.userId}
              creatorName={displayName}
              triggerVariant="feed"
              giftCoins={Math.max(
                Number(giftCoinsLocal) || 0,
                Number(actualPost?.giftCoins) || 0,
                Number(actualPost?.coinsReceived) || 0,
              )}
              onGiftSent={({ coinSpent }) => {
                const spent = Math.max(0, Math.floor(Number(coinSpent) || 0));
                if (spent <= 0) return;
                setGiftCoinsLocal((prev) => Math.max(0, Number(prev) || 0) + spent);
              }}
            />
          </View>
        </View>
      </Animated.View>

      {/* Comments Modal */}
      <CommentsModal
        visible={commentsVisible}
        onClose={() => setCommentsVisible(false)}
        postId={actualPost.id}
        postData={actualPost}
      />
      <PostReachSheet
        visible={reachSheetVisible}
        onClose={() => setReachSheetVisible(false)}
        post={actualPost}
        isOwner={canDeletePost}
      />
      <VideoFramingSheet
        visible={framingSheetVisible}
        onClose={() => setFramingSheetVisible(false)}
        post={{ ...actualPost, mediaDisplay }}
        videoUri={videoDownloadUrl}
        poster={actualPost.thumbnail || actualPost.imageUrl}
        onSaved={(next) => setMediaDisplay(next)}
      />
      <ReportModal
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
        targetType="post"
        targetId={actualPost?.id}
        targetLabel="this post"
        reportedUserId={String(actualPost?.userId || '').trim() || undefined}
      />

      <Modal
        visible={optionsVisible}
        transparent
        animationType="fade"
        onRequestClose={closeOptions}
      >
        <View style={styles.optionsRoot}>
          <TouchableOpacity style={styles.optionsBackdrop} activeOpacity={1} onPress={closeOptions} />
          <View style={styles.optionsSheet}>
            <View style={styles.optionsHeader}>
              <Text style={styles.optionsTitle}>Post options</Text>
              <TouchableOpacity onPress={closeOptions} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Icon name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            {videoDownloadUrl ? (
              <TouchableOpacity
                style={styles.optionsRow}
                onPress={handleDownloadVideo}
                disabled={downloading}
              >
                <Icon name="download" size={20} color="#fff" />
                <Text style={styles.optionsRowText}>
                  {downloading ? 'Downloading…' : 'Download video'}
                </Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={styles.optionsRow} onPress={runWhySeeing}>
              <Icon name="help-circle-outline" size={20} color="#fff" />
              <Text style={styles.optionsRowText}>Why am I seeing this?</Text>
            </TouchableOpacity>

            {canDeletePost ? (
              <>
                {videoDownloadUrl ? (
                  <TouchableOpacity
                    style={styles.optionsRow}
                    onPress={() => {
                      closeOptions();
                      setFramingSheetVisible(true);
                    }}
                  >
                    <Icon name="crop" size={20} color="#fff" />
                    <Text style={styles.optionsRowText}>Adjust framing</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={styles.optionsRow}
                  onPress={() => {
                    closeOptions();
                    setReachSheetVisible(true);
                  }}
                >
                  <Icon name="stats-chart" size={20} color="#fff" />
                  <Text style={styles.optionsRowText}>Your reach & edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.optionsRow}
                  onPress={async () => {
                    closeOptions();
                    try {
                      const ownerId = String(actualPost?.userId || uid || '').trim();
                      if (!ownerId || !firebaseEnabled || !db || typeof db.collection !== 'function') {
                        Alert.alert('Unavailable', 'Could not load your categories.');
                        return;
                      }
                      const snap = await db.collection('users').doc(ownerId).get();
                      const cats = normalizeProfileCategories(snap?.data?.()?.profileCategories);
                      if (!cats.length) {
                        Alert.alert(
                          'No categories yet',
                          'Open your Profile → Manage under the post shelves to create categories first.',
                        );
                        return;
                      }
                      Alert.alert(
                        'Set category',
                        'Choose a profile shelf for this post',
                        [
                          ...cats.map((c) => ({
                            text: c.label,
                            onPress: async () => {
                              const res = await updatePostCategory(actualPost.id, c.id);
                              if (res?.ok) {
                                Toast.show({
                                  type: 'success',
                                  text1: 'Category updated',
                                  text2: c.label,
                                  position: 'bottom',
                                });
                              } else {
                                Alert.alert('Couldn’t save', 'Please try again.');
                              }
                            },
                          })),
                          {
                            text: 'Clear category',
                            style: 'destructive',
                            onPress: async () => {
                              await updatePostCategory(actualPost.id, null);
                              Toast.show({
                                type: 'success',
                                text1: 'Category cleared',
                                position: 'bottom',
                              });
                            },
                          },
                          { text: 'Cancel', style: 'cancel' },
                        ],
                      );
                    } catch (e) {
                      Alert.alert('Couldn’t load categories', e?.message || 'Please try again.');
                    }
                  }}
                >
                  <Icon name="pricetag" size={20} color="#fff" />
                  <Text style={styles.optionsRowText}>Set category</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.optionsRow}
                  onPress={() => {
                    closeOptions();
                    Alert.alert('Delete post', 'Delete this post permanently?', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                          if (!firebaseEnabled || !db || typeof db.collection !== 'function') {
                            Alert.alert('Error', 'Delete is unavailable right now');
                            return;
                          }
                          try {
                            await db.collection('posts').doc(actualPost.id).delete();
                            Toast.show({
                              type: 'success',
                              text1: 'Deleted',
                              text2: 'Post deleted',
                              position: 'bottom',
                              visibilityTime: 1500,
                            });
                            navigation.goBack();
                          } catch (e) {
                            console.error('Error deleting post:', e);
                            Alert.alert('Error', 'Failed to delete post');
                          }
                        },
                      },
                    ]);
                  }}
                >
                  <Icon name="trash" size={20} color="#FB7185" />
                  <Text style={[styles.optionsRowText, { color: '#FB7185' }]}>Delete</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.optionsRow}
                  onPress={() => {
                    closeOptions();
                    setReportVisible(true);
                  }}
                >
                  <Icon name="flag" size={20} color="#fff" />
                  <Text style={styles.optionsRowText}>Report post</Text>
                </TouchableOpacity>
                {String(actualPost?.userId || '').trim() ? (
                  <TouchableOpacity
                    style={styles.optionsRow}
                    onPress={() => {
                      closeOptions();
                      const author = String(actualPost?.userId || '').trim();
                      Alert.alert(
                        'Block user',
                        'You won’t see their posts, comments or messages, and they won’t be able to message you. You can unblock them from their profile.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Block',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                await blockUser(author);
                                Toast.show({
                                  type: 'success',
                                  text1: 'Blocked',
                                  position: 'bottom',
                                  visibilityTime: 1500,
                                });
                                navigation.goBack();
                              } catch (e) {
                                Alert.alert('Couldn’t block', e?.message || 'Please try again.');
                              }
                            },
                          },
                        ],
                      );
                    }}
                  >
                    <Icon name="ban" size={20} color="#FB7185" />
                    <Text style={[styles.optionsRowText, { color: '#FB7185' }]}>Block this user</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}

            <TouchableOpacity style={[styles.optionsRow, styles.optionsCancel]} onPress={closeOptions}>
              <Text style={styles.optionsCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.pageBackground,
  },
  mediaContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.pageBackground,
  },
  media: {
    // Fill the full-screen media container exactly like the For You feed does
    // (absolute fill + cover). Using fixed Dimensions.get('window') values made
    // the video mismatch the container under a translucent status bar and render
    // zoomed-in. absoluteFill keeps it identical to the feed.
    ...StyleSheet.absoluteFillObject,
  },
  textOnlyMedia: {
    width: screenWidth,
    height: screenHeight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textOnlyGradient: {
    width: '90%',
    height: '70%',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textOnlyEmoji: {
    fontSize: 80,
    marginBottom: 20,
  },
  textOnlyTitle: {
    fontSize: 28,
    color: '#fff',
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  gradientOverlay: {
    // Same full-bleed readability gradient the For You feed uses.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  floatingHeart: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -40,
    marginTop: -40,
    zIndex: 1000,
  },
  pauseIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 90,
  },
  topUI: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 50, // Account for status bar
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 100,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    backdropFilter: 'blur(10px)',
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    backdropFilter: 'blur(10px)',
  },
  optionsRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  optionsBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  optionsSheet: {
    backgroundColor: '#141418',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
  },
  optionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  optionsTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  optionsRowText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  optionsCancel: {
    borderBottomWidth: 0,
    justifyContent: 'center',
    marginTop: 4,
  },
  optionsCancelText: {
    color: COLORS.primary || '#00D2BE',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  // ----- Creator pill in the top row (mirrors For You's userPillTopLeft) -----
  userPillWrap: {
    flex: 1,
    alignItems: 'flex-start',
    marginHorizontal: 10,
  },
  creatorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,12,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
  },
  creatorAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  creatorAvatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorHandle: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 14,
    maxWidth: 140,
  },
  userInfoHighlight: {
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  userPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  userPillName: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
    maxWidth: screenWidth * 0.45,
  },
  userPillAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  userPillAvatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  followBadge: {
    marginLeft: 2,
  },
  followBadgeInner: {
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0A0A0C',
  },
  // ----- "Show details" chip + expanded overlay (mirrors For You) -----
  descriptionInfoChip: {
    position: 'absolute',
    top: 106,
    left: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,12,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.28)',
    zIndex: 1200,
    elevation: 1200,
  },
  descriptionInfoChipText: {
    color: COLORS.electric,
    fontSize: 12,
    fontWeight: '500',
  },
  descriptionOverlayTop: {
    position: 'absolute',
    top: 106,
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(10,10,12,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    zIndex: 1200,
    elevation: 1200,
  },
  detailsTitle: {
    fontWeight: '700',
    fontSize: 16,
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  detailsDescription: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  detailsHashtags: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gradientEnd,
  },
  // ----- Bottom action row (identical to For You's profileMenuBar) -----
  actionRow: {
    position: 'absolute',
    right: 10,
    bottom: 88,
    zIndex: 1000,
    elevation: 1000,
  },
  actionRowInner: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
  },
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
  giftSlot: {
    alignItems: 'center',
    marginHorizontal: 8,
  },
});

// Vertical pager: opens on the tapped post and lets the user swipe down through
// the rest of that creator's videos (TikTok-style), loaded on demand.
const MediaViewerScreen = ({ route, navigation }) => {
  if (!route || !route.params) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
        <Text style={{ color: 'white' }}>Invalid media viewer launch — no media provided.</Text>
      </View>
    );
  }

  const { post, postId, posts } = route.params;
  const { uid } = useAuth();

  const initialPost = post || (posts && postId ? posts.find((p) => p.id === postId) : null);

  useEffect(() => {
    if (!initialPost) navigation.goBack();
  }, [initialPost, navigation]);

  const [pageHeight, setPageHeight] = useState(screenHeight);
  const [activeIndex, setActiveIndex] = useState(0);
  const [creatorVideos, setCreatorVideos] = useState([]);
  // Screen-level set of creators the user follows. Lives here (not per page) so
  // following one of a creator's videos persists as you swipe to their others.
  const [followingSet, setFollowingSet] = useState(() => new Set());

  useEffect(() => {
    if (!uid) { setFollowingSet(new Set()); return undefined; }
    const unsub = subscribeToFollowingList(uid, (set) => setFollowingSet(set || new Set()));
    return () => { try { unsub && unsub(); } catch {} };
  }, [uid]);

  const onToggleFollow = useCallback(
    async (creatorId, wasFollowing) => {
      if (!uid || !creatorId) return;
      // Optimistic: update the shared set immediately; revert if API reports failure.
      setFollowingSet((prev) => {
        const next = new Set(prev);
        if (wasFollowing) next.delete(creatorId);
        else next.add(creatorId);
        return next;
      });
      try {
        const res = wasFollowing
          ? await unfollowUser(uid, creatorId)
          : await followUser(uid, creatorId);
        if (!res?.success) {
          setFollowingSet((prev) => {
            const next = new Set(prev);
            if (wasFollowing) next.add(creatorId);
            else next.delete(creatorId);
            return next;
          });
        }
      } catch {
        setFollowingSet((prev) => {
          const next = new Set(prev);
          if (wasFollowing) next.add(creatorId);
          else next.delete(creatorId);
          return next;
        });
      }
    },
    [uid],
  );

  const ownerIdsFromParams = Array.isArray(route?.params?.ownerIds) ? route.params.ownerIds : [];
  const effectiveOwnerIds = useMemo(
    () => [...ownerIdsFromParams, ...(uid ? [uid] : [])].filter(Boolean),
    [ownerIdsFromParams, uid],
  );

  // Load the rest of this creator's videos so the viewer becomes a vertical feed.
  useEffect(() => {
    let cancelled = false;
    const creatorId = initialPost?.userId || initialPost?.user?.uid;
    // If the caller already supplied an explicit playlist, respect it.
    if (Array.isArray(posts) && posts.length > 1) {
      setCreatorVideos(posts);
      return;
    }
    if (!creatorId || !firebaseEnabled || !db || typeof db.collection !== 'function') {
      return;
    }
    (async () => {
      try {
        // Prefer no orderBy — composite indexes often fail; sort client-side.
        const snap = await db.collection('posts').where('userId', '==', creatorId).limit(80).get();
        const list = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
        const postDateMs = (p) => {
          const raw = p?.date ?? p?.createdAt ?? p?.timestamp ?? 0;
          if (typeof raw?.toMillis === 'function') return raw.toMillis();
          if (typeof raw?.seconds === 'number') return raw.seconds * 1000;
          const n = Number(raw);
          return Number.isFinite(n) ? n : 0;
        };
        list.sort((a, b) => postDateMs(b) - postDateMs(a));
        const videosOnly = list.filter((p) => isVideoPost(p) && p.id !== initialPost.id);
        if (!cancelled) setCreatorVideos(videosOnly);
      } catch (err) {
        console.warn('[MediaViewer] failed to load creator feed', err?.message || err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialPost?.id, initialPost?.userId, posts]);

  // The tapped video is always first; the creator's other videos follow.
  const items = useMemo(() => {
    if (!initialPost) return [];
    if (Array.isArray(posts) && posts.length > 1) return posts;
    const rest = creatorVideos.filter((p) => p.id !== initialPost.id);
    return [initialPost, ...rest];
  }, [initialPost, creatorVideos, posts]);

  const onViewRef = useRef(({ viewableItems }) => {
    if (viewableItems && viewableItems.length > 0) {
      const idx = viewableItems[0].index;
      if (typeof idx === 'number') setActiveIndex(idx);
    }
  });
  const viewConfigRef = useRef({ itemVisiblePercentThreshold: 80 });

  const keyExtractor = useCallback((item, index) => String(item?.id || index), []);

  const renderItem = useCallback(
    ({ item, index }) => (
      <MediaViewerItem
        post={item}
        isActive={index === activeIndex}
        shouldLoadVideo={
          index === activeIndex ||
          index === activeIndex + 1 ||
          index === activeIndex + 2 ||
          index === activeIndex + 3
        }
        pageHeight={pageHeight}
        navigation={navigation}
        effectiveOwnerIds={effectiveOwnerIds}
        followingSet={followingSet}
        onToggleFollow={onToggleFollow}
      />
    ),
    [activeIndex, pageHeight, navigation, effectiveOwnerIds, followingSet, onToggleFollow],
  );

  // Prefetch current + next 3 creator clips so swipe feels instant.
  useEffect(() => {
    const list = items || [];
    [activeIndex, activeIndex + 1, activeIndex + 2, activeIndex + 3].forEach((i) => {
      const post = list[i];
      if (!post) return;
      const uri = fixStorageUrl(post.videoUrl || post.media?.find?.((m) => String(m?.type || '').includes('video'))?.url);
      if (uri) {
        getPlayableVideoUri(uri, { waitForDownload: true }).catch(() => {});
      }
      const poster = post.thumbnail || post.imageUrl;
      if (poster) {
        try {
          Image.prefetch(poster);
        } catch {
          /* ignore */
        }
      }
    });
  }, [activeIndex, items]);

  const getItemLayout = useCallback(
    (_data, index) => ({ length: pageHeight, offset: pageHeight * index, index }),
    [pageHeight],
  );

  if (!initialPost) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
        <ActivityIndicator color={COLORS.gradientEnd} />
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: '#000' }}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h && Math.abs(h - pageHeight) > 1) setPageHeight(h);
      }}
    >
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={pageHeight}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        onViewableItemsChanged={onViewRef.current}
        viewabilityConfig={viewConfigRef.current}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        removeClippedSubviews
      />
    </View>
  );
};

export default MediaViewerScreen;
