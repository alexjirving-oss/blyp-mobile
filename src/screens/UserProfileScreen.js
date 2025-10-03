import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Image,
  FlatList,
  Dimensions,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { useIsFocused } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { responsiveFont } from '../utils/scaleUtils';
import ScreenContainer from '../components/ScreenContainer';

const { width: screenWidth } = Dimensions.get('window');

const UserProfileScreen = ({ route, navigation }) => {
  const { userId, username } = route.params;
  const [userProfile, setUserProfile] = useState(null);
  const [userPosts, setUserPosts] = useState([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const isFocused = useIsFocused();
  const currentUser = auth.currentUser;

  useEffect(() => {
    if (isFocused) {
      fetchUserProfile();
      fetchUserPosts();
      checkFollowStatus();
    }
  }, [isFocused, userId]);

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

  const fetchUserPosts = async () => {
    try {
      // Fetch real user posts from Firebase
      const postsQuery = query(
        collection(db, 'posts'),
        where('userId', '==', userId)
      );
      
      const querySnapshot = await getDocs(postsQuery);
      const posts = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Sort posts by date (newest first)
      posts.sort((a, b) => {
        if (a.date && b.date) {
          return b.date.toMillis() - a.date.toMillis();
        }
        return 0;
      });
      
      setUserPosts(posts);
      console.log(`📱 UserProfile: Loaded ${posts.length} posts for user ${userId}`);
      console.log('📱 UserProfile: Sample post data:', posts[0] ? posts[0] : 'No posts found');
    } catch (error) {
      console.error('Error fetching user posts:', error);
      setUserPosts([]);
    } finally {
      setLoading(false);
    }
  };

  const checkFollowStatus = async () => {
    if (!currentUser) return;
    
    try {
      // Check real follow status using follow utilities
      const { isFollowing: checkIsFollowing } = require('../utils/followUtils');
      const followStatus = await checkIsFollowing(currentUser.uid, userId);
      setIsFollowing(followStatus);
    } catch (error) {
      console.error('Error checking follow status:', error);
    }
  };

  const handleFollowToggle = async () => {
    if (!currentUser) {
      Toast.show({
        type: 'error',
        text1: 'Please login to follow users',
        position: 'bottom',
      });
      return;
    }

    try {
      const { followUser, unfollowUser } = require('../utils/followUtils');
      
      if (isFollowing) {
        // Unfollow the user
        await unfollowUser(currentUser.uid, userId);
        setIsFollowing(false);
        setFollowerCount(prev => Math.max(0, prev - 1));
        
        Toast.show({
          type: 'success',
          text1: `Unfollowed ${username}`,
          position: 'bottom',
        });
      } else {
        // Follow the user
        await followUser(currentUser.uid, userId);
        setIsFollowing(true);
        setFollowerCount(prev => prev + 1);
        
        Toast.show({
          type: 'success',
          text1: `Following ${username}!`,
          position: 'bottom',
        });
      }
    } catch (error) {
      console.error('Error updating follow status:', error);
      // Revert on error
      setIsFollowing(!isFollowing);
      setFollowerCount(prev => isFollowing ? prev + 1 : prev - 1);
    }
  };

  const handlePostPress = (post) => {
    navigation.navigate('MediaViewer', { post });
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
            <Ionicons name="image" size={24} color="#6b7280" />
          </View>
        )}
        {isVideo && (
          <View style={styles.videoIndicator}>
            <Ionicons name="play" size={16} color="#fff" />
          </View>
        )}
        <View style={styles.postOverlay}>
          <View style={styles.postStats}>
            <View style={styles.postStat}>
              <Ionicons name="heart" size={12} color="#fff" />
              <Text style={styles.postStatText}>{formatNumber(item.likes || item.likeCount || 0)}</Text>
            </View>
            <View style={styles.postStat}>
              <Ionicons name="eye" size={12} color="#fff" />
              <Text style={styles.postStatText}>{formatNumber(item.views || 0)}</Text>
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
        <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
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
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{userProfile?.displayName}</Text>
        <TouchableOpacity style={styles.moreButton}>
          <Ionicons name="ellipsis-horizontal" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Info */}
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            {userProfile?.avatar ? (
              <Image source={{ uri: userProfile.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Ionicons name="person" size={40} color="#6b7280" />
              </View>
            )}
            {userProfile?.verified && (
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark" size={12} color="#fff" />
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
              <Text style={styles.statNumber}>{userPosts.length}</Text>
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
          {currentUser?.uid !== userId && (
            <View style={styles.actionButtons}>
              <TouchableOpacity 
                style={[styles.followButton, isFollowing && styles.followingButton]}
                onPress={handleFollowToggle}
              >
                <LinearGradient
                  colors={isFollowing ? ['#374151', '#4b5563'] : ['#a855f7', '#d946ef']}
                  style={styles.followButtonGradient}
                >
                  <Text style={styles.followButtonText}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.messageButton}>
                <Ionicons name="chatbubble-outline" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Posts Grid */}
        <View style={styles.postsSection}>
          <Text style={styles.sectionTitle}>Posts</Text>
          <FlatList
            data={userPosts}
            renderItem={renderPostItem}
            keyExtractor={(item) => item.id}
            numColumns={3}
            scrollEnabled={false}
            contentContainerStyle={styles.postsGrid}
          />
        </View>
      </ScrollView>
      </SafeAreaView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
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
    borderBottomColor: '#334155',
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
    borderColor: '#a855f7',
  },
  avatarFallback: {
    backgroundColor: '#374151',
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
    borderColor: '#0f172a',
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
    color: '#e2e8f0',
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
  messageButton: {
    backgroundColor: '#374151',
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
  postsGrid: {
    gap: 2,
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
    backgroundColor: '#374151',
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