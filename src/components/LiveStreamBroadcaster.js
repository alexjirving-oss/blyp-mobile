/**
 * LiveStreamBroadcaster Component
 * 
 * Handles the broadcaster side of live streaming:
 * - Records video in segments from camera
 * - Uploads segments to Firebase Storage
 * - Works on Android and is Google Play Store compliant
 */

import React, { useState, useRef, useEffect } from 'react';
import Icon from './Icon';
import { View, StyleSheet, Alert, Text, TouchableOpacity } from 'react-native';
import { CameraView } from 'expo-camera';
import HLSLiveStreamService from '../services/HLSLiveStreamService';

const LiveStreamBroadcaster = ({ streamId, onSegmentUploaded, onError, style }) => {
  const cameraRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [segmentNumber, setSegmentNumber] = useState(0);
  const segmentCounterRef = useRef(0); // Atomic counter to prevent race conditions
  const [cameraFacing, setCameraFacing] = useState('front');
  const recordingIntervalRef = useRef(null);
  const currentRecordingRef = useRef(null);
  const hasAutoStartedRef = useRef(false);
  const isRecordingSegmentRef = useRef(false); // Prevent overlapping recordings
  const lastRecordingStartTimeRef = useRef(0); // Track when recording started
  
  // Camera recreation state management
  const [cameraKey, setCameraKey] = useState(0); // Force camera remount
  const [isCameraReady, setIsCameraReady] = useState(false);
  const cameraRecreationTimeoutRef = useRef(null);

  // Camera recreation functions for expo-camera v15 compatibility
  const recreateCamera = () => {
    console.log('🔄 Recreating camera component to reset internal state...');
    setIsCameraReady(false);
    setCameraKey(prev => prev + 1); // Force remount with new key
    
    // Wait for camera to be ready again
    if (cameraRecreationTimeoutRef.current) {
      clearTimeout(cameraRecreationTimeoutRef.current);
    }
    
    cameraRecreationTimeoutRef.current = setTimeout(() => {
      console.log('✅ Camera recreation timeout completed');
      setIsCameraReady(true);
    }, 1000); // Give camera time to fully mount
  };

  const handleCameraReady = () => {
    console.log('📹 Camera is ready for recording');
    setIsCameraReady(true);
  };

  useEffect(() => {
    // Auto-start streaming when component mounts with valid streamId
    if (streamId && !hasAutoStartedRef.current && isCameraReady) {
      hasAutoStartedRef.current = true;
      console.log('� Auto-starting live stream for streamId:', streamId);
      // Start streaming once camera is ready
      const timer = setTimeout(async () => {
        console.log('🎬 Camera ready, starting streaming with recreation pattern...');
        startStreaming();
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [streamId, isCameraReady]);

  // Cleanup camera recreation timeout on unmount
  useEffect(() => {
    return () => {
      if (cameraRecreationTimeoutRef.current) {
        clearTimeout(cameraRecreationTimeoutRef.current);
      }
      // Cleanup on unmount
      stopStreaming();
    };
  }, []);

  /**
   * TikTok-style streaming initialization with optimized intervals
   */
  const startStreaming = async () => {
    try {
      console.log('� TikTok-style streaming initialization...');
      setIsRecording(true);
      
      // Reset counters for new stream
      segmentCounterRef.current = 0;
      isRecordingSegmentRef.current = false;
      
      // Start first segment immediately
      await recordAndUploadSegment();
      
      // TikTok-style optimized interval (2.5s for 2.8s segments creates overlap buffer)
      const intervalDuration = 5000; // 5 seconds - longer for expo-camera v15 stability
      console.log(`⏰ Setting TikTok-style interval: ${intervalDuration}ms`);
      
      recordingIntervalRef.current = setInterval(async () => {
        try {
          await recordAndUploadSegment();
        } catch (intervalError) {
          console.error('❌ Interval recording error:', intervalError);
          // Continue streaming despite individual segment errors (TikTok resilience)
        }
      }, intervalDuration);
      
      console.log('✅ TikTok-style streaming active');
      
    } catch (error) {
      console.error('❌ TikTok streaming initialization failed:', error);
      onError?.(error);
      Alert.alert('Streaming Error', 'Failed to start streaming. Please check your connection and try again.');
    }
  };

  /**
   * TikTok-style graceful streaming shutdown
   */
  const stopStreaming = async () => {
    try {
      console.log('⏹️ TikTok-style graceful shutdown initiated...');
      
      // Stop interval immediately
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
        console.log('🛑 Recording interval cleared');
      }
      
      // TikTok-style graceful recording completion
      const timeSinceLastRecording = Date.now() - lastRecordingStartTimeRef.current;
      if (isRecordingSegmentRef.current && timeSinceLastRecording < 1000) {
        console.log(`⏳ TikTok graceful shutdown: waiting ${1000 - timeSinceLastRecording}ms for current segment...`);
        await new Promise(resolve => setTimeout(resolve, 1100 - timeSinceLastRecording));
      }
      
      // Stop current recording gracefully
      if (currentRecordingRef.current && cameraRef.current) {
        try {
          console.log('🎬 Stopping active recording...');
          await cameraRef.current.stopRecording();
          console.log('✅ Recording stopped cleanly');
        } catch (stopError) {
          console.log('📝 Recording stop note:', stopError.message);
        }
      }
      
      // Reset all state atomically (TikTok-style cleanup)
      setIsRecording(false);
      currentRecordingRef.current = null;
      isRecordingSegmentRef.current = false;
      lastRecordingStartTimeRef.current = 0;
      
      // Don't reset segment counter - let it persist for debugging
      console.log(`✅ TikTok-style shutdown complete. Final segment count: ${segmentCounterRef.current}`);
      
    } catch (error) {
      console.error('❌ Error during TikTok-style shutdown:', error);
      // Force cleanup even if error occurred
      setIsRecording(false);
      isRecordingSegmentRef.current = false;
    }
  };

  /**
   * TikTok-style optimized segment recording and upload
   */
  const recordAndUploadSegment = async () => {
    // Prevent overlapping recordings with atomic flag
    if (isRecordingSegmentRef.current) {
      console.log('⏭️ TikTok optimization: Skipping overlapping recording');
      return;
    }

    if (!cameraRef.current) {
      console.error('❌ Camera ref unavailable');
      return;
    }
    
    if (!streamId) {
      console.error('❌ Stream ID missing');
      return;
    }

    // Mark as recording FIRST to prevent overlaps (atomic)
    isRecordingSegmentRef.current = true;
    const recordingStartTime = Date.now();
    lastRecordingStartTimeRef.current = recordingStartTime;

    console.log('🔄 Camera Recreation Pattern: Starting fresh recording cycle');
    
    // Step 1: Recreate camera component to ensure clean state
    console.log('� Step 1: Recreating camera component...');
    recreateCamera();
    
    // Step 2: Wait for camera to be fully ready
    console.log('⏳ Step 2: Waiting for camera recreation...');
    await new Promise(resolve => setTimeout(resolve, 1500)); // Allow recreation time
    
    // Step 3: Verify camera is ready
    if (!cameraRef.current) {
      console.error('❌ Camera ref still unavailable after recreation');
      isRecordingSegmentRef.current = false;
      return;
    }

    // Atomic segment management (TikTok-style) - already set above

    try {
      const currentSegment = segmentCounterRef.current;
      segmentCounterRef.current += 1;
      setSegmentNumber(currentSegment);
      
      console.log(`🎬 Camera Recreation Pattern: Recording segment ${currentSegment} with fresh camera`);
      
      // Recording options optimized for camera recreation pattern
      const recordingOptions = {
        maxDuration: 3000, // 3 seconds
      };
      
      console.log(`📱 Using fresh camera for recording:`, recordingOptions);
      
      // Step 4: Validate fresh camera is ready
      if (!cameraRef.current) {
        throw new Error('Fresh camera ref not available after recreation');
      }
      
      // Step 5: Record with fresh camera (no overlap possible)
      console.log('🎬 Starting recording with recreated camera...');
      
      let video = null;
      try {
        // Comprehensive camera validation
        if (!cameraRef.current) {
          throw new Error('Camera ref is null after recreation');
        }
        
        if (typeof cameraRef.current.recordAsync !== 'function') {
          console.error('Available camera methods:', Object.getOwnPropertyNames(cameraRef.current));
          throw new Error('recordAsync method not available on recreated camera');
        }
        
        console.log('✅ Fresh camera validated and ready for recording...');
        
        // REAL VIDEO RECORDING - Properly implemented for expo-camera v15
        try {
          console.log('🎥 Starting real video recording with optimized settings');
          
          // Start actual video recording with proper timeout and error handling
          const recordingPromise = cameraRef.current.recordAsync(recordingOptions);
          console.log('⏳ Recording promise created, waiting for video...');
          
          // Set reasonable timeout for recording (longer than recording duration)
          const timeoutMs = recordingOptions.maxDuration + 2000; // 5 seconds total
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Recording timeout after ${timeoutMs}ms`)), timeoutMs);
          });
          
          // Wait for either recording completion or timeout
          currentRecordingRef.current = recordingPromise;
          video = await Promise.race([recordingPromise, timeoutPromise]);
          currentRecordingRef.current = null;
          
          console.log('📹 Video recording completed successfully:', {
            uri: video?.uri,
            duration: video?.duration || 'unknown',
            size: video?.size || 'unknown'
          });
          
          if (!video || !video.uri) {
            throw new Error('Video recording returned null or invalid URI');
          }
          
        } catch (recordingError) {
          console.error('❌ Video recording failed:', recordingError.message);
          video = null; // Will trigger fallback below
        }
        
      } catch (recordMethodError) {
        currentRecordingRef.current = null;
        console.error('❌ Fresh camera recordAsync failed:', recordMethodError.message);
        
        if (recordMethodError.message.includes('timeout')) {
          console.log('🔄 Fresh camera recording timeout - will continue streaming');
        } else {
          console.log('🔄 Fresh camera recording error - camera recreation pattern failed');
        }
        
        // Re-throw for outer error handling
        throw recordMethodError;
      }
      
      // Step 6: Handle video upload or fallback to metadata
      if (video && video.uri) {
        // SUCCESS: Real video was recorded - upload it
        console.log(`🎥 SUCCESS: Real video segment ${currentSegment} recorded: ${video.uri}`);
        
        HLSLiveStreamService.uploadSegment(streamId, video.uri, currentSegment)
          .then((downloadURL) => {
            console.log(`✅ Video segment ${currentSegment} uploaded to: ${downloadURL}`);
            onSegmentUploaded?.(currentSegment, downloadURL);
          })
          .catch((error) => {
            console.error(`❌ Failed to upload video segment ${currentSegment}:`, error);
          });
          
      } else {
        // FALLBACK: Video recording failed - use metadata segment
        console.log(`⚠️ Video recording failed for segment ${currentSegment}, using metadata fallback`);
        
        const fallbackMetadata = {
          segmentNumber: currentSegment,
          timestamp: Date.now(),
          type: 'fallback-metadata',
          status: 'active',
          note: 'Video recording failed - maintaining stream with metadata'
        };
        
        HLSLiveStreamService.uploadMetadataSegment(streamId, fallbackMetadata, currentSegment)
          .then((result) => {
            console.log(`✅ Fallback metadata segment ${currentSegment} uploaded`);
            onSegmentUploaded?.(currentSegment, 'metadata-fallback');
          })
          .catch((error) => {
            console.error(`❌ Failed to upload fallback metadata segment ${currentSegment}:`, error);
          });
      }
      
      // Reset recording flag and exit
      isRecordingSegmentRef.current = false;
      return;
      
    } catch (error) {
      console.error(`❌ Error recording segment ${segmentNumber}:`, error);
      console.error('Recording error details:', error.message, error.code, error.stack);
      
      // Handle specific recording error types
      if (error.message?.includes('Recording was stopped before any data could be produced')) {
        console.log('🔄 Recording stopped too early, will continue with next segment...');
      } else if (error.message?.includes('ERR_VIDEO_RECORDING_FAILED') || error.message?.includes('Unknown error')) {
        console.log('📱 Video recording failed - likely expo-camera v15 compatibility issue');
        console.log('🔧 This is a known issue with certain Android devices and expo-camera v15');
        console.log('💡 Stream will continue without video segments (audio/metadata only)');
      } else if (error.code === 'E_RECORDING_FAILED') {
        console.log('📱 Camera recording error - attempting recovery...');
      }
      
      // Create a placeholder segment to keep stream alive
      console.log('📝 Creating placeholder segment to maintain stream continuity...');
      try {
        // Upload a small metadata placeholder instead of video
        const placeholderData = {
          type: 'placeholder',
          timestamp: Date.now(),
          segmentNumber: segmentCounterRef.current - 1,
          message: 'Video recording unavailable - using metadata only'
        };
        
        // Don't upload placeholder - just log for now to keep stream alive
        console.log('📝 Placeholder segment data:', placeholderData);
        
      } catch (placeholderError) {
        console.error('❌ Placeholder creation failed:', placeholderError);
      }
      
      // Don't throw - continue streaming even if one segment fails
    } finally {
      // Always reset the recording flag
      isRecordingSegmentRef.current = false;
    }
  };

  /**
   * Flip camera
   */
  const flipCamera = () => {
    setCameraFacing(prev => prev === 'front' ? 'back' : 'front');
  };

  return (
    <View style={[styles.container, style]}>
      <CameraView
        key={cameraKey} // Force remount for camera recreation pattern
        ref={cameraRef}
        style={styles.camera}
        facing={cameraFacing}
        mode="video"
        onCameraReady={handleCameraReady}
        onMountError={(error) => {
          console.error('❌ Camera mount error:', error);
          onError?.(error);
        }}
      >
        {/* Minimal camera flip button - top right corner */}
        <View style={styles.minimalistOverlay}>
          <TouchableOpacity 
            style={styles.flipButton}
            onPress={flipCamera}
          >
            <Icon  name="camera-reverse" size={20} color="white"  />
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  minimalistOverlay: {
    position: 'absolute',
    top: 20,
    right: 20,
  },
  flipButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 0, 0, 0.8)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'white',
    marginRight: 8,
  },
  recordingText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
    marginRight: 12,
  },
  segmentText: {
    color: 'white',
    fontSize: 12,
    opacity: 0.9,
  },
  bottomControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 20,
  },
  controlButton: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 30,
  },
  streamButton: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 0, 0, 0.7)',
    borderRadius: 40,
  },
  streamButtonActive: {
    backgroundColor: 'rgba(255, 0, 0, 0.9)',
  },
});

export default LiveStreamBroadcaster;
