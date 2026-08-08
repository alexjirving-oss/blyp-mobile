import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Platform,
  FlatList,
  SectionList,
  Image,
  Alert,
  Animated,
  PanResponder,
  PixelRatio,
  Dimensions,
  Modal,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import { responsiveFont, responsiveSize, scaleIcon, scalePadding } from '../utils/scaleUtils';
import { collection, query, orderBy, onSnapshot, doc, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp, where, or, and, getDocs, limit } from 'firebase/firestore';
import { firebaseEnabled, firestore as db } from '../config/firebase';
import { subscribeToFollowingList, subscribeToFollowersList, followUser } from '../utils/followUtils';
import { useTabReset } from '../utils/tabResetBus';
import { subscribeTourSelect } from '../tour/tourBus';
import { prefetchUriList, runWhenIdle } from '../utils/mediaPrefetch';
import BlypLogo from '../components/BlypLogo';
import BlypAvatar from '../components/BlypAvatar';
import HeaderMenuTabs from '../components/HeaderMenuTabs';
import HeaderWalletBalances from '../components/HeaderWalletBalances';
import SearchBar from '../components/SearchBar';
import Logger from '../utils/Logger';
import ScreenContainer from '../components/ScreenContainer';
import { useAuth, useToggle, useArray, hardLogout } from '../hooks/useCommon';
import { exitGuestMode } from '../services/guestSessionService';
import unreadCountManager from '../utils/unreadCountManager';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';
import { getEconomyWallet } from '../api/economyLiveApi';
import { shouldUseLiveServiceWallet } from '../utils/walletSource';
import { conversationsMessagingService } from '../services/messaging';
import { loadBlockedUsers, getBlockedSet } from '../services/BlockService';
import { messengerExtrasService } from '../services/messaging/messengerExtrasService';
import { messengerUsersService } from '../services/messaging/messengerUsersService';
import { fetchMessengerUserProfile, resolveUserPhoto } from '../services/messaging/resolveMessengerUser';
import { subscribeNotifications, markNotificationRead } from '../services/notificationsInboxService';
import { getLocalWelcomeTourItem, consumeLocalWelcomeTourItem, LOCAL_WELCOME_TOUR_ID } from '../tour/welcomeTourInbox';
import { requestStartTour, isTourPayload } from '../tour/tourBus';
import { ensureFirebaseAuthReady } from '../utils/firebaseAuthHelper';
import { theme as blypTheme } from '../styles/blypTheme';
import HeaderContainer, { HEADER_ICON_COLOR } from '../components/HeaderContainer';
import BlypHeaderFlow from '../components/BlypHeaderFlow';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';

