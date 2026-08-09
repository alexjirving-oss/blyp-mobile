import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Image,
  FlatList,
  ActivityIndicator,
  StatusBar,
  Alert,
  Modal,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import ReportModal from '../components/ReportModal';
import { blockUser, unblockUser, isBlockedCached, loadBlockedUsers, filterBlocked } from '../services/BlockService';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, query, where, getDocs, doc, getDoc, orderBy, limit, startAfter, getCountFromServer } from 'firebase/firestore';
import { firestore as db } from '../config/firebase';
import { useIsFocused } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { responsiveFont } from '../utils/scaleUtils';
import ScreenContainer from '../components/ScreenContainer';
import { useAuth } from '../hooks/useCommon';
import { mediaViewerParams } from '../utils/mediaViewerPlaylist';
import ProfileCategoryChips from '../components/ProfileCategoryChips';
import StageView from '../components/stage/StageView';
import {
  buildProfileCategoryChips,
  filterPostsByCategory,
} from '../utils/profileCategories';
import { conversationsMessagingService } from '../services/messaging';
import { ensureFirebaseAuthReady } from '../utils/firebaseAuthHelper';
import useIsAdmin from '../hooks/useIsAdmin';
import { adminBanUser, adminSetAccountFeedPriority, FEED_PRIORITY_TIERS } from '../api/adminLiveApi';
import { buildStageModel } from '../services/stageService';
import { STAGE_CONTENT_MAX } from '../services/stageCatalog';
import { shareProfile } from '../services/shareService';
import { subscribeToLiveStreams } from '../services/LiveService';

const PROFILE_PAGE_SIZE = 30;

