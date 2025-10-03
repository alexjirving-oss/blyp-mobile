import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Image,
  FlatList,
  TextInput,
  Platform,
  StatusBar,
  ScrollView,
  KeyboardAvoidingView,
  Dimensions
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../config/firebase';
import LiveStreamService from '../services/LiveStreamService';
import AgoraService from '../services/AgoraService';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { BlurView } from 'expo-blur';
import { RtcLocalView, RtcRemoteView, VideoRenderMode } from 'react-native-agora';
import ScreenContainer from '../components/ScreenContainer';

/**
 * LiveStreamScreen component
 * Handles both the streaming and viewing experience
 */
const LiveStreamScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { streamId, isCreator = !streamId } = route.params || {}; // Default to creator if no streamId
  const user = auth.currentUser;
  
  // State
  const [stream, setStream] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [viewerCount, setViewerCount] = useState(0);
  const [likeCount, setLikeCount] = useState(0);
  const [hasLiked, setHasLiked] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  
  // Agora state
  const [remoteUsers, setRemoteUsers] = useState({});
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  
  // Creator-only state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnailUri, setThumbnailUri] = useState(null);
  const [isConfiguring, setIsConfiguring] = useState(isCreator);
  
  // Effect to initialize/cleanup stream
  useEffect(() => {
    let unsubscribeStream;
    let unsubscribeComments;
    
    const initStream = async () => {
      try {
        console.log('🚀 LiveStream: Initializing stream...', { isCreator, streamId });
        
        // If we're the creator and there's no streamId, we're setting up a new stream
        if (isCreator && !streamId) {
          console.log('📝 LiveStream: Setting up new stream configuration');
          setIsConfiguring(true);
          
          // Initialize Agora for preview
          console.log('🎥 LiveStream: Initializing Agora for preview...');
          await AgoraService.init();
          await AgoraService.startPreview();
          console.log('✅ LiveStream: Agora preview started successfully');
          
          return;
        }
        
        // If we have a streamId, subscribe to it
        if (streamId) {
          // Subscribe to stream data
          unsubscribeStream = LiveStreamService.subscribeToStream(streamId, (streamData) => {
            if (!streamData) {
              // Stream ended or doesn't exist
              navigation.goBack();
              return;
            }
            
            setStream(streamData);
            setTitle(streamData.title || '');
            setDescription(streamData.description || '');
            setLikeCount(streamData.likeCount || 0);
            setViewerCount(streamData.viewCount || 0);
            setIsLive(streamData.status === 'live');
            
            // Initialize Agora with the channel info
            if (streamData.channelName && streamData.status === 'live') {
              initializeRTC(streamData.channelName, isCreator);
            }
          });
          
          // Subscribe to comments
          unsubscribeComments = LiveStreamService.subscribeToComments(streamId, (commentsList) => {
            setComments(commentsList);
          });
          
          // Register as a viewer
          await LiveStreamService.updateViewCount(streamId, true);
        }
      } catch (error) {
        console.error('❌ Error initializing stream:', error);
      }
    };
    
    initStream();
    
    // Cleanup function
    return () => {
      if (unsubscribeStream) unsubscribeStream();
      if (unsubscribeComments) unsubscribeComments();
      
      // Unregister as a viewer when leaving
      if (streamId) {
        LiveStreamService.updateViewCount(streamId, false);
      }
      
      // Clean up Agora RTC engine
      AgoraService.destroy();
    };
  }, [streamId, isCreator]);
  
  /**
   * Start a new livestream
   */
  const startStream = async () => {
    try {
      console.log('🚀 Starting livestream...');
      setIsConfiguring(false);
      
      // Create stream in Firebase
      const newStreamId = await LiveStreamService.createStream({
        title,
        description,
        thumbnailFile: thumbnailUri, // This would need conversion to blob/file
        settings: {
          privacy: 'public',
          allowComments: true,
        }
      });
      
      // Get the stream data to get the channel name
      const streamData = await new Promise((resolve) => {
        const unsubscribe = LiveStreamService.subscribeToStream(newStreamId, (data) => {
          unsubscribe();
          resolve(data);
        });
      });
      
      // Initialize Agora with the channel name
      if (streamData && streamData.channelName) {
        await initializeRTC(streamData.channelName, true); // true = as broadcaster
      } else {
        throw new Error('Failed to get channel name for stream');
      }
      
      // Update route params
      navigation.setParams({ streamId: newStreamId, isCreator: true });
    } catch (error) {
      console.error('❌ Error starting stream:', error);
    }
  };
  
  /**
   * End the current livestream
   */
  const endStream = async () => {
    try {
      if (!streamId) return;
      
      await LiveStreamService.endStream(streamId);
      navigation.goBack();
    } catch (error) {
      console.error('❌ Error ending stream:', error);
    }
  };
  
  /**
   * Initialize Agora RTC Engine
   * @param {string} channelName - Channel name for Agora
   * @param {boolean} asBroadcaster - Whether to join as broadcaster or audience
   */
  const initializeRTC = async (channelName, asBroadcaster) => {
    try {
      console.log(`🎬 Initializing RTC for channel: ${channelName} as ${asBroadcaster ? 'broadcaster' : 'audience'}`);
      
      // Initialize Agora engine
      await AgoraService.init();
      
      // Set up event listeners
      AgoraService.addListener('JoinChannelSuccess', (channel, uid, elapsed) => {
        console.log(`✅ Successfully joined channel: ${channel} as UID: ${uid}`);
        setIsLive(true);
      });
      
      AgoraService.addListener('UserJoined', (uid, elapsed) => {
        console.log(`👤 Remote user joined: ${uid}`);
        setRemoteUsers(prev => ({
          ...prev,
          [uid]: true
        }));
      });
      
      AgoraService.addListener('UserOffline', (uid, reason) => {
        console.log(`👋 Remote user left: ${uid}`);
        setRemoteUsers(prev => {
          const users = {...prev};
          delete users[uid];
          return users;
        });
      });
      
      AgoraService.addListener('Error', (err) => {
        console.error(`❌ Agora error: ${err}`);
      });
      
      AgoraService.addListener('ConnectionStateChanged', (state, reason) => {
        console.log(`🔌 Connection state changed to: ${state}, reason: ${reason}`);
      });
      
      // Join the channel as broadcaster or audience
      if (asBroadcaster) {
        await AgoraService.joinChannelAsBroadcaster(channelName);
      } else {
        await AgoraService.joinChannelAsAudience(channelName);
      }
      
      console.log('✅ Successfully initialized RTC engine');
    } catch (error) {
      console.error('❌ Error initializing RTC engine:', error);
    }
  };
  
  /**
   * Send a comment
   */
  const sendComment = async () => {
    if (!commentText.trim() || !streamId) return;
    
    try {
      await LiveStreamService.addComment(streamId, commentText);
      setCommentText('');
    } catch (error) {
      console.error('❌ Error sending comment:', error);
    }
  };
  
  /**
   * Toggle like status
   */
  const toggleLike = async () => {
    if (!streamId) return;
    
    try {
      await LiveStreamService.updateLikeCount(streamId, !hasLiked);
      setHasLiked(!hasLiked);
      setLikeCount(prev => hasLiked ? prev - 1 : prev + 1);
    } catch (error) {
      console.error('❌ Error toggling like:', error);
    }
  };
  
  /**
   * Select thumbnail image
   */
  const selectThumbnail = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });
      
      if (!result.canceled && result.assets && result.assets[0]) {
        setThumbnailUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error('❌ Error selecting thumbnail:', error);
    }
  };
  
  /**
   * Render stream configuration screen
   */
  const renderStreamConfig = () => (
    <ScrollView style={styles.configContainer}>
      <View style={styles.configContent}>
        <Text style={styles.configTitle}>New Livestream</Text>
        
        <TouchableOpacity style={styles.thumbnailSelector} onPress={selectThumbnail}>
          {thumbnailUri ? (
            <Image source={{ uri: thumbnailUri }} style={styles.thumbnail} />
          ) : (
            <View style={styles.thumbnailPlaceholder}>
              <Ionicons name="image-outline" size={48} color="#94a3b8" />
              <Text style={styles.thumbnailText}>Tap to select thumbnail</Text>
            </View>
          )}
        </TouchableOpacity>
        
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Stream title"
            placeholderTextColor="#64748b"
            maxLength={100}
          />
        </View>
        
        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="What's this stream about?"
            placeholderTextColor="#64748b"
            multiline
            maxLength={500}
          />
        </View>
        
        <TouchableOpacity 
          style={styles.startButton}
          onPress={startStream}
        >
          <LinearGradient
            colors={['#a855f7', '#d946ef', '#ec4899']}
            style={styles.buttonGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={styles.buttonText}>Go Live</Text>
          </LinearGradient>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.cancelButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
  
  /**
   * Render comment item
   */
  const renderCommentItem = ({ item }) => (
    <View style={styles.commentItem}>
      <Image 
        source={{ uri: item.photoURL || `https://placehold.co/40x40/475569/e2e8f0?text=${item.displayName?.charAt(0).toUpperCase() || 'A'}` }} 
        style={styles.commentAvatar} 
      />
      <View style={styles.commentContent}>
        <Text style={styles.commentUsername}>{item.displayName || 'Anonymous'}</Text>
        <Text style={styles.commentText}>{item.content}</Text>
      </View>
    </View>
  );
  
  // If configuring a new stream, show config screen
  if (isConfiguring) {
    return (
      <ScreenContainer>
        <SafeAreaView style={styles.container}>
          <StatusBar barStyle="light-content" />
          {renderStreamConfig()}
        </SafeAreaView>
      </ScreenContainer>
    );
  }
  
  return (
    <ScreenContainer>
      <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Video Stream View with Agora */}
      <View style={styles.videoContainer}>
        {isLive ? (
          // If livestream is active
          isCreator ? (
            // Local view for streamer
            <RtcLocalView.SurfaceView 
              style={styles.fullScreenVideo}
              channelId={stream?.channelName || ''}
              renderMode={VideoRenderMode.FILL}
            />
          ) : (
            // Remote view for viewers
            Object.keys(remoteUsers).length > 0 ? (
              <RtcRemoteView.SurfaceView
                style={styles.fullScreenVideo}
                uid={parseInt(Object.keys(remoteUsers)[0])}
                channelId={stream?.channelName || ''}
                renderMode={VideoRenderMode.FILL}
                zOrderMediaOverlay={true}
              />
            ) : (
              // Waiting for streamer
              <View style={styles.videoPlaceholder}>
                <Text style={styles.placeholderText}>
                  Waiting for stream...
                </Text>
              </View>
            )
          )
        ) : (
          // If stream isn't live yet or has ended
          <View style={styles.videoPlaceholder}>
            <Text style={styles.placeholderText}>
              {stream?.status === 'ended' ? 'Stream Ended' : 'Preparing Stream...'}
            </Text>
          </View>
        )}
        
        {/* Stream Info Overlay (toggles with tap) */}
        {showInfo && (
          <TouchableOpacity 
            style={styles.infoOverlay} 
            activeOpacity={1}
            onPress={() => setShowInfo(false)}
          >
            <BlurView intensity={15} style={styles.blurView}>
              <View style={styles.streamHeader}>
                <View style={styles.streamInfo}>
                  <View style={styles.liveBadge}>
                    <Text style={styles.liveText}>LIVE</Text>
                  </View>
                  <Text style={styles.viewerCount}>
                    <Ionicons name="eye" size={14} color="#ffffff" /> {viewerCount}
                  </Text>
                </View>
                
                {isCreator && (
                  <TouchableOpacity style={styles.endButton} onPress={endStream}>
                    <Text style={styles.endButtonText}>End Stream</Text>
                  </TouchableOpacity>
                )}
              </View>
              
              <View style={styles.streamDetails}>
                <Text style={styles.streamTitle}>{title || 'Untitled Stream'}</Text>
                <Text style={styles.streamDescription}>{description || ''}</Text>
              </View>
              
              <View style={styles.creatorInfo}>
                <Image 
                  source={{ uri: stream?.creatorPhotoURL || user?.photoURL || `https://placehold.co/40x40/475569/e2e8f0?text=${user?.displayName?.charAt(0).toUpperCase() || 'A'}` }} 
                  style={styles.creatorAvatar} 
                />
                <Text style={styles.creatorName}>
                  {stream?.creatorName || user?.displayName || 'Anonymous'}
                </Text>
              </View>
            </BlurView>
          </TouchableOpacity>
        )}
        
        {/* Show/Hide Info Button */}
        {!showInfo && (
          <TouchableOpacity 
            style={styles.showInfoButton}
            onPress={() => setShowInfo(true)}
          >
            <Ionicons name="information-circle" size={24} color="#ffffff" />
          </TouchableOpacity>
        )}
      </View>
      
      {/* Comments Section */}
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.commentsContainer}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <FlatList
          data={comments}
          renderItem={renderCommentItem}
          keyExtractor={(item) => item.id}
          style={styles.commentsList}
          inverted
        />
        
        <View style={styles.commentInputContainer}>
          <TextInput
            style={styles.commentInput}
            value={commentText}
            onChangeText={setCommentText}
            placeholder="Add a comment..."
            placeholderTextColor="#64748b"
          />
          
          <View style={styles.commentActions}>
            <TouchableOpacity style={styles.likeButton} onPress={toggleLike}>
              <Ionicons 
                name={hasLiked ? "heart" : "heart-outline"} 
                size={24} 
                color={hasLiked ? "#ec4899" : "#ffffff"} 
              />
              {likeCount > 0 && (
                <Text style={styles.likeCount}>{likeCount}</Text>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.sendButton} 
              onPress={sendComment}
              disabled={!commentText.trim()}
            >
              <Ionicons name="send" size={24} color={commentText.trim() ? "#6366f1" : "#475569"} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  videoContainer: {
    flex: 1,
    position: 'relative',
  },
  videoPlaceholder: {
    flex: 1,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#94a3b8',
    fontSize: 18,
    fontWeight: 'bold',
  },
  infoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: 16,
  },
  blurView: {
    padding: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  streamHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  streamInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveBadge: {
    backgroundColor: '#ef4444',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  liveText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  viewerCount: {
    color: '#ffffff',
    fontSize: 14,
  },
  endButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  endButtonText: {
    color: '#ef4444',
    fontWeight: 'bold',
    fontSize: 14,
  },
  streamDetails: {
    marginBottom: 16,
  },
  streamTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  streamDescription: {
    color: '#cbd5e1',
    fontSize: 14,
  },
  creatorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  creatorAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
  },
  creatorName: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  showInfoButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  commentsContainer: {
    height: '40%', // Take up 40% of screen height
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  commentsList: {
    flex: 1,
  },
  commentItem: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
  },
  commentContent: {
    flex: 1,
  },
  commentUsername: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 2,
  },
  commentText: {
    color: '#e2e8f0',
    fontSize: 14,
  },
  commentInputContainer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  commentInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    color: '#ffffff',
    fontSize: 14,
    marginRight: 8,
  },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  likeCount: {
    color: '#ffffff',
    marginLeft: 4,
    fontSize: 14,
  },
  sendButton: {
    backgroundColor: '#1e293b',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenVideo: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  // Stream configuration styles
  configContainer: {
    flex: 1,
  },
  configContent: {
    padding: 16,
  },
  configTitle: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
  },
  thumbnailSelector: {
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 24,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailText: {
    color: '#94a3b8',
    marginTop: 8,
    fontSize: 14,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 14,
  },
  textArea: {
    height: 120,
    textAlignVertical: 'top',
  },
  startButton: {
    marginTop: 24,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
  },
  buttonGradient: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelButton: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#94a3b8',
    fontSize: 16,
  },
});

export default LiveStreamScreen;