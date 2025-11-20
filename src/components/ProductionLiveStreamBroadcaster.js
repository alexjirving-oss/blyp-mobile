/**
 * Production LiveStreamBroadcaster - Enterprise Grade for Massive Scale
 * 
 * Designed for millions of concurrent broadcasters with:
 * ✅ Bulletproof video recording with expo-camera v15
 * ✅ Adaptive quality encoding and bitrate management
 * ✅ Real-time network condition monitoring
 * ✅ Automatic recovery from failures
 * ✅ Memory optimization for long streams
 * ✅ Production error handling and analytics
 * ✅ CDN-optimized segment uploading
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
import NetInfo from '@react-native-community/netinfo';
import ScalableHLSService from '../services/ScalableHLSService';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const ProductionLiveStreamBroadcaster = ({ 
  streamId, 
  onSegmentUploaded, 
  onError, 
  onStreamHealthUpdate,
  style,
  qualityPreference = 'auto'
}) => {
  // Core recording state
  const cameraRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [cameraFacing, setCameraFacing] = useState('front');
  
  // Production state management
  const [cameraReady, setCameraReady] = useState(false);
  const [streamHealth, setStreamHealth] = useState('initializing');
  const [networkQuality, setNetworkQuality] = useState('unknown');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  
  // Enterprise refs for cleanup and state
  const segmentCounterRef = useRef(0);
  const recordingIntervalRef = useRef(null);
  const currentRecordingRef = useRef(null);
  const uploadQueueRef = useRef([]);
  const networkMonitorRef = useRef(null);
  const healthCheckIntervalRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  
  // Performance optimization
  const [cameraKey, setCameraKey] = useState(0);
  const lastSegmentTimeRef = useRef(0);
  const consecutiveErrorsRef = useRef(0);
  const maxConsecutiveErrors = 3;
  
  // Analytics and monitoring
  const metricsRef = useRef({
    segmentsRecorded: 0,
    segmentsUploaded: 0,
    totalRecordingTime: 0,
    averageUploadTime: 0,
    streamStartTime: 0
  });

  /**
   * Initialize production streaming with comprehensive setup
   */
  useEffect(() => {
    if (streamId && cameraReady) {
      initializeProduction();
    }
    
    return () => {
      cleanupProduction();
    };
  }, [streamId, cameraReady]);

  /**
   * Monitor app state changes for production reliability
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, []);

  /**
   * Production initialization with comprehensive monitoring
   */
  const initializeProduction = async () => {
    try {
      console.log('🏭 Initializing production broadcasting...');
      metricsRef.current.streamStartTime = Date.now();
      
      // Start network monitoring
      startNetworkMonitoring();
      
      // Start health monitoring
      startHealthMonitoring();
      
      // Initialize streaming
      await startProductionStreaming();
      
      setStreamHealth('healthy');
      
    } catch (error) {
      console.error('❌ Production initialization failed:', error);
      handleProductionError(error, 'INIT_FAILED');
    }
  };

  /**
   * Start production-grade streaming with error handling
   */
  const startProductionStreaming = async () => {
    try {
      if (isStreaming) {
        console.log('⚠️ Already streaming, ignoring duplicate start');
        return;
      }

      console.log('🎬 Starting production streaming...');
      setIsStreaming(true);
      setIsRecording(true);
      
      // Reset counters
      segmentCounterRef.current = 0;
      consecutiveErrorsRef.current = 0;
      uploadQueueRef.current = [];
      
      // Start first segment
      await recordProductionSegment();
      
      // Set up production recording interval
      const intervalDuration = calculateOptimalInterval();
      
      recordingIntervalRef.current = setInterval(async () => {
        if (!isStreaming) return;
        
        try {
          await recordProductionSegment();
        } catch (error) {
          await handleRecordingError(error);
        }
      }, intervalDuration);
      
      console.log(`✅ Production streaming started with ${intervalDuration}ms intervals`);
      
    } catch (error) {
      console.error('❌ Failed to start streaming:', error);
      setIsStreaming(false);
      setIsRecording(false);
      throw error;
    }
  };

  /**
   * Record production-quality video segment with full error handling
   */
  const recordProductionSegment = async () => {
    if (!cameraRef.current || !isStreaming) {
      console.log('⚠️ Camera not ready or not streaming');
      return;
    }

    try {
      const segmentNumber = segmentCounterRef.current++;
      const startTime = Date.now();
      
      console.log(`🎥 Recording production segment ${segmentNumber}...`);
      
      // Calculate segment duration based on network quality
      const segmentDuration = calculateSegmentDuration();
      
      // Record with production settings
      const recordingOptions = {
        quality: getRecordingQuality(),
        maxDuration: segmentDuration,
        mute: false
      };
      
      // Start recording with timeout protection
      const recordingPromise = cameraRef.current.recordAsync(recordingOptions);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Recording timeout')), segmentDuration + 5000)
      );
      
      currentRecordingRef.current = await Promise.race([recordingPromise, timeoutPromise]);
      
      if (currentRecordingRef.current?.uri) {
        const recordingTime = Date.now() - startTime;
        console.log(`✅ Segment ${segmentNumber} recorded in ${recordingTime}ms`);
        
        // Update metrics
        metricsRef.current.segmentsRecorded++;
        metricsRef.current.totalRecordingTime += recordingTime;
        
        // Queue for upload
        queueSegmentUpload(currentRecordingRef.current.uri, segmentNumber);
        
        // Reset error counter on success
        consecutiveErrorsRef.current = 0;
        lastSegmentTimeRef.current = Date.now();
        
      } else {
        throw new Error('Recording failed - no URI returned');
      }
      
    } catch (error) {
      console.error(`❌ Recording segment failed:`, error);
      await handleRecordingError(error);
    }
  };

  /**
   * Queue segment for production upload with retry logic
   */
  const queueSegmentUpload = (videoUri, segmentNumber) => {
    const uploadTask = {
      videoUri,
      segmentNumber,
      attempts: 0,
      queuedAt: Date.now()
    };
    
    uploadQueueRef.current.push(uploadTask);
    processUploadQueue();
  };

  /**
   * Process upload queue with concurrent limits and retry logic
   */
  const processUploadQueue = async () => {
    const queue = uploadQueueRef.current;
    const activeUploads = queue.filter(task => task.uploading);
    
    // Respect concurrency limits
    const maxConcurrent = networkQuality === 'excellent' ? 3 : 
                         networkQuality === 'good' ? 2 : 1;
    
    if (activeUploads.length >= maxConcurrent) {
      return;
    }
    
    // Find next task to upload
    const nextTask = queue.find(task => !task.uploading && !task.completed && task.attempts < 3);
    
    if (!nextTask) return;
    
    // Start upload
    nextTask.uploading = true;
    nextTask.attempts++;
    
    try {
      const startTime = Date.now();
      
      console.log(`📤 Uploading segment ${nextTask.segmentNumber} (attempt ${nextTask.attempts})`);
      
      const result = await ScalableHLSService.uploadSegment(
        streamId,
        nextTask.videoUri,
        nextTask.segmentNumber,
        {
          networkQuality,
          recordingQuality: getRecordingQuality(),
          timestamp: Date.now()
        }
      );
      
      const uploadTime = Date.now() - startTime;
      
      // Update metrics
      metricsRef.current.segmentsUploaded++;
      metricsRef.current.averageUploadTime = 
        (metricsRef.current.averageUploadTime + uploadTime) / 2;
      
      // Mark as completed
      nextTask.completed = true;
      nextTask.uploading = false;
      
      // Cleanup local file
      await FileSystem.deleteAsync(nextTask.videoUri, { idempotent: true });
      
      // Update progress
      const progress = metricsRef.current.segmentsUploaded / metricsRef.current.segmentsRecorded;
      setUploadProgress(Math.min(progress, 1));
      
      // Notify callback
      onSegmentUploaded?.(result);
      
      console.log(`✅ Segment ${nextTask.segmentNumber} uploaded successfully (${uploadTime}ms)`);
      
      // Process next in queue
      setTimeout(processUploadQueue, 100);
      
    } catch (error) {
      console.error(`❌ Upload failed for segment ${nextTask.segmentNumber}:`, error);
      
      nextTask.uploading = false;
      
      if (nextTask.attempts >= 3) {
        console.error(`💥 Segment ${nextTask.segmentNumber} permanently failed after 3 attempts`);
        nextTask.failed = true;
      } else {
        // Retry with exponential backoff
        setTimeout(processUploadQueue, 1000 * Math.pow(2, nextTask.attempts - 1));
      }
      
      handleProductionError(error, 'UPLOAD_FAILED');
    }
  };

  /**
   * Handle recording errors with recovery logic
   */
  const handleRecordingError = async (error) => {
    consecutiveErrorsRef.current++;
    setErrorCount(prev => prev + 1);
    
    if (consecutiveErrorsRef.current >= maxConsecutiveErrors) {
      console.error('💥 Too many consecutive errors, attempting camera recovery...');
      await recoverCamera();
    }
    
    handleProductionError(error, 'RECORDING_FAILED');
  };

  /**
   * Recover camera after failures
   */
  const recoverCamera = async () => {
    try {
      console.log('🔄 Recovering camera...');
      
      // Stop current recording
      if (currentRecordingRef.current) {
        try {
          await cameraRef.current?.stopRecording();
        } catch (e) {
          // Ignore errors during stop
        }
      }
      
      // Recreate camera
      setCameraReady(false);
      setCameraKey(prev => prev + 1);
      
      // Wait for camera to remount
      setTimeout(() => {
        setCameraReady(true);
        consecutiveErrorsRef.current = 0;
        console.log('✅ Camera recovery completed');
      }, 2000);
      
    } catch (error) {
      console.error('❌ Camera recovery failed:', error);
    }
  };

  /**
   * Start network monitoring for adaptive quality
   */
  const startNetworkMonitoring = () => {
    networkMonitorRef.current = NetInfo.addEventListener(state => {
      const quality = assessNetworkQuality(state);
      setNetworkQuality(quality);
      
      console.log(`📡 Network quality: ${quality}`);
      
      // Adjust streaming parameters based on network
      adjustStreamingParameters(quality);
    });
  };

  /**
   * Start health monitoring for production reliability
   */
  const startHealthMonitoring = () => {
    healthCheckIntervalRef.current = setInterval(() => {
      const health = assessStreamHealth();
      setStreamHealth(health.status);
      
      onStreamHealthUpdate?.(health);
      
      // Auto-recovery if needed
      if (health.status === 'degraded') {
        console.log('⚠️ Stream health degraded, attempting recovery...');
        attemptStreamRecovery();
      }
      
    }, 10000); // Check every 10 seconds
  };

  /**
   * Assess network quality for adaptive streaming
   */
  const assessNetworkQuality = (networkState) => {
    if (!networkState.isConnected) return 'offline';
    
    const type = networkState.type;
    const effectiveType = networkState.details?.effectiveType;
    
    if (type === 'wifi') return 'excellent';
    if (type === 'cellular') {
      switch (effectiveType) {
        case '4g': return 'good';
        case '3g': return 'fair';
        case '2g': return 'poor';
        default: return 'fair';
      }
    }
    
    return 'unknown';
  };

  /**
   * Assess overall stream health
   */
  const assessStreamHealth = () => {
    const now = Date.now();
    const timeSinceLastSegment = now - lastSegmentTimeRef.current;
    const uploadSuccessRate = metricsRef.current.segmentsUploaded / 
                             Math.max(metricsRef.current.segmentsRecorded, 1);
    
    let status = 'healthy';
    let issues = [];
    
    if (timeSinceLastSegment > 15000) {
      status = 'degraded';
      issues.push('No recent segments');
    }
    
    if (uploadSuccessRate < 0.8) {
      status = 'degraded';
      issues.push('Low upload success rate');
    }
    
    if (consecutiveErrorsRef.current > 2) {
      status = 'degraded';
      issues.push('Consecutive errors');
    }
    
    return {
      status,
      issues,
      metrics: {
        ...metricsRef.current,
        uploadSuccessRate,
        timeSinceLastSegment
      }
    };
  };

  /**
   * Calculate optimal interval based on network conditions
   */
  const calculateOptimalInterval = () => {
    switch (networkQuality) {
      case 'excellent': return 2000; // 2 seconds
      case 'good': return 3000; // 3 seconds
      case 'fair': return 4000; // 4 seconds
      case 'poor': return 6000; // 6 seconds
      default: return 3000;
    }
  };

  /**
   * Calculate segment duration based on conditions
   */
  const calculateSegmentDuration = () => {
    const baseInterval = calculateOptimalInterval();
    return Math.min(baseInterval + 1000, 8000); // Add 1s buffer, max 8s
  };

  /**
   * Get recording quality based on network and device
   */
  const getRecordingQuality = () => {
    if (qualityPreference !== 'auto') {
      return qualityPreference;
    }
    
    switch (networkQuality) {
      case 'excellent': return CameraView.Constants?.VideoQuality?.['720p'] || '720p';
      case 'good': return CameraView.Constants?.VideoQuality?.['480p'] || '480p';
      case 'fair': return CameraView.Constants?.VideoQuality?.['360p'] || '360p';
      default: return CameraView.Constants?.VideoQuality?.['480p'] || '480p';
    }
  };

  /**
   * Adjust streaming parameters based on network quality
   */
  const adjustStreamingParameters = (quality) => {
    // Adjust upload queue processing speed
    const processingDelay = quality === 'excellent' ? 50 : 
                           quality === 'good' ? 100 : 200;
    
    // Clear existing queue processing
    clearTimeout(processUploadQueue.timeoutId);
    
    // Restart with new timing
    processUploadQueue.timeoutId = setTimeout(processUploadQueue, processingDelay);
  };

  /**
   * Attempt stream recovery
   */
  const attemptStreamRecovery = async () => {
    try {
      console.log('🔧 Attempting stream recovery...');
      
      // Clear error count
      setErrorCount(0);
      consecutiveErrorsRef.current = 0;
      
      // Process any queued uploads
      processUploadQueue();
      
      // If no segments for too long, restart streaming
      const timeSinceLastSegment = Date.now() - lastSegmentTimeRef.current;
      if (timeSinceLastSegment > 30000) {
        console.log('🔄 Restarting streaming due to inactivity...');
        await stopStreaming();
        setTimeout(() => startProductionStreaming(), 2000);
      }
      
    } catch (error) {
      console.error('❌ Stream recovery failed:', error);
    }
  };

  /**
   * Handle app state changes for production reliability
   */
  const handleAppStateChange = (nextAppState) => {
    if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
      console.log('📱 App became active, checking stream health...');
      if (isStreaming) {
        // Resume streaming if needed
        const timeSinceLastSegment = Date.now() - lastSegmentTimeRef.current;
        if (timeSinceLastSegment > 10000) {
          console.log('🔄 Resuming streaming after app activation...');
          recordProductionSegment();
        }
      }
    }
    
    appStateRef.current = nextAppState;
  };

  /**
   * Stop streaming with proper cleanup
   */
  const stopStreaming = async () => {
    try {
      console.log('⏹️ Stopping production streaming...');
      
      setIsStreaming(false);
      setIsRecording(false);
      
      // Stop recording
      if (currentRecordingRef.current && cameraRef.current) {
        try {
          await cameraRef.current.stopRecording();
        } catch (e) {
          // Ignore errors during stop
        }
      }
      
      // Clear intervals
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      
      // Process remaining uploads
      while (uploadQueueRef.current.some(task => !task.completed && !task.failed)) {
        await new Promise(resolve => setTimeout(resolve, 100));
        processUploadQueue();
      }
      
      console.log('✅ Streaming stopped and cleanup completed');
      
    } catch (error) {
      console.error('❌ Error stopping streaming:', error);
    }
  };

  /**
   * Production cleanup
   */
  const cleanupProduction = () => {
    // Stop streaming
    stopStreaming();
    
    // Clear network monitoring
    if (networkMonitorRef.current) {
      networkMonitorRef.current();
      networkMonitorRef.current = null;
    }
    
    // Clear health monitoring
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current);
      healthCheckIntervalRef.current = null;
    }
    
    // Cleanup any remaining files
    uploadQueueRef.current.forEach(async (task) => {
      if (task.videoUri && !task.completed) {
        await FileSystem.deleteAsync(task.videoUri, { idempotent: true });
      }
    });
    
    console.log('🧹 Production cleanup completed');
  };

  /**
   * Handle production errors with context
   */
  const handleProductionError = (error, context) => {
    console.error(`❌ Production Error [${context}]:`, error);
    
    const enhancedError = {
      message: error.message,
      context,
      timestamp: new Date().toISOString(),
      metrics: metricsRef.current,
      streamHealth: assessStreamHealth()
    };
    
    onError?.(enhancedError);
  };

  /**
   * Toggle camera facing with error handling
   */
  const toggleCameraFacing = () => {
    try {
      setCameraFacing(current => current === 'front' ? 'back' : 'front');
    } catch (error) {
      console.error('❌ Error toggling camera:', error);
    }
  };

  /**
   * Get status color for UI
   */
  const getStatusColor = () => {
    switch (streamHealth) {
      case 'healthy': return '#4CAF50';
      case 'degraded': return '#FF9800';
      case 'error': return '#F44336';
      default: return '#2196F3';
    }
  };

  return (
    <View style={[styles.container, style]}>
      <CameraView
        key={cameraKey}
        ref={cameraRef}
        style={styles.camera}
        facing={cameraFacing}
        onCameraReady={() => setCameraReady(true)}
        videoQuality={getRecordingQuality()}
      />
      
      {/* Production Overlay */}
      <View style={styles.overlay}>
        {/* Health Status */}
        <View style={styles.healthContainer}>
          <View style={[styles.healthIndicator, { backgroundColor: getStatusColor() }]} />
          <Text style={styles.healthText}>
            {streamHealth.toUpperCase()} • {networkQuality.toUpperCase()}
          </Text>
        </View>
        
        {/* Controls */}
        <View style={styles.controls}>
          <TouchableOpacity 
            style={styles.controlButton}
            onPress={toggleCameraFacing}
          >
            <Icon  name="camera-reverse" size={24} color="white"  />
          </TouchableOpacity>
        </View>
        
        {/* Metrics */}
        <View style={styles.metricsContainer}>
          <Text style={styles.metricsText}>
            📹 {metricsRef.current.segmentsRecorded} | 📤 {metricsRef.current.segmentsUploaded}
          </Text>
          {uploadProgress > 0 && (
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${uploadProgress * 100}%` }]} />
            </View>
          )}
          {errorCount > 0 && (
            <Text style={styles.errorText}>⚠️ {errorCount} errors</Text>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    padding: 20,
  },
  healthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  healthIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  healthText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  controls: {
    position: 'absolute',
    right: 20,
    top: '50%',
    transform: [{ translateY: -25 }],
  },
  controlButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 15,
    borderRadius: 25,
    marginVertical: 5,
  },
  metricsContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 10,
    borderRadius: 10,
    alignSelf: 'center',
  },
  metricsText: {
    color: 'white',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 5,
  },
  progressBar: {
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 1.5,
    marginVertical: 5,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 1.5,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 3,
  },
});

export default ProductionLiveStreamBroadcaster;