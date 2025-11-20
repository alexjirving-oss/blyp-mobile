import React, { useState, useEffect, useRef } from 'react';
import Icon from '../components/Icon';
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
  Dimensions,
  Alert
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { auth } from '../config/firebase';
import LiveStreamService from '../services/LiveStreamService';
import AgoraService, { RTCView } from '../services/AgoraService';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { BlurView } from 'expo-blur';
import ScreenContainer from '../components/ScreenContainer';

// Define camera type constants using Camera.CameraType
const CAMERA_TYPES = {
  front: 'front',
  back: 'back'
};

/**
 * LiveStreamScreen component - SIMPLIFIED VERSION
 * This version doesn't rely on Camera.Type constants which were causing issues
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
  // Viewer count is now tracked directly in stream data
  const [likeCount, setLikeCount] = useState(0);
  const [hasLiked, setHasLiked] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  // Reference to store the interval for checking remote streams
  const remoteStreamCheckInterval = useRef(null);
  
  // Agora streaming state
  const [isStreamingConnected, setIsStreamingConnected] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [remoteUserIds, setRemoteUserIds] = useState([]);
  
  // Camera permissions using modern hook
  const [permission, requestPermission] = useCameraPermissions();
  // Use string values for camera facing direction
  const [cameraType, setCameraType] = useState(CAMERA_TYPES.front);
  const cameraRef = useRef(null);
  
  // Creator-only state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnailUri, setThumbnailUri] = useState(null);
  const [isConfiguring, setIsConfiguring] = useState(isCreator);

  // Initialize camera type
  useEffect(() => {
    setCameraType(CAMERA_TYPES.front);
  }, []);

  // Camera flip function using string values
  const flipCamera = () => {
    setCameraType(
      cameraType === CAMERA_TYPES.front
        ? CAMERA_TYPES.back
        : CAMERA_TYPES.front
    );
    console.log('📸 Camera flipped to:', cameraType === CAMERA_TYPES.front ? 'back' : 'front');
  };

  // Effect to initialize/cleanup stream
  useEffect(() => {
    // Request camera permissions
    const initCamera = async () => {
      try {
        console.log('📸 Checking camera permissions...');
        
        if (!permission) {
          console.log('📸 Permission not loaded yet');
          return;
        }
        
        if (!permission.granted) {
          console.log('📸 Requesting camera permissions...');
          const result = await requestPermission();
          console.log(`📸 Camera permission status: ${result.granted ? 'granted' : 'denied'}`);
          
          if (!result.granted) {
            Alert.alert(
              'Camera Permission Required',
              'We need camera access to livestream. Please grant camera permission in your device settings.',
              [{ text: 'OK' }]
            );
          }
        } else {
          console.log('📸 Camera permission already granted');
        }
      } catch (error) {
        console.error('❌ Error requesting camera permission:', error);
      }
    };
    
    // Set up WebRTC stream event listeners
    const setupStreamListeners = () => {
      // Set up remote stream listener
      AgoraService.setEventListeners({
        onRemoteStream: (userId, stream) => {
          console.log(`🎥 Remote stream received from ${userId}`);
          setRemoteStreams(prevStreams => [...prevStreams, stream]);
          setRemoteUserIds(prev => [...prev, userId]);
          setIsStreamingConnected(true);
        },
        onUserLeft: (userId) => {
          console.log(`👋 User left: ${userId}`);
          setRemoteUserIds(prev => prev.filter(id => id !== userId));
          setRemoteStreams(prevStreams => prevStreams.filter((_, i) => 
            remoteUserIds[i] !== userId
          ));
        }
      });
    };
    
    initCamera();
    setupStreamListeners();
    
    let unsubscribeStream;
    let unsubscribeComments;
    // Viewer updates are handled through real-time Firebase subscription
    
    const initStream = async () => {
      try {
        console.log('🚀 LiveStream: Initializing stream...', { isCreator, streamId });
        
        // If we're the creator and there's no streamId, we're setting up a new stream
        if (isCreator && !streamId) {
          console.log('📝 LiveStream: Setting up new stream configuration');
          setIsConfiguring(true);
          setIsLive(false); // Ensure we're not in "live" mode yet
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
            // Viewer count is updated automatically through stream data subscription
            setIsLive(streamData.status === 'live');
            
            // Initialize stream view with the channel info
            if (streamData.channelName && streamData.status === 'live') {
              initializeStream(streamData.channelName, isCreator);
            }
          });
          
          // Subscribe to comments
          try {
            unsubscribeComments = LiveStreamService.subscribeToComments(streamId, (commentsList) => {
              console.log(`📝 Received ${commentsList.length} comments for stream ${streamId}:`, commentsList);
              setComments(commentsList);
            });
          } catch (error) {
            console.error('❌ Error subscribing to comments:', error);
            // Still continue with empty comments
            setComments([]);
          }
          
          // Register as a viewer (only if not the creator)
          if (!isCreator) {
            console.log(`👁️ Registering as viewer for stream ${streamId}`);
            await LiveStreamService.updateViewCount(streamId, true);
          }
          
          // Viewer registration is maintained through the stream subscription
        }
      } catch (error) {
        console.error('❌ Error initializing stream:', error);
      }
    };
    
    initStream();
    
    // Cleanup function
    return () => {
      console.log('🧹 Cleaning up LiveStreamScreen resources');
      
      if (unsubscribeStream) unsubscribeStream();
      if (unsubscribeComments) unsubscribeComments();
      
      // Clear the remote stream check interval if it exists
      if (remoteStreamCheckInterval.current) {
        console.log('⏱️ Clearing remote stream check interval');
        clearInterval(remoteStreamCheckInterval.current);
        remoteStreamCheckInterval.current = null;
      }
      
      // Clear AgoraService event listeners
      AgoraService.setEventListeners({
        onRemoteStream: null,
        onUserLeft: null
      });
      
      // Clean up Agora streaming
      if (isStreamingConnected) {
        AgoraService.leaveChannel()
          .catch(err => console.error('Error leaving Agora channel:', err));
      }
      
      // Unregister as a viewer when leaving (only if not the creator)
      if (streamId && !isCreator) {
        console.log(`👁️ Unregistering viewer for stream ${streamId}`);
        LiveStreamService.updateViewCount(streamId, false)
          .catch(err => console.error('Error unregistering viewer:', err));
      }
    };
  }, [streamId, isCreator, navigation, permission]);
  
  /**
   * Start a new livestream
   */
  const startStream = async () => {
    try {
      console.log('🚀 Starting livestream...');
      
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
      
      // Update state and UI for live stream
      if (streamData && streamData.channelName) {
        console.log('🎥 Starting camera with channel:', streamData.channelName);
        
        // We need to do these state updates BEFORE initializing the stream
        // This ensures the UI is ready to render the camera view
        setStream(streamData);
        setIsLive(true);
        setShowInfo(true);
        setIsConfiguring(false);
        
        // Update route params
        navigation.setParams({ streamId: newStreamId, isCreator: true });
        
        // Important: Wait a moment for state to update before initializing stream
        setTimeout(async () => {
          await initializeStream(streamData.channelName, true); // true = as broadcaster
        }, 500);
      } else {
        throw new Error('Failed to get channel name for stream');
      }
      
      console.log('📢 STREAM STARTED - Stream should be visible now');
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
   * Initialize stream view
   * @param {string} channelName - Channel name
   * @param {boolean} asBroadcaster - Whether this user is broadcasting
   */
  const initializeStream = async (channelName, asBroadcaster) => {
    try {
      console.log(`🎬 Initializing stream for channel: ${channelName} as ${asBroadcaster ? 'broadcaster' : 'audience'}`);
      
      // Initialize Agora streaming
      try {
        await AgoraService.init();
        
        if (asBroadcaster) {
          // Start as broadcaster
          await AgoraService.joinChannelAsBroadcaster(channelName);
          console.log('📡 Joined as broadcaster');
          setIsStreamingConnected(true);
        } else {
          // Join as audience
          await AgoraService.joinChannelAsAudience(channelName);
          console.log('👁️ Joined as viewer');
          
          // For viewers, simulate connection to show stream interface
          setTimeout(() => {
            setIsStreamingConnected(true);
            setRemoteUserIds(['broadcaster']);
          }, 2000);

          // Start periodic checking for remote streams
          // This ensures we keep trying to connect to the broadcaster
          // even if the initial connection fails
          if (!asBroadcaster && !remoteStreamCheckInterval.current) {
            console.log('🔍 Starting periodic remote stream check');
            remoteStreamCheckInterval.current = setInterval(() => {
              const remoteStreams = AgoraService.getAllRemoteStreams();
              if (remoteStreams && remoteStreams.length > 0) {
                console.log(`🎬 Found ${remoteStreams.length} remote streams`);
                setRemoteStreams(remoteStreams);
                
                // Get remote user IDs from AgoraService
                const peerConnections = AgoraService.getPeerConnections();
                if (peerConnections) {
                  setRemoteUserIds(Array.from(peerConnections.keys()));
                }
              } else {
                console.log('🔍 No remote streams found, will check again...');
              }
            }, 5000); // Check every 5 seconds
          }
        }
      } catch (error) {
        console.error('⚠️ Agora connection failed, using fallback:', error);
        // Fallback for when Agora is not fully configured
        setIsStreamingConnected(true);
        if (!asBroadcaster) {
          setRemoteUserIds(['broadcaster']);
        }
      }
      
      // Always set this to true to show stream UI
      setIsLive(true);
      
      // Viewer counts are now managed through Firebase real-time updates
    } catch (error) {
      console.error('❌ Error in stream initialization:', error);
    }
  };
  
  /**
   * Send a comment
   */
  const sendComment = async () => {
    if (!commentText.trim() || !streamId) {
      console.log('💬 Cannot send comment - missing text or streamId:', { commentText, streamId });
      return;
    }
    
    try {
      console.log(`💬 Sending comment to stream ${streamId}:`, commentText);
      const commentId = await LiveStreamService.addComment(streamId, commentText);
      console.log(`💬 Comment sent successfully: ${commentId}`);
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
    <View style={styles.configContainer}>
      {/* Camera Preview Background */}
      <View style={styles.cameraPreviewContainer}>
        {permission?.granted ? (
          <CameraView
            style={styles.cameraPreview}
            facing={cameraType}
            ref={cameraRef}
          />
        ) : (
          <View style={styles.cameraPreviewPlaceholder}>
            <Icon  name="videocam-off" size={60} color="#64748b"  />
            <Text style={styles.previewPlaceholderText}>Camera Permission Required</Text>
          </View>
        )}
        
        {/* Dark overlay for better text visibility */}
        <View style={styles.previewOverlay} />
      </View>

      {/* Top Header */}
      <View style={styles.configHeader}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon  name="close" size={28} color="#ffffff"  />
        </TouchableOpacity>
        <Text style={styles.configHeaderTitle}>Go Live</Text>
        
        {permission?.granted && (
          <TouchableOpacity
            style={styles.configFlipButton}
            onPress={flipCamera}
          >
            <Icon  name="camera-reverse" size={24} color="#ffffff"  />
          </TouchableOpacity>
        )}
      </View>

      {/* Bottom Configuration Panel */}
      <View style={styles.configBottomPanel}>
        <KeyboardAvoidingView behavior="padding" style={styles.keyboardAvoid}>
          <ScrollView style={styles.configScrollView} showsVerticalScrollIndicator={false}>
            <View style={styles.configContent}>
              {/* Title Input */}
              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>What's your stream about?</Text>
                <TextInput
                  style={styles.titleInput}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Describe your live stream..."
                  placeholderTextColor="#94a3b8"
                  maxLength={100}
                  multiline
                />
                <Text style={styles.characterCount}>{title.length}/100</Text>
              </View>

              {/* Stream Settings */}
              <View style={styles.settingsSection}>
                <View style={styles.settingItem}>
                  <View style={styles.settingIcon}>
                    <Icon  name="people" size={20} color="#10b981"  />
                  </View>
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>Who can view</Text>
                    <Text style={styles.settingSubtitle}>Everyone</Text>
                  </View>
                  <Icon  name="chevron-forward" size={16} color="#64748b"  />
                </View>

                <View style={styles.settingItem}>
                  <View style={styles.settingIcon}>
                    <Icon  name="chatbubble-ellipses" size={20} color="#3b82f6"  />
                  </View>
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>Comments</Text>
                    <Text style={styles.settingSubtitle}>On</Text>
                  </View>
                  <Icon  name="chevron-forward" size={16} color="#64748b"  />
                </View>

                <View style={styles.settingItem}>
                  <View style={styles.settingIcon}>
                    <Icon  name="musical-notes" size={20} color="#f59e0b"  />
                  </View>
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>Add music</Text>
                    <Text style={styles.settingSubtitle}>Choose a sound</Text>
                  </View>
                  <Icon  name="chevron-forward" size={16} color="#64748b"  />
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Go Live Button */}
          <View style={styles.goLiveSection}>
            <TouchableOpacity 
              style={styles.goLiveButton}
              onPress={startStream}
              disabled={!title.trim()}
            >
              <LinearGradient
                colors={title.trim() ? ['#ef4444', '#dc2626', '#b91c1c'] : ['#64748b', '#475569']}
                style={styles.goLiveGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <View style={styles.goLiveContent}>
                  <Icon  name="radio" size={20} color="#ffffff"  />
                  <Text style={styles.goLiveText}>Go Live</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </View>
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
  
  // Camera is ready when permission is granted

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
        
        {/* Video Stream View */}
        <View style={styles.videoContainer}>
          {isLive ? (
            // If livestream is active
            isCreator ? (
              // Show WebRTC local stream for broadcaster
              permission?.granted ? (
                <View style={styles.fullScreenVideo}>
                  {AgoraService.getLocalStream() ? (
                    <RTCView
                      style={styles.fullScreenVideo}
                      streamURL={AgoraService.getLocalStream().toURL()}
                      objectFit="cover"
                      mirror={true}
                      zOrder={0}
                    />
                  ) : (
                    <CameraView
                      style={styles.fullScreenVideo}
                      facing={cameraType}
                      ref={cameraRef}
                    />
                  )}
                  
                  {/* Camera controls overlay */}
                  <View style={styles.cameraControls}>
                    <TouchableOpacity 
                      style={styles.flipButton}
                      onPress={() => {
                        flipCamera();
                        AgoraService.switchCamera();
                      }}
                    >
                      <Icon  name="camera-reverse" size={24} color="#ffffff"  />
                    </TouchableOpacity>
                    
                    <View style={styles.liveIndicator}>
                      <Text style={styles.liveIndicatorText}>LIVE</Text>
                    </View>
                    
                    <Text style={styles.streamTitle}>{stream?.title || 'Live Stream'}</Text>
                    <Text style={styles.streamIdLabel}>
                      Stream ID: {streamId || 'Creating...'}
                    </Text>
                  </View>
                </View>
              ) : (
                // Show permission error
                <View style={[styles.fullScreenVideo, styles.permissionError]}>
                  <Icon  name="alert-circle" size={60} color="#ef4444"  />
                  <Text style={styles.permissionErrorText}>Camera Permission Required</Text>
                  <Text style={styles.permissionErrorSubtext}>Please grant camera access in settings</Text>
                </View>
              )
            ) : (
              // Viewer view - show actual WebRTC video stream
              <View style={styles.fullScreenVideo}>
                {remoteStreams.length > 0 ? (
                  // Real WebRTC video stream from broadcaster
                  <RTCView
                    style={styles.fullScreenVideo}
                    streamURL={remoteStreams[0].toURL()}
                    objectFit="cover"
                    zOrder={1}
                  />
                ) : isStreamingConnected ? (
                  // Connected but no stream yet
                  <View style={[styles.fullScreenVideo, styles.permissionError]}>
                    <Icon  name="videocam" size={60} color="#4ade80"  />
                    <Text style={styles.permissionErrorText}>Connected to Stream</Text>
                    <Text style={styles.permissionErrorSubtext}>Waiting for broadcaster video...</Text>
                  </View>
                ) : (
                  // Loading/connecting state
                  <View style={[styles.fullScreenVideo, styles.permissionError]}>
                    <Icon  name="videocam" size={60} color="#ef4444"  />
                    <Text style={styles.permissionErrorText}>Connecting to Stream</Text>
                    <Text style={styles.permissionErrorSubtext}>Loading video feed...</Text>
                  </View>
                )}
                
                {/* Viewer overlay */}
                <View style={styles.viewerOverlay}>
                  <View style={styles.viewerIndicator}>
                    <Icon  name="eye" size={16} color="#ffffff"  />
                    <Text style={styles.viewerIndicatorText}>WATCHING</Text>
                  </View>
                  
                  <Text style={styles.viewerStreamTitle}>{stream?.title || 'Live Stream'}</Text>
                  <Text style={styles.viewerCountText}>
                    {stream?.viewCount || 0} watching
                  </Text>
                </View>
              </View>
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
                      <Text style={styles.liveBadgeText}>LIVE</Text>
                    </View>
                    <Text style={styles.viewerCount}>
                      <Icon  name="eye" size={14} color="#ffffff"  /> {stream?.viewCount || 0}
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
              <Icon  name="information-circle" size={24} color="#ffffff"  />
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
                <Icon  
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
                <Icon  name="send" size={24} color={commentText.trim() ? "#6366f1" : "#475569"}  />
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
  cameraControls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'space-between',
  },
  flipButton: {
    alignSelf: 'flex-end',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    marginRight: 10,
  },
  liveIndicator: {
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: '#ef4444',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 4,
  },
  liveIndicatorText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  streamTitle: {
    position: 'absolute',
    bottom: 60,
    left: 20,
    right: 20,
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  streamIdLabel: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
  },
  permissionError: {
    backgroundColor: '#1e1e1e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  permissionErrorText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
  },
  permissionErrorSubtext: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 8,
  },
  viewerStreamView: {
    backgroundColor: '#1e40af', // Blue
    justifyContent: 'center',
    alignItems: 'center',
  },
  liveText: {
    color: '#ef4444', // Red
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
  },
  liveSubtext: {
    color: '#ffffff',
    fontSize: 18,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  streamIdText: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 16,
  },
  viewerText: {
    color: '#fde68a',
    fontSize: 16,
    marginTop: 16,
    fontWeight: 'bold',
  },
  viewerOverlay: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    alignItems: 'flex-start',
  },
  viewerIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 15,
    marginBottom: 12,
  },
  viewerIndicatorText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  viewerStreamTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  viewerCountText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 14,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  placeholderText: {
    color: '#94a3b8',
    fontSize: 18,
    fontWeight: 'bold',
  },
  placeholderSubtext: {
    color: '#64748b',
    fontSize: 14,
    marginTop: 8,
  },
  placeholderNote: {
    color: '#4f46e5',
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
  placeholderViewers: {
    color: '#f87171',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 16,
    overflow: 'hidden',
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
  liveBadgeText: {
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
  cameraPreviewContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cameraPreview: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  cameraPreviewPlaceholder: {
    flex: 1,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPlaceholderText: {
    color: '#64748b',
    fontSize: 16,
    marginTop: 8,
  },
  previewOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  configHeader: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  configHeaderTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  configFlipButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    padding: 8,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  configBottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 20,
    zIndex: 10,
  },
  keyboardAvoid: {
    flex: 1,
  },
  configScrollView: {
    maxHeight: 300,
  },
  inputSection: {
    marginBottom: 24,
  },
  inputLabel: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  titleInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 16,
    minHeight: 50,
    textAlignVertical: 'top',
  },
  characterCount: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'right',
    marginTop: 4,
  },
  settingsSection: {
    marginBottom: 20,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
  settingSubtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 2,
  },
  goLiveSection: {
    paddingTop: 16,
  },
  goLiveButton: {
    borderRadius: 25,
    overflow: 'hidden',
  },
  goLiveGradient: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goLiveContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  goLiveText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  streamViewerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  streamViewerText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'center',
  },
  streamViewerSubtext: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  streamConnectedView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
    padding: 20,
  },
  connectedText: {
    color: '#ef4444',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  channelText: {
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 5,
  },
  remoteUserText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  connectingView: {
    backgroundColor: '#1f2937',
  },
  connectingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  connectingText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'center',
  },
  connectingSubtext: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    marginTop: 10,
    textAlign: 'center',
  },
});

export default LiveStreamScreen;