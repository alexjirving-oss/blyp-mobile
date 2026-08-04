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
  // Only resolve/download + mount the video element when the row is near the
  // viewport. Off-screen items render just their poster (no network, no decode),
  // which keeps scrolling fast and avoids eagerly downloading every feed video.
  const shouldLoad = props.shouldLoad ?? true;
  const posterUri = props.poster;

  // Resolve URI through cache helper — but only once this item should load.
  useEffect(() => {
    let cancelled = false;

    if (!shouldLoad) {
      // Drop any decoded video so memory is reclaimed when scrolled away.
      setVideoLoaded(false);
      return () => {};
    }

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
  }, [remoteUri, shouldLoad]);

  // Drive play/pause from focus. Resuming after the screen/tab regains focus is
  // the flaky case: a single declarative shouldPlay flip (or one early
  // playAsync) often lands before the player is ready and silently no-ops,
  // leaving the video stalled. So we imperatively apply the desired state, and
  // when becoming focused we retry a couple of times and replay if the clip had
  // finished.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoLoaded || hasError) return undefined;

    let cancelled = false;
    const timers = [];

    const apply = async () => {
      if (cancelled) return;
      try {
        if (isFocused) {
          // Restore the caller's intended mute state on resume.
          try { await v.setIsMutedAsync?.(props.isMuted ?? true); } catch { /* best-effort */ }
          const status = (await v.getStatusAsync?.()) || null;
          if (status?.isLoaded && status.didJustFinish) {
            await v.replayAsync?.();
          } else if (!status?.isLoaded || !status.isPlaying) {
            await v.playAsync?.();
          }
        } else {
          // Pausing is the safety-critical path. If this single command races
          // with a heavy navigation transition (e.g. going live, which spins up
          // the camera/encoder) it can be silently dropped on the native side,
          // leaving the feed video playing — and AUDIBLE — behind the live
          // screen. So we mute first (no audio can bleed even for a frame) and
          // then pause, and we retry both below.
          try { await v.setIsMutedAsync?.(true); } catch { /* best-effort */ }
          await v.pauseAsync?.();
        }
      } catch {
        /* best-effort */
      }
    };

    apply();
    // Retry on BOTH paths to defeat the mount/focus/navigation race where the
    // first command is dropped because the native player wasn't ready or the JS
    // thread was busy (most acute when going live pauses the background feed).
    timers.push(setTimeout(apply, 250));
    timers.push(setTimeout(apply, 700));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
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

  // When a caller passes an absolute-fill style (the For You / full-screen
  // feeds), the container must fill its parent exactly. Keeping the default
  // 9:16 aspectRatio in that case fights the top/bottom insets and leaves the
  // video bottom-anchored with a black gap above it ("justified downwards").
  // So drop the aspectRatio fallback whenever an explicit fill is provided;
  // other callers (e.g. fixed-height tiles) still get the 9:16 default.
  const flatStyle = StyleSheet.flatten(props.style) || {};
  const isAbsoluteFill =
    flatStyle.position === 'absolute' && flatStyle.top != null && flatStyle.bottom != null;
  const containerStyle = isAbsoluteFill
    ? [styles.containerFill, props.style]
    : [styles.container, props.style];

  return (
    <View style={containerStyle}>
      {shouldLoad && playableUri && (
        <UnifiedVideo
          ref={videoRef}
          style={styles.video}
          source={{ uri: playableUri }}
          resizeMode={props.resizeMode || "cover"}
          isLooping={props.isLooping ?? true}
          isMuted={(props.isMuted ?? true) || !isFocused}
          shouldPlay={isFocused}
          onLoad={handleLoad}
          onError={handleError}
          onReadyForDisplay={(event) => {
            if (__DEV__) {
              console.log('[EnhancedVideo] onReadyForDisplay');
            }
            setVideoLoaded(true);
            // Surface the video's intrinsic size so callers can top-anchor a
            // "contain" video (the For You feed) instead of centering it.
            const ns = event?.naturalSize;
            if (props.onNaturalSize && ns && ns.width > 0 && ns.height > 0) {
              props.onNaturalSize(ns);
            }
          }}
          onPlaybackStatusUpdate={(status) => {
            props.onPlaybackStatusUpdate?.(status);
            if (__DEV__ && status?.error) {
              console.warn('[EnhancedVideo] playbackStatus error', status.error);
            }
          }}
        />
      )}

      {/* Poster while loading or when this item isn't loading yet, if available */}
      {(!videoLoaded || !shouldLoad) && !hasError && posterUri && (
        <Image
          source={{ uri: posterUri }}
          style={styles.overlay}
          resizeMode={props.resizeMode || 'cover'}
        />
      )}

      {/* Loading spinner only while an in-range video is actually loading */}
      {shouldLoad && !videoLoaded && !hasError && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#00D2BE" />
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
  // Used when the caller supplies an absolute-fill style: fill the parent
  // exactly (no imposed aspect ratio), so the video is never offset.
  containerFill: {
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
    backgroundColor: '#0A0A0C',
  },
});

export default EnhancedVideo;
