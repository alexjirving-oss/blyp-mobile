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
  Platform,
  StatusBar,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { signOut } from 'firebase/auth';
import { collection, query, where, orderBy, onSnapshot, deleteDoc, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { useNavigation } from '@react-navigation/native';
import { auth, db, storage } from '../config/firebase';
import ActivityFeed from '../components/ActivityFeed';
import { trackActivity } from '../utils/activityTracker';
import BlypLogo from '../components/BlypLogo';
import { subscribeToFollowersCount, getFollowersCount } from '../utils/followUtils';
import { addFakeFollowers, getCurrentFollowerCount } from '../utils/boostFollowers';
import FollowerBooster from '../components/FollowerBooster';
import { addTestFollowersInternal, checkFollowersData } from '../utils/testFollowers';

const ProfileScreen = () => {
  const navigation = useNavigation();
  const user = auth.currentUser;
  const [userPosts, setUserPosts] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState('1');
  const [followersCount, setFollowersCount] = useState(0);
  const [showFollowerBooster, setShowFollowerBooster] = useState(false);
  const [developerMode, setDeveloperMode] = useState(true); // Always enabled for cleanup
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeInput, setCodeInput] = useState('');

  useEffect(() => {
    if (!user) return;

    // Load user profile data
    const loadUserProfile = async () => {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
          setUserProfile(userDoc.data());
        } else {
          // Set default profile if no Firestore document exists
          setUserProfile({
            displayName: user.displayName || 'anonymous',
            email: user.email,
            photoURL: user.photoURL,
            bio: ''
          });
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
        // Fallback to auth data
        setUserProfile({
          displayName: user.displayName || 'anonymous',
          email: user.email,
          photoURL: user.photoURL,
          bio: ''
        });
      }
    };

    loadUserProfile();

    // Subscribe to followers count changes with better error handling
    let followersUnsubscribe;
    console.log('🔄 Setting up followers subscription for user:', user.uid);
    
    // Clear user ID display for cleanup
    console.log('\n' + '='.repeat(60));
    console.log('🆔 USER ID FOR CLEANUP: ' + user.uid);
    console.log('📝 To clean fake followers, run this command:');
    console.log('   node cleanup-fake-followers.js ' + user.uid);
    console.log('='.repeat(60) + '\n');
    
    try {
      followersUnsubscribe = subscribeToFollowersCount(user.uid, (count) => {
        console.log('📊 FOLLOWERS SUBSCRIPTION CALLBACK - Count received:', count);
        setFollowersCount(count);
        console.log('✅ Followers count updated successfully:', count);
      });
      console.log('✅ Followers subscription set up successfully');
    } catch (error) {
      console.error('❌ Error setting up followers subscription:', error);
      // Fallback: try to get count directly
      console.log('🔄 Trying direct followers count fetch...');
      getFollowersCount(user.uid).then(count => {
        console.log('📊 DIRECT FETCH - Followers count:', count);
        setFollowersCount(count);
        console.log('✅ Followers count loaded directly:', count);
      }).catch(err => {
        console.error('❌ Failed to load followers count:', err);
        setFollowersCount(0);
      });
    }

    // Load user posts
    const q = query(
      collection(db, 'posts'),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log('👤 Profile: Firebase snapshot received');
      console.log('👤 Profile: Number of user posts:', snapshot.docs.length);
      console.log('👤 Profile: User ID filter:', user.uid);
      
      const posts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log('👤 Profile: Raw posts:', posts);
      
      // Sort posts by date manually (newest first)
      posts.sort((a, b) => {
        if (a.date && b.date) {
          return b.date.toMillis() - a.date.toMillis();
        }
        return 0;
      });
      setUserPosts(posts);
      setLoading(false);
      
      console.log('👤 Profile: Posts set to state:', posts.length);
    });

    // Track profile view (for when others view this profile)
    // Note: This currently tracks self-views, but you could modify this
    // to only track when viewing other users' profiles
    const trackProfileView = async () => {
      if (user) {
        // This would track self-views, you might want to modify this logic
        // to only track when viewing other users' profiles
        console.log('👀 Profile view tracked for user:', user.uid);
      }
    };

    trackProfileView();

    return () => {
      unsubscribe();
      if (followersUnsubscribe) {
        followersUnsubscribe();
      }
    };
  }, [user]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleDeveloperCode = () => {
    setShowCodeModal(true);
  };

  const handleCodeSubmit = () => {
    if (codeInput === '123') {
      setDeveloperMode(true);
      setShowFollowerBooster(true);
      setShowCodeModal(false);
      setCodeInput('');
      Alert.alert('🎉 Success!', 'Developer mode activated!');
    } else {
      Alert.alert('❌ Error', 'Invalid developer code');
      setCodeInput('');
    }
  };

  // Debug function to check followers data
  const handleDebugFollowers = async () => {
    if (!user) return;
    
    Alert.alert(
      '🐛 Debug Followers',
      'What would you like to do?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Check Data', 
          onPress: async () => {
            const result = await checkFollowersData(user.uid);
            Alert.alert(
              '📊 Followers Data',
              `Count: ${result.count}\n\nFollowers: ${result.followers.map(f => f.name || f.id).join(', ') || 'None'}`
            );
          }
        },
        { 
          text: 'Clean Fake Followers', 
          onPress: async () => {
            Alert.alert(
              '🧹 Clean Fake Followers',
              'This will remove ALL fake followers from your account. This cannot be undone. Continue?',
              [
                { text: 'Cancel', style: 'cancel' },
                { 
                  text: 'Clean Up', 
                  style: 'destructive',
                  onPress: () => cleanupFakeFollowers()
                }
              ]
            );
          }
        },
        { 
          text: 'Add Test Data', 
          onPress: async () => {
            const result = await addTestFollowersInternal(user.uid);
            if (result.success) {
              Alert.alert('✅ Success!', `Added ${result.count} test followers!`);
            } else {
              Alert.alert('❌ Error', `Failed to add followers: ${result.error?.message || 'Unknown error'}`);
            }
          }
        }
      ]
    );
  };

  const cleanupFakeFollowers = async () => {
    if (!user) return;
    
    try {
      console.log('🗑️ Starting fake followers cleanup...');
      setLoading(true);
      
      const followersRef = collection(doc(db, 'users', user.uid), 'followers');
      const snapshot = await getDocs(followersRef);
      
      console.log(`📊 Total followers to process: ${snapshot.size}`);
      
      let deletedCount = 0;
      let realFollowersCount = 0;
      let batchCount = 0;
      const batchSize = 450; // Firestore batch limit
      let batch = writeBatch(db);
      
      const allDocs = [];
      snapshot.forEach(docSnap => allDocs.push(docSnap));
      
      for (let i = 0; i < allDocs.length; i++) {
        const docSnap = allDocs[i];
        const data = docSnap.data();
        const docId = docSnap.id;
        
        // Check if this is a fake follower
        const isFakeFollower = 
          data.isBot === true ||
          docId.startsWith('fake_follower_') ||
          (data.displayName && data.displayName.startsWith('Fake User')) ||
          (data.username && data.username.startsWith('fake_user_'));
        
        if (isFakeFollower) {
          batch.delete(docSnap.ref);
          batchCount++;
          
          // Execute batch when it gets full
          if (batchCount >= batchSize) {
            console.log(`🗑️ Executing batch ${Math.floor(deletedCount / batchSize) + 1} (${batchCount} deletions)...`);
            await batch.commit();
            deletedCount += batchCount;
            
            // Create new batch
            batch = writeBatch(db);
            batchCount = 0;
            
            console.log(`✅ Deleted ${deletedCount} fake followers so far...`);
          }
        } else {
          realFollowersCount++;
        }
        
        // Progress update every 100 items
        if ((i + 1) % 100 === 0) {
          console.log(`📊 Progress: ${i + 1}/${allDocs.length} processed`);
        }
      }
      
      // Execute remaining batch
      if (batchCount > 0) {
        console.log(`🗑️ Executing final batch (${batchCount} deletions)...`);
        await batch.commit();
        deletedCount += batchCount;
      }
      
      console.log('\n🎉 CLEANUP COMPLETED! 🎉');
      console.log(`🗑️ Fake followers removed: ${deletedCount}`);
      console.log(`👤 Real followers remaining: ${realFollowersCount}`);
      
      Alert.alert(
        'Cleanup Complete! 🎉',
        `Removed ${deletedCount} fake followers\n${realFollowersCount} real followers remaining`,
        [{ text: 'Great!' }]
      );
      
    } catch (error) {
      console.error('❌ Cleanup error:', error);
      Alert.alert('Cleanup Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCodeCancel = () => {
    setShowCodeModal(false);
    setCodeInput('');
  };

  // Secret function to boost followers (triggered by long-press)
  const handleBoostFollowers = async () => {
    if (!user) return;
    
    Alert.alert(
      '🚀 Boost Followers',
      'How many followers would you like to add?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: '+100', 
          onPress: async () => {
            const result = await addFakeFollowers(user.uid, 100);
            if (result.success) {
              Alert.alert('✅ Success!', `Added 100 followers! New total: ${result.newFollowerCount}`);
            }
          }
        },
        { 
          text: '+1K', 
          onPress: async () => {
            const result = await addFakeFollowers(user.uid, 1000);
            if (result.success) {
              Alert.alert('✅ Success!', `Added 1,000 followers! New total: ${result.newFollowerCount}`);
            }
          }
        },
        { 
          text: '+10K', 
          onPress: async () => {
            const result = await addFakeFollowers(user.uid, 10000);
            if (result.success) {
              Alert.alert('🎉 Amazing!', `Added 10,000 followers! New total: ${result.newFollowerCount}`);
            }
          }
        }
      ]
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <TouchableOpacity style={styles.menuButton}>
          <Ionicons name="menu" size={24} color="#d1d5db" />
        </TouchableOpacity>
        <BlypLogo useGradientBackground={true} />
        <TouchableOpacity style={styles.searchButton}>
          <Ionicons name="search" size={24} color="#d1d5db" />
        </TouchableOpacity>
      </View>
      
      <View style={styles.tabContainer}>
        <View style={styles.tabSelector}>
          {[
            { key: '1', label: 'My Profile' },
            { key: '2', label: 'Activity' },
            { key: '3', label: 'Drafts' },
            { key: '4', label: 'Settings' }
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
                left: `${['1', '2', '3', '4'].indexOf(selectedTab) * 25}%` 
              }
            ]}
          />
        </View>
      </View>
    </View>
  );

  const renderProfileInfo = () => (
    <View style={styles.profileHeader}>
      <TouchableOpacity 
        style={styles.profileImageContainer}
        onPress={() => navigation.navigate('EditProfile')}
      >
        <Image
          source={{
            uri: user?.photoURL || `https://placehold.co/120x120/475569/e2e8f0?text=${user?.displayName?.charAt(0).toUpperCase() || 'A'}`
          }}
          style={styles.profileImage}
        />
        <View style={styles.profileImageBorder} />
        <View style={styles.editIconContainer}>
          <Ionicons name="camera" size={16} color="#ffffff" />
        </View>
      </TouchableOpacity>
      
      <Text style={styles.username}>
        @{userProfile?.displayName || user?.displayName || 'anonymous'}
      </Text>
      
      <Text style={styles.userEmail}>
        {user?.email}
      </Text>

      {userProfile?.bio ? (
        <Text style={styles.userBio}>
          {userProfile.bio}
        </Text>
      ) : null}
      
      <View style={styles.statsContainer}>
        <TouchableOpacity 
          style={styles.statItem}
          onPress={() => navigation.navigate('Followers', { userId: user.uid, type: 'followers' })}
          onLongPress={handleBoostFollowers}
          delayLongPress={2000}
        >
          <Text style={styles.statNumber}>{followersCount}</Text>
          <Text style={styles.statLabel}>Followers</Text>
        </TouchableOpacity>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{userPosts.length}</Text>
          <Text style={styles.statLabel}>Posts</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{userPosts.reduce((acc, post) => acc + (post.likes || 0), 0)}</Text>
          <Text style={styles.statLabel}>Likes</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{userPosts.reduce((acc, post) => acc + (post.sharedTo?.length || 0), 0)}</Text>
          <Text style={styles.statLabel}>Shared</Text>
        </View>
      </View>

      <View style={styles.actionButtons}>
        <TouchableOpacity 
          style={styles.editButton}
          onPress={() => navigation.navigate('EditProfile')}
        >
          <LinearGradient
            colors={['#a855f7', '#d946ef', '#ec4899']}
            style={styles.editButtonGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bookmarkButton}>
          <Ionicons name="bookmark-outline" size={20} color="#ffffff" />
        </TouchableOpacity>
        {developerMode && (
          <TouchableOpacity 
            style={[styles.bookmarkButton, { backgroundColor: '#ef4444' }]}
            onPress={handleDebugFollowers}
          >
            <Ionicons name="bug-outline" size={20} color="#ffffff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );



  const handlePostPress = (post) => {
    console.log('🔍 Opening media viewer for profile post:', post.id);
    navigation.navigate('MediaViewer', { post });
  };

  const handleDeletePost = (post) => {
    Alert.alert(
      'Delete Post',
      'Are you sure you want to delete this post? This action cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              console.log('🗑️ Starting post deletion:', post.id);
              
              // Delete media files from Firebase Storage first
              const deletePromises = [];
              
              // Delete video file if exists
              if (post.videoUrl) {
                try {
                  const videoRef = ref(storage, post.videoUrl);
                  deletePromises.push(deleteObject(videoRef));
                  console.log('🎥 Queued video file deletion:', post.videoUrl);
                } catch (error) {
                  console.log('⚠️ Video file may not exist in storage:', error.message);
                }
              }
              
              // Delete media files if exists
              if (post.media && Array.isArray(post.media)) {
                post.media.forEach((mediaItem, index) => {
                  if (mediaItem.url) {
                    try {
                      const mediaRef = ref(storage, mediaItem.url);
                      deletePromises.push(deleteObject(mediaRef));
                      console.log(`📁 Queued media file ${index} deletion:`, mediaItem.url);
                    } catch (error) {
                      console.log(`⚠️ Media file ${index} may not exist in storage:`, error.message);
                    }
                  }
                  // Delete thumbnail if it's a separate file
                  if (mediaItem.thumbnail && mediaItem.thumbnail !== mediaItem.url) {
                    try {
                      const thumbRef = ref(storage, mediaItem.thumbnail);
                      deletePromises.push(deleteObject(thumbRef));
                      console.log(`🖼️ Queued thumbnail ${index} deletion:`, mediaItem.thumbnail);
                    } catch (error) {
                      console.log(`⚠️ Thumbnail ${index} may not exist in storage:`, error.message);
                    }
                  }
                });
              }
              
              // Delete separate thumbnail if exists
              if (post.thumbnail && !post.media?.some(m => m.thumbnail === post.thumbnail)) {
                try {
                  const thumbRef = ref(storage, post.thumbnail);
                  deletePromises.push(deleteObject(thumbRef));
                  console.log('🖼️ Queued post thumbnail deletion:', post.thumbnail);
                } catch (error) {
                  console.log('⚠️ Post thumbnail may not exist in storage:', error.message);
                }
              }
              
              // Execute all storage deletions (ignore individual failures)
              if (deletePromises.length > 0) {
                console.log(`🔄 Executing ${deletePromises.length} storage deletions...`);
                await Promise.allSettled(deletePromises);
                console.log('✅ Storage cleanup completed (some files may not have existed)');
              }
              
              // Delete the Firestore document
              await deleteDoc(doc(db, 'posts', post.id));
              console.log('✅ Post document deleted successfully:', post.id);
              
            } catch (error) {
              console.error('❌ Error deleting post:', error);
              Alert.alert('Error', 'Failed to delete post completely. Please try again.');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const getVideoThumbnail = (post) => {
    // For video posts, prioritize actual thumbnails over video URLs
    const isVideo = post.type === 'video' || post.media?.[0]?.type?.includes('video') || post.videoUrl;
    
    // Priority order: explicit thumbnail > media thumbnail > first media URL > video URL as fallback > default
    if (post.thumbnail) {
      return post.thumbnail;
    }
    if (post.media?.[0]?.thumbnail) {
      return post.media[0].thumbnail;
    }
    // Use the first media item's URL directly (for photos)
    if (post.media?.[0]?.url) {
      return post.media[0].url;
    }
    if (isVideo && (post.videoUrl || post.media?.[0]?.url)) {
      // For videos, use the video URL as thumbnail (some video players can extract first frame)
      return post.videoUrl || post.media[0].url;
    }
    // Only use imageUrl as fallback if it exists
    if (post.imageUrl) {
      return post.imageUrl;
    }
    // Fallback thumbnail - never use user avatar for post thumbnails!
    return 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&h=400&fit=crop';
  };

  const renderPostItem = ({ item: post }) => {
    const isVideo = post.type === 'video' || post.media?.[0]?.type?.includes('video') || post.videoUrl || post.media?.[0]?.url?.includes('.mp4');
    
    return (
      <TouchableOpacity 
        style={styles.postCard}
        onPress={() => handlePostPress(post)}
        activeOpacity={0.8}
      >
        {/* Delete button */}
        <TouchableOpacity 
          style={styles.deleteButton}
          onPress={() => handleDeletePost(post)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="trash-outline" size={16} color="#ef4444" />
        </TouchableOpacity>
        
        {post.media && post.media.length > 0 ? (
          <View style={styles.mediaContainer}>
            <Image 
              source={{ uri: getVideoThumbnail(post) }} 
              style={styles.postImage}
              defaultSource={{ uri: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&h=400&fit=crop' }}
            />
            {/* Video indicator for video posts */}
            {isVideo && (
              <View style={styles.videoIndicator}>
                <Ionicons name="play" size={16} color="#ffffff" />
              </View>
            )}
          </View>
        ) : (
          <View style={styles.postTextPlaceholder}>
            <Text style={styles.postEmoji}>{post.emoji || '💭'}</Text>
          </View>
        )}
        <View style={styles.postOverlay}>
          <Text style={styles.postTitle} numberOfLines={2}>{post.title}</Text>
          <View style={styles.postIndicators}>
            {post.sharedTo && post.sharedTo.length > 0 && (
              <View style={styles.sharedIndicator}>
                <Ionicons name="share-outline" size={12} color="#ffffff" />
              </View>
            )}
            {post.likes > 0 && (
              <View style={styles.likeIndicator}>
                <Ionicons name="heart" size={12} color="#ff1744" />
                <Text style={styles.likeCount}>{post.likes}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderPostsGrid = () => {
    if (loading) {
      return (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading posts...</Text>
        </View>
      );
    }

    if (userPosts.length === 0) {
      return (
        <View style={styles.postsGrid}>
          <View style={styles.emptyPosts}>
            <Ionicons name="camera-outline" size={48} color="#374151" />
            <Text style={styles.emptyText}>No posts yet</Text>
            <Text style={styles.emptySubtext}>Tap the plus button to create your first post</Text>
          </View>
        </View>
      );
    }

    return (
      <FlatList
        style={styles.flatListContainer}
        data={userPosts}
        renderItem={renderPostItem}
        numColumns={2}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.postsGridContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={10}
        initialNumToRender={6}
        updateCellsBatchingPeriod={50}
        ListHeaderComponent={() => (
          <View>
            {renderProfileInfo()}
          </View>
        )}
        ListFooterComponent={() => (
          <View>
            {renderLogoutButton()}
          </View>
        )}
      />
    );
  };

  const renderTabContent = () => {
    switch (selectedTab) {
      case '1':
        return (
          <View style={styles.tabContent}>
            {renderPostsGrid()}
          </View>
        );
      case '2':
        return (
          <View style={styles.tabContent}>
            <ActivityFeed navigation={navigation} />
          </View>
        );
      case '3':
        return (
          <View style={styles.tabContent}>
            <View style={styles.comingSoon}>
              <Ionicons name="document-text-outline" size={64} color="#374151" />
              <Text style={styles.comingSoonTitle}>Drafts</Text>
              <Text style={styles.comingSoonText}>Your saved drafts will appear here</Text>
            </View>
          </View>
        );
      case '4':
        return (
          <View style={styles.tabContent}>
            <ScrollView style={styles.settingsContainer}>
              <View style={styles.settingsSection}>
                <Text style={styles.settingsSectionTitle}>Developer Options</Text>
                <TouchableOpacity style={styles.settingsItem} onPress={handleDeveloperCode}>
                  <View style={styles.settingsItemLeft}>
                    <Ionicons name="code-outline" size={24} color="#8b5cf6" />
                    <Text style={styles.settingsItemText}>Developer Code</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                </TouchableOpacity>
                {developerMode && (
                  <View style={styles.developerBadge}>
                    <Text style={styles.developerBadgeText}>🛠️ Developer Mode Active</Text>
                  </View>
                )}
              </View>
              
              <View style={styles.settingsSection}>
                <Text style={styles.settingsSectionTitle}>Account</Text>
                <TouchableOpacity style={styles.settingsItem}>
                  <View style={styles.settingsItemLeft}>
                    <Ionicons name="person-outline" size={24} color="#6b7280" />
                    <Text style={styles.settingsItemText}>Account Information</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.settingsItem}>
                  <View style={styles.settingsItemLeft}>
                    <Ionicons name="shield-outline" size={24} color="#6b7280" />
                    <Text style={styles.settingsItemText}>Privacy & Security</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.settingsItem}>
                  <View style={styles.settingsItemLeft}>
                    <Ionicons name="notifications-outline" size={24} color="#6b7280" />
                    <Text style={styles.settingsItemText}>Notifications</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        );
      default:
        return null;
    }
  };

  const renderLogoutButton = () => (
    <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
      <Ionicons name="log-out-outline" size={24} color="#ef4444" />
      <Text style={styles.logoutText}>Log Out</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      {renderHeader()}
      <View style={styles.content}>
        {renderTabContent()}
      </View>
      {showFollowerBooster && (
        <FollowerBooster 
          visible={true} 
          onClose={() => setShowFollowerBooster(false)}
        />
      )}
      
      {/* Custom Developer Code Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={showCodeModal}
        onRequestClose={handleCodeCancel}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <LinearGradient
              colors={['#8b5cf6', '#d946ef']}
              style={styles.modalGradient}
            >
              <Text style={styles.modalTitle}>Developer Access</Text>
              <Text style={styles.modalSubtitle}>Enter the developer code:</Text>
              
              <TextInput
                style={styles.codeInput}
                value={codeInput}
                onChangeText={setCodeInput}
                placeholder="Enter code"
                placeholderTextColor="#9ca3af"
                secureTextEntry={true}
                autoFocus={true}
                onSubmitEditing={handleCodeSubmit}
              />
              
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.cancelButton]} 
                  onPress={handleCodeCancel}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.modalButton, styles.submitButton]} 
                  onPress={handleCodeSubmit}
                >
                  <Text style={styles.submitButtonText}>OK</Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
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
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
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
  content: {
    flex: 1,
  },
  tabContent: {
    flex: 1,
  },
  comingSoon: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  comingSoonTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#e2e8f0',
    marginTop: 16,
    marginBottom: 8,
  },
  comingSoonText: {
    fontSize: 16,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 24,
  },
  profileHeader: {
    alignItems: 'center',
    padding: 24,
  },
  profileImageContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#a855f7',
  },
  editIconContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#a855f7',
    borderRadius: 16,
    padding: 6,
    borderWidth: 2,
    borderColor: '#0f172a',
  },
  username: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  userEmail: {
    color: '#9ca3af',
    fontSize: 16,
    marginBottom: 8,
  },
  userBio: {
    color: '#e2e8f0',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  statsContainer: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 24,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: 2,
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 8,
  },
  editButton: {
    flex: 1,
    marginRight: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  editButtonGradient: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  bookmarkButton: {
    backgroundColor: '#374151',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },

  flatListContainer: {
    flex: 1,
  },
  postsGrid: {
    flex: 1,
    padding: 8,
  },
  postsGridContent: {
    padding: 8,
    flexGrow: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: 16,
  },
  postCard: {
    flex: 1,
    margin: 4,
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#374151',
    position: 'relative',
  },
  deleteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 16,
    padding: 6,
    zIndex: 10,
  },
  postImage: {
    width: '100%',
    height: '100%',
  },
  postTextPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1e293b',
  },
  postEmoji: {
    fontSize: 32,
  },
  mediaContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  videoIndicator: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 12,
    padding: 4,
    zIndex: 1,
  },
  postOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 8,
  },
  postTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  postIndicators: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sharedIndicator: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    padding: 4,
  },
  likeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  likeCount: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
  },
  emptyPosts: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtext: {
    color: '#4b5563',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    maxWidth: 250,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    marginHorizontal: 16,
    marginVertical: 24,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  logoutText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
  },
  settingsContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  settingsSection: {
    marginBottom: 32,
  },
  settingsSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#e2e8f0',
    marginBottom: 16,
    marginTop: 8,
  },
  settingsItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    marginBottom: 8,
  },
  settingsItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingsItemText: {
    fontSize: 16,
    color: '#e2e8f0',
    marginLeft: 12,
    fontWeight: '500',
  },
  developerBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  developerBadgeText: {
    color: '#8b5cf6',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '85%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  modalGradient: {
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 16,
    color: '#e2e8f0',
    marginBottom: 24,
    textAlign: 'center',
  },
  codeInput: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 24,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  submitButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  submitButtonText: {
    color: '#8b5cf6',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ProfileScreen;