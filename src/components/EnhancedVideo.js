import React, { useEffect, useRef, useState } from 'react';
import { AppState, View, StyleSheet, ActivityIndicator, Image } from 'react-native';
import UnifiedVideo from './UnifiedVideo';
import { getPlayableVideoUri, invalidateCachedVideo, prefetchVideoToCache } from '../utils/videoCache';
import { COLORS } from '../styles/theme';

/**
 * Snappy + reliable playback:
 * - Cache hit → play local file immediately (swipe feels instant).
 * - Cache miss → show poster, try progressive stream AND download in parallel.
 * - Many Firebase phone uploads are moov-at-end (won't stream). When download
 *   finishes we switch to the local file if the stream hasn't painted yet, or
 *   on stream error.
 * - Teal loading spiral while the focused cell is resolving/buffering to first
 *   frame (poster may sit underneath). Hidden once ready/playing, or on error.
 */
function EnhancedVideo(props) {
  const videoRef = useRef(null);
  const [playableUri, setPlayableUri] = useState(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const resolveGen = useRef(0);
  const sourceHttpRef = useRef(null);
  const paintedRef = useRef(false);

  const remoteUri = props.uri || props.videoUrl;
  const isFocused = (props.shouldPlay ?? true) && appActive;
  const shouldLoad = props.shouldLoad ?? true;
  const posterUri = props.poster;
  // Active / playing intent: always show teal spiral until first frame.
  // Off-screen preload with a poster: keep poster only (no stacked spinners).
  // No poster: spiral even when off-screen so we never flash a dead black frame.
  const showLoadingSpinner = shouldLoad && !videoLoaded && !hasError && (isFocused || !posterUri);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setAppActive(next === 'active');
    });
    return () => {
      try {
        sub?.remove?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const gen = (resolveGen.current += 1);
    paintedRef.current = false;

    if (!shouldLoad) {
      setVideoLoaded(false);
      return () => {};
    }

    if (!remoteUri) {
      setPlayableUri(null);
      setHasError(true);
      return () => {};
    }

    const isLocal = remoteUri.startsWith('file:') || remoteUri.startsWith('content:');
    sourceHttpRef.current =
      remoteUri.startsWith('http://') || remoteUri.startsWith('https://') ? remoteUri : null;

    if (isLocal) {
      setPlayableUri(remoteUri);
      setHasError(false);
      setVideoLoaded(false);
      return () => {};
    }

    setVideoLoaded(false);
    setHasError(false);

    (async () => {
      try {
        // Fast path: already on disk from prefetch.
        const cached = await getPlayableVideoUri(remoteUri, { waitForDownload: false });
        if (cancelled || gen !== resolveGen.current) return;

        if (cached && (cached.startsWith('file:') || cached.startsWith('content:'))) {
          setPlayableUri(cached);
          setHasError(false);
          return;
        }

        // Start progressive stream immediately for clips that support it.
        setPlayableUri(remoteUri);

        // Parallel full download — required for moov-at-end MP4s, and warms swipe.
        const local = await prefetchVideoToCache(remoteUri);
        if (cancelled || gen !== resolveGen.current) return;
        if (!local || !(local.startsWith('file:') || local.startsWith('content:'))) return;

        // Switch to local if stream never painted, or always upgrade when idle.
        if (!paintedRef.current || !isFocused) {
          setPlayableUri(local);
          setHasError(false);
        }
      } catch (error) {
        if (cancelled || gen !== resolveGen.current) return;
        if (__DEV__) {
          console.warn('[EnhancedVideo] URI resolution failed, using remote', { error });
        }
        setPlayableUri(remoteUri);
        setHasError(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remoteUri, shouldLoad]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoLoaded || hasError) return undefined;

    let cancelled = false;
    const timers = [];
    const wantMuted = props.isMuted ?? true;

    // Imperative mute/play must be idempotent. Neighbor preload cells (±2) finish
    // loading and used to spam setIsMutedAsync(true)+pauseAsync, which steals
    // Android audio focus from the active For You player → audible mute flicker.
    const apply = async () => {
      if (cancelled) return false;
      try {
        const status = (await v.getStatusAsync?.()) || null;
        if (cancelled) return false;

        if (isFocused) {
          if (status?.isLoaded) {
            if (status.isMuted !== wantMuted) {
              try {
                await v.setIsMutedAsync?.(wantMuted);
              } catch {
                /* best-effort */
              }
            }
            if (status.didJustFinish) {
              await v.replayAsync?.();
              return true;
            }
            if (!status.isPlaying) {
              await v.playAsync?.();
              return false; // may still be buffering — retry
            }
            return true; // already playing at intended mute
          }
          try {
            await v.setIsMutedAsync?.(wantMuted);
          } catch {
            /* best-effort */
          }
          await v.playAsync?.();
          return false;
        }

        // Inactive / blurred: only touch native audio if something is still
        // audible or playing. Silent no-ops avoid focus thrash with the active cell.
        if (status?.isLoaded && (status.isPlaying || status.isMuted === false)) {
          try {
            await v.setIsMutedAsync?.(true);
          } catch {
            /* best-effort */
          }
          if (status.isPlaying) {
            await v.pauseAsync?.();
          }
          return false; // one safety retry for navigation bleed
        }
        return true;
      } catch {
        return false;
      }
    };

    (async () => {
      const settled = await apply();
      if (cancelled || settled) return;
      // Focused: retry until playing. Unfocused audible: one bleed-safety retry.
      // Never schedule the old fixed 200/500 spam on every preload load.
      timers.push(
        setTimeout(() => {
          apply().then((done) => {
            if (cancelled || done || !isFocused) return;
            timers.push(setTimeout(() => apply(), 400));
          });
        }, 220),
      );
    })();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [isFocused, videoLoaded, hasError, props.isMuted]);

  const emitNaturalSize = (raw) => {
    if (!props.onNaturalSize || !raw || !(raw.width > 0) || !(raw.height > 0)) return;
    let width = Number(raw.width);
    let height = Number(raw.height);
    const orientation = String(raw.orientation || '').toLowerCase();
    if (
      (orientation === 'left' || orientation === 'right') &&
      width > 0 &&
      height > 0 &&
      width < height
    ) {
      const tmp = width;
      width = height;
      height = tmp;
    }
    props.onNaturalSize({ width, height, orientation: raw.orientation });
  };

  const handleLoad = (status) => {
    paintedRef.current = true;
    setVideoLoaded(true);
    setHasError(false);
    if (props.onReady) props.onReady();
    emitNaturalSize(status?.naturalSize);
  };

  const handleError = (error) => {
    console.warn('[EnhancedVideo] onError', error);
    setHasError(true);
    setVideoLoaded(false);
    paintedRef.current = false;
    if (props.onError) props.onError(error);

    const httpSource = sourceHttpRef.current || remoteUri;
    if (httpSource && (httpSource.startsWith('http://') || httpSource.startsWith('https://'))) {
      const gen = resolveGen.current;
      (async () => {
        try {
          await invalidateCachedVideo(playableUri);
          await invalidateCachedVideo(httpSource);
          const retry = await prefetchVideoToCache(httpSource);
          if (gen !== resolveGen.current || !retry) return;
          setPlayableUri(retry);
          setHasError(false);
          setVideoLoaded(false);
        } catch {
          /* leave error state */
        }
      })();
    }
  };

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
          // Remount only when switching remote↔local (expo-av often ignores source
          // updates). Same remote keeps one instance so stream→local is one swap, not thrash.
          key={
            playableUri &&
            (String(playableUri).startsWith('file:') || String(playableUri).startsWith('content:'))
              ? `local:${remoteUri || playableUri}`
              : `net:${remoteUri || playableUri}`
          }
          ref={videoRef}
          style={styles.video}
          source={{ uri: playableUri }}
          resizeMode={props.resizeMode || 'cover'}
          isLooping={props.isLooping ?? true}
          isMuted={(props.isMuted ?? true) || !isFocused}
          shouldPlay={isFocused}
          onLoad={handleLoad}
          onError={handleError}
          onReadyForDisplay={(event) => {
            paintedRef.current = true;
            setVideoLoaded(true);
            emitNaturalSize(event?.naturalSize);
          }}
          onPlaybackStatusUpdate={(status) => {
            props.onPlaybackStatusUpdate?.(status);
            if (status?.isLoaded && (status.isPlaying || status.positionMillis > 0)) {
              paintedRef.current = true;
              setVideoLoaded(true);
            }
          }}
        />
      )}

      {(!videoLoaded || !shouldLoad) && !hasError && posterUri && (
        <Image
          source={{ uri: posterUri }}
          style={styles.overlay}
          resizeMode={props.resizeMode || 'cover'}
        />
      )}

      {showLoadingSpinner && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      )}

      {hasError && <View style={styles.errorOverlay} />}
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
