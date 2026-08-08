import React, { useState, useEffect } from 'react';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { Alert, FlatList, Image, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { firestore as db } from '../config/firebase';
import { subscribeToFollowingList, followUser, unfollowUser } from '../utils/followUtils';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import { conversationsMessagingService } from '../services/messaging';
import { ensureFirebaseAuthReady } from '../utils/firebaseAuthHelper';
import { theme as blypTheme } from '../styles/blypTheme';
import {
  getMembersByClubId,
  resolveClubIdFromQuery,
  userMatchesClubQuery,
} from '../services/clubDiscoveryService';
import { getClubById } from '../services/profileIdentityCatalog';

const withAlpha = (hex, alpha) => {
  const s = String(hex || '').replace('#', '');
  if (s.length !== 6) return hex;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const T = blypTheme.colors;

const FindPeopleScreen = ({ navigation, route }) => {
  const routeClubId = String(route?.params?.clubId || '').trim();
  const routeClubLabel = String(route?.params?.clubLabel || '').trim();
  const initialQuery = String(route?.params?.initialQuery || '').trim();
  const [searchText, setSearchText] = useState(initialQuery);
  const [clubFilterId, setClubFilterId] = useState(routeClubId || null);
  const [clubFilterLabel, setClubFilterLabel] = useState(() => {
    if (routeClubLabel) return routeClubLabel;
    if (routeClubId) {
      const club = getClubById(routeClubId);
      return club?.shortLabel || club?.label || routeClubId;
    }
    return '';
  });
  const [allUsers, setAllUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [recommendedUsers, setRecommendedUsers] = useState([]);
  const [followingUserIds, setFollowingUserIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const { user: authUser, uid } = useAuth();

  useEffect(() => {
    const q = String(route?.params?.initialQuery || '').trim();
    if (q && q !== searchText) setSearchText(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.initialQuery]);

  useEffect(() => {
    const nextClubId = String(route?.params?.clubId || '').trim() || null;
    const nextLabel = String(route?.params?.clubLabel || '').trim();
    setClubFilterId(nextClubId);
    if (nextClubId) {
      const club = getClubById(nextClubId);
      setClubFilterLabel(nextLabel || club?.shortLabel || club?.label || nextClubId);
    } else {
      setClubFilterLabel('');
    }
  }, [route?.params?.clubId, route?.params?.clubLabel]);

  useEffect(() => {
    console.log('ðŸ” FIND PEOPLE: Screen active', { uidPresent: !!uid });
    const unsubscribe = loadUsers();
    return () => unsubscribe?.();
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      console.warn('[FIND PEOPLE] Skipping loadFollowingUsers - no uid');
      setFollowingUserIds(new Set());
      return;
    }
    const unsubscribe = loadFollowingUsers(uid);
    return () => unsubscribe?.();
  }, [uid]);

  useEffect(() => {
    filterUsers();
  }, [searchText, allUsers, clubFilterId]);

  // When opened for a club, seed the list from the membership index so
  // empty following graphs / slow users snapshot still show members.
  useEffect(() => {
    let cancelled = false;
    if (!clubFilterId) return undefined;
    (async () => {
      try {
        const members = await getMembersByClubId(clubFilterId, { limit: 24, excludeUid: uid });
        if (cancelled || !Array.isArray(members)) return;
        setRecommendedUsers(members);
        if (!String(searchText || '').trim()) {
          setFilteredUsers(members.filter((u) => u?.id));
        }
      } catch (e) {
        console.warn('[FIND PEOPLE] club members load failed', e?.message || String(e));
      }
    })();
    return () => { cancelled = true; };
    // searchText intentionally omitted — only seed when club filter changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubFilterId, uid]);

  const loadUsers = () => {
    let unsubscribe = null;
    let cancelled = false;

    const doSubscribe = () => {
      try {
        console.log('ðŸ” FIND PEOPLE: Loading users...');
        console.log('ðŸ” FIND PEOPLE: Current user ID:', uid);

        const usersRef = collection(db, 'users');
        // Remove orderBy to avoid indexing issues, just get all users

        unsubscribe = onSnapshot(usersRef, (snapshot) => {
          if (cancelled) return;
          console.log('ðŸ” FIND PEOPLE: Got Firebase snapshot with', snapshot.docs.length, 'users');

          const usersList = [];
          snapshot.forEach((doc) => {
            const userData = { id: doc.id, ...doc.data() };
            console.log('ðŸ” FIND PEOPLE: Processing user:', userData.id, userData.username || userData.displayName || 'No name');

            // Don't include current user in the list
            if (!uid || userData.id !== uid) {
              usersList.push(userData);
            } else {
              console.log('ðŸ” FIND PEOPLE: Skipping current user');
            }
          });

          console.log('ðŸ” FIND PEOPLE: Final users list:', usersList.length, 'users');
          console.log('ðŸ” FIND PEOPLE: Users details:', usersList.map(u => ({ id: u.id, username: u.username || u.displayName })));

          setAllUsers(usersList);

          // Browse list for empty search (skip overwrite when club filter owns the list)
          if (!clubFilterId) {
            const recommended = usersList.filter((u) => u?.id).slice(0, 10);
            console.log('ðŸ” FIND PEOPLE: Setting recommended users:', recommended.length);
            setRecommendedUsers(recommended);
          }
          setLoading(false);
        }, (error) => {
          console.error('ðŸ” FIND PEOPLE: Snapshot error:', error);
          setLoading(false);
        });
      } catch (error) {
        console.error('ðŸ” FIND PEOPLE: Error loading users:', error);
        setLoading(false);
      }
    };

    // In release, ensure Firebase auth bridge is ready before reading Firestore.
    // Without this, the snapshot will fail with permission-denied because
    // Firestore rules require request.auth != null.
    if (!__DEV__ && uid) {
      console.warn('[FIND_PEOPLE][AUTH] Ensuring Firebase auth before loading users...');
      ensureFirebaseAuthReady({ uid, timeoutMs: 15000 })
        .then(() => {
          console.warn('[FIND_PEOPLE][AUTH] Firebase auth ready, subscribing to users');
          if (!cancelled) doSubscribe();
        })
        .catch((e) => {
          console.error('[FIND_PEOPLE][AUTH] ensureFirebaseAuthReady failed:', e?.code || e?.message);
          // Still try to subscribe — useCommon.js may have already established Firebase auth.
          // Worst case the snapshot will fail with permission-denied (same as not trying).
          console.warn('[FIND_PEOPLE][AUTH] Falling back to doSubscribe despite auth error');
          if (!cancelled) doSubscribe();
        });
    } else {
      doSubscribe();
    }

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  };

  const loadFollowingUsers = (userId) => {
    if (!userId) return () => { };
    const unsubscribe = subscribeToFollowingList(userId, (followingSet) => {
      setFollowingUserIds(followingSet);
    });
    return unsubscribe;
  };

  const filterUsers = () => {
    const q = String(searchText || '').trim();
    const resolvedFromQuery = q ? resolveClubIdFromQuery(q) : null;
    const activeClubId = clubFilterId || resolvedFromQuery;

    if (!q && !clubFilterId) {
      setFilteredUsers([]);
      return;
    }

    const needle = q.toLowerCase();
    const users = Array.isArray(allUsers) ? allUsers : [];
    const filtered = users.filter((user) => {
      if (!user?.id) return false;
      const clubs = Array.isArray(user.profileClubs) ? user.profileClubs : [];
      if (activeClubId && !clubs.includes(activeClubId)) return false;
      if (!q) return true;
      return (
        user.username?.toLowerCase().includes(needle) ||
        user.displayName?.toLowerCase().includes(needle) ||
        user.email?.toLowerCase().includes(needle) ||
        userMatchesClubQuery(user, q)
      );
    });

    setFilteredUsers(filtered);
  };

  const startNewChat = async (otherUser) => {
    try {
      const otherUserId = otherUser?.id || otherUser?.uid || otherUser?.userId;
      console.log('ðŸš€ Starting new chat with:', otherUser?.username, 'from Find People');

      if (!uid) {
        Alert.alert('Sign in required', 'Please sign in to start a chat.');
        return;
      }
      if (!otherUserId) {
        Alert.alert('Unavailable', 'This profile cannot be messaged yet.');
        return;
      }

      if (!__DEV__) {
        try {
          await ensureFirebaseAuthReady({ uid, timeoutMs: 15000 });
        } catch (e) {
          const code = e?.code || e?.name || 'FIREBASE_AUTH_ERROR';
          const msg = e?.message || String(e);
          const status = typeof e?.status === 'number' ? ` (HTTP ${e.status})` : '';
          console.error('[CHAT][AUTH] Firebase auth bridge not ready', { code, msg, status, detail: e?.detail, url: e?.url });
          Alert.alert('Auth Error', `Cannot start chat until Firebase auth is ready.\n\n${code}${status}\n${msg}`);
          return;
        }
      }

      const meName = authUser?.displayName || authUser?.username || authUser?.email || 'Unknown';
      const otherName = otherUser?.username || otherUser?.displayName || otherUser?.email || 'Unknown';
      const conversationId = await conversationsMessagingService.createOrGetDirectThread(db, uid, otherUserId, meName, otherName);
      if (!conversationId) {
        Alert.alert('Error', 'Failed to start new chat');
        return;
      }
      console.log('âœ… Conversation ready with ID:', conversationId);

      navigation.navigate('ChatConversation', {
        conversationId,
        chatId: conversationId,
        otherUser: { ...otherUser, id: otherUserId },
      });
    } catch (error) {
      console.error('Error starting new chat:', error);
      Alert.alert('Error', 'Failed to start new chat');
    }
  };

  const handleFollow = async (userId) => {
    try {
      if (!uid) {
        Alert.alert('Sign in required', 'Please sign in to follow users.');
        return;
      }
      const isFollowing = followingUserIds.has(userId);
      // Optimistic toggle
      setFollowingUserIds((prev) => {
        const next = new Set(prev);
        if (isFollowing) next.delete(userId);
        else next.add(userId);
        return next;
      });
      const res = isFollowing
        ? await unfollowUser(uid, userId)
        : await followUser(uid, userId);
      if (!res?.success) {
        setFollowingUserIds((prev) => {
          const next = new Set(prev);
          if (isFollowing) next.add(userId);
          else next.delete(userId);
          return next;
        });
        const raw = String(res?.error?.message || '');
        const friendly = raw.includes('404') || raw.includes('NOT_FOUND') || /ECONOMY_API/i.test(raw)
          ? 'Follow is temporarily unavailable. Please try again in a moment.'
          : raw.replace(/^\[ECONOMY_API\]\s*/i, '') || 'Please try again.';
        Alert.alert(isFollowing ? 'Couldn’t unfollow' : 'Couldn’t follow', friendly);
        return;
      }
    } catch (error) {
      console.error('Error following user:', error);
      Alert.alert('Error', 'Failed to update follow');
    }
  };

  const renderUserItem = ({ item }) => {
    if (!item?.id) return null;
    const isFollowing = followingUserIds.has(item.id);

    return (
      <View style={styles.userItem}>
        <Image
          source={{ uri: item.photoURL || item.avatar || 'https://via.placeholder.com/50' }}
          style={styles.avatar}
        />
        <View style={styles.userInfo}>
          <Text style={styles.username}>{item.username || item.displayName || 'Unknown'}</Text>
          <Text style={styles.userBio}>{item.bio || item.email || 'No bio available'}</Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.messageButton]}
            onPress={() => startNewChat(item)}
          >
            <Icon name="chatbubble" size={16} color={T.textPrimary} />
            <Text style={styles.actionButtonText}>Message</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.followButton, isFollowing && styles.followingButton]}
            onPress={() => handleFollow(item.id)}
          >
            <Icon name={isFollowing ? 'checkmark' : 'person-add'} size={16} color={isFollowing ? T.textSecondary : T.primary} />
            <Text style={[styles.actionButtonText, { color: isFollowing ? T.textSecondary : T.primary }]}>
              {isFollowing ? 'Following' : 'Follow'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const listEmptySearch = (
    <View style={styles.emptyState}>
      <Icon name="search" size={48} color={T.textDisabled} />
      <Text style={styles.emptyStateText}>No users found</Text>
      <Text style={styles.emptyStateSubtext}>Try a different name or club</Text>
    </View>
  );

  const listEmptyBrowse = loading ? (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>Loading people…</Text>
    </View>
  ) : (
    <View style={styles.emptyState}>
      <Icon name="people-outline" size={48} color={T.textDisabled} />
      <Text style={styles.emptyStateText}>
        {clubFilterId ? 'No members found yet' : 'No one to message yet'}
      </Text>
      <Text style={styles.emptyStateSubtext}>
        {clubFilterId
          ? 'Follow people in this club, or search by name'
          : 'Search for people above — new accounts start with an empty network'}
      </Text>
    </View>
  );

  const showSearchOrClubList = Boolean(String(searchText || '').trim() || clubFilterId);
  const listData = showSearchOrClubList
    ? (Array.isArray(filteredUsers) ? filteredUsers : [])
    : (Array.isArray(recommendedUsers) ? recommendedUsers : []);

  const renderSectionHeader = (title, subtitle) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
        <View style={styles.gradient}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <Icon name="arrow-back" size={24} color={T.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>
              {clubFilterId ? (clubFilterLabel || 'Club') : 'Find People'}
            </Text>
            <View style={styles.headerSpacer} />
          </View>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <View style={styles.searchInputContainer}>
              <Icon name="search" size={20} color={T.textMuted} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder={
                  clubFilterId
                    ? `Search within ${clubFilterLabel || 'club'}...`
                    : 'Search name or club (e.g. Arsenal)...'
                }
                placeholderTextColor={T.textMuted}
                value={searchText}
                onChangeText={setSearchText}
              />
              {String(searchText || '').length > 0 && (
                <TouchableOpacity onPress={() => setSearchText('')}>
                  <Icon name="close-circle" size={20} color={T.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            {clubFilterId ? (
              <TouchableOpacity
                style={styles.clubFilterChip}
                onPress={() => {
                  setClubFilterId(null);
                  setClubFilterLabel('');
                  if (route?.params?.clubId) {
                    navigation.setParams?.({ clubId: undefined, clubLabel: undefined });
                  }
                }}
                accessibilityLabel="Clear club filter"
              >
                <Icon name="football" size={14} color={T.primary} />
                <Text style={styles.clubFilterChipText}>{clubFilterLabel || 'Club'}</Text>
                <Icon name="close" size={14} color={T.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Content */}
          <View style={styles.content}>
            {showSearchOrClubList ? (
              <>
                {renderSectionHeader(
                  clubFilterId && !String(searchText || '').trim()
                    ? `${clubFilterLabel || 'Club'} members (${listData.length})`
                    : `Search Results (${listData.length})`,
                  String(searchText || '').trim()
                    ? `Searching for "${searchText}"`
                    : clubFilterId
                      ? 'People in this club'
                      : ''
                )}
                <FlatList
                  data={listData}
                  renderItem={renderUserItem}
                  keyExtractor={(item, index) => item?.id || `user-${index}`}
                  showsVerticalScrollIndicator={false}
                  ListEmptyComponent={listEmptySearch}
                />
              </>
            ) : (
              <>
                {renderSectionHeader(
                  'Find someone to message',
                  followingUserIds.size === 0
                    ? 'You are not following anyone yet — search by name or club'
                    : 'People you might want to connect with'
                )}
                <FlatList
                  data={listData}
                  renderItem={renderUserItem}
                  keyExtractor={(item, index) => item?.id || `user-${index}`}
                  showsVerticalScrollIndicator={false}
                  ListEmptyComponent={listEmptyBrowse}
                />
              </>
            )}
          </View>
        </View>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: responsiveFont(20),
    fontWeight: 'bold',
    color: T.textPrimary,
  },
  headerSpacer: {
    width: 40,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  clubFilterChip: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: withAlpha(T.primary, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(T.primary, 0.35),
  },
  clubFilterChipText: {
    color: T.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: withAlpha(T.background, 0.8),
    borderRadius: 25,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: T.textPrimary,
    fontSize: 16,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: T.textPrimary,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: T.textMuted,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: withAlpha(T.background, 0.6),
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: T.border,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 15,
  },
  userInfo: {
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: T.textPrimary,
    marginBottom: 4,
  },
  userBio: {
    fontSize: 14,
    color: T.textMuted,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
  },
  messageButton: {
    backgroundColor: T.primary,
  },
  followButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: T.primary,
  },
  followingButton: {
    borderColor: T.textMuted || '#666',
    opacity: 0.9,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: T.textPrimary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: T.textMuted,
    marginTop: 8,
    marginBottom: 4,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: T.textDisabled,
  },
});

export default FindPeopleScreen;


