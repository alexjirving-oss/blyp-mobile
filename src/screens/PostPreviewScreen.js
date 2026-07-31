import React, { useState, useRef } from 'react';
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import UnifiedVideo from '../components/UnifiedVideo';
import BlypLogo from '../components/BlypLogo';
import { useNavigation, useRoute } from '@react-navigation/native';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const PostPreviewScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { post } = route.params || {};
  const [liked, setLiked] = useState(false);
  const [videoStatus, setVideoStatus] = useState({});
  const videoRef = useRef(null);

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

  const handleLike = () => {
    setLiked(!liked);
  };

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
            shouldPlay={true}
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
          color={liked ? "#ff1744" : "white"} 
         />
        <Text style={styles.actionText}>{(post.likeCount || 0) + (liked ? 1 : 0)}</Text>
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
                  colors={['#a855f7', '#d946ef', '#ec4899']}
                  style={styles.tag}
                >
                  <Text style={styles.tagText}>#{tag.replace('#', '')}</Text>
                </LinearGradient>
              ))}
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
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
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
    backgroundColor: '#1e293b',
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
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },

  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
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
    color: '#ec4899',
    fontSize: 16,
  },
});

export default PostPreviewScreen;