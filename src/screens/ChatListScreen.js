import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  Image,
  StatusBar,
  TextInput,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, query, orderBy, onSnapshot, where, doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { subscribeToFollowingList } from '../utils/followUtils';
import { useIsFocused } from '@react-navigation/native';
import BlypLogo from '../components/BlypLogo';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';
import ChatRoomService from '../services/ChatRoomService';
import GameService from '../services/GameService';

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
    icon: '✊', 
    emoji: '✊🖐️✌️',
    players: '2 players',
    description: 'Classic hand game with rock, paper, and scissors',
    gradient: ['#FF6B6B', '#FF8E53'],
    difficulty: 'Easy',
    playTime: '2 min'
  },
  { 
    type: 'tic-tac-toe', 
    name: 'Tic Tac Toe', 
    icon: '⭕', 
    emoji: '❌⭕',
    players: '2 players',
    description: 'Get three in a row to win this classic strategy game',
    gradient: ['#4ECDC4', '#44A08D'],
    difficulty: 'Easy',
    playTime: '3 min'
  },
  { 
    type: 'word-guess', 
    name: 'Word Guess', 
    icon: '🔤', 
    emoji: '🔤💭',
    players: 'Up to 4',
    description: 'Guess the mystery word before time runs out',
    gradient: ['#A8E6CF', '#7FCDCD'],
    difficulty: 'Medium',
    playTime: '5 min'
  },
  { 
    type: 'quick-draw', 
    name: 'Quick Draw', 
    icon: '🎨', 
    emoji: '🎨✏️',
    players: 'Up to 8',
    description: 'Draw and guess in this fast-paced creative game',
    gradient: ['#FFD93D', '#FF6B6B'],
    difficulty: 'Medium',
    playTime: '4 min'
  },
  { 
    type: 'trivia', 
    name: 'Trivia Quiz', 
    icon: '🧠', 
    emoji: '🧠❓',
    players: 'Up to 6',
    description: 'Test your knowledge across various categories',
    gradient: ['#A8EDEA', '#FED6E3'],
    difficulty: 'Hard',
    playTime: '8 min'
  },
  { 
    type: 'memory-match', 
    name: 'Memory Match', 
    icon: '🃏', 
    emoji: '🃏🧩',
    players: 'Up to 4',
    description: 'Match pairs in this brain-training memory game',
    gradient: ['#667eea', '#764ba2'],
    difficulty: 'Medium',
    playTime: '6 min'
  }
];

