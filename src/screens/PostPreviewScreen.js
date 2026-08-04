import React, { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Image,
  Dimensions,
  StatusBar,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import UnifiedVideo from '../components/UnifiedVideo';
import BlypLogo from '../components/BlypLogo';
import { useNavigation, useRoute, useIsFocused } from '@react-navigation/native';
import { COLORS } from '../styles/theme';
import { useAuth } from '../hooks/useCommon';
import { db, firebaseEnabled } from '../config/firebase';
import { snapData, snapExists } from '../utils/firestoreSnap';
import { setPostLiked } from '../services/LikeService';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const PostPreviewScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const isFocused = useIsFocused();
  const { post: routePost, postId: routePostId } = route.params || {};
  const [post, setPost] = useState(routePost || null);
  const [loadingPost, setLoadingPost] = useState(Boolean(routePostId && !routePost));
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [videoStatus, setVideoStatus] = useState({});
  const videoRef = useRef(null);
  const likePendingRef = useRef(false);
  const { uid, authReady, isAuthenticated } = useAuth();

  const syncLikeState = useCallback((data, userId) => {
    const count = Number(data?.likeCount ?? data?.likes ?? 0) || 0;
    setLikeCount(count);
    if (userId && Array.isArray(data?.likedBy)) {
      setLiked(data.likedBy.includes(userId));
    }
  }, []);

  useEffect(() => {
    if (routePost) {
      setPost(routePost);
      syncLikeState(routePost, uid);
      setLoadingPost(false);
      return undefined;
    }
    if (!routePostId || !firebaseEnabled || !db || typeof db.collection !== 'function') {
      setLoadingPost(false);
      return undefined;
    }
    setLoadingPost(true);
    const unsub = db.collection('posts').doc(routePostId).onSnapshot(
      (snap) => {
        if (!snapExists(snap)) {
          setPost(null);
          setLoadingPost(false);
          return;
        }
        const data = snapData(snap) || {};
        setPost({ id: routePostId, ...data });
        syncLikeState(data, uid);
        setLoadingPost(false);
      },
      () => setLoadingPost(false)
    );
    return () => {
      try {
        unsub?.();
      } catch { /* ignore */ }
    };
  }, [routePost, routePostId, uid, syncLikeState]);

  const handleLike = async () => {
    if (!authReady || !isAuthenticated || !uid) {
      Alert.alert('Error', 'Please log in to like posts');
      return;
    }
    const postId = post?.id || routePostId;
    if (!postId) return;
    if (likePendingRef.current) return;
    likePendingRef.current = true;

    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikeCount((prev) => (wasLiked ? Math.max(0, prev - 1) : prev + 1));

    try {
      const res = await setPostLiked({ postId, userId: uid });
      if (!res?.ok) {
        throw res?.error || new Error(res?.reason || 'LIKE_FAILED');
      }
      if (typeof res.liked === 'boolean') setLiked(res.liked);
      if (Number.isFinite(res.count)) setLikeCount(res.count);
    } catch (e) {
      setLiked(wasLiked);
      setLikeCount((prev) => (wasLiked ? prev + 1 : Math.max(0, prev - 1)));
      Alert.alert('Error', 'Failed to update like. Please try again.');
      if (__DEV__) console.warn('[PostPreview] like failed', e?.message || e);
    } finally {
      likePendingRef.current = false;
    }
  };

  if (loadingPost) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <ActivityIndicator size="large" color={COLORS.gradientEnd} />
        </View>
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Post not found</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const renderMedia = () => {
    if (!post.media || post.media.length === 0) {
      return (
        <View style={styles.textOnlyContainer}>
          <Text style={styles.textOnlyEmoji}>{post.emoji || '💭'}</Text>
          <Text style={styles.textOnlyTitle}>{post.title}</Text>
        </View>
      );
    }

    const media = post.media[0]; // Show first media item

    if (post.type === 'video' || media.type === 'video' || media.url?.includes('.mp4')) {
      return (
        <View style={styles.videoContainer}>
          <UnifiedVideo
            ref={videoRef}
            source={{ uri: media.url }}
            style={styles.video}
            shouldPlay={isFocused}
            isLooping={true}
            isMuted={false}
            resizeMode="cover"
            onPlaybackStatusUpdate={setVideoStatus}
          />
          
          {/* Video controls overlay */}
          <TouchableOpacity 
            style={styles.playPauseOverlay}
            onPress={() => {
              if (videoStatus.isPlaying) {
                videoRef.current?.pauseAsync();
              } else {
                videoRef.current?.playAsync();
              }
            }}
          >
            {!videoStatus.isPlaying && videoStatus.isLoaded && (
              <View style={styles.playButton}>
                <Icon  name="play" size={32} color="white"  />
              </View>
            )}
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <Image 
        source={{ uri: media.url }} 
        style={styles.image}
        resizeMode="cover"
      />
    );
  };

  const renderActions = () => (
    <View style={styles.actionsContainer}>
      <TouchableOpacity 
        style={styles.actionButton}
        onPress={handleLike}
      >
        <Icon  
          name={liked ? "heart" : "heart-outline"} 
          size={28} 
          color={liked ? COLORS.gradientEnd : "white"} 
         />
        <Text style={styles.actionText}>{likeCount}</Text>
      </TouchableOpacity>
      
      <TouchableOpacity style={styles.actionButton}>
        <Icon  name="chatbubble-outline" size={24} color="white"  />
        <Text style={styles.actionText}>{post.commentCount || 0}</Text>
      </TouchableOpacity>
      
      <TouchableOpacity style={styles.actionButton}>
        <Icon  name="share-outline" size={24} color="white"  />
        <Text style={styles.actionText}>Share</Text>
      </TouchableOpacity>
      
      <TouchableOpacity style={styles.actionButton}>
        <Icon  name="bookmark-outline" size={24} color="white"  />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="black" translucent={false} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon  name="arrow-back" size={24} color="white"  />
        </TouchableOpacity>
        <BlypLogo useGradientBackground={false} textStyle={{ fontSize: 24 }} />
        <TouchableOpacity style={styles.moreButton}>
          <Icon  name="ellipsis-horizontal" size={24} color="white"  />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Media Section */}
        <View style={styles.mediaSection}>
          {renderMedia()}
        </View>

        {/* Post Info */}
        <View style={styles.postInfo}>
          <View style={styles.postHeader}>
            <Text style={styles.postTitle}>{post.title}</Text>
            <Text style={styles.postDate}>
              {post.date ? new Date(post.date.seconds * 1000).toLocaleDateString() : 'Recently'}
            </Text>
          </View>

          {post.transcript && (
            <Text style={styles.postDescription}>{post.transcript}</Text>
          )}

          {post.tags && post.tags.length > 0 && (
            <View style={styles.tagsContainer}>
              {post.tags.map((tag, index) => (
                <LinearGradient
                  key={index}
                  colors={['#00D2BE', '#00D2BE', '#00A89E']}
                  style={styles.tag}
                >
                  <Text style={styles.tagText}>#{tag.replace('#', '')}</Text>
                </LinearGradient>
              ))}
            </View>
          )}

          {post.sharedTo && post.sharedTo.length > 0 && (
            <View style={styles.sharedToContainer}>
              <Text style={styles.sharedToLabel}>Shared to:</Text>
              <View style={styles.sharedPlatforms}>
                {post.sharedTo.map((platform, index) => (
                  <View key={index} style={styles.platformBadge}>
                    <Text style={styles.platformText}>{platform}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Actions */}
          {renderActions()}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.pageBackground,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: '#27272E',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  moreButton: {
    padding: 8,
  },
  content: {
    flex: 1,
  },
  mediaSection: {
    backgroundColor: 'black',
  },
  videoContainer: {
    width: screenWidth,
    height: screenWidth * (16/9), // 16:9 aspect ratio
    position: 'relative',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  playPauseOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: screenWidth,
    height: screenWidth,
  },
  textOnlyContainer: {
    width: screenWidth,
    height: 200,
    backgroundColor: '#141418',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textOnlyEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  textOnlyTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  postInfo: {
    padding: 20,
  },
  postHeader: {
    marginBottom: 16,
  },
  postTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  postDate: {
    color: '#9ca3af',
    fontSize: 14,
  },
  postDescription: {
    color: '#d1d5db',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 20,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tagText: {
    color: '#0A0A0C',
    fontSize: 12,
    fontWeight: '700',
  },
  sharedToContainer: {
    marginBottom: 20,
  },
  sharedToLabel: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 8,
  },
  sharedPlatforms: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  platformBadge: {
    backgroundColor: '#374151',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  platformText: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '500',
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#27272E',
  },
  actionButton: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  actionText: {
    color: 'white',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: 'white',
    fontSize: 18,
    marginBottom: 20,
  },
  backText: {
    color: '#00D2BE',
    fontSize: 16,
  },
});

export default PostPreviewScreen;