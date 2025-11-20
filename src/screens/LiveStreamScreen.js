import React, { useState, useEffect, useRef } from 'react';
import Icon from '../components/Icon';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  FlatList,
  Dimensions,
  Animated,
  Easing,
  AppState,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import { auth } from '../config/firebase';
import { useRenderTimer, useTrackAsync } from '../performance/hooks';
import { StatusBar } from 'expo-status-bar';
import { createStream, endStream } from '../services/LiveService';
import LiveStreamViewer from '../components/LiveStreamViewer';
import HLSLiveStreamService from '../services/HLSLiveStreamService';

const { width, height } = Dimensions.get('window');

// Debug: Log to verify correct imports
console.log('📸 LiveStreamScreen: CameraView imported?', typeof CameraView);

export default function LiveStreamScreen({ navigation, route }) {
  useRenderTimer('LiveStreamScreen');
  const trackAsync = useTrackAsync();
  // Extract route params
  const { mode, hostUid, streamId: routeStreamId, displayName } = route.params || {};
  // Use RNFirebase auth from config
  
  // Determine if this user is the host/broadcaster
  const isHost = mode === 'host' || (!mode && (auth.currentUser?.uid === hostUid));
  const isViewer = mode === 'viewer';
  
  console.log('📺 LiveStreamScreen mode:', { mode, isHost, isViewer, hostUid, routeStreamId });
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [streamStartTime, setStreamStartTime] = useState(null);
  const [viewCount, setViewCount] = useState(0);
  const [heartCount, setHeartCount] = useState(0);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [title, setTitle] = useState('');
  const [streamId, setStreamId] = useState(null);
  const [showCountdown, setShowCountdown] = useState(false);
  const [countdownValue, setCountdownValue] = useState(3);
  const [cameraReady, setCameraReady] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0); // Timer in milliseconds
  const [segmentNumber, setSegmentNumber] = useState(0); // Track segment count
  const [isRecording, setIsRecording] = useState(false); // Track if camera is recording
  
  const cameraRef = useRef(null);
  const recordingIntervalRef = useRef(null); // For segment loop
  // CameraView uses 'facing' prop with 'front' or 'back' strings
  const [facing, setFacing] = useState('front');
  const animatedValue = useRef(new Animated.Value(0)).current;
  
  // Using RNFirebase services via imported modules/services

  // Handle app state changes (background/foreground)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        // App came to foreground, reinitialize camera
        setCameraReady(false);
        // Short delay to allow UI to update
        setTimeout(() => setCameraReady(true), 500);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    
    // Request permissions using hooks
    if (!cameraPermission) {
      requestCameraPermission();
    }
    if (!microphonePermission) {
      requestMicrophonePermission();
    }
    
    // Set camera as ready after permissions
    if (mounted && cameraPermission?.granted) {
      setCameraReady(true);
      console.log('📸 Camera permissions granted');
    }

    // Focus effect to ensure camera is initialized when navigating to this screen
    const unsubscribeFocus = navigation.addListener('focus', () => {
      setCameraReady(true);
    });

    return () => {
      mounted = false;
      unsubscribeFocus();
      
      // Cleanup when component unmounts
      if (isStreaming) {
        stopStreaming();
      }
    };
  }, [navigation, cameraPermission, microphonePermission]);

  // Timer effect: Update elapsed time every second when streaming
  useEffect(() => {
    if (!isStreaming || !streamStartTime) {
      setElapsedTime(0);
      return;
    }

    console.log('⏱️ Starting timer interval');
    const timerInterval = setInterval(() => {
      const elapsed = Date.now() - streamStartTime;
      setElapsedTime(elapsed);
    }, 1000);

    return () => {
      console.log('⏱️ Clearing timer interval');
      clearInterval(timerInterval);
    };
  }, [isStreaming, streamStartTime]);

  // Viewer mode: Subscribe to stream stats (view count, hearts)
  useEffect(() => {
    if (!isViewer || !routeStreamId) return;

    console.log('📊 Viewer subscribing to stream stats:', routeStreamId);
    const unsubscribe = HLSLiveStreamService.subscribeToStream(routeStreamId, (data) => {
      if (data) {
        setViewCount(data.viewCount || 0);
        setHeartCount(data.likes || 0);
      } else {
        console.log('⚠️ Stream not found or ended:', routeStreamId);
      }
    });

    return () => {
      console.log('📊 Unsubscribing from stream stats');
      unsubscribe();
    };
  }, [isViewer, routeStreamId]);

  // Removed legacy startRecordingSegment that used Web SDK; using HLSLiveStreamService instead

  const startStreaming = async () => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for your live stream.');
      return;
    }

    // Check if camera is ready and ref is available
    if (!cameraRef.current) {
      console.log('⏳ Camera not ready yet, waiting...');
      
      // Make sure camera is enabled
      setCameraReady(true);
      
      // Wait for camera to initialize
      setTimeout(() => {
        if (cameraRef.current) {
          console.log('✅ Camera is now ready after waiting');
          startCountdown();
        } else {
          Alert.alert('Camera Error', 'Camera is not available. Please try restarting the app.');
        }
      }, 1000);
      return;
    }
    
    console.log('✅ Camera is ready, starting countdown');
    startCountdown();
  };
  
  // Extracted countdown logic to separate function for clarity
  const startCountdown = () => {
    // Start countdown animation
    setShowCountdown(true);
    setCountdownValue(3);
    
    let count = 3;
    const countdownInterval = setInterval(() => {
      count--;
      setCountdownValue(count);
      
      if (count === 0) {
        clearInterval(countdownInterval);
        setTimeout(() => {
          setShowCountdown(false);
          actuallyStartStream();
        }, 1000);
      }
    }, 1000);
  };

  const actuallyStartStream = async () => {
    // Double-check camera ref is still available
    if (!cameraRef.current) {
      Alert.alert('Camera Error', 'Camera reference was lost. Please try again.');
      return;
    }

    try {
      console.log('🚀 Starting HLS live stream with camera:', cameraRef.current);
      
      // 🔥 Use HLSLiveStreamService to create stream in liveStreams collection
      const { streamId: newStreamId, streamData } = await HLSLiveStreamService.createStream({
        title: title,
        description: '',
        thumbnailFile: null
      });
      
      setStreamId(newStreamId);
      console.log('✅ HLS Stream created:', newStreamId);
      
      // Also update user status using LiveService for live list
      const { ensureUserProfile } = require('../services/LiveService');
      await ensureUserProfile();
      await createStream({
        streamId: newStreamId,
        title: title,
        thumbnailUrl: null
      });
      console.log('✅ User marked as live in users collection');
      
      setIsStreaming(true);
      setStreamStartTime(Date.now());
      setSegmentNumber(0);
      
      // Start continuous segment recording (2.5 second intervals)
      startSegmentRecordingLoop(newStreamId);
      
      console.log('🎉 Live streaming started successfully');
      
    } catch (error) {
      console.error('❌ Stream start error:', error);
      Alert.alert('Streaming Error', 'Could not start live stream. Please try again.');
      setIsStreaming(false);
    }
  };

  // Continuous segment recording loop
  const startSegmentRecordingLoop = async (streamIdParam) => {
    const currentStreamId = streamIdParam || streamId;
    if (!currentStreamId) {
      console.error('❌ No stream ID for recording');
      return;
    }

    console.log('🎬 Starting segment recording loop');
    
    const recordNextSegment = async () => {
      if (!cameraRef.current || !isStreaming) {
        console.log('⏹️ Stopping segment loop: camera or stream unavailable');
        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current);
          recordingIntervalRef.current = null;
        }
        return;
      }

      try {
        setIsRecording(true);
        console.log(`📹 Recording segment ${segmentNumber}...`);
        
        // Record 2.5 second segment
        const video = await cameraRef.current.recordAsync({
          maxDuration: 2.5,
          quality: '720p',
        });
        
        setIsRecording(false);
        console.log(`✅ Segment ${segmentNumber} recorded:`, video.uri);
        
        // Upload segment to Firebase Storage
        await HLSLiveStreamService.uploadSegment(currentStreamId, video.uri, segmentNumber);
        console.log(`✅ Segment ${segmentNumber} uploaded`);
        
        setSegmentNumber(prev => prev + 1);
        
      } catch (error) {
        setIsRecording(false);
        console.error(`❌ Error recording segment ${segmentNumber}:`, error);
      }
    };

    // Record first segment immediately
    await recordNextSegment();
    
    // Then continue every 2.5 seconds
    recordingIntervalRef.current = setInterval(recordNextSegment, 2500);
  };

  const stopStreaming = async () => {
    try {
      // Stop segment recording loop
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
        console.log('⏹️ Stopped segment recording loop');
      }
      
      // Stop camera recording if active
      if (cameraRef.current && isRecording) {
        await cameraRef.current.stopRecording();
      }
      
      // 🔥 End stream in HLSLiveStreamService
      if (streamId) {
        await HLSLiveStreamService.endStream(streamId);
        console.log('✅ HLS Stream ended:', streamId);
        
        // Also end in LiveService to update user status
        await endStream(streamId);
        console.log('✅ User status set to "offline"');
      }
      
      setIsStreaming(false);
      setStreamStartTime(null);
      setStreamId(null);
      setSegmentNumber(0);
      setIsRecording(false);
      setComments([]);
      setViewCount(0);
      setHeartCount(0);
      setTitle('');
      
      navigation.goBack();
    } catch (error) {
      console.error('❌ Error stopping stream:', error);
      // Still cleanup local state even if Firebase fails
      setIsStreaming(false);
      setStreamStartTime(null);
      setStreamId(null);
      setSegmentNumber(0);
      setIsRecording(false);
      navigation.goBack();
    }
  };

  const sendHeart = async () => {
    // Animate heart icon
    Animated.sequence([
      Animated.timing(animatedValue, {
        toValue: 1,
        duration: 300,
        easing: Easing.elastic(1),
        useNativeDriver: true,
      }),
      Animated.timing(animatedValue, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
    
    setHeartCount(heartCount + 1);
    
    // Update like count in Firestore asynchronously (non-blocking)
    try {
      if (isViewer && routeStreamId) {
        HLSLiveStreamService.addLike(routeStreamId);
      }
    } catch (_e) {
      // ignore like failures for UX smoothness
    }
  };

  const sendComment = async () => {
    if (!newComment.trim() || !streamId) return;
    try {
      await HLSLiveStreamService.addComment(streamId, newComment);
      setNewComment('');
    } catch (error) {
      console.error('Error sending comment:', error);
    }
  };

  // Subscribe to comments while hosting
  useEffect(() => {
    if (!isStreaming || !streamId) return;
    const unsubscribe = HLSLiveStreamService.subscribeToComments(streamId, (items) => {
      // Normalize to expected shape for UI
      const normalized = items.map((c) => ({
        id: c.id,
        username: c.userName || c.username || 'User',
        text: c.content || c.text || '',
      }));
      setComments(normalized);
    });
    return () => unsubscribe && unsubscribe();
  }, [isStreaming, streamId]);

  const flipCamera = () => {
    setFacing(current => (current === 'front' ? 'back' : 'front'));
  };

  const formatDuration = (milliseconds) => {
    if (!milliseconds) return '00:00';
    const seconds = Math.floor((milliseconds / 1000) % 60);
    const minutes = Math.floor((milliseconds / 1000 / 60) % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const scale = animatedValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.2, 1],
  });

  // Handle camera ready state
  const handleCameraReady = () => {
    console.log('📸 Camera is now READY');
    setCameraReady(true);
  };

  if (cameraPermission === null || microphonePermission === null) {
    return <View style={styles.container} />;
  }

  // Viewer mode: Show actual live stream playback
  if (isViewer) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        
        {/* Back button overlay */}
        <TouchableOpacity 
          style={styles.viewerBackButton}
          onPress={() => navigation.goBack()}
        >
          <Icon  name="arrow-back" size={28} color="white"  />
        </TouchableOpacity>
        
        {/* Broadcaster name overlay */}
        <View style={styles.viewerHeader}>
          <Text style={styles.viewerBroadcasterName}>
            {displayName || 'Unknown'}
          </Text>
          <View style={styles.liveBadge}>
            <View style={styles.liveIndicator} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        </View>
        
        {/* Actual video playback */}
        <LiveStreamViewer 
          streamId={routeStreamId}
          style={styles.viewerVideo}
          onError={(error) => {
            console.error('❌ Viewer playback error:', error);
            Alert.alert(
              'Playback Error',
              'Unable to load stream. The broadcaster may have ended the stream.',
              [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
          }}
        />
        
        {/* View count and likes overlay */}
        <View style={styles.viewerStats}>
          <View style={styles.statItem}>
            <Icon  name="eye" size={20} color="white"  />
            <Text style={styles.statText}>{viewCount}</Text>
          </View>
          <View style={styles.statItem}>
            <Icon  name="heart" size={20} color="#ff2d55"  />
            <Text style={styles.statText}>{heartCount}</Text>
          </View>
        </View>
      </View>
    );
  }

  // Host mode: Show broadcaster UI with camera permissions check
  if (cameraPermission.status !== 'granted' || microphonePermission.status !== 'granted') {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>
          Camera and microphone access is required for live streaming.
        </Text>
        <TouchableOpacity 
          style={styles.permissionButton}
          onPress={() => {
            requestCameraPermission();
            requestMicrophonePermission();
          }}
        >
          <Text style={styles.permissionButtonText}>Grant Permissions</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Host mode: Main broadcaster UI
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />
      <View style={styles.cameraContainer}>
        {cameraReady && (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            onCameraReady={handleCameraReady}
          />
        )}
        
        {showCountdown && (
          <View style={styles.countdownContainer}>
            <Text style={styles.countdownText}>{countdownValue}</Text>
          </View>
        )}
        
        {!isStreaming ? (
          <View style={styles.setupContainer}>
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Enter a title for your stream..."
              placeholderTextColor="#999"
            />
            <TouchableOpacity
              style={[
                styles.goLiveButton,
                !title.trim() && styles.disabledButton,
              ]}
              onPress={startStreaming}
              disabled={!title.trim()}
            >
              <Text style={styles.goLiveButtonText}>Go Live</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.liveIndicatorContainer}>
              <Text style={styles.liveText}>LIVE</Text>
              <Text style={styles.viewCount}>{viewCount} watching</Text>
              <Text style={styles.duration}>
                {formatDuration(elapsedTime)}
              </Text>
              {isRecording && (
                <View style={styles.recordingIndicator}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingText}>REC</Text>
                </View>
              )}
              <Text style={styles.segmentCount}>Seg: {segmentNumber}</Text>
            </View>
            
            <TouchableOpacity style={styles.closeButton} onPress={stopStreaming}>
              <Icon  name="close" size={30} color="white"  />
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.flipButton} onPress={flipCamera}>
              <Icon  name="camera-reverse" size={30} color="white"  />
            </TouchableOpacity>
            
            <View style={styles.commentsContainer}>
              <FlatList
                data={comments}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View style={styles.commentItem}>
                    <Text style={styles.commentUsername}>{item.username}</Text>
                    <Text style={styles.commentText}>{item.text}</Text>
                  </View>
                )}
                inverted
                contentContainerStyle={{ flexDirection: 'column-reverse' }}
              />
              
              <View style={styles.commentInputContainer}>
                <TextInput
                  style={styles.commentInput}
                  value={newComment}
                  onChangeText={setNewComment}
                  placeholder="Add a comment..."
                  placeholderTextColor="#999"
                />
                <TouchableOpacity style={styles.sendButton} onPress={sendComment}>
                  <Icon  name="send" size={24} color="white"  />
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.heartButton} onPress={sendHeart}>
                  <Animated.View style={{ transform: [{ scale }] }}>
                    <Icon  name="heart" size={24} color="#FF007A"  />
                  </Animated.View>
                  <Text style={styles.heartCount}>{heartCount}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionText: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
    marginHorizontal: 20,
  },
  permissionButton: {
    backgroundColor: '#FF007A',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    marginTop: 20,
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  setupContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  titleInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    color: 'white',
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
  },
  goLiveButton: {
    backgroundColor: '#FF007A',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 30,
    alignSelf: 'center',
    marginTop: 20,
  },
  disabledButton: {
    backgroundColor: '#555',
    opacity: 0.6,
  },
  goLiveButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  liveIndicatorContainer: {
    position: 'absolute',
    top: 40,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveText: {
    backgroundColor: '#FF0000',
    color: 'white',
    fontWeight: 'bold',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 5,
    overflow: 'hidden',
    fontSize: 14,
  },
  viewCount: {
    color: 'white',
    marginLeft: 10,
    fontSize: 14,
  },
  duration: {
    color: 'white',
    marginLeft: 10,
    fontSize: 14,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
    backgroundColor: 'rgba(255, 0, 0, 0.3)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff0000',
    marginRight: 4,
  },
  recordingText: {
    color: '#ff0000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  segmentCount: {
    color: 'white',
    marginLeft: 10,
    fontSize: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  closeButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipButton: {
    position: 'absolute',
    top: 40,
    right: 80,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: height * 0.4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  commentItem: {
    padding: 10,
    borderRadius: 10,
    marginHorizontal: 10,
    marginVertical: 5,
  },
  commentUsername: {
    color: '#FF007A',
    fontWeight: 'bold',
    fontSize: 14,
  },
  commentText: {
    color: 'white',
    fontSize: 14,
  },
  commentInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
    paddingBottom: Platform.OS === 'ios' ? 30 : 10,
  },
  commentInput: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 15,
    color: 'white',
    fontSize: 14,
    marginRight: 10,
  },
  sendButton: {
    backgroundColor: '#FF007A',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  heartButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartCount: {
    color: 'white',
    fontSize: 12,
    marginTop: 2,
  },
  countdownContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  countdownText: {
    color: 'white',
    fontSize: 80,
    fontWeight: 'bold',
  },
  // Viewer mode styles
  viewerBackButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerHeader: {
    position: 'absolute',
    top: 50,
    left: 80,
    right: 20,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  viewerBroadcasterName: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ff2d55',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  liveIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
    marginRight: 6,
  },
  liveText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  viewerVideo: {
    width: '100%',
    height: '100%',
  },
  viewerStats: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    zIndex: 10,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 10,
  },
  statText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 6,
  },
});