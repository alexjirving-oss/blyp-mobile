// HomeScreen.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Icon from '../components/Icon';
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
  Animated,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { db, auth, firebaseEnabled, firestore } from '../config/firebase';
import SimpleVideo from '../components/OptimizedVideo'; // legacy simple
import EnhancedVideo from '../components/EnhancedVideo';
import * as FileSystem from 'expo-file-system/legacy';
import UnifiedVideo from '../components/UnifiedVideo';
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
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';
import { fixStorageUrl } from '../utils/urlUtils';
import AudioTile from '../components/AudioTile';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const DEFAULT_HEADER_HEIGHT = responsiveSize(120);
const footerHeight = responsiveSize(88);

// All mock/fallback video content removed. Feed now relies solely on Firestore.

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
  { user: 'creative_studio', text: 'Pure artistry', time: '1h' },
];

// === MediaCarousel (fixed) ===
const MediaCarousel = ({ media, style, feedIndex, isDiscoverItemActive }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems && viewableItems.length > 0) {
      const vi = viewableItems[0];
      if (typeof vi.index === 'number') setCurrentIndex(vi.index);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  if (!media || !Array.isArray(media) || media.length === 0) {
    return null;
  }

  const renderMediaItem = ({ item, index }) => {
    const isVideo =
      item.type === 'video' ||
      (item.type && item.type.includes && item.type.includes('video')) ||
      !!item.videoUrl;

    const mediaUri = fixStorageUrl(item.url || item.uri || item.videoUrl || item.imageUrl);

    if (isVideo) {
      return (
        <View style={styles.carouselItemContainer}>
          <EnhancedVideo
            uri={mediaUri}
            poster={item.thumbnail}
            style={[styles.carouselMedia, style]}
            shouldPlay={isDiscoverItemActive ? isDiscoverItemActive(feedIndex) && index === currentIndex : index === currentIndex}
            shouldLoad={Math.abs(currentIndex - index) <= 1}
            isLooping={true}
            isMuted={true}
            resizeMode="cover"
          />
        </View>
      );
    }

    return (
      <View style={styles.carouselItemContainer}>
        <Image source={{ uri: mediaUri }} style={[styles.carouselMedia, style]} resizeMode="cover" />
        <View style={styles.imageEnhancementOverlay} />
      </View>
    );
  };

  return (
    <View style={styles.carouselContainer}>
      <FlatList
        data={media}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={renderMediaItem}
        keyExtractor={(item, index) => `media-${index}`}
      />

      <View style={styles.mediaCounter}>
        <Text style={styles.mediaCounterText} allowFontScaling={false}>
          {currentIndex + 1}/{media.length}
        </Text>
      </View>

      {media.length > 1 && (
        <View style={styles.paginationDots}>
          {media.map((_, idx) => (
            <View
              key={idx}
              style={[styles.paginationDot, idx === currentIndex && styles.paginationDotActive]}
            />
          ))}
        </View>
      )}
    </View>
  );
};
// === end MediaCarousel ===

const formatBalance = (balance) => {
  if (balance >= 1000000) return (balance / 1000000).toFixed(1) + 'M';
  if (balance >= 1000) return (balance / 1000).toFixed(1) + 'K';
  return balance.toString();
};

