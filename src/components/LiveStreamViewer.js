/**
 * LiveStreamViewer Component - TikTok-Style Architecture
 * 
 * Production-grade live streaming viewer with:
 * - Continuous segment playback without interruption
 * - Adaptive buffering for smooth experience
 * - Robust error recovery and fallback mechanisms
 * - Real-world performance optimizations
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Alert } from 'react-native';
import { Video } from 'expo-av';
import HLSLiveStreamService from '../services/HLSLiveStreamService';
import StreamSegmentsAdapter from '../services/StreamSegmentsAdapter';
import EnterpriseAnalyticsService from '../services/EnterpriseAnalyticsService';
import ManifestService from '../services/ManifestService';
import PlaylistParserService from '../services/PlaylistParserService';
import PlaylistFetchService from '../services/PlaylistFetchService';
import QualitySelectionService from '../services/QualitySelectionService';
import { decideNextQuality, createSlidingWindowCounter, emitQualitySwitchEvent } from '../services/QualityAdaptationService';
import SegmentBandwidthEstimatorService from '../services/SegmentBandwidthEstimatorService';
import NetInfo from '@react-native-community/netinfo';
import { isManifestEnabled, isPlaylistViewerEnabled, getFeatureFlags } from '../config/FeatureFlags';

const LiveStreamViewer = ({ streamId, onError, style }) => {
  const videoRef = useRef(null);
  const secondaryVideoRef = useRef(null);
  
  // TikTok-style state management
  const [currentSegment, setCurrentSegment] = useState(-1);
  const [segmentBuffer, setSegmentBuffer] = useState(new Map());
  const [isBuffering, setIsBuffering] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [streamData, setStreamData] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  
  // Advanced playback management
  const unsubscribeRef = useRef(null);
  const playbackQueueRef = useRef([]);
  const lastSegmentTimeRef = useRef(0);
  const retryCountRef = useRef(0);
  const activeVideoRef = useRef('primary');
  const segmentTimeoutRef = useRef(null);
  const stallCheckRef = useRef(null);
  const lastPlaybackSegmentRef = useRef(-1);
  const variantsRef = useRef([]); // master playlist variants
  const chosenQualityRef = useRef(null); // current quality label
  const adaptationIntervalRef = useRef(null);
  const lastQualitySwitchRef = useRef(0);
  const stallCounterRef = useRef(createSlidingWindowCounter(15000)); // 15s window
  const lastEstimatorEmitRef = useRef(0); // throttle ABR estimator analytics

  // TikTok-style segment subscription with intelligent buffering
  useEffect(() => {
    if (!streamId) return;

  if (__DEV__) console.log(`🎬 TikTok-style viewer initializing for stream ${streamId}`);
    setConnectionStatus('connecting');
    
    // Subscribe to stream updates with enhanced error handling
    unsubscribeRef.current = HLSLiveStreamService.subscribeToStream(streamId, async (data) => {
      if (!data) {
        console.log('📡 Stream ended or connection lost');
        setConnectionStatus('ended');
        handleStreamEnd();
        return; // End early when stream data unavailable
      }

      setStreamData(data);
      setConnectionStatus('connected');
      
      // TikTok-style intelligent segment management
      if (data.currentSegment >= 0) {
          const latestSegment = data.currentSegment;
          // Prefer adapter window (subcollection) fallback to legacy map
          const windowSegments = await StreamSegmentsAdapter.getWindow(streamId, 5);
          const newBuffer = new Map();
        windowSegments.forEach(s => newBuffer.set(s.number, { ...s, timestamp: Date.now() }));
        setSegmentBuffer(newBuffer);
        if (currentSegment === -1 && latestSegment >= 0) {
          // Initial playback start should not reference a quality adaptation decision yet.
          // Cooldown logic applies only to subsequent quality switches handled in adaptation loop.
          setCurrentSegment(Math.max(0, latestSegment - 1));
          startPlayback();
        }
        // Manifest feature flag instrumentation (transitional)
        if (isManifestEnabled()) {
          try {
            let manifest = await ManifestService.generateLocalManifest(streamId);
            // Attempt remote master playlist fetch if playlist viewer mode enabled
            if (isPlaylistViewerEnabled()) {
              const remoteMaster = await PlaylistFetchService.getMaster(streamId);
              if (remoteMaster) {
                EnterpriseAnalyticsService.addEvent({ type: 'playlist_master_fetched', streamId, timestamp: Date.now() });
                    lastQualitySwitchRef.current = Date.now();
                // For now choose first variant listed or fallback to local manifest
                  const masterParsed = PlaylistParserService.parseMaster(remoteMaster);
                  variantsRef.current = masterParsed.variants || [];
                  let chosenQuality = null;
                  let networkType = 'unknown';
                  try {
                    const state = await NetInfo.fetch();
                    networkType = state?.type || 'unknown';
                  } catch {}
                  try {
                    chosenQuality = QualitySelectionService.chooseQuality(masterParsed.variants, networkType);
                  } catch {}
                const variantToUse = chosenQuality || masterParsed.variants[0]?.playlist;
                if (variantToUse) {
                  const qualityContent = await PlaylistFetchService.getQuality(streamId, variantToUse.replace('.m3u8',''));
                  if (qualityContent) {
                    manifest = qualityContent; // treat quality playlist as playable segment list
                      chosenQualityRef.current = variantToUse.replace('.m3u8','');
                    EnterpriseAnalyticsService.addEvent({
                      type: 'playlist_quality_selected',
                      streamId,
                        quality: variantToUse.replace('.m3u8',''),
                        experimentId: getFeatureFlags().playlistExperimentId,
                      timestamp: Date.now()
                    });
                  }
                }
              }
            }
            EnterpriseAnalyticsService.addEvent({
              type: 'manifest_generated_local',
              streamId,
              length: manifest ? manifest.split('\n').length : 0,
              timestamp: Date.now()
            });
            // Optional playlist viewer mode: parse quality playlist (simulate single quality)
            if (isPlaylistViewerEnabled() && manifest) {
              // For transitional mode, treat entire manifest as single quality playlist
              const parsedSegments = PlaylistParserService.parseQuality(manifest);
              if (parsedSegments.length) {
                const playlistBuffer = new Map();
                parsedSegments.slice(-5).forEach(seg => playlistBuffer.set(seg.number, { ...seg, timestamp: Date.now() }));
                setSegmentBuffer(playlistBuffer);
                if (currentSegment === -1) {
                  setCurrentSegment(parsedSegments[0].number);
                  startPlayback();
                }
                EnterpriseAnalyticsService.addEvent({
                  type: 'playlist_mode_segments_loaded',
                  streamId,
                  count: playlistBuffer.size,
                  quality: chosenQualityRef.current,
                  experimentId: getFeatureFlags().playlistExperimentId,
                  timestamp: Date.now()
                });
              }
            }
          } catch (e) {
            EnterpriseAnalyticsService.addEvent({
              type: 'manifest_generation_error',
              streamId,
              message: e?.message,
              timestamp: Date.now()
            });
          }
        }
      }
    });

    return () => {
      cleanup();
    };
  }, [streamId]);

  // Update view count on mount/unmount
  useEffect(() => {
    if (!streamId) return;
    HLSLiveStreamService.updateViewCount(streamId, true).catch(() => {});
    return () => {
      HLSLiveStreamService.updateViewCount(streamId, false).catch(() => {});
    };
  }, [streamId]);

  // TikTok-style continuous playback management
  useEffect(() => {
    if (segmentBuffer.size > 0 && currentSegment >= 0) {
      managePlayback();
    }
  }, [segmentBuffer, currentSegment]);

  /**
   * TikTok-style playback management with seamless transitions
   */
  const managePlayback = useCallback(async () => {
    const targetSegment = segmentBuffer.get(currentSegment);
    
    if (!targetSegment || !videoRef.current) {
      // Handle missing segment with TikTok-style recovery
  if (__DEV__) console.log(`⚠️ Segment ${currentSegment} not available, attempting recovery...`);
      handleMissingSegment();
      return;
    }

  if (__DEV__) console.log(`🎥 TikTok-style playback: segment ${currentSegment}`);
    
    try {
      setIsBuffering(false);
      setIsPlaying(true);
      retryCountRef.current = 0;
      
      // TikTok optimization: preload while playing current
      preloadNextSegment();
      // Sample bandwidth (non-blocking) occasionally
      if (isPlaylistViewerEnabled() && SegmentBandwidthEstimatorService.shouldSample() && targetSegment?.url) {
        SegmentBandwidthEstimatorService.sample(targetSegment.url);
      }
      
      const activeVideo = videoRef.current;
      
      // Load segment with optimized settings
      await activeVideo.loadAsync(
        { uri: targetSegment.url },
        {
          shouldPlay: true,
          volume: 1.0,
          rate: 1.0,
          shouldCorrectPitch: true,
          progressUpdateIntervalMillis: 500 // Reduce churn on status updates
        },
        false
      );
      
      lastSegmentTimeRef.current = Date.now();
      lastPlaybackSegmentRef.current = currentSegment;
      
    } catch (error) {
      console.error(`❌ Playback error for segment ${currentSegment}:`, error);
      handlePlaybackError(error);
    }
  }, [currentSegment, segmentBuffer]);

  /**
   * TikTok-style segment preloading for smooth experience
   */
  const preloadNextSegment = useCallback(() => {
    const nextSegment = segmentBuffer.get(currentSegment + 1);
    if (nextSegment && secondaryVideoRef.current) {
  if (__DEV__) console.log(`📦 Preloading segment ${currentSegment + 1}`);
      secondaryVideoRef.current.loadAsync(
        { uri: nextSegment.url },
        { shouldPlay: false },
        false
      ).catch(err => console.log('Preload failed:', err));
    }
  }, [currentSegment, segmentBuffer]);

  /**
   * TikTok-style playback status management with seamless transitions
   */
  const handlePlaybackStatusUpdate = useCallback((status) => {
    if (status.didJustFinish) {
  if (__DEV__) console.log(`✅ Segment ${currentSegment} completed, transitioning...`);
      
      // TikTok-style seamless transition to next segment
      const nextSegmentNumber = currentSegment + 1;
      if (segmentBuffer.has(nextSegmentNumber)) {
        setCurrentSegment(nextSegmentNumber);
      } else {
        // Wait for next segment with timeout
        setIsBuffering(true);
        waitForNextSegment(nextSegmentNumber);
      }
    }

    // Handle buffering states
    if (status.isBuffering !== isBuffering) {
      setIsBuffering(status.isBuffering);
    }
    
    // Monitor playback health (TikTok-style)
    if (status.isLoaded && !status.isBuffering && !status.didJustFinish) {
      lastSegmentTimeRef.current = Date.now();
      lastPlaybackSegmentRef.current = currentSegment;
    }
  }, [currentSegment, segmentBuffer, isBuffering]);

  /**
   * TikTok-style missing segment recovery
   */
  const handleMissingSegment = useCallback(() => {
    retryCountRef.current++;
    
    if (retryCountRef.current > 3) {
      console.log('❌ Too many retry attempts, skipping segment');
      setCurrentSegment(prev => prev + 1);
      retryCountRef.current = 0;
      return;
    }
    
  if (__DEV__) console.log(`🔄 Retry ${retryCountRef.current}/3 for segment ${currentSegment}`);
    setTimeout(() => {
      if (segmentBuffer.has(currentSegment)) {
        managePlayback();
      } else {
        handleMissingSegment();
      }
    }, 1000 * retryCountRef.current); // Exponential backoff
  }, [currentSegment, segmentBuffer, managePlayback]);

  /**
   * Wait for next segment with timeout
   */
  const waitForNextSegment = useCallback((segmentNumber) => {
    if (segmentTimeoutRef.current) {
      clearTimeout(segmentTimeoutRef.current);
    }
    
    segmentTimeoutRef.current = setTimeout(() => {
      if (segmentBuffer.has(segmentNumber)) {
        setCurrentSegment(segmentNumber);
      } else {
  if (__DEV__) console.log(`⏰ Timeout waiting for segment ${segmentNumber}`);
        // Try to skip to available segment
        const availableSegments = Array.from(segmentBuffer.keys()).sort((a, b) => a - b);
        const nextAvailable = availableSegments.find(s => s > currentSegment);
        if (nextAvailable) {
          setCurrentSegment(nextAvailable);
        }
      }
    }, 5000); // 5 second timeout
  }, [segmentBuffer, currentSegment]);

  /**
   * Handle playback errors with TikTok-style recovery
   */
  const handlePlaybackError = useCallback((error) => {
    console.error('🚨 Playback error:', error);
    retryCountRef.current++;
    
    if (retryCountRef.current > 2) {
      onError?.(new Error('Playback failed after retries'));
      return;
    }
    
    setTimeout(() => {
      managePlayback();
    }, 2000);
  }, [managePlayback, onError]);

  /**
   * Start initial playback
   */
  const startPlayback = useCallback(() => {
  if (__DEV__) console.log('🎬 Starting TikTok-style playback');
    setIsBuffering(false);
    setIsPlaying(true);
  }, []);

  /**
   * Handle stream end
   */
  const handleStreamEnd = useCallback(() => {
    setIsPlaying(false);
    setIsBuffering(false);
    // Ensure all subscriptions and timers are cleared on early termination
    cleanup();
    onError?.(new Error('Stream has ended'));
  }, [onError]);

  /**
   * Cleanup function
   */
  const cleanup = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }
    if (segmentTimeoutRef.current) {
      clearTimeout(segmentTimeoutRef.current);
    }
    if (stallCheckRef.current) {
      clearInterval(stallCheckRef.current);
    }
    if (adaptationIntervalRef.current) {
      clearInterval(adaptationIntervalRef.current);
      adaptationIntervalRef.current = null;
    }
  }, []);

  // Stall detection & analytics emission
  useEffect(() => {
    if (!streamId) return;
    if (stallCheckRef.current) clearInterval(stallCheckRef.current);
    stallCheckRef.current = setInterval(() => {
      const now = Date.now();
      const sinceLast = now - lastSegmentTimeRef.current;
      const stalled = sinceLast > 6000; // >6s without progress
      if (stalled) {
        stallCounterRef.current.incr();
        EnterpriseAnalyticsService.trackStreamPerformance(streamId, {
          latency: sinceLast,
          bufferHealth: 0.0,
          quality: 'source',
          fps: 30,
          bitrate: 0,
          segmentUploadTime: 0,
          errorRate: retryCountRef.current / Math.max(1, currentSegment + 1),
        }).catch(() => {});
        EnterpriseAnalyticsService.trackError(streamId, {
          type: 'stall',
          message: 'Playback stall detected',
          code: 'STALL_6000_MS',
          severity: 'medium',
          context: { currentSegment, bufferSize: segmentBuffer.size, sinceLast },
          recoveryAttempted: false,
          recoverySuccessful: false,
          recoveryMethod: 'auto-skip',
          recoveryTime: 0,
        }).catch(() => {});
        // Attempt auto-skip if next segment exists
        const next = segmentBuffer.get(currentSegment + 1);
        if (next) {
          setCurrentSegment(currentSegment + 1);
        }
      }
    }, 3000);
    return () => {
      if (stallCheckRef.current) clearInterval(stallCheckRef.current);
    };
  }, [streamId, currentSegment, segmentBuffer]);

  // Dynamic adaptation loop (incremental ABR heuristic)
  useEffect(() => {
    if (!isPlaylistViewerEnabled()) return;
    if (!variantsRef.current || variantsRef.current.length < 2) return;
    if (adaptationIntervalRef.current) clearInterval(adaptationIntervalRef.current);
    adaptationIntervalRef.current = setInterval(async () => {
      const bwStats = SegmentBandwidthEstimatorService.getStats();
      let networkType = 'unknown';
      try {
        const s = await NetInfo.fetch();
        networkType = s?.type || 'unknown';
      } catch {}
      const metrics = {
        bufferSegments: segmentBuffer.size,
        stallCountWindow: stallCounterRef.current.count(),
        networkType,
        timeSinceLastSegmentMs: Date.now() - lastSegmentTimeRef.current,
        bufferSeconds: computeBufferedSeconds(),
        estimatedBandwidthKbps: estimateBandwidthKbps(),
        bwSampleCount: bwStats.count,
        bwLastSampleAgeMs: bwStats.lastSampleAgeMs,
        bwMeanKbps: bwStats.meanKbps,
        bwStddevKbps: bwStats.stddevKbps,
        bwConfidenceScore: bwStats.confidenceScore,
        bwCoefficientOfVariation: bwStats.coefficientOfVariation,
      };
      // Emit periodic estimator metrics for observability (throttled to 30s)
      const nowTs = Date.now();
      if (nowTs - (lastEstimatorEmitRef.current || 0) > 30000 && chosenQualityRef.current) {
        lastEstimatorEmitRef.current = nowTs;
        EnterpriseAnalyticsService.addEvent({
          type: 'abr_estimator_metrics',
          streamId,
          ewmaKbps: metrics.estimatedBandwidthKbps,
          meanKbps: bwStats.meanKbps,
          stddevKbps: bwStats.stddevKbps,
          sampleCount: metrics.bwSampleCount,
          lastSampleAgeMs: metrics.bwLastSampleAgeMs,
          confidenceScore: bwStats.confidenceScore,
          coefficientOfVariation: bwStats.coefficientOfVariation,
          bufferSeconds: metrics.bufferSeconds,
          bufferSegments: metrics.bufferSegments,
          networkType: metrics.networkType,
          currentQuality: chosenQualityRef.current,
          experimentId: getFeatureFlags().playlistExperimentId,
          timestamp: nowTs,
        });
      }
      if (!chosenQualityRef.current) return;
      const decision = decideNextQuality(chosenQualityRef.current, variantsRef.current.map(v => ({ name: v.playlist.replace('.m3u8','') })), metrics);
      // Handle skipped delta upgrade analytics
      if (decision && decision.skipped === true) {
        const type = decision.reason === 'delta_blocked'
          ? 'quality_switch_skipped_delta'
          : decision.reason === 'confidence_blocked'
            ? 'quality_switch_skipped_confidence'
            : decision.reason === 'volatility_blocked'
              ? 'quality_switch_skipped_volatility'
              : 'quality_switch_skipped';
        EnterpriseAnalyticsService.addEvent({
          type,
          streamId,
          from: chosenQualityRef.current,
          to: decision.target,
          reason: decision.reason,
          experimentId: getFeatureFlags().playlistExperimentId,
          timestamp: Date.now(),
        });
      }
      if (decision && !decision.skipped && decision.target !== chosenQualityRef.current) {
        const direction = variantsRef.current.findIndex(v => v.playlist.replace('.m3u8','') === decision.target) > variantsRef.current.findIndex(v => v.playlist.replace('.m3u8','') === chosenQualityRef.current) ? 'upgrade' : 'downgrade';
        try {
          const qualityContent = await PlaylistFetchService.getQuality(streamId, decision.target);
          if (qualityContent) {
            const parsedSegments = PlaylistParserService.parseQuality(qualityContent);
            if (parsedSegments.length) {
              const playlistBuffer = new Map();
              parsedSegments.slice(-5).forEach(seg => playlistBuffer.set(seg.number, { ...seg, timestamp: Date.now() }));
              setSegmentBuffer(playlistBuffer);
              setCurrentSegment(parsedSegments[0].number);
              const previousQuality = chosenQualityRef.current;
              chosenQualityRef.current = decision.target;
              emitQualitySwitchEvent(
                Promise.resolve(EnterpriseAnalyticsService),
                direction,
                streamId,
                previousQuality,
                decision.target,
                decision.reason,
                getFeatureFlags().playlistExperimentId
              );
            }
          }
        } catch (e) {
          EnterpriseAnalyticsService.addEvent({ type: 'quality_switch_error', streamId, target: decision.target, message: e?.message, timestamp: Date.now() });
        }
      }
    }, 8000);
    return () => {
      if (adaptationIntervalRef.current) clearInterval(adaptationIntervalRef.current);
    };
  }, [segmentBuffer, streamId]);

  function computeBufferedSeconds() {
    let total = 0;
    segmentBuffer.forEach((seg, num) => {
      if (num >= currentSegment) {
        total += typeof seg.duration === 'number' ? seg.duration : 2;
      }
    });
    return total;
  }

  function estimateBandwidthKbps() {
    return SegmentBandwidthEstimatorService.getEstimatedBandwidthKbps() || null;
  }

  return (
    <View style={[styles.container, style]}>
      {/* Primary video player */}
      <Video
        ref={videoRef}
        style={styles.video}
        resizeMode="cover" // TikTok-style full coverage
        onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
        shouldPlay={true}
        volume={1.0}
        useNativeControls={false}
        isLooping={false}
      />
      
      {/* Secondary video player for preloading (hidden) */}
      <Video
        ref={secondaryVideoRef}
        style={styles.hiddenVideo}
        resizeMode="cover"
        shouldPlay={false}
        volume={0}
        useNativeControls={false}
      />

      {/* TikTok-style connection status */}
      {connectionStatus === 'connecting' && (
        <View style={styles.connectionContainer}>
          <ActivityIndicator size="large" color="#FF1744" />
          <Text style={styles.connectionText}>Connecting to live stream...</Text>
        </View>
      )}

      {/* Enhanced buffering indicator */}
      {isBuffering && connectionStatus === 'connected' && (
        <View style={styles.bufferingContainer}>
          <ActivityIndicator size="large" color="#FF1744" />
          <Text style={styles.bufferingText}>
            {segmentBuffer.size === 0 ? 'Loading stream...' : 'Buffering...'}
          </Text>
          <Text style={styles.bufferInfo}>
            Buffer: {segmentBuffer.size} segments
          </Text>
        </View>
      )}

      {/* TikTok-style live indicator with viewer count */}
      {streamData?.status === 'live' && (
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
          {streamData.viewCount > 0 && (
            <Text style={styles.viewerCount}>{streamData.viewCount}</Text>
          )}
        </View>
      )}

      {/* Connection quality indicator */}
      <View style={styles.qualityIndicator}>
        <View style={[
          styles.qualityDot,
          {
            backgroundColor: connectionStatus === 'connected' 
              ? (retryCountRef.current === 0 ? '#00FF00' : '#FFFF00')
              : '#FF0000'
          }
        ]} />
      </View>

      {/* Debug info (TikTok-style detailed) */}
      {__DEV__ && (
        <View style={styles.debugInfo}>
          <Text style={styles.debugText}>Segment: {currentSegment}</Text>
          <Text style={styles.debugText}>Buffer: {segmentBuffer.size}</Text>
          <Text style={styles.debugText}>Status: {connectionStatus}</Text>
          <Text style={styles.debugText}>Retries: {retryCountRef.current}</Text>
          <Text style={styles.debugText}>Playing: {isPlaying ? 'Yes' : 'No'}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  video: {
    flex: 1,
    backgroundColor: '#000',
  },
  hiddenVideo: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  connectionContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  connectionText: {
    color: 'white',
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
  },
  bufferingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  bufferingText: {
    color: 'white',
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
  },
  bufferInfo: {
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 8,
    fontSize: 14,
  },
  liveIndicator: {
    position: 'absolute',
    top: 20,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 23, 68, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
    marginRight: 6,
  },
  liveText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  viewerCount: {
    color: 'white',
    fontSize: 12,
    marginLeft: 8,
    fontWeight: '600',
  },
  qualityIndicator: {
    position: 'absolute',
    top: 20,
    right: 20,
  },
  qualityDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  debugInfo: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 12,
    borderRadius: 8,
    minWidth: 160,
  },
  debugText: {
    color: 'white',
    fontSize: 11,
    fontFamily: 'monospace',
    marginVertical: 1,
  },
});

export default LiveStreamViewer;
