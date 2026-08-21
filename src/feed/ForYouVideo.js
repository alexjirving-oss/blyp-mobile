import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../styles/theme';
import { nextPlayableUri } from './resolvePlayableUri';
import { getShortsView, isShortsAvailable } from './ShortsNative';
import {
  syncForYouAudioOwnership,
  releaseForYouAudio,
  forYouNativeMuted,
} from './forYouAudio';
import { buildLadderKey, ladderFromKey } from './forYouLadder';

/** Spinner only after this ms — avoids flash on fast first-frame reveals. */
const SPINNER_DELAY_MS = 280;

/**
 * For You cell playback host — sole production path (DESIGN).
 * BlypShorts only. No storm FeedPlayer. No expo-av production fallback.
 *
 * Layout contract: root is a fixed frame (caller sizes it). Poster + native
 * surface + spinner are absolute overlays — never change parent size on
 * videoSize / ready. Reveal first frame in-place over the poster.
 *
 * Critical: ladder resets only when URI *content* changes. Parent FlatList
 * re-renders pass a fresh fallbackUris array every time; treating that as a
 * new ladder was clearing ready and flashing poster→video twice per land.
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

  const ladderKey = buildLadderKey(uri, fallbackUris);
  const ladder = useMemo(() => ladderFromKey(ladderKey), [ladderKey]);

  const [activeUri, setActiveUri] = useState(ladder[0] || null);
  // Poster stays until first painted frame — STATE_READY alone is a black flash.
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const [failed, setFailed] = useState(false);
  // -1 idle; >=0 seeks in place (no ShortsView remount). Never used on promote.
  const [seekToMs, setSeekToMs] = useState(-1);
  const [showSpinner, setShowSpinner] = useState(false);
  const ownedRef = useRef(false);
  const ladderRef = useRef(ladder);
  ladderRef.current = ladder;

  useEffect(() => {
    setActiveUri(ladder[0] || null);
    setHasFirstFrame(false);
    setFailed(false);
    setShowSpinner(false);
    setSeekToMs(-1);
  }, [ladderKey]);

  // Delayed spinner — absolute overlay, never shifts layout.
  useEffect(() => {
    if (hasFirstFrame || failed || !shouldPlay || !shouldLoad || !activeUri) {
      setShowSpinner(false);
      return undefined;
    }
    const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [hasFirstFrame, failed, shouldPlay, shouldLoad, activeUri]);

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
      // Do NOT clear poster here — READY can fire before the first frame paints.
      onReady?.(e?.nativeEvent || e);
      onPlaybackStatusUpdate?.({ isLoaded: true, isPlaying: !!shouldPlay, positionMillis: 0 });
    },
    [onReady, onPlaybackStatusUpdate, shouldPlay],
  );

  const onNativeFirstFrame = useCallback(
    (e) => {
      setHasFirstFrame(true);
      setShowSpinner(false);
      onReady?.(e?.nativeEvent || e);
    },
    [onReady],
  );

  const onNativeError = useCallback(
    (e) => {
      const next = nextPlayableUri(ladderRef.current, activeUri);
      if (next && next !== activeUri) {
        setHasFirstFrame(false);
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

  // Mute follows the controller only. Gating on async claimFeedAudio left the
  // active cell muted (ownedRef never re-rendered) or unmuted then remuted
  // when setAudioModeAsync ran a second time.
  const nativeMuted = forYouNativeMuted({ shouldPlay, isMuted });

  return (
    <View style={[styles.root, style]}>
      {/* Native under poster: TextureView alpha=0 punches black; poster-on-top
          hides any pre-cover frame until onFirstFrame (1.0.85 opposite bug). */}
      <ShortsView
        style={styles.layer}
        uri={activeUri}
        role={role === 'neighbor' ? 'neighbor' : 'active'}
        playing={!!shouldPlay}
        muted={nativeMuted}
        seekToMs={seekToMs}
        resizeMode="cover"
        onReady={onNativeReady}
        onFirstFrame={onNativeFirstFrame}
        onVideoSize={onNativeSize}
        onError={onNativeError}
      />
      {!!poster && !hasFirstFrame && (
        <Image source={{ uri: poster }} style={styles.layer} resizeMode="cover" />
      )}
      {showSpinner && (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={COLORS.primary} />
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
