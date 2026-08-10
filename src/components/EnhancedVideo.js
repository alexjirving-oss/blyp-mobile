import React, { useEffect, useRef, useState } from 'react';
import { AppState, View, StyleSheet, ActivityIndicator, Image } from 'react-native';
import UnifiedVideo from './UnifiedVideo';
import { getPlayableVideoUri, invalidateCachedVideo, prefetchVideoToCache } from '../utils/videoCache';
import { COLORS } from '../styles/theme';
import { claimFeedAudio, releaseFeedAudio } from '../services/feedAudioSession';
import { ensureMediaPlaybackAudioMode } from '../services/notifySound';

/**
 * Snappy + reliable playback:
 * - Cache hit → play local file immediately (swipe feels instant).
 * - Cache miss → show poster, try progressive stream AND download in parallel.
 * - Many Firebase phone uploads are moov-at-end (won't stream). When download
 *   finishes we switch to the local file only if the stream hasn't painted yet
 *   (never remount a painted neighbor — that killed warm decode on swipe).
 * - Soft unload: dropping shouldLoad tears down the native player but keeps the
 *   resolved URI in a ref so re-entry skips async probe.
 * - Adjacent cells briefly muted-warm the decoder, then park at 0.
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
  const warmedRef = useRef(false);
  /** Soft-retain resolved playable URI across shouldLoad teardown (keyed by remote). */
  const retainedRef = useRef({ remote: null, uri: null });

  const remoteUri = props.uri || props.videoUrl;
  const isFocused = (props.shouldPlay ?? true) && appActive;
  const shouldLoad = props.shouldLoad ?? true;
  const posterUri = props.poster;
  // FlatList recycle: never paint a prior cell's URI under a new remote.
  const safePlayableUri =
    playableUri && retainedRef.current.remote === remoteUri ? playableUri : null;
  const showLoadingSpinner =
    shouldLoad && !videoLoaded && !hasError && (isFocused || !posterUri);

  const rememberPlayable = (uri) => {
    if (!remoteUri || !uri) return;
    retainedRef.current = { remote: remoteUri, uri };
    setPlayableUri(uri);
  };

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
    warmedRef.current = false;

    if (!shouldLoad) {
      // Soft unload: release the native decoder (not rendered) but keep
      // retainedRef so the next shouldLoad mount skips the async cache probe.
      paintedRef.current = false;
      warmedRef.current = false;
      if (retainedRef.current.remote !== remoteUri) {
        setPlayableUri(null);
      }
      setVideoLoaded(false);
      setHasError(false);
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
      rememberPlayable(remoteUri);
      setHasError(false);
      setVideoLoaded(false);
      return () => {};
    }

    const retained =
      retainedRef.current.remote === remoteUri ? retainedRef.current.uri : null;
    if (
      retained &&
      (retained === remoteUri ||
        String(retained).startsWith('file:') ||
        String(retained).startsWith('content:'))
    ) {
      setPlayableUri(retained);
      setHasError(false);
      setVideoLoaded(false);
      if (retained === remoteUri) {
        (async () => {
          try {
            const local = await prefetchVideoToCache(remoteUri);
            if (cancelled || gen !== resolveGen.current) return;
            if (!local || !(local.startsWith('file:') || local.startsWith('content:'))) return;
            if (!paintedRef.current) {
              rememberPlayable(local);
              setHasError(false);
            } else {
              retainedRef.current = { remote: remoteUri, uri: local };
            }
          } catch {
            /* ignore */
          }
        })();
      }
      return () => {
        cancelled = true;
      };
    }

    setVideoLoaded(false);
    setHasError(false);

    (async () => {
      try {
        const cached = await getPlayableVideoUri(remoteUri, { waitForDownload: false });
        if (cancelled || gen !== resolveGen.current) return;

        if (cached && (cached.startsWith('file:') || cached.startsWith('content:'))) {
          rememberPlayable(cached);
          setHasError(false);
          return;
        }

        rememberPlayable(remoteUri);

        const local = await prefetchVideoToCache(remoteUri);
        if (cancelled || gen !== resolveGen.current) return;
        if (!local || !(local.startsWith('file:') || local.startsWith('content:'))) return;

        if (!paintedRef.current) {
          rememberPlayable(local);
          setHasError(false);
        } else {
          retainedRef.current = { remote: remoteUri, uri: local };
        }
      } catch (error) {
        if (cancelled || gen !== resolveGen.current) return;
        if (__DEV__) {
          console.warn('[EnhancedVideo] URI resolution failed, using remote', { error });
        }
        rememberPlayable(remoteUri);
        setHasError(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteUri, shouldLoad]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoLoaded || hasError) return undefined;

    let cancelled = false;
    const timers = [];
    const wantMuted = props.isMuted ?? true;
    const ownerId =
      props.audioOwnerId != null && String(props.audioOwnerId).trim()
        ? String(props.audioOwnerId)
        : null;

    const apply = async () => {
      if (cancelled) return false;
      try {
        const status = (await v.getStatusAsync?.()) || null;
        if (cancelled) return false;

        if (isFocused) {
          if (!wantMuted && ownerId) {
            const owned = await claimFeedAudio(ownerId);
            if (cancelled || !owned) return false;
          } else if (!wantMuted) {
            await ensureMediaPlaybackAudioMode({ background: false }).catch(() => {});
          }

          if (status?.isLoaded) {
            const targetVolume = wantMuted ? 0 : 1;
            if (typeof status.volume === 'number' && status.volume !== targetVolume) {
              try {
                await v.setVolumeAsync?.(targetVolume);
              } catch {
                /* best-effort */
              }
            }
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
              return false;
            }
            return true;
          }
          try {
            await v.setVolumeAsync?.(wantMuted ? 0 : 1);
          } catch {
            /* best-effort */
          }
          try {
            await v.setIsMutedAsync?.(wantMuted);
          } catch {
            /* best-effort */
          }
          await v.playAsync?.();
          return false;
        }

        // Inactive: only kill audible bleed. Silent muted neighbor-warm may be
        // playing briefly to prime the decoder — leave that alone.
        if (ownerId) releaseFeedAudio(ownerId);
        const audible =
          status?.isLoaded &&
          (status.isMuted === false ||
            (typeof status.volume === 'number' && status.volume > 0));
        if (audible) {
          try {
            await v.setVolumeAsync?.(0);
          } catch {
            /* best-effort */
          }
          try {
            await v.setIsMutedAsync?.(true);
          } catch {
            /* best-effort */
          }
          if (status.isPlaying) {
            await v.pauseAsync?.();
          }
          return false;
        }
        return true;
      } catch {
        return false;
      }
    };

    (async () => {
      const settled = await apply();
      if (cancelled || settled) return;
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
      if (ownerId && !isFocused) releaseFeedAudio(ownerId);
    };
  }, [isFocused, videoLoaded, hasError, props.isMuted, props.audioOwnerId]);

  // TikTok-style neighbor warm: pull first GOPs muted, then park at 0.
  // Never claims feed audio / never calls setAudioModeAsync (Stage-safe).
  // Re-warm when the cell is re-loaded after a soft unload so fast reverse swipes
  // still land on a primed decoder.
  useEffect(() => {
    if (!shouldLoad || isFocused || !videoLoaded || hasError || !playableUri) return undefined;
    const v = videoRef.current;
    if (!v) return undefined;
    if (warmedRef.current) return undefined;

    let cancelled = false;
    warmedRef.current = true;

    (async () => {
      try {
        try {
          await v.setVolumeAsync?.(0);
        } catch {
          /* best-effort */
        }
        try {
          await v.setIsMutedAsync?.(true);
        } catch {
          /* best-effort */
        }
        await v.playAsync?.();
        // Short prime only for farther parked cells. Nearest ± neighbors stay in
        // continuous muted decode via shouldPlay (HomeScreen keepDecodeHot).
        await new Promise((r) => setTimeout(r, 180));
        if (cancelled) return;
        const stillUnfocused = !((props.shouldPlay ?? true) && AppState.currentState === 'active');
        if (!stillUnfocused) return;
        await v.pauseAsync?.();
        try {
          await v.setPositionAsync?.(0);
        } catch {
          /* best-effort */
        }
      } catch {
        /* warm is best-effort */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldLoad, isFocused, videoLoaded, hasError, playableUri, props.shouldPlay]);

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
    warmedRef.current = false;
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
          rememberPlayable(retry);
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

  const uriKey =
    safePlayableUri &&
    (String(safePlayableUri).startsWith('file:') ||
      String(safePlayableUri).startsWith('content:'))
      ? `local:${remoteUri || safePlayableUri}`
      : `net:${remoteUri || safePlayableUri}`;

  return (
    <View style={containerStyle}>
      {shouldLoad && safePlayableUri && (
        <UnifiedVideo
          // Remount only when switching remote↔local before first paint.
          // After paint we keep the key stable by refusing stream→local swaps.
          key={uriKey}
          ref={videoRef}
          style={styles.video}
          source={{ uri: safePlayableUri }}
          resizeMode={props.resizeMode || 'contain'}
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
          resizeMode={props.resizeMode || 'contain'}
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