const UserProfileScreen = ({ route, navigation }) => {
  const { userId, username } = route?.params || {};
  const { uid: cognitoUid, user: authUser, getDisplayName } = useAuth();
  const { hasPermission } = useIsAdmin();
  const { width: winWidth } = useWindowDimensions();
  const contentWidth = Math.min(winWidth, STAGE_CONTENT_MAX);
  const canAdjustAdminPriority = hasPermission('growth.feed_priority');
  const canBanAsAdmin = hasPermission('users.ban');
  const hasProfileAdminControls = canAdjustAdminPriority || canBanAsAdmin;
  const gridPad = 18;
  const gridGap = 2;
  const postCellWidth = (contentWidth - gridPad * 2 - gridGap * 2) / 3;
  const [stageModel, setStageModel] = useState(null);
  const [topCirclePeople, setTopCirclePeople] = useState([]);
  const [pinnedPosts, setPinnedPosts] = useState([]);
  const [liveStream, setLiveStream] = useState(null);
  const [userPosts, setUserPosts] = useState([]);
  const [postCount, setPostCount] = useState(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [adminControlsVisible, setAdminControlsVisible] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [messagingBusy, setMessagingBusy] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const postsCursorRef = useRef(null);
  const postsHasMoreRef = useRef(true);
  const loadingMorePostsRef = useRef(false);
  const isFocused = useIsFocused();
  const currentUserId = cognitoUid || null;

  const hydrateCircleAndPins = useCallback(async (model) => {
    const circleIds = model?.stage?.topCircle || [];
    const pinIds = model?.stage?.pinnedPostIds || [];
    const people = [];
    for (const id of circleIds) {
      try {
        const snap = await getDoc(doc(db, 'users', id));
        if (!snap.exists()) continue;
        const d = snap.data() || {};
        people.push({
          userId: id,
          username: d.username || d.handle || '',
          displayName: d.displayName || d.username || d.handle || 'User',
          photoURL: d.photoURL || d.avatar || null,
        });
      } catch {
        /* skip */
      }
    }
    setTopCirclePeople(people);

    const pins = [];
    for (const id of pinIds) {
      try {
        const snap = await getDoc(doc(db, 'posts', id));
        if (!snap.exists()) continue;
        pins.push({ id: snap.id, ...snap.data() });
      } catch {
        /* skip */
      }
    }
    setPinnedPosts(pins);
  }, []);

  const fetchUserProfile = useCallback(async () => {
    try {
      const userDocRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userDocRef);
      const userData = userDoc.exists()
        ? userDoc.data()
        : { username: username, displayName: String(username || '').replace('@', '') };
      const model = buildStageModel(userId, userData);
      setStageModel(model);
      await hydrateCircleAndPins(model);

      const { getFollowersCount, getFollowingCount } = require('../utils/followUtils');
      const [followersCount, followingCountVal] = await Promise.all([
        getFollowersCount(userId),
        getFollowingCount(userId),
      ]);
      setFollowerCount(followersCount);
      setFollowingCount(followingCountVal);
    } catch (error) {
      console.error('Error fetching Stage:', error);
      setStageModel(buildStageModel(userId, { username, displayName: String(username || '').replace('@', '') }));
      setFollowerCount(0);
      setFollowingCount(0);
    }
  }, [userId, username, hydrateCircleAndPins]);

  useEffect(() => {
    if (!isFocused) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    fetchUserProfile();
    fetchUserPosts();
    checkFollowStatus();
    loadBlockedUsers().then(() => setBlocked(isBlockedCached(userId))).catch(() => {});
  }, [isFocused, userId]);

  useEffect(() => {
    if (!userId || !isFocused) return undefined;
    const unsub = subscribeToLiveStreams({
      onChange: (streams) => {
        const mine = (streams || []).find(
          (s) => String(s.hostUid || '') === String(userId),
        );
        setLiveStream(mine || null);
      },
      onError: () => setLiveStream(null),
    });
    return () => {
      try { unsub && unsub(); } catch { /* ignore */ }
    };
  }, [userId, isFocused]);

  const handleOpenProfileMenu = useCallback(() => {
    if (!userId || currentUserId === userId) return;
    if (hasProfileAdminControls) {
      setAdminControlsVisible(true);
      return;
    }
    const actions = [
      {
        text: 'Share Stage',
        onPress: () => {
          shareProfile({
            id: userId,
            username: stageModel?.username,
            displayName: stageModel?.displayName,
          });
        },
      },
      {
        text: 'Notifications from this person',
        onPress: () => {
          try {
            navigation.navigate('PersonNotificationSettings', {
              targetUid: userId,
              username: stageModel?.username,
              displayName: stageModel?.displayName,
            });
          } catch {
            /* ignore */
          }
        },
      },
      { text: 'Report user', onPress: () => setReportVisible(true) },
      blocked
        ? {
            text: 'Unblock user',
            onPress: async () => {
              try { await unblockUser(userId); setBlocked(false); Toast.show({ type: 'success', text1: 'Unblocked', position: 'bottom' }); }
              catch (e) { Alert.alert('Could not unblock', e?.message || 'Please try again.'); }
            },
          }
        : {
            text: 'Block user',
            style: 'destructive',
            onPress: () => {
              Alert.alert(
                'Block user',
                'You will not see their posts, comments or messages, and they will not be able to message you. You can unblock them from their Stage.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Block',
                    style: 'destructive',
                    onPress: async () => {
                      try { await blockUser(userId); setBlocked(true); Toast.show({ type: 'success', text1: 'Blocked', position: 'bottom' }); }
                      catch (e) { Alert.alert('Could not block', e?.message || 'Please try again.'); }
                    },
                  },
                ]
              );
            },
          },
    ];
    actions.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(stageModel?.displayName || 'Options', '', actions);
  }, [userId, currentUserId, blocked, stageModel, hasProfileAdminControls, navigation]);

  const confirmAdminAccountPriority = (tier) => {
    setAdminControlsVisible(false);
    Alert.alert(
      'Account feed priority',
      `Set this account to ${tier.label}?\n${tier.hint}\nApplies to all of this creator's posts.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Set ${tier.label}`,
          onPress: async () => {
            try {
              await adminSetAccountFeedPriority(userId, tier.value);
              Toast.show({
                type: 'success',
                text1: 'Account priority updated',
                text2: tier.label,
                position: 'bottom',
                visibilityTime: 1500,
              });
            } catch (e) {
              const code = String(e?.code || '');
              const msg = code === 'ADMIN_NOT_ALLOWLISTED' || code === 'ADMIN_ALLOWLIST_REQUIRED'
                ? 'Your Cognito sub must also be on ADMIN_ALLOWLIST_SUBS.'
                : e?.message || 'Could not update account priority.';
              Alert.alert('Admin action failed', msg);
            }
          },
        },
      ],
    );
  };

  const confirmAdminBan = () => {
    setAdminControlsVisible(false);
    Alert.alert('Ban user (admin)', 'Ban this user platform-wide?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Ban',
        style: 'destructive',
        onPress: async () => {
          try {
            await adminBanUser(userId, { reason: 'Banned from mobile profile admin' });
            Toast.show({ type: 'success', text1: 'User banned', position: 'bottom' });
          } catch (e) {
            Alert.alert('Admin action failed', e?.message || 'Could not ban user.');
          }
        },
      },
    ]);
  };

  const handleAdminBlockToggle = async () => {
    setAdminControlsVisible(false);
    if (blocked) {
      try {
        await unblockUser(userId);
        setBlocked(false);
        Toast.show({ type: 'success', text1: 'Unblocked', position: 'bottom' });
      } catch (e) {
        Alert.alert('Could not unblock', e?.message || 'Please try again.');
      }
      return;
    }
    Alert.alert(
      'Block user',
      'You will not see their posts, comments or messages, and they will not be able to message you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(userId);
              setBlocked(true);
              Toast.show({ type: 'success', text1: 'Blocked', position: 'bottom' });
            } catch (e) {
              Alert.alert('Could not block', e?.message || 'Please try again.');
            }
          },
        },
      ],
    );
  };

  const fetchUserPosts = async () => {
    try {
      postsCursorRef.current = null;
      postsHasMoreRef.current = true;
      const postsQuery = query(
        collection(db, 'posts'),
        where('userId', '==', userId),
        orderBy('date', 'desc'),
        limit(PROFILE_PAGE_SIZE)
      );

      const querySnapshot = await getDocs(postsQuery);
      const docs = querySnapshot.docs || [];
      postsCursorRef.current = docs.length ? docs[docs.length - 1] : null;
      postsHasMoreRef.current = docs.length >= PROFILE_PAGE_SIZE;
      const posts = docs.map(d => ({ id: d.id, ...d.data() }));
      await loadBlockedUsers().catch(() => {});
      setUserPosts(filterBlocked(posts, (p) => p.userId || p.uid));
    } catch (error) {
      console.error('Error fetching user posts:', error);
      setUserPosts([]);
    } finally {
      setLoading(false);
    }

    try {
      const countSnap = await getCountFromServer(
        query(collection(db, 'posts'), where('userId', '==', userId))
      );
      const total = countSnap?.data()?.count;
      if (typeof total === 'number') setPostCount(total);
    } catch {
      setPostCount(null);
    }
  };

  const loadMoreUserPosts = useCallback(async () => {
    if (loadingMorePostsRef.current || !postsHasMoreRef.current) return;
    const cursor = postsCursorRef.current;
    if (!cursor) return;
    loadingMorePostsRef.current = true;
    setLoadingMore(true);
    try {
      const postsQuery = query(
        collection(db, 'posts'),
        where('userId', '==', userId),
        orderBy('date', 'desc'),
        startAfter(cursor),
        limit(PROFILE_PAGE_SIZE)
      );
      const querySnapshot = await getDocs(postsQuery);
      const docs = querySnapshot.docs || [];
      if (docs.length) postsCursorRef.current = docs[docs.length - 1];
      postsHasMoreRef.current = docs.length >= PROFILE_PAGE_SIZE;
      const older = docs.map(d => ({ id: d.id, ...d.data() }));
      if (older.length) {
        await loadBlockedUsers().catch(() => {});
        const visible = filterBlocked(older, (p) => p.userId || p.uid);
        setUserPosts(prev => {
          const have = new Set(prev.map(p => p.id));
          const add = visible.filter(p => !have.has(p.id));
          return add.length ? [...prev, ...add] : prev;
        });
      }
    } catch (error) {
      console.error('Error loading more user posts:', error);
    } finally {
      loadingMorePostsRef.current = false;
      setLoadingMore(false);
    }
  }, [userId]);

  const checkFollowStatus = async () => {
    if (!currentUserId) return;
    try {
      const { isFollowing: checkIsFollowing } = require('../utils/followUtils');
      const followStatus = await checkIsFollowing(currentUserId, userId);
      setIsFollowing(followStatus);
    } catch (error) {
      console.error('Error checking follow status:', error);
    }
  };

  const handleMessage = useCallback(async () => {
    if (!userId || currentUserId === userId) return;
    if (!currentUserId) {
      Alert.alert('Sign in required', 'Please sign in to start a chat.');
      return;
    }
    if (blocked) {
      Alert.alert('User blocked', 'Unblock this user from the Stage menu before messaging them.');
      return;
    }
    if (messagingBusy) return;

    try {
      setMessagingBusy(true);
      if (!__DEV__) {
        try {
          await ensureFirebaseAuthReady({ uid: currentUserId, timeoutMs: 15000 });
        } catch (e) {
          const code = e?.code || e?.name || 'FIREBASE_AUTH_ERROR';
          const msg = e?.message || String(e);
          const status = typeof e?.status === 'number' ? ` (HTTP ${e.status})` : '';
          Alert.alert('Auth Error', `Cannot start chat until Firebase auth is ready.\n\n${code}${status}\n${msg}`);
          return;
        }
      }

      const meName =
        (typeof getDisplayName === 'function' ? getDisplayName() : null) ||
        authUser?.displayName ||
        authUser?.username ||
        authUser?.email ||
        'Unknown';
      const otherName = stageModel?.displayName || stageModel?.username || username || 'Unknown';
      const otherUser = {
        id: userId,
        username: stageModel?.username || username,
        displayName: stageModel?.displayName || otherName,
        photoURL: stageModel?.photoURL || null,
        avatar: stageModel?.photoURL || null,
      };

      const conversationId = await conversationsMessagingService.createOrGetDirectThread(
        db,
        currentUserId,
        userId,
        meName,
        otherName,
      );

      navigation.navigate('ChatConversation', {
        conversationId,
        chatId: conversationId,
        otherUser,
      });
    } catch (error) {
      console.error('Error starting chat from Stage:', error);
      Alert.alert('Error', 'Failed to start chat. Please try again.');
    } finally {
      setMessagingBusy(false);
    }
  }, [
    userId,
    currentUserId,
    blocked,
    messagingBusy,
    getDisplayName,
    authUser,
    stageModel,
    username,
    navigation,
  ]);

  const handleFollowToggle = async () => {
    if (!currentUserId) {
      Toast.show({
        type: 'error',
        text1: 'Please login to follow users',
        position: 'bottom',
      });
      return;
    }

    const wasFollowing = isFollowing;
    try {
      const { followUser, unfollowUser } = require('../utils/followUtils');

      if (wasFollowing) {
        setIsFollowing(false);
        setFollowerCount(prev => Math.max(0, prev - 1));
        const res = await unfollowUser(currentUserId, userId);
        if (!res?.success) throw res?.error || new Error('unfollow failed');
        Toast.show({ type: 'success', text1: `Unfollowed ${username}`, position: 'bottom' });
      } else {
        setIsFollowing(true);
        setFollowerCount(prev => prev + 1);
        const res = await followUser(currentUserId, userId);
        if (!res?.success) throw res?.error || new Error('follow failed');
        Toast.show({ type: 'success', text1: `Following ${username}!`, position: 'bottom' });
      }
    } catch (error) {
      console.error('Error updating follow status:', error);
      setIsFollowing(wasFollowing);
      setFollowerCount(prev => Math.max(0, wasFollowing ? prev + 1 : prev - 1));
      Toast.show({ type: 'error', text1: 'Couldn’t update follow. Please try again.', position: 'bottom' });
    }
  };

  const categoryChips = useMemo(
    () => buildProfileCategoryChips(stageModel?.profileCategories, userPosts),
    [stageModel?.profileCategories, userPosts],
  );

  const filteredPosts = useMemo(
    () => filterPostsByCategory(userPosts, selectedCategoryId),
    [userPosts, selectedCategoryId],
  );

  const handlePostPress = (post) => {
    navigation.navigate('MediaViewer', mediaViewerParams(post, filteredPosts, { source: 'profile' }));
  };

  const formatNumber = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return String(num ?? 0);
  };

  const renderPostItem = ({ item }) => {
    const isVideo = item.type === 'video';
    return (
      <TouchableOpacity
        style={[styles.postItem, { width: postCellWidth }]}
        onPress={() => handlePostPress(item)}
        activeOpacity={0.8}
      >
        {item.thumbnail ? (
          <Image source={{ uri: item.thumbnail }} style={styles.postThumbnail} />
        ) : (
          <View style={[styles.postThumbnail, styles.postThumbnailFallback]}>
            <Icon name="image" size={24} color="#6b7280" />
          </View>
        )}
        {isVideo && (
          <View style={styles.videoIndicator}>
            <Icon name="play" size={16} color="#fff" />
          </View>
        )}
        <View style={styles.postOverlay}>
          <View style={styles.postStats}>
            <View style={styles.postStat}>
              <Icon name="heart" size={13} color="#fff" fill="#fff" strokeWidth={1.5} />
              <Text style={styles.postStatText}>{formatNumber(item.likeCount || item.likes || item.likedBy?.length || 0)}</Text>
            </View>
            <View style={styles.postStat}>
              <Icon name="eye" size={13} color="#fff" fill="#fff" strokeWidth={1.5} />
              <Text style={styles.postStatText}>{formatNumber(item.viewCount || item.views || item.playCount || 0)}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const themeBg = stageModel?.theme?.colors?.bg || '#0A0A0C';
  const isOwn = currentUserId && currentUserId === userId;

  const visitorActions = !isOwn ? (
    <View style={styles.actionButtons}>
      <TouchableOpacity
        style={[styles.followButton, isFollowing && styles.followingButton]}
        onPress={handleFollowToggle}
      >
        <LinearGradient
          colors={isFollowing ? ['#27272E', '#3F3F46'] : ['#00D2BE', '#00A89E']}
          style={styles.followButtonGradient}
        >
          <Text style={[styles.followButtonText, !isFollowing && styles.followButtonTextActive]}>
            {isFollowing ? 'Following' : 'Follow'}
          </Text>
        </LinearGradient>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.messageButton, messagingBusy && { opacity: 0.6 }]}
        onPress={handleMessage}
        disabled={messagingBusy}
        accessibilityLabel="Message user"
        accessibilityRole="button"
      >
        {messagingBusy ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Icon name="chatbubble-outline" size={20} color="#fff" />
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.messageButton}
        onPress={() => {
          shareProfile({
            id: userId,
            username: stageModel?.username,
            displayName: stageModel?.displayName,
          });
        }}
        accessibilityLabel="Share Stage"
        accessibilityRole="button"
      >
        <Icon name="share-outline" size={20} color="#fff" />
      </TouchableOpacity>
    </View>
  ) : (
    <View style={styles.actionButtons}>
      <TouchableOpacity
        style={styles.followButton}
        onPress={() => navigation.navigate('EditStage')}
      >
        <LinearGradient colors={['#00D2BE', '#00A89E']} style={styles.followButtonGradient}>
          <Text style={[styles.followButtonText, styles.followButtonTextActive]}>Edit Stage</Text>
        </LinearGradient>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.messageButton}
        onPress={() => {
          shareProfile({
            id: userId,
            username: stageModel?.username,
            displayName: stageModel?.displayName,
          });
        }}
      >
        <Icon name="share-outline" size={20} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <ScreenContainer>
        <SafeAreaView style={[styles.container, { backgroundColor: themeBg }]}>
          <StatusBar barStyle="light-content" backgroundColor={themeBg} />
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading Stage…</Text>
          </View>
        </SafeAreaView>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <SafeAreaView style={[styles.container, { backgroundColor: themeBg }]}>
        <StatusBar barStyle="light-content" backgroundColor={themeBg} />
        <View style={[styles.foldColumn, { width: contentWidth }]}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
              <Icon name="arrow-back" size={24} color="#ffffff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {stageModel?.displayName || 'Stage'}
            </Text>
            <TouchableOpacity
              style={styles.moreButton}
              onPress={handleOpenProfileMenu}
              disabled={!!isOwn}
            >
              <Icon name="ellipsis-horizontal" size={24} color={isOwn ? 'transparent' : '#ffffff'} />
            </TouchableOpacity>
          </View>

          <ReportModal
            visible={reportVisible}
            onClose={() => setReportVisible(false)}
            targetType="user"
            targetId={userId}
            targetLabel={stageModel?.displayName ? `@${stageModel.username || stageModel.displayName}` : 'this user'}
            reportedUserId={userId}
          />

          <Modal
            visible={adminControlsVisible}
            transparent
            animationType="slide"
            onRequestClose={() => setAdminControlsVisible(false)}
          >
            <View style={styles.adminModalRoot}>
              <TouchableOpacity
                style={styles.adminModalBackdrop}
                activeOpacity={1}
                onPress={() => setAdminControlsVisible(false)}
              />
              <View style={styles.adminSheet}>
                <View style={styles.adminSheetHeader}>
                  <View>
                    <Text style={styles.adminSheetTitle}>Admin controls</Text>
                    <Text style={styles.adminSheetSubtitle} numberOfLines={1}>
                      {stageModel?.displayName || userId}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setAdminControlsVisible(false)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Icon name="close" size={22} color="#fff" />
                  </TouchableOpacity>
                </View>
                <ScrollView
                  style={styles.adminSheetScroll}
                  contentContainerStyle={styles.adminSheetContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {canAdjustAdminPriority ? (
                    <>
                      <Text style={styles.adminSectionLabel}>Account reach</Text>
                      {FEED_PRIORITY_TIERS.map((tier) => (
                        <TouchableOpacity
                          key={tier.value}
                          style={styles.adminRow}
                          onPress={() => confirmAdminAccountPriority(tier)}
                        >
                          <Icon
                            name={tier.value === 'boost' || tier.value === 'high' ? 'arrow-up' : tier.value === 'suppress' || tier.value === 'low' ? 'arrow-down' : 'remove'}
                            size={20}
                            color={tier.value === 'boost' || tier.value === 'high' ? '#5EEAD4' : tier.value === 'suppress' ? '#FB7185' : tier.value === 'low' ? '#FCD34D' : '#fff'}
                          />
                          <View style={styles.adminRowCopy}>
                            <Text style={styles.adminRowText}>{tier.label}</Text>
                            <Text style={styles.adminRowHint}>{tier.hint}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </>
                  ) : null}
                  {canBanAsAdmin ? (
                    <>
                      <Text style={styles.adminSectionLabel}>Moderation</Text>
                      <TouchableOpacity style={styles.adminRow} onPress={confirmAdminBan}>
                        <Icon name="ban" size={20} color="#FB7185" />
                        <Text style={[styles.adminRowText, { color: '#FB7185' }]}>Ban user platform-wide</Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                  <Text style={styles.adminSectionLabel}>User options</Text>
                  <TouchableOpacity
                    style={styles.adminRow}
                    onPress={() => {
                      setAdminControlsVisible(false);
                      shareProfile({
                        id: userId,
                        username: stageModel?.username,
                        displayName: stageModel?.displayName,
                      });
                    }}
                  >
                    <Icon name="share-outline" size={20} color="#fff" />
                    <Text style={styles.adminRowText}>Share Stage</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.adminRow}
                    onPress={() => {
                      setAdminControlsVisible(false);
                      try {
                        navigation.navigate('PersonNotificationSettings', {
                          targetUid: userId,
                          username: stageModel?.username,
                          displayName: stageModel?.displayName,
                        });
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    <Icon name="notifications-outline" size={20} color="#fff" />
                    <Text style={styles.adminRowText}>Notifications from this person</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.adminRow}
                    onPress={() => {
                      setAdminControlsVisible(false);
                      setReportVisible(true);
                    }}
                  >
                    <Icon name="flag" size={20} color="#fff" />
                    <Text style={styles.adminRowText}>Report user</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.adminRow} onPress={handleAdminBlockToggle}>
                    <Icon name={blocked ? 'checkmark-circle' : 'ban'} size={20} color="#FB7185" />
                    <Text style={[styles.adminRowText, { color: '#FB7185' }]}>
                      {blocked ? 'Unblock user' : 'Block user'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.adminRow, styles.adminCancelRow]}
                    onPress={() => setAdminControlsVisible(false)}
                  >
                    <Text style={styles.adminCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </View>
          </Modal>

          {blocked ? (
            <View style={styles.blockedBanner}>
              <Icon name="ban" size={16} color="#FF6B60" />
              <Text style={styles.blockedBannerText}>You’ve blocked this user. Tap the menu to unblock.</Text>
            </View>
          ) : null}

          <FlatList
            key={`stage-grid-${Math.round(contentWidth)}`}
            style={styles.content}
            data={filteredPosts}
            renderItem={renderPostItem}
            keyExtractor={(item) => item.id}
            numColumns={3}
            showsVerticalScrollIndicator={false}
            onEndReached={loadMoreUserPosts}
            onEndReachedThreshold={1}
            initialNumToRender={15}
            contentContainerStyle={styles.postsGrid}
            ListHeaderComponent={(
              <>
                <StageView
                  model={stageModel}
                  mode={isOwn ? 'owner' : 'visitor'}
                  contentWidth={contentWidth}
                  followerCount={followerCount}
                  followingCount={followingCount}
                  postCount={postCount != null ? postCount : userPosts.length}
                  liveStream={liveStream}
                  topCirclePeople={topCirclePeople}
                  pinnedPosts={pinnedPosts}
                  actions={visitorActions}
                  onLivePress={(stream) => {
                    try {
                      navigation.navigate('LiveStreamScreen', {
                        mode: 'viewer',
                        streamId: stream.streamId || stream.id,
                        hostUid: stream.hostUid,
                        source: 'stage',
                      });
                    } catch {
                      /* ignore */
                    }
                  }}
                  onFollowers={() => navigation.navigate('Followers', { userId, type: 'followers' })}
                  onFollowing={() => navigation.navigate('Followers', { userId, type: 'following' })}
                  onPersonPress={(p) => {
                    if (!p?.userId || p.userId === userId) return;
                    navigation.push('UserProfile', {
                      userId: p.userId,
                      username: p.username || p.displayName || '@user',
                    });
                  }}
                  onPostPress={handlePostPress}
                  onEditStage={() => navigation.navigate('EditStage')}
                />

                <View style={{ paddingHorizontal: 18 }}>
                  <ProfileCategoryChips
                    chips={categoryChips}
                    selectedId={selectedCategoryId}
                    onSelect={setSelectedCategoryId}
                  />
                  <Text style={styles.sectionTitle}>Posts</Text>
                </View>
              </>
            )}
            ListEmptyComponent={(
              <View style={styles.emptyPosts}>
                <Icon name="camera-outline" size={48} color="#6b7280" />
                <Text style={styles.loadingText}>
                  {selectedCategoryId === 'all' ? 'No posts yet' : 'Nothing in this category'}
                </Text>
              </View>
            )}
            ListFooterComponent={loadingMore ? (
              <View style={styles.footerLoader}><ActivityIndicator size="small" color="#00D2BE" /></View>
            ) : null}
          />
        </View>
      </SafeAreaView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0C',
    alignItems: 'center',
  },
  foldColumn: {
    flex: 1,
    width: '100%',
    maxWidth: STAGE_CONTENT_MAX,
    alignSelf: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272E',
  },
  backButton: { padding: 8 },
  headerTitle: {
    color: '#ffffff',
    fontSize: responsiveFont(18),
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  moreButton: { padding: 8 },
  adminModalRoot: { flex: 1, justifyContent: 'flex-end' },
  adminModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  adminSheet: {
    maxHeight: '88%',
    backgroundColor: '#141418',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
  },
  adminSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  adminSheetTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  adminSheetSubtitle: { color: '#9ca3af', fontSize: 13, marginTop: 2, maxWidth: 240 },
  adminSheetScroll: { maxHeight: '100%' },
  adminSheetContent: { paddingBottom: 12 },
  adminSectionLabel: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 6,
    marginLeft: 4,
  },
  adminRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  adminRowCopy: { flex: 1 },
  adminRowText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  adminRowHint: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  adminCancelRow: { justifyContent: 'center', marginTop: 8 },
  adminCancelText: { color: '#9ca3af', fontSize: 16, fontWeight: '600', textAlign: 'center', width: '100%' },
  blockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,107,96,0.12)',
  },
  blockedBannerText: { color: '#FF6B60', fontSize: 13, flex: 1 },
  content: { flex: 1 },
  postsGrid: { paddingBottom: 40 },
  postItem: {
    aspectRatio: 1,
    marginBottom: 2,
    padding: 1,
  },
  postThumbnail: { width: '100%', height: '100%', backgroundColor: '#141418' },
  postThumbnailFallback: { alignItems: 'center', justifyContent: 'center' },
  videoIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 6,
  },
  postStats: { flexDirection: 'row', gap: 8 },
  postStat: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  postStatText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  followButton: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  followingButton: {},
  followButtonGradient: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followButtonText: { color: '#9ca3af', fontWeight: '700', fontSize: 15 },
  followButtonTextActive: { color: '#0A0A0C' },
  messageButton: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#27272E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    color: '#F5F5F7',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 10,
  },
  emptyPosts: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  footerLoader: { paddingVertical: 16 },
});

export default UserProfileScreen;
