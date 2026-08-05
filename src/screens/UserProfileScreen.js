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
  Dimensions,
  StatusBar,
  Alert,
} from 'react-native';
import ReportModal from '../components/ReportModal';
import { blockUser, unblockUser, isBlockedCached, loadBlockedUsers, filterBlocked } from '../services/BlockService';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion, arrayRemove, getDoc, orderBy, limit, startAfter, getCountFromServer } from 'firebase/firestore';
import { auth, firestore as db } from '../config/firebase';
import { useIsFocused } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { responsiveFont } from '../utils/scaleUtils';
import ScreenContainer from '../components/ScreenContainer';
import { useAuth } from '../hooks/useCommon';
import { COLORS } from '../styles/theme';
import { mediaViewerParams } from '../utils/mediaViewerPlaylist';
import ProfileCategoryChips from '../components/ProfileCategoryChips';
import {
  buildProfileCategoryChips,
  filterPostsByCategory,
  normalizeProfileCategories,
} from '../utils/profileCategories';
import { conversationsMessagingService } from '../services/messaging';
import { ensureFirebaseAuthReady } from '../utils/firebaseAuthHelper';
import useIsAdmin from '../hooks/useIsAdmin';
import { adminBanUser, adminSetAccountFeedPriority, FEED_PRIORITY_TIERS } from '../api/adminLiveApi';

const { width: screenWidth } = Dimensions.get('window');

const PROFILE_PAGE_SIZE = 30;