const ChatListScreen = ({ navigation }) => {
  const [selectedTab, setSelectedTab] = useState('chats');
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
  
  const isFocused = useIsFocused();
  const currentUser = auth.currentUser;



  useEffect(() => {
    if (isFocused && currentUser) {
      loadChats();
      loadFollowingUsers();
      loadBalances();
      if (selectedTab === 'chats') {
        loadRooms();
      } else if (selectedTab === 'requests') {
        loadGames();
      }
    }
  }, [isFocused, currentUser, selectedTab]);
  
  const loadBalances = async () => {
    if (!currentUser) return;
    try {
      const coins = await BlypCoinService.getUserBalance(currentUser.uid);
      const gems = await GemService.getUserGems(currentUser.uid);
      setCoinBalance(coins);
      setGemBalance(gems);
    } catch (error) {
      console.error('Error loading balances:', error);
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
      
      const unsubscribe = onSnapshot(chatsQuery, (snapshot) => {
        const chatData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        // Sort on client side to avoid compound index requirement
        .sort((a, b) => {
          const aTime = a.lastMessageTime?.seconds || 0;
          const bTime = b.lastMessageTime?.seconds || 0;
          return bTime - aTime;
        });
        
        setChats(chatData);
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

    const filtered = chats.filter(chat => 
      chat.participantInfo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      chat.participantInfo.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      chat.lastMessage.text.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
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
        return '📷 Photo';
      case 'video':
        return '🎥 Video';
      case 'audio':
        return '🎵 Audio';
      case 'file':
        return '📄 Document';
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
          <Image source={{ uri: item.participantInfo.avatar }} style={styles.avatar} />
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
                <Ionicons name="pin" size={14} color="#a855f7" />
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
              {item.lastMessage.senderId === 'current_user' ? '✓✓ ' : ''}
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
    const category = ROOM_CATEGORIES.find(cat => cat.id === room.category) || ROOM_CATEGORIES[0];
    const isUserRoom = room.participants.includes(currentUser?.uid);
    const canJoin = !isUserRoom && room.participantCount < room.maxParticipants;

    return (
      <TouchableOpacity
        style={styles.roomCard}
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
                <Ionicons name={category.icon} size={20} color="#fff" />
              </View>
              <View style={styles.roomDetails}>
                <View style={styles.roomTitleRow}>
                  <Text style={styles.roomName} numberOfLines={1}>{room.name}</Text>
                  {room.isPrivate && <Ionicons name="lock-closed" size={16} color="#f59e0b" />}
                </View>
                <Text style={styles.roomDescription} numberOfLines={2}>
                  {room.description || 'No description'}
                </Text>
                <View style={styles.roomMeta}>
                  <Text style={styles.categoryText}>{category.name}</Text>
                  <Text style={styles.participantCount}>
                    {room.participantCount}/{room.maxParticipants} members
                  </Text>
                </View>
              </View>
            </View>
            
            <View style={styles.roomActions}>
              {isUserRoom ? (
                <View style={[styles.statusBadge, styles.joinedBadge]}>
                  <Ionicons name="checkmark" size={16} color="#10b981" />
                  <Text style={styles.joinedText}>Joined</Text>
                </View>
              ) : canJoin ? (
                <TouchableOpacity style={[styles.statusBadge, styles.joinBadge]}>
                  <Ionicons name="add" size={16} color="#3b82f6" />
                  <Text style={styles.joinText}>Join</Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.statusBadge, styles.fullBadge]}>
                  <Ionicons name="people" size={16} color="#6b7280" />
                  <Text style={styles.fullText}>Full</Text>
                </View>
              )}
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
          <Ionicons name={emptyIcon} size={48} color="#374151" />
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
          <Ionicons 
            name={category.icon} 
            size={16} 
            color={selectedCategory === category.id ? '#fff' : category.color} 
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
          <Ionicons name="play" size={16} color="#fff" />
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
          colors={['#1f2937', '#374151']}
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
              <Ionicons name="people" size={16} color="#9ca3af" />
              <Text style={styles.activeGamePlayerCount}>
                {game.players.length}/{game.maxPlayers}
              </Text>
            </View>
          </View>
          
          {isUserGame && (
            <View style={styles.activeGameBadge}>
              <Ionicons name="checkmark-circle" size={16} color="#10b981" />
              <Text style={styles.activeGameBadgeText}>Your Game</Text>
            </View>
          )}
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    switch (selectedTab) {
      case 'chats': // Rooms
        return (
          <View style={styles.roomsContainer}>
            {/* Search Bar */}
            <View style={styles.searchContainer}>
              <View style={styles.searchBar}>
                <Ionicons name="search" size={20} color="#6b7280" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search rooms..."
                  placeholderTextColor="#6b7280"
                  value={roomSearchQuery}
                  onChangeText={setRoomSearchQuery}
                />
              </View>
            </View>

            <ScrollView 
              style={styles.roomsContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Category Filter */}
              {renderCategoryFilter()}

              {/* Active Rooms Section */}
              {activeRooms.length > 0 && (
                <View style={styles.roomSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="pulse-outline" size={24} color="#a855f7" />
                    <Text style={styles.sectionTitle}>Active Rooms</Text>
                    <View style={styles.countBadge}>
                      <Text style={styles.countText}>{activeRooms.length}</Text>
                    </View>
                  </View>
                  {renderRoomSection(
                    activeRooms,
                    'No active rooms',
                    'Rooms with recent activity will appear here',
                    'pulse-outline'
                  )}
                </View>
              )}

              {/* My Rooms Section */}
              {userRooms.length > 0 && (
                <View style={styles.roomSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="chatbubbles-outline" size={24} color="#a855f7" />
                    <Text style={styles.sectionTitle}>My Rooms</Text>
                    <View style={styles.countBadge}>
                      <Text style={styles.countText}>{userRooms.length}</Text>
                    </View>
                  </View>
                  {renderRoomSection(
                    userRooms,
                    'No rooms yet',
                    'Join some rooms to get started',
                    'chatbubbles-outline'
                  )}
                </View>
              )}

              {/* Browse All Rooms Section */}
              <View style={styles.roomSection}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="search-outline" size={24} color="#a855f7" />
                  <Text style={styles.sectionTitle}>Browse Rooms</Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countText}>{rooms.length}</Text>
                  </View>
                </View>
                {renderRoomSection(
                  rooms,
                  'No rooms found',
                  'Try adjusting your search or create a new room',
                  'search-outline'
                )}
              </View>
            </ScrollView>
          </View>
        );
      case 'requests': // Games
        return (
          <View style={styles.gamesContainer}>
            {/* Game Tabs */}
            <View style={styles.gameTabContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {[
                  { key: 'browse', label: 'Browse Games', icon: 'grid-outline' },
                  { key: 'active', label: 'Active Games', icon: 'play-circle-outline' },
                  { key: 'my-games', label: 'My Games', icon: 'trophy-outline' }
                ].map((tab) => (
                  <TouchableOpacity
                    key={tab.key}
                    style={[
                      styles.gameTab,
                      selectedGameTab === tab.key && styles.activeGameTab
                    ]}
                    onPress={() => setSelectedGameTab(tab.key)}
                  >
                    <Ionicons 
                      name={tab.icon} 
                      size={18} 
                      color={selectedGameTab === tab.key ? '#fff' : '#9ca3af'} 
                    />
                    <Text style={[
                      styles.gameTabText,
                      selectedGameTab === tab.key && styles.activeGameTabText
                    ]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Games Content */}
            <ScrollView style={styles.gamesContent} showsVerticalScrollIndicator={false}>
              {selectedGameTab === 'browse' && (
                <View>
                  {/* Create Game Button */}
                  <TouchableOpacity 
                    style={styles.createGameButton}
                    onPress={() => setShowCreateGameModal(true)}
                  >
                    <LinearGradient colors={['#a855f7', '#d946ef']} style={styles.createGameGradient}>
                      <Ionicons name="add-circle-outline" size={24} color="#fff" />
                      <Text style={styles.createGameText}>Create New Game</Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  {/* Game Types Grid */}
                  <View style={styles.gameTypesHeader}>
                    <Ionicons name="game-controller-outline" size={20} color="#a855f7" />
                    <Text style={styles.gameTypesTitle}>Available Games</Text>
                  </View>
                  <FlatList
                    data={GAME_TYPES}
                    renderItem={renderGameTypeItem}
                    keyExtractor={(item) => item.type}
                    numColumns={2}
                    scrollEnabled={false}
                    contentContainerStyle={styles.gameTypesGrid}
                    columnWrapperStyle={styles.gameTypesRow}
                  />
                </View>
              )}

              {selectedGameTab === 'active' && (
                <View>
                  <View style={styles.activeGamesHeader}>
                    <Ionicons name="play-circle-outline" size={20} color="#10b981" />
                    <Text style={styles.activeGamesTitle}>Join Active Games</Text>
                    <View style={styles.countBadge}>
                      <Text style={styles.countText}>{availableGames.length}</Text>
                    </View>
                  </View>
                  
                  {gamesLoading ? (
                    <View style={styles.loadingContainer}>
                      <Text style={styles.loadingText}>Loading games...</Text>
                    </View>
                  ) : availableGames.length === 0 ? (
                    <View style={styles.emptySection}>
                      <Ionicons name="game-controller-outline" size={48} color="#374151" />
                      <Text style={styles.emptySectionTitle}>No Active Games</Text>
                      <Text style={styles.emptySectionText}>
                        No games are currently waiting for players. Create one to get started!
                      </Text>
                    </View>
                  ) : (
                    <FlatList
                      data={availableGames}
                      renderItem={renderActiveGameItem}
                      keyExtractor={(item) => item.id}
                      scrollEnabled={false}
                      contentContainerStyle={styles.activeGamesList}
                    />
                  )}
                </View>
              )}

              {selectedGameTab === 'my-games' && (
                <View>
                  <View style={styles.myGamesHeader}>
                    <Ionicons name="trophy-outline" size={20} color="#f59e0b" />
                    <Text style={styles.myGamesTitle}>My Game History</Text>
                    <View style={styles.countBadge}>
                      <Text style={styles.countText}>{myGames.length}</Text>
                    </View>
                  </View>
                  
                  {gamesLoading ? (
                    <View style={styles.loadingContainer}>
                      <Text style={styles.loadingText}>Loading your games...</Text>
                    </View>
                  ) : myGames.length === 0 ? (
                    <View style={styles.emptySection}>
                      <Ionicons name="trophy-outline" size={48} color="#374151" />
                      <Text style={styles.emptySectionTitle}>No Games Yet</Text>
                      <Text style={styles.emptySectionText}>
                        You haven't played any games yet. Start by creating or joining a game!
                      </Text>
                    </View>
                  ) : (
                    <FlatList
                      data={myGames}
                      renderItem={renderActiveGameItem}
                      keyExtractor={(item) => item.id}
                      scrollEnabled={false}
                      contentContainerStyle={styles.myGamesList}
                    />
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        );
      case 'notifications': // Active Now
        return (
          <View style={styles.comingSoon}>
            <Ionicons name="pulse-outline" size={64} color="#374151" />
            <Text style={styles.comingSoonTitle}>Active Now</Text>
            <Text style={styles.comingSoonText}>
              See who's online and available to play.
            </Text>
          </View>
        );
      case 'groups': // Leaderboard
        return (
          <View style={styles.comingSoon}>
            <Ionicons name="trophy-outline" size={64} color="#374151" />
            <Text style={styles.comingSoonTitle}>Leaderboard</Text>
            <Text style={styles.comingSoonText}>
              Check top players and your ranking.
            </Text>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      
      {/* Header */}
      <View style={styles.headerOverlay}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity style={styles.menuButton} onPress={() => setMenuVisible(true)}>
              <Ionicons name="menu-outline" size={24} color="#d1d5db" />
            </TouchableOpacity>
            <View style={styles.logoContainer}>
              <BlypLogo useGradientBackground={true} />
            </View>
            <TouchableOpacity 
              style={styles.searchButton}
              onPress={() => navigation.navigate('Search')}
            >
              <Ionicons name="search" size={24} color="#d1d5db" />
            </TouchableOpacity>
          </View>
          
          
          <View style={styles.tabContainer}>
            <View style={styles.tabSelector}>
              {[
                { key: 'chats', label: 'Rooms' },
                { key: 'requests', label: 'Games' },
                { key: 'notifications', label: 'Active Now' },
                { key: 'groups', label: 'Leaderboard' }
              ].map((tab, index) => (
                <TouchableOpacity
                  key={tab.key}
                  style={styles.tab}
                  onPress={() => setSelectedTab(tab.key)}
                >
                  <Text style={[
                    styles.tabText,
                    selectedTab === tab.key && styles.activeTabText
                  ]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
              <LinearGradient
                colors={['#a855f7', '#d946ef', '#ec4899']}
                style={[
                  styles.tabIndicator,
                  { 
                    left: `${['chats', 'requests', 'notifications', 'groups'].indexOf(selectedTab) * 25}%` 
                  }
                ]}
              />
            </View>
          </View>
        </View>
      </View>

      {renderContent()}
      
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
              <Ionicons name="close" size={24} color="#d1d5db" />
            </TouchableOpacity>
            <Text style={styles.menuTitle}>Your Wallet</Text>
            
            <View style={styles.balanceItems}>
              <View style={styles.menuBalanceItem}>
                <Text style={styles.balanceIcon}>🪙</Text>
                <Text style={styles.balanceLabel}>Blyp Coins</Text>
                <Text style={styles.balanceValue}>{formatBalance(coinBalance)}</Text>
              </View>
              
              <View style={styles.menuBalanceItem}>
                <Text style={styles.balanceIcon}>💎</Text>
                <Text style={styles.balanceLabel}>Blyp Gems</Text>
                <Text style={styles.balanceValue}>{gemBalance}</Text>
              </View>
            </View>
            
            <TouchableOpacity 
              style={styles.getMoreButton}
              onPress={() => {
                setMenuVisible(false);
                navigation.navigate('CoinStore');
              }}
            >
              <Text style={styles.menuButtonText}>Get More</Text>
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
                <Ionicons name="close" size={24} color="#9ca3af" />
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
                        {gameType.players} • {gameType.difficulty} • {gameType.playTime}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    backgroundColor: '#0f172a',
    paddingTop: 50,
    paddingBottom: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
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
    color: '#9ca3af',
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
    backgroundColor: '#374151',
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
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#ffffff',
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
    backgroundColor: '#374151',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
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
    borderBottomColor: '#1e293b',
  },
  pinnedChat: {
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
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
    backgroundColor: '#10b981',
    borderWidth: 2,
    borderColor: '#0f172a',
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
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
  },
  timestamp: {
    color: '#9ca3af',
    fontSize: 12,
  },
  messageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    color: '#9ca3af',
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  unreadText: {
    color: '#fff',
    fontWeight: '700',
  },
  unreadTimestamp: {
    color: '#a855f7',
    fontWeight: '600',
  },
  unreadMessage: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: '#a855f7',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadCount: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    borderRadius: 28,
    elevation: 8,
    shadowColor: '#000',
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
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  comingSoonText: {
    color: '#9ca3af',
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
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 80,
  },
  emptyStateTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'center',
  },
  emptyStateText: {
    color: '#9ca3af',
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
    color: '#fff',
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
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    margin: 16,
    marginTop: 70,
    shadowColor: '#000',
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
    color: '#ffffff',
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
    color: '#d1d5db',
  },
  balanceValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  getMoreButton: {
    backgroundColor: 'rgba(236, 72, 153, 0.8)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 16,
    alignItems: 'center',
  },
  menuButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  
  // Room styles
  roomsContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingTop: 20,
  },
  roomsContent: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
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
    backgroundColor: '#1f2937',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: '#374151',
  },
  categoryChipActive: {
    backgroundColor: 'transparent',
    borderColor: '#a855f7',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
  },
  categoryChipTextActive: {
    color: '#a855f7',
  },
  roomSection: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#0f172a',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  countBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#a855f7',
  },
  countText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#a855f7',
  },
  roomCard: {
    marginHorizontal: 10,
    marginVertical: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  roomCardGradient: {
    padding: 20,
    backgroundColor: '#1f2937',
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
    color: '#fff',
    flex: 1,
  },
  roomDescription: {
    fontSize: 14,
    color: '#d1d5db',
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
    color: '#a855f7',
    fontWeight: '600',
  },
  participantCount: {
    fontSize: 12,
    color: '#9ca3af',
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
    borderColor: '#10b981',
  },
  joinedText: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
  },
  joinBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  joinText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '600',
  },
  fullBadge: {
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
    borderWidth: 1,
    borderColor: '#6b7280',
  },
  fullText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
  },
  emptySection: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptySectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#9ca3af',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySectionText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Games styles
  gamesContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingTop: 20,
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
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#374151',
  },
  activeGameTab: {
    backgroundColor: '#a855f7',
    borderColor: '#a855f7',
  },
  gameTabText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },
  activeGameTabText: {
    color: '#fff',
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
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  createGameText: {
    color: '#fff',
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
    color: '#fff',
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
    color: '#fff',
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
    color: '#fff',
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
    color: '#fff',
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
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  activeGameStatus: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: 2,
  },
  activeGamePlayers: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeGamePlayerCount: {
    color: '#9ca3af',
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
    color: '#10b981',
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
    color: '#fff',
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
});

// Helper function to format balance numbers
const formatBalance = (balance) => {
  if (balance >= 1000000) return (balance / 1000000).toFixed(1) + 'M';
  if (balance >= 1000) return (balance / 1000).toFixed(1) + 'K';
  return balance.toString();
};

export default ChatListScreen;