const withAlpha = (hex, alpha) => {
  const s = String(hex || '').replace('#', '');
  if (s.length !== 6) return hex;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const T = blypTheme.colors;
const DATING_ACCENT = '#E83E5A';

const ChatRow = React.memo(({
  item,
  otherParticipant,
  unreadCount,
  datingContext,
  timeLabel,
  onOpen,
  onDelete,
}) => {
  const panX = React.useRef(new Animated.Value(0)).current;
  const panResponder = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dx) > 20 && Math.abs(gesture.dy) < 40,
    onPanResponderMove: (_event, gesture) => {
      if (gesture.dx < 0) panX.setValue(Math.max(-110, gesture.dx));
    },
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx < -90) onDelete(item, otherParticipant);
      Animated.spring(panX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 24,
        bounciness: 4,
      }).start();
    },
  }), [item, onDelete, otherParticipant, panX]);
  const handleOpen = React.useCallback(
    () => onOpen(item, otherParticipant, datingContext),
    [datingContext, item, onOpen, otherParticipant],
  );
  const hasUnread = unreadCount > 0;
  const accent = datingContext ? DATING_ACCENT : T.success;

  return (
    <View style={styles.chatItemWrapper}>
      <View style={styles.deleteBackground}>
        <Icon name="trash" size={22} color={T.textPrimary} />
        <Text style={styles.deleteText}>Delete</Text>
      </View>
      <Animated.View
        style={[styles.swipeableItem, { transform: [{ translateX: panX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={[styles.whatsappChatItem, hasUnread && { backgroundColor: withAlpha(accent, 0.09) }]}
          onPress={handleOpen}
          activeOpacity={0.72}
        >
          <View style={styles.avatarContainer}>
            <BlypAvatar
              uri={resolveUserPhoto(otherParticipant)}
              name={otherParticipant.username || otherParticipant.displayName}
              profile={otherParticipant}
              size={50}
              showBadge={false}
              style={hasUnread ? { borderRadius: 25, borderWidth: 2, borderColor: accent } : undefined}
            />
            {hasUnread ? <View style={[styles.unreadIndicator, { backgroundColor: accent }]} /> : null}
          </View>
          <View style={styles.chatContent}>
            <View style={styles.chatHeader}>
              <View style={styles.chatTitleRow}>
                <Text style={[styles.chatName, hasUnread && { color: accent, fontWeight: '800' }]} numberOfLines={1}>
                  {otherParticipant.username || otherParticipant.displayName || 'Unknown User'}
                </Text>
                {datingContext ? (
                  <View style={styles.datingThreadBadge}>
                    <Icon name="heart" size={9} color="#FFD8DF" />
                    <Text style={styles.datingThreadBadgeText}>Dating</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.chatTime, hasUnread && { color: accent, fontWeight: '700' }]}>
                {timeLabel}
              </Text>
            </View>
            <View style={styles.messagePreview}>
              <Text style={[styles.lastMessage, hasUnread && { color: T.textSecondary, fontWeight: '600' }]} numberOfLines={1}>
                {item.lastMessage || 'No messages yet'}
              </Text>
              {hasUnread ? (
                <View style={[styles.unreadBadge, { backgroundColor: accent }]}>
                  <Text style={styles.unreadCount}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
});

// Resolve a user's profile photo across the various field names used in the
// codebase (canonical is photoURL; older docs use avatar/userPhotoURL/photo).
// Re-exported from resolveMessengerUser for backwards compatibility in this file.

const MessengerScreen = ({ navigation }) => {
  // If Firebase is disabled (stub mode), show a friendly message and skip all listeners
  if (!firebaseEnabled) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: T.headerBackground, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <BlypLogo useGradientBackground={false} />
        <Text style={{ color: T.textMuted, marginTop: 12, textAlign: 'center' }}>
          Messaging is temporarily unavailable in this build.
        </Text>
        <Text style={{ color: T.textDisabled, marginTop: 6, textAlign: 'center', fontSize: 12 }}>
          Enable Firebase to use chats and live users.
        </Text>
      </SafeAreaView>
    );
  }

  // Get screen dimensions
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

  // State management with improved patterns
  const [selectedTab, setSelectedTab] = useState('chats');
  // Double-tap the Inbox tab → reset to the first sub-page ("Chats").
  useTabReset('Messenger', () => setSelectedTab('chats'));

  useEffect(() => {
    return subscribeTourSelect((payload) => {
      if (payload?.screen !== 'Messenger' || !payload?.tab) return;
      setSelectedTab(payload.tab);
    });
  }, []);

  const [chats, setChats] = useState([]);
  const [participantProfiles, setParticipantProfiles] = useState({});
  const [calls, setCalls] = useState([]);
  const [callsLoading, setCallsLoading] = useState(true);
  const [callsError, setCallsError] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [followingUsers, setFollowingUsers] = useState([]);
  const [followingUserIds, setFollowingUserIds] = useState(new Set());
  const [followerUserIds, setFollowerUserIds] = useState(new Set());
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [menuVisible, setMenuVisible] = useState(false);
  const [coinBalance, setCoinBalance] = useState(0);
  const [gemBalance, setGemBalance] = useState(0);

  // Use proper authentication state management
  const { user: currentUser, uid, isAuthenticated, authReady, loading: authLoading } = useAuth();

  const tabBarHeight = useBottomTabBarHeight();
  const [headerHeight, setHeaderHeight] = useState(0);

  // Debug authentication state
  useEffect(() => {
    console.log('ðŸ” MESSENGER AUTH STATE:', {
      uid,
      isAuthenticated,
      authReady,
      authLoading,
      hasUser: !!currentUser,
      displayName: currentUser?.displayName,
      email: currentUser?.email
    });
  }, [uid, isAuthenticated, authReady, authLoading, currentUser?.displayName, currentUser?.email]);

  // Calculate total unread messages + inbox notifications (memoized to prevent infinite loops)
  const totalUnreadCount = React.useMemo(() => {
    if (!uid) return 0;
    const chatUnread = chats.reduce((total, chat) => {
      const unreadCount = chat.unreadCount?.[uid] || 0;
      return total + unreadCount;
    }, 0);
    const notifUnread = (notifications || []).filter((n) => n && n.status !== 'read').length;
    return chatUnread + notifUnread;
  }, [chats, notifications, uid]);

  // Define callback functions BEFORE the useEffect that uses them
  const loadBalances = React.useCallback(async () => {
    if (!uid) {
      console.warn('[MESSENGER] Skipping loadBalances - no uid', { authReady, isAuthenticated, uidPresent: !!uid });
      return;
    }
    try {
      if (shouldUseLiveServiceWallet()) {
        if (!authReady || !isAuthenticated) {
          return;
        }

        const wallet = await getEconomyWallet();
        const coins = Number(wallet?.coinBalance || 0) + Number(wallet?.bonusCoinBalance || 0);
        const gems = Number(wallet?.gemAvailable || 0) + Number(wallet?.gemPending || 0);
        setCoinBalance(Number.isFinite(coins) ? coins : 0);
        setGemBalance(Number.isFinite(gems) ? gems : 0);
        return;
      }

      const coins = await BlypCoinService.getUserBalance(uid);
      const gems = await GemService.getUserGems(uid);
      setCoinBalance(Number.isFinite(coins) ? coins : 0);
      setGemBalance(Number.isFinite(gems) ? gems : 0);
    } catch (error) {
      const msg = String(error?.message || error || '');
      console.warn('[MESSENGER][BALANCES] loadBalances failed:', msg);
    }
  }, [uid, authReady, isAuthenticated]);

  useEffect(() => {
    if (!uid || !chats.length) return undefined;
    let cancelled = false;
    (async () => {
      const missingIds = [...new Set(
        chats
          .map((chat) => chat.participants?.find((id) => id !== uid))
          .filter((id) => id && !participantProfiles[id]),
      )];
      const resolved = await Promise.all(
        missingIds.map(async (id) => [id, await fetchMessengerUserProfile(id)]),
      );
      const updates = Object.fromEntries(resolved.filter(([, profile]) => profile));
      if (!cancelled && Object.keys(updates).length) {
        setParticipantProfiles((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chats, uid, participantProfiles]);

  const allUsersById = React.useMemo(
    () => new Map(allUsers.map((profile) => [profile.id, profile])),
    [allUsers],
  );

  const resolveOtherParticipant = React.useCallback((item) => {
    const otherId = item.participants?.find((id) => id !== uid);
    if (!otherId) return null;
    const known = allUsersById.get(otherId);
    if (known) return known;
    if (participantProfiles[otherId]) return participantProfiles[otherId];
    return {
      id: otherId,
      username: item.participantNames?.find((name) => name !== currentUser?.displayName) || 'Unknown User',
    };
  }, [allUsersById, participantProfiles, uid, currentUser]);

  const loadChats = React.useCallback(() => {
    if (!uid) {
      console.warn('[MESSENGER] Skipping loadChats - no uid', { authReady, isAuthenticated, uidPresent: !!uid });
      return () => { };
    }

    try {
      console.log('ðŸ“¥ MESSENGER: Loading conversations for user:', uid);
      // Warm the block cache so blocked conversations are filtered on first snapshot.
      loadBlockedUsers().catch(() => {});
      return conversationsMessagingService.subscribeToThreads(
        db,
        uid,
        (threads) => {
          // Hide conversations with users you've blocked.
          const blocked = getBlockedSet();
          const visible = blocked.size
            ? (threads || []).filter((t) => {
                const other = (t?.participants || []).find((id) => id !== uid);
                return !other || !blocked.has(other);
              })
            : threads;
          setChats(visible);
          setLoading(false);
          Logger.firebase('Loaded conversations', { count: visible.length });
          // Warm chat avatars after first paint so Inbox scroll stays fluent.
          runWhenIdle(() => {
            const avatars = (visible || []).flatMap((t) => {
              const names = t?.participantPhotos || t?.participantAvatars || [];
              const single = t?.otherPhotoURL || t?.photoURL || t?.avatar;
              return [...(Array.isArray(names) ? names : []), single].filter(Boolean);
            });
            prefetchUriList(avatars, { idle: false });
          });
        },
        (error) => {
          const msg = String(error?.message || error || '');
          const code = String(error?.code || '');
          const isIndex = code === 'failed-precondition' || msg.toLowerCase().includes('requires an index') || msg.toLowerCase().includes('index');
          const isPermission = code === 'permission-denied' || msg.toLowerCase().includes('missing or insufficient permissions');

          if (isIndex || isPermission) {
            console.warn('[MESSENGER] Conversations unavailable:', { code, msg });
            setLoading(false);
            // Avoid Alert + LogBox spam for expected config/rules issues.
            return;
          }

          console.error('âŒ MESSENGER: Error loading conversations:', error);
          setLoading(false);
          Alert.alert('Error', 'Failed to load chats. Please check your connection.');
        },
      );
    } catch (error) {
      console.error('âŒ MESSENGER: Error setting up chat listener:', error);
      setLoading(false);
      return () => { };
    }
  }, [uid, authReady, isAuthenticated]);

  const loadCalls = React.useCallback(() => {
    if (!uid) {
      console.warn('[MESSENGER] Skipping loadCalls - no uid', { authReady, isAuthenticated, uidPresent: !!uid });
      setCalls([]);
      setCallsLoading(false);
      return () => { };
    }

    setCallsLoading(true);
    setCallsError(null);
    try {
      return messengerExtrasService.subscribeToCalls(
        db,
        uid,
        (next) => {
          setCalls(next);
          setCallsLoading(false);
        },
        (error) => {
          const msg = String(error?.message || error || '');
          const code = String(error?.code || '');
          const isPermission = code === 'permission-denied' || msg.toLowerCase().includes('missing or insufficient permissions');

          if (isPermission) {
            console.warn('[MESSENGER] Calls unavailable:', { code, msg });
            setCalls([]);
            setCallsLoading(false);
            setCallsError(null);
            return;
          }

          console.error('âŒ MESSENGER: Error loading calls:', error);
          setCalls([]);
          setCallsLoading(false);
          setCallsError(error);
        },
      );
    } catch (error) {
      console.error('âŒ MESSENGER: Error setting up calls listener:', error);
      setCalls([]);
      setCallsLoading(false);
      setCallsError(error);
      return () => { };
    }
  }, [uid, authReady, isAuthenticated]);

  const loadStatuses = React.useCallback(() => {
    if (!uid) {
      console.warn('[MESSENGER] Skipping loadStatuses - no uid', { authReady, isAuthenticated, uidPresent: !!uid });
      setStatuses([]);
      setStatusLoading(false);
      return () => { };
    }

    setStatusLoading(true);
    setStatusError(null);
    try {
      return messengerExtrasService.subscribeToRecentStatuses(
        db,
        (raw) => {
          const now = Date.now();
          const next = raw.filter((s) => {
            const expiresAt = s.expiresAt;
            const expMs = typeof expiresAt?.toMillis === 'function' ? expiresAt.toMillis() : (typeof expiresAt === 'number' ? expiresAt : 0);
            if (!expMs) return true;
            return expMs > now;
          });
          setStatuses(next);
          setStatusLoading(false);
        },
        (error) => {
          const msg = String(error?.message || error || '');
          const code = String(error?.code || '');
          const isPermission = code === 'permission-denied' || msg.toLowerCase().includes('missing or insufficient permissions');

          if (isPermission) {
            console.warn('[MESSENGER] Statuses unavailable:', { code, msg });
            setStatuses([]);
            setStatusLoading(false);
            setStatusError(null);
            return;
          }

          console.error('âŒ MESSENGER: Error loading statuses:', error);
          setStatuses([]);
          setStatusLoading(false);
          setStatusError(error);
        },
      );
    } catch (error) {
      console.error('âŒ MESSENGER: Error setting up status listener:', error);
      setStatuses([]);
      setStatusLoading(false);
      setStatusError(error);
      return () => { };
    }
  }, [uid, authReady, isAuthenticated]);

  const loadFollowingUsers = React.useCallback(() => {
    if (!uid) {
      console.warn('[MESSENGER] Skipping loadFollowingUsers - no uid', { authReady, isAuthenticated, uidPresent: !!uid });
      return () => { };
    }

    // Subscribe to the list of users the current user is following
    const unsubscribe = subscribeToFollowingList(uid, (followingSet) => {
      console.log('ðŸ”„ MESSENGER: Received following list update with', followingSet.size, 'users');
      setFollowingUserIds(followingSet);

      if (followingSet.size === 0) {
        setFollowingUsers([]);
      }
    });

    // Subscribe to who follows the current user, so we can detect mutual follows.
    const unsubscribeFollowers = subscribeToFollowersList(uid, (followersSet) => {
      setFollowerUserIds(followersSet);
    });

    // Subscribe to the durable notification inbox (team requests, battles, etc.).
    const unsubscribeNotifs = subscribeNotifications(uid, (items) => {
      const mergeLocal = async () => {
        let merged = Array.isArray(items) ? [...items] : [];
        try {
          const local = await getLocalWelcomeTourItem(uid);
          if (local) {
            const hasServerTour = merged.some(
              (n) =>
                isTourPayload(n?.data) ||
                String(n?.dedupeKey || '').startsWith('welcome_tour:')
            );
            if (!hasServerTour) {
              merged = [local, ...merged];
            }
          }
        } catch {
          /* ignore */
        }
        setNotifications(merged);
        setNotifLoading(false);
      };
      mergeLocal();
    });

    return () => {
      try { unsubscribe && unsubscribe(); } catch {}
      try { unsubscribeFollowers && unsubscribeFollowers(); } catch {}
      try { unsubscribeNotifs && unsubscribeNotifs(); } catch {}
    };
  }, [uid, authReady, isAuthenticated]);

  const loadAllUsers = React.useCallback(() => {
    if (!uid) {
      console.warn('[MESSENGER] Skipping loadAllUsers - no uid', { authReady, isAuthenticated, uidPresent: !!uid });
      return () => { };
    }
    try {
      // Subscribe to all users for the "People you may know" section
      console.log('ðŸ‘¥ MESSENGER: Loading all users for current user:', uid);
      Logger.firebase('Loading all users for current user', { userId: uid });

      return messengerUsersService.subscribeToAllUsers(
        db,
        uid,
        (users) => {
          setAllUsers(users);
          Logger.firebase('Retrieved users from Firebase', {
            userCount: users.length,
          });
        },
        (error) => {
          console.error('âŒ MESSENGER: Error loading users:', error);
          // Don't show alert for users loading error, just log it
        },
      );
    } catch (error) {
      console.error('âŒ MESSENGER: Error setting up users listener:', error);
      return () => { };
    }
  }, [uid, authReady, isAuthenticated]);

  // Main effect to load data when auth is ready
  useEffect(() => {
    // Block until auth system is ready and user is authenticated
    if (!authReady || authLoading || !isAuthenticated || !uid) {
      console.log('â³ MESSENGER: Waiting for authentication...', { authReady, authLoading, isAuthenticated, uidPresent: !!uid });
      return;
    }

    let cancelled = false;
    const subs = [];

    const doLoad = () => {
      if (cancelled) return;
      console.log('ðŸš€ MESSENGER: Loading chat data for user:', uid);

      // Keep the inbox hot; expensive secondary feeds are subscribed lazily by tab.
      subs.push(loadChats());
      subs.push(loadFollowingUsers());
      // Calls tab is Coming Soon — skip live call history subscription.
      setCalls([]);
      setCallsLoading(false);
      setCallsError(null);
      loadBalances();
    };

    // In release, ensure Firebase auth bridge is ready before reading Firestore.
    // Without this, Firestore snapshots fail with permission-denied because
    // rules require request.auth != null.
    if (!__DEV__) {
      console.warn('[MESSENGER][AUTH] Ensuring Firebase auth before loading data...');
      ensureFirebaseAuthReady({ uid, timeoutMs: 15000 })
        .then(() => {
          console.warn('[MESSENGER][AUTH] Firebase auth ready, loading data');
          doLoad();
        })
        .catch((e) => {
          console.error('[MESSENGER][AUTH] Firebase auth not ready, loading anyway (may fail):', e?.code || e?.message);
          doLoad();
        });
    } else {
      doLoad();
    }

    return () => {
      cancelled = true;
      console.log('ðŸ§¹ MESSENGER: Cleaning up Firebase listeners');
      subs.forEach((unsub) => { if (typeof unsub === 'function') unsub(); });
    };
  }, [authReady, authLoading, isAuthenticated, uid, loadChats, loadFollowingUsers, loadBalances]);

  useEffect(() => {
    if (!authReady || !isAuthenticated || !uid || selectedTab !== 'status') return undefined;
    const unsubscribeUsers = loadAllUsers();
    const unsubscribeStatuses = loadStatuses();
    return () => {
      try { unsubscribeUsers?.(); } catch {}
      try { unsubscribeStatuses?.(); } catch {}
    };
  }, [authReady, isAuthenticated, uid, selectedTab, loadAllUsers, loadStatuses]);

  // Update unread count manager when total count changes
  useEffect(() => {
    unreadCountManager.setUnreadCount(totalUnreadCount);
    console.log('ðŸ“Š MESSENGER: Unread count updated:', totalUnreadCount);

    // No cleanup needed for this effect since it's just updating a value
  }, [totalUnreadCount]);

  // Update filtered users when following list changes
  useEffect(() => {
    console.log('ðŸ”¥ MESSENGER: Filtering users - allUsers:', allUsers.length, 'followingIds:', followingUserIds.size);
    if (allUsers.length > 0 && uid) {
      // TEMPORARILY SHOW ALL USERS (ignoring following status for testing)
      const filteredUsers = allUsers.filter(user =>
        user.id !== uid
      );
      Logger.firebase('Filtered users for display', {
        filteredCount: filteredUsers.length,
        users: filteredUsers.map(u => ({ id: u.id, username: u.username }))
      });
    }
  }, [followingUserIds, allUsers, uid]);

  // Separate effect to fetch user data when followingUserIds changes
  useEffect(() => {
    if (!followingUserIds || followingUserIds.size === 0) return;

    console.log('ðŸ”„ MESSENGER: Fetching data for', followingUserIds.size, 'following users');

    const fetchFollowingUserData = async () => {
      try {
        const followingUsersData = await Promise.all(Array.from(followingUserIds).map(async (userId) => {
          try {
            const userDoc = await getDoc(doc(db, 'users', userId));
            if (userDoc.exists()) {
              return {
                id: userDoc.id,
                ...userDoc.data()
              };
            }
          } catch (error) {
            console.error('Error fetching individual user data:', error);
          }
          return null;
        }));

        setFollowingUsers(followingUsersData.filter(Boolean));
      } catch (error) {
        console.error('Error in fetchFollowingUserData:', error);
      }
    };

    fetchFollowingUserData();
  }, [followingUserIds]);

  const formatLastMessageTime = React.useCallback((timestamp) => {
    if (!timestamp) return '';

    const now = new Date();
    // Accept Firestore Timestamps, {seconds}, epoch ms numbers, ISO strings.
    let messageTime;
    if (typeof timestamp?.toDate === 'function') messageTime = timestamp.toDate();
    else if (typeof timestamp?.seconds === 'number') messageTime = new Date(timestamp.seconds * 1000);
    else if (typeof timestamp === 'number') messageTime = new Date(timestamp);
    else messageTime = new Date(timestamp);
    if (!messageTime || isNaN(messageTime.getTime())) return '';
    const diffInMs = now - messageTime;
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInMinutes < 1) return 'now';
    if (diffInMinutes < 60) return `${diffInMinutes}m`;
    if (diffInHours < 24) return `${diffInHours}h`;
    if (diffInDays < 7) return `${diffInDays}d`;

    return messageTime.toLocaleDateString();
  }, []);

  const handleDeleteChat = React.useCallback(async (chatId, username) => {
    try {
      Alert.alert(
        'Delete Conversation',
        `Are you sure you want to delete your conversation with ${username}? This action cannot be undone.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              Logger.user('Deleting chat', { chatId, username });

              const chatRef = doc(db, 'conversations', chatId);
              await updateDoc(chatRef, {
                deleted: true,
                deletedAt: serverTimestamp(),
              });

              Logger.user('Chat soft-deleted successfully');
              Alert.alert('Deleted', `Conversation with ${username} has been removed.`);
            }
          }
        ]
      );
    } catch (error) {
      console.error('âŒ Error deleting chat:', error);
      Alert.alert('Error', 'Failed to delete conversation. Please try again.');
    }
  }, []);

  const deleteChat = async (chatId) => {
    try {
      Alert.alert(
        'Delete Chat',
        'Are you sure you want to delete this chat? This action cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              // Delete from Firebase
              const chatRef = doc(db, 'conversations', chatId);
              await updateDoc(chatRef, {
                participants: [],
                deleted: true,
                deletedAt: serverTimestamp()
              });
              console.log('ðŸ—‘ï¸ Chat deleted:', chatId);
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error deleting chat:', error);
      Alert.alert('Error', 'Failed to delete chat');
    }
  };

  const SwipeableChatItem = ({ item }) => {
    const [panX] = useState(new Animated.Value(0));

    const otherParticipant = resolveOtherParticipant(item);
    if (!otherParticipant) return null;

    return renderChatItemContent(item, otherParticipant, panX);
  };

  const renderChatItemContent = (item, otherParticipant, panX) => {
    // Calculate unread count for current user
    const unreadCount = item.unreadCount?.[uid] || 0;
    const hasUnread = unreadCount > 0;

    const panResponder = PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 20 && Math.abs(gestureState.dy) < 100;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Only allow left swipe (negative dx)
        if (gestureState.dx < 0) {
          panX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx < -100) {
          // Swipe far enough, trigger delete
          deleteChat(item.id);
        }
        // Always return to original position
        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: false,
        }).start();
      },
    });

    return (
      <View style={styles.chatItemWrapper}>
        {/* Delete background */}
        <View style={styles.deleteBackground}>
          <Icon name="trash" size={24} color={T.textPrimary} />
          <Text style={styles.deleteText}>Delete</Text>
        </View>

        <Animated.View
          style={[
            styles.swipeableItem,
            { transform: [{ translateX: panX }] },
          ]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity
            style={[
              styles.whatsappChatItem,
              hasUnread && styles.chatItemUnread,
              {
                backgroundColor: hasUnread ? withAlpha(T.success, 0.08) : T.surface,
                borderLeftWidth: hasUnread ? 4 : 0,
                borderLeftColor: hasUnread ? T.success : T.transparent
              }
            ]}
            onPress={() => navigation.navigate('ChatConversation', {
              chatId: item.id,
              otherUser: otherParticipant
            })}
            activeOpacity={0.7}
          >
            <View style={styles.avatarContainer}>
              <BlypAvatar
                uri={resolveUserPhoto(otherParticipant)}
                name={otherParticipant.username || otherParticipant.displayName}
                profile={otherParticipant}
                size={50}
                showBadge={false}
                style={hasUnread ? { borderRadius: 25, borderWidth: 2, borderColor: T.success } : undefined}
              />
              {hasUnread && <View style={styles.unreadIndicator} />}
            </View>

            <View style={styles.chatContent}>
              <View style={styles.chatHeader}>
                <Text style={[
                  styles.chatName,
                  hasUnread && { color: T.success, fontWeight: 'bold' }
                ]}>
                  {otherParticipant.username || 'Unknown User'}
                </Text>
                <Text style={[
                  styles.chatTime,
                  hasUnread && { color: T.success, fontWeight: '600' }
                ]}>
                  {formatLastMessageTime(item.lastMessageTime)}
                </Text>
              </View>

              <View style={styles.messagePreview}>
                <Text style={[
                  styles.lastMessage,
                  hasUnread && { color: T.textSecondary, fontWeight: '600' }
                ]} numberOfLines={1}>
                  {item.lastMessage || 'No messages yet'}
                </Text>
                {hasUnread && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadCount}>
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  };

  const onNotificationPress = (item) => {
    try {
      if (item?.id && item.id !== LOCAL_WELCOME_TOUR_ID) {
        markNotificationRead(item.id);
      }
    } catch {}
    const data = item?.data || {};
    try {
      if (isTourPayload(data) || item?.id === LOCAL_WELCOME_TOUR_ID) {
        consumeLocalWelcomeTourItem(uid).catch(() => {});
        requestStartTour({ source: 'notification', force: true });
        return;
      }
      if ((data.type === 'message' || data.type === 'conversation') && data.conversationId) {
        navigation.navigate('ChatConversation', {
          conversationId: data.conversationId,
          chatId: data.conversationId,
          otherUser: { id: data.senderId, displayName: data.senderName, username: data.senderName },
        });
        return;
      }
      if (data.teamId) {
        navigation.navigate('MyTeam');
        return;
      }
      if (data.battleId) {
        navigation.navigate('BattleDetail', { battleId: data.battleId });
        return;
      }
      // Admin / system deep links
      const deepLink = String(data.deepLink || data.url || '').trim();
      if (deepLink && /^https?:\/\//i.test(deepLink)) {
        Linking.openURL(deepLink).catch(() => {});
        return;
      }
      const screen = String(data.screen || '').trim();
      const ALLOWED_SCREENS = new Set([
        'Home',
        'Feed',
        'Create',
        'Live',
        'LiveStream',
        'Messages',
        'Messenger',
        'MyTeam',
        'BattleHQ',
        'BattleDetail',
        'Profile',
        'Search',
        'Wallet',
        'Settings',
      ]);
      if (screen && ALLOWED_SCREENS.has(screen)) {
        const params = {};
        if (data.battleId) params.battleId = data.battleId;
        if (data.streamId || data.sessionId) {
          params.streamId = data.streamId || data.sessionId;
        }
        navigation.navigate(screen, Object.keys(params).length ? params : undefined);
      }
    } catch (e) {
      console.warn('[MESSENGER] notification route failed', e?.message || e);
    }
  };

  const notifIconFor = (type) => {
    switch (type) {
      case 'battle': return 'flash';
      case 'message': return 'chatbubble-ellipses';
      case 'live': return 'radio';
      case 'team': return 'people';
      case 'system':
      case 'tour': return 'bell';
      default: return 'notifications';
    }
  };

  const renderNotificationItem = ({ item }) => {
    const unread = item.status !== 'read';
    // Inbox service rewrites opaque-id titles; actorUsername is the fallback label.
    const title = item.title || item.actorUsername || 'Notification';
    return (
      <TouchableOpacity
        style={[styles.whatsappChatItem, unread && { backgroundColor: withAlpha(T.success, 0.06) }]}
        activeOpacity={0.7}
        onPress={() => onNotificationPress(item)}
      >
        <View style={styles.avatarContainer}>
          <View style={[styles.defaultAvatar, { backgroundColor: withAlpha(T.success, 0.15) }]}>
            <Icon name={notifIconFor(item.type)} size={22} color={T.success} />
          </View>
        </View>
        <View style={styles.chatContent}>
          <View style={styles.chatHeader}>
            <Text style={[styles.chatName, unread && { fontWeight: 'bold' }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.chatTime}>{formatLastMessageTime(item.createdAt)}</Text>
          </View>
          <View style={styles.messagePreview}>
            <Text style={styles.lastMessage} numberOfLines={2}>{item.body || ''}</Text>
            {unread && <View style={styles.unreadIndicator} />}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const openChatThread = React.useCallback((item, otherParticipant, datingContext) => {
    navigation.navigate('ChatConversation', {
      chatId: item.id,
      conversationId: item.id,
      chatContext: datingContext ? 'dating' : 'messages',
      datingMatchId: item.datingMatchId || null,
      otherUser: otherParticipant,
    });
  }, [navigation]);

  const deleteChatThread = React.useCallback((item, otherParticipant) => {
    handleDeleteChat(item.id, otherParticipant.username || otherParticipant.displayName);
  }, [handleDeleteChat]);

  const renderChatItem = React.useCallback(({ item }) => {
    const otherParticipant = resolveOtherParticipant(item);
    if (!otherParticipant) return null;
    const datingContext =
      item.chatContext === 'dating' ||
      item.context === 'dating' ||
      item.contexts?.includes?.('dating');
    return (
      <ChatRow
        item={item}
        otherParticipant={otherParticipant}
        unreadCount={item.unreadCount?.[uid] || 0}
        datingContext={datingContext}
        timeLabel={formatLastMessageTime(item.lastMessageTime)}
        onOpen={openChatThread}
        onDelete={deleteChatThread}
      />
    );
  }, [
    deleteChatThread,
    formatLastMessageTime,
    openChatThread,
    resolveOtherParticipant,
    uid,
  ]);

  // Create a separate component for swipeable chat items
  const SwipeableChatBar = ({ item, otherParticipant }) => {
    const unreadCount = item.unreadCount?.[uid] || 0;
    const hasUnread = unreadCount > 0;
    const [panX] = useState(new Animated.Value(0));

    const panResponder = PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 20 && Math.abs(gestureState.dy) < 100;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Only allow left swipe (negative dx)
        if (gestureState.dx < 0) {
          panX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx < -100) {
          // Swipe far enough, trigger delete
          handleDeleteChat(item.id, otherParticipant.username);
        }
        // Always return to original position
        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: false,
        }).start();
      },
    });

    return (
      <View style={styles.chatItemWrapper}>
        <Animated.View
          style={[
            styles.swipeableItem,
            { transform: [{ translateX: panX }] },
          ]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity
            style={[
              styles.whatsappChatItem,
              hasUnread && { backgroundColor: withAlpha(T.success, 0.1) }
            ]}
            onPress={() => {
              console.log('ðŸŽ¯ Chat tapped:', item.id, 'with:', otherParticipant.username);
              navigation.navigate('ChatConversation', {
                chatId: item.id,
                otherUser: otherParticipant
              });
            }}
            activeOpacity={0.7}
          >
            <View style={styles.avatarContainer}>
              <BlypAvatar
                uri={resolveUserPhoto(otherParticipant)}
                name={otherParticipant.username || otherParticipant.displayName}
                profile={otherParticipant}
                size={50}
                showBadge={false}
                style={hasUnread ? { borderRadius: 25, borderWidth: 2, borderColor: T.success } : undefined}
              />
              {hasUnread && <View style={styles.unreadIndicator} />}
            </View>

            <View style={styles.chatContent}>
              <View style={styles.chatHeader}>
                <Text style={[
                  styles.chatName,
                  hasUnread && { color: T.success, fontWeight: 'bold' }
                ]}>
                  {otherParticipant.username || 'Unknown User'}
                </Text>
                <Text style={[
                  styles.chatTime,
                  hasUnread && { color: T.success, fontWeight: '600' }
                ]}>
                  {formatLastMessageTime(item.lastMessageTime)}
                </Text>
              </View>

              <View style={styles.messagePreview}>
                <Text style={[
                  styles.lastMessage,
                  hasUnread && { color: T.textSecondary, fontWeight: '600' }
                ]} numberOfLines={1}>
                  {item.lastMessage || 'No messages yet'}
                </Text>
                {hasUnread && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadCount}>
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  };

  const renderChatBar = (item, otherParticipant) => {
    return <SwipeableChatBar item={item} otherParticipant={otherParticipant} />;
  };

  const renderNewChatItem = ({ item }) => (
    <View style={styles.newChatItem}>
      <View style={styles.avatarContainer}>
        <BlypAvatar
          uri={resolveUserPhoto(item)}
          name={item.username || item.displayName}
          profile={item}
          size={48}
        />
        {item.isOnline && <View style={styles.onlineIndicator} />}
      </View>

      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.username || 'Unknown User'}</Text>
        <Text style={styles.userStatus}>
          {item.isOnline ? 'Online' : 'Last seen recently'}
        </Text>
      </View>

      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={styles.followButton}
          onPress={() => handleFollowUser(item)}
        >
          <Text style={styles.followButtonText}>Follow</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.messageButton}
          onPress={() => startNewChat(item)}
        >
          <Icon name="chatbubble" size={18} color={T.textPrimary} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const handleFollowUser = async (user) => {
    try {
      const result = await followUser(uid, user.id);
      if (result.success) {
        Alert.alert('Success', `You are now following ${user.username}`);
      } else {
        Alert.alert('Error', 'Failed to follow user');
      }
    } catch (error) {
      console.error('Error following user:', error);
      Alert.alert('Error', 'Failed to follow user');
    }
  };

  const startNewChat = async (otherUser) => {
    try {
      const otherUserId = otherUser?.id || otherUser?.uid || otherUser?.userId;
      console.log('ðŸš€ Starting new chat with:', otherUser?.username, 'ID:', otherUserId);
      console.log('ðŸ‘¤ Current user:', uid);

      if (!uid) {
        Alert.alert('Error', 'Please log in to start a chat');
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

      const meName = currentUser?.displayName || currentUser?.username || currentUser?.email || 'Unknown';
      const otherName = otherUser?.username || otherUser?.displayName || 'Unknown';
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



  const renderHeader = () => (
    <BlypHeaderFlow
      tabs={[
        { key: 'chats', label: 'Messages' },
        { key: 'calls', label: 'Calls' },
        {
          key: 'notifications',
          label:
            (notifications || []).filter((n) => n && n.status !== 'read').length > 0
              ? `Notifications (${Math.min(99, (notifications || []).filter((n) => n && n.status !== 'read').length)})`
              : 'Notifications',
        },
        { key: 'groups', label: 'Groups' },
        { key: 'status', label: 'Status' },
      ]}
      matchHomePadding={true}
      activeKey={selectedTab}
      onTabChange={setSelectedTab}
      onMenuPress={() => setMenuVisible(true)}
      onSearchPress={() => navigation.navigate('Search')}
    />
  );

  const renderTabContent = React.useMemo(() => {
    console.log('ðŸ”¥ MESSENGER: Rendering tab content for:', selectedTab);
    console.log('ðŸ‘¤ MESSENGER: Current user ID:', currentUser?.uid);
    console.log('ðŸ“Š MESSENGER: Loading state:', loading);

    switch (selectedTab) {
      case 'chats': {
        // Show all chats that include the current user (WhatsApp style)
        const allUserChats = (Array.isArray(chats) ? chats : []).filter(chat =>
          chat?.participants && chat.participants.includes(uid)
        );

        console.log('ðŸ’¬ MESSENGER: Showing', allUserChats.length, 'conversations');

        // Split into two sections per product spec:
        //  - Top: mutual follows (you follow them AND they follow you back)
        //  - Bottom: everyone else, with "you follow but they don't follow back"
        //    prioritised at the top of that section, then the rest.
        // `allUserChats` is already ordered by lastMessageTime desc, so filtering
        // preserves recency within each group.
        const otherIdOf = (chat) =>
          (chat.participants || []).find((id) => id !== uid) || null;
        const datingChats = [];
        const mutualChats = [];
        const followedNotBackChats = [];
        const otherChats = [];
        for (const chat of allUserChats) {
          const isDating =
            chat.chatContext === 'dating' ||
            chat.context === 'dating' ||
            chat.contexts?.includes?.('dating');
          if (isDating) {
            datingChats.push(chat);
            continue;
          }
          const other = otherIdOf(chat);
          const iFollow = other && followingUserIds.has(other);
          const followsMe = other && followerUserIds.has(other);
          if (iFollow && followsMe) mutualChats.push(chat);
          else if (iFollow && !followsMe) followedNotBackChats.push(chat);
          else otherChats.push(chat);
        }
        const chatSections = [];
        if (datingChats.length) {
          chatSections.push({ key: 'dating', title: 'Dating matches', data: datingChats, dating: true });
        }
        if (mutualChats.length) {
          chatSections.push({ key: 'mutual', title: 'Friends · you follow each other', data: mutualChats });
        }
        const bottomData = [...followedNotBackChats, ...otherChats];
        if (bottomData.length) {
          chatSections.push({ key: 'other', title: 'Other people', data: bottomData });
        }

        return (
          <View style={styles.chatsList}>
            {allUserChats.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="chatbubble-ellipses-outline" size={64} color={T.textDisabled} />
                <Text style={styles.emptyTitle}>No conversations yet</Text>
                <Text style={styles.emptySubtitle}>
                  {followingUserIds.size === 0
                    ? 'You are not following anyone yet — find people to message'
                    : 'Start chatting with someone from your network'}
                </Text>
                <TouchableOpacity
                  style={styles.newChatButton}
                  onPress={() => navigation.navigate('FindPeople')}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={[T.gradientStart, T.gradientMiddle, T.gradientEnd]}
                    style={styles.newChatButtonGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Icon name="add-circle" size={22} color={T.textPrimary} style={styles.newChatIcon} />
                    <Text style={styles.newChatButtonText}>Start New Chat</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            ) : (
              <SectionList
                sections={chatSections}
                renderItem={renderChatItem}
                renderSectionHeader={({ section }) =>
                  chatSections.length > 1 ? (
                    <View style={[styles.chatSectionHeader, section.dating && styles.datingSectionHeader]}>
                      <Text style={[styles.chatSectionHeaderText, section.dating && styles.datingSectionHeaderText]}>
                        {section.dating ? '♥  ' : ''}{section.title}
                      </Text>
                    </View>
                  ) : null
                }
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                style={styles.chatList}
                stickySectionHeadersEnabled={false}
                removeClippedSubviews={Platform.OS === 'android'}
                initialNumToRender={12}
                maxToRenderPerBatch={10}
                windowSize={7}
              />
            )}
          </View>
        );
      }

      case 'notifications':
        return (
          <View style={styles.chatsList}>
            {notifLoading ? (
              <View style={styles.loadingContainer}>
                <Icon name="notifications-outline" size={48} color={T.textDisabled} />
                <Text style={styles.loadingText}>Loading notifications…</Text>
              </View>
            ) : notifications.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="notifications-off-outline" size={64} color={T.textDisabled} />
                <Text style={styles.emptyTitle}>No notifications yet</Text>
                <Text style={styles.emptySubtitle}>
                  Team requests, battles, and Blyp announcements will show up here.
                </Text>
              </View>
            ) : (
              <FlatList
                data={notifications}
                renderItem={renderNotificationItem}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                style={styles.chatList}
                removeClippedSubviews={Platform.OS === 'android'}
                initialNumToRender={12}
                windowSize={7}
              />
            )}
          </View>
        );

      case 'calls':
        return (
          <View style={styles.comingSoon}>
            <Icon name="call" size={48} color={T.textMuted} />
            <Text style={styles.comingSoonTitle}>Calls</Text>
            <Text style={styles.comingSoonText}>Coming soon</Text>
          </View>
        );

      case 'groups':
        // Groups are derived from the real conversations query (chats). No placeholders.
        const groupChats = chats.filter((c) => String(c.type || '').toLowerCase() === 'group');
        if (!groupChats || groupChats.length === 0) {
          return (
            <View style={styles.emptyState}>
              <Icon name="people-outline" size={64} color={T.textDisabled} />
              <Text style={styles.emptyTitle}>No groups yet</Text>
              <Text style={styles.emptySubtitle}>Your group chats will appear here</Text>
            </View>
          );
        }

        return (
          <FlatList
            data={groupChats}
            renderItem={renderChatItem}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            style={styles.chatList}
            removeClippedSubviews={Platform.OS === 'android'}
            initialNumToRender={12}
            windowSize={7}
            contentContainerStyle={{ paddingBottom: tabBarHeight + 12 }}
          />
        );

      case 'status':
        if (statusLoading) {
          return (
            <View style={styles.loadingContainer}>
              <Icon name="radio-outline" size={48} color={T.textDisabled} />
              <Text style={styles.loadingText}>Loading status...</Text>
            </View>
          );
        }

        if (statusError) {
          return (
            <View style={styles.emptyState}>
              <Icon name="alert-circle-outline" size={64} color={T.textDisabled} />
              <Text style={styles.emptyTitle}>Couldn't load status</Text>
              <Text style={styles.emptySubtitle}>Please try again later</Text>
            </View>
          );
        }

        const allowedIds = new Set([uid, ...Array.from(followingUserIds || [])]);
        const visibleStatuses = (statuses || []).filter((s) => {
          const authorId = s.userId || s.authorId;
          if (!authorId) return false;
          return allowedIds.has(authorId);
        });

        if (visibleStatuses.length === 0) {
          return (
            <View style={styles.emptyState}>
              <Icon name="radio-outline" size={64} color={T.textDisabled} />
              <Text style={styles.emptyTitle}>No status updates</Text>
              <Text style={styles.emptySubtitle}>Status updates from you and people you follow will show here</Text>
            </View>
          );
        }

        return (
          <FlatList
            data={visibleStatuses}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={Platform.OS === 'android'}
            initialNumToRender={12}
            windowSize={7}
            contentContainerStyle={{ paddingBottom: tabBarHeight + 12 }}
            renderItem={({ item }) => {
              const authorId = item.userId || item.authorId;
              const author = authorId ? allUsers.find((u) => u.id === authorId) : null;
              const label = author?.username || author?.displayName || item.userName || 'Unknown';
              const createdAt = item.createdAt;
              const time = createdAt?.toDate ? createdAt.toDate().toLocaleString() : '';

              return (
                <View style={styles.statusRow}>
                  <View style={styles.statusAvatar}>
                    {author?.photoURL ? (
                      <Image source={{ uri: author.photoURL }} style={styles.statusAvatarImg} />
                    ) : (
                      <View style={styles.statusAvatarFallback} />
                    )}
                  </View>
                  <View style={styles.statusBody}>
                    <Text style={styles.statusTitle} numberOfLines={1}>{label}</Text>
                    <Text style={styles.statusSubtitle} numberOfLines={1}>{time || 'Recent update'}</Text>
                  </View>
                </View>
              );
            }}
          />
        );

      default:
        return null;
    }
  }, [selectedTab, chats, calls, callsLoading, callsError, statuses, statusLoading, statusError, uid, loading, allUsers, followingUsers, followingUserIds, followerUserIds, notifications, notifLoading, tabBarHeight, navigation, currentUser, renderChatItem]);

  // Simple user list for messaging
  const renderSimpleChatList = () => {
    console.log('ðŸ”¥ MESSENGER: WARNING - renderSimpleChatList called (this should not be used anymore)', allUsers.length, 'users');

    return (
      <FlatList
        data={allUsers.filter(user => user.id !== uid)}
        renderItem={renderSimpleChatItem}
        keyExtractor={(item) => item.id}
        style={styles.chatList}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={() => (
          <View style={styles.emptyState}>
            <Icon name="chatbubbles-outline" size={64} color={T.textDisabled} />
            <Text style={styles.emptyStateTitle}>No people to chat with</Text>
            <Text style={styles.emptyStateText}>
              Follow some people to start conversations
            </Text>
          </View>
        )}
      />
    );
  };

  const renderSimpleChatItem = ({ item: user }) => {
    return (
      <TouchableOpacity
        style={styles.whatsappChatItem}
        onPress={() => startNewChat(user)}
        activeOpacity={0.7}
      >
        <View style={styles.avatarContainer}>
          {user.avatar ? (
            <Image source={{ uri: user.avatar }} style={styles.avatar} />
          ) : (
            <View style={styles.defaultAvatar}>
              <Text style={styles.avatarText}>
                {user.username?.charAt(0).toUpperCase() || '?'}
              </Text>
            </View>
          )}
          {user.isOnline && <View style={styles.onlineIndicator} />}
        </View>

        <View style={styles.chatContent}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatName}>{user.username || 'Unknown User'}</Text>
            <Text style={styles.chatTime}>Online</Text>
          </View>

          <View style={styles.messagePreview}>
            <Text style={styles.newChatMessage} numberOfLines={1}>
              Tap to start conversation
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // Show loading screen while authentication is loading
  if (!authReady || authLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
        <View style={styles.loadingContainer}>
          <BlypLogo />
          <Text style={styles.loadingText}>Loading chats...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Show authentication required screen if not authenticated
  if (!authReady || !isAuthenticated || !currentUser) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
        <View style={styles.authRequiredContainer}>
          <Icon name="chatbubbles-outline" size={64} color={T.textDisabled} />
          <Text style={styles.authRequiredTitle}>Sign in for messages</Text>
          <Text style={styles.authRequiredText}>Create a free account or sign in to access chats and inbox.</Text>
          <TouchableOpacity
            style={styles.signInButton}
            onPress={() => {
              exitGuestMode().catch(() => {});
            }}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
          >
            <Text style={styles.signInButtonText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const useSectionGradient = selectedTab === 'chats' || selectedTab === 'notifications' || selectedTab === 'calls' || selectedTab === 'groups' || selectedTab === 'status';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      {/* Messenger Header — FLOW layout; HeaderContainer owns top safe-area */}
      {renderHeader()}

      {/* Tab Content */}
      <View style={[styles.tabContent, { flex: 1, paddingBottom: tabBarHeight }]}>
        {useSectionGradient && (
          <LinearGradient
            pointerEvents="none"
            colors={[T.background, T.background, T.background]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.sectionGradientBackground}
          />
        )}
        {renderTabContent}
      </View>

      {/* Floating Action Button for Find People (hidden on Calls — Coming Soon) */}
      {selectedTab !== 'calls' ? (
        <TouchableOpacity
          style={[styles.fab, { bottom: tabBarHeight + 20 }]}
          onPress={() => {
            navigation.navigate('FindPeople');
          }}
          accessibilityLabel="Find people"
        >
          <LinearGradient
            colors={[T.gradientStart, T.gradientEnd]}
            style={styles.fabGradient}
          >
            <Icon name="chatbubble" size={24} color={T.textPrimary} />
          </LinearGradient>
        </TouchableOpacity>
      ) : null}

      {/* Menu Overlay */}
      <Modal
        visible={menuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.menuContainer}>
            <TouchableOpacity
              style={styles.menuCloseButton}
              onPress={() => setMenuVisible(false)}
            >
              <Icon name="close" size={24} color={T.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.menuTitle}>Menu</Text>

            <TouchableOpacity
              style={styles.getMoreButton}
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
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.headerBackground,
  },
  tabContent: {
    flex: 1,
    position: 'relative',
  },
  sectionGradientBackground: {
    ...StyleSheet.absoluteFillObject,
  },

  callRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
    backgroundColor: T.surface || 'transparent',
  },
  callRowMissed: {
    backgroundColor: withAlpha(T.error || '#EF4444', 0.06),
  },
  callAvatarWrap: {
    width: 50,
    height: 50,
    marginRight: 12,
  },
  callDirectionBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: T.headerBackground || '#0A0A0C',
  },
  callRowBody: {
    flex: 1,
    minWidth: 0,
  },
  callRowTitle: {
    color: T.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  callRowSubtitle: {
    marginTop: 3,
    color: T.textMuted,
    fontSize: 13,
  },
  callBackBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(T.primary || '#00D2BE', 0.12),
    marginLeft: 8,
  },
  callEmptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(T.primary || '#00D2BE', 0.12),
    borderWidth: 1,
    borderColor: withAlpha(T.primary || '#00D2BE', 0.28),
    marginBottom: 8,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  statusAvatar: {
    width: 40,
    height: 40,
    borderRadius: 9999,
    overflow: 'hidden',
    marginRight: 12,
  },
  statusAvatarImg: {
    width: 40,
    height: 40,
  },
  statusAvatarFallback: {
    width: 40,
    height: 40,
    backgroundColor: T.surfaceAlt,
  },
  statusBody: {
    flex: 1,
  },
  statusTitle: {
    color: T.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  statusSubtitle: {
    marginTop: 2,
    color: T.textMuted,
    fontSize: 12,
  },
  // WhatsApp-style Header
  whatsappHeader: {
    backgroundColor: withAlpha(T.background, 0.5),
    paddingTop: 0,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: T.surface,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  headerTitle: {
    fontSize: responsiveFont(24),
    fontWeight: 'bold',
    color: T.textPrimary,
  },
  menuButton: {
    padding: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    padding: 8,
    marginLeft: 8,
  },
  // WhatsApp-style Chat List
  chatListContainer: {
    flex: 1,
  },
  chatList: {
    flex: 1,
  },
  chatsList: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  chatSectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  chatSectionHeaderText: {
    color: T.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  datingSectionHeader: {
    borderLeftWidth: 3,
    borderLeftColor: DATING_ACCENT,
    marginLeft: 12,
    paddingLeft: 10,
  },
  datingSectionHeaderText: {
    color: '#FF9BAD',
  },
  chatTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginRight: 8,
  },
  datingThreadBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: withAlpha(DATING_ACCENT, 0.18),
    borderWidth: 1,
    borderColor: withAlpha(DATING_ACCENT, 0.35),
  },
  datingThreadBadgeText: {
    color: '#FFD8DF',
    fontSize: 9,
    fontWeight: '800',
  },
  whatsappChatItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: withAlpha(T.textPrimary, 0.1),
    backgroundColor: 'transparent',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  defaultAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: T.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: T.textPrimary,
    fontSize: 18,
    fontWeight: 'bold',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: T.success,
    borderWidth: 2,
    borderColor: T.background,
  },
  chatContent: {
    flex: 1,
    justifyContent: 'center',
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatName: {
    color: T.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  chatTime: {
    color: T.textMuted,
    fontSize: 12,
  },
  messagePreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    color: T.textMuted,
    fontSize: 14,
    flex: 1,
  },
  newChatMessage: {
    fontStyle: 'italic',
    color: T.textDisabled,
  },
  unreadBadge: {
    backgroundColor: T.success,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    elevation: 3,
    shadowColor: T.success,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
  unreadCount: {
    color: T.textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  chatItemUnread: {
    elevation: 2,
    shadowColor: T.success,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyStateTitle: {
    color: T.textPrimary,
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
    textAlign: 'center',
  },
  emptyStateText: {
    color: T.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  newChatButton: {
    borderRadius: 25,
    marginTop: 24,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: T.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  newChatButtonText: {
    color: T.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  // Floating Action Button
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    elevation: 8,
    shadowColor: T.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  logoContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: T.textPrimary,
  },
  menuButton: {
    padding: 8,
    position: 'absolute',
    left: 16,
  },
  headerBalances: {
    position: 'absolute',
    left: 56,
    height: '100%',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
    color: T.accent,
    textShadowColor: withAlpha(T.primary, 0.3),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  searchButton: {
    padding: 8,
    position: 'absolute',
    right: 16,
  },
  tabContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  tabSelector: {
    position: 'relative',
    backgroundColor: T.surfaceAlt,
    borderRadius: 9999,
    padding: 4,
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    zIndex: 2,
  },
  tabText: {
    color: T.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  activeTabText: {
    color: T.textPrimary,
  },
  tabIndicator: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    width: '25%',
    borderRadius: 9999,
    zIndex: 1,
  },
  content: {
    flex: 1,
  },
  comingSoon: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 120,
    paddingHorizontal: 32,
  },
  comingSoonTitle: {
    color: T.textMuted,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  comingSoonText: {
    color: T.textDisabled,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  newChatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(T.textPrimary, 0.1),
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  defaultAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: T.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: T.textPrimary,
    fontSize: 20,
    fontWeight: 'bold',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: T.success,
    borderWidth: 2,
    borderColor: T.background,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: T.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  userStatus: {
    color: T.textMuted,
    fontSize: 14,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  followButton: {
    backgroundColor: T.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  followButtonText: {
    color: T.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  messageButton: {
    backgroundColor: T.surfaceAlt,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  requestsList: {
    flex: 1,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(T.textPrimary, 0.1),
  },
  sectionTitle: {
    color: T.textPrimary,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  sectionSubtitle: {
    color: T.textMuted,
    fontSize: 14,
  },
  userListContainer: {
    flexGrow: 1,
  },
  // Swipe to delete styles
  chatItemWrapper: {
    position: 'relative',
    backgroundColor: 'transparent',
  },
  swipeableItem: {
    backgroundColor: withAlpha(T.background, 0.8),
    borderRadius: 8,
    marginHorizontal: 8,
    marginVertical: 2,
  },
  deleteBackground: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 80,
    backgroundColor: T.error,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  deleteText: {
    color: T.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  // Chat item styles
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
    borderRadius: 8,
  },
  chatItemUnread: {
    backgroundColor: withAlpha(T.success, 0.1),
    borderLeftWidth: 3,
    borderLeftColor: T.success,
  },
  // Avatar styles with unread indicators
  avatarUnread: {
    borderWidth: 2,
    borderColor: T.success,
  },
  defaultAvatarUnread: {
    borderWidth: 2,
    borderColor: T.success,
  },
  unreadIndicator: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: T.success,
    borderWidth: 2,
    borderColor: T.background,
  },
  // Chat info styles
  chatInfo: {
    flex: 1,
    marginLeft: 12,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatName: {
    fontSize: 16,
    fontWeight: '600',
    color: T.textPrimary,
  },
  chatNameUnread: {
    color: T.success,
    fontWeight: 'bold',
  },
  chatTime: {
    fontSize: 12,
    color: T.textMuted,
  },
  chatTimeUnread: {
    color: T.success,
    fontWeight: '600',
  },
  messagePreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    fontSize: 14,
    color: T.textMuted,
    flex: 1,
    marginRight: 8,
  },
  lastMessageUnread: {
    color: T.textSecondary,
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: T.success,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadCount: {
    color: T.textPrimary,
    fontSize: 12,
    fontWeight: 'bold',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: T.success,
    borderWidth: 2,
    borderColor: T.background,
  },
  // Welcome screen styles
  // Menu styles
  menuOverlay: {
    flex: 1,
    backgroundColor: withAlpha(T.shadow, 0.5),
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  menuContainer: {
    width: 250,
    backgroundColor: T.surface,
    borderRadius: 12,
    padding: 16,
    margin: 16,
    marginTop: 0,
    shadowColor: T.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  menuCloseButton: {
    alignSelf: 'flex-end',
    padding: 8,
  },
  menuTitle: {
    fontSize: responsiveFont(18),
    fontWeight: 'bold',
    color: T.textPrimary,
    marginBottom: 16,
    textAlign: 'center',
  },
  balanceItems: {
    marginVertical: 8,
  },
  menuBalanceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: withAlpha(T.textPrimary, 0.1),
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginVertical: 6,
  },
  balanceIcon: {
    fontSize: responsiveFont(20),
    marginRight: 8,
  },
  balanceLabel: {
    flex: 1,
    fontSize: responsiveFont(14),
    color: T.textSecondary,
  },
  balanceValue: {
    fontSize: responsiveFont(16),
    fontWeight: 'bold',
    color: T.textPrimary,
  },
  getMoreButton: {
    backgroundColor: withAlpha(T.accent, 0.8),
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 16,
    alignItems: 'center',
  },
  menuButtonText: {
    color: T.textPrimary,
    fontSize: responsiveFont(14),
    fontWeight: 'bold',
  },
  menuLogoutButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#FF5A5F',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 10,
    alignItems: 'center',
  },
  menuLogoutText: { color: '#FF5A5F', fontWeight: '700', fontSize: responsiveFont(14) },
  // Loading screen styles
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    color: T.textPrimary,
    fontSize: 16,
    marginTop: 16,
    textAlign: 'center',
  },
  // Authentication required screen styles
  authRequiredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  authRequiredTitle: {
    color: T.textPrimary,
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 16,
    textAlign: 'center',
  },
  authRequiredText: {
    color: T.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  signInButton: {
    backgroundColor: T.primary,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 25,
  },
  signInButtonText: {
    color: T.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  // --- WhatsApp-style empty-state & premium touches ---
  emptyTitle: {
    color: T.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 20,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  emptySubtitle: {
    color: T.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  newChatButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 25,
  },
  newChatIcon: {
    marginRight: 8,
  },
});

// Helper function to format balance numbers
const formatBalance = (balance) => {
  if (balance >= 1000000) return (balance / 1000000).toFixed(1) + 'M';
  if (balance >= 1000) return (balance / 1000).toFixed(1) + 'K';
  return balance.toString();
};

export default MessengerScreen;
