import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Animated,
  Alert
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../styles/theme';
import { db, firebaseEnabled, firestore as firestoreInstance } from '../config/firebase';
import { useAuth } from '../hooks/useCommon';
import ReportModal from './ReportModal';
import { inspectText } from '../utils/contentFilter';
import { ensureFirebaseAuthReady } from '../utils/firebaseAuthHelper';
import { doc as webDoc, runTransaction as runWebTransaction } from 'firebase/firestore';
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

function toLikeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

const toMillis = (value) => {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') {
    try {
      return value.toMillis();
    } catch {
      return null;
    }
  }
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const asNum = Number(value);
  return Number.isFinite(asNum) ? asNum : null;
};

const formatTimeAgo = (createdAt) => {
  const ms = toMillis(createdAt);
  if (!ms) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
};

const CommentsModal = ({
  visible,
  onClose,
  postId,
  postData,
  mode,
  comments: externalComments,
  onSendComment,
  onCommentCountChange,
  title,
}) => {
  const isLiveMode = mode === 'live';

  const { uid, authReady, isAuthenticated, getDisplayName } = useAuth();
  const [reportTarget, setReportTarget] = useState(null);

  const likePendingRef = useRef(new Set());
  // Locks a live-chat send while in flight so rapid taps can't post duplicates.
  const liveSendingRef = useRef(false);

  // Cache resolved usernames by userId so comments don't display raw uids.
  const usernameCacheRef = useRef(new Map());
  // Cache resolved avatar URLs by userId so comments without avatar show profile photo.
  const avatarCacheRef = useRef(new Map());
  const myPhotoURLRef = useRef('');
  const [usernameCacheTick, setUsernameCacheTick] = useState(0);
  const [myUserLabel, setMyUserLabel] = useState(null);

  const [newComment, setNewComment] = useState('');
  const [likedComments, setLikedComments] = useState(new Set());
  const [replyingTo, setReplyingTo] = useState(null); // { id, username }

  const [postComments, setPostComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsError, setCommentsError] = useState(null);

  const shouldUseFirestoreComments =
    !isLiveMode &&
    visible &&
    firebaseEnabled &&
    db &&
    typeof db.collection === 'function' &&
    typeof postId === 'string' &&
    postId.trim().length > 0;

  useEffect(() => {
    if (!shouldUseFirestoreComments) {
      setLoadingComments(false);
      setPostComments([]);
      setCommentsError(null);
      return;
    }

    setLoadingComments(true);
    setCommentsError(null);
    let unsub = null;

    try {
      // Ensure Firebase Auth bridge is established (Firestore rules often require request.auth.uid).
      // If this fails, we still keep the modal usable, but reads/writes may be denied.
      (async () => {
        try {
          if (authReady && isAuthenticated && uid) {
            await ensureFirebaseAuthReady({ uid });
          }
        } catch (e) {
          // Non-fatal; snapshot may still work under relaxed rules.
          setCommentsError(String(e?.message || e || 'Unable to establish auth'));
        }
      })();

      unsub = db
        .collection('posts')
        .doc(postId)
        .collection('comments')
        .orderBy('createdAt', 'desc')
        .limit(200)
        .onSnapshot(
          (snapshot) => {
            const next = (snapshot?.docs || []).map((d) => {
              const data = d?.data?.() || {};
              return {
                id: d.id,
                userId: data.userId || data.uid || null,
                username: data.username || data.displayName || 'User',
                avatar: data.avatar || data.photoURL || data.profilePicture || data.userPhoto || data.photoUrl || '',
                text: data.text || '',
                likes: Number(data.likes || 0),
                likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
                parentId: data.parentId || null,
                createdAt: data.createdAt,
                time: formatTimeAgo(data.createdAt),
                // Replies are represented as separate comment docs with parentId.
                replies: [],
              };
            });
            setPostComments((prev) => {
              if (!likePendingRef.current.size) return next;
              return next.map((c) => {
                if (likePendingRef.current.has(c.id)) {
                  const old = prev.find((p) => p?.id === c.id);
                  if (old) {
                    return { ...c, likes: old.likes, likedBy: old.likedBy };
                  }
                }
                return c;
              });
            });
            setLoadingComments(false);
            try {
              onCommentCountChange?.(postId, next.length);
            } catch { }
          },
          (err) => {
            // Keep modal usable even if comments can't be read.
            const msg = String(err?.message || err || 'Unable to load comments');
            setCommentsError(msg);
            setLoadingComments(false);
          }
        );
    } catch {
      setCommentsError('Unable to load comments');
      setLoadingComments(false);
    }

    return () => {
      try {
        unsub?.();
      } catch { }
    };
  }, [postId, shouldUseFirestoreComments, onCommentCountChange]);

  // Keep local likedComments in sync with Firestore docs.
  useEffect(() => {
    if (!visible) return;
    if (isLiveMode) return;
    if (!shouldUseFirestoreComments) return;
    if (!uid) return;

    const next = new Set();
    for (const c of postComments) {
      if (c?.id && Array.isArray(c?.likedBy) && c.likedBy.includes(uid)) {
        next.add(c.id);
      }
    }
    setLikedComments(next);
  }, [visible, isLiveMode, shouldUseFirestoreComments, uid, postComments]);

  // Resolve the current user's label (prefer profile username, else displayName, else auth display name).
  useEffect(() => {
    if (!visible) return;
    if (!firebaseEnabled || !db) return;
    if (!authReady || !isAuthenticated || !uid) return;

    let cancelled = false;
    (async () => {
      try {
        const snap = await db.collection('users').doc(uid).get();
        const data = typeof snap?.data === 'function' ? snap.data() : null;
        const fromProfile = String(data?.username || data?.handle || '').trim();
        const fromDisplay = String(data?.displayName || '').trim();
        const fromAuth = (() => {
          try {
            const n = getDisplayName?.();
            return typeof n === 'string' ? n.trim() : '';
          } catch {
            return '';
          }
        })();

        const label = fromProfile || fromDisplay || fromAuth || '';
        const photoURL = String(data?.photoURL || data?.avatar || data?.profilePicture || '').trim();
        if (!cancelled && photoURL) {
          myPhotoURLRef.current = photoURL;
          avatarCacheRef.current.set(uid, photoURL);
        }
        if (!cancelled && label) {
          setMyUserLabel(label);
          usernameCacheRef.current.set(uid, label);
          setUsernameCacheTick((n) => n + 1);
        }
      } catch {
        // non-fatal
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, firebaseEnabled, db, authReady, isAuthenticated, uid, getDisplayName]);

  // For comments that came in with username == userId (uid), look up the user's profile username.
  useEffect(() => {
    if (!shouldUseFirestoreComments) return;
    if (!firebaseEnabled || !db) return;
    if (!Array.isArray(postComments) || postComments.length === 0) return;

    const needed = Array.from(
      new Set(
        postComments
          .map((c) => String(c?.userId || '').trim())
          .filter((id) => !!id)
          .filter((id) => {
            const comment = postComments.find((c) => String(c?.userId || '').trim() === id);
            const uname = String(comment?.username || '').trim();
            const hasAvatarOnComment = String(
              comment?.avatar || comment?.photoURL || comment?.profilePicture || '',
            ).trim();
            const needsUsername =
              !usernameCacheRef.current.has(id) && (!uname || uname === id);
            const needsAvatar = !hasAvatarOnComment && !avatarCacheRef.current.has(id);
            return needsUsername || needsAvatar;
          })
      )
    );
    if (needed.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const id of needed) {
        if (cancelled) return;
        try {
          const snap = await db.collection('users').doc(id).get();
          const data = typeof snap?.data === 'function' ? snap.data() : null;
          const label = String(data?.username || data?.handle || data?.displayName || '').trim();
          if (label) {
            usernameCacheRef.current.set(id, label);
            if (!cancelled) setUsernameCacheTick((n) => n + 1);
          }
          const avatarUrl = String(data?.avatar || data?.photoURL || data?.profilePicture || data?.userPhoto || data?.photoUrl || '').trim();
          if (avatarUrl) {
            avatarCacheRef.current.set(id, avatarUrl);
            if (!cancelled) setUsernameCacheTick((n) => n + 1);
          }
        } catch {
          // ignore missing/denied
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldUseFirestoreComments, firebaseEnabled, db, postComments, usernameCacheTick]);

  const threadedPostComments = useMemo(() => {
    if (!shouldUseFirestoreComments) return [];
    const byId = new Map();
    const childrenByParent = new Map();

    for (const c of postComments) {
      if (!c?.id) continue;
      byId.set(c.id, c);
    }

    for (const c of postComments) {
      const parentId = String(c?.parentId || '').trim();
      if (!parentId) continue;
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(c);
    }

    const parents = postComments.filter((c) => !String(c?.parentId || '').trim());
    return parents.map((p) => {
      const replies = childrenByParent.get(p.id) || [];
      const repliesSorted = [...replies].sort((a, b) => {
        const am = toMillis(a?.createdAt) || 0;
        const bm = toMillis(b?.createdAt) || 0;
        return am - bm;
      });
      return { ...p, replies: repliesSorted };
    });
  }, [postComments, shouldUseFirestoreComments]);

  const comments = useMemo(() => {
    if (isLiveMode) return Array.isArray(externalComments) ? externalComments : [];
    if (shouldUseFirestoreComments) return threadedPostComments;
    return [];
  }, [externalComments, isLiveMode, threadedPostComments, shouldUseFirestoreComments]);

  const resolveDisplayUsername = useCallback(
    (item) => {
      const raw = String(item?.username || '').trim();
      const userId = String(item?.userId || item?.uid || '').trim();
      if (!raw) {
        return usernameCacheRef.current.get(userId) || 'User';
      }
      if (userId && raw === userId) {
        return usernameCacheRef.current.get(userId) || raw;
      }
      return raw;
    },
    // cache tick triggers recalculation when the cache updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usernameCacheTick]
  );

  const handleSendComment = async () => {
    const raw = String(newComment || '').trim();
    if (!raw) return;

    // Client-side first line of defence (server re-inspects authoritatively).
    const { blocked, clean } = inspectText(raw);
    if (blocked) {
      Alert.alert('Comment not allowed', "That comment contains content that isn't allowed on Blyp.");
      return;
    }
    const text = clean;

    if (isLiveMode) {
      // Guard against double-taps: the network round-trip used to take a few
      // seconds with no feedback, so users tapped Send repeatedly and posted
      // duplicates. Lock while a send is in flight and clear the input
      // immediately so it feels instant (parent inserts an optimistic bubble).
      if (liveSendingRef.current) return;
      liveSendingRef.current = true;
      setNewComment('');
      Keyboard.dismiss();
      try {
        if (typeof onSendComment === 'function') {
          await onSendComment(text);
        }
      } catch (e) {
        // Restore the text so the user can retry; parent handles user-facing errors.
        setNewComment(text);
      } finally {
        liveSendingRef.current = false;
      }
      return;
    }

    // Non-live (feed) comments: persist per post.
    if (shouldUseFirestoreComments) {
      if (!authReady || !isAuthenticated || !uid) {
        Alert.alert('Sign in required', 'Please sign in to add a comment.');
        return;
      }

      try {
        await ensureFirebaseAuthReady({ uid, timeoutMs: 15000 });
      } catch (e) {
        const code = e?.code || e?.name || 'FIREBASE_AUTH_ERROR';
        const msg = e?.message || String(e);
        const status = typeof e?.status === 'number' ? ` (HTTP ${e.status})` : '';
        setCommentsError(String(msg || 'Auth unavailable'));

        // In production-like builds, do not proceed to a Firestore write that we expect to be rejected.
        if (!__DEV__) {
          Alert.alert('Auth Error', `Cannot comment until Firebase auth is ready.\n\n${code}${status}\n${msg}`);
          return;
        }
      }

      const displayName = (() => {
        const label = String(myUserLabel || '').trim();
        if (label) return label;
        try {
          const n = getDisplayName?.();
          return typeof n === 'string' && n.trim() ? n.trim() : 'User';
        } catch {
          return 'User';
        }
      })();

      try {
        await db
          .collection('posts')
          .doc(postId)
          .collection('comments')
          .add({
            userId: uid,
            username: displayName,
            displayName,
            avatar: myPhotoURLRef.current || avatarCacheRef.current.get(uid) || null,
            photoURL: myPhotoURLRef.current || avatarCacheRef.current.get(uid) || null,
            text,
            createdAt: Date.now(),
            likes: 0,
            likedBy: [],
            parentId: replyingTo?.id || null,
          });
        setNewComment('');
        setReplyingTo(null);
        Keyboard.dismiss();
      } catch (e) {
        const rawMsg = String(e?.message || e || 'Failed to send comment');
        const msgLower = rawMsg.toLowerCase();
        setCommentsError(rawMsg);

        // Give a more actionable hint for the common dev failure mode.
        const isPermission =
          msgLower.includes('permission') ||
          msgLower.includes('permission-denied') ||
          msgLower.includes('insufficient permissions');
        const isOffline = msgLower.includes('network') || msgLower.includes('offline');

        if (__DEV__) {
          console.warn('[COMMENTS] Send failed', {
            postId,
            uid,
            message: rawMsg,
            code: e?.code,
          });
        }

        if (isPermission) {
          Alert.alert(
            'Comment failed',
            'Firestore denied the write (permission denied).\n\nMost common causes:\n- Firebase Auth bridge not established (start Functions emulator on 5001 and ensure adb reverse is set)\n- Firestore rules do not allow /posts/{postId}/comments writes (deploy updated firestore.rules)'
          );
          return;
        }
        if (isOffline) {
          Alert.alert('Comment failed', 'Network/offline error while saving your comment.');
          return;
        }

        // Default: show the actual error text in dev to make debugging fast.
        Alert.alert('Comment failed', __DEV__ ? rawMsg : 'Unable to save your comment right now.');
      }
      return;
    }

    Alert.alert('Comments unavailable', 'This post cannot load comments right now. Try again from the feed.');
  };

  const toggleLikeOptimistic = useCallback(
    (commentId) => {
      const isCurrentlyLiked = likedComments.has(commentId);
      const nextLiked = new Set(likedComments);
      if (isCurrentlyLiked) nextLiked.delete(commentId);
      else nextLiked.add(commentId);
      setLikedComments(nextLiked);

      if (shouldUseFirestoreComments) {
        setPostComments((prev) =>
          prev.map((c) => {
            if (c?.id !== commentId) return c;
            const before = Number(c?.likes || 0);
            const delta = isCurrentlyLiked ? -1 : 1;
            const nextLikes = Math.max(0, before + delta);
            const beforeLikedBy = Array.isArray(c?.likedBy) ? c.likedBy : [];
            const nextLikedBy = isCurrentlyLiked
              ? beforeLikedBy.filter((x) => x !== uid)
              : Array.from(new Set([...beforeLikedBy, uid]));
            return { ...c, likes: nextLikes, likedBy: nextLikedBy };
          })
        );
        return;
      }

      setInternalComments((prev) =>
        prev.map((comment) =>
          comment.id === commentId
            ? {
              ...comment,
              likes: nextLiked.has(commentId) ? comment.likes + 1 : Math.max(0, comment.likes - 1),
            }
            : comment
        )
      );
    },
    [likedComments, shouldUseFirestoreComments, uid]
  );

  const runCommentLikeTransaction = useCallback(
    async ({ postId: pid, commentId, userId }) => {
      if (!firebaseEnabled || !firestoreInstance) {
        throw new Error('Firestore is unavailable');
      }

      // Native SDK path: firestoreInstance.collection exists
      if (typeof firestoreInstance?.runTransaction === 'function' && typeof firestoreInstance?.collection === 'function') {
        const ref = firestoreInstance
          .collection('posts')
          .doc(pid)
          .collection('comments')
          .doc(commentId);

        await firestoreInstance.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap?.exists) throw new Error('Comment not found');
          const data = snap.data?.() || {};
          const beforeLikes = toLikeInt(data?.likes);
          const beforeLikedBy = Array.isArray(data?.likedBy) ? data.likedBy : [];
          const beforeLiked = beforeLikedBy.includes(userId);

          const delta = beforeLiked ? -1 : 1;
          const rawNextLikes = beforeLikes + delta;
          const nextLikes = rawNextLikes < 0 ? 0 : rawNextLikes;
          const nextLikedBy = beforeLiked
            ? beforeLikedBy.filter((x) => x !== userId)
            : Array.from(new Set([...beforeLikedBy, userId]));

          tx.update(ref, { likes: nextLikes, likedBy: nextLikedBy });
        });
        return;
      }

      // Web SDK path: use modular runTransaction
      const ref = webDoc(firestoreInstance, 'posts', pid, 'comments', commentId);
      await runWebTransaction(firestoreInstance, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap?.exists?.()) throw new Error('Comment not found');
        const data = snap.data?.() || {};
        const beforeLikes = toLikeInt(data?.likes);
        const beforeLikedBy = Array.isArray(data?.likedBy) ? data.likedBy : [];
        const beforeLiked = beforeLikedBy.includes(userId);

        const delta = beforeLiked ? -1 : 1;
        const rawNextLikes = beforeLikes + delta;
        const nextLikes = rawNextLikes < 0 ? 0 : rawNextLikes;
        const nextLikedBy = beforeLiked
          ? beforeLikedBy.filter((x) => x !== userId)
          : Array.from(new Set([...beforeLikedBy, userId]));

        tx.update(ref, { likes: nextLikes, likedBy: nextLikedBy });
      });
    },
    []
  );

  const handleLikeComment = useCallback(
    async (commentId) => {
      if (isLiveMode) return;
      if (!commentId) return;

      // Firestore-backed comments
      if (shouldUseFirestoreComments) {
        if (!authReady || !isAuthenticated || !uid) {
          Alert.alert('Sign in required', 'Please sign in to like comments.');
          return;
        }

        if (likePendingRef.current.has(commentId)) return;
        likePendingRef.current.add(commentId);

        // optimistic UI update
        toggleLikeOptimistic(commentId);

        try {
          await ensureFirebaseAuthReady({ uid, timeoutMs: 15000 });
          await runCommentLikeTransaction({ postId, commentId, userId: uid });
        } catch (e) {
          // Revert optimistic change and surface error
          toggleLikeOptimistic(commentId);
          const msg = String(e?.message || e || 'Unable to like comment');
          setCommentsError(msg);
          if (__DEV__) console.warn('[COMMENTS] Like failed', { postId, commentId, uid, msg });
        } finally {
          likePendingRef.current.delete(commentId);
        }
        return;
      }

      // Mock/internal comments
      toggleLikeOptimistic(commentId);
    },
    [
      isLiveMode,
      shouldUseFirestoreComments,
      authReady,
      isAuthenticated,
      uid,
      postId,
      toggleLikeOptimistic,
      runCommentLikeTransaction,
    ]
  );

  const handleReplyToComment = useCallback(
    (comment) => {
      if (isLiveMode) return;
      if (!comment?.id) return;
      const label = resolveDisplayUsername(comment);
      setReplyingTo({ id: comment.id, username: label || 'User' });
    },
    [isLiveMode, resolveDisplayUsername]
  );

  // Long-press a comment to report (and optionally block the author). Required
  // for UGC compliance (Google/Apple) — every comment must be reportable.
  const openReportForComment = useCallback((item) => {
    const authorId = String(item?.userId || '').trim();
    if (!authorId || authorId === uid) return; // don't report your own comment
    setReportTarget({
      targetId: String(item?.id || ''),
      reportedUserId: authorId,
      label: 'this comment',
    });
  }, [uid]);

  const renderComment = ({ item }) => {
    const isLiked = likedComments.has(item.id);
    const canReport = String(item?.userId || '').trim() && String(item?.userId || '').trim() !== uid;

    const displayUsername = resolveDisplayUsername(item);

    const avatarUri = typeof item?.avatar === 'string' && item.avatar
      ? item.avatar
      : (typeof item?.photoURL === 'string' && item.photoURL
        ? item.photoURL
        : (avatarCacheRef.current.get(item?.userId) || ''));

    return (
      <TouchableOpacity
        style={styles.commentItem}
        activeOpacity={1}
        onLongPress={canReport ? () => openReportForComment(item) : undefined}
        delayLongPress={350}
      >
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.commentAvatar} />
        ) : (
          <View style={[styles.commentAvatar, styles.commentAvatarPlaceholder]} />
        )}
        <View style={styles.commentContent}>
          <View style={styles.commentHeader}>
            <Text style={styles.commentUsername}>{displayUsername}</Text>
            <Text style={styles.commentTime}>{item.time || ''}</Text>
            {canReport ? (
              <TouchableOpacity
                style={styles.commentReportBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => openReportForComment(item)}
              >
                <Icon name="ellipsis-horizontal" size={16} color="#888" />
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.commentText}>{item.text}</Text>
          {!isLiveMode ? (
            <View style={styles.commentActions}>
              <TouchableOpacity
                style={styles.commentAction}
                onPress={() => handleLikeComment(item.id)}
              >
                <Icon
                  name={isLiked ? "heart" : "heart-outline"}
                  size={16}
                  color={isLiked ? COLORS.gradientEnd : "#666"}
                />
                <Text style={[styles.commentActionText, isLiked && { color: COLORS.gradientEnd }]}>
                  {item.likes}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.commentAction} onPress={() => handleReplyToComment(item)}>
                <Text style={styles.commentActionText}>Reply</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {!isLiveMode && Array.isArray(item?.replies) && item.replies.length > 0 ? (
            <View style={styles.repliesContainer}>
              {item.replies.map((r) => {
                const replyUsername = resolveDisplayUsername(r);
                return (
                  <View key={r.id} style={styles.replyItem}>
                    <Text style={styles.replyHeader}>
                      <Text style={styles.replyUsername}>{replyUsername}</Text>
                      <Text style={styles.replyTime}> {r.time || ''}</Text>
                    </Text>
                    <Text style={styles.replyText}>{r.text}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <>
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={42}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.modalContent, mode === 'live' && styles.modalContentLive]}>
          <LinearGradient colors={['transparent', 'transparent']} style={styles.gradient}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose}>
                <Icon name="close" size={28} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>{title || (isLiveMode ? 'Live Chat' : 'Comments')}</Text>
              <View style={{ width: 28 }} />
            </View>

            {/* Post Summary */}
            {!isLiveMode ? (
              <View style={styles.postSummary}>
                <Image
                  source={{ uri: postData?.user?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face' }}
                  style={styles.postAvatar}
                />
                <View style={styles.postInfo}>
                  <Text style={styles.postUsername}>@{postData?.user?.username || 'creator'}</Text>
                  <Text style={styles.postDescription} numberOfLines={2}>
                    {postData?.description || postData?.caption || 'Amazing content!'}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Comments List */}
            <FlatList
              data={comments}
              renderItem={renderComment}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.commentsList}
            />

            {/* Comment Input */}
            <View style={styles.inputContainer}>
              <Image
                source={{ uri: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face' }}
                style={styles.inputAvatar}
              />
              <View style={styles.inputWrapper}>
                {!isLiveMode && replyingTo?.id ? (
                  <View style={styles.replyingToBar}>
                    <Text style={styles.replyingToText} numberOfLines={1}>
                      Replying to {replyingTo.username}
                    </Text>
                    <TouchableOpacity onPress={() => setReplyingTo(null)}>
                      <Icon name="close" size={16} color="#aaa" />
                    </TouchableOpacity>
                  </View>
                ) : null}
                <TextInput
                  style={styles.commentInput}
                  placeholder={isLiveMode ? 'Say something…' : (replyingTo?.id ? 'Write a reply…' : 'Add a comment...')}
                  placeholderTextColor="#666"
                  value={newComment}
                  onChangeText={setNewComment}
                  multiline
                />
                <TouchableOpacity
                  style={[styles.sendButton, !newComment.trim() && styles.sendButtonDisabled]}
                  onPress={handleSendComment}
                  disabled={!newComment.trim()}
                >
                  <LinearGradient
                    colors={newComment.trim() ? ['#00D2BE', '#00A89E'] : ['#27272E', '#27272E']}
                    style={styles.sendGradient}
                  >
                    <Icon name="send" size={18} color={newComment.trim() ? '#0A0A0C' : '#71717A'} />
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </LinearGradient>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <ReportModal
      visible={!!reportTarget}
      onClose={() => setReportTarget(null)}
      targetType="comment"
      targetId={reportTarget?.targetId}
      reportedUserId={reportTarget?.reportedUserId}
      targetLabel={reportTarget?.label}
    />
    </>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  modalContent: {
    height: screenHeight * 0.7,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(17, 24, 39, 0.68)',
  },
  // Live chat sheet: keep half the screen visible so the sheet never feels like
  // it has taken over the stream.
  modalContentLive: {
    height: screenHeight * 0.5,
  },
  gradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  postSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  postAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  postInfo: {
    flex: 1,
  },
  postUsername: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
  },
  postDescription: {
    fontSize: 12,
    color: '#ccc',
    marginTop: 2,
  },
  commentsList: {
    paddingVertical: 8,
  },
  commentItem: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    marginHorizontal: 8,
    marginVertical: 2,
    borderRadius: 8,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  commentAvatarPlaceholder: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  commentContent: {
    flex: 1,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  commentReportBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 4,
  },
  commentUsername: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
    marginRight: 8,
  },
  commentTime: {
    fontSize: 12,
    color: '#666',
  },
  commentText: {
    fontSize: 14,
    color: '#ccc',
    marginBottom: 8,
  },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  commentAction: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 20,
  },
  commentActionText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
    fontWeight: '600',
  },
  repliesContainer: {
    marginTop: 10,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(255, 255, 255, 0.08)',
  },
  replyItem: {
    paddingVertical: 6,
  },
  replyHeader: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 2,
  },
  replyUsername: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e5e7eb',
  },
  replyTime: {
    fontSize: 11,
    color: '#6b7280',
  },
  replyText: {
    fontSize: 13,
    color: '#d1d5db',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  inputAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 12,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    position: 'relative',
  },
  replyingToBar: {
    position: 'absolute',
    top: -28,
    left: 0,
    right: 0,
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  replyingToText: {
    flex: 1,
    marginRight: 10,
    fontSize: 12,
    color: '#d1d5db',
    fontWeight: '600',
  },
  commentInput: {
    flex: 1,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#fff',
    fontSize: 14,
    maxHeight: 80,
    marginRight: 8,
  },
  sendButton: {
    borderRadius: 18,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default CommentsModal;
