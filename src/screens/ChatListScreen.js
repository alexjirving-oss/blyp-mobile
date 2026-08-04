import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import BlueScreen from '../ui/BlueScreen';
import Icon from '../components/Icon';
import { Alert, FlatList, Image, Modal, PanResponder, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, query, orderBy, onSnapshot, where, doc, getDoc } from 'firebase/firestore';
import { auth, firestore as db } from '../config/firebase';
import { subscribeToFollowingList } from '../utils/followUtils';
import { useTabReset } from '../utils/tabResetBus';
import { useIsFocused } from '@react-navigation/native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import BlypAvatar from '../components/BlypAvatar';
import HeaderMenuTabs from '../components/HeaderMenuTabs';
import HeaderWalletBalances from '../components/HeaderWalletBalances';
import HeaderContainer, { HEADER_ICON_COLOR } from '../components/HeaderContainer';
import BlypHeaderFlow from '../components/BlypHeaderFlow';
import PlanStatusBanner from '../components/PlanStatusBanner';
import { COLORS } from '../styles/theme';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';
import { getEconomyWallet } from '../api/economyLiveApi';
import { shouldUseLiveServiceWallet } from '../utils/walletSource';
import ChatRoomService from '../services/ChatRoomService';
import GameService from '../services/GameService';
import LiveUsersTab from '../components/LiveUsersTab';
import YourBlypContent from '../components/YourBlyp/YourBlypContent';
import BattlesContent from '../components/Battles/BattlesContent';
import TeamsContent from '../components/Teams/TeamsContent';
import { useAuth, hardLogout } from '../hooks/useCommon';
import { fetchMessengerUserProfile, resolveUserPhoto } from '../services/messaging/resolveMessengerUser';

const ROOM_CATEGORIES = [
  { id: 'general', name: 'General', icon: 'chatbubbles-outline', color: '#3b82f6' },
  { id: 'gaming', name: 'Gaming', icon: 'game-controller-outline', color: '#8b5cf6' },
  { id: 'music', name: 'Music', icon: 'musical-notes-outline', color: '#ef4444' },
  { id: 'tech', name: 'Tech', icon: 'laptop-outline', color: '#06b6d4' },
  { id: 'sports', name: 'Sports', icon: 'basketball-outline', color: '#f59e0b' },
  { id: 'art', name: 'Art & Design', icon: 'brush-outline', color: '#ec4899' }
];

const GAME_TYPES = [
  {
    type: 'rock-paper-scissors',
    name: 'Rock Paper Scissors',
    icon: 'âœŠ',
    emoji: 'âœŠðŸ–ï¸âœŒï¸',
    players: '2 players',
    description: 'Classic hand game with rock, paper, and scissors',
    gradient: ['#FF6B6B', '#FF8E53'],
    difficulty: 'Easy',
    playTime: '2 min'
  },
  {
    type: 'tic-tac-toe',
    name: 'Tic Tac Toe',
    icon: 'â­•',
    emoji: 'âŒâ­•',
    players: '2 players',
    description: 'Get three in a row to win this classic strategy game',
    gradient: ['#4ECDC4', '#44A08D'],
    difficulty: 'Easy',
    playTime: '3 min'
  },
  {
    type: 'word-guess',
    name: 'Word Guess',
    icon: 'ðŸ”¤',
    emoji: 'ðŸ”¤ðŸ’­',
    players: 'Up to 4',
    description: 'Guess the mystery word before time runs out',
    gradient: ['#A8E6CF', '#7FCDCD'],
    difficulty: 'Medium',
    playTime: '5 min'
  },
  {
    type: 'quick-draw',
    name: 'Quick Draw',
    icon: 'ðŸŽ¨',
    emoji: 'ðŸŽ¨âœï¸',
    players: 'Up to 8',
    description: 'Draw and guess in this fast-paced creative game',
    gradient: ['#FFD93D', '#FF6B6B'],
    difficulty: 'Medium',
    playTime: '4 min'
  },
  {
    type: 'trivia',
    name: 'Trivia Quiz',
    icon: 'ðŸ§ ',
    emoji: 'ðŸ§ â“',
    players: 'Up to 6',
    description: 'Test your knowledge across various categories',
    gradient: ['#A8EDEA', '#FED6E3'],
    difficulty: 'Hard',
    playTime: '8 min'
  },
  {
    type: 'memory-match',
    name: 'Memory Match',
    icon: 'ðŸƒ',
    emoji: 'ðŸƒðŸ§©',
    players: 'Up to 4',
    description: 'Match pairs in this brain-training memory game',
    gradient: ['#667eea', '#764ba2'],
    difficulty: 'Medium',
    playTime: '6 min'
  }
];

