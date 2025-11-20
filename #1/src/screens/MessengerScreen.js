import React, { useState, useEffect } from 'react';
import Icon from '../../../src/components/Icon';
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { responsiveFont, responsiveSize, scaleIcon, scalePadding } from '../utils/scaleUtils';
import { collection, query, orderBy, onSnapshot, doc, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp, where, or, and, getDocs } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { subscribeToFollowingList, followUser } from '../utils/followUtils';
import BlypLogo from '../components/BlypLogo';
import SearchBar from '../components/SearchBar';
import Logger from '../utils/Logger';
import { useAuth, useToggle, useArray } from '../hooks/useCommon';
import unreadCountManager from '../utils/unreadCountManager';
const MessengerScreen = ({ navigation }) => {
  // Get screen dimensions
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  
  // State management with improved patterns
  const [selectedTab, setSelectedTab] = useState('chats');
  const [chats, setChats] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [followingUsers, setFollowingUsers] = useState([]);
  const [followingUserIds, setFollowingUserIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const currentUser = auth.currentUser;

  // Calculate total unread messages
  const totalUnreadCount = chats.reduce((total, chat) => {
    const unreadCount = chat.unreadCount?.[currentUser?.uid] || 0;
    return total + unreadCount;
  }, 0);

  useEffect(() => {
    if (!currentUser) return;
    
    // Load chats, following users, all users with proper cleanup
    const unsubscribeChats = loadChats();
    const unsubscribeFollowing = loadFollowingUsers();
    const unsubscribeAllUsers = loadAllUsers();

    return () => {
      if (unsubscribeChats) unsubscribeChats();
      if (unsubscribeFollowing) unsubscribeFollowing();
      if (unsubscribeAllUsers) unsubscribeAllUsers();
    };
  }, [currentUser]);

  // Update unread count manager when total count changes
  useEffect(() => {
    unreadCountManager.setUnreadCount(totalUnreadCount);
    console.log('� Unread count updated:', totalUnreadCount);
  }, [totalUnreadCount]);

  // Update filtered users when following list changes
  useEffect(() => {
    console.log('🔥 MESSENGER: Filtering users - allUsers:', allUsers.length, 'followingIds:', followingUserIds.size);
    if (allUsers.length > 0) {
      // TEMPORARILY SHOW ALL USERS (ignoring following status for testing)  
      const filteredUsers = allUsers.filter(user => 
        user.id !== currentUser.uid
      );
      Logger.firebase('Filtered users for display', { 
        filteredCount: filteredUsers.length,
        users: filteredUsers.map(u => ({ id: u.id, username: u.username }))
      });
    }
  }, [followingUserIds, allUsers, currentUser]);



  const loadChats = () => {
    // Simplified query to avoid Firebase index requirements
    const q = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Sort locally to avoid Firebase composite index
      chatData.sort((a, b) => {
        const aTime = a.lastMessageTime?.toDate?.() || new Date(0);
        const bTime = b.lastMessageTime?.toDate?.() || new Date(0);
        return bTime - aTime;
      });
      
      setChats(chatData);
      setLoading(false);
      Logger.firebase('Loaded chats', { count: chatData.length });
    });

    return unsubscribe;
  };

  const loadFollowingUsers = () => {
    // Subscribe to the list of users the current user is following
    const unsubscribe = subscribeToFollowingList(currentUser.uid, async (followingSet) => {
      setFollowingUserIds(followingSet);
      
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

  const loadAllUsers = () => {
    // Subscribe to all users for the "People you may know" section
    Logger.firebase('Loading all users for current user', { userId: currentUser.uid });
    const q = query(collection(db, 'users'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allUsersData = snapshot.docs.map(doc => ({
        id: doc.id,
        username: doc.data().username || doc.data().displayName || 'Unknown User',
        ...doc.data()
      })).filter(user => user.id !== currentUser.uid); // Only exclude current user
      
      Logger.firebase('Retrieved users from Firebase', { 
        userCount: allUsersData.length, 
        rawDocs: snapshot.docs.length 
      });
      setAllUsers(allUsersData);
    });

    return unsubscribe;
  };



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
        <Text style={styles.headerTitle}>Chats</Text>
        <TouchableOpacity 
          style={styles.searchButton}
          onPress={() => navigation.navigate('Search')}
        >
          <Icon  name="search" size={24} color="#d1d5db"  />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderTabContent = () => {
    console.log('🔥 MESSENGER: Rendering chat list with', chats.length, 'total chats');
    
    // Show all chats that include the current user (like WhatsApp)
    const allUserChats = chats.filter(chat => 
      chat.participants && chat.participants.includes(currentUser.uid)
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
            style={{ flex: 1 }}
            removeClippedSubviews={false}
          />
        )}
      </View>
    );
  };

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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      
      {/* Messenger Header with Tabs */}
      {renderHeader()}

      {/* Tab Content */}
      <View style={styles.tabContent}>
        {renderTabContent()}
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


    </SafeAreaView>
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
    backgroundColor: '#1e293b',
    paddingTop: 40,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#334155',
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

});

export default MessengerScreen;