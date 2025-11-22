import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { View, Image, ActivityIndicator, StyleSheet } from 'react-native';
import UnifiedVideo from './UnifiedVideo';
import * as FileSystem from 'expo-file-system/legacy';

function EnhancedVideo({
  uri,
  poster,
  style,
  shouldPlay,
  shouldLoad,
  isLooping = true,
  isMuted = false,
  resizeMode = 'contain',
  onReady,
  onError,
}) {
  const videoRef = useRef(null);
  const [cachedUri, setCachedUri] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [buffering, setBuffering] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const loadStartRef = useRef(Date.now());
  const loggedRef = useRef(false);

  useEffect(() => {
    if (!shouldLoad || !uri || cachedUri) return;

    let cancelled = false;
    async function cacheInBackground() {
      try {
        const fileName = encodeURIComponent(uri);
        const fileUri = `${FileSystem.cacheDirectory}vid-${fileName}`;
        const info = await FileSystem.getInfoAsync(fileUri);
        if (cancelled) return;

        if (!info.exists) {
          setLoading(true);
          const download = await FileSystem.downloadAsync(uri, fileUri);
          if (cancelled) return;
          setCachedUri(download.uri);
        } else {
          setCachedUri(info.uri);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e);
          onError && onError(e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    cacheInBackground();
    return () => {
      cancelled = true;
    };
  }, [uri, shouldLoad, cachedUri, onError]);

  const handlePlayControl = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      if (shouldPlay) {
        await videoRef.current.playAsync();
      } else {
        await videoRef.current.pauseAsync();
      }
    } catch {
      // ignore
    }
  }, [shouldPlay]);

  useEffect(() => {
    handlePlayControl();
  }, [handlePlayControl]);

  const source = { uri: cachedUri || uri };

  return (
    <View style={[style, { overflow: 'hidden', position: 'relative' }]}> 
      {poster && !videoLoaded && (
        <Image
          source={{ uri: poster }}
          style={[StyleSheet.absoluteFill, styles.poster]}
          resizeMode="contain"
        />
      )}

      {(loading || buffering) && (
        <View style={[StyleSheet.absoluteFill, styles.loader]}>
          <ActivityIndicator color="#ec4899" />
        </View>
      )}

      {error && (
        <View style={[StyleSheet.absoluteFill, styles.error]} />
      )}

      <UnifiedVideo
        ref={videoRef}
        source={source}
        style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent', opacity: videoLoaded ? 1 : 0 }]}
        shouldPlay={shouldPlay && videoLoaded}
        isLooping={isLooping}
        isMuted={isMuted}
        resizeMode={resizeMode}
        useNativeControls={false}
        progressUpdateIntervalMillis={500}
        onLoad={(status) => {
          console.log('[EnhancedVideo] onLoad', {
            uri: uri?.slice(0, 80),
            cached: !!cachedUri,
            durationMillis: status?.durationMillis,
          });
        }}
        onReadyForDisplay={() => {
          if (!loggedRef.current) {
            const ms = Date.now() - loadStartRef.current;
            if (ms > 1000) {
              console.log('[VideoPerf] slow readyForDisplay', { uri: uri?.slice(0, 60), ms });
            }
            loggedRef.current = true;
          }
          console.log('[EnhancedVideo] onReadyForDisplay', { uri: uri?.slice(0, 80) });
          setTimeout(() => {
            setVideoLoaded(true);
            onReady && onReady();
          }, 300);
        }}
        onError={(e) => {
          console.log('[EnhancedVideo] onError', { uri: uri?.slice(0, 80), error: e });
          setError(e);
          onError && onError(e);
        }}
        onPlaybackStatusUpdate={(status) => {
          if (status?.error) {
            console.log('[EnhancedVideo] playbackStatus error', { uri: uri?.slice(0, 80), error: status.error });
          }
          if (status.isBuffering !== undefined && status.isBuffering !== buffering) {
            setBuffering(status.isBuffering);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  poster: {
    width: '100%',
    height: '100%',
  },
  loader: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  error: {
    backgroundColor: '#111827',
  },
});

export default memo(EnhancedVideo);