const HomeScreen = ({ navigation }) => {
  const [videos, setVideos] = useState([]);
    const [isEmptyFeed, setIsEmptyFeed] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [liked, setLiked] = useState({});
  const [following, setFollowing] = useState({});
  const [selectedTab, setSelectedTab] = useState('A');
  const selectedTabRef = useRef('A');
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
  // Header height state (measured). Use a default until first layout pass.
  const [headerHeight, setHeaderHeight] = useState(0);
  const [descriptionVisibleIndex, setDescriptionVisibleIndex] = useState(null); // active index showing full description
  const descriptionHideTimeout = useRef(null);
  const [feedHeight, setFeedHeight] = useState(0);
  // feedHeight will be measured from the available content area (between header and bottom tabs)

  const flatListRef = useRef(null);
  const prefetchingRef = useRef({});
  const commentScrollValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    selectedTabRef.current = selectedTab;
  }, [selectedTab]);

  // Auto-hide description overlay for #4ME active item
  useEffect(() => {
    if (selectedTab !== 'A' || !isScreenFocused) return;
    if (randomPosts.length === 0) return;

    setDescriptionVisibleIndex(currentDiscoverIndex);
    if (descriptionHideTimeout.current) {
      clearTimeout(descriptionHideTimeout.current);
    }
    descriptionHideTimeout.current = setTimeout(() => {
      setDescriptionVisibleIndex(null);
    }, 2000);

    return () => {
      if (descriptionHideTimeout.current) {
        clearTimeout(descriptionHideTimeout.current);
        descriptionHideTimeout.current = null;
      }
    };
  }, [currentDiscoverIndex, selectedTab, isScreenFocused, randomPosts.length]);

  const handleShowDescription = (index) => {
    setDescriptionVisibleIndex(index);
    if (descriptionHideTimeout.current) {
      clearTimeout(descriptionHideTimeout.current);
    }
    descriptionHideTimeout.current = setTimeout(() => {
      setDescriptionVisibleIndex(null);
    }, 2000);
  };

  useEffect(() => {
    const animateComments = () => {
      commentScrollValue.setValue(0);
      Animated.loop(
        Animated.timing(commentScrollValue, {
          toValue: 1,
          duration: 19500,
          useNativeDriver: true,
        }),
        { iterations: -1 }
      ).start();
    };
    animateComments();
  }, []);

  const handleUserProfilePress = (user, post = null) => {
    const userId = post?.userId || user?.userId || user?.id || user?.username || Math.random().toString(36);
    const username = user?.username || '@user';
    console.log('📱 HomeScreen: Navigating to user profile:', { userId, username, userObj: user });
    navigation.navigate('UserProfile', {
      userId: userId,
      username: username,
    });
  };

  const handlePostPress = (post) => {
    console.log('🔍 Opening media viewer for post:', post.id);
    navigation.navigate('MediaViewer', { post });
  };

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

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      return () => {
        setIsScreenFocused(false);
      };
    }, [])
  );

  useEffect(() => {
    console.log('🎬 HOME: Setting up video data listener');
    if (!firebaseEnabled || !db || typeof db.collection !== 'function') {
      console.warn('WARN [HOME] Firebase disabled or db unavailable (videos).');
      setVideos([]);
      return;
    }
    let isInitialLoad = true;
    let isMounted = true;
    const unsubscribe = db
      .collection('posts')
      .orderBy('date', 'desc')
      .limit(20)
      .onSnapshot(
        (snapshot) => {
          if (!isMounted) return;
          const allDocs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          const videoData = allDocs.filter((p) => p.type === 'video');
          const validVideos = videoData.filter((p) => {
            const uri = fixStorageUrl(p.videoUrl || p.mediaUrl || p?.media?.[0]?.url);
            return typeof uri === 'string' && uri.trim().length > 0;
          });
          console.log('📱 HOME: Firestore posts snapshot', {
            totalDocs: allDocs.length,
            videoDocs: videoData.length,
            validVideoDocs: validVideos.length,
            sample: allDocs.slice(0, 3).map((p) => ({ id: p.id, type: p.type, videoUrl: p.videoUrl })),
          });
          setVideos(validVideos);
          if (isInitialLoad) {
            setCurrentIndex(0);
            isInitialLoad = false;
          }
          if (auth.currentUser) {
            const userId = auth.currentUser.uid;
            const likedState = {};
            validVideos.forEach((video) => {
              likedState[video.id] = video.likedBy?.includes?.(userId) || false;
            });
            setLiked((prev) => ({ ...prev, ...likedState }));
          }
        },
        (error) => {
          console.error('❌ HOME: Error in video data listener:', error);
        }
      );
    return () => {
      isMounted = false;
      console.log('🧹 HOME: Cleaning up video data listener');
      unsubscribe();
    };
  }, [firebaseEnabled]);

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.log('💰 HOME: No user logged in, skipping balance subscriptions');
      return;
    }
    console.log('💰 HOME: Setting up balance subscriptions for user:', currentUser.uid);
    const userId = currentUser.uid;
    let isMounted = true;

    const unsubscribeCoin = BlypCoinService.subscribeToBalance(userId, (balance) => {
      if (isMounted) {
        console.log('💵 HOME: Received coin balance update:', balance);
        setCoinBalance(balance);
      }
    });

    const unsubscribeGems = GemService.subscribeToGems(userId, (balance) => {
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
  }, [auth.currentUser?.uid]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (selectedTab === 'A') {
        setCurrentDiscoverIndex((idx) => idx);
      } else if (selectedTab === 'B' && currentIndex === 0) {
        setCurrentIndex(0);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [selectedTab]);

  useEffect(() => {
    if (!firebaseEnabled || !db || typeof db.collection !== 'function') {
      console.warn('WARN [HOME] Firebase disabled or db unavailable (randomPosts).');
      setRandomPosts([]);
      setIsEmptyFeed(true);
      setLoading(false);
      return;
    }
    let mounted = true;
    let isInitialLoad = true;
    const unsubscribe = db
      .collection('posts')
      .orderBy('date', 'desc')
      .limit(30)
      .onSnapshot((snapshot) => {
        if (!mounted) return;
        const allPosts = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        const onlyVideos = allPosts.filter((p) => p.type === 'video');
        const validVideos = onlyVideos.filter((p) => {
          const uri = fixStorageUrl(p.videoUrl || p.mediaUrl || p?.media?.[0]?.url);
          return typeof uri === 'string' && uri.trim().length > 0;
        });
        if (validVideos.length === 0) {
          console.warn('WARN [HOME] No video posts found in Firestore (no fallback).');
          setRandomPosts([]);
          setIsEmptyFeed(true);
          setLoading(false);
          isInitialLoad = false;
        } else {
          const shuffled = [...validVideos].sort(() => 0.5 - Math.random());
          setRandomPosts(shuffled);
          setIsEmptyFeed(false);
          setLoading(false);
          isInitialLoad = false;
        }
        if (auth.currentUser) {
          const userId = auth.currentUser.uid;
          const likedState = {};
          validVideos.forEach((post) => {
            likedState[post.id] = post.likedBy?.includes(userId) || false;
          });
          setLiked((prev) => ({ ...prev, ...likedState }));
        }
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [firebaseEnabled]);

  const loadRandomPosts = () => {
    setLoading(true);
    setTimeout(() => {
      setRandomPosts((prev) => [...prev].sort(() => 0.5 - Math.random()));
      setLoading(false);
    }, 500);
  };

  const handleLike = async (videoId) => {
    if (!auth.currentUser) return;
    const userId = auth.currentUser.uid;
    const postRef = db.collection('posts').doc(videoId);
    const post = videos.find((v) => v.id === videoId);
    try {
      const isCurrentlyLiked = liked[videoId];
      setLiked((prev) => ({ ...prev, [videoId]: !prev[videoId] }));
      if (isCurrentlyLiked) {
        await postRef.update({
          likedBy: firestore.FieldValue.arrayRemove(userId),
          likes: firestore.FieldValue.increment(-1),
        });
        if (post && post.userId) {
          await trackActivity(ACTIVITY_TYPES.UNLIKE, userId, post.userId, {
            postId: videoId,
            postTitle: post.title || post.caption || post.description,
          });
        }
      } else {
        await postRef.update({
          likedBy: firestore.FieldValue.arrayUnion(userId),
          likes: firestore.FieldValue.increment(1),
        });
        setShowHeartAnimation(true);
        setHeartAnimationKey((prev) => prev + 1);
        if (post && post.userId) {
          await trackActivity(ACTIVITY_TYPES.LIKE, userId, post.userId, {
            postId: videoId,
            postTitle: post.title || post.caption || post.description,
          });
        }
      }
    } catch (error) {
      console.error('Error updating like:', error);
      setLiked((prev) => ({ ...prev, [videoId]: !prev[videoId] }));
    }
  };

  const handleFollow = async (username) => {
    const userId = username;
    const wasFollowing = following[username];
    const newFollowStatus = !wasFollowing;
    setFollowing((prev) => ({ ...prev, [username]: newFollowStatus }));
    try {
      console.log(newFollowStatus ? `Following ${username}!` : `Unfollowed ${username}`);
    } catch (error) {
      console.error('Error updating follow status:', error);
      setFollowing((prev) => ({ ...prev, [username]: wasFollowing }));
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

  // onViewableItemsChanged used for the main feed lists
  // Viewability handler for #4ME feed only (ensures single active item)
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (selectedTabRef.current !== 'A') return;
    if (!viewableItems || viewableItems.length === 0) return;
    const first = viewableItems[0];
    if (typeof first.index === 'number') {
      setCurrentDiscoverIndex(first.index);
      console.log('🎯 #4ME active index updated', first.index);
    }
  }).current;

  // Active item resolver for #4ME feed
  const isDiscoverItemActive = (index) => {
    if (!isScreenFocused) return false;
    if (selectedTab !== 'A') return false;
    if (currentDiscoverIndex == null || currentDiscoverIndex < 0) {
      return index === 0; // fallback
    }
    return index === currentDiscoverIndex;
  };

  // Prefetch next video's file for active feed
  useEffect(() => {
    let isMounted = true;
    const isRandomFeed = selectedTab === 'A';
    const list = isRandomFeed ? randomPosts : videos;
    const current = isRandomFeed ? currentDiscoverIndex : currentIndex;
    const nextIndex = current + 1;

    if (!list || list.length === 0 || nextIndex >= list.length) {
      return;
    }

    const nextItem = list[nextIndex];
    let nextUriCandidate = nextItem?.videoUrl || nextItem?.media?.[0]?.url;
    const isVideo = nextItem?.type === 'video' || nextItem?.media?.[0]?.type?.includes('video');

    nextUriCandidate = fixStorageUrl(nextUriCandidate);

    if (isVideo && nextUriCandidate && !prefetchingRef.current[nextUriCandidate]) {
      console.log('🎞️ HOME: Prefetching next video:', nextIndex);
      prefetchingRef.current[nextUriCandidate] = true;

      const fileName = encodeURIComponent(nextUriCandidate).replace(/[^a-zA-Z0-9]/g, '').substring(0, 48);
      const fileUri = `${FileSystem.cacheDirectory}vid-${fileName}.mp4`;

      FileSystem.downloadAsync(nextUriCandidate, fileUri)
        .catch((error) => {
          if (isMounted) {
            console.log('❌ HOME: Error prefetching video:', error);
            prefetchingRef.current[nextUriCandidate] = false;
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [currentIndex, currentDiscoverIndex, selectedTab, videos, randomPosts]);

  // Warm TCP/SSL connections for next two videos in active feed
  useEffect(() => {
    let isMounted = true;
    const isRandomFeed = selectedTab === 'A';
    const list = isRandomFeed ? randomPosts : videos;
    const current = isRandomFeed ? currentDiscoverIndex : currentIndex;

    if (!list || list.length === 0) return;

    const targets = [current + 1, current + 2].filter((i) => i < list.length);
    const activeConnections = [];

    targets.forEach((i) => {
      const item = list[i];
      const uriCandidate = fixStorageUrl(item?.videoUrl || item?.media?.[0]?.url);
      const isVideo = item?.type === 'video' || item?.media?.[0]?.type?.includes('video');

      if (isVideo && uriCandidate) {
        console.log('🔌 HOME: Warming connection for video:', i);
        const controller = new AbortController();
        const { signal } = controller;
        activeConnections.push(controller);

        fetch(uriCandidate, {
          method: 'HEAD',
          signal,
        }).catch((error) => {
          if (isMounted && error.name !== 'AbortError') {
            console.log('❌ HOME: Connection warm-up failed:', error);
          }
        });
      }
    });

    return () => {
      isMounted = false;
      activeConnections.forEach((c) => {
        try {
          c.abort();
        } catch (e) {
          console.log('Error aborting connection:', e);
        }
      });
    };
  }, [currentIndex, currentDiscoverIndex, selectedTab, videos, randomPosts]);

  const renderRandomPostItem = ({ item, index, feedHeight }) => {
    const mediaItems = item.media || [{ url: fixStorageUrl(item.imageUrl || item.videoUrl), type: item.type }];
    const hasMultipleMedia = mediaItems.length > 1;
    const isActive = isScreenFocused && selectedTab === 'A' && index === currentDiscoverIndex;
    const showFullDescription = isActive && descriptionVisibleIndex === index;

    return (
      <View style={[styles.videoContainer, { height: feedHeight || screenHeight }]}>
        {hasMultipleMedia ? (
          <MediaCarousel media={mediaItems} style={StyleSheet.absoluteFill} feedIndex={index} isDiscoverItemActive={isDiscoverItemActive} />
        ) : (
          (() => {
            const isVideo = item.type === 'video' || mediaItems[0]?.type === 'video' || (mediaItems[0]?.type && String(mediaItems[0]?.type).includes('video'));
            const isAudio = item.type === 'audio' || mediaItems[0]?.type === 'audio';
            return isVideo ? (
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => handlePostPress(item)}>
                {console.log('🎥 HOME: Rendering #4ME video item', {
                  id: item.id,
                  index,
                  isFocused: isScreenFocused && selectedTab === 'A' && index === currentDiscoverIndex,
                  videoUrl: item.videoUrl,
                  mediaUrl: mediaItems[0]?.url,
                })}
                <UnifiedVideo
                  source={{
                    uri: fixStorageUrl(item.videoUrl || mediaItems[0]?.url),
                  }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                  shouldPlay={isDiscoverItemActive(index)}
                  isLooping
                  isMuted={false}
                  onError={(e) => {
                    console.log('❌ Feed Video error', { id: item.id, uri: item.videoUrl || mediaItems[0]?.url, error: e });
                  }}
                  onLoad={(info) => {
                    console.log('🎥 Feed Video loaded', {
                      id: item.id,
                      uri: item.videoUrl || mediaItems[0]?.url,
                      naturalSize: info.naturalSize,
                    });
                  }}
                />
              </TouchableOpacity>
            ) : isAudio ? (
              <AudioTile
                uri={fixStorageUrl(item.audioUrl || mediaItems[0]?.url)}
                user={item.user}
                title={item.title}
                autoPlay={isDiscoverItemActive(index)}
                shouldLoad={Math.abs(currentDiscoverIndex - index) <= 2}
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => handlePostPress(item)}>
                <View style={{ position: 'relative', width: '100%', height: '100%' }}>
                  {(() => {
                    const imageUri = fixStorageUrl(item.imageUrl || mediaItems[0]?.url);
                    const hasValidImage = typeof imageUri === 'string' && imageUri.trim().length > 0;
                    
                    if (!hasValidImage) {
                      return (
                        <View style={[styles.video, { backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' }]}>
                          <Text style={{ color: '#64748b', fontSize: 14 }}>Image unavailable</Text>
                        </View>
                      );
                    }
                    
                    return (
                      <Image 
                        source={{ uri: imageUri }} 
                        style={styles.video}
                        onLoadStart={() => console.log('📷 HomeScreen: Image loading started')}
                        onLoad={() => console.log('✅ HomeScreen: Image loaded successfully')}
                        onError={(error) => {
                          console.warn('[HOME] Image failed to load', {
                            uri: imageUri,
                            error: error?.nativeEvent ?? null
                          });
                        }}
                      />
                    );
                  })()}
                  <View style={styles.imageEnhancementOverlay} />
                </View>
              </TouchableOpacity>
            );
          })()
        )}

        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.8)']} style={styles.videoOverlay} />

        <View style={[styles.profileMenuBar, { zIndex: 1000, elevation: 1000 }]}>
          <LinearGradient colors={['#a855f7', '#d946ef', '#ec4899']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.userInfoHighlight}>
            <TouchableOpacity style={styles.profileMenuBarSection} onPress={() => handleUserProfilePress(item.user, item)}>
              <Text style={styles.profileMenuBarUsername} allowFontScaling={false}>@{item.user?.username || item.username || 'user'}</Text>
              <Image source={{ uri: item.userPhotoURL || item.user?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face' }} style={styles.profileMenuBarAvatar} />
            </TouchableOpacity>
          </LinearGradient>

          <View style={styles.profileMenuBarSection}>
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
              <Icon  name={liked[item.id] ? 'heart' : 'heart-outline'} size={28} color={liked[item.id] ? '#ff1744' : 'white'}  />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={(event) => {
                event.stopPropagation();
                handleOpenComments(item);
              }}
            >
              <Icon  name="chatbubble-outline" size={28} color="white"  />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={(event) => {
                event.stopPropagation();
              }}
            >
              <Icon  name="arrow-redo-outline" size={28} color="white"  />
            </TouchableOpacity>

            <View style={styles.actionButton}>
              <GiftSystem postId={item.id} creatorId={item.uid || item.userId} creatorName={typeof item.user === 'object' ? item.user.username : item.user || item.username} />
            </View>
          </View>
        </View>

        {/* Full description overlay (auto hides after 2s) */}
        {showFullDescription && (
          <View
            style={[
              styles.descriptionOverlayTop,
              { top: 8 }, // pinned just under the header/video top
            ]}
          >
            <Text style={styles.postTitle} numberOfLines={1} allowFontScaling={false}>
              {item.title || item.captionTitle || 'Untitled'}
            </Text>
            {(item.caption || item.description) && (
              <Text style={styles.postDescription} numberOfLines={3} allowFontScaling={false}>
                {item.caption || item.description}
              </Text>
            )}
          </View>
        )}

        {/* Collapsed info chip */}
        {isActive && !showFullDescription && (
          <TouchableOpacity
            style={[
              styles.descriptionInfoChip,
              { top: 16 }, // just below the main overlay position
            ]}
            onPress={() => handleShowDescription(index)}
            activeOpacity={0.85}
          >
            <Text style={styles.descriptionInfoChipText} allowFontScaling={false}>Show details</Text>
          </TouchableOpacity>
        )}

        <HeartAnimation key={heartAnimationKey} visible={showHeartAnimation} onAnimationComplete={() => setShowHeartAnimation(false)} />
      </View>
    );
  };

  const renderHeader = () => (
    <View
      style={styles.header}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h && h !== headerHeight) setHeaderHeight(h);
      }}
    >
      <View style={styles.headerTop}>
        <TouchableOpacity style={styles.headerMenuButton} onPress={() => setMenuVisible(true)}>
          <Icon  name="menu" size={24} color="#d1d5db"  />
        </TouchableOpacity>
        <View style={styles.logoContainer}>
          <BlypLogo useGradientBackground={true} />
        </View>
        <TouchableOpacity style={styles.searchButton} onPress={() => navigation.navigate('Search')}>
          <Icon  name="search" size={24} color="#d1d5db"  />
        </TouchableOpacity>
      </View>

      <View style={styles.tabContainer}>
        <View style={styles.tabSelector}>
          {[{ key: 'A', label: '#4ME' }, { key: 'B', label: "What's Hot" }, { key: 'C', label: 'Categories' }, { key: 'D', label: 'Hashtags' }].map((tab) => (
            <TouchableOpacity key={tab.key} style={styles.tab} onPress={() => setSelectedTab(tab.key)}>
              <Text style={[styles.tabText, selectedTab === tab.key && styles.activeTabText]} allowFontScaling={false}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
          <LinearGradient
            colors={['#a855f7', '#d946ef', '#ec4899']}
            style={[
              styles.tabIndicator,
              {
                left: `${['A', 'B', 'C', 'D'].indexOf(selectedTab) * 25}%`,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );

  const renderTopNavigation = () => (
    <View style={styles.topNav}>
      <TouchableOpacity style={styles.navButton}>
        <Text style={[styles.navText, styles.inactiveNavText]} allowFontScaling={false}>
          Following
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.navButton}>
        <Text style={[styles.navText, styles.activeNavText]} allowFontScaling={false}>
          #4ME
        </Text>
        <View style={styles.activeIndicator} />
      </TouchableOpacity>
    </View>
  );

  const renderVideoItem = ({ item, index }) => (
    <View style={styles.videoContainer}>
      { item.type === 'audio' ? (
        <AudioTile
          uri={fixStorageUrl(item.audioUrl || item.media?.[0]?.url)}
          user={item.user}
          title={item.title}
          autoPlay={isScreenFocused && selectedTab === 'B' && index === currentIndex}
          shouldLoad={Math.abs(currentIndex - index) <= 2}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : (
        <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={() => handlePostPress(item)}>
          <EnhancedVideo
            uri={fixStorageUrl(item.videoUrl)}
            poster={item.thumbnail || item.user?.avatar}
            style={styles.video}
            shouldPlay={isScreenFocused && selectedTab === 'B' && index === currentIndex}
            shouldLoad={Math.abs(currentIndex - index) <= 2}
            isLooping={true}
            isMuted={false}
            resizeMode="cover"
          />
        </TouchableOpacity>
      )}

      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.8)']} style={styles.videoOverlay} />

      <View style={[styles.profileMenuBar, { zIndex: 1000, elevation: 1000 }]}>
        <LinearGradient colors={['#a855f7', '#d946ef', '#ec4899']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.userInfoHighlight}>
          <TouchableOpacity style={styles.profileMenuBarSection} onPress={() => handleUserProfilePress(item.user, item)}>
            <Text style={styles.profileMenuBarUsername} allowFontScaling={false}>@{item.user?.username || 'user'}</Text>
            <Image source={{ uri: item.userPhotoURL || item.user?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face' }} style={styles.profileMenuBarAvatar} />
          </TouchableOpacity>
        </LinearGradient>

        <View style={styles.profileMenuBarSection}>
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
            <Icon  name={liked[item.id] ? 'heart' : 'heart-outline'} size={28} color={liked[item.id] ? '#ff1744' : 'white'}  />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={(event) => {
              event.stopPropagation();
              handleOpenComments(item);
            }}
          >
            <Icon  name="chatbubble-outline" size={28} color="white"  />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={(event) => {
              event.stopPropagation();
            }}
          >
            <Icon  name="arrow-redo-outline" size={28} color="white"  />
          </TouchableOpacity>

          <View style={styles.actionButton}>
            <GiftSystem postId={item.id} creatorId={item.uid || item.userId} creatorName={typeof item.user === 'object' ? item.user.username : item.user || item.username} />
          </View>
        </View>
      </View>

      <View style={styles.bottomContent}>
        <View style={styles.descriptionContainerBottom}>
          <Text style={styles.description} allowFontScaling={false}>{item.description || item.transcript}</Text>
        </View>
      </View>

      <HeartAnimation key={heartAnimationKey} visible={showHeartAnimation} onAnimationComplete={() => setShowHeartAnimation(false)} />

      <TouchableOpacity style={styles.postInfoContainer} activeOpacity={0.7} onPress={() => setIsTitleBarMinimized(!isTitleBarMinimized)}>
        <View style={styles.minimizeButton}>
          <Icon  name={isTitleBarMinimized ? 'chevron-up' : 'chevron-down'} size={20} color="#fff"  />
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

  const renderTabContent = () => {
    switch (selectedTab) {
      case 'A':
        if (loading || !feedHeight) {
          return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <Icon name="reload" size={32} color="#ec4899" />
              <Text style={styles.loadingText} allowFontScaling={false}>
                Loading posts...
              </Text>
            </View>
          );
        }
        if (isEmptyFeed || randomPosts.length === 0) {
          return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>
              <Text style={{ color: '#94a3b8', fontSize: 16, textAlign: 'center' }} allowFontScaling={false}>
                No videos yet. Be the first to post on Blyp.
              </Text>
            </View>
          );
        }
        return (
          <View style={{ height: feedHeight }}>
            <FlatList
              ref={flatListRef}
              data={randomPosts}
              renderItem={(props) => renderRandomPostItem({ ...props, feedHeight })}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              refreshing={loading}
              onRefresh={loadRandomPosts}
              pagingEnabled
              snapToInterval={feedHeight}
              snapToAlignment="start"
              decelerationRate="fast"
              removeClippedSubviews
              maxToRenderPerBatch={1}
              windowSize={2}
              initialNumToRender={1}
              updateCellsBatchingPeriod={100}
              getItemLayout={(data, index) => ({
                length: feedHeight,
                offset: feedHeight * index,
                index,
              })}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={{
                itemVisiblePercentThreshold: 80,
                minimumViewTime: 250,
              }}
            />
          </View>
        );
      case 'B':
        return (
          <WhatsAppPopularTab
            posts={randomPosts}
            videos={randomPosts.filter((post) => post.type === 'video')}
            onPopularPostSelect={(category, popularPosts) => {
              console.log("What's Hot popular category selected:", category.name, 'Posts:', popularPosts.length);
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
            userInteractions={[]}
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

  // Other tabs still use flex fill; feedHeight applies only to #4ME list items.

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      {renderHeader()}
      <View
        style={styles.fullscreenContent}
        onLayout={(e) => {
          const { height } = e.nativeEvent.layout;
          if (height > 0 && height !== feedHeight) {
            setFeedHeight(height);
          }
        }}
      >
        {renderTabContent()}
      </View>

      <DailyRewards />

      <CommentsModal visible={commentsVisible} onClose={handleCloseComments} postId={selectedPost?.id} postData={selectedPost} />

      <Modal visible={menuVisible} transparent={true} animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuContainer}>
            <TouchableOpacity style={styles.menuCloseButton} onPress={() => setMenuVisible(false)}>
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
  container: { flex: 1, backgroundColor: 'black' },
  header: { backgroundColor: '#0f172a', paddingTop: 50, paddingBottom: 1, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 },
  headerMenuButton: { padding: 8 },
  logoContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabContainer: { paddingHorizontal: 16, paddingBottom: 12 },
  tabSelector: { position: 'relative', backgroundColor: '#374151', borderRadius: 9999, padding: 4, flexDirection: 'row' },
  tab: { flex: 1, paddingVertical: 6, alignItems: 'center', zIndex: 2 },
  tabText: { color: '#9ca3af', fontSize: 12, fontWeight: '600', includeFontPadding: false },
  activeTabText: { color: '#ffffff' },
  tabIndicator: { position: 'absolute', top: 2, bottom: 2, width: '25%', borderRadius: 9999, zIndex: 1 },
  fullscreenContent: { flex: 1, backgroundColor: 'black', position: 'relative' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: '#9ca3af', fontSize: responsiveFont(15) },
  topNav: { position: 'absolute', top: 50, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', zIndex: 1000, paddingHorizontal: 20 },
  navButton: { paddingHorizontal: 20, paddingVertical: 10, position: 'relative' },
  navText: { fontSize: 18, fontWeight: '700' },
  activeNavText: { color: 'white' },
  inactiveNavText: { color: 'rgba(255, 255, 255, 0.6)' },
  activeIndicator: { position: 'absolute', bottom: 5, left: 20, right: 20, height: 2, backgroundColor: 'white' },
  videoContainer: { width: screenWidth, justifyContent: 'center', alignItems: 'center', backgroundColor: 'black', overflow: 'hidden' },
  video: { width: '100%', height: '100%', backgroundColor: 'black' },
  videoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bottomContent: { position: 'absolute', top: 24, left: 20, right: 80 }, // retained for other tabs (#B) but not used in #4ME now
  description: { color: 'white', fontSize: 15, lineHeight: 20, marginBottom: 8, fontWeight: '800' },
  descriptionContainerBottom: { position: 'absolute', top: 164, left: 15, right: 200, paddingHorizontal: 10 },
  profileMenuBar: { position: 'absolute', bottom: 16, left: 10, right: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', zIndex: 1000, gap: 15 },
  userInfoHighlight: { borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 6 },
  profileMenuBarSection: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  profileMenuBarUsername: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  profileMenuBarAvatar: { width: 30, height: 30, borderRadius: 15 },
  postInfoContainer: { position: 'absolute', top: 0, left: 20, right: 20, padding: 12, backgroundColor: 'rgba(30,30,40,0.3)', borderRadius: 14 },
  descriptionOverlayTop: { position: 'absolute', left: 16, right: 16, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, backgroundColor: 'rgba(15,23,42,0.75)' },
  descriptionInfoChip: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.9)' },
  descriptionInfoChipText: { color: '#e5e7eb', fontSize: 12, fontWeight: '500' },
  postTitle: { fontWeight: '700', fontSize: 16, color: '#fff', marginBottom: 6 },
  postName: { fontWeight: 'bold', fontSize: 18, color: '#fff', marginBottom: 6, textAlign: 'center' },
  postDescription: { fontSize: 15, color: '#e0e0e0', textAlign: 'center' },
  minimizeButton: { position: 'absolute', top: -8, right: -8, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 15, width: 30, height: 30, justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  carouselContainer: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  carouselItemContainer: { width: Dimensions.get('window').width, height: '100%' },
  carouselMedia: { width: Dimensions.get('window').width, height: '100%', borderRadius: 15 },
  imageEnhancementOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255, 255, 255, 0.03)', pointerEvents: 'none' },
  mediaCounter: { position: 'absolute', top: 15, right: 15, backgroundColor: 'rgba(0, 0, 0, 0.7)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 15 },
  mediaCounterText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  paginationDots: { position: 'absolute', bottom: 20, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  paginationDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255, 255, 255, 0.5)', marginHorizontal: 4 },
  paginationDotActive: { backgroundColor: '#fff', width: 10, height: 10, borderRadius: 5 },
  actionButton: { alignItems: 'center', marginHorizontal: 8 },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-start', alignItems: 'flex-start' },
  menuContainer: { width: 250, backgroundColor: '#1e293b', borderRadius: 12, padding: 16, margin: 16, marginTop: 70, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5 },
  menuCloseButton: { alignSelf: 'flex-end', padding: 8 },
  menuTitle: { fontSize: responsiveFont(18), fontWeight: 'bold', color: '#ffffff', marginBottom: 16, textAlign: 'center' },
  balanceItems: { marginVertical: 8 },
  menuBalanceItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.1)', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginVertical: 6 },
  balanceIcon: { fontSize: responsiveFont(20), marginRight: 8 },
  balanceLabel: { flex: 1, fontSize: responsiveFont(14), color: '#d1d5db' },
  balanceValue: { fontSize: responsiveFont(16), fontWeight: 'bold', color: '#ffffff' },
  menuButton: { backgroundColor: 'rgba(236, 72, 153, 0.8)', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, marginTop: 16, alignItems: 'center' },
  menuButtonText: { color: '#ffffff', fontSize: responsiveFont(14), fontWeight: 'bold' },
});

export default HomeScreen;
