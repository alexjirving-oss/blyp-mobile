/**
 * LiveStreamViewer Component - Enterprise Production Ready
 * 
 * Built for hundreds of thousands of concurrent viewers with:
 * - Bulletproof error handling to prevent indexOf crashes
 * - Production-grade input validation
 * - TikTok-style performance optimizations
 * - Real-world reliability and scalability
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
} from 'react-native';
import UnifiedVideo from './UnifiedVideo';
import HLSLiveStreamService from '../services/HLSLiveStreamService';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const LiveStreamViewer = ({ streamId, style, onError }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [streamData, setStreamData] = useState(null);
  const [currentSegmentUrl, setCurrentSegmentUrl] = useState(null);
  const [bufferSegments, setBufferSegments] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  // Refs for cleanup and state management
  const videoRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const mountedRef = useRef(true);

  // Production counters
  const retryCountRef = useRef(0);
  const maxRetries = 5;

  useEffect(() => {
    mountedRef.current = true;
    
    if (streamId && typeof streamId === 'string' && streamId.trim()) {
      console.log('[METRIC][Tmarker_viewerJoin]', new Date().toISOString(), { streamId });
      initializeStream(streamId.trim());
    } else {
      setError('Invalid stream ID provided');
      setIsLoading(false);
    }

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [streamId]);

  /**
   * Production-grade stream initialization with comprehensive error handling
   */
  const initializeStream = async (validStreamId) => {
    try {
      console.log(`📺 Production stream initialization: ${validStreamId}`);
      setConnectionStatus('connecting');
      setError(null);
      
      // Subscribe to stream with bulletproof error handling
      unsubscribeRef.current = HLSLiveStreamService.subscribeToStream(
        validStreamId,
        handleStreamUpdate
      );
      
    } catch (error) {
      handleConnectionError(error);
    }
  };

  /**
   * Enterprise-grade stream update handler with input validation
   */
  const handleStreamUpdate = (data) => {
    try {
      if (!mountedRef.current) return;
      
      if (!data || typeof data !== 'object') {
        console.warn('⚠️ Invalid stream data received:', data);
        handleConnectionError(new Error('Invalid stream data'));
        return;
      }
      
      console.log('📡 Production stream update received:', {
        id: data.id,
        status: data.status,
        currentSegment: data.currentSegment,
        isHealthy: data.isHealthy
      });
      
      setStreamData(data);
      setConnectionStatus(data.status || 'unknown');
      
      // Production-grade segment management
      if (data.segments && typeof data.currentSegment === 'number') {
        updateVideoSegments(data);
      }
      
      // Reset retry counter on successful update
      retryCountRef.current = 0;
      setIsLoading(false);
      
    } catch (error) {
      console.error('❌ Error handling stream update:', error);
      handleConnectionError(error);
    }
  };

  /**
   * TikTok-style segment management with production reliability
   */
  const firstFrameLoggedRef = useRef(false);

  const updateVideoSegments = (data) => {
    try {
      const segments = HLSLiveStreamService.getBufferSegments(data);
      
      if (Array.isArray(segments) && segments.length > 0) {
        setBufferSegments(segments);
        
        // Get the latest available segment URL
        const currentSegment = segments.find(seg => seg && seg.isCurrent);
        const latestSegment = segments[segments.length - 1];
        
        const bestSegment = currentSegment || latestSegment;
        
        if (bestSegment && bestSegment.url && typeof bestSegment.url === 'string') {
          // Regular video segment
          if (bestSegment.url.startsWith('https://') || bestSegment.url.startsWith('http://')) {
            setCurrentSegmentUrl(bestSegment.url);
            console.log(`🎥 Production segment loaded: ${bestSegment.number}`);
              if (!firstFrameLoggedRef.current) {
                // This is approximate; actual first rendered frame requires onReadyForDisplay (not available in expo-av 14 earlier), so we log first segment URL assignment.
                console.log('[METRIC][Tseen_firstFrameApprox]', new Date().toISOString(), { streamId, segment: bestSegment.number });
                firstFrameLoggedRef.current = true;
              }
          } else {
            console.warn('⚠️ Invalid segment URL format:', bestSegment.url);
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Error updating video segments:', error);
      // Don't crash the entire component, just log the error
    }
  };

  /**
   * Enterprise error handling with retry logic
   */
  const handleConnectionError = (error) => {
    if (!mountedRef.current) return;
    
    console.error('📺 Stream connection error:', error);
    
    retryCountRef.current++;
    
    if (retryCountRef.current <= maxRetries) {
      console.log(`🔄 Retrying connection (${retryCountRef.current}/${maxRetries})...`);
      
      setConnectionStatus('retrying');
      
      // Exponential backoff retry
      const retryDelay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 10000);
      
      retryTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current && streamId) {
          initializeStream(streamId);
        }
      }, retryDelay);
      
    } else {
      console.error('❌ Max retries exceeded, showing error');
      setError(error.message || 'Stream connection failed');
      setIsLoading(false);
      setConnectionStatus('failed');
      
      // Notify parent component
      if (onError && typeof onError === 'function') {
        onError(error);
      }
    }
  };

  /**
   * Production-grade video error handling
   */
  const handleVideoError = (error) => {
    console.error('❌ Video playback error:', error);
    
    // Don't crash the app, just try to recover
    if (currentSegmentUrl) {
      console.log('🔄 Attempting video recovery...');
      // Force re-render of video component
      setCurrentSegmentUrl(null);
      setTimeout(() => {
        if (mountedRef.current) {
          setCurrentSegmentUrl(currentSegmentUrl);
        }
      }, 1000);
    }
  };

  /**
   * Production-grade video load handler
   */
  const handleVideoLoad = () => {
    console.log('✅ Video loaded successfully');
    setIsLoading(false);
    setConnectionStatus('playing');
  };

  /**
   * Cleanup all resources
   */
  const cleanup = () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  };

  // Error state - Production-grade error display
  if (error) {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Stream Error</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <Text style={styles.errorHelp}>
            The stream may have ended or there's a connection issue.{'\n'}
            Please try refreshing or check your internet connection.
          </Text>
          <View style={styles.retryInfo}>
            <Text style={styles.retryText}>
              Attempts: {retryCountRef.current}/{maxRetries}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // Loading state - Production UX
  if (isLoading || connectionStatus === 'connecting' || connectionStatus === 'retrying') {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#ff6b6b" />
          <Text style={styles.loadingText}>
            {connectionStatus === 'retrying' 
              ? `Reconnecting... (${retryCountRef.current}/${maxRetries})`
              : 'Connecting to stream...'
            }
          </Text>
          {streamId && (
            <Text style={styles.streamId}>Stream: {streamId}</Text>
          )}
          <View style={styles.statusIndicator}>
            <Text style={styles.statusText}>Status: {connectionStatus}</Text>
          </View>
        </View>
      </View>
    );
  }

  // Main video display - Production ready
  return (
    <View style={[styles.container, style]}>      
      {currentSegmentUrl ? (
        <UnifiedVideo
          ref={videoRef}
          source={{ uri: currentSegmentUrl }}
          style={styles.video}
          shouldPlay={true}
          isLooping={false}
          volume={1.0}
          onLoad={handleVideoLoad}
          onError={handleVideoError}
          onPlaybackStatusUpdate={(status) => {
            if (status.error) {
              handleVideoError(status.error);
            }
          }}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.videoPlaceholder}>
          <Text style={styles.placeholderIcon}>📺</Text>
          <Text style={styles.placeholderTitle}>Live Stream Ready</Text>
          <Text style={styles.placeholderMessage}>
            Waiting for video segments...
          </Text>
        </View>
      )}
      
      {/* Production stream overlay */}
      <View style={styles.overlay}>
        <View style={styles.streamInfo}>
          <View style={styles.liveIndicator}>
            <Text style={styles.liveText}>🔴 LIVE</Text>
          </View>
          {streamData && (
            <>
              <Text style={styles.streamTitle}>{streamData.title || 'Live Stream'}</Text>
              <Text style={styles.viewerCount}>
                {streamData.viewCount || 0} viewers
              </Text>
            </>
          )}
        </View>
        
        {/* Production debug info (only in development) */}
        {__DEV__ && bufferSegments.length > 0 && (
          <View style={styles.debugInfo}>
            <Text style={styles.debugText}>
              Segments: {bufferSegments.length} | Current: {streamData?.currentSegment}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 15,
    textAlign: 'center',
  },
  streamId: {
    color: '#888',
    fontSize: 12,
    marginTop: 5,
  },
  statusIndicator: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: 'rgba(255, 107, 107, 0.2)',
    borderRadius: 12,
  },
  statusText: {
    color: '#ff6b6b',
    fontSize: 12,
    fontWeight: 'bold',
  },
  errorContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    borderRadius: 15,
    margin: 20,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 15,
  },
  errorTitle: {
    color: '#ff6b6b',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  errorMessage: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 15,
  },
  errorHelp: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 10,
  },
  retryInfo: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontSize: 12,
  },
  video: {
    width: '100%',
    height: '100%',
  },
  videoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#1a1a1a',
    padding: 30,
  },
  placeholderIcon: {
    fontSize: 64,
    marginBottom: 20,
  },
  placeholderTitle: {
    color: '#ff6b6b',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  placeholderMessage: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
  },
  streamInfo: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
  },
  liveIndicator: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 0, 0, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 15,
    marginBottom: 10,
  },
  liveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  streamTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
    marginBottom: 5,
  },
  viewerCount: {
    color: '#fff',
    fontSize: 14,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
  },
  debugInfo: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 8,
    borderRadius: 8,
  },
  debugText: {
    color: '#0f0',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});

export default LiveStreamViewer;