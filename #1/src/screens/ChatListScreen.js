import React, { useState, useEffect } from 'react';
import Icon from '../../../src/components/Icon';
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, query, orderBy, onSnapshot, where, doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { subscribeToFollowingList } from '../utils/followUtils';
import { useIsFocused } from '@react-navigation/native';
import BlypLogo from '../components/BlypLogo';

const ChatListScreen = ({ navigation }) => {
  const [selectedTab, setSelectedTab] = useState('chats');
  const [chats, setChats] = useState([]);
  const [followingUsers, setFollowingUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredChats, setFilteredChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const isFocused = useIsFocused();
  const currentUser = auth.currentUser;



  useEffect(() => {
    if (isFocused && currentUser) {
      loadChats();
      loadFollowingUsers();
    }
  }, [isFocused, currentUser]);

  useEffect(() => {
    filterChats();
  }, [searchQuery, chats]);

  const loadChats = () => {
    try {
      // Load real chats from Firebase
      const chatsQuery = query(
        collection(db, 'chats'),
        where('participants', 'array-contains', currentUser.uid),
        orderBy('lastMessageTime', 'desc')
      );
      
      const unsubscribe = onSnapshot(chatsQuery, (snapshot) => {
        const chatData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
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
                <Icon  name="pin" size={14} color="#a855f7"  />
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

  const renderContent = () => {
    switch (selectedTab) {
      case 'chats': // Rooms
        return (
          <View style={styles.comingSoon}>
            <Icon  name="home-outline" size={64} color="#374151"  />
            <Text style={styles.comingSoonTitle}>Rooms</Text>
            <Text style={styles.comingSoonText}>
              Join chat rooms and connect with other players.
            </Text>
          </View>
        );
      case 'requests': // Games
        return (
          <View style={styles.comingSoon}>
            <Icon  name="game-controller-outline" size={64} color="#374151"  />
            <Text style={styles.comingSoonTitle}>Games</Text>
            <Text style={styles.comingSoonText}>
              Play interactive games with your friends.
            </Text>
          </View>
        );
      case 'notifications': // Active Now
        return (
          <View style={styles.comingSoon}>
            <Icon  name="pulse-outline" size={64} color="#374151"  />
            <Text style={styles.comingSoonTitle}>Active Now</Text>
            <Text style={styles.comingSoonText}>
              See who's online and available to play.
            </Text>
          </View>
        );
      case 'groups': // Leaderboard
        return (
          <View style={styles.comingSoon}>
            <Icon  name="trophy-outline" size={64} color="#374151"  />
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
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity style={styles.menuButton}>
            <Icon  name="menu" size={24} color="#d1d5db"  />
          </TouchableOpacity>
          <BlypLogo useGradientBackground={true} />
          <TouchableOpacity 
            style={styles.searchButton}
            onPress={() => navigation.navigate('Search')}
          >
            <Icon  name="search" size={24} color="#d1d5db"  />
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

      {renderContent()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 40,
    paddingBottom: 12,
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
});

export default ChatListScreen;