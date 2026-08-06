import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../Icon';
import GiftSystem from '../GiftSystem';
import CommentsModal from '../CommentsModal';
import { setPostLiked } from '../../services/LikeService';
import { sharePost as sharePostLink } from '../../services/shareService';
import { reportEngagement } from '../../services/blypReachClient';
import { db, firebaseEnabled } from '../../config/firebase';
import { COLORS } from '../../styles/theme';
import { requireAccount } from '../../services/guestSessionService';
import FeedActionBar from './FeedActionBar';
import { FeedActionButton } from './FeedActionButton';

/**
 * Sticky bottom engagement chrome for a single active post (MediaViewer pager).
 * Remounts handlers/state when `post.id` changes; UI itself stays fixed on screen.
 */
const FeedStickyEngagement = forwardRef(function FeedStickyEngagement(
  {
    post,
    bottomOffset = 0,
    uid,
    navigation,
    opacity,
    showExpand = false,
    onExpand,
  },
  ref,
) {
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [giftCoins, setGiftCoins] = useState(0);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const likePendingRef = useRef(false);
  const likeAnimation = useRef(new Animated.Value(1)).current;

  const postId = post?.id ? String(post.id) : null;
  const displayName =
    (typeof post?.user === 'object' && (post.user?.username || post.user?.displayName)) ||
    post?.userDisplayName ||
    post?.username ||
    post?.user ||
    'user';

  useEffect(() => {
    if (!post) return;
    setIsLiked(uid ? !!(post.likedBy?.includes?.(uid)) : false);
    setLikeCount(Number(post.likeCount || post.likes || post.likedBy?.length || 0) || 0);
    setGiftCoins(
      Math.max(Number(post.giftCoins) || 0, Number(post.coinsReceived) || 0),
    );
    const raw = post.commentCount ?? post.commentsCount ?? post.comments;
    if (typeof raw === 'number') setCommentCount(Math.max(0, raw));
    else if (Array.isArray(raw)) setCommentCount(raw.length);
    else setCommentCount(Math.max(0, Number(raw) || 0));
  }, [postId, post, uid]);

  useEffect(() => {
    if (!postId || !firebaseEnabled || !db || typeof db.collection !== 'function') {
      return undefined;
    }
    let cancelled = false;
    let unsub = null;
    try {
      unsub = db.collection('posts').doc(postId).onSnapshot(
        (snap) => {
          if (cancelled || likePendingRef.current) return;
          const data = snap?.data?.() || null;
          if (!data) return;
          const cnt =
            typeof data.likeCount === 'number'
              ? data.likeCount
              : typeof data.likes === 'number'
                ? data.likes
                : Array.isArray(data.likedBy)
                  ? data.likedBy.length
                  : 0;
          setLikeCount(Math.max(0, cnt || 0));
          setIsLiked(uid && Array.isArray(data.likedBy) ? data.likedBy.includes(uid) : false);
          setGiftCoins((prev) =>
            Math.max(
              Number(prev) || 0,
              Number(data.giftCoins) || 0,
              Number(data.coinsReceived) || 0,
            ),
          );
          if (typeof data.commentCount === 'number') {
            setCommentCount(Math.max(0, data.commentCount));
          }
        },
        () => {},
      );
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [postId, uid]);

  const toggleLike = useCallback(async () => {
    if (!postId) return;
    if (!uid) {
      requireAccount?.(navigation, 'like posts');
      return;
    }
    if (likePendingRef.current) return;
    likePendingRef.current = true;
    const wasLiked = isLiked;
    const prevCount = likeCount;
    setIsLiked(!wasLiked);
    setLikeCount(Math.max(0, prevCount + (wasLiked ? -1 : 1)));
    Animated.sequence([
      Animated.timing(likeAnimation, { toValue: 1.18, duration: 90, useNativeDriver: true }),
      Animated.timing(likeAnimation, { toValue: 1, duration: 90, useNativeDriver: true }),
    ]).start();
    try {
      const res = await setPostLiked({ postId, userId: uid });
      if (!res?.ok) throw res?.error || new Error(res?.reason || 'LIKE_FAILED');
      if (typeof res.liked === 'boolean') setIsLiked(res.liked);
      if (Number.isFinite(res.count)) setLikeCount(res.count);
      if (res.liked) reportEngagement?.('like', postId, post?.userId || post?.uid);
    } catch {
      setIsLiked(wasLiked);
      setLikeCount(prevCount);
    } finally {
      likePendingRef.current = false;
    }
  }, [postId, uid, isLiked, likeCount, likeAnimation, navigation, post?.userId, post?.uid]);

  useImperativeHandle(ref, () => ({ toggleLike }), [toggleLike]);

  const handleShare = useCallback(async () => {
    if (!post) return;
    try {
      const ok = await sharePostLink({ ...post, username: displayName });
      if (ok) reportEngagement?.('share', postId, post?.userId || post?.uid);
    } catch {
      /* ignore */
    }
  }, [post, postId, displayName]);

  const handleOpenComments = useCallback(() => {
    if (!postId) return;
    if (requireAccount?.(navigation, 'comment')) return;
    setCommentsVisible(true);
  }, [postId, navigation]);

  if (!post || !postId) return null;

  const bar = (
    <FeedActionBar bottomOffset={bottomOffset}>
      <Animated.View style={{ transform: [{ scale: likeAnimation }] }}>
        <FeedActionButton onPress={toggleLike} active={isLiked} count={likeCount}>
          <Icon name={isLiked ? 'heart' : 'heart-outline'} size={24} color={COLORS.white} />
        </FeedActionButton>
      </Animated.View>

      <FeedActionButton onPress={handleOpenComments} count={commentCount}>
        <Icon name="chatbubble" size={22} color={COLORS.white} />
      </FeedActionButton>

      <FeedActionButton
        onPress={handleShare}
        count={post.shareCount ?? post.sharesCount ?? post.shares ?? 0}
      >
        <Icon name="share" size={22} color={COLORS.white} />
      </FeedActionButton>

      <GiftSystem
        key={`gift-${postId}`}
        postId={postId}
        creatorId={post.uid || post.userId}
        creatorName={displayName}
        triggerVariant="feed"
        giftCoins={giftCoins}
        onGiftSent={({ coinSpent }) => {
          const spent = Math.max(0, Math.floor(Number(coinSpent) || 0));
          if (spent <= 0) return;
          setGiftCoins((prev) => Math.max(0, Number(prev) || 0) + spent);
        }}
      />

      {showExpand ? (
        <TouchableOpacity
          style={styles.expandBtn}
          activeOpacity={0.85}
          onPress={onExpand}
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
      ) : null}
    </FeedActionBar>
  );

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {opacity != null ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="box-none">
          {bar}
        </Animated.View>
      ) : (
        bar
      )}
      <CommentsModal
        visible={commentsVisible}
        onClose={() => setCommentsVisible(false)}
        postId={postId}
        postData={post}
        onCommentCountChange={(id, count) => {
          if (String(id) !== postId) return;
          const n = Number(count);
          if (!Number.isFinite(n)) return;
          setCommentCount(Math.max(0, Math.trunc(n)));
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
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
});

export default FeedStickyEngagement;
