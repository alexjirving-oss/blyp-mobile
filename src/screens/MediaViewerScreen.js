import React, { useState, useEffect, useRef } from 'react';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Alert,
  StatusBar,
  Share,
  Animated,
  PanGesturer,
} from 'react-native';
import UnifiedVideo from '../components/UnifiedVideo';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from 'react-native-toast-message';
import { db, firestore, auth, firebaseEnabled } from '../config/firebase';
import PhotoGallery from '../components/PhotoGallery';
import HeartAnimation from '../components/HeartAnimation';
import { fixStorageUrl } from '../utils/urlUtils';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const MediaViewerScreen = ({ route, navigation }) => {
  const { post, postId, posts, currentIndex } = route.params;
  
  // Get the actual post object - handle both direct post and posts array
  const actualPost = post || (posts && postId ? posts.find(p => p.id === postId) : null);
  
  if (!actualPost) {
    navigation.goBack();
    return null;
  }
  
  const [currentUser, setCurrentUser] = useState(null);
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [videoStatus, setVideoStatus] = useState({});
  const [showUI, setShowUI] = useState(true);
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const [heartAnimationKey, setHeartAnimationKey] = useState(0);
  
  // Animation refs
  const likeAnimation = useRef(new Animated.Value(1)).current;
  const heartAnimation = useRef(new Animated.Value(0)).current;
  const uiOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (auth.currentUser) {
      setCurrentUser(auth.currentUser);
      setIsLiked(actualPost.likedBy?.includes(auth.currentUser.uid) || false);
      // Check if following (you can implement this based on your user follow system)
      setIsFollowing(false); // Replace with actual follow check
    }
    setLikeCount(actualPost.likeCount || actualPost.likes || 0);
  }, [actualPost]);

  // TikTok-style like animation
  const triggerLikeAnimation = () => {
    // Scale animation for button
    Animated.sequence([
      Animated.timing(likeAnimation, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(likeAnimation, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    // Heart animation for screen center
    if (!isLiked) {
      Animated.sequence([
        Animated.timing(heartAnimation, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(heartAnimation, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  const handleLike = async () => {
    if (!currentUser) {
      Alert.alert('Error', 'Please log in to like posts');
      return;
    }

    triggerLikeAnimation();

    if (!firebaseEnabled || !db || typeof db.collection !== 'function') {
      console.log('⚠️ MediaViewer: Firebase disabled or db unavailable, skipping like write');
      return;
    }
    try {
      const postRef = db.collection('posts').doc(actualPost.id);
      const wasLiked = isLiked;
      
      // Optimistic update
      setIsLiked(!wasLiked);
      setLikeCount(prev => wasLiked ? prev - 1 : prev + 1);

      if (wasLiked) {
        await postRef.update({
          likedBy: firestore.FieldValue.arrayRemove(currentUser.uid),
          likeCount: firestore.FieldValue.increment(-1)
        });
      } else {
        await postRef.update({
          likedBy: firestore.FieldValue.arrayUnion(currentUser.uid),
          likeCount: firestore.FieldValue.increment(1)
        });
        
        // Trigger new heart animation for like
        setShowHeartAnimation(true);
        setHeartAnimationKey(prev => prev + 1);
      }

    } catch (error) {
      console.error('Error updating like:', error);
      // Revert optimistic update
      setIsLiked(wasLiked);
      setLikeCount(prev => wasLiked ? prev + 1 : prev - 1);
    }
  };

  const handleFollow = async () => {
    // Implement follow functionality
    setIsFollowing(!isFollowing);
    
    Toast.show({
      type: 'success',
      text1: isFollowing ? '➖ Unfollowed' : '➕ Following!',
      text2: isFollowing ? 'Removed from following' : `Now following @${actualPost.username || actualPost.user?.username}`,
      position: 'bottom',
      visibilityTime: 1500,
    });
  };

  // Toggle UI visibility on tap
  const handleScreenTap = () => {
    const newShowUI = !showUI;
    setShowUI(newShowUI);
    
    Animated.timing(uiOpacity, {
      toValue: newShowUI ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const handleShare = async () => {
    try {
      const shareContent = {
        message: `Check out this post by ${actualPost.username || actualPost.user?.username || 'someone'}: "${actualPost.caption || actualPost.description || 'Amazing content!'}" - Shared via Blyp`,
      };

      // Add media URL if available
      if (actualPost.imageUrl) {
        shareContent.url = actualPost.imageUrl;
      } else if (actualPost.videoUrl) {
        shareContent.url = actualPost.videoUrl;
      } else if (actualPost.media && actualPost.media.length > 0) {
        shareContent.url = actualPost.media[0].url || actualPost.media[0].uri;
      }

      const result = await Share.share(shareContent);
      
      if (result.action === Share.sharedAction) {
        Toast.show({
          type: 'success',
          text1: '📤 Shared!',
          text2: 'Post shared successfully',
          position: 'bottom',
          visibilityTime: 1500,
        });
      }
    } catch (error) {
      console.error('Error sharing:', error);
      Alert.alert('Error', 'Failed to share post');
    }
  };

  const renderMedia = () => {
    console.log('🎬 Rendering media for post:', {
      videoUrl: actualPost.videoUrl,
      imageUrl: actualPost.imageUrl,
      media: actualPost.media,
      thumbnail: post.thumbnail,
      type: post.type
    });

    // Handle video content
    if (post.videoUrl) {
      const fixedUrl = fixStorageUrl(post.videoUrl);
      console.log('📹 Rendering video from videoUrl:', fixedUrl);
      return (
        <UnifiedVideo
          source={{ uri: fixedUrl }}
          style={styles.media}
          useNativeControls={true}
          resizeMode="cover"
          shouldPlay={true}
          isLooping={true}
          isMuted={false}
          volume={1.0}
          onPlaybackStatusUpdate={(status) => {
            setVideoStatus(status);
            if (status.error) {
              console.error('Video playback error:', status.error);
            }
          }}
          onLoadStart={() => console.log('Video loading started')}
          onLoad={(status) => console.log('Video loaded:', status)}
        />
      );
    }

    // Handle media array (photos and videos)
    if (actualPost.media && actualPost.media.length > 0) {
      const photos = actualPost.media.filter(item => 
        item.type === 'photo' || 
        item.type === 'image' ||
        item.type === 'image/jpeg' ||
        item.type === 'image/png' ||
        item.type?.startsWith('image/') ||
        (!item.type?.includes('video') && !item.type?.includes('mp4') && !item.type?.startsWith('video/'))
      );
      
      const videos = actualPost.media.filter(item => 
        item.type === 'video' || 
        item.type === 'video/mp4' ||
        item.type?.includes('video') ||
        item.type?.includes('mp4') ||
        item.type?.startsWith('video/')
      );      console.log('📱 Media breakdown:', { photos: photos.length, videos: videos.length });
      console.log('🔍 All media types:', actualPost.media.map(item => ({ type: item.type, url: item.url?.substring(0, 50) + '...' })));

      // If there are multiple photos, show gallery
      if (photos.length > 1) {
        console.log('�️ Rendering photo gallery with', photos.length, 'photos');
        return <PhotoGallery photos={photos} style={styles.media} />;
      }
      
      // If there's a video, show it
      if (videos.length > 0) {
        const firstVideo = videos[0];
        const fixedUrl = fixStorageUrl(firstVideo.url || firstVideo.uri);
        console.log('📹 Rendering video from media array:', { original: firstVideo, fixedUrl });
        return (
          <UnifiedVideo
            source={{ uri: fixedUrl }}
            style={styles.media}
            useNativeControls={true}
            resizeMode="cover"
            shouldPlay={true}
            isLooping={true}
            isMuted={false}
            volume={1.0}
            onPlaybackStatusUpdate={(status) => {
              setVideoStatus(status);
              if (status.error) {
                console.error('Video playback error:', status.error);
              }
            }}
            onLoadStart={() => console.log('Video loading started')}
            onLoad={(status) => console.log('Video loaded:', status)}
          />
        );
      }
      
      // Single photo
      if (photos.length === 1) {
        console.log('🖼️ Rendering single photo:', photos[0]);
        return (
          <Image
            source={{ uri: photos[0].url || photos[0].uri }}
            style={styles.media}
            resizeMode="cover"
            onLoadStart={() => console.log('Image loading started')}
            onLoad={() => console.log('Image loaded successfully')}
            onError={(error) => console.error('Image load error:', error)}
          />
        );
      }
    }

    // Handle single image URL
    if (actualPost.imageUrl) {
      console.log('🖼️ Rendering image from imageUrl:', actualPost.imageUrl);
      return (
        <Image
          source={{ uri: actualPost.imageUrl }}
          style={styles.media}
          resizeMode="cover"
          onLoadStart={() => console.log('Image loading started')}
          onLoad={() => console.log('Image loaded successfully')}
          onError={(error) => console.error('Image load error:', error)}
        />
      );
    }

    // Handle thumbnail fallback
    if (post.thumbnail) {
      console.log('🖼️ Rendering thumbnail:', post.thumbnail);
      return (
        <Image
          source={{ uri: post.thumbnail }}
          style={styles.media}
          resizeMode="cover"
          onLoadStart={() => console.log('Thumbnail loading started')}
          onLoad={() => console.log('Thumbnail loaded successfully')}
          onError={(error) => console.error('Thumbnail load error:', error)}
        />
      );
    }

    // Fallback for text-only posts
    return (
      <View style={styles.textOnlyMedia}>
        <LinearGradient
          colors={['#667eea', '#764ba2']}
          style={styles.textOnlyGradient}
        >
          <Text style={styles.textOnlyEmoji}>{actualPost.emoji || '📝'}</Text>
          <Text style={styles.textOnlyTitle}>{actualPost.title || 'Text Post'}</Text>
        </LinearGradient>
      </View>
    );
  };

  const formatHashtags = (hashtags) => {
    if (!hashtags || !Array.isArray(hashtags)) return '';
    return hashtags.map(tag => `#${tag.replace('#', '')}`).join(' ');
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" translucent />
      
      {/* Full-Screen Media Background */}
      <TouchableOpacity 
        style={styles.mediaContainer} 
        activeOpacity={1}
        onPress={handleScreenTap}
      >
        {renderMedia()}
        
        {/* Dark gradient overlay for better text readability */}
        <LinearGradient
          colors={['transparent', 'transparent', 'rgba(0,0,0,0.4)']}
          style={styles.gradientOverlay}
        />
      </TouchableOpacity>

      {/* Floating Heart Animation */}
      <Animated.View 
        style={[
          styles.floatingHeart,
          {
            opacity: heartAnimation,
            transform: [
              {
                scale: heartAnimation.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 1.5],
                }),
              },
            ],
          },
        ]}
        pointerEvents="none"
      >
        <Icon  name="heart" size={80} color="#ff1744"  />
      </Animated.View>

      {/* Multiple Hearts Animation */}
      <HeartAnimation 
        key={heartAnimationKey}
        visible={showHeartAnimation}
        onAnimationComplete={() => setShowHeartAnimation(false)}
      />

      {/* Top UI Elements */}
      <Animated.View style={[styles.topUI, { opacity: uiOpacity }]}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Icon  name="arrow-back" size={28} color="#fff"  />
        </TouchableOpacity>
      </Animated.View>

      {/* Right Side Actions (TikTok Style) */}
      <Animated.View style={[styles.rightSidebar, { opacity: uiOpacity }]}>
        {/* User Avatar with Follow Button */}
        <View style={styles.avatarSection}>
          <TouchableOpacity style={styles.avatarContainer}>
            {actualPost.user?.avatar || actualPost.userPhotoURL ? (
              <Image 
                source={{ uri: actualPost.user?.avatar || actualPost.userPhotoURL }} 
                style={styles.avatar}
              />
            ) : (
              <LinearGradient
                colors={['#667eea', '#764ba2']}
                style={styles.defaultAvatar}
              >
                <Icon  name="person" size={24} color="#fff"  />
              </LinearGradient>
            )}
          </TouchableOpacity>
          
          {!isFollowing && (
            <TouchableOpacity 
              style={styles.followButton}
              onPress={handleFollow}
            >
              <LinearGradient
                colors={['#ec4899', '#8b5cf6']}
                style={styles.followGradient}
              >
                <Icon  name="add" size={20} color="#fff"  />
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>

        {/* Like Button */}
        <Animated.View style={{ transform: [{ scale: likeAnimation }] }}>
          <TouchableOpacity 
            style={styles.sidebarButton}
            onPress={handleLike}
          >
            <Icon  
              name={isLiked ? "heart" : "heart-outline"} 
              size={36} 
              color={isLiked ? "#ff1744" : "#fff"} 
             />
            <Text style={styles.sidebarText}>
              {likeCount > 0 ? (likeCount > 999 ? `${(likeCount/1000).toFixed(1)}K` : likeCount) : ''}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Comment Button */}
        <TouchableOpacity style={styles.sidebarButton}>
          <Icon  name="chatbubble-outline" size={32} color="#fff"  />
          <Text style={styles.sidebarText}>
            {actualPost.commentCount || actualPost.comments || ''}
          </Text>
        </TouchableOpacity>

        {/* Share Button */}
        <TouchableOpacity style={styles.sidebarButton} onPress={handleShare}>
          <Icon  name="share-outline" size={32} color="#fff"  />
        </TouchableOpacity>

        {/* More Options */}
        <TouchableOpacity style={styles.sidebarButton}>
          <Icon  name="ellipsis-horizontal" size={32} color="#fff"  />
        </TouchableOpacity>
      </Animated.View>

      {/* Bottom Content (TikTok Style) */}
      <Animated.View style={[styles.bottomContent, { opacity: uiOpacity }]}>
        <View style={styles.userInfo}>
          <Text style={styles.username}>
            @{actualPost.username || actualPost.user?.username || 'user'}
          </Text>
          <Text style={styles.caption} numberOfLines={3}>
            {actualPost.caption || actualPost.description || actualPost.transcript || 'Amazing content! 🔥'}
          </Text>
          
          {(post.hashtags || post.tags) && (
            <Text style={styles.hashtags} numberOfLines={2}>
              {formatHashtags(post.hashtags || post.tags)}
            </Text>
          )}
        </View>

        {/* Music/Sound Info */}
        <View style={styles.musicInfo}>
          <Icon  name="musical-note" size={16} color="#fff" style={styles.musicIcon}  />
          <Text style={styles.musicText} numberOfLines={1}>
            Original Sound - {actualPost.username || actualPost.user?.username || 'user'}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  mediaContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  media: {
    width: screenWidth,
    height: screenHeight,
  },
  textOnlyMedia: {
    width: screenWidth,
    height: screenHeight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textOnlyGradient: {
    width: '90%',
    height: '70%',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textOnlyEmoji: {
    fontSize: 80,
    marginBottom: 20,
  },
  textOnlyTitle: {
    fontSize: 28,
    color: '#fff',
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: screenHeight * 0.6,
  },
  floatingHeart: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -40,
    marginTop: -40,
    zIndex: 1000,
  },
  topUI: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 50, // Account for status bar
    paddingHorizontal: 16,
    paddingBottom: 16,
    zIndex: 100,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    backdropFilter: 'blur(10px)',
  },
  rightSidebar: {
    position: 'absolute',
    right: 12,
    bottom: 120,
    alignItems: 'center',
    zIndex: 100,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarContainer: {
    marginBottom: 8,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#fff',
  },
  defaultAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  followButton: {
    position: 'absolute',
    bottom: -8,
    alignSelf: 'center',
  },
  followGradient: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sidebarButton: {
    alignItems: 'center',
    marginBottom: 24,
    padding: 8,
  },
  sidebarText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  bottomContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 80, // Leave space for right sidebar
    paddingHorizontal: 16,
    paddingBottom: 34, // Account for home indicator on newer iPhones
    paddingTop: 16,
    zIndex: 100,
  },
  userInfo: {
    marginBottom: 12,
  },
  username: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  caption: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 8,
  },
  hashtags: {
    color: '#64b5f6',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  musicInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
    backdropFilter: 'blur(10px)',
  },
  musicIcon: {
    marginRight: 6,
  },
  musicText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    maxWidth: screenWidth * 0.6,
  },
});

export default MediaViewerScreen;