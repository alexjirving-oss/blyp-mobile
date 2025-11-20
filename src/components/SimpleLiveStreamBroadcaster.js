/**
 * Quick Live Streaming Fix for "APK Module Stream Health degraded"
 * 
 * This addresses the most common causes of streaming health issues
 */

import React, { useState, useRef, useEffect } from 'react';
import Icon from './Icon';
import { View, Text, Alert, TouchableOpacity, StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import ScalableHLSService from '../services/ScalableHLSService';

const SimpleLiveStreamBroadcaster = ({ 
  streamId, 
  onSegmentUploaded, 
  onError, 
  style 
}) => {
  const cameraRef = useRef(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [debugInfo, setDebugInfo] = useState('Initializing...');
  
  // Simplified segment counter
  const segmentCount = useRef(0);
  const uploadInterval = useRef(null);

  // Super simple camera ready handler
  const handleCameraReady = () => {
    console.log('📹 Camera is ready!');
    setCameraReady(true);
    setDebugInfo('Camera ready - tap Start to stream');
  };

  // FIXED: Actually upload segments to Firebase
  const recordSimpleSegment = async () => {
    if (!cameraRef.current || !cameraReady) {
      console.log('⚠️ Camera not ready for recording');
      return null;
    }

    try {
      console.log('🎬 Recording segment', segmentCount.current);
      setDebugInfo(`Recording segment ${segmentCount.current}...`);
      
      // Simple recording with basic options
      const result = await cameraRef.current.recordAsync({
        quality: '480p',
        maxDuration: 2, // 2 second segments
        mute: false
      });

      if (result && result.uri) {
        console.log('✅ Recording successful:', result.uri);
        setDebugInfo('Segment recorded, uploading...');
        
        // FIXED: Actually upload to Firebase using ScalableHLSService
        try {
          const uploadResult = await ScalableHLSService.uploadSegment(
            streamId,
            result.uri,
            segmentCount.current,
            {
              quality: '480p',
              timestamp: Date.now(),
              debugInfo: 'Simple Broadcaster Upload'
            }
          );
          
          console.log('✅ Upload successful for segment', segmentCount.current);
          setDebugInfo('Segment uploaded successfully');
          onSegmentUploaded?.(segmentCount.current, uploadResult);
          segmentCount.current++;
          
        } catch (uploadError) {
          console.error('❌ Upload error:', uploadError);
          setDebugInfo(`Upload failed: ${uploadError.message}`);
          onError?.(uploadError);
        }
        
        return result.uri;
      }
    } catch (error) {
      console.error('❌ Recording error:', error);
      setDebugInfo(`Recording failed: ${error.message}`);
      onError?.(error);
      return null;
    }
  };

  // Start simple streaming
  const startSimpleStreaming = () => {
    if (!cameraReady) {
      Alert.alert('Camera Not Ready', 'Please wait for camera to initialize');
      return;
    }

    console.log('🚀 Starting simple streaming...');
    setIsStreaming(true);
    setDebugInfo('Streaming started!');
    
    // Record every 3 seconds
    uploadInterval.current = setInterval(recordSimpleSegment, 3000);
  };

  // Stop streaming
  const stopSimpleStreaming = () => {
    console.log('⏹️ Stopping streaming...');
    setIsStreaming(false);
    setDebugInfo('Streaming stopped');
    
    if (uploadInterval.current) {
      clearInterval(uploadInterval.current);
      uploadInterval.current = null;
    }
  };

  // Cleanup
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
      
      {/* Debug Overlay */}
      <View style={styles.debugOverlay}>
        <Text style={styles.debugText}>{debugInfo}</Text>
        <Text style={styles.segmentText}>Segments: {segmentCount.current}</Text>
        
        {/* Simple Controls */}
        <View style={styles.controls}>
          {!isStreaming ? (
            <TouchableOpacity 
              style={[styles.button, styles.startButton]} 
              onPress={startSimpleStreaming}
              disabled={!cameraReady}
            >
              <Icon  name="play" size={20} color="white"  />
              <Text style={styles.buttonText}>Start</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={[styles.button, styles.stopButton]} 
              onPress={stopSimpleStreaming}
            >
              <Icon  name="stop" size={20} color="white"  />
              <Text style={styles.buttonText}>Stop</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      
      {/* Camera Ready Indicator */}
      <View style={[styles.statusIndicator, cameraReady ? styles.ready : styles.notReady]}>
        <Text style={styles.statusText}>
          {cameraReady ? '✅ Ready' : '⏳ Initializing...'}
        </Text>
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
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 15,
    borderRadius: 10,
  },
  debugText: {
    color: 'white',
    fontSize: 14,
    marginBottom: 5,
  },
  segmentText: {
    color: '#00ff00',
    fontSize: 12,
    fontWeight: 'bold',
  },
  controls: {
    marginTop: 10,
    alignItems: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 20,
    gap: 5,
  },
  startButton: {
    backgroundColor: '#00aa00',
  },
  stopButton: {
    backgroundColor: '#aa0000',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  statusIndicator: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    padding: 8,
    borderRadius: 15,
  },
  ready: {
    backgroundColor: 'rgba(0, 170, 0, 0.8)',
  },
  notReady: {
    backgroundColor: 'rgba(170, 170, 0, 0.8)',
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
});

export default SimpleLiveStreamBroadcaster;