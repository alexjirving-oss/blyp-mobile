/**
 * APK-Fixed LiveStream Component - Standalone Production Ready
 * 
 * This fixes initialization issues in standalone APK builds
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Icon from './Icon';
import { 
  View, 
  StyleSheet, 
  Alert, 
  Text, 
  TouchableOpacity,
  Dimensions,
  AppState,
  Platform
} from 'react-native';
import { CameraView } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import ScalableHLSService from '../services/ScalableHLSService';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const APKFixedLiveStreamBroadcaster = ({ 
  streamId, 
  onSegmentUploaded, 
  onError, 
  onStreamHealthUpdate,
  style,
  qualityPreference = 'auto'
}) => {
  // Core state
  const cameraRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [cameraFacing, setCameraFacing] = useState('front');
  const [cameraReady, setCameraReady] = useState(false);
  const [streamHealth, setStreamHealth] = useState('initializing');
  
  // APK-specific state
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [isAPKMode, setIsAPKMode] = useState(false);
  const [debugInfo, setDebugInfo] = useState('Starting...');
  
  // Recording management
  const segmentCountRef = useRef(0);
  const recordingIntervalRef = useRef(null);
  const healthCheckIntervalRef = useRef(null);
  const lastUploadTimeRef = useRef(Date.now());
  
  // APK Detection
  useEffect(() => {
    const detectAPKMode = () => {
      // In standalone APK, __DEV__ is false and we don't have development server
      const isAPK = !__DEV__ && !global.__METRO__;
      setIsAPKMode(isAPK);
      setDebugInfo(`Mode: ${isAPK ? 'Standalone APK' : 'Development'}`);
      console.log('🏭 APK Detection:', { isAPK, __DEV__, hasMetro: !!global.__METRO__ });
    };
    
    detectAPKMode();
  }, []);
  
  // APK-Fixed Camera Initialization
  const initializeCameraForAPK = useCallback(async () => {
    try {
      setDebugInfo('Initializing camera for APK...');
      console.log('📱 APK Camera Init: Starting initialization');
      
      // Wait a bit longer in APK mode for camera to be ready
      await new Promise(resolve => setTimeout(resolve, isAPKMode ? 2000 : 500));
      
      if (cameraRef.current) {
        console.log('📱 APK Camera Init: Camera ref available');
        setCameraReady(true);
        setStreamHealth('ready');
        setDebugInfo('Camera ready for APK');
        return true;
      } else {
        console.log('📱 APK Camera Init: Camera ref not available, retrying...');
        setInitializationAttempt(prev => prev + 1);
        
        if (initializationAttempt < 3) {
          setTimeout(() => initializeCameraForAPK(), 1000);
        } else {
          throw new Error('Camera initialization failed after 3 attempts');
        }
        return false;
      }
    } catch (error) {
      console.error('❌ APK Camera Init Error:', error);
      setDebugInfo(`Init Error: ${error.message}`);
      setStreamHealth('error');
      onError?.(error);
      return false;
    }
  }, [isAPKMode, initializationAttempt, onError]);
  
  // Camera ready handler with APK fixes
  const handleCameraReady = useCallback(async () => {
    console.log('📹 Camera Ready Event Fired');
    setDebugInfo('Camera ready event received');
    
    if (isAPKMode) {
      // Extra delay for APK to ensure camera is fully ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    await initializeCameraForAPK();
  }, [isAPKMode, initializeCameraForAPK]);
  
  // APK-Safe Recording Function
  const recordVideoSegmentAPKSafe = useCallback(async () => {
    if (!cameraRef.current || !cameraReady) {
      console.log('⚠️ APK Recording: Camera not ready');
      setDebugInfo('Camera not ready for recording');
      return null;
    }
    
    try {
      setDebugInfo('Recording video segment...');
      console.log('🎬 APK Recording: Starting video recording');
      
      const recordingOptions = {
        quality: '720p',
        maxDuration: 3,
        mute: false
      };
      
      // APK-specific recording with longer timeout
      const recordingPromise = cameraRef.current.recordAsync(recordingOptions);
      
      // Longer timeout for APK
      const timeout = isAPKMode ? 8000 : 5000;
      
      const result = await Promise.race([
        recordingPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Recording timeout after ${timeout}ms`)), timeout)
        )
      ]);
      
      if (result && result.uri) {
        console.log('✅ APK Recording: Success', result.uri);
        setDebugInfo('Video recorded successfully');
        return result.uri;
      } else {
        throw new Error('No video URI returned');
      }
      
    } catch (error) {
      console.error('❌ APK Recording Error:', error.message);
      setDebugInfo(`Recording Error: ${error.message}`);
      return null;
    }
  }, [cameraReady, isAPKMode]);
  
  // APK-Safe Upload Function
  const uploadSegmentAPKSafe = useCallback(async (videoUri) => {
    try {
      setDebugInfo('Uploading segment...');
      console.log('📡 APK Upload: Starting upload', videoUri);
      
      const result = await ScalableHLSService.uploadSegment(
        streamId,
        videoUri,
        segmentCountRef.current,
        {
          quality: qualityPreference,
          timestamp: Date.now(),
          isAPKMode,
          debugInfo: 'APK Safe Upload'
        }
      );
      
      console.log('✅ APK Upload: Success', result);
      setDebugInfo('Segment uploaded successfully');
      lastUploadTimeRef.current = Date.now();
      
      onSegmentUploaded?.(result);
      return result;
      
    } catch (error) {
      console.error('❌ APK Upload Error:', error);
      setDebugInfo(`Upload Error: ${error.message}`);
      throw error;
    }
  }, [streamId, qualityPreference, isAPKMode, onSegmentUploaded]);
  
  // Main Recording Loop for APK
  const recordAndUploadLoop = useCallback(async () => {
    if (!isStreaming || !cameraReady) {
      return;
    }
    
    try {
      setDebugInfo(`Recording segment ${segmentCountRef.current}...`);
      console.log(`🎬 APK Loop: Recording segment ${segmentCountRef.current}`);
      
      // Record video
      const videoUri = await recordVideoSegmentAPKSafe();
      
      if (videoUri) {
        // Upload video
        await uploadSegmentAPKSafe(videoUri);
        
        // Clean up local file
        try {
          await FileSystem.deleteAsync(videoUri);
        } catch (cleanupError) {
          console.warn('⚠️ APK Cleanup: File cleanup failed', cleanupError);
        }
      } else {
        // Upload metadata segment as fallback
        console.log('📊 APK Loop: Using metadata fallback');
        await ScalableHLSService.uploadSegment(
          streamId,
          null,
          segmentCountRef.current,
          {
            isMetadataOnly: true,
            reason: 'APK video recording failed',
            timestamp: Date.now(),
            isAPKMode
          }
        );
        setDebugInfo('Used metadata fallback');
      }
      
      segmentCountRef.current++;
      setStreamHealth('healthy');
      
    } catch (error) {
      console.error('❌ APK Loop Error:', error);
      setDebugInfo(`Loop Error: ${error.message}`);
      setStreamHealth('degraded');
    }
  }, [isStreaming, cameraReady, recordVideoSegmentAPKSafe, uploadSegmentAPKSafe, streamId]);
  
  // Start Streaming
  const startStreaming = useCallback(async () => {
    if (!cameraReady) {
      Alert.alert('Camera Not Ready', 'Please wait for camera to initialize');
      return;
    }
    
    try {
      setDebugInfo('Starting streaming...');
      console.log('🚀 APK Streaming: Starting');
      
      setIsStreaming(true);
      segmentCountRef.current = 0;
      
      // Start recording loop with APK-appropriate interval
      const interval = isAPKMode ? 4000 : 3000; // Slightly longer for APK
      recordingIntervalRef.current = setInterval(recordAndUploadLoop, interval);
      
      // Health monitoring
      healthCheckIntervalRef.current = setInterval(() => {
        const timeSinceLastUpload = Date.now() - lastUploadTimeRef.current;
        if (timeSinceLastUpload > 15000) { // 15 seconds
          setStreamHealth('unhealthy');
          setDebugInfo('Stream health degraded');
        }
        
        onStreamHealthUpdate?.({
          health: streamHealth,
          segmentCount: segmentCountRef.current,
          timeSinceLastUpload,
          isAPKMode
        });
      }, 5000);
      
      setDebugInfo('Streaming started successfully');
      console.log('✅ APK Streaming: Started successfully');
      
    } catch (error) {
      console.error('❌ APK Streaming Start Error:', error);
      setDebugInfo(`Start Error: ${error.message}`);
      onError?.(error);
    }
  }, [cameraReady, isAPKMode, recordAndUploadLoop, streamHealth, onStreamHealthUpdate, onError]);
  
  // Stop Streaming
  const stopStreaming = useCallback(async () => {
    try {
      setDebugInfo('Stopping streaming...');
      console.log('⏹️ APK Streaming: Stopping');
      
      setIsStreaming(false);
      
      // Clear intervals
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
        healthCheckIntervalRef.current = null;
      }
      
      // Stop any ongoing recording
      if (isRecording && cameraRef.current) {
        try {
          await cameraRef.current.stopRecording();
        } catch (stopError) {
          console.warn('⚠️ APK Stop: Recording stop failed', stopError);
        }
      }
      
      setIsRecording(false);
      setStreamHealth('stopped');
      setDebugInfo('Streaming stopped');
      console.log('✅ APK Streaming: Stopped successfully');
      
    } catch (error) {
      console.error('❌ APK Streaming Stop Error:', error);
      setDebugInfo(`Stop Error: ${error.message}`);
    }
  }, [isRecording]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, [stopStreaming]);
  
  // Auto-initialize camera when component mounts
  useEffect(() => {
    if (isAPKMode) {
      // Longer delay for APK initialization
      const timer = setTimeout(() => {
        initializeCameraForAPK();
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [isAPKMode, initializeCameraForAPK]);
  
  return (
    <View style={[styles.container, style]}>
      {/* Camera View */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={cameraFacing}
        onCameraReady={handleCameraReady}
      />
      
      {/* APK Debug Overlay */}
      {isAPKMode && (
        <View style={styles.debugOverlay}>
          <Text style={styles.debugText}>APK Mode: {debugInfo}</Text>
          <Text style={styles.debugText}>Health: {streamHealth}</Text>
          <Text style={styles.debugText}>Segments: {segmentCountRef.current}</Text>
        </View>
      )}
      
      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.button, isStreaming ? styles.stopButton : styles.startButton]}
          onPress={isStreaming ? stopStreaming : startStreaming}
          disabled={!cameraReady}
        >
          <Icon  
            name={isStreaming ? "stop" : "play"} 
            size={24} 
            color="white" 
           />
          <Text style={styles.buttonText}>
            {isStreaming ? 'Stop Streaming' : 'Start Streaming'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.flipButton}
          onPress={() => setCameraFacing(current => current === 'front' ? 'back' : 'front')}
        >
          <Icon  name="camera-reverse" size={24} color="white"  />
        </TouchableOpacity>
      </View>
      
      {/* Status Indicator */}
      <View style={[styles.statusIndicator, { 
        backgroundColor: cameraReady ? 
          (streamHealth === 'healthy' ? '#10B981' : 
           streamHealth === 'degraded' ? '#F59E0B' : 
           streamHealth === 'error' ? '#EF4444' : '#6B7280') : '#6B7280' 
      }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  debugOverlay: {
    position: 'absolute',
    top: 50,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 10,
    borderRadius: 5,
  },
  debugText: {
    color: 'white',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  controls: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    marginRight: 10,
  },
  startButton: {
    backgroundColor: '#10B981',
  },
  stopButton: {
    backgroundColor: '#EF4444',
  },
  buttonText: {
    color: 'white',
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '600',
  },
  flipButton: {
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
  },
  statusIndicator: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});

export default APKFixedLiveStreamBroadcaster;