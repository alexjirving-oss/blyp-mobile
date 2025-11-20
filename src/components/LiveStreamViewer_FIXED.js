/**
 * LiveStreamViewer Component - FIXED Production Version
 * 
 * This fixes the "Waiting for video segments..." issue by:
 * ✅ Properly processing segments from Firebase subscription
 * ✅ Using direct segment access instead of broken getBufferSegments logic
 * ✅ Enhanced logging for debugging
 * ✅ Maintaining enterprise-grade error handling
 * ✅ APK and development mode compatibility
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
import { Video } from 'expo-av';
import HLSLiveStreamService from '../services/HLSLiveStreamService';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const LiveStreamViewerFixed = ({ streamId, style, onError }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [streamData, setStreamData] = useState(null);
  const [currentSegmentUrl, setCurrentSegmentUrl] = useState(null);
  const [availableSegments, setAvailableSegments] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [debugInfo, setDebugInfo] = useState('Initializing...');

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
      console.log('🔧 FIXED VIEWER: Initializing for stream:', streamId);
      setDebugInfo(`Connecting to stream ${streamId}...`);
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
   * FIXED: Stream initialization with comprehensive logging
   */
  const initializeStream = async (validStreamId) => {
    try {
      console.log('🔧 FIXED VIEWER: Stream initialization starting...');
      setConnectionStatus('connecting');
      setError(null);
      setDebugInfo('Establishing connection...');
      
      // Subscribe to stream with FIXED callback logic
      unsubscribeRef.current = HLSLiveStreamService.subscribeToStream(
        validStreamId,
        handleStreamUpdateFixed
      );
      
      console.log('🔧 FIXED VIEWER: Subscription created');
      
    } catch (error) {
      console.error('🔧 FIXED VIEWER: Initialization error:', error);
      handleConnectionError(error);
    }
  };

  /**
   * FIXED: Stream update handler that properly processes segments
   */
  const handleStreamUpdateFixed = (data) => {
    try {
      if (!mountedRef.current) return;
      
      console.log('🔧 FIXED VIEWER: Stream update received');
      console.log('🔧 Raw data keys:', data ? Object.keys(data) : 'null');
      
      if (!data || typeof data !== 'object') {
        console.warn('🔧 FIXED VIEWER: Invalid stream data received:', data);
        setDebugInfo('Stream ended or invalid data');
        setConnectionStatus('ended');
        return;
      }
      
      console.log('🔧 FIXED VIEWER: Stream data:', {
        id: data.id,
        status: data.status,
        currentSegment: data.currentSegment,
        segmentsType: typeof data.segments,
        segmentsKeys: data.segments ? Object.keys(data.segments).length : 0,
        hasBufferSegments: !!data.bufferSegments,
        bufferSegmentsLength: data.bufferSegments ? data.bufferSegments.length : 0
      });
      
      setStreamData(data);
      setConnectionStatus(data.status || 'live');
      setDebugInfo(`Status: ${data.status}, Segment: ${data.currentSegment}`);
      
      // FIXED: Process segments using DIRECT access (not getBufferSegments)
      if (data.segments && typeof data.currentSegment === 'number' && data.currentSegment >= 0) {
        processSegmentsFixed(data);
      } else if (data.bufferSegments && Array.isArray(data.bufferSegments)) {
        // Use pre-computed buffer segments if available
        console.log('🔧 FIXED VIEWER: Using pre-computed buffer segments');
        setAvailableSegments(data.bufferSegments);
        selectBestSegmentFixed(data.bufferSegments);
      } else {
        console.log('🔧 FIXED VIEWER: No valid segments found');
        setDebugInfo('No video segments available');
      }
      
      // Reset retry counter on successful update
      retryCountRef.current = 0;
      setIsLoading(false);
      
    } catch (error) {
      console.error('🔧 FIXED VIEWER: Error handling stream update:', error);
      handleConnectionError(error);
    }
  };

  /**
   * FIXED: Process segments using direct access to segments object
   */
  const processSegmentsFixed = (data) => {
    try {
      console.log('🔧 FIXED VIEWER: Processing segments directly...');
      
      const currentSeg = Math.floor(data.currentSegment);
      const segments = data.segments;
      const processedSegments = [];
      
      // FIXED: Build segment list using direct access
      const segmentKeys = Object.keys(segments);
      console.log('🔧 FIXED VIEWER: Available segment keys:', segmentKeys);
      
      // Get the latest 3-5 segments for buffering
      const bufferStart = Math.max(0, currentSeg - 2);
      const bufferEnd = currentSeg + 2;
      
      for (let i = bufferStart; i <= bufferEnd; i++) {
        const segment = segments[i];
        if (segment && typeof segment === 'object' && segment.url) {
          processedSegments.push({
            number: i,
            url: segment.url,
            isCurrent: i === currentSeg,
            timestamp: segment.uploadedAt || Date.now(),
            size: segment.size || 0
          });
          
          console.log(`🔧 FIXED VIEWER: Added segment ${i}:`, {
            hasUrl: !!segment.url,
            urlPrefix: segment.url ? segment.url.substring(0, 30) : 'none'
          });
        }
      }
      
      console.log('🔧 FIXED VIEWER: Processed segments:', processedSegments.length);
      setAvailableSegments(processedSegments);
      
      if (processedSegments.length > 0) {
        selectBestSegmentFixed(processedSegments);
      } else {
        console.log('🔧 FIXED VIEWER: No processable segments found');
        setDebugInfo('Segments processing failed');
      }
      
    } catch (error) {
      console.error('🔧 FIXED VIEWER: Error processing segments:', error);
      setDebugInfo(`Segment processing error: ${error.message}`);
    }
  };

  /**
   * FIXED: Select the best segment for playback
   */
  const selectBestSegmentFixed = (segments) => {
    try {
      console.log('🔧 FIXED VIEWER: Selecting best segment from:', segments.length);
      
      if (!segments || segments.length === 0) {
        console.log('🔧 FIXED VIEWER: No segments to choose from');
        return;
      }
      
      // FIXED: Prefer current segment, fallback to latest
      const currentSegment = segments.find(seg => seg && seg.isCurrent);
      const latestSegment = segments[segments.length - 1];
      const bestSegment = currentSegment || latestSegment;
      
      console.log('🔧 FIXED VIEWER: Best segment selection:', {
        current: currentSegment ? currentSegment.number : 'none',
        latest: latestSegment ? latestSegment.number : 'none',
        selected: bestSegment ? bestSegment.number : 'none'
      });
      
      if (bestSegment && bestSegment.url) {
        if (bestSegment.url.startsWith('https://') || bestSegment.url.startsWith('http://')) {
          console.log('🔧 FIXED VIEWER: Loading segment:', bestSegment.number);
          setCurrentSegmentUrl(bestSegment.url);
          setDebugInfo(`Playing segment ${bestSegment.number}`);
          
          // Log successful segment selection
          console.log('[METRIC][viewer_segmentSelected]', new Date().toISOString(), { 
            streamId, 
            segmentNumber: bestSegment.number,
            segmentUrl: bestSegment.url.substring(0, 50) + '...'
          });
          
        } else {
          console.warn('🔧 FIXED VIEWER: Invalid URL format:', bestSegment.url);
          setDebugInfo(`Invalid segment URL format`);
        }
      } else {
        console.log('🔧 FIXED VIEWER: Best segment has no URL');
        setDebugInfo('Selected segment missing URL');
      }
      
    } catch (error) {
      console.error('🔧 FIXED VIEWER: Error selecting segment:', error);
      setDebugInfo(`Segment selection error: ${error.message}`);
    }
  };

  /**
   * Enterprise-grade error handling (unchanged)
   */
  const handleConnectionError = (error) => {
    if (!mountedRef.current) return;
    
    console.error('🔧 FIXED VIEWER: Connection error:', error);
    setDebugInfo(`Error: ${error.message}`);
    
    retryCountRef.current++;
    
    if (retryCountRef.current <= maxRetries) {
      console.log(`🔧 FIXED VIEWER: Retrying connection (${retryCountRef.current}/${maxRetries})...`);
      
      setConnectionStatus('retrying');
      setDebugInfo(`Retrying... (${retryCountRef.current}/${maxRetries})`);
      
      const retryDelay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 10000);
      
      retryTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current && streamId) {
          initializeStream(streamId);
        }
      }, retryDelay);
      
    } else {
      console.error('🔧 FIXED VIEWER: Max retries exceeded');
      setError(error.message || 'Stream connection failed');
      setIsLoading(false);
      setConnectionStatus('failed');
      setDebugInfo('Connection failed');
      
      if (onError && typeof onError === 'function') {
        onError(error);
      }
    }
  };

  /**
   * Video event handlers (unchanged)
   */
  const handleVideoError = (error) => {
    console.error('🔧 FIXED VIEWER: Video playback error:', error);
    setDebugInfo(`Video error: ${error.message || 'Playback failed'}`);
    
    // Try to recover by reloading
    if (currentSegmentUrl) {
      console.log('🔧 FIXED VIEWER: Attempting video recovery...');
      const originalUrl = currentSegmentUrl;
      setCurrentSegmentUrl(null);
      setTimeout(() => {
        if (mountedRef.current) {
          setCurrentSegmentUrl(originalUrl);
        }
      }, 1000);
    }
  };

  const handleVideoLoad = () => {
    console.log('🔧 FIXED VIEWER: Video loaded successfully');
    setIsLoading(false);
    setConnectionStatus('playing');
    setDebugInfo('Video playing');
  };

  /**
   * Cleanup resources (unchanged)
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

  // Error state
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

  // Loading state
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
            <Text style={styles.statusText}>{debugInfo}</Text>
          </View>
        </View>
      </View>
    );
  }

  // FIXED: Main video display with enhanced debugging
  return (
    <View style={[styles.container, style]}>      
      {currentSegmentUrl ? (
        <Video
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
          <Text style={styles.placeholderDebug}>
            Debug: {debugInfo}
          </Text>
          <Text style={styles.placeholderSegments}>
            Available segments: {availableSegments.length}
          </Text>
        </View>
      )}
      
      {/* Stream overlay */}
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
        
        {/* Enhanced debug info */}
        {__DEV__ && (
          <View style={styles.debugInfo}>
            <Text style={styles.debugText}>
              Status: {connectionStatus} | Segments: {availableSegments.length}
            </Text>
            <Text style={styles.debugText}>
              Current Segment: {streamData?.currentSegment || 'none'}
            </Text>
            <Text style={styles.debugText}>
              URL: {currentSegmentUrl ? 'loaded' : 'waiting'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

// Styles (same as original PRODUCTION viewer)
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
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
  },
  errorContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  errorMessage: {
    color: '#ff6b6b',
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  errorHelp: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryInfo: {
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 107, 107, 0.2)',
    borderRadius: 8,
  },
  retryText: {
    color: '#ff6b6b',
    fontSize: 12,
  },
  video: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    padding: 20,
  },
  placeholderIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  placeholderTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  placeholderMessage: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  placeholderDebug: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  placeholderSegments: {
    color: '#ffd700',
    fontSize: 12,
    textAlign: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingTop: 48,
  },
  streamInfo: {
    marginBottom: 12,
  },
  liveIndicator: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 0, 0, 0.8)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 8,
  },
  liveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  streamTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  viewerCount: {
    color: '#fff',
    fontSize: 14,
  },
  debugInfo: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 8,
    borderRadius: 4,
  },
  debugText: {
    color: '#00ff00',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});

export default LiveStreamViewerFixed;