/**
 * ULTRA SIMPLE Live Stream Broadcaster - Debug Version
 * 
 * This is a stripped-down version that DEFINITELY shows debug info
 */

import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { CameraView } from 'expo-camera';

const UltraSimpleBroadcaster = ({ 
  streamId, 
  onSegmentUploaded, 
  onError, 
  style 
}) => {
  const cameraRef = useRef(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [debugInfo, setDebugInfo] = useState('🔧 Component loaded!');
  const [segmentCount, setSegmentCount] = useState(0);
  
  const uploadInterval = useRef(null);

  // Initialize component
  useEffect(() => {
    console.log('🚀 UltraSimpleBroadcaster mounted with streamId:', streamId);
    setDebugInfo('🔧 Component mounted, waiting for camera...');
  }, []);

  // Camera ready handler
  const handleCameraReady = () => {
    console.log('📹 Camera is ready!');
    setCameraReady(true);
    setDebugInfo('✅ Camera ready! Tap START to begin streaming');
  };

  // ACTUALLY RECORD AND UPLOAD SEGMENTS
  const recordAndUploadSegment = async () => {
    if (!cameraRef.current || !cameraReady) {
      console.log('⚠️ Camera not ready for recording');
      return;
    }

    try {
      const currentCount = segmentCount + 1;
      console.log('🎬 Recording segment', currentCount);
      setDebugInfo(`🎬 Recording segment ${currentCount}...`);
      
      // Actually record video
      const result = await cameraRef.current.recordAsync({
        quality: '480p',
        maxDuration: 3, // 3 second segments
        mute: false
      });

      if (result && result.uri) {
        console.log('✅ Recording successful:', result.uri);
        setDebugInfo(`📤 Uploading segment ${currentCount}...`);
        
        // Import ScalableHLSService dynamically to upload
        const ScalableHLSService = require('../services/ScalableHLSService').default;
        
        // Actually upload to Firebase
        const uploadResult = await ScalableHLSService.uploadSegment(
          streamId,
          result.uri,
          currentCount,
          {
            quality: '480p',
            timestamp: Date.now(),
            debugInfo: 'Ultra Broadcaster Upload'
          }
        );
        
        setSegmentCount(currentCount);
        setDebugInfo(`✅ Segment ${currentCount} uploaded successfully!`);
        console.log(`✅ Segment ${currentCount} uploaded:`, uploadResult);
        
        // Call the callback with real URL
        if (onSegmentUploaded) {
          onSegmentUploaded(currentCount, uploadResult);
        }
        
      } else {
        setDebugInfo(`❌ Recording failed - no result`);
      }
    } catch (error) {
      console.error('❌ Recording/Upload error:', error);
      setDebugInfo(`❌ Error: ${error.message}`);
      if (onError) {
        onError(error);
      }
    }
  };

  // Start streaming
  const startStreaming = () => {
    if (!cameraReady) {
      Alert.alert('Camera Not Ready', 'Please wait for camera to initialize');
      return;
    }

    console.log('🚀 Starting streaming for streamId:', streamId);
    setIsStreaming(true);
    setDebugInfo('🔴 STREAMING ACTIVE - RECORDING REAL VIDEO');
    
    // Actually record and upload segments every 4 seconds
    uploadInterval.current = setInterval(recordAndUploadSegment, 4000);
  };

  // Stop streaming
  const stopStreaming = () => {
    console.log('⏹️ Stopping streaming');
    setIsStreaming(false);
    setDebugInfo('⏸️ Streaming stopped');
    
    if (uploadInterval.current) {
      clearInterval(uploadInterval.current);
      uploadInterval.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (uploadInterval.current) {
        clearInterval(uploadInterval.current);
      }
    };
  }, []);

  return (
    <View style={[styles.container, style]}>
      {/* Camera View */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="front"
        onCameraReady={handleCameraReady}
      />
      
      {/* MASSIVE DEBUG OVERLAY - IMPOSSIBLE TO MISS */}
      <View style={styles.debugOverlay}>
        <Text style={styles.debugTitle}>🔥 ULTRA DEBUG MODE 🔥</Text>
        <Text style={styles.debugText}>Stream ID: {streamId}</Text>
        <Text style={styles.debugText}>Status: {debugInfo}</Text>
        <Text style={styles.debugText}>Segments: {segmentCount}</Text>
        <Text style={styles.debugText}>Camera Ready: {cameraReady ? '✅ YES' : '❌ NO'}</Text>
        <Text style={styles.debugText}>Streaming: {isStreaming ? '🔴 LIVE' : '⚫ OFF'}</Text>
        
        {/* Big obvious buttons */}
        <View style={styles.buttonContainer}>
          {!isStreaming ? (
            <TouchableOpacity 
              style={styles.startButton} 
              onPress={startStreaming}
              disabled={!cameraReady}
            >
              <Text style={styles.buttonText}>
                {cameraReady ? '🚀 START STREAMING' : '⏳ WAITING...'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={styles.stopButton} 
              onPress={stopStreaming}
            >
              <Text style={styles.buttonText}>⏹️ STOP STREAMING</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
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
  debugOverlay: {
    position: 'absolute',
    top: 50,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(255, 0, 0, 0.9)', // BRIGHT RED - IMPOSSIBLE TO MISS
    padding: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#fff',
    zIndex: 9999, // MAKE SURE IT'S ON TOP
  },
  debugTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  debugText: {
    color: 'white',
    fontSize: 14,
    marginBottom: 5,
    fontWeight: 'bold',
  },
  buttonContainer: {
    marginTop: 15,
    alignItems: 'center',
  },
  startButton: {
    backgroundColor: '#00ff00',
    padding: 15,
    borderRadius: 25,
    minWidth: 200,
  },
  stopButton: {
    backgroundColor: '#ff0000',
    padding: 15,
    borderRadius: 25,
    minWidth: 200,
  },
  buttonText: {
    color: 'black',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

export default UltraSimpleBroadcaster;