const ChatListScreen = ({ navigation }) => {
  // The main tab bar (App.js MainTabs) is an absolute overlay, so this screen
  // must reserve its height or every sub-tab's bottom (Your Blyp stats, team
  // lists, etc.) renders hidden underneath the footer. Context (not the hook)
  // so the screen also works if ever mounted outside the tab navigator.
  const tabBarHeight = useContext(BottomTabBarHeightContext) || 68;
  const [selectedTab, setSelectedTab] = useState('notifications');
  // Double-tap the Chat/Games tab → reset to the first sub-page ("Live").
  useTabReset('Chat', () => setSelectedTab('notifications'));
  const [chats, setChats] = useState([]);
  const [followingUsers, setFollowingUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredChats, setFilteredChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [menuVisible, setMenuVisible] = useState(false);
  const [coinBalance, setCoinBalance] = useState(0);
  const [gemBalance, setGemBalance] = useState(0);

  // Chat Rooms state
  const [rooms, setRooms] = useState([]);
  const [userRooms, setUserRooms] = useState([]);
  const [activeRooms, setActiveRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);

  // Games state
  const [availableGames, setAvailableGames] = useState([]);
  const [myGames, setMyGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gameSearchQuery, setGameSearchQuery] = useState('');
  const [selectedGameTab, setSelectedGameTab] = useState('browse');
  const [showCreateGameModal, setShowCreateGameModal] = useState(false);

  // Live users state
  const [liveUsers, setLiveUsers] = useState([]);
  const [liveUsersLoading, setLiveUsersLoading] = useState(true);

  const isFocused = useIsFocused();
  const currentUser = auth.currentUser;
  const { uid: authUid, authReady, isAuthenticated } = useAuth();
  const walletUid = authUid || currentUser?.uid || null;

  useEffect(() => {
    if (!isFocused) return;

    // Balance panel should work even when Firebase auth isn't the source of truth.
    if (walletUid) {
      loadBalances();
    }

    // The chat/games/live-users tabs still depend on Firebase-backed data.
    if (currentUser) {
      loadChats();
      loadFollowingUsers();
      if (selectedTab === 'chats') {
        loadRooms();
      } else if (selectedTab === 'requests') {
        loadGames();
      } else if (selectedTab === 'notifications') {
        loadLiveUsers();
      }
    }
  }, [isFocused, currentUser, selectedTab, walletUid, authReady, isAuthenticated]);

  const loadBalances = async () => {
    if (!walletUid) return;
    try {
      if (shouldUseLiveServiceWallet()) {
        if (!authReady || !isAuthenticated) {
          setCoinBalance(0);
          setGemBalance(0);
          return;
        }

        const wallet = await getEconomyWallet();
        const coins = Number(wallet?.coinBalance || 0) + Number(wallet?.bonusCoinBalance || 0);
        const gems = Number(wallet?.gemAvailable || 0) + Number(wallet?.gemPending || 0);
        setCoinBalance(Number.isFinite(coins) ? coins : 0);
        setGemBalance(Number.isFinite(gems) ? gems : 0);
        return;
      }

      const coins = await BlypCoinService.getUserBalance(walletUid);
      const gems = await GemService.getUserGems(walletUid);
      setCoinBalance(Number.isFinite(coins) ? coins : 0);
      setGemBalance(Number.isFinite(gems) ? gems : 0);
    } catch (error) {
      const msg = String(error?.message || error || '');
      console.warn('[BALANCES] loadBalances failed:', msg);
      setCoinBalance(0);
      setGemBalance(0);
    }
  };

  const loadRooms = () => {
    if (!currentUser) return;

    setRoomsLoading(true);

    // Subscribe to all available rooms
    const unsubscribeRooms = ChatRoomService.subscribeToAvailableRooms((availableRooms) => {
      let filteredRooms = availableRooms;

      // Apply search filter
      if (roomSearchQuery.trim()) {
        filteredRooms = filteredRooms.filter(room =>
          room.name.toLowerCase().includes(roomSearchQuery.toLowerCase()) ||
          room.description.toLowerCase().includes(roomSearchQuery.toLowerCase()) ||
          room.tags.some(tag => tag.toLowerCase().includes(roomSearchQuery.toLowerCase()))
        );
      }

      // Apply category filter
      if (selectedCategory) {
        filteredRooms = filteredRooms.filter(room => room.category === selectedCategory);
      }

      setRooms(filteredRooms);
      setRoomsLoading(false);
    });

    // Subscribe to user's rooms
    const unsubscribeUserRooms = ChatRoomService.subscribeToUserRooms((myRooms) => {
      setUserRooms(myRooms);

      // Calculate active rooms (rooms with activity in last 24 hours)
      const activeRoomsFiltered = myRooms.filter(room => {
        const lastActivity = new Date(room.lastActivity);
        const hoursSinceActivity = (new Date() - lastActivity) / (1000 * 60 * 60);
        return hoursSinceActivity < 24;
      });
      setActiveRooms(activeRoomsFiltered);
    });

    return () => {
      unsubscribeRooms();
      unsubscribeUserRooms();
    };
  };

  const loadLiveUsers = () => {
    if (!currentUser) return;

    setLiveUsersLoading(true);

    // Query for users who are currently live streaming
    const liveUsersQuery = query(
      collection(db, 'userProfiles'),
      where('isLive', '==', true)
    );

    const unsubscribe = onSnapshot(liveUsersQuery, async (snapshot) => {
      try {
        const liveUsersList = [];

        // For each live user, get their stream details
        for (const userDoc of snapshot.docs) {
          const userData = userDoc.data();

          // If user has a current stream, get the stream details
          if (userData.currentStreamId) {
            try {
              const streamDoc = await getDoc(doc(db, 'liveStreams', userData.currentStreamId));
              if (streamDoc.exists()) {
                const streamData = streamDoc.data();
                liveUsersList.push({
                  id: userDoc.id,
                  ...userData,
                  liveStreamTitle: streamData.title,
                  streamStatus: streamData.status,
                  viewCount: streamData.viewCount || 0
                });
              } else {
                // Stream doesn't exist, user shouldn't be marked as live
                console.warn(`User ${userDoc.id} is marked as live but stream ${userData.currentStreamId} not found`);
              }
            } catch (streamError) {
              console.error('Error fetching stream details:', streamError);
            }
          }
        }

        setLiveUsers(liveUsersList);
        setLiveUsersLoading(false);
      } catch (error) {
        console.error('Error processing live users:', error);
        setLiveUsersLoading(false);
      }
    }, (error) => {
      console.error('Error loading live users:', error);
      setLiveUsersLoading(false);
    });

    return unsubscribe;
  };

  useEffect(() => {
    filterChats();
  }, [searchQuery, chats]);

  const loadChats = () => {
    try {
      // Load real chats from Firebase - simplified query to avoid index requirements
      const chatsQuery = query(
        collection(db, 'chats'),
        where('participants', 'array-contains', currentUser.uid)
      );

      const unsubscribe = onSnapshot(chatsQuery, async (snapshot) => {
        const chatData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
          .sort((a, b) => {
            const aTime = a.lastMessageTime?.seconds || 0;
            const bTime = b.lastMessageTime?.seconds || 0;
            return bTime - aTime;
          });

        const enriched = await Promise.all(chatData.map(async (chat) => {
          if (chat.participantInfo?.avatar) return chat;
          const otherId = (chat.participants || []).find((id) => id !== currentUser.uid);
          if (!otherId) return chat;
          const profile = await fetchMessengerUserProfile(otherId);
          const name = profile?.displayName || profile?.username || chat.participantNames?.[0] || 'User';
          return {
            ...chat,
            participantInfo: {
              name,
              username: profile?.username || name,
              avatar: resolveUserPhoto(profile),
              online: false,
            },
          };
        }));

        setChats(enriched);
        setLoading(false);
      });

      return unsubscribe;
    } catch (error) {
      console.error('Error loading chats:', error);
      setLoading(false);
    }
  };

  const loadFollowingUsers = () => {
    // Subscribe to the list of users the current user is following
    const unsubscribe = subscribeToFollowingList(currentUser.uid, async (followingSet) => {
      if (followingSet.size === 0) {
        setFollowingUsers([]);
        return;
      }

      // Get user data for each followed user
      const followingUsersData = [];
      for (const userId of followingSet) {
        try {
          const userDoc = await getDoc(doc(db, 'users', userId));
          if (userDoc.exists()) {
            followingUsersData.push({
              id: userDoc.id,
              ...userDoc.data()
            });
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
        }
      }

      setFollowingUsers(followingUsersData);
    });

    return unsubscribe;
  };

  const filterChats = () => {
    if (!searchQuery.trim()) {
      setFilteredChats(chats);
      return;
    }

    const filtered = chats.filter(chat => {
      const info = chat.participantInfo || {};
      const name = String(info.name || '').toLowerCase();
      const username = String(info.username || '').toLowerCase();
      const last = String(chat.lastMessage?.text || '').toLowerCase();
      const q = searchQuery.toLowerCase();
      return name.includes(q) || username.includes(q) || last.includes(q);
    });

    setFilteredChats(filtered);
  };

  const formatTimestamp = (timestamp) => {
    const now = new Date();
    const messageDate = new Date(timestamp);
    const diffInHours = (now - messageDate) / (1000 * 60 * 60);

    if (diffInHours < 1) {
      const diffInMinutes = Math.floor((now - messageDate) / (1000 * 60));
      return diffInMinutes < 1 ? 'now' : `${diffInMinutes}m`;
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h`;
    } else if (diffInHours < 48) {
      return 'yesterday';
    } else {
      return messageDate.toLocaleDateString();
    }
  };

  const getMessagePreview = (message) => {
    switch (message.type) {
      case 'image':
        return 'ðŸ“· Photo';
      case 'video':
        return 'ðŸŽ¥ Video';
      case 'audio':
        return 'ðŸŽµ Audio';
      case 'file':
        return 'ðŸ“„ Document';
      default:
        return message.text;
    }
  };

  const handleChatPress = (chat) => {
    navigation.navigate('ChatConversation', {
      chatId: chat.id,
      participant: chat.participantInfo,
    });
  };

  const handleNewChat = () => {
    // For now, navigate to Search to find users to chat with
    navigation.navigate('Search');
    // TODO: Create dedicated NewChat/AddContact screen
  };

  // Room handling functions
  const handleJoinRoom = async (room) => {
    try {
      if (room.isPrivate && room.password) {
        Alert.prompt(
          'Private Room',
          'This room requires a password:',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Join',
              onPress: async (password) => {
                try {
                  await ChatRoomService.joinRoom(room.id, password);
                  navigation.navigate('ChatRoom', { roomId: room.id });
                } catch (error) {
                  Alert.alert('Error', error.message);
                }
              }
            }
          ],
          'secure-text'
        );
      } else {
        await ChatRoomService.joinRoom(room.id);
        navigation.navigate('ChatRoom', { roomId: room.id });
      }
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  const formatBalance = (balance) => {
    if (balance >= 1000000) {
      return (balance / 1000000).toFixed(1) + 'M';
    } else if (balance >= 1000) {
      return (balance / 1000).toFixed(1) + 'K';
    }
    return balance.toString();
  };

  // Games loading functions
  const loadGames = async () => {
    if (!currentUser) return;

    setGamesLoading(true);
    try {
      // Subscribe to available games
      const unsubscribeAvailable = GameService.subscribeToAvailableGames((snapshot) => {
        const gamesList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setAvailableGames(gamesList);
      });

      // Subscribe to user's games
      const unsubscribeUserGames = GameService.subscribeToUserGames(currentUser.uid, (snapshot) => {
        const userGamesList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setMyGames(userGamesList);
        setGamesLoading(false);
      });

      // Return cleanup function
      return () => {
        unsubscribeAvailable();
        unsubscribeUserGames();
      };
    } catch (error) {
      console.error('Error loading games:', error);
      setGamesLoading(false);
    }
  };

  const handleCreateGame = async (gameType, isPrivate = false) => {
    try {
      const gameId = await GameService.createGameRoom(gameType, isPrivate);
      setShowCreateGameModal(false);
      navigation.navigate('GameRoom', { gameId, gameType });
    } catch (error) {
      console.error('Error creating game:', error);
      Alert.alert('Error', 'Failed to create game. Please try again.');
    }
  };

  const handleJoinGame = async (game) => {
    try {
      if (game.players.length >= game.maxPlayers) {
        Alert.alert('Game Full', 'This game room is already full.');
        return;
      }

      if (game.players.includes(currentUser.uid)) {
        // Already in game, just navigate
        navigation.navigate('GameRoom', { gameId: game.id, gameType: game.gameType });
        return;
      }

      await GameService.joinGame(game.id);
      navigation.navigate('GameRoom', { gameId: game.id, gameType: game.gameType });
    } catch (error) {
      console.error('Error joining game:', error);
      Alert.alert('Error', 'Failed to join game. Please try again.');
    }
  };

  const renderChatItem = ({ item }) => {
    const isUnread = item.unreadCount > 0;

    return (
      <TouchableOpacity
        style={[styles.chatItem, item.isPinned && styles.pinnedChat]}
        onPress={() => handleChatPress(item)}
        activeOpacity={0.7}
      >
        {/* Avatar with online indicator */}
        <View style={styles.avatarContainer}>
          <BlypAvatar
            uri={item.participantInfo?.avatar}
            name={item.participantInfo?.name || item.participantInfo?.username}
            size={48}
          />
          {item.participantInfo.online && (
            <View style={styles.onlineIndicator} />
          )}
        </View>

        {/* Chat info */}
        <View style={styles.chatInfo}>
          <View style={styles.chatHeader}>
            <View style={styles.nameContainer}>
              <Text style={[styles.contactName, isUnread && styles.unreadText]}>
                {item.participantInfo.name}
              </Text>
              {item.isPinned && (
                <Icon name="pin" size={14} color="#00D2BE" />
              )}
            </View>
            <Text style={[styles.timestamp, isUnread && styles.unreadTimestamp]}>
              {formatTimestamp(item.lastMessage.timestamp)}
            </Text>
          </View>

          <View style={styles.messageRow}>
            <Text
              style={[styles.lastMessage, isUnread && styles.unreadMessage]}
              numberOfLines={1}
            >
              {item.lastMessage.senderId === 'current_user' ? 'âœ“âœ“ ' : ''}
              {getMessagePreview(item.lastMessage)}
            </Text>
            {isUnread && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadCount}>{item.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // Room rendering functions
  const renderRoomItem = ({ item: room }) => {
    const category = ROOM_CATEGORIES.find((cat) => cat.id === room.category) || ROOM_CATEGORIES[0];
    const isUserRoom = room.participants.includes(currentUser?.uid);
    const canJoin = !isUserRoom && room.participantCount < room.maxParticipants;

    const statusStyle = isUserRoom ? styles.joinedBadge : canJoin ? styles.joinBadge : styles.fullBadge;
    const statusTextStyle = isUserRoom ? styles.joinedText : canJoin ? styles.joinText : styles.fullText;
    const statusLabel = isUserRoom ? 'Joined' : canJoin ? 'Join' : 'Full';

    return (
      <TouchableOpacity
        style={styles.roomCard}
        activeOpacity={0.8}
        onPress={() => {
          if (isUserRoom) {
            navigation.navigate('ChatRoom', { roomId: room.id });
          } else if (canJoin) {
            handleJoinRoom(room);
          }
        }}
      >
        <LinearGradient
          colors={[category.color, `${category.color}90`]}
          style={styles.roomCardGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.roomHeader}>
            <View style={styles.roomInfo}>
              <View style={[styles.categoryIcon, { backgroundColor: category.color }]}>
                <Icon name={category.icon} size={20} color="#fff" />
              </View>

              <View style={styles.roomDetails}>
                <View style={styles.roomTitleRow}>
                  <Text style={styles.roomName} numberOfLines={1}>
                    {room.name}
                  </Text>
                </View>
                <Text style={styles.roomDescription} numberOfLines={2}>
                  {room.description}
                </Text>
                <View style={styles.roomMeta}>
                  <Text style={styles.categoryText}>{category.name}</Text>
                  <Text style={styles.participantCount}>
                    {room.participantCount}/{room.maxParticipants} players
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.roomActions}>
              <View style={[styles.statusBadge, statusStyle]}>
                <Text style={statusTextStyle}>{statusLabel}</Text>
              </View>
            </View>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const renderRoomSection = (data, emptyTitle, emptyText, emptyIcon) => {
    if (data.length === 0) {
      return (
        <View style={styles.emptySection}>
          <Icon name={emptyIcon} size={48} color="#374151" />
          <Text style={styles.emptySectionTitle}>{emptyTitle}</Text>
          <Text style={styles.emptySectionText}>{emptyText}</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={data}
        renderItem={renderRoomItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        scrollEnabled={false}
      />
    );
  };

  const renderCategoryFilter = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.categoryFilter}
      contentContainerStyle={styles.categoryFilterContent}
    >
      <TouchableOpacity
        style={[
          styles.categoryChip,
          !selectedCategory && styles.categoryChipActive
        ]}
        onPress={() => setSelectedCategory(null)}
      >
        <Text style={[
          styles.categoryChipText,
          !selectedCategory && styles.categoryChipTextActive
        ]}>All</Text>
      </TouchableOpacity>

      {ROOM_CATEGORIES.map((category) => (
        <TouchableOpacity
          key={category.id}
          style={[
            styles.categoryChip,
            selectedCategory === category.id && styles.categoryChipActive
          ]}
          onPress={() => setSelectedCategory(
            selectedCategory === category.id ? null : category.id
          )}
        >
          <Icon
            name={category.icon}
            size={16}
            color={selectedCategory === category.id ? COLORS.white : category.color}
          />
          <Text style={[
            styles.categoryChipText,
            selectedCategory === category.id && styles.categoryChipTextActive
          ]}>
            {category.name}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  // Games rendering functions
  const renderGameTypeItem = ({ item: gameType }) => (
    <TouchableOpacity
      style={styles.gameTypeCard}
      onPress={() => handleCreateGame(gameType.type)}
      activeOpacity={0.8}
    >
      <LinearGradient
        colors={gameType.gradient}
        style={styles.gameTypeGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.gameTypeHeader}>
          <View style={styles.gameTypeInfo}>
            <Text style={styles.gameTypeIcon}>{gameType.icon}</Text>
            <View style={styles.gameTypeDetails}>
              <Text style={styles.gameTypeName}>{gameType.name}</Text>
              <Text style={styles.gameTypePlayers}>{gameType.players}</Text>
            </View>
          </View>
          <View style={styles.gameTypeMeta}>
            <Text style={styles.gameTypeDifficulty}>{gameType.difficulty}</Text>
            <Text style={styles.gameTypeTime}>{gameType.playTime}</Text>
          </View>
        </View>
        <Text style={styles.gameTypeDescription}>{gameType.description}</Text>
        <View style={styles.playButton}>
          <Icon name="play" size={16} color="#fff" />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  const renderActiveGameItem = ({ item: game }) => {
    const gameType = GAME_TYPES.find(gt => gt.type === game.gameType) || GAME_TYPES[0];
    const isUserGame = game.players.includes(currentUser?.uid);

    return (
      <TouchableOpacity
        style={styles.activeGameCard}
        onPress={() => handleJoinGame(game)}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={[COLORS.backgroundLight, COLORS.tabStripBackground]}
          style={styles.activeGameGradient}
        >
          <View style={styles.activeGameHeader}>
            <View style={styles.activeGameInfo}>
              <Text style={styles.activeGameIcon}>{gameType.icon}</Text>
              <View style={styles.activeGameDetails}>
                <Text style={styles.activeGameName}>{gameType.name}</Text>
                <Text style={styles.activeGameStatus}>
                  {game.status === 'waiting' ? 'Waiting for players' :
                    game.status === 'active' ? 'Game in progress' : 'Finished'}
                </Text>
              </View>
            </View>
            <View style={styles.activeGamePlayers}>
              <Icon name="people" size={16} color="#9ca3af" />
              <Text style={styles.activeGamePlayerCount}>
                {game.players.length}/{game.maxPlayers}
              </Text>
            </View>
          </View>

          {isUserGame && (
            <View style={styles.activeGameBadge}>
              <Icon name="checkmark-circle" size={16} color="#10b981" />
              <Text style={styles.activeGameBadgeText}>Your Game</Text>
            </View>
          )}
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    switch (selectedTab) {
      case 'notifications': // Live Users (renamed from Active Now to Live)
        return <LiveUsersTab />;
      case 'battles': // Battles — head-to-head live battles
        return <BattlesContent navigation={navigation} />;
      case 'yourblyp': // Your Blyp — personal recap
        return <YourBlypContent navigation={navigation} />;
      case 'teams': // Teams — official creator agencies
        return <TeamsContent navigation={navigation} />;
      default:
        return null;
    }
  };

  // Horizontal swipe to move between the Live / Battles / Your Blyp header tabs.
  // Built-in PanResponder (gesture-handler is shimmed); only a decisive
  // horizontal swipe is claimed, so inner scrolling is never hijacked.
  const TAB_ORDER = ['notifications', 'battles', 'yourblyp', 'teams'];
  const selectedTabRef = useRef(selectedTab);
  useEffect(() => { selectedTabRef.current = selectedTab; }, [selectedTab]);
  const goToAdjacentTab = useCallback((dir) => {
    const i = TAB_ORDER.indexOf(selectedTabRef.current);
    if (i < 0) return;
    const ni = i + dir;
    if (ni < 0 || ni >= TAB_ORDER.length) return;
    setSelectedTab(TAB_ORDER[ni]);
  }, []);
  const tabSwipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, g) =>
        Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
      onPanResponderRelease: (_evt, g) => {
        const fast = Math.abs(g.vx) > 0.35;
        if (g.dx <= -55 || (fast && g.vx < 0)) goToAdjacentTab(1);
        else if (g.dx >= 55 || (fast && g.vx > 0)) goToAdjacentTab(-1);
      },
    }),
  ).current;

  const useSectionGradient =
    selectedTab === 'notifications' || selectedTab === 'battles' || selectedTab === 'yourblyp' || selectedTab === 'teams';

  return (
    <BlueScreen>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />

        {/* Header â€“ FLOW layout (no overlay) */}
        <BlypHeaderFlow
          tabs={[
            { key: 'notifications', label: 'Live' },
            { key: 'battles', label: 'Battles' },
            { key: 'yourblyp', label: 'Your Blyp' },
            { key: 'teams', label: 'Teams' },
          ]}
          matchHomePadding={true}
          activeKey={selectedTab}
          onTabChange={setSelectedTab}
          onMenuPress={() => setMenuVisible(true)}
          onSearchPress={() => navigation.navigate('Search')}
        />

        <View style={[styles.contentShell, { paddingBottom: tabBarHeight }]} {...tabSwipeResponder.panHandlers}>
          {useSectionGradient && (
            <LinearGradient
              pointerEvents="none"
              colors={[COLORS.pageBackground, COLORS.pageBackground, COLORS.pageBackground]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sectionGradientBackground}
            />
          )}
          <PlanStatusBanner />
          {renderContent()}
        </View>

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
                <Icon name="close" size={24} color="#d1d5db" />
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

        {/* Create Game Modal */}
        <Modal
          visible={showCreateGameModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowCreateGameModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Create New Game</Text>
                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={() => setShowCreateGameModal(false)}
                >
                  <Icon name="close" size={24} color="#9ca3af" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                <Text style={styles.modalSubtitle}>Choose a game type to create:</Text>

                {GAME_TYPES.map((gameType) => (
                  <TouchableOpacity
                    key={gameType.type}
                    style={styles.modalGameOption}
                    onPress={() => handleCreateGame(gameType.type)}
                  >
                    <LinearGradient
                      colors={gameType.gradient}
                      style={styles.modalGameGradient}
                    >
                      <Text style={styles.modalGameIcon}>{gameType.icon}</Text>
                      <View style={styles.modalGameInfo}>
                        <Text style={styles.modalGameName}>{gameType.name}</Text>
                        <Text style={styles.modalGameDesc}>{gameType.description}</Text>
                        <Text style={styles.modalGameMeta}>
                          {gameType.players} â€¢ {gameType.difficulty} â€¢ {gameType.playTime}
                        </Text>
                      </View>
                      <Icon name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
                    </LinearGradient>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </BlueScreen>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  contentShell: {
    flex: 1,
    position: 'relative',
  },
  sectionGradientBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  logoContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuButton: {
    padding: 8,
  },
  headerBalances: {
    position: 'absolute',
    left: 56,
    height: '100%',
    justifyContent: 'center',
  },
  searchButton: {
    padding: 8,
  },
  headerBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerSubtitle: {
    color: COLORS.textMuted,
    fontSize: 16,
    fontWeight: '600',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    padding: 8,
  },
  tabContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  tabSelector: {
    position: 'relative',
    backgroundColor: COLORS.tabStripBackground,
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
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  activeTabText: {
    color: COLORS.textPrimary,
  },
  tabIndicator: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    width: '25%',
    borderRadius: 9999,
    zIndex: 1,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.tabStripBackground,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 16,
  },
  chatList: {
    flex: 1,
  },
  chatListContent: {
    paddingBottom: 100,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  pinnedChat: {
    backgroundColor: 'rgba(0, 210, 190, 0.12)',
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
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.success,
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  chatInfo: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contactName: {
    color: COLORS.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  timestamp: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  messageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    color: COLORS.textMuted,
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  unreadText: {
    color: COLORS.textPrimary,
    fontWeight: '700',
  },
  unreadTimestamp: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  unreadMessage: {
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadCount: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: 'bold',
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    borderRadius: 28,
    elevation: 8,
    shadowColor: COLORS.black,
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
  comingSoon: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  comingSoonTitle: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  comingSoonText: {
    color: COLORS.textMuted,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  launchGamesButton: {
    borderRadius: 25,
    overflow: 'hidden',
  },
  launchGamesGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    gap: 8,
  },
  launchGamesText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 8,
  },
  emptyStateTitle: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 8,
    textAlign: 'center',
  },
  emptyStateText: {
    color: COLORS.textMuted,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 10,
    marginBottom: 30,
  },
  emptyStateButton: {
    borderRadius: 25,
    overflow: 'hidden',
  },
  emptyStateButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingVertical: 15,
  },
  emptyStateButtonText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  // Menu styles
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  menuContainer: {
    width: 250,
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 14,
    padding: 16,
    margin: 16,
    marginTop: 8,
    shadowColor: COLORS.black,
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
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 16,
    textAlign: 'center',
  },
  balanceItems: {
    marginVertical: 8,
  },
  menuBalanceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginVertical: 6,
  },
  balanceIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  balanceLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  balanceValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  getMoreButton: {
    backgroundColor: '#00D2BE',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 8,
    alignItems: 'center',
  },
  menuButtonText: {
    color: '#0A0A0C',
    fontSize: 14,
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
  menuLogoutText: { color: '#FF5A5F', fontWeight: '700', fontSize: 14 },

  // Room styles
  roomsContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: 8,
  },
  roomsContent: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  categoryFilter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  categoryFilterContent: {
    gap: 12,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundLight,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  categoryChipActive: {
    backgroundColor: 'transparent',
    borderColor: COLORS.primary,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  categoryChipTextActive: {
    color: COLORS.primary,
  },
  roomSection: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: COLORS.background,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  countBadge: {
    backgroundColor: 'rgba(0, 210, 190, 0.16)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  countText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  roomCard: {
    marginHorizontal: 10,
    marginVertical: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  roomCardGradient: {
    padding: 20,
    backgroundColor: COLORS.backgroundLight,
  },
  roomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  roomInfo: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roomDetails: {
    flex: 1,
  },
  roomTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  roomName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    flex: 1,
  },
  roomDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 8,
    lineHeight: 20,
  },
  roomMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  categoryText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  participantCount: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  roomActions: {
    justifyContent: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    gap: 4,
  },
  joinedBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  joinedText: {
    color: COLORS.success,
    fontSize: 12,
    fontWeight: '600',
  },
  joinBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderWidth: 1,
    borderColor: COLORS.info,
  },
  joinText: {
    color: COLORS.info,
    fontSize: 12,
    fontWeight: '600',
  },
  fullBadge: {
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
    borderWidth: 1,
    borderColor: COLORS.textMuted,
  },
  fullText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  emptySection: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  emptySectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textMuted,
    marginTop: 8,
    marginBottom: 8,
  },
  emptySectionText: {
    fontSize: 14,
    color: COLORS.textDisabled,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Games styles
  gamesContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: 8,
  },
  gameTabContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  gameTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 12,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundLight,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  activeGameTab: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  gameTabText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },
  activeGameTabText: {
    color: COLORS.textPrimary,
  },
  gamesContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  createGameButton: {
    marginBottom: 20,
    borderRadius: 12,
    overflow: 'hidden',
  },
  createGameGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  createGameText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  gameTypesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  gameTypesTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  gameTypesGrid: {
    paddingBottom: 20,
  },
  gameTypesRow: {
    justifyContent: 'space-between',
  },
  gameTypeCard: {
    flex: 1,
    marginHorizontal: 4,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  gameTypeGradient: {
    padding: 16,
    minHeight: 140,
  },
  gameTypeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  gameTypeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  gameTypeIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  gameTypeDetails: {
    flex: 1,
  },
  gameTypeName: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  gameTypePlayers: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    marginTop: 2,
  },
  gameTypeMeta: {
    alignItems: 'flex-end',
  },
  gameTypeDifficulty: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 11,
    fontWeight: '500',
  },
  gameTypeTime: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 10,
    marginTop: 2,
  },
  gameTypeDescription: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  playButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeGamesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  activeGamesTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  myGamesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  myGamesTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  activeGamesList: {
    paddingBottom: 20,
  },
  myGamesList: {
    paddingBottom: 20,
  },
  activeGameCard: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  activeGameGradient: {
    padding: 16,
    position: 'relative',
  },
  activeGameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeGameInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  activeGameIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  activeGameDetails: {
    flex: 1,
  },
  activeGameName: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  activeGameStatus: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginTop: 2,
  },
  activeGamePlayers: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeGamePlayerCount: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginLeft: 4,
  },
  activeGameBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  activeGameBadgeText: {
    color: COLORS.success,
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },

  // Modal styles for games
  modalGameOption: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalGameGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  modalGameIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  modalGameInfo: {
    flex: 1,
  },
  modalGameName: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  modalGameDesc: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
    marginBottom: 4,
  },
  modalGameMeta: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
  },

  // Live Users Styles
  liveUsersContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  liveUsersHeader: {
    marginBottom: 20,
  },
  liveHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  liveUsersTitle: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    marginLeft: 12,
    flex: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 210, 190, 0.16)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.secondary,
    marginRight: 6,
  },
  liveBadgeText: {
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: '600',
  },
  liveUsersSubtitle: {
    color: COLORS.textMuted,
    fontSize: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 8,
  },
  loadingText: {
    color: COLORS.textMuted,
    fontSize: 16,
    marginTop: 8,
  },
  emptyLiveContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 8,
  },
  emptyLiveTitle: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 8,
  },
  emptyLiveText: {
    color: COLORS.textMuted,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  liveUsersList: {
    flex: 1,
  },
  liveUserCard: {
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  liveUserGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  liveUserInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  liveUserAvatar: {
    position: 'relative',
    marginRight: 16,
  },
  liveUserImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  liveUserImageFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.tabStripBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  liveIndicator: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: COLORS.black,
    borderRadius: 8,
    padding: 2,
  },
  liveIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.secondary,
  },
  liveUserDetails: {
    flex: 1,
  },
  liveUserName: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  liveUserStatus: {
    color: COLORS.secondary,
    fontSize: 14,
    marginBottom: 2,
  },
  liveStreamTitle: {
    color: COLORS.textMuted,
    fontSize: 13,
  },
  liveUserAction: {
    marginLeft: 12,
  },
  watchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  watchButtonText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
});

// Helper function to format balance numbers
const formatBalance = (balance) => {
  if (balance >= 1000000) return (balance / 1000000).toFixed(1) + 'M';
  if (balance >= 1000) return (balance / 1000).toFixed(1) + 'K';
  return balance.toString();
};

export default ChatListScreen;


