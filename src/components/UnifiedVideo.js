// src/components/UnifiedVideo.js
// Adapter to centralize video backend (expo-av vs expo-video) behind an env flag.
// Default behavior (flag off): use expo-av Video to ensure zero regression.
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Video as ExpoAVVideo } from 'expo-av';
import { VideoView } from 'expo-video';

// Internal env flag (do not export). Explicit true only.
const ENABLE_EXPO_VIDEO = process.env.EXPO_PUBLIC_ENABLE_EXPO_VIDEO === 'true' || process.env.EXPO_PUBLIC_ENABLE_EXPO_VIDEO === '1';

// Public component API remains unchanged for callers. Wrapped in forwardRef so
// callers (e.g. EnhancedVideo) can imperatively control playback —
// playAsync/pauseAsync/replayAsync/getStatusAsync — which is essential for
// reliably resuming a video after the screen/tab regains focus.
const UnifiedVideo = React.forwardRef(function UnifiedVideo({
  source,
  uri,
  playbackUrl,
  streamUrl,
  hlsUrl,
  style,
  resizeMode = 'cover',
  shouldPlay = false,
  isLooping = false,
  isMuted = false,
  volume,
  useNativeControls,
  onLoad,
  onError,
  onReadyForDisplay,
  onPlaybackStatusUpdate, // retained for compatibility; not mapped in expo-video branch yet
  ...rest
}, ref) {
  const resolvedUri = (() => {
    const explicit = typeof uri === 'string' ? uri.trim() : '';
    const altPlayback = typeof playbackUrl === 'string' ? playbackUrl.trim() : '';
    const altStream = typeof streamUrl === 'string' ? streamUrl.trim() : '';
    const altHls = typeof hlsUrl === 'string' ? hlsUrl.trim() : '';
    const fromSource = source && typeof source.uri === 'string' ? source.uri.trim() : '';
    return explicit || altPlayback || altStream || altHls || fromSource || '';
  })();

  // Guard against missing/invalid URI: do not play mock or placeholder content
  if (!resolvedUri) {
    try {
      console.warn('[UnifiedVideo] Missing video URI. Rendering fallback UI only.');
    } catch {}
    return (
      <View style={[style || StyleSheet.absoluteFill, { backgroundColor: '#0b1220', alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: '#71717A', fontSize: 14 }}>Video unavailable</Text>
      </View>
    );
  }

  // Dev-only backend selection logging
  if (__DEV__) {
    const backend = ENABLE_EXPO_VIDEO ? 'expo-video' : 'expo-av';
    try {
      // eslint-disable-next-line no-console
      console.log('[VIDEO][UnifiedVideo] backend selected:', backend, {
        uri: resolvedUri,
      });
    } catch {}
  }
  // Branch 1: current stable path (expo-av)
  if (!ENABLE_EXPO_VIDEO) {
    return (
      <ExpoAVVideo
        ref={ref}
        source={{ uri: resolvedUri }}
        style={style || StyleSheet.absoluteFill}
        resizeMode={resizeMode}
        shouldPlay={shouldPlay}
        isLooping={isLooping}
        isMuted={isMuted}
        volume={volume}
        useNativeControls={useNativeControls}
        onLoad={onLoad}
        onError={onError}
        onReadyForDisplay={onReadyForDisplay}
        onPlaybackStatusUpdate={onPlaybackStatusUpdate}
        {...rest}
      />
    );
  }

  // Branch 2: experimental expo-video path (basic wiring only)
  const videoRef = useRef(null);
  const contentFit = resizeMode === 'contain' ? 'contain' : 'cover';
  const initialVolume = typeof volume === 'number' ? volume : undefined;

  // Map expo-video status object into an expo-av-like subset.
  const mapVideoStatusToExpoAVShape = (status) => {
    if (!status) return status;
    const {
      isLoaded = true,
      isPlaying = false,
      isBuffering = false,
      positionMillis = 0,
      durationMillis = 0,
      isMuted: muted = isMuted,
      isLooping: looping = isLooping,
      volume: vol = volume,
      didJustFinish = false,
    } = status;
    return {
      isLoaded,
      isPlaying,
      isBuffering,
      positionMillis,
      durationMillis,
      isMuted: muted,
      isLooping: looping,
      volume: vol,
      didJustFinish,
    };
  };

  const handleError = (error) => {
    console.log('[UnifiedVideo] expo-video error', error);
    onError?.(error);
  };

  const handleLoad = () => {
    // Minimal shim; expo-video does not provide duration/naturalSize directly here.
    onLoad?.({ naturalSize: undefined });
  };

  const handleStatusUpdate = (status) => {
    if (!onPlaybackStatusUpdate) return;
    try {
      const mapped = mapVideoStatusToExpoAVShape(status);
      onPlaybackStatusUpdate(mapped);
    } catch (err) {
      console.log('[UnifiedVideo] Failed to map status', err);
    }
  };

  // Basic play/pause effect (VideoView playback control subject to player API; safe-optional calls).
  useEffect(() => {
    if (!videoRef.current) return;
    if (shouldPlay) {
      videoRef.current.playAsync?.().catch(() => {});
    } else {
      videoRef.current.pauseAsync?.().catch(() => {});
    }
  }, [shouldPlay]);

  // Apply volume changes (best-effort; guarded for backend capability)
  useEffect(() => {
    if (!videoRef.current) return;
    if (initialVolume === undefined) return;
    videoRef.current.setVolumeAsync?.(initialVolume).catch(() => {});
  }, [initialVolume]);

  return (
    <VideoView
      ref={videoRef}
      style={style || StyleSheet.absoluteFill}
      source={{ uri: resolvedUri }}
      contentFit={contentFit}
      isLooping={isLooping}
      isMuted={isMuted}
      volume={initialVolume}
      onError={handleError}
      onLoad={handleLoad}
      onPlaybackStatusUpdate={handleStatusUpdate}
      // Future: map status events -> onPlaybackStatusUpdate
      {...rest}
    />
  );
});

export default UnifiedVideo;