const UserProfileScreen = ({ route, navigation }) => {
  // Guard against a missing params object (deep links / malformed navigation),
  // which would otherwise throw on destructure and crash the screen.
  const { userId, username } = route?.params || {};
  const { uid: cognitoUid, user: authUser, getDisplayName } = useAuth();
  const { isAdmin } = useIsAdmin();
  const [userProfile, setUserProfile] = useState(null);
  const [userPosts, setUserPosts] = useState([]);
  const [postCount, setPostCount] = useState(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [messagingBusy, setMessagingBusy] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const postsCursorRef = useRef(null);
  const postsHasMoreRef = useRef(true);
  const loadingMorePostsRef = useRef(false);
  const isFocused = useIsFocused();
  // Source of truth for app login is Cognito uid (Firebase Auth is not guaranteed).
  const currentUserId = cognitoUid || null;

  useEffect(() => {
    if (isFocused) {
      if (!userId) {
        // No target user (malformed navigation / deep link) — stop the spinner
        // and let the render fall through to the empty/not-found state.
        setLoading(false);
        return;
      }
      fetchUserProfile();
      fetchUserPosts();
      checkFollowStatus();
      loadBlockedUsers().then(() => setBlocked(isBlockedCached(userId))).catch(() => {});
    }
  }, [isFocused, userId]);

  const handleOpenProfileMenu = useCallback(() => {
    if (!userId || currentUserId === userId) return;
    const actions = [
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
                'You will not see their posts, comments or messages, and they will not be able to message you. You can unblock them from their profile.',
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
    if (isAdmin) {
      actions.push({
        text: 'Admin · account feed priority',
        onPress: () => {
          Alert.alert(
            'Account feed priority',
            'Set this users For You / discovery weight (all their posts). Combines additively with per-post priority.',
            [
              ...FEED_PRIORITY_TIERS.map((tier) => ({
                text: `${tier.label} (${tier.hint})`,
                onPress: async () => {
                  try {
                    await adminSetAccountFeedPriority(userId, tier.value);
                    Toast.show({ type: 'success', text1: 'Account priority updated', text2: tier.label, position: 'bottom', visibilityTime: 1500 });
                  } catch (e) {
                    const code = String(e?.code || '');
                    const msg = code === 'ADMIN_NOT_ALLOWLISTED' || code === 'ADMIN_ALLOWLIST_REQUIRED'
                      ? 'Your Cognito sub must also be on ADMIN_ALLOWLIST_SUBS.'
                      : e?.message || 'Could not update account priority.';
                    Alert.alert('Admin action failed', msg);
                  }
                },
              })),
              { text: 'Cancel', style: 'cancel' },
            ],
          );
        },
      });
      actions.push({
        text: 'Admin · ban user',
        style: 'destructive',
        onPress: () => {
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
        },
      });
    }
    actions.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(userProfile?.displayName || 'Options', '', actions);
  }, [userId, currentUserId, blocked, userProfile?.displayName, isAdmin]);

  const fetchUserProfile = async () => {
    try {
      // Fetch real user profile from Firebase
      const userDocRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const realProfile = {
          id: userId,
          username: userData.displayName || userData.username || username,
          displayName: userData.displayName || userData.username || username.replace('@', ''),
          bio: userData.bio || `Welcome to ${userData.displayName || username}'s profile! 🎬✨`,
          profileCategories: normalizeProfileCategories(userData.profileCategories),
          avatar: userData.photoURL || userData.avatar || null,
          followers: 0, // Will be loaded separately with follow utils
          following: 0, // Will be loaded separately with follow utils
          verified: userData.verified || false,
        };
        
        setUserProfile(realProfile);
        
        // Load real follower/following counts using follow utils
        const { getFollowersCount, getFollowingCount } = require('../utils/followUtils');
        const followersCount = await getFollowersCount(userId);
        const followingCount = await getFollowingCount(userId);
        
        setFollowerCount(followersCount);
        setFollowingCount(followingCount);
        
      } else {
        // Fallback if user document doesn't exist
        const fallbackProfile = {
          id: userId,
          username: username,
          displayName: username.replace('@', ''),
          bio: `Welcome to ${username}'s profile! 🎬✨`,
          avatar: null, // Let the Image component handle the fallback
          followers: 0,
          following: 0,
          verified: false,
        };
        
        setUserProfile(fallbackProfile);
        setFollowerCount(0);
        setFollowingCount(0);
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
      // Fallback on error
      const errorProfile = {
        id: userId,
        username: username,
        displayName: username.replace('@', ''),
        bio: `Welcome to ${username}'s profile! 🎬✨`,
        avatar: null, // Let the Image component handle the fallback
        followers: 0,
        following: 0,
        verified: false,
      };
      
      setUserProfile(errorProfile);
      setFollowerCount(0);
      setFollowingCount(0);
    }
  };

  // First page of this user's posts (newest first). Older pages load on scroll
  // via loadMoreUserPosts, so every post for the account is reachable.
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
      // Hide admin/report takedowns from public profile grids.
      setUserPosts(filterBlocked(posts, (p) => p.userId || p.uid));
      console.log(`📱 UserProfile: Loaded first ${posts.length} posts for user ${userId}`);
    } catch (error) {
      console.error('Error fetching user posts:', error);
      setUserPosts([]);
    } finally {
      setLoading(false);
    }

    // True total post count (so the stat shows e.g. 136 even before scrolling).
    try {
      const countSnap = await getCountFromServer(
        query(collection(db, 'posts'), where('userId', '==', userId))
      );
      const total = countSnap?.data()?.count;
      if (typeof total === 'number') setPostCount(total);
    } catch {
      setPostCount(null); // fall back to loaded length
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
      // Check real follow status using follow utilities
      const { isFollowing: checkIsFollowing } = require('../utils/followUtils');
      const followStatus = await checkIsFollowing(currentUserId, userId);
      setIsFollowing(followStatus);
    } catch (error) {
      console.error('Error checking follow status:', error);
    }
  };

  const handleMessage = useCallback(async () => {
    // Own-profile actions are already hidden in the UI; keep a hard no-op guard.
    if (!userId || currentUserId === userId) return;

    if (!currentUserId) {
      Alert.alert('Sign in required', 'Please sign in to start a chat.');
      return;
    }

    if (blocked) {
      Alert.alert(
        'User blocked',
        'Unblock this user from the profile menu before messaging them.',
      );
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
          console.error('[CHAT][AUTH] Firebase auth bridge not ready', { code, msg, status, detail: e?.detail, url: e?.url });
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
      const otherName =
        userProfile?.displayName ||
        userProfile?.username ||
        username ||
        'Unknown';
      const otherUser = {
        id: userId,
        username: userProfile?.username || username,
        displayName: userProfile?.displayName || otherName,
        photoURL: userProfile?.avatar || null,
        avatar: userProfile?.avatar || null,
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
      console.error('Error starting chat from profile:', error);
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
    userProfile,
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

    // Optimistic update, then reconcile against the actual write result so a
    // denied/failed write can't leave the UI showing a follow that didn't stick.
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
      // Revert to the real previous state.
      setIsFollowing(wasFollowing);
      setFollowerCount(prev => Math.max(0, wasFollowing ? prev + 1 : prev - 1));
      Toast.show({ type: 'error', text1: 'Couldn’t update follow. Please try again.', position: 'bottom' });
    }
  };

  const categoryChips = useMemo(
    () => buildProfileCategoryChips(userProfile?.profileCategories, userPosts),
    [userProfile?.profileCategories, userPosts],
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
    return num.toString();
  };

  const renderPostItem = ({ item }) => {
    const isVideo = item.type === 'video';
    
    return (
      <TouchableOpacity 
        style={styles.postItem}
        onPress={() => handlePostPress(item)}
        activeOpacity={0.8}
      >
        {item.thumbnail ? (
          <Image source={{ uri: item.thumbnail }} style={styles.postThumbnail} />
        ) : (
          <View style={[styles.postThumbnail, styles.postThumbnailFallback]}>
            <Icon  name="image" size={24} color="#6b7280"  />
          </View>
        )}
        {isVideo && (
          <View style={styles.videoIndicator}>
            <Icon  name="play" size={16} color="#fff"  />
          </View>
        )}
        <View style={styles.postOverlay}>
          <View style={styles.postStats}>
            <View style={styles.postStat}>
              <Icon  name="heart" size={12} color="#fff"  />
              <Text style={styles.postStatText}>{formatNumber(item.likeCount || item.likes || item.likedBy?.length || 0)}</Text>
            </View>
            <View style={styles.postStat}>
              <Icon  name="eye" size={12} color="#fff"  />
              <Text style={styles.postStatText}>{formatNumber(item.viewCount || item.views || item.playCount || 0)}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
    <ScreenContainer>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0A0A0C" />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    </ScreenContainer>
  );
  }

  return (
    <ScreenContainer>
      <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0C" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon  name="arrow-back" size={24} color="#ffffff"  />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{userProfile?.displayName}</Text>
        <TouchableOpacity
          style={styles.moreButton}
          onPress={handleOpenProfileMenu}
          disabled={currentUserId === userId}
        >
          <Icon  name="ellipsis-horizontal" size={24} color={currentUserId === userId ? 'transparent' : '#ffffff'}  />
        </TouchableOpacity>
      </View>
      <ReportModal
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
        targetType="user"
        targetId={userId}
        targetLabel={userProfile?.displayName ? `@${userProfile.displayName}` : 'this user'}
        reportedUserId={userId}
      />
      {blocked ? (
        <View style={styles.blockedBanner}>
          <Icon name="ban" size={16} color="#FF6B60" />
          <Text style={styles.blockedBannerText}>You’ve blocked this user. Tap the menu to unblock.</Text>
        </View>
      ) : null}

      <FlatList
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
            {/* Profile Info */}
            <View style={styles.profileSection}>
              <View style={styles.avatarContainer}>
                {userProfile?.avatar ? (
                  <Image source={{ uri: userProfile.avatar }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Icon  name="person" size={40} color="#6b7280"  />
                  </View>
                )}
                {userProfile?.verified && (
                  <View style={styles.verifiedBadge}>
                    <Icon  name="checkmark" size={12} color="#fff"  />
                  </View>
                )}
              </View>

              <Text style={styles.displayName}>{userProfile?.displayName}</Text>
              <Text style={styles.username}>{userProfile?.username}</Text>

              {userProfile?.bio && (
                <Text style={styles.bio}>{userProfile.bio}</Text>
              )}

              {/* Stats */}
              <View style={styles.statsContainer}>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{postCount != null ? formatNumber(postCount) : userPosts.length}</Text>
                  <Text style={styles.statLabel}>Posts</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{formatNumber(followerCount)}</Text>
                  <Text style={styles.statLabel}>Followers</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{formatNumber(followingCount)}</Text>
                  <Text style={styles.statLabel}>Following</Text>
                </View>
              </View>

              {/* Action Buttons */}
              {currentUserId !== userId && (
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
                </View>
              )}
            </View>

            <ProfileCategoryChips
              chips={categoryChips}
              selectedId={selectedCategoryId}
              onSelect={setSelectedCategoryId}
            />

            {/* Posts Grid */}
            <Text style={[styles.sectionTitle, styles.postsSectionTitle]}>Posts</Text>
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
      </SafeAreaView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0C',
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
  backButton: {
    padding: 8,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: responsiveFont(18),
    fontWeight: '600',
  },
  moreButton: {
    padding: 8,
  },
  blockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,59,48,0.12)',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  blockedBannerText: {
    color: '#FF6B60',
    fontSize: responsiveFont(12),
    fontWeight: '600',
    flexShrink: 1,
  },
  content: {
    flex: 1,
  },
  profileSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: '#00D2BE',
  },
  avatarFallback: {
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#10b981',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#0A0A0C',
  },
  displayName: {
    color: '#ffffff',
    fontSize: responsiveFont(24),
    fontWeight: 'bold',
    marginBottom: 4,
  },
  username: {
    color: '#9ca3af',
    fontSize: 16,
    marginBottom: 12,
  },
  bio: {
    color: '#E4E4E7',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  statsContainer: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 32,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    color: '#ffffff',
    fontSize: responsiveFont(20),
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: 2,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  followButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  followingButton: {
    opacity: 0.8,
  },
  followButtonGradient: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
  followButtonTextActive: {
    color: '#0A0A0C',
    fontWeight: '800',
  },
  messageButton: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  postsSection: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  postsSectionTitle: {
    paddingHorizontal: 20,
  },
  postsGrid: {
    gap: 2,
    paddingHorizontal: 18,
    paddingBottom: 24,
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPosts: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  postItem: {
    width: (screenWidth - 44) / 3,
    aspectRatio: 3/4,
    marginRight: 2,
    marginBottom: 2,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  postThumbnail: {
    width: '100%',
    height: '100%',
  },
  postThumbnailFallback: {
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 4,
  },
  postOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
    padding: 8,
  },
  postStats: {
    flexDirection: 'row',
    gap: 8,
  },
  postStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  postStatText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
  },
});

export default UserProfileScreen;