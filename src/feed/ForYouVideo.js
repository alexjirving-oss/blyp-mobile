import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../styles/theme';
import { nextPlayableUri } from './resolvePlayableUri';
import { getShortsView, isShortsAvailable } from './ShortsNative';
import {
  syncForYouAudioOwnership,
  releaseForYouAudio,
  isForYouAudioOwner,
} from './forYouAudio';

/** Spinner only after this ms — avoids flash on fast first-frame reveals. */
const SPINNER_DELAY_MS = 280;

/**
 * For You cell playback host — sole production path (DESIGN).
 * BlypShorts only. No storm FeedPlayer. No expo-av production fallback.
 *
 * Layout contract: root is a fixed frame (caller sizes it). Poster + native
 * surface + spinner are absolute overlays — never change parent size on
 * videoSize / ready. Reveal first frame in-place over the poster.
 */
export default function ForYouVideo({
  uri,
  fallbackUris = null,
  poster,
  style,
  shouldPlay = false,
  shouldLoad = true,
  isMuted = true,
  role = 'active',
  seekToZero = false,
  resizeMode = 'cover',
  audioOwnerId = null,
  onReady,
  onError,
  onNaturalSize,
  onPlaybackStatusUpdate,
}) {
  const shortsOk = isShortsAvailable();
  const ShortsView = useMemo(() => (shortsOk ? getShortsView() : null), [shortsOk]);

  const ladder = useMemo(() => {
    const primary = typeof uri === 'string' && uri.trim() ? uri.trim() : null;
    const extras = Array.isArray(fallbackUris)
      ? fallbackUris.filter((u) => typeof u === 'string' && u.trim())
      : [];
    const out = [];
    if (primary) out.push(primary);
    for (const u of extras) {
      if (!out.includes(u)) out.push(u);
    }
    return out;
  }, [uri, fallbackUris]);

  const [activeUri, setActiveUri] = useState(ladder[0] || null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // -1 idle; >=0 seeks in place (no ShortsView remount).
  const [seekToMs, setSeekToMs] = useState(-1);
  const [showSpinner, setShowSpinner] = useState(false);
  const ownedRef = useRef(false);
  const ladderRef = useRef(ladder);
  const wasActiveRef = useRef(false);
  const seekPulseRef = useRef(false);
  ladderRef.current = ladder;

  useEffect(() => {
    setActiveUri(ladder[0] || null);
    setReady(false);
    setFailed(false);
    setShowSpinner(false);
    setSeekToMs(-1);
  }, [ladder]);

  // Seek-to-0 on become-active only (edge) — reuse native view, do not remount.
  useEffect(() => {
    const isActiveRole = role === 'active' && shouldPlay;
    const becameActive = isActiveRole && !wasActiveRef.current;
    const pulse = !!seekToZero && !seekPulseRef.current && isActiveRole;
    if (becameActive || pulse) {
      setSeekToMs(0);
    }
    wasActiveRef.current = isActiveRole;
    seekPulseRef.current = !!seekToZero && isActiveRole;
  }, [role, shouldPlay, seekToZero, activeUri]);

  // Clear seek prop so the next edge can re-fire seekToMs=0.
  useEffect(() => {
    if (seekToMs < 0) return undefined;
    const t = requestAnimationFrame(() => setSeekToMs(-1));
    return () => cancelAnimationFrame(t);
  }, [seekToMs]);

  // Delayed spinner — absolute overlay, never shifts layout.
  useEffect(() => {
    if (ready || failed || !shouldPlay || !shouldLoad || !activeUri) {
      setShowSpinner(false);
      return undefined;
    }
    const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [ready, failed, shouldPlay, shouldLoad, activeUri]);

  useEffect(() => {
    let cancelled = false;
    const ownerId =
      audioOwnerId != null && String(audioOwnerId).trim()
        ? String(audioOwnerId)
        : null;

    (async () => {
      if (!ownerId) return;
      const owned = await syncForYouAudioOwnership({
        audioOwnerId: ownerId,
        shouldPlay,
        isMuted,
        shouldLoad,
      });
      if (cancelled) return;
      ownedRef.current = !!owned;
    })();

    return () => {
      cancelled = true;
      if (ownerId && ownedRef.current) {
        releaseForYouAudio(ownerId);
        ownedRef.current = false;
      }
    };
  }, [shouldLoad, shouldPlay, isMuted, audioOwnerId]);

  const onNativeReady = useCallback(
    (e) => {
      setReady(true);
      setShowSpinner(false);
      onReady?.(e?.nativeEvent || e);
      onPlaybackStatusUpdate?.({ isLoaded: true, isPlaying: !!shouldPlay, positionMillis: 0 });
    },
    [onReady, onPlaybackStatusUpdate, shouldPlay],
  );

  const onNativeFirstFrame = useCallback(
    (e) => {
      setReady(true);
      setShowSpinner(false);
      onReady?.(e?.nativeEvent || e);
    },
    [onReady],
  );

  const onNativeError = useCallback(
    (e) => {
      const next = nextPlayableUri(ladderRef.current, activeUri);
      if (next && next !== activeUri) {
        setReady(false);
        setShowSpinner(false);
        setActiveUri(next);
        return;
      }
      setFailed(true);
      setShowSpinner(false);
      onError?.(e?.nativeEvent || e);
    },
    [activeUri, onError],
  );

  const onNativeSize = useCallback(
    (e) => {
      // Size is for chrome / analytics only — never mutate layout here.
      const { width, height } = e?.nativeEvent || {};
      if (width > 0 && height > 0) onNaturalSize?.({ width, height });
    },
    [onNaturalSize],
  );

  if (!shouldLoad || !activeUri) {
    return (
      <View style={[styles.root, style]}>
        {!!poster && (
          <Image source={{ uri: poster }} style={styles.layer} resizeMode="cover" />
        )}
      </View>
    );
  }

  // Production path: no expo-av. Missing native → visible hard fail (poster + label).
  if (!shortsOk || !ShortsView || failed) {
    return (
      <View style={[styles.root, style]}>
        {!!poster && (
          <Image source={{ uri: poster }} style={styles.layer} resizeMode="cover" />
        )}
        <View style={styles.failBanner} pointerEvents="none">
          <Text style={styles.failText} allowFontScaling={false}>
            {failed ? 'Video unavailable' : 'For You player not linked'}
          </Text>
        </View>
      </View>
    );
  }

  const audible =
    shouldPlay &&
    !isMuted &&
    (!audioOwnerId || isForYouAudioOwner(audioOwnerId) || ownedRef.current);

  return (
    <View style={[styles.root, style]}>
      {/* Poster stays until first frame so reveal never collapses the cell. */}
      {!!poster && !ready && (
        <Image source={{ uri: poster }} style={styles.layer} resizeMode="cover" />
      )}
      <ShortsView
        style={styles.layer}
        uri={activeUri}
        role={role === 'neighbor' ? 'neighbor' : 'active'}
        playing={!!shouldPlay}
        muted={!audible}
        seekToMs={seekToMs}
        resizeMode={resizeMode === 'contain' ? 'contain' : 'cover'}
        onReady={onNativeReady}
        onFirstFrame={onNativeFirstFrame}
        onVideoSize={onNativeSize}
        onError={onNativeError}
      />
      {showSpinner && (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={COLORS.primary || '#00D2BE'} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
  spinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failBanner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 24,
  },
  failText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
