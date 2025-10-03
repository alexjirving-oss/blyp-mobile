import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { View, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { Video } from 'expo-av';
import * as FileSystem from 'expo-file-system';

/*
  EnhancedVideo
  - Caches remote video to device file system (simple hash via encodeURIComponent)
  - Shows poster/thumbnail until ready
  - Only loads when shouldLoad is true (parent controls visibility)
  - Auto plays/pauses based on shouldPlay
  - STREAM-FIRST: Immediately streams original URI for instant playback, then swaps to cached file when downloaded
*/
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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [buffering, setBuffering] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const loadStartRef = useRef(Date.now());
  const loggedRef = useRef(false);

  // Background cache while streaming original uri immediately for instant start
  useEffect(() => {
    if (!shouldLoad || !uri || cachedUri) return; // Skip if already cached
    
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
    return () => { cancelled = true; };
  }, [uri, shouldLoad, cachedUri]);

  // Memoized play control to reduce effect runs
  const handlePlayControl = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      if (shouldPlay) {
        await videoRef.current.playAsync();
      } else {
        await videoRef.current.pauseAsync();
      }
    } catch (e) {
      // Ignore playback control errors
    }
  }, [shouldPlay]);

  useEffect(() => {
    handlePlayControl();
  }, [handlePlayControl]);

  // Always stream original uri first; swap to cached file silently once available
  const source = { uri: cachedUri || uri };

  return (
    <View style={[style, { overflow: 'hidden', position: 'relative' }]}>
      {/* Always show poster first, hide only when video is truly ready and loaded */}
      {poster && (!videoLoaded) && (
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
        <View style={[StyleSheet.absoluteFill, styles.error]}>
          <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        </View>
      )}
      
      <Video
        ref={videoRef}
        source={source}
        style={[
          StyleSheet.absoluteFill, 
          { 
            backgroundColor: 'transparent',
            opacity: videoLoaded ? 1 : 0,
          }
        ]}
        shouldPlay={shouldPlay && videoLoaded}
        isLooping={isLooping}
        isMuted={isMuted}
        resizeMode={resizeMode}
        useNativeControls={false}
        progressUpdateIntervalMillis={500}
        onLoad={(status) => {
          // Video metadata loaded, but don't show yet
          console.log('[VideoLoad] Video loaded, metadata ready');
        }}
        onReadyForDisplay={() => {
          if (!loggedRef.current) {
            const ms = Date.now() - loadStartRef.current;
            if (ms > 1000) {
              console.log('[VideoPerf] slow readyForDisplay', { uri: uri?.slice(0,60), ms });
            }
            loggedRef.current = true;
          }
          
          // Delay showing video to prevent zoom-in effect
          setTimeout(() => {
            setVideoLoaded(true);
            setReady(true);
            onReady && onReady();
          }, 300);
        }}
        onError={(e) => {
          setError(e);
          onError && onError(e);
        }}
        onPlaybackStatusUpdate={(status) => {
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
    height: '100%'
  },
  loader: { 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: 'rgba(0,0,0,0.2)' 
  },
  error: { 
    backgroundColor: '#111827' 
  },
});

export default memo(EnhancedVideo);
