import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  StatusBar,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, orderBy, onSnapshot, doc, getDoc, addDoc, serverTimestamp, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { subscribeToFollowingList, followUser } from '../utils/followUtils';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';

const FindPeopleScreen = ({ navigation }) => {
  const [searchText, setSearchText] = useState('');
  const [allUsers, setAllUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [recommendedUsers, setRecommendedUsers] = useState([]);
  const [followingUserIds, setFollowingUserIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const currentUser = auth.currentUser;

  useEffect(() => {
    console.log('🔍 FIND PEOPLE: Screen mounted');
    loadUsers();
    loadFollowingUsers();
  }, []);

  useEffect(() => {
    filterUsers();
  }, [searchText, allUsers]);

  const loadUsers = async () => {
    try {
      console.log('🔍 FIND PEOPLE: Loading users...');
      console.log('🔍 FIND PEOPLE: Current user ID:', currentUser?.uid);
      
      const usersRef = collection(db, 'users');
      // Remove orderBy to avoid indexing issues, just get all users
      
      const unsubscribe = onSnapshot(usersRef, (snapshot) => {
        console.log('🔍 FIND PEOPLE: Got Firebase snapshot with', snapshot.docs.length, 'users');
        
        const usersList = [];
        snapshot.forEach((doc) => {
          const userData = { id: doc.id, ...doc.data() };
          console.log('🔍 FIND PEOPLE: Processing user:', userData.id, userData.username || userData.displayName || 'No name');
          
          // Don't include current user in the list
          if (userData.id !== currentUser?.uid) {
            usersList.push(userData);
          } else {
            console.log('🔍 FIND PEOPLE: Skipping current user');
          }
        });
        
        console.log('🔍 FIND PEOPLE: Final users list:', usersList.length, 'users');
        console.log('🔍 FIND PEOPLE: Users details:', usersList.map(u => ({id: u.id, username: u.username || u.displayName})));
        
        setAllUsers(usersList);
        
        // Set recommended users (first 10 users for now)
        const recommended = usersList.slice(0, 10);
        console.log('🔍 FIND PEOPLE: Setting recommended users:', recommended.length);
        setRecommendedUsers(recommended);
        setLoading(false);
      }, (error) => {
        console.error('🔍 FIND PEOPLE: Snapshot error:', error);
        setLoading(false);
      });
      
      return unsubscribe;
    } catch (error) {
      console.error('🔍 FIND PEOPLE: Error loading users:', error);
      setLoading(false);
    }
  };

  const loadFollowingUsers = () => {
    const unsubscribe = subscribeToFollowingList(currentUser.uid, (followingSet) => {
      setFollowingUserIds(followingSet);
    });
    return unsubscribe;
  };

  const filterUsers = () => {
    console.log('🔍 FIND PEOPLE: Filtering users for search text:', searchText);
    console.log('🔍 FIND PEOPLE: Available users to filter:', allUsers.length);
    
    if (!searchText.trim()) {
      console.log('🔍 FIND PEOPLE: No search text, clearing filtered users');
      setFilteredUsers([]);
      return;
    }

    const filtered = allUsers.filter(user => 
      user.username?.toLowerCase().includes(searchText.toLowerCase()) ||
      user.displayName?.toLowerCase().includes(searchText.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchText.toLowerCase())
    );
    
    console.log('🔍 FIND PEOPLE: Filtered results:', filtered.length, 'users');
    console.log('🔍 FIND PEOPLE: Filtered users:', filtered.map(u => ({id: u.id, username: u.username})));
    
    setFilteredUsers(filtered);
  };

  const startNewChat = async (otherUser) => {
    try {
      console.log('🚀 Starting new chat with:', otherUser.username, 'from Find People');
      
      // Check if chat already exists in Firebase
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
        console.log('💬 Found existing chat:', foundChat.id);
        navigation.navigate('ChatConversation', { 
          chatId: foundChat.id,
          otherUser: otherUser 
        });
        return;
      }

      // Create new chat
      const newChat = {
        participants: [currentUser.uid, otherUser.id],
        participantNames: [currentUser.displayName || currentUser.email || 'Unknown', otherUser.username || otherUser.displayName || 'Unknown'],
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageTime: serverTimestamp(),
        unreadCount: { [currentUser.uid]: 0, [otherUser.id]: 0 }
      };

      console.log('📝 Creating new chat from Find People:', newChat);
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

  const handleFollow = async (userId) => {
    try {
      await followUser(currentUser.uid, userId);
      Alert.alert('Success', 'User followed successfully!');
    } catch (error) {
      console.error('Error following user:', error);
      Alert.alert('Error', 'Failed to follow user');
    }
  };

  const renderUserItem = ({ item }) => {
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
            <Ionicons name="chatbubble" size={16} color="#fff" />
            <Text style={styles.actionButtonText}>Message</Text>
          </TouchableOpacity>
          
          {!isFollowing && (
            <TouchableOpacity
              style={[styles.actionButton, styles.followButton]}
              onPress={() => handleFollow(item.id)}
            >
              <Ionicons name="person-add" size={16} color="#00D4AA" />
              <Text style={[styles.actionButtonText, { color: '#00D4AA' }]}>Follow</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderSectionHeader = (title, subtitle) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      <LinearGradient
        colors={['#0f172a', '#1e293b', '#334155']}
        style={styles.gradient}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color="#d1d5db" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Find People</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputContainer}>
            <Ionicons name="search" size={20} color="#8e9297" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by username, name, or email..."
              placeholderTextColor="#8e9297"
              value={searchText}
              onChangeText={setSearchText}
            />
            {searchText.length > 0 && (
              <TouchableOpacity onPress={() => setSearchText('')}>
                <Ionicons name="close-circle" size={20} color="#8e9297" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Content */}
        <View style={styles.content}>
          {(() => {
            console.log('🔍 FIND PEOPLE: Rendering content. Search text:', searchText.trim());
            console.log('🔍 FIND PEOPLE: Filtered users count:', filteredUsers.length);
            console.log('🔍 FIND PEOPLE: Recommended users count:', recommendedUsers.length);
            console.log('🔍 FIND PEOPLE: Loading state:', loading);
            return null;
          })()}
          {searchText.trim() ? (
            // Search Results
            <>
              {renderSectionHeader(
                `Search Results (${filteredUsers.length})`,
                searchText.trim() ? `Searching for "${searchText}"` : ''
              )}
              <FlatList
                data={filteredUsers}
                renderItem={renderUserItem}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Ionicons name="search" size={48} color="#4b5563" />
                    <Text style={styles.emptyStateText}>No users found</Text>
                    <Text style={styles.emptyStateSubtext}>Try a different search term</Text>
                  </View>
                }
              />
            </>
          ) : (
            // Recommended Users
            <>
              {renderSectionHeader(
                'Recommended for You',
                'People you might want to connect with'
              )}
              <FlatList
                data={recommendedUsers}
                renderItem={renderUserItem}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  loading ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyStateText}>Loading users...</Text>
                    </View>
                  ) : (
                    <View style={styles.emptyState}>
                      <Ionicons name="people" size={48} color="#4b5563" />
                      <Text style={styles.emptyStateText}>No users found</Text>
                      <Text style={styles.emptyStateSubtext}>Check back later for new users</Text>
                    </View>
                  )
                }
              />
            </>
          )}
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  gradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: responsiveFont(20),
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSpacer: {
    width: 40,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 25,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
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
    color: '#fff',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#8e9297',
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
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
    color: '#fff',
    marginBottom: 4,
  },
  userBio: {
    fontSize: 14,
    color: '#8e9297',
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
    backgroundColor: '#00D4AA',
  },
  followButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#00D4AA',
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#8e9297',
    marginTop: 16,
    marginBottom: 4,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#6b7280',
  },
});

export default FindPeopleScreen;