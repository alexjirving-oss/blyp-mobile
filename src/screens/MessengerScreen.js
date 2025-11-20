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
  Image,
  Alert,
  Animated,
  PanResponder,
  PixelRatio,
  Dimensions,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import { responsiveFont, responsiveSize, scaleIcon, scalePadding } from '../utils/scaleUtils';
import { collection, query, orderBy, onSnapshot, doc, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp, where, or, and, getDocs } from 'firebase/firestore';
import { firebaseEnabled, firestore as db } from '../config/firebase';
import { subscribeToFollowingList, followUser } from '../utils/followUtils';
import BlypLogo from '../components/BlypLogo';
import SearchBar from '../components/SearchBar';
import Logger from '../utils/Logger';
import ScreenContainer from '../components/ScreenContainer';
import { useAuth, useToggle, useArray } from '../hooks/useCommon';
import unreadCountManager from '../utils/unreadCountManager';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';
const MessengerScreen = ({ navigation }) => {
  // If Firebase is disabled (stub mode), show a friendly message and skip all listeners
  if (!firebaseEnabled) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <BlypLogo useGradientBackground={false} />
        <Text style={{ color: '#94a3b8', marginTop: 12, textAlign: 'center' }}>
          Messaging is temporarily unavailable in this build.
        </Text>
        <Text style={{ color: '#64748b', marginTop: 6, textAlign: 'center', fontSize: 12 }}>
          Enable Firebase to use chats and live users.
        </Text>
      </SafeAreaView>
    );
  }

  // Get screen dimensions
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  
  // State management with improved patterns
  const [selectedTab, setSelectedTab] = useState('chats');
  const [chats, setChats] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [followingUsers, setFollowingUsers] = useState([]);
  const [followingUserIds, setFollowingUserIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [menuVisible, setMenuVisible] = useState(false);
  const [coinBalance, setCoinBalance] = useState(0);
  const [gemBalance, setGemBalance] = useState(0);
  
  // Use proper authentication state management
  const { user: currentUser, isAuthenticated, loading: authLoading } = useAuth();
  
  // Debug authentication state
  useEffect(() => {
    console.log('🔐 MESSENGER AUTH STATE:', {
      currentUser: currentUser?.uid,
      isAuthenticated,
      authLoading,
      displayName: currentUser?.displayName,
      email: currentUser?.email
    });
  }, [currentUser?.uid, isAuthenticated, authLoading]);

  // Calculate total unread messages (memoized to prevent infinite loops)
  const totalUnreadCount = React.useMemo(() => {
    if (!currentUser?.uid) return 0;
    return chats.reduce((total, chat) => {
      const unreadCount = chat.unreadCount?.[currentUser.uid] || 0;
      return total + unreadCount;
    }, 0);
  }, [chats, currentUser?.uid]);

  useEffect(() => {
    // Only load data when user is authenticated and not loading
    if (authLoading || !isAuthenticated || !currentUser) {
      console.log('⏳ MESSENGER: Waiting for authentication...', { authLoading, isAuthenticated, hasUser: !!currentUser });
      return;
    }
    
    console.log('🚀 MESSENGER: Loading chat data for user:', currentUser.uid);
    
    // Load chats, following users, all users with proper cleanup
    const unsubscribeChats = loadChats();
    const unsubscribeFollowing = loadFollowingUsers();
    const unsubscribeAllUsers = loadAllUsers();
    loadBalances();

    return () => {
      console.log('🧹 MESSENGER: Cleaning up Firebase listeners');
      if (unsubscribeChats) unsubscribeChats();
      if (unsubscribeFollowing) unsubscribeFollowing();
      if (unsubscribeAllUsers) unsubscribeAllUsers();
    };
  // Only depend on authLoading, isAuthenticated, and uid - not the entire currentUser object
  // Using function references in dependencies to ensure they're stable
  }, [authLoading, isAuthenticated, currentUser?.uid, loadChats, loadFollowingUsers, loadAllUsers, loadBalances]);
  
  const loadBalances = React.useCallback(async () => {
    if (!currentUser?.uid) return;
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
  }, [currentUser?.uid]);

  // Update unread count manager when total count changes
  useEffect(() => {
    unreadCountManager.setUnreadCount(totalUnreadCount);
    console.log('📊 MESSENGER: Unread count updated:', totalUnreadCount);
    
    // No cleanup needed for this effect since it's just updating a value
  }, [totalUnreadCount]);

  // Update filtered users when following list changes
  useEffect(() => {
    console.log('🔥 MESSENGER: Filtering users - allUsers:', allUsers.length, 'followingIds:', followingUserIds.size);
    if (allUsers.length > 0 && currentUser?.uid) {
      // TEMPORARILY SHOW ALL USERS (ignoring following status for testing)  
      const filteredUsers = allUsers.filter(user => 
        user.id !== currentUser.uid
      );
      Logger.firebase('Filtered users for display', { 
        filteredCount: filteredUsers.length,
        users: filteredUsers.map(u => ({ id: u.id, username: u.username }))
      });
    }
  }, [followingUserIds, allUsers, currentUser?.uid]);



  const loadChats = React.useCallback(() => {
    try {
      console.log('📥 MESSENGER: Loading chats for user:', currentUser.uid);
      
      // Simplified query to avoid Firebase index requirements
      const q = query(
        collection(db, 'chats'),
        where('participants', 'array-contains', currentUser.uid)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        console.log('📨 MESSENGER: Received chat snapshot with', snapshot.docs.length, 'chats');
        
        const chatData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        console.log('📋 MESSENGER: Chat data:', chatData.map(c => ({ 
          id: c.id, 
          participants: c.participants, 
          lastMessage: c.lastMessage?.slice?.(0, 50) || 'No message'
        })));
        
        // Sort locally to avoid Firebase composite index
        chatData.sort((a, b) => {
          const aTime = a.lastMessageTime?.toDate?.() || new Date(0);
          const bTime = b.lastMessageTime?.toDate?.() || new Date(0);
          return bTime - aTime;
        });
        
        setChats(chatData);
        setLoading(false);
        Logger.firebase('Loaded chats', { count: chatData.length });
      }, (error) => {
        console.error('❌ MESSENGER: Error loading chats:', error);
        setLoading(false);
        Alert.alert('Error', 'Failed to load chats. Please check your connection.');
      });

      return unsubscribe;
    } catch (error) {
      console.error('❌ MESSENGER: Error setting up chat listener:', error);
      setLoading(false);
      return () => {};
    }
  }, [currentUser?.uid]);

  const loadFollowingUsers = React.useCallback(() => {
    if (!currentUser?.uid) return () => {};
    
    // Subscribe to the list of users the current user is following
    const unsubscribe = subscribeToFollowingList(currentUser.uid, (followingSet) => {
      console.log('🔄 MESSENGER: Received following list update with', followingSet.size, 'users');
      setFollowingUserIds(followingSet);
      
      if (followingSet.size === 0) {
        setFollowingUsers([]);
      }
    });
    
    return unsubscribe;
  }, [currentUser?.uid]);
  
  // Separate effect to fetch user data when followingUserIds changes
  useEffect(() => {
    if (!followingUserIds || followingUserIds.size === 0) return;
    
    console.log('🔄 MESSENGER: Fetching data for', followingUserIds.size, 'following users');
    
    const fetchFollowingUserData = async () => {
      try {
        const followingUsersData = [];
        for (const userId of followingUserIds) {
          try {
            const userDoc = await getDoc(doc(db, 'users', userId));
            if (userDoc.exists()) {
              followingUsersData.push({
                id: userDoc.id,
                ...userDoc.data()
              });
            }
          } catch (error) {
            console.error('Error fetching individual user data:', error);
          }
        }
        
        setFollowingUsers(followingUsersData);
      } catch (error) {
        console.error('Error in fetchFollowingUserData:', error);
      }
    };
    
    fetchFollowingUserData();
  }, [followingUserIds]);

  const loadAllUsers = React.useCallback(() => {
    if (!currentUser?.uid) return () => {};
    try {
      // Subscribe to all users for the "People you may know" section
      console.log('👥 MESSENGER: Loading all users for current user:', currentUser.uid);
      Logger.firebase('Loading all users for current user', { userId: currentUser.uid });
      const q = query(collection(db, 'users'));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        console.log('👤 MESSENGER: Received users snapshot with', snapshot.docs.length, 'users');
        
        const allUsersData = snapshot.docs.map(doc => ({
          id: doc.id,
          username: doc.data().username || doc.data().displayName || 'Unknown User',
          ...doc.data()
        })).filter(user => user.id !== currentUser.uid); // Only exclude current user
        
        console.log('✅ MESSENGER: Filtered users:', allUsersData.length, 'users after excluding current user');
        
        Logger.firebase('Retrieved users from Firebase', { 
          userCount: allUsersData.length, 
          rawDocs: snapshot.docs.length 
        });
        setAllUsers(allUsersData);
      }, (error) => {
        console.error('❌ MESSENGER: Error loading users:', error);
        // Don't show alert for users loading error, just log it
      });

      return unsubscribe;
    } catch (error) {
      console.error('❌ MESSENGER: Error setting up users listener:', error);
      return () => {};
    }
  }, [currentUser?.uid]);



  const formatLastMessageTime = (timestamp) => {
    if (!timestamp) return '';
    
    const now = new Date();
    const messageTime = timestamp.toDate();
    const diffInMs = now - messageTime;
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInMinutes < 1) return 'now';
    if (diffInMinutes < 60) return `${diffInMinutes}m`;
    if (diffInHours < 24) return `${diffInHours}h`;
    if (diffInDays < 7) return `${diffInDays}d`;
    
    return messageTime.toLocaleDateString();
  };

  const handleDeleteChat = async (chatId, username) => {
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
              
              // Delete from Firebase - actually delete the document
              const chatRef = doc(db, 'chats', chatId);
              await deleteDoc(chatRef);
              
              // Also delete all messages in the chat
              const messagesRef = collection(db, 'chats', chatId, 'messages');
              const messagesSnapshot = await getDocs(messagesRef);
              
              const deletePromises = messagesSnapshot.docs.map(messageDoc => 
                deleteDoc(doc(db, 'chats', chatId, 'messages', messageDoc.id))
              );
              
              await Promise.all(deletePromises);
              
              Logger.user('Chat and messages deleted successfully');
              Alert.alert('Deleted', `Conversation with ${username} has been permanently deleted.`);
            }
          }
        ]
      );
    } catch (error) {
      console.error('❌ Error deleting chat:', error);
      Alert.alert('Error', 'Failed to delete conversation. Please try again.');
    }
  };

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
              const chatRef = doc(db, 'chats', chatId);
              await updateDoc(chatRef, {
                participants: [],
                deleted: true,
                deletedAt: serverTimestamp()
              });
              console.log('🗑️ Chat deleted:', chatId);
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
    
    // Find other participant
    const otherParticipant = allUsers.find(user => 
      item.participants.includes(user.id) && user.id !== currentUser.uid
    );

    console.log('🧑‍🤝‍🧑 SWIPEABLE: Chat participants:', item.participants);
    console.log('👥 SWIPEABLE: All users count:', allUsers.length);
    console.log('👤 SWIPEABLE: Current user:', currentUser.uid);
    console.log('🔍 SWIPEABLE: Other participant found:', otherParticipant ? otherParticipant.username : 'NOT FOUND');

    if (!otherParticipant) {
      // Create a fallback participant if we can't find the user
      const otherParticipantId = item.participants.find(id => id !== currentUser.uid);
      if (!otherParticipantId) {
        console.log('❌ SWIPEABLE: No other participant ID found');
        return null;
      }
      
      console.log('⚠️ SWIPEABLE: Creating fallback participant for ID:', otherParticipantId);
      const fallbackParticipant = {
        id: otherParticipantId,
        username: item.participantNames?.find(name => name !== currentUser.displayName) || 'Unknown User'
      };
      
      return renderChatItemContent(item, fallbackParticipant, panX);
    }

    return renderChatItemContent(item, otherParticipant, panX);
  };

  const renderChatItemContent = (item, otherParticipant, panX) => {
    // Calculate unread count for current user
    const unreadCount = item.unreadCount?.[currentUser.uid] || 0;
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
          <Icon  name="trash" size={24} color="#fff"  />
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
                backgroundColor: hasUnread ? 'rgba(37, 211, 102, 0.08)' : '#1e293b',
                borderLeftWidth: hasUnread ? 4 : 0,
                borderLeftColor: hasUnread ? '#25d366' : 'transparent'
              }
            ]}
            onPress={() => navigation.navigate('ChatConversation', { 
              chatId: item.id,
              otherUser: otherParticipant 
            })}
            activeOpacity={0.7}
          >
            <View style={styles.avatarContainer}>
              <View style={[
                styles.defaultAvatar,
                hasUnread && { borderWidth: 2, borderColor: '#00D4AA' }
              ]}>
                <Text style={styles.avatarText}>
                  {otherParticipant.username?.charAt(0).toUpperCase() || '?'}
                </Text>
              </View>
              {hasUnread && <View style={styles.unreadIndicator} />}
            </View>
            
            <View style={styles.chatContent}>
              <View style={styles.chatHeader}>
                <Text style={[
                  styles.chatName,
                  hasUnread && { color: '#00D4AA', fontWeight: 'bold' }
                ]}>
                  {otherParticipant.username || 'Unknown User'}
                </Text>
                <Text style={[
                  styles.chatTime,
                  hasUnread && { color: '#00D4AA', fontWeight: '600' }
                ]}>
                  {formatLastMessageTime(item.lastMessageTime)}
                </Text>
              </View>
              
              <View style={styles.messagePreview}>
                <Text style={[
                  styles.lastMessage,
                  hasUnread && { color: '#d1d5db', fontWeight: '600' }
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

  const renderChatItem = ({ item }) => {
    console.log('📱 renderChatItem called for chat:', item.id, 'participants:', item.participants);
    console.log('📊 Chat unread data:', item.unreadCount, 'lastMessage:', item.lastMessage);
    
    // Find other participant
    const otherParticipant = allUsers.find(user => 
      item.participants.includes(user.id) && user.id !== currentUser.uid
    );
    
    // Create fallback participant if not found in allUsers
    if (!otherParticipant) {
      const otherParticipantId = item.participants.find(id => id !== currentUser.uid);
      if (!otherParticipantId) return null;
      
      const fallbackParticipant = {
        id: otherParticipantId,
        username: item.participantNames?.find(name => name !== currentUser.displayName) || 'Unknown User'
      };
      
      return renderChatBar(item, fallbackParticipant);
    }
    
    return renderChatBar(item, otherParticipant);
  };

  // Create a separate component for swipeable chat items
  const SwipeableChatBar = ({ item, otherParticipant }) => {
    const unreadCount = item.unreadCount?.[currentUser.uid] || 0;
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
              hasUnread && { backgroundColor: 'rgba(0, 212, 170, 0.1)' }
            ]}
            onPress={() => {
              console.log('🎯 Chat tapped:', item.id, 'with:', otherParticipant.username);
              navigation.navigate('ChatConversation', { 
                chatId: item.id,
                otherUser: otherParticipant 
              });
            }}
            activeOpacity={0.7}
          >
            <View style={styles.avatarContainer}>
              <View style={[
                styles.defaultAvatar,
                hasUnread && { borderWidth: 2, borderColor: '#00D4AA' }
              ]}>
                <Text style={styles.avatarText}>
                  {otherParticipant.username?.charAt(0).toUpperCase() || '?'}
                </Text>
              </View>
              {hasUnread && <View style={styles.unreadIndicator} />}
            </View>
            
            <View style={styles.chatContent}>
              <View style={styles.chatHeader}>
                <Text style={[
                  styles.chatName,
                  hasUnread && { color: '#00D4AA', fontWeight: 'bold' }
                ]}>
                  {otherParticipant.username || 'Unknown User'}
                </Text>
                <Text style={[
                  styles.chatTime,
                  hasUnread && { color: '#00D4AA', fontWeight: '600' }
                ]}>
                  {formatLastMessageTime(item.lastMessageTime)}
                </Text>
              </View>
              
              <View style={styles.messagePreview}>
                <Text style={[
                  styles.lastMessage,
                  hasUnread && { color: '#d1d5db', fontWeight: '600' }
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
        {item.avatar ? (
          <Image source={{ uri: item.avatar }} style={styles.avatar} />
        ) : (
          <View style={styles.defaultAvatar}>
            <Text style={styles.avatarText}>
              {item.username?.charAt(0).toUpperCase() || '?'}
            </Text>
          </View>
        )}
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
          <Icon  name="chatbubble" size={18} color="#fff"  />
        </TouchableOpacity>
      </View>
    </View>
  );

  const handleFollowUser = async (user) => {
    try {
      const result = await followUser(currentUser.uid, user.id);
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
      console.log('🚀 Starting new chat with:', otherUser.username, 'ID:', otherUser.id);
      console.log('👤 Current user:', currentUser.uid);
      
      // Check if chat already exists more thoroughly
      const existingChat = chats.find(chat => 
        chat.participants.includes(currentUser.uid) && 
        chat.participants.includes(otherUser.id)
      );

      if (existingChat) {
        console.log('💬 Found existing chat:', existingChat.id);
        navigation.navigate('ChatConversation', { 
          chatId: existingChat.id,
          otherUser: otherUser 
        });
        return;
      }

      // Double-check in Firebase to avoid duplicates
      const chatsRef = collection(db, 'chats');
      const q = query(chatsRef, where('participants', 'array-contains', currentUser.uid));
      const querySnapshot = await getDocs(q);
      
      let foundChat = null;
      querySnapshot.forEach((doc) => {
        const chatData = doc.data();
        if (chatData.participants.includes(otherUser.id)) {
          foundChat = { id: doc.id, ...chatData };
        }
      });

      if (foundChat) {
        console.log('💬 Found existing chat in Firebase:', foundChat.id);
        navigation.navigate('ChatConversation', { 
          chatId: foundChat.id,
          otherUser: otherUser 
        });
        return;
      }

      // Create new chat
      const newChat = {
        participants: [currentUser.uid, otherUser.id],
        participantNames: [currentUser.displayName || 'Unknown', otherUser.username || otherUser.displayName || 'Unknown'],
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageTime: serverTimestamp(),
        unreadCount: { [currentUser.uid]: 0, [otherUser.id]: 0 }
      };

      console.log('📝 Creating new chat with data:', newChat);
      const chatDoc = await addDoc(chatsRef, newChat);
      console.log('✅ Chat created with ID:', chatDoc.id);
      
      navigation.navigate('ChatConversation', { 
        chatId: chatDoc.id,
        otherUser: otherUser 
      });
    } catch (error) {
      console.error('Error starting new chat:', error);
      Alert.alert('Error', 'Failed to start new chat');
    }
  };



  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <TouchableOpacity style={styles.menuButton} onPress={() => setMenuVisible(true)}>
          <Icon  name="menu" size={24} color="#d1d5db"  />
        </TouchableOpacity>
        <View style={styles.logoContainer}>
          <BlypLogo useGradientBackground={true} />
        </View>
        <TouchableOpacity 
          style={styles.searchButton}
          onPress={() => navigation.navigate('Search')}
        >
          <Icon  name="search" size={24} color="#d1d5db"  />
        </TouchableOpacity>
      </View>
      
      {/* Tab Selector */}
      <View style={styles.tabContainer}>
        <View style={styles.tabSelector}>
          <TouchableOpacity 
            style={styles.tab}
            onPress={() => setSelectedTab('chats')}
          >
            <Text style={[
              styles.tabText,
              selectedTab === 'chats' && styles.activeTabText
            ]}>
              Chats
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.tab}
            onPress={() => setSelectedTab('calls')}
          >
            <Text style={[
              styles.tabText,
              selectedTab === 'calls' && styles.activeTabText
            ]}>
              Calls
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.tab}
            onPress={() => setSelectedTab('groups')}
          >
            <Text style={[
              styles.tabText,
              selectedTab === 'groups' && styles.activeTabText
            ]}>
              Groups
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.tab}
            onPress={() => setSelectedTab('status')}
          >
            <Text style={[
              styles.tabText,
              selectedTab === 'status' && styles.activeTabText
            ]}>
              Status
            </Text>
          </TouchableOpacity>
          
          {/* Tab Indicator */}
          <View style={[
            styles.tabIndicator,
            {
              left: selectedTab === 'chats' ? '2%' :
                    selectedTab === 'calls' ? '27%' :
                    selectedTab === 'groups' ? '52%' : '77%'
            }
          ]}>
            <LinearGradient
              colors={['#25d366', '#128c7e']}
              style={styles.tabIndicatorGradient}
            />
          </View>
        </View>
      </View>
    </View>
  );

  const renderTabContent = React.useMemo(() => {
    console.log('🔥 MESSENGER: Rendering tab content for:', selectedTab);
    console.log('👤 MESSENGER: Current user ID:', currentUser?.uid);
    console.log('📊 MESSENGER: Loading state:', loading);
    
    switch (selectedTab) {
      case 'chats':
        // Show all chats that include the current user (WhatsApp style)
        const allUserChats = chats.filter(chat => 
          chat.participants && chat.participants.includes(currentUser?.uid)
        );
        
        console.log('💬 MESSENGER: Showing', allUserChats.length, 'conversations');
        
        return (
          <View style={styles.chatsList}>
            {allUserChats.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon  name="chatbubble-ellipses-outline" size={64} color="#6b7280"  />
                <Text style={styles.emptyTitle}>No conversations yet</Text>
                <Text style={styles.emptySubtitle}>
                  Start chatting with someone from your network
                </Text>
                <TouchableOpacity 
                  style={styles.newChatButton}
                  onPress={() => navigation.navigate('FindPeople')}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={['#a855f7', '#d946ef', '#ec4899']}
                    style={styles.newChatButtonGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Icon  name="add-circle" size={22} color="#fff" style={styles.newChatIcon}  />
                    <Text style={styles.newChatButtonText}>Start New Chat</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={allUserChats}
                renderItem={renderChatItem}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                style={styles.chatList}
                removeClippedSubviews={false}
              />
            )}
          </View>
        );
        
      case 'calls':
        return (
          <View style={styles.emptyState}>
            <Icon  name="call-outline" size={64} color="#6b7280"  />
            <Text style={styles.emptyTitle}>No recent calls</Text>
            <Text style={styles.emptySubtitle}>
              Your call history will appear here
            </Text>
          </View>
        );
        
      case 'groups':
        return (
          <View style={styles.emptyState}>
            <Icon  name="people-outline" size={64} color="#6b7280"  />
            <Text style={styles.emptyTitle}>No groups yet</Text>
            <Text style={styles.emptySubtitle}>
              Create or join groups to start chatting
            </Text>
          </View>
        );
        
      case 'status':
        return (
          <View style={styles.emptyState}>
            <Icon  name="radio-outline" size={64} color="#6b7280"  />
            <Text style={styles.emptyTitle}>No status updates</Text>
            <Text style={styles.emptySubtitle}>
              Share your status with friends
            </Text>
          </View>
        );
        
      default:
        return null;
    }
  }, [selectedTab, chats, currentUser?.uid, loading, allUsers, followingUsers]);

  // Simple user list for messaging
  const renderSimpleChatList = () => {
    console.log('🔥 MESSENGER: WARNING - renderSimpleChatList called (this should not be used anymore)', allUsers.length, 'users');
    
    return (
      <FlatList
        data={allUsers.filter(user => user.id !== currentUser.uid)}
        renderItem={renderSimpleChatItem}
        keyExtractor={(item) => item.id}
        style={styles.chatList}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={() => (
          <View style={styles.emptyState}>
            <Icon  name="chatbubbles-outline" size={64} color="#6b7280"  />
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
  if (authLoading) {
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
  if (!isAuthenticated || !currentUser) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
        <View style={styles.authRequiredContainer}>
          <Icon  name="chatbubbles-outline" size={64} color="#6b7280"  />
          <Text style={styles.authRequiredTitle}>Authentication Required</Text>
          <Text style={styles.authRequiredText}>Please sign in to access your messages</Text>
          <TouchableOpacity 
            style={styles.signInButton}
            onPress={() => {
              // Since authentication is handled at the app level,
              // we can just show a message or navigate to profile
              Alert.alert(
                'Authentication Required',
                'Please sign in from the app home screen to access messaging features.',
                [{ text: 'OK', style: 'default' }]
              );
            }}
          >
            <Text style={styles.signInButtonText}>OK</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <ScreenContainer style={styles.container}>      
      {/* Messenger Header with Tabs */}
      <View style={styles.headerOverlay}>
        {renderHeader()}
      </View>

      {/* Tab Content */}
      <View style={styles.tabContent}>
        {renderTabContent}
      </View>

      {/* Floating Action Button for Find People */}
      <TouchableOpacity 
        style={styles.fab}
        onPress={() => {
          console.log('🚀 FAB pressed - navigating to FindPeople');
          navigation.navigate('FindPeople');
        }}
      >
        <LinearGradient
          colors={['#25d366', '#128c7e']} // WhatsApp green colors
          style={styles.fabGradient}
        >
          <Icon  name="chatbubble" size={24} color="#fff"  />
        </LinearGradient>
      </TouchableOpacity>

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
              <Icon  name="close" size={24} color="#d1d5db"  />
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

    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  tabContent: {
    flex: 1,
  },
  // WhatsApp-style Header
  whatsappHeader: {
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    paddingTop: 50,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
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
    color: '#fff',
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
  whatsappChatItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
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
    backgroundColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
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
    backgroundColor: '#10b981',
    borderWidth: 2,
    borderColor: '#0f172a',
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
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  chatTime: {
    color: '#9ca3af',
    fontSize: 12,
  },
  messagePreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    color: '#9ca3af',
    fontSize: 14,
    flex: 1,
  },
  newChatMessage: {
    fontStyle: 'italic',
    color: '#6b7280',
  },
  unreadBadge: {
    backgroundColor: '#DC2626', // WhatsApp red
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    elevation: 3,
    shadowColor: '#DC2626',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
  unreadCount: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  chatItemUnread: {
    elevation: 2,
    shadowColor: '#25d366',
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
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
    textAlign: 'center',
  },
  emptyStateText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#a855f7',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    marginTop: 16,
  },
  newChatButtonText: {
    color: '#fff',
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
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  menuButton: {
    padding: 8,
  },
  logoContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
    color: '#ec4899',
    textShadowColor: 'rgba(168, 85, 247, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  searchButton: {
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
    color: '#9ca3af',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  comingSoonText: {
    color: '#6b7280',
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
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
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
    backgroundColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
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
    backgroundColor: '#10b981',
    borderWidth: 2,
    borderColor: '#0f172a',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  userStatus: {
    color: '#9ca3af',
    fontSize: 14,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  followButton: {
    backgroundColor: '#a855f7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  followButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  messageButton: {
    backgroundColor: '#1f2937',
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
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  sectionSubtitle: {
    color: '#9ca3af',
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
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
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
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  deleteText: {
    color: '#fff',
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
    backgroundColor: 'rgba(0, 212, 170, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#00D4AA',
  },
  // Avatar styles with unread indicators
  avatarUnread: {
    borderWidth: 2,
    borderColor: '#00D4AA',
  },
  defaultAvatarUnread: {
    borderWidth: 2,
    borderColor: '#00D4AA',
  },
  unreadIndicator: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#00D4AA',
    borderWidth: 2,
    borderColor: '#0f172a',
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
    color: '#fff',
  },
  chatNameUnread: {
    color: '#00D4AA',
    fontWeight: 'bold',
  },
  chatTime: {
    fontSize: 12,
    color: '#8e9297',
  },
  chatTimeUnread: {
    color: '#00D4AA',
    fontWeight: '600',
  },
  messagePreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    fontSize: 14,
    color: '#8e9297',
    flex: 1,
    marginRight: 8,
  },
  lastMessageUnread: {
    color: '#d1d5db',
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: '#00D4AA',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadCount: {
    color: '#fff',
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
    backgroundColor: '#22c55e',
    borderWidth: 2,
    borderColor: '#0f172a',
  },
  // Welcome screen styles
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
    fontSize: responsiveFont(18),
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
    fontSize: responsiveFont(20),
    marginRight: 8,
  },
  balanceLabel: {
    flex: 1,
    fontSize: responsiveFont(14),
    color: '#d1d5db',
  },
  balanceValue: {
    fontSize: responsiveFont(16),
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
    fontSize: responsiveFont(14),
    fontWeight: 'bold',
  },
  // Loading screen styles
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    color: '#fff',
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
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 16,
    textAlign: 'center',
  },
  authRequiredText: {
    color: '#9ca3af',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  signInButton: {
    backgroundColor: '#a855f7',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 25,
  },
  signInButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

// Helper function to format balance numbers
const formatBalance = (balance) => {
  if (balance >= 1000000) return (balance / 1000000).toFixed(1) + 'M';
  if (balance >= 1000) return (balance / 1000).toFixed(1) + 'K';
  return balance.toString();
};

export default MessengerScreen;