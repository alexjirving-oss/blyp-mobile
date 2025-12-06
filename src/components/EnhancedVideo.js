import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Image } from 'react-native';
import UnifiedVideo from './UnifiedVideo';
import { getPlayableVideoUri } from '../utils/videoCache';

function EnhancedVideo(props) {
  const videoRef = useRef(null);
  const [playableUri, setPlayableUri] = useState(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const remoteUri = props.uri || props.videoUrl;
  const isFocused = props.shouldPlay ?? true;
  const posterUri = props.poster;

  // Resolve URI through cache helper
  useEffect(() => {
    let cancelled = false;

    async function resolveUri() {
      if (!remoteUri) {
        setPlayableUri(null);
        setHasError(true);
        return;
      }

      try {
        const resolved = await getPlayableVideoUri(remoteUri);
        if (!cancelled) {
          setPlayableUri(resolved || remoteUri);
          setHasError(false);
        }
      } catch (error) {
        if (!cancelled) {
          if (__DEV__) {
            console.warn('[EnhancedVideo] URI resolution failed, using remote', { error });
          }
          setPlayableUri(remoteUri);
          setHasError(false);
        }
      }
    }

    resolveUri();

    return () => {
      cancelled = true;
    };
  }, [remoteUri]);

  // Drive play/pause from focus
  useEffect(() => {
    if (!videoRef.current || !videoLoaded || hasError) return;

    if (isFocused) {
      videoRef.current.playAsync().catch(() => {});
    } else {
      videoRef.current.pauseAsync().catch(() => {});
    }
  }, [isFocused, videoLoaded, hasError]);

  const handleLoad = (status) => {
    if (__DEV__) {
      console.log('[EnhancedVideo] onLoad', {
        playableUri,
        durationMillis: status?.durationMillis,
      });
    }
    setVideoLoaded(true);
    setHasError(false);
    if (props.onReady) props.onReady();
  };

  const handleError = (error) => {
    console.warn('[EnhancedVideo] onError', error);
    setHasError(true);
    setVideoLoaded(false);
    if (props.onError) props.onError(error);
  };

  return (
    <View style={[styles.container, props.style]}>
      {playableUri && (
        <UnifiedVideo
          ref={videoRef}
          style={styles.video}
          source={{ uri: playableUri }}
          resizeMode={props.resizeMode || "cover"}
          isLooping={props.isLooping ?? true}
          isMuted={props.isMuted ?? true}
          shouldPlay={isFocused}
          onLoad={handleLoad}
          onError={handleError}
          onReadyForDisplay={() => {
            if (__DEV__) {
              console.log('[EnhancedVideo] onReadyForDisplay');
            }
            setVideoLoaded(true);
          }}
          onPlaybackStatusUpdate={
            __DEV__
              ? (status) => {
                  if (status?.isLoaded && status?.isPlaying) {
                    // Lightweight check to avoid spam
                  }
                  if (status?.error) {
                    console.warn('[EnhancedVideo] playbackStatus error', status.error);
                  }
                }
              : undefined
          }
        />
      )}

      {/* Poster while loading, if available */}
      {!videoLoaded && !hasError && posterUri && (
        <Image
          source={{ uri: posterUri }}
          style={styles.overlay}
          resizeMode="cover"
        />
      )}

      {/* Loading spinner while not loaded and no error */}
      {!videoLoaded && !hasError && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#ec4899" />
        </View>
      )}

      {/* Simple error overlay */}
      {hasError && (
        <View style={styles.errorOverlay}>
          {/* Error indicator */}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 9 / 16,
    backgroundColor: 'black',
    overflow: 'hidden',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111827',
  },
});

export default EnhancedVideo;
