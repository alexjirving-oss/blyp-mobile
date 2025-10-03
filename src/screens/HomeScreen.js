import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  Image,
  Dimensions,
  StatusBar,
  Alert,
  ScrollView,
  Animated,
  PixelRatio,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Video } from 'expo-av';
import { useFocusEffect } from '@react-navigation/native';
import { collection, onSnapshot, orderBy, query, doc, updateDoc, arrayUnion, arrayRemove, increment, limit } from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import SimpleVideo from '../components/OptimizedVideo'; // legacy simple
import EnhancedVideo from '../components/EnhancedVideo';
import * as FileSystem from 'expo-file-system';
import { trackActivity, ACTIVITY_TYPES } from '../utils/activityTracker';
import BlypLogo from '../components/BlypLogo';
import { addTestPostsWithMultiplePhotos } from '../utils/testDataHelper';
import CategoriesTab from '../components/CategoriesTab';
import HashtagsTab from '../components/HashtagsTab';
import WhatsAppPopularTab from '../components/WhatsAppPopularTab';
import HeartAnimation from '../components/HeartAnimation';
import GiftSystem from '../components/GiftSystem';
import DailyRewards from '../components/DailyRewards';
import BlypCoinWallet from '../components/BlypCoinWallet';
import CommentsModal from '../components/CommentsModal';
import { responsiveFont, responsiveSize, scaleIcon, scalePadding } from '../utils/scaleUtils';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// Use global scaling utilities
const headerHeight = responsiveSize(120); // Responsive header height
const footerHeight = responsiveSize(88); // Bottom navigation height
const adjustedHeight = screenHeight - headerHeight - footerHeight; // Account for both header and footer

