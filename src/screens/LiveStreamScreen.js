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
import * as FileSystem from 'expo-file-system/legacy';
import { auth, firebaseNative } from '../config/firebase';
import { useRenderTimer, useTrackAsync } from '../performance/hooks';
import { useAuth, getCognitoIdToken } from '../hooks/useCommon';
import { StatusBar } from 'expo-status-bar';
import { isLiveStreamingEnabled } from '../config/StreamingFeatureFlag';
import LiveStreamViewer from '../components/LiveStreamViewer';
import { getStreamingBackend } from '../streaming/StreamingBackendFactory';
import { logStreamingEvent } from '../streaming/StreamingLog';
import HLSLiveStreamServiceInstance from '../services/HLSLiveStreamService';
// IVS Architecture imports (feature-flagged, default OFF)
import { streamingConfig } from '../config/StreamingFeatureConfig';
import { StreamingBackend } from '../config/StreamingBackend';
import { useIVSHostSession } from '../live/ivs/hooks/useIVSHostSession';
import { useIVSViewerSession } from '../live/ivs/hooks/useIVSViewerSession';

const { width, height } = Dimensions.get('window');

// Debug: Log to verify correct imports
console.log('📸 LiveStreamScreen: CameraView imported?', typeof CameraView);

const LiveStreamScreen = (props) => {
  console.log('[LIVE][COMPONENT_MOUNT] LiveStreamScreen mounted');
  console.log('[LIVE][PROPS_AT_MOUNT]', !!props, props ? Object.keys(props) : null);

  const { navigation, route } = props || {};

  console.log('[LIVE][RAW_ROUTE_OBJECT]', route);
  console.log('[LIVE][ROUTE_PARAMS]', route?.params);
  console.log('='.repeat(60));
  
  useRenderTimer('LiveStreamScreen');
  const trackAsync = useTrackAsync();
  const { uid, isAuthenticated, authReady, loading: authLoading, getDisplayName } = useAuth();
  
  // STEP 1: Clean, explicit route param parsing
  // Route params are the SINGLE SOURCE OF TRUTH for viewer vs host mode
  const safeRoute = route || {};
  const rawParams = safeRoute.params || {};

  const routeMode =
    typeof rawParams.mode === 'string' && rawParams.mode.length > 0
      ? rawParams.mode
      : null;

  const routeHostUid =
    typeof rawParams.hostUid === 'string' && rawParams.hostUid.trim().length > 0
      ? rawParams.hostUid.trim()
      : null;

  const routeStreamId =
    typeof rawParams.streamId === 'string' && rawParams.streamId.trim().length > 0
      ? rawParams.streamId.trim()
      : null;

  const routeHostDisplayName =
    typeof rawParams.hostDisplayName === 'string' && rawParams.hostDisplayName.trim().length > 0
      ? rawParams.hostDisplayName.trim()
      : null;

  // Determine mode: viewer ONLY if all required params present
  const isViewerRoute = routeMode === 'viewer' && !!routeHostUid && !!routeStreamId;

  const mode = isViewerRoute ? 'viewer' : 'host';
  const isViewer = isViewerRoute;
  const isHost = !isViewer;

  // CRITICAL DEBUG: Log decision
  console.log('[LIVE][DECISION_MADE]', {
    routeMode,
    routeHostUid,
    routeStreamId,
    isViewerRoute,
    mode,
    isViewer,
    isHost,
  });

  console.log('[LIVE][RECEIVED_ROUTE_PARAMS]', {
    rawParams,
    routeMode,
    routeHostUid,
    routeStreamId,
    routeHostDisplayName,
    isViewerRoute,
    finalMode: mode,
  });

  // STEP 2: Safe displayName resolution
  const getDisplayNameSafe = () => {
    try {
      if (typeof getDisplayName === 'function') {
        const val = getDisplayName();
        if (val && typeof val === 'string') {
          return val;
        }
      }
    } catch (e) {
      console.warn('[LIVE][DISPLAYNAME_RESOLVE_ERROR]', e);
    }
    return uid || null;
  };

  const hostUid = isViewer ? routeHostUid : uid;
  const hostDisplayName = isViewer
    ? routeHostDisplayName || routeHostUid
    : getDisplayNameSafe();

  console.log('[LIVE][MODE_RESOLVED]', {
    mode,
    isViewer,
    isHost,
    hostUid,
    hostDisplayName,
    uid,
  });
  
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
  const SEGMENT_DURATION_SECONDS = 2.5;
  const MIN_SEGMENT_BYTES = 50 * 1024; // Skip obviously truncated files (increased from 20KB)
  const segmentIndexRef = useRef(0);
  const streamingActiveRef = useRef(false);
  const isRecordingSegmentRef = useRef(false); // CRITICAL: prevent re-entry
  const [isRecording, setIsRecording] = useState(false); // Track if camera is recording
  
  const cameraRef = useRef(null);
  const recordingIntervalRef = useRef(null); // For segment loop
  // CameraView uses 'facing' prop with 'front' or 'back' strings
  const [facing, setFacing] = useState('front');
  const animatedValue = useRef(new Animated.Value(0)).current;
  
  // Using RNFirebase services via imported modules/services

  // IVS Architecture Integration (feature-flagged, default OFF)
  const backend = streamingConfig.backend;
  console.log('[LIVE][BACKEND_SELECTED]', backend);

  // IVS Host Session (active if backend === IVS and isHost)
  const ivsHostEnabled = backend === StreamingBackend.IVS && isHost === true;
  
  const ivsHostSession = useIVSHostSession({
    enabled: ivsHostEnabled,
    streamId: streamId || undefined,
    title: title,
  });

  console.log('[LIVE][IVS_HOST_SESSION]', {
    enabled: ivsHostEnabled,
    backend,
    connectionState: ivsHostSession.connectionState,
    participants: ivsHostSession.participants.length,
    networkQuality: ivsHostSession.networkQuality,
    error: ivsHostSession.error,
  });

  // IVS Viewer Session (active if backend === IVS and isViewer)
  const ivsViewerEnabled = backend === StreamingBackend.IVS && isViewer === true;

  const ivsViewerSession = useIVSViewerSession({
    streamId: routeStreamId || '',
    enabled: ivsViewerEnabled && !!routeStreamId,
    autoJoin: ivsViewerEnabled && !!routeStreamId,
  });

  console.log('[LIVE][IVS_VIEWER_SESSION]', {
    enabled: ivsViewerEnabled,
    backend,
    connectionState: ivsViewerSession.connectionState,
    networkQuality: ivsViewerSession.networkQuality,
    error: ivsViewerSession.error,
  });

  // STEP 3 + Guard: Validate viewer route params and enforce single source of truth
  useEffect(() => {
    // Viewer mode requires streamId and hostUid from route params
    if (isViewer && (!routeStreamId || !routeHostUid)) {
      console.warn('⚠️ [LIVE][GUARD] Viewer mode with invalid params, navigating back', {
        mode,
        isViewer,
        routeStreamId,
        routeHostUid,
      });
      if (navigation && navigation.goBack) {
        navigation.goBack();
      }
    }
  }, [isViewer, routeStreamId, routeHostUid, navigation]);

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
    
    // STEP 3: VIEWER MODE NEVER REQUESTS PERMISSIONS
    if (!isHost) {
      console.log('[LIVE][PERMISSIONS] Non-host mode: skipping camera and microphone permission requests');
      setCameraReady(false); // Viewers don't need camera
      return; // Exit immediately, do not request permissions
    }
    
    // HOST MODE: Request camera and microphone permissions
    console.log('[LIVE][PERMISSIONS] Host mode: requesting camera and microphone permissions');
    if (!cameraPermission) {
      console.log('[CAMERA] Requesting camera permission...');
      requestCameraPermission();
    }
    if (!microphonePermission) {
      console.log('[CAMERA] Requesting microphone permission...');
      requestMicrophonePermission();
    }
    
    // CRITICAL: Set camera as ready ONLY after BOTH permissions granted (host mode only)
    if (mounted && cameraPermission?.granted && microphonePermission?.granted) {
      console.log('[LIVE][CAMERA_PERMISSIONS_STATE] Both granted, setting cameraReady=true');
      setCameraReady(true);
    } else {
      console.log('[LIVE][CAMERA_PERMISSIONS_STATE] Waiting for permissions:', {
        cameraGranted: cameraPermission?.granted,
        micGranted: microphonePermission?.granted,
        cameraReady,
      });
    }

    // Focus effect to ensure camera is initialized when navigating to this screen
    let unsubscribeFocus;
    if (navigation && navigation.addListener) {
      unsubscribeFocus = navigation.addListener('focus', () => {
        console.log('[CAMERA] Screen focused, checking permissions again');
        if (cameraPermission?.granted && microphonePermission?.granted) {
          console.log('[CAMERA] Permissions OK on focus, setting cameraReady=true');
          setCameraReady(true);
        }
      });
    }

    return () => {
      mounted = false;
      if (unsubscribeFocus) {
        unsubscribeFocus();
      }
      
      // Cleanup when component unmounts
      if (isStreaming) {
        stopStreaming();
      }
    };
  }, [navigation, cameraPermission, microphonePermission, isHost]);

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
    const unsubscribe = HLSLiveStreamServiceInstance.subscribeToStream(routeStreamId, (data) => {
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
    // STEP 3: GUARD - Host only operation
    if (!isHost) {
      console.warn('[LIVE][GUARD] Ignoring startStreaming in non-host mode', {
        isHost,
        isViewer,
        mode,
      });
      return;
    }

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
    // STEP 3: GUARD - Host only operation
    if (!isHost) {
      console.warn('[LIVE][GUARD] actuallyStartStream called in non-host mode, aborting', {
        isHost,
        mode,
      });
      return;
    }

    // Auth guard: ensure user is logged in before attempting stream
    if (!authReady) {
      console.warn('[LIVE][AUTH_GUARD_FAIL]', {
        reason: 'AUTH_NOT_READY',
        uid,
        isAuthenticated,
        authReady,
      });
      Alert.alert(
        'Please wait',
        'We are still finishing login. Try again in a moment.'
      );
      return;
    }
    
    if (!isAuthenticated || !uid) {
      console.warn('[LIVE][AUTH_GUARD_FAIL]', {
        reason: 'NO_UID_OR_NOT_AUTHENTICATED',
        uid,
        isAuthenticated,
        authReady,
      });
      Alert.alert(
        'Login required',
        'You must be logged in to go live.'
      );
      return;
    }
    
    // DEV: Skip Firebase auth bridge (Firestore rules are open)
    if (__DEV__) {
      console.log('[LIVE][AUTH] DEV: skipping Firebase auth bridge (Firestore rules are open).');
    }

    try {
      // Feature flag guard: block if streaming disabled
      if (!isLiveStreamingEnabled()) {
        Alert.alert(
          'Live streaming not available',
          'Our live streaming backend is not fully configured yet. Please try again later.'
        );
        setIsStreaming(false);
        return;
      }
      
      console.log('🚀 Starting live stream', { backend, uid, title });
      
      const resolvedDisplayName = getDisplayNameSafe();
      console.log('[LIVE][DEBUG_DISPLAYNAME_RESOLUTION]', {
        resolvedDisplayName,
        uid,
      });
      
      console.log('[LIVE][CREATE_STREAM_CALL]', {
        userId: uid,
        userDisplayName: resolvedDisplayName,
        title,
        mode,
        backend,
      });
      
      // IVS Backend: Start streaming via IVS Real-Time
      if (backend === StreamingBackend.IVS) {
        console.log('[LIVE][IVS] Starting IVS broadcast');
        
        logStreamingEvent('STREAM_START_REQUEST', {
          backendId: 'IVS',
          userId: uid,
          source: 'UI',
          mode: 'host',
        });

        try {
          // IVS hook will fetch token and start native broadcast
          await ivsHostSession.startStreaming();
          
          if (ivsHostSession.error) {
            throw new Error(ivsHostSession.error);
          }
          
          // Note: streamId will be set by backend response in hook
          setIsStreaming(true);
          setStreamStartTime(Date.now());
          
          logStreamingEvent('STREAM_START_SUCCESS', {
            backendId: 'IVS',
            userId: uid,
            streamId: streamId,
            source: 'UI',
          });
          
          console.log('🎉 IVS live streaming started successfully');
          
        } catch (error) {
          console.error('❌ IVS stream start error:', error);
          
          logStreamingEvent('STREAM_START_FAILURE', {
            backendId: 'IVS',
            userId: uid,
            reason: error.message,
            source: 'UI',
          });
          
          Alert.alert('Streaming Error', error.message || 'Could not start IVS stream.');
          setIsStreaming(false);
        }
        
        return;
      }
      
      // HLS Backend (Legacy): Start segment recording
      console.log('[LIVE][HLS] Starting HLS segment recording (legacy)');
      
      // Double-check camera ref is available for HLS mode
      if (!cameraRef.current) {
        Alert.alert('Camera Error', 'Camera reference was lost. Please try again.');
        return;
      }
      
      logStreamingEvent('STREAM_START_REQUEST', {
        backendId: 'HLS',
        userId: uid,
        source: 'UI',
        mode: 'host',
      });

      const hlsBackend = getStreamingBackend();
      const result = await hlsBackend.createStream({
        userId: uid,
        title: title,
        displayName: resolvedDisplayName,
        photoURL: null,
        email: null,
      });
      
      // Handle structured error
      if (!result.ok) {
        console.error('❌ Stream creation failed:', result.reason || result.error);
        
        logStreamingEvent('STREAM_START_FAILURE', {
          backendId: 'HLS',
          userId: uid,
          reason: result.reason,
          errorMessage: result.error,
          source: 'UI',
        });

        if (result.reason === 'NOT_LOGGED_IN') {
          Alert.alert(
            'Streaming error',
            'We had a problem starting your stream. Please try again.'
          );
        } else if (result.reason === 'BACKEND_NOT_CONFIGURED') {
          Alert.alert(
            'Live streaming not available',
            'The live streaming backend is not configured right now.'
          );
        } else if (result.reason === 'PERMISSION_DENIED') {
          Alert.alert(
            'Live streaming not available',
            'You do not have permission to stream from this account.'
          );
        } else {
          Alert.alert(
            'Streaming error',
            result.error || 'Unable to start live stream.'
          );
        }
        
        setIsStreaming(false);
        return;
      }

      logStreamingEvent('STREAM_START_SUCCESS', {
        backendId: 'HLS',
        userId: uid,
        streamId: result.data.streamId,
        source: 'UI',
      });
      
      const newStreamId = result.data.streamId;
      
      setStreamId(newStreamId);
      console.log('✅ HLS Stream created:', newStreamId);
      
      setIsStreaming(true);
      setStreamStartTime(Date.now());
      segmentIndexRef.current = 0;
      streamingActiveRef.current = true;
      setSegmentNumber(0);
      
      // Start continuous segment recording (2.5 second intervals)
      startSegmentRecordingLoop(newStreamId);
      
      console.log('🎉 HLS live streaming started successfully');
      
    } catch (error) {
      console.error('❌ Stream start error:', error);
      Alert.alert('Streaming Error', 'Could not start live stream. Please try again.');
      streamingActiveRef.current = false;
      setIsStreaming(false);
    }
  };

  // Continuous segment recording loop
  const startSegmentRecordingLoop = async (streamIdParam) => {
    // STEP 3: GUARD - Host only operation
    if (!isHost) {
      console.warn('[LIVE][GUARD] startSegmentRecordingLoop called in non-host mode, blocking', {
        isHost,
        mode,
      });
      return;
    }

    const currentStreamId = streamIdParam || streamId;
    if (!currentStreamId) {
      console.error('❌ No stream ID for recording');
      return;
    }
    if (!uid) {
      console.error('❌ No user ID for recording uploads');
      return;
    }

    console.log('🎬 Starting segment recording loop', { currentStreamId });
    
    const recordNextSegment = async () => {
      const hasCamera = !!cameraRef.current;
      const isStreamingActive = streamingActiveRef.current;
      const currentSegmentNumber = segmentIndexRef.current;

      console.log(`[RECORD_SEGMENT_${currentSegmentNumber}] CHECK: hasCamera=${hasCamera}, isStreamingActive=${isStreamingActive}`);

      if (!hasCamera || !isStreamingActive) {
        console.log('⏹️ Stopping segment loop: camera or stream unavailable', {
          hasCamera,
          isStreamingActive,
          currentStreamId,
        });
        // Loop will exit naturally when isStreamingActive becomes false
        return;
      }

      // CRITICAL: Prevent re-entry - only one recording at a time
      if (isRecordingSegmentRef.current) {
        console.warn(`[RECORD_SEGMENT_${currentSegmentNumber}] Already recording, skipping re-entry`);
        return;
      }

      isRecordingSegmentRef.current = true;

      try {
        setIsRecording(true);
        console.log(`📹 Recording segment ${currentSegmentNumber}... BEFORE recordAsync`);
        
        // Record 2.5 second segment
        console.log(`[RECORD_SEGMENT_${currentSegmentNumber}] Calling recordAsync with maxDuration=${SEGMENT_DURATION_SECONDS}, quality=720p`);
        const video = await cameraRef.current.recordAsync({
          maxDuration: SEGMENT_DURATION_SECONDS,
          quality: '720p',
        });
        console.log(`[RECORD_SEGMENT_${currentSegmentNumber}] recordAsync COMPLETED, received video.uri`);
        
        setIsRecording(false);
        console.log(`✅ Segment ${currentSegmentNumber} recorded:`, video.uri);

        // Guard against truncated files that can produce invalid segments
        let segmentSize = 0;
        let fileExists = false;
        try {
          const info = await FileSystem.getInfoAsync(video.uri);
          fileExists = info?.exists || false;
          segmentSize = info?.size || 0;
          console.log(`[RECORD_SEGMENT_${currentSegmentNumber}] File info: exists=${fileExists}, size=${segmentSize}`);
          
          if (!fileExists) {
            console.error(`[RECORD_SEGMENT_${currentSegmentNumber}] File does not exist, aborting upload`, { uri: video.uri });
            return;
          }
          
          if (segmentSize < MIN_SEGMENT_BYTES) {
            console.error(`[RECORD_SEGMENT_${currentSegmentNumber}] File too small (likely corrupt), aborting upload`, {
              size: segmentSize,
              minBytes: MIN_SEGMENT_BYTES,
              uri: video.uri,
            });
            return;
          }
        } catch (infoErr) {
          console.error(`[RECORD_SEGMENT_${currentSegmentNumber}] getInfoAsync failed, CANNOT validate segment`, infoErr);
          // Without size validation, we MUST abort to prevent corrupt uploads
          return;
        }
        
        // Upload segment via streaming backend
        const backend = getStreamingBackend();
        console.log(`[RECORD_SEGMENT_${currentSegmentNumber}] Uploading to backend...`);
        const uploadResult = await backend.uploadSegment({
          streamId: currentStreamId,
          userId: uid,
          fileUri: video.uri,
          segmentNumber: currentSegmentNumber,
        });
        
        if (!uploadResult.ok) {
          console.error(`❌ Segment ${currentSegmentNumber} upload failed:`, uploadResult.error);
        } else {
          console.log(`✅ Segment ${currentSegmentNumber} uploaded`);
        }
        
        // Increment ref first so next run uses N+1, then reflect to state for UI
        segmentIndexRef.current = currentSegmentNumber + 1;
        setSegmentNumber(segmentIndexRef.current);
        console.log(`[RECORD_SEGMENT_${currentSegmentNumber}] Segment completed, incrementing counter -> ${segmentIndexRef.current}`);
        
      } catch (error) {
        setIsRecording(false);
        console.error(`❌ Error recording segment ${currentSegmentNumber}:`, error.message, error);
        console.error(`[RECORD_SEGMENT_${currentSegmentNumber}] Full error stack:`, JSON.stringify(error, Object.getOwnPropertyNames(error)));
      } finally {
        // CRITICAL: Always release recording guard
        isRecordingSegmentRef.current = false;
      }
    };

    // CRITICAL: Sequential recording loop - wait for each segment to complete before starting next
    // This prevents overlap and ensures upload finishes before viewer timeout
    const recordLoop = async () => {
      while (streamingActiveRef.current && cameraRef.current) {
        await recordNextSegment();
        // Short delay before next segment (allows state updates to propagate)
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      console.log('⏹️ Recording loop exited');
    };
    
    // Start the loop
    recordLoop().catch(err => {
      console.error('❌ Recording loop crashed:', err);
      streamingActiveRef.current = false;
    });
  };

  const stopStreaming = async () => {
    try {
      console.log('⏹️ Stopping stream', { backend, streamId });
      
      // IVS Backend: Stop native broadcast
      if (backend === StreamingBackend.IVS) {
        console.log('[LIVE][IVS] Stopping IVS broadcast');
        
        logStreamingEvent('STREAM_END_REQUEST', {
          backendId: 'IVS',
          streamId,
          userId: uid,
          source: 'UI',
        });

        try {
          await ivsHostSession.stopStreaming();
          
          logStreamingEvent('STREAM_END_SUCCESS', {
            backendId: 'IVS',
            streamId,
            userId: uid,
            source: 'UI',
          });
          
          console.log('✅ IVS stream stopped');
        } catch (error) {
          console.warn('⚠️ IVS stream stop failed:', error);
          
          logStreamingEvent('STREAM_END_FAILURE', {
            backendId: 'IVS',
            streamId,
            userId: uid,
            reason: error.message,
            source: 'UI',
          });
        }
      } else {
        // HLS Backend (Legacy): Stop segment recording
        console.log('[LIVE][HLS] Stopping HLS segment recording (legacy)');
        
        // Signal loop to stop (it will exit on next iteration)
        streamingActiveRef.current = false;
        segmentIndexRef.current = 0;
        
        // Stop camera recording if active
        if (cameraRef.current && isRecording) {
          await cameraRef.current.stopRecording();
        }
        
        // End stream via HLS backend
        if (streamId) {
          logStreamingEvent('STREAM_END_REQUEST', {
            backendId: 'HLS',
            streamId,
            userId: uid,
            source: 'UI',
          });

          const hlsBackend = getStreamingBackend();
          const endResult = await hlsBackend.endStream({ streamId, userId: uid });
          
          if (!endResult.ok) {
            console.warn('⚠️ HLS stream end failed:', endResult.error);
            logStreamingEvent('STREAM_END_FAILURE', {
              backendId: 'HLS',
              streamId,
              userId: uid,
              reason: endResult.reason,
              errorMessage: endResult.error,
              source: 'UI',
            });
          } else {
            console.log('✅ HLS stream ended:', streamId);
            logStreamingEvent('STREAM_END_SUCCESS', {
              backendId: 'HLS',
              streamId,
              userId: uid,
              source: 'UI',
            });
          }
        }
      }
      
      // Cleanup state
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
      // Still cleanup local state even if backend fails
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
    
    // Update like count via backend API asynchronously (non-blocking)
    try {
      if (isViewer && routeStreamId && uid) {
        const token = await getCognitoIdToken();
        HLSLiveStreamServiceInstance.addLike(routeStreamId, uid, token);
      }
    } catch (_e) {
      // ignore like failures for UX smoothness
    }
  };

  const sendComment = async () => {
    if (!newComment.trim() || !streamId) return;
    
    if (!uid || !isAuthenticated) {
      console.error('Cannot send comment: user not authenticated');
      Alert.alert('Login Required', 'You must be logged in to comment.');
      return;
    }
    
    try {
      const token = await getCognitoIdToken();
      await HLSLiveStreamServiceInstance.addComment(streamId, newComment, uid, token);
      setNewComment('');
    } catch (error) {
      console.error('Error sending comment:', error);
      Alert.alert('Error', 'Failed to send comment. Please try again.');
    }
  };

  // Subscribe to comments while hosting
  useEffect(() => {
    if (!isStreaming || !streamId) return;
    const unsubscribe = HLSLiveStreamServiceInstance.subscribeToComments(streamId, (items) => {
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
    console.log('[LIVE][CAMERA_READY] CameraView is ready');
    // Note: setCameraReady already managed by permission effect
  };

  if (cameraPermission === null || microphonePermission === null) {
    return <View style={styles.container} />;
  }

  // Viewer mode: Show actual live stream playback
  if (isViewer) {
    // Feature flag guard for viewer mode
    if (!isLiveStreamingEnabled()) {
      return (
        <View style={styles.container}>
          <StatusBar style="light" />
          <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Live streaming not available</Text>
            <Text style={styles.errorMessage}>
              Live streaming is currently disabled for this build.
            </Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.retryText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

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
            {hostDisplayName || 'Unknown'}
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
            const errorMsg = error?.message || 'Unable to load stream';
            let userMsg = 'This stream is not available right now.';
            
            // Map structured errors to user messages
            if (errorMsg.includes('ended') || errorMsg.includes('Stream has ended')) {
              userMsg = 'This stream has ended.';
            } else if (errorMsg.includes('not found') || errorMsg.includes('does not exist')) {
              userMsg = 'This stream does not exist.';
            } else if (errorMsg.includes('connection') || errorMsg.includes('network')) {
              userMsg = 'Connection error. Please check your internet and try again.';
            }
            
            Alert.alert(
              'Stream Unavailable',
              userMsg,
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
      
      {/* VIEWER MODE: Show viewer UI instead of camera */}
      {isViewer ? (
        <View style={{ flex: 1 }}>
          <LiveStreamViewer 
            streamId={routeStreamId} 
            hostUid={hostUid}
          />
        </View>
      ) : (
        /* HOST MODE: Show camera and streaming UI */
        <View style={styles.cameraContainer}>
        {cameraReady ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            // Must be in video mode for recordAsync to resolve
            mode="video"
            onCameraReady={() => {
              console.log('[CAMERA] ✅ CameraView onCameraReady fired - camera stream ACTIVE');
              handleCameraReady();
            }}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: '#fff', fontSize: 16 }}>
              {cameraPermission?.granted && microphonePermission?.granted 
                ? '📸 Loading camera...' 
                : '🔒 Waiting for permissions...'}
            </Text>
          </View>
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
              {streamId && (
                <Text style={styles.streamIdDebug}>ID: {streamId}</Text>
              )}
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
      )}
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
  streamIdDebug: {
    color: '#ffeb3b',
    marginLeft: 10,
    fontSize: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    fontFamily: 'monospace',
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

export default LiveStreamScreen;