// Mock TikTok-style video data with enhanced engagement metrics
const mockVideoData = [
  {
    id: 'video-1',
    type: 'video',
    videoUrl: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4',
    user: { username: '@alex_creator', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face' },
    description: 'Amazing sunset vibes! 🌅 Perfect golden hour captured in the mountains #sunset #nature #peaceful #goldenhour',
    likes: 1234,
    comments: [
      { user: 'nature_lover', text: 'Breathtaking! 😍' },
      { user: 'photographer', text: 'What camera did you use?' },
      { user: 'hiker_girl', text: 'Location please!' }
    ],
    shares: 45,
    views: 12340,
    music: 'Original Sound - alex_creator'
  },
  {
    id: 'video-2',
    type: 'video',
    videoUrl: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_2mb.mp4',
    user: { username: '@travel_buddy', avatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b47c?w=100&h=100&fit=crop&crop=face' },
    description: 'City life hits different at night ✨🏙️ The energy is unmatched! #cityvibes #nightlife #urban #travel',
    likes: 2156,
    comments: [
      { user: 'city_explorer', text: 'Which city is this?' },
      { user: 'night_owl', text: 'Love the vibes!' },
      { user: 'urban_photographer', text: 'Amazing shots! 📸' }
    ],
    shares: 78,
    views: 21560,
    music: 'Trending - City Nights'
  },
  {
    id: 'video-3',
    type: 'video',
    videoUrl: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_5mb.mp4',
    user: { username: '@foodie_life', avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=100&h=100&fit=crop&crop=face' },
    description: 'Making the perfect pasta 🍝 Who wants the recipe? This took 3 hours but so worth it! #cooking #pasta #foodie #recipe #italian',
    likes: 3421,
    comments: [
      { user: 'pasta_lover', text: 'Recipe please! 🙏' },
      { user: 'italian_chef', text: 'Looks authentic!' },
      { user: 'hungry_student', text: 'Making this tonight!' }
    ],
    shares: 156,
    views: 34210,
    music: 'Cooking Vibes - Chef Sounds'
  },
  {
    id: 'video-4',
    type: 'video',
    videoUrl: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4',
    user: { username: '@fitness_guru', avatar: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=100&h=100&fit=crop&crop=face' },
    description: 'Morning workout routine 💪 Start your day right! No equipment needed #fitness #workout #morning #health #motivation',
    likes: 892,
    comments: [
      { user: 'fitness_fan', text: 'This is perfect!' },
      { user: 'morning_person', text: 'Love the energy!' }
    ],
    shares: 34,
    views: 8920,
    music: 'Pump It Up - Workout Mix'
  },
  {
    id: 'video-5',
    type: 'video',
    videoUrl: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_2mb.mp4',
    user: { username: '@tech_reviewer', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face' },
    description: 'This new gadget is INSANE! 📱 Game changer for creators #tech #gadget #review #creator #innovation',
    likes: 1567,
    comments: [
      { user: 'tech_enthusiast', text: 'Need this!' },
      { user: 'creator_life', text: 'Where can I buy it?' }
    ],
    shares: 67,
    views: 15670,
    music: 'Tech Beats - Digital Sounds'
  }
];

// Random comments data for the scrolling feed
const randomCommentsData = [
  { user: 'sarah_m', text: 'This is amazing! 🔥', time: '2m' },
  { user: 'john_doe', text: 'Love the vibes ✨', time: '5m' },
  { user: 'creative_mind', text: 'So inspiring!', time: '8m' },
  { user: 'photo_lover', text: 'Goals! 💯', time: '12m' },
  { user: 'daily_content', text: 'Need more like this', time: '15m' },
  { user: 'wanderlust_soul', text: 'Perfect timing', time: '18m' },
  { user: 'art_enthusiast', text: 'Incredible work', time: '22m' },
  { user: 'lifestyle_blogger', text: 'Obsessed with this!', time: '25m' },
  { user: 'travel_addict', text: 'Where is this?', time: '28m' },
  { user: 'foodie_life', text: 'Recipe please! 🙏', time: '30m' },
  { user: 'fitness_guru', text: 'Motivation right here', time: '35m' },
  { user: 'tech_lover', text: 'Mind blown 🤯', time: '40m' },
  { user: 'music_fan', text: 'What song is this?', time: '45m' },
  { user: 'nature_lover', text: 'Absolutely beautiful', time: '1h' },
  { user: 'creative_studio', text: 'Pure artistry', time: '1h' }
];

// Component for displaying multiple media items in a swipeable carousel
const MediaCarousel = ({ media, style }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index);
    }
  });
  
  // Safety check for media prop - after all hooks
  if (!media || !Array.isArray(media) || media.length === 0) {
    return null;
  }

  const renderMediaItem = ({ item }) => {
    const isVideo = item.type === 'video' || item.type?.includes('video');
    const mediaUri = item.url || item.uri || item.videoUrl || item.imageUrl;
    
    if (isVideo) {
      return (
        <View style={styles.carouselItemContainer}>
          <EnhancedVideo 
            source={{ uri: mediaUri }} 
            style={[styles.carouselMedia, style]}
            shouldPlay={false}
            resizeMode="cover"
          />
        </View>
      );
    } else {
      return (
        <View style={styles.carouselItemContainer}>
          <Image 
            source={{ uri: mediaUri }} 
            style={[styles.carouselMedia, style]}
            resizeMode="cover"
          />
          {/* Subtle overlay to enhance vibrancy */}
          <View style={styles.imageEnhancementOverlay} />
        </View>
      );
    }
  };

  return (
    <View style={styles.carouselContainer}>
      <FlatList
        data={media}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={{
          itemVisiblePercentThreshold: 50,
        }}
        renderItem={renderMediaItem}
        keyExtractor={(item, index) => `media-${index}`}
      />
      
      {/* Media counter */}
      <View style={styles.mediaCounter}>
        <Text style={styles.mediaCounterText} allowFontScaling={false}>
          {currentIndex + 1}/{media.length}
        </Text>
      </View>
      
      {/* Pagination dots */}
      {media.length > 1 && (
        <View style={styles.paginationDots}>
          {media.map((_, index) => (
            <View
              key={index}
              style={[
                styles.paginationDot,
                index === currentIndex && styles.paginationDotActive
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
};

// Helper function to format balance numbers
const formatBalance = (balance) => {
  if (balance >= 1000000) return (balance / 1000000).toFixed(1) + 'M';
  if (balance >= 1000) return (balance / 1000).toFixed(1) + 'K';
  return balance.toString();
};

const HomeScreen = ({ navigation }) => {
  const [videos, setVideos] = useState(mockVideoData);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [liked, setLiked] = useState({});
  const [following, setFollowing] = useState({});

  // Censoring function removed - displaying original content

  // Handle user profile navigation
  const handleUserProfilePress = (user, post = null) => {
    // Use userId from post if available, otherwise fallback to user data
    const userId = post?.userId || user?.userId || user?.id || user?.username || Math.random().toString(36);
    const username = user?.username || '@user';
    
    console.log('📱 HomeScreen: Navigating to user profile:', { userId, username, userObj: user });
    
    navigation.navigate('UserProfile', {
      userId: userId,
      username: username,
    });
  };
  // Default landing tab set to 'A' (4 U)
  const [selectedTab, setSelectedTab] = useState('A');
  const [randomPosts, setRandomPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentDiscoverIndex, setCurrentDiscoverIndex] = useState(0);
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const [isTitleBarMinimized, setIsTitleBarMinimized] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedHashtags, setSelectedHashtags] = useState([]);
  const [filteredPosts, setFilteredPosts] = useState([]);
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const [heartAnimationKey, setHeartAnimationKey] = useState(0);
  const [coinBalance, setCoinBalance] = useState(0);
  const [gemBalance, setGemBalance] = useState(0);
  const [menuVisible, setMenuVisible] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [scrollLocked, setScrollLocked] = useState(false);
  const flatListRef = useRef(null);
  const prefetchingRef = useRef({});
  const commentScrollValue = useRef(new Animated.Value(0)).current;

  // Horizontal scrolling animation for comments
  useEffect(() => {
    const animateComments = () => {
      commentScrollValue.setValue(0);
      Animated.loop(
        Animated.timing(commentScrollValue, {
          toValue: 1,
          duration: 19500, // Slowed down by 30%
          useNativeDriver: true,
        }),
        { iterations: -1 } // Infinite loop
      ).start();
    };
    animateComments();
  }, []);



  // Navigation handler for opening media viewer
  const handlePostPress = (post) => {
    console.log('🔍 Opening media viewer for post:', post.id);
    navigation.navigate('MediaViewer', { post });
  };

  // Add test posts with multiple photos for testing PhotoGallery
  const handleAddTestPosts = async () => {
    console.log('🧪 Adding test posts with multiple photos...');
    try {
      const result = await addTestPostsWithMultiplePhotos();
      if (result.success) {
        console.log('✅ Test posts added successfully!');
        Alert.alert('Test Posts Added', 'Two test posts with multiple photos have been added! Switch to the "Discover" tab to see them.');
      } else {
        console.error('❌ Failed to add test posts:', result.error);
        Alert.alert('Error', 'Failed to add test posts: ' + result.error);
      }
    } catch (error) {
      console.error('❌ Error adding test posts:', error);
      Alert.alert('Error', 'Failed to add test posts: ' + error.message);
    }
  };

  // Track screen focus to pause videos when navigating to other tabs
  useFocusEffect(
    useCallback(() => {
      // Screen is focused (user is on Home tab)
      setIsScreenFocused(true);
      
      return () => {
        // Screen is unfocused (user navigated to Chat, Messenger, Profile, etc.)
        setIsScreenFocused(false);
      };
    }, [])
  );

  // Load real video data from Firebase when available
  useEffect(() => {
    console.log('🎬 HOME: Setting up video data listener');
    let isInitialLoad = true;
    let isMounted = true; // Track if component is mounted
    
    // Add limit to prevent loading entire database
    const q = query(collection(db, 'posts'), orderBy('date', 'desc'), limit(20));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      // Skip updates if component unmounted
      if (!isMounted) return;
      
      const videoData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).filter(post => post.type === 'video'); // Only show videos in TikTok feed
      
      console.log(`📱 HOME: Received ${videoData.length} videos from Firebase`);
      
      if (videoData.length > 0) {
        setVideos(videoData);
        // Only set currentIndex on initial load, not on real-time updates
        if (isInitialLoad) {
          setCurrentIndex(0);
          isInitialLoad = false;
        }
        
        // Update liked state based on current user's likes
        if (auth.currentUser) {
          const userId = auth.currentUser.uid;
          const likedState = {};
          videoData.forEach(video => {
            likedState[video.id] = video.likedBy?.includes(userId) || false;
          });
          setLiked(prev => ({ ...prev, ...likedState }));
        }
      }
    }, (error) => {
      console.error('❌ HOME: Error in video data listener:', error);
    });

    return () => {
      isMounted = false;
      console.log('🧹 HOME: Cleaning up video data listener');
      unsubscribe();
    };
  }, [/* No external dependencies needed */]);

  // Subscribe to real-time coin and gem balance updates
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.log('💰 HOME: No user logged in, skipping balance subscriptions');
      return;
    }
    
    console.log('💰 HOME: Setting up balance subscriptions for user:', currentUser.uid);
    
    // Use local variable to avoid closure issues with auth.currentUser
    const userId = currentUser.uid;
    
    // Track if component is mounted to prevent updates after unmount
    let isMounted = true;

    // Subscribe to real-time coin balance
    const unsubscribeCoin = BlypCoinService.subscribeToBalance(userId, (balance) => {
      // Skip updates if component unmounted
      if (isMounted) {
        console.log('💵 HOME: Received coin balance update:', balance);
        setCoinBalance(balance);
      }
    });
    
    // Subscribe to real-time gem balance
    const unsubscribeGems = GemService.subscribeToGems(userId, (balance) => {
      // Skip updates if component unmounted
      if (isMounted) {
        console.log('💎 HOME: Received gem balance update:', balance);
        setGemBalance(balance);
      }
    });
    
    return () => {
      console.log('🧹 HOME: Cleaning up balance subscriptions');
      isMounted = false;
      if (unsubscribeCoin) unsubscribeCoin();
      if (unsubscribeGems) unsubscribeGems();
    };
  // Only depend on auth.currentUser?.uid instead of the entire object
  }, [auth.currentUser?.uid]);

  // Initial autoplay tick for whichever feed is active to ensure the first visible item plays
  useEffect(() => {
    const t = setTimeout(() => {
      if (selectedTab === 'A') {
        // Tab A = randomPosts feed (uses currentDiscoverIndex)
        setCurrentDiscoverIndex(idx => idx); // no-op trigger in case FlatList needs a refresh
      } else if (selectedTab === 'B' && currentIndex === 0) {
        setCurrentIndex(0);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [selectedTab]);



  // Load all real user posts from Firebase for Discovery page
  useEffect(() => {
    let mounted = true;
    let isInitialLoad = true;
    
    // Add limit to prevent loading entire database at once
    const q = query(collection(db, 'posts'), orderBy('date', 'desc'), limit(30));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!mounted) return;
      
      const allPosts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Only shuffle on initial load to prevent random reordering on updates
      if (isInitialLoad) {
        const shuffled = [...allPosts].sort(() => 0.5 - Math.random());
        setRandomPosts(shuffled);
        setLoading(false);
        isInitialLoad = false;
      } else {
        // For real-time updates, maintain order but update the data
        setRandomPosts(allPosts);
      }
      
      // Update liked state for random posts too
      if (auth.currentUser) {
        const userId = auth.currentUser.uid;
        const likedState = {};
        allPosts.forEach(post => {
          likedState[post.id] = post.likedBy?.includes(userId) || false;
        });
        setLiked(prev => ({ ...prev, ...likedState }));
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // Refresh discovery posts (re-shuffle existing posts)
  const loadRandomPosts = () => {
    setLoading(true);
    // Re-shuffle current posts for refresh
    setTimeout(() => {
      setRandomPosts(prev => [...prev].sort(() => 0.5 - Math.random()));
      setLoading(false);
    }, 500);
  };

  const handleLike = async (videoId) => {
    if (!auth.currentUser) return;
    
    const userId = auth.currentUser.uid;
    const postRef = doc(db, 'posts', videoId);
    
    // Find the post data to get owner info
    const post = videos.find(v => v.id === videoId);
    
    try {
      const isCurrentlyLiked = liked[videoId];
      
      // Optimistic update for immediate UI feedback
      setLiked(prev => ({
        ...prev,
        [videoId]: !prev[videoId]
      }));
      
      if (isCurrentlyLiked) {
        // Unlike: remove user from likedBy array and decrement likes count
        await updateDoc(postRef, {
          likedBy: arrayRemove(userId),
          likes: increment(-1)
        });

        // Track unlike activity
        if (post && post.userId) {
          await trackActivity(
            ACTIVITY_TYPES.UNLIKE,
            userId,
            post.userId,
            {
              postId: videoId,
              postTitle: post.title || post.caption || post.description
            }
          );
        }
      } else {
        // Like: add user to likedBy array and increment likes count
        await updateDoc(postRef, {
          likedBy: arrayUnion(userId),
          likes: increment(1)
        });

        // Trigger heart animation for like
        setShowHeartAnimation(true);
        setHeartAnimationKey(prev => prev + 1);

        // Track like activity
        if (post && post.userId) {
          await trackActivity(
            ACTIVITY_TYPES.LIKE,
            userId,
            post.userId,
            {
              postId: videoId,
              postTitle: post.title || post.caption || post.description
            }
          );
        }
      }
    } catch (error) {
      console.error('Error updating like:', error);
      // Revert optimistic update on error
      setLiked(prev => ({
        ...prev,
        [videoId]: !prev[videoId]
      }));
    }
  };

  const handleFollow = async (username) => {
    const userId = username; // Using username as userId for now
    const wasFollowing = following[username];
    const newFollowStatus = !wasFollowing;

    // Optimistic update
    setFollowing(prev => ({
      ...prev,
      [username]: newFollowStatus
    }));

    try {
      // In a real app, update Firebase here
      // await updateDoc(doc(db, 'users', auth.currentUser.uid), {
      //   following: newFollowStatus ? arrayUnion(userId) : arrayRemove(userId)
      // });

      console.log(newFollowStatus ? `Following ${username}!` : `Unfollowed ${username}`);
    } catch (error) {
      console.error('Error updating follow status:', error);
      // Revert on error
      setFollowing(prev => ({
        ...prev,
        [username]: wasFollowing
      }));
    }
  };

  const handleOpenComments = (post) => {
    setSelectedPost(post);
    setCommentsVisible(true);
  };

  const handleCloseComments = () => {
    setCommentsVisible(false);
    setSelectedPost(null);
  };



  // Callback triggered when FlatList viewable items change; we use it to know which video should play
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      if (selectedTab === 'A') { // A = #4ME (randomPosts now)
        setCurrentDiscoverIndex(viewableItems[0].index || 0);
      } else if (selectedTab === 'B') { // B = Videos feed
        setCurrentIndex(viewableItems[0].index);
      }
    }
  }).current;

  // Prefetch next video's file for the ACTIVE feed (A=randomPosts, B=videos)
  useEffect(() => {
    // Track if component is still mounted
    let isMounted = true;
    
    const isRandomFeed = selectedTab === 'A';
    const list = isRandomFeed ? randomPosts : videos;
    const current = isRandomFeed ? currentDiscoverIndex : currentIndex;
    const nextIndex = current + 1;
    
    // Skip if invalid index or empty list
    if (!list || list.length === 0 || nextIndex >= list.length) {
      return;
    }
    
    const nextItem = list[nextIndex];
    
    // Only prefetch if the next item is a video
    const nextUriCandidate = nextItem?.videoUrl || nextItem?.media?.[0]?.url;
    const isVideo = nextItem?.type === 'video' || nextItem?.media?.[0]?.type?.includes('video');
    
    if (isVideo && nextUriCandidate && !prefetchingRef.current[nextUriCandidate]) {
      console.log('🎞️ HOME: Prefetching next video:', nextIndex);
      prefetchingRef.current[nextUriCandidate] = true;
      
      const fileName = encodeURIComponent(nextUriCandidate);
      const fileUri = `${FileSystem.cacheDirectory}vid-${fileName}`;
      
      // Use promise chain instead of nested promises
      FileSystem.getInfoAsync(fileUri)
        .then(info => {
          if (!info.exists && isMounted) {
            return FileSystem.downloadAsync(nextUriCandidate, fileUri);
          }
        })
        .catch(error => {
          if (isMounted) {
            console.log('❌ HOME: Error prefetching video:', error);
            // Remove from prefetching cache on error so it can be tried again
            prefetchingRef.current[nextUriCandidate] = false;
          }
        });
    }
    
    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
    };
  }, [currentIndex, currentDiscoverIndex, selectedTab, videos, randomPosts]);

  // Warm TCP/SSL connections for next two videos in the active feed
  useEffect(() => {
    // Track if component is still mounted
    let isMounted = true;
    
    const isRandomFeed = selectedTab === 'A';
    const list = isRandomFeed ? randomPosts : videos;
    const current = isRandomFeed ? currentDiscoverIndex : currentIndex;
    
    // Safety check for empty lists
    if (!list || list.length === 0) {
      return;
    }
    
    // Only warm connections for valid indices
    const targets = [current + 1, current + 2].filter(i => i < list.length);
    
    // Track active connections for cleanup
    const activeConnections = [];
    
    targets.forEach(i => {
      const item = list[i];
      const uriCandidate = item?.videoUrl || item?.media?.[0]?.url;
      const isVideo = item?.type === 'video' || item?.media?.[0]?.type?.includes('video');
      
      if (isVideo && uriCandidate) {
        console.log('🔌 HOME: Warming connection for video:', i);
        
        // Store the fetch promise for potential cancellation
        const controller = new AbortController();
        const { signal } = controller;
        
        activeConnections.push(controller);
        
        fetch(uriCandidate, { 
          method: 'HEAD',
          signal
        }).catch(error => {
          if (isMounted && error.name !== 'AbortError') {
            console.log('❌ HOME: Connection warm-up failed:', error);
          }
        });
      }
    });
    
    // Cleanup function to abort any pending connection requests
    return () => {
      isMounted = false;
      activeConnections.forEach(controller => {
        try {
          controller.abort();
        } catch (error) {
          console.log('Error aborting connection:', error);
        }
      });
    };
  }, [currentIndex, currentDiscoverIndex, selectedTab, videos, randomPosts]);

  const renderRandomPostItem = ({ item, index, dynamicVideoContainerStyle, dynamicVideoStyle }) => {
    const mediaItems = item.media || [{ url: item.imageUrl || item.videoUrl, type: item.type }];
    const hasMultipleMedia = mediaItems.length > 1;
    
    return (
    <View 
      style={dynamicVideoContainerStyle || styles.videoContainer}
    >
      {/* Background Media - Swipeable Carousel */}
      {hasMultipleMedia ? (
        <MediaCarousel 
          media={mediaItems}
          style={dynamicVideoStyle || styles.postImage}
        />
      ) : (
        // Single media item (existing logic)
        (() => {
          const isVideo = item.type === 'video' || mediaItems[0]?.type?.includes('video');
          return isVideo ? (
            <TouchableOpacity 
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              activeOpacity={1}
              onPress={() => handlePostPress(item)}
            >
              <EnhancedVideo
                uri={item.videoUrl || mediaItems[0]?.url || 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4'}
                poster={item.thumbnail || mediaItems[0]?.thumbnail || item.user?.avatar || item.user?.photoURL}
                style={[
                  {
                    position: 'absolute',
                    top: 40,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'black'
                  }
                ]}
                shouldPlay={isScreenFocused && selectedTab === 'A' && index === currentDiscoverIndex}
                shouldLoad={Math.abs(currentDiscoverIndex - index) <= 2}
                isLooping={true}
                isMuted={false}
                resizeMode="contain"
              />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              activeOpacity={1}
              onPress={() => handlePostPress(item)}
            >
              <View style={{ position: 'relative', width: '100%', height: '100%' }}>
                <Image 
                  source={{ uri: item.imageUrl || mediaItems[0]?.url || 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&h=400&fit=crop' }} 
                  style={styles.video} 
                />
                {/* Subtle overlay to enhance vibrancy */}
                <View style={styles.imageEnhancementOverlay} />
              </View>
            </TouchableOpacity>
          );
        })()
      )}
      
      {/* Dark overlay for better text readability */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.8)']}
        style={styles.videoOverlay}
      />

      {/* New Profile Menu Bar */}
      <View style={[styles.profileMenuBar, { zIndex: 1000, elevation: 1000 }]}>
        <LinearGradient
          colors={['#a855f7', '#d946ef', '#ec4899']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.userInfoHighlight}
        >
            <TouchableOpacity style={styles.profileMenuBarSection} onPress={() => handleUserProfilePress(item.user, item)}>
                <Text style={styles.profileMenuBarUsername} allowFontScaling={false}>@{item.user?.username || item.username || 'user'}</Text>
                <Image source={{ uri: item.userPhotoURL || item.user?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face' }} style={styles.profileMenuBarAvatar} />
            </TouchableOpacity>
        </LinearGradient>

        {/* Right side: action buttons */}
        <View style={styles.profileMenuBarSection}>
            {/* Like Button */}
            <TouchableOpacity 
              style={[styles.actionButton, { zIndex: 1000 }]} 
              activeOpacity={0.8}
              delayPressIn={0}
              onPress={(event) => {
                event.stopPropagation();
                event.preventDefault?.();
                handleLike(item.id);
              }}
              onTouchEnd={(event) => {
                event.stopPropagation();
                event.preventDefault?.();
              }}
              onTouchStart={(event) => {
                event.stopPropagation();
                event.preventDefault?.();
              }}
            >
                <Ionicons name={liked[item.id] ? "heart" : "heart-outline"} size={28} color={liked[item.id] ? "#ff1744" : "white"} />
            </TouchableOpacity>
            {/* Comment Button */}
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={(event) => {
                event.stopPropagation();
                handleOpenComments(item);
              }}
            >
                <Ionicons name="chatbubble-outline" size={28} color="white" />
            </TouchableOpacity>
            {/* Share Button */}
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={(event) => {
                event.stopPropagation();
              }}
            >
                <Ionicons name="arrow-redo-outline" size={28} color="white" />
            </TouchableOpacity>
            {/* Gift Button */}
            <View style={styles.actionButton}>
              <GiftSystem 
                postId={item.id}
                creatorId={item.uid || item.userId}
                creatorName={typeof item.user === 'object' ? item.user.username : item.user || item.username}
              />
            </View>
        </View>
      </View>

      {/* Bottom content */}
      <View style={styles.bottomContent}>
        {/* Description moved down towards footer */}
        <View style={styles.descriptionContainerBottom}>
          <Text style={styles.description} allowFontScaling={false}>{item.caption || item.description || item.title}</Text>
        </View>
      </View>

      {/* Heart Animation Overlay */}
      <HeartAnimation 
        key={heartAnimationKey}
        visible={showHeartAnimation}
        onAnimationComplete={() => setShowHeartAnimation(false)}
      />

      {/* Post Info Container - New Section */}
      <TouchableOpacity 
        style={styles.postInfoContainer}
        activeOpacity={0.7}
        onPress={() => setIsTitleBarMinimized(!isTitleBarMinimized)}
      >
        <View style={styles.minimizeButton}>
          <Ionicons 
            name={isTitleBarMinimized ? "chevron-up" : "chevron-down"} 
            size={20} 
            color="#fff" 
          />
        </View>
        {!isTitleBarMinimized && (
          <>
            <Text style={styles.postName}>{item.title || ''}</Text>
            <Text style={styles.postDescription}>{item.description || ''}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <TouchableOpacity style={styles.headerMenuButton} onPress={() => setMenuVisible(true)}>
          <Ionicons name="menu" size={24} color="#d1d5db" />
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
            { key: 'A', label: '#4ME' },
            { key: 'B', label: "What's Hot" },
            { key: 'C', label: 'Categories' },
            { key: 'D', label: 'Hashtags' }
          ].map((tab, index) => (
            <TouchableOpacity
              key={tab.key}
              style={styles.tab}
              onPress={() => setSelectedTab(tab.key)}
            >
              <Text style={[
                styles.tabText,
                selectedTab === tab.key && styles.activeTabText
              ]} allowFontScaling={false}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
          <LinearGradient
            colors={['#a855f7', '#d946ef', '#ec4899']}
            style={[
              styles.tabIndicator,
              { 
                left: `${['A', 'B', 'C', 'D'].indexOf(selectedTab) * 25}%` 
              }
            ]}
          />
        </View>
      </View>
    </View>
  );

  const renderTopNavigation = () => (
    <View style={styles.topNav}>
      <TouchableOpacity style={styles.navButton}>
        <Text style={[styles.navText, styles.inactiveNavText]} allowFontScaling={false}>Following</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.navButton}>
        <Text style={[styles.navText, styles.activeNavText]} allowFontScaling={false}>#4ME</Text>
        <View style={styles.activeIndicator} />
      </TouchableOpacity>
    </View>
  );

  const renderVideoItem = ({ item, index, dynamicVideoContainerStyle, dynamicVideoStyle }) => (
    <View 
      style={dynamicVideoContainerStyle || styles.videoContainer}
    >
      {/* Background Video */}
      <TouchableOpacity 
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        activeOpacity={1}
        onPress={() => handlePostPress(item)}
      >
        <EnhancedVideo
          uri={item.videoUrl || 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4'}
          poster={item.thumbnail || item.user?.avatar}
          style={[styles.video, { height: availableHeight - footerHeight, width: screenWidth }]}
          shouldPlay={isScreenFocused && selectedTab === 'B' && index === currentIndex}
          shouldLoad={Math.abs(currentIndex - index) <= 2}
          isLooping={true}
          isMuted={false}
          resizeMode="cover"
        />
      </TouchableOpacity>
      
      {/* Dark overlay for better text readability */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.8)']}
        style={styles.videoOverlay}
      />
      
      {/* New Profile Menu Bar */}
      <View style={[styles.profileMenuBar, { zIndex: 1000, elevation: 1000 }]}>
        <LinearGradient
          colors={['#a855f7', '#d946ef', '#ec4899']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.userInfoHighlight}
        >
            <TouchableOpacity style={styles.profileMenuBarSection} onPress={() => handleUserProfilePress(item.user, item)}>
                <Text style={styles.profileMenuBarUsername} allowFontScaling={false}>@{item.user?.username || 'user'}</Text>
                <Image source={{ uri: item.userPhotoURL || item.user?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face' }} style={styles.profileMenuBarAvatar} />
            </TouchableOpacity>
        </LinearGradient>

        {/* Right side: action buttons */}
        <View style={styles.profileMenuBarSection}>
            {/* Like Button */}
            <TouchableOpacity 
              style={[styles.actionButton, { zIndex: 1000 }]} 
              activeOpacity={0.8}
              delayPressIn={0}
              onPress={(event) => {
                event.stopPropagation();
                event.preventDefault?.();
                handleLike(item.id);
              }}
              onTouchEnd={(event) => {
                event.stopPropagation();
                event.preventDefault?.();
              }}
              onTouchStart={(event) => {
                event.stopPropagation();
                event.preventDefault?.();
              }}
            >
                <Ionicons name={liked[item.id] ? "heart" : "heart-outline"} size={28} color={liked[item.id] ? "#ff1744" : "white"} />
            </TouchableOpacity>
            {/* Comment Button */}
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={(event) => {
                event.stopPropagation();
                handleOpenComments(item);
              }}
            >
                <Ionicons name="chatbubble-outline" size={28} color="white" />
            </TouchableOpacity>
            {/* Share Button */}
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={(event) => {
                event.stopPropagation();
              }}
            >
                <Ionicons name="arrow-redo-outline" size={28} color="white" />
            </TouchableOpacity>
            {/* Gift Button */}
            <View style={styles.actionButton}>
              <GiftSystem 
                postId={item.id}
                creatorId={item.uid || item.userId}
                creatorName={typeof item.user === 'object' ? item.user.username : item.user || item.username}
              />
            </View>
        </View>
      </View>

      {/* Bottom content */}
      <View style={styles.bottomContent}>
        {/* Description moved down towards footer */}
        <View style={styles.descriptionContainerBottom}>
          <Text style={styles.description} allowFontScaling={false}>{item.description || item.transcript}</Text>
        </View>
      </View>

      {/* Heart Animation Overlay */}
      <HeartAnimation 
        key={heartAnimationKey}
        visible={showHeartAnimation}
        onAnimationComplete={() => setShowHeartAnimation(false)}
      />

      {/* Post Info Container - New Section */}
      <TouchableOpacity 
        style={styles.postInfoContainer}
        activeOpacity={0.7}
        onPress={() => setIsTitleBarMinimized(!isTitleBarMinimized)}
      >
        <View style={styles.minimizeButton}>
          <Ionicons 
            name={isTitleBarMinimized ? "chevron-up" : "chevron-down"} 
            size={20} 
            color="#fff" 
          />
        </View>
        {!isTitleBarMinimized && (
          <>
            <Text style={styles.postName}>{item.title || ''}</Text>
            <Text style={styles.postDescription}>{item.description || ''}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderTabContent = (dynamicVideoFeedStyle, dynamicVideoContainerStyle, dynamicVideoStyle) => {
    switch (selectedTab) {
      case 'A': // #4ME feed now uses randomPosts
        return (
          <View style={dynamicVideoFeedStyle}>
            {/* Random Posts (#4ME) Feed */}
            {loading ? (
              <View style={styles.loadingContainer}>
                <Ionicons name="reload" size={32} color="#ec4899" />
                <Text style={styles.loadingText} allowFontScaling={false}>Loading posts...</Text>
              </View>
            ) : (
              <FlatList
                ref={flatListRef}
                data={randomPosts}
                renderItem={(props) => {
                  const modifiedProps = {
                    ...props,
                    dynamicVideoContainerStyle,
                    dynamicVideoStyle
                  };
                  return renderRandomPostItem(modifiedProps);
                }}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                refreshing={loading}
                onRefresh={loadRandomPosts}
                pagingEnabled={true}
                snapToInterval={screenHeight}
                scrollEnabled={true}
                decelerationRate="fast"
                removeClippedSubviews={true}
                maxToRenderPerBatch={1}
                windowSize={2}
                initialNumToRender={1}
                updateCellsBatchingPeriod={100}
                getItemLayout={(data, index) => ({
                  length: screenHeight,
                  offset: screenHeight * index,
                  index,
                })}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={{
                  itemVisiblePercentThreshold: 80,
                  minimumViewTime: 100,
                }}
              />
            )}
          </View>
        );
      case 'B': // What's Hot Popular content
        return (
          <WhatsAppPopularTab
            posts={randomPosts}
            videos={randomPosts.filter(post => post.type === 'video')}
            onPopularPostSelect={(category, popularPosts) => {
              console.log('� What\'s Hot popular category selected:', category.name, 'Posts:', popularPosts.length);
              // Could navigate to filtered view or update state
            }}
            navigation={navigation}
          />
        );
      case 'C':
        return (
          <CategoriesTab
            posts={randomPosts}
            onCategorySelect={(category, filtered) => {
              console.log('📂 Category selected:', category.name, 'Posts:', filtered.length);
              setSelectedCategory(category);
              setFilteredPosts(filtered);
            }}
            navigation={navigation}
          />
        );
      case 'D':
        return (
          <HashtagsTab
            posts={randomPosts}
            userInteractions={[]} // Could pass user interaction data here
            onHashtagSelect={(hashtags, filtered) => {
              console.log('🏷️ Hashtags selected:', hashtags, 'Posts:', filtered.length);
              setSelectedHashtags(hashtags);
              setFilteredPosts(filtered);
            }}
            navigation={navigation}
          />
        );
      default:
        return null;
    }
  };

  // Full-screen video feed
  const dynamicVideoFeedStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'black',
  };

  const dynamicVideoContainerStyle = {
    width: screenWidth,
    height: screenHeight,
    backgroundColor: 'black',
    overflow: 'hidden',
    position: 'relative',
  };

  const dynamicVideoStyle = {
    width: '100%',
    height: '100%',
    backgroundColor: 'black',
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      <View 
        style={styles.fullscreenContent}
      >
        {renderTabContent(dynamicVideoFeedStyle, dynamicVideoContainerStyle, dynamicVideoStyle)}
      </View>
      <View style={styles.headerOverlay}>
        {renderHeader()}
      </View>
      
      {/* Daily Rewards */}
      <DailyRewards />

      {/* Comments Modal */}
      <CommentsModal
        visible={commentsVisible}
        onClose={handleCloseComments}
        postId={selectedPost?.id}
        postData={selectedPost}
      />

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
              style={styles.menuButton}
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  header: {
    backgroundColor: '#0f172a',
    paddingTop: 50,
    paddingBottom: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  headerMenuButton: {
    padding: 8,
  },
  // logoContainer style is defined below
  
  logoGradient: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  logoText: {
    fontSize: responsiveFont(28), // Smaller for Dad's device
    fontWeight: '800',
    textAlign: 'center',
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  searchButton: {
    padding: 8,
  },
  logoContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 2,
  },
  balanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 4,
  },
  balanceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  coinIcon: {
    fontSize: 10,
  },
  gemIcon: {
    fontSize: 10,
  },
  balanceText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
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
    includeFontPadding: false,
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
  fullscreenContent: {
    flex: 1,
    backgroundColor: 'black',
    position: 'relative',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  videoFeedContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  comingSoon: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  comingSoonTitle: {
    fontSize: responsiveFont(22),
    fontWeight: 'bold',
    color: '#e2e8f0',
    marginTop: responsiveSize(16),
    marginBottom: responsiveSize(8),
  },
  comingSoonText: {
    fontSize: responsiveFont(15),
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: responsiveFont(22),
  },
  exploreContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  exploreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  exploreTitle: {
    fontSize: responsiveFont(20),
    fontWeight: '800',
    color: '#ffffff',
  },
  refreshButton: {
    padding: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: responsiveFont(15),
  },
  randomPostsList: {
    paddingVertical: 20,
  },
  randomPostContainer: {
    backgroundColor: '#1e293b',
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    overflow: 'hidden',
    height: 384, // Fixed height for consistent snapping (300px media + 84px for header/actions/caption)
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  userDetails: {
    flex: 1,
  },
  postUsername: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  postTimestamp: {
    color: '#9ca3af',
    fontSize: 12,
  },
  followButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#ec4899',
    borderRadius: 16,
  },
  followButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  postMediaContainer: {
    position: 'relative',
  },
  postMedia: {
    width: '100%',
    height: 300,
  },
  videoIndicator: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 6,
  },
  postActions: {
    padding: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
    gap: 4,
    position: 'relative',
    zIndex: 1000,
    elevation: 1000,
  },
  actionCount: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  spacer: {
    flex: 1,
  },
  postCaption: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  captionText: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 20,
  },
  captionUsername: {
    fontWeight: '600',
    color: '#ffffff',
  },
  topNav: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    paddingHorizontal: 20,
  },
  navButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    position: 'relative',
  },
  navText: {
    fontSize: 18,
    fontWeight: '700',
  },
  activeNavText: {
    color: 'white',
  },
  inactiveNavText: {
    color: 'rgba(255, 255, 255, 0.6)',
  },
  activeIndicator: {
    position: 'absolute',
    bottom: 5,
    left: 20,
    right: 20,
    height: 2,
    backgroundColor: 'white',
  },
  videoContainer: {
    width: screenWidth,
    height: screenHeight - 200, // Simple fallback height
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black',
  },
  video: {
    width: '100%',
    height: '100%',
    backgroundColor: 'black',
  },
  videoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  avatarContainer: {
    marginBottom: 24,
    alignItems: 'center',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: 'white',
  },
  followButton: {
    position: 'absolute',
    bottom: -8,
    backgroundColor: '#ff1744',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButton: {
    alignItems: 'center',
    marginHorizontal: 8,
  },
  actionText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  musicButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  bottomContent: {
    position: 'absolute',
    bottom: 60,
    left: 20,
    right: 80,
  },
  username: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  description: {
    color: 'white',
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 8,
    fontWeight: '800',
  },
  musicText: {
    color: 'white',
    fontSize: 14,
    fontStyle: 'italic',
    opacity: 0.9,
  },
  // Description container positioned at top-left aligned with purple bar
  descriptionContainerBottom: {
    position: 'absolute',
    top: 164, // Aligned with purple bar position
    left: 15,
    right: 200, // Leave space for purple bar on right
    paddingHorizontal: 10,
  },
  profileMenuBar: {
    position: 'absolute',
    bottom: footerHeight - 20, // Moved down by 30 pixels (was +10, now -20)
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    gap: 15,
  },
  userInfoHighlight: {
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  profileMenuBarSection: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
  },
  profileMenuBarUsername: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 16,
  },
  profileMenuBarAvatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
  },
  postInfoContainer: {
    position: 'absolute',
    bottom: 130, // Moved down by 30 pixels (was 160, now 130)
    left: 63, // Increased by 45px (18 + 45 = 63)
    right: 63, // Increased by 45px (18 + 45 = 63) - total width reduction of 90px
    padding: 12,
    backgroundColor: 'rgba(30,30,40,0.3)', // Increased transparency by 50% (was 0.6, now 0.3)
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 6,
    shadowOffset: {width: 0, height: 2},
  },
  postName: {
    fontWeight: 'bold',
    fontSize: 18,
    color: '#fff',
    marginBottom: 6,
    textAlign: 'center', // Center-align the title text
  },
  postDescription: {
    fontSize: 15,
    color: '#e0e0e0',
    textAlign: 'center', // Center-align the description text
  },
  minimizeButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  // MediaCarousel styles
  carouselContainer: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  carouselItemContainer: {
    width: Dimensions.get('window').width, // Full screen width for proper pagination
    height: '100%',
  },
  carouselMedia: {
    width: Dimensions.get('window').width,
    height: '100%',
    borderRadius: 15,
  },
  imageEnhancementOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.03)', // Very subtle white overlay for brightness
    mixBlendMode: 'screen', // This will brighten the image (iOS only)
    pointerEvents: 'none', // Allow touch events to pass through
  },
  mediaCounter: {
    position: 'absolute',
    top: 15,
    right: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
  },
  mediaCounterText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  paginationDots: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    marginHorizontal: 4,
  },
  paginationDotActive: {
    backgroundColor: '#fff',
    width: 10,
    height: 10,
    borderRadius: 5,
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
    marginTop: 70, // Position below the header
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
  menuButton: {
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
});

export default HomeScreen;