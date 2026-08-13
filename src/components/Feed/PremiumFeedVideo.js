import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ForYouVideo from '../../feed/ForYouVideo';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
/**
 * PremiumFeedVideo — full-screen VOD playback chrome.
 * Diagnostic: no cover/contain, no mediaDisplay framing, no Y nudge.
 */
export default function PremiumFeedVideo({
  uri,
  poster,
  style,
  shouldPlay = false,
  shouldLoad = true,
  isMuted = false,
  isLooping = true,
  paused = false,
  showChrome = true,
  mediaDisplay = null,
  audioOwnerId = null,
  role = 'active',
  seekToZero = false,
  settled = false,
  fallbackUris = null,
  onNaturalSize,
  onError,
  onReady,
  onProgress,
}) {
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const lastProgressEmitRef = useRef(0);
  const pauseOpacity = useRef(new Animated.Value(0)).current;
  const playing = shouldPlay && !paused;

  useEffect(() => {
    Animated.timing(pauseOpacity, {
      toValue: paused ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [paused, pauseOpacity]);

  const handleNaturalSize = useCallback(
    (ns) => {
      // Chrome/analytics only — never setState aspect / never reflow layout.
      onNaturalSize?.(ns);
    },
    [onNaturalSize],
  );

  const handleStatus = useCallback(
    (status) => {
      if (!status?.isLoaded) return;
      const dur = status.durationMillis || 0;
      const pos = status.positionMillis || 0;
      const next = dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : 0;
      // Throttle progress setState — status fires ~4–10×/s and was janking swipe JS.
      const now = Date.now();
      if (Math.abs(next - progressRef.current) < 0.02 && now - lastProgressEmitRef.current < 120) {
        return;
      }
      lastProgressEmitRef.current = now;
      progressRef.current = next;
      setProgress(next);
      onProgress?.(next, status);
    },
    [onProgress],
  );

  return (
    <View style={[styles.root, style]}>
      <View style={styles.videoHost}>
        <ForYouVideo
          uri={uri}
          fallbackUris={fallbackUris}
          poster={poster}
          style={StyleSheet.absoluteFill}
          shouldPlay={playing}
          shouldLoad={shouldLoad}
          isMuted={isMuted}
          role={role}
          seekToZero={!!seekToZero}
          audioOwnerId={audioOwnerId}
          onNaturalSize={handleNaturalSize}
          onError={onError}
          onReady={onReady}
          onPlaybackStatusUpdate={handleStatus}
        />
      </View>

      {showChrome && (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(10,10,12,0.55)', 'transparent', 'transparent']}
            locations={[0, 0.22, 1]}
            style={styles.topVignette}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['transparent', 'rgba(10,10,12,0.35)', 'rgba(10,10,12,0.92)']}
            locations={[0.35, 0.7, 1]}
            style={styles.bottomVignette}
          />
        </>
      )}

      <Animated.View
        pointerEvents="none"
        style={[styles.pauseWrap, { opacity: pauseOpacity }]}
      >
        <View style={styles.pauseGlyph}>
          <Icon name="play" size={36} color="#0A0A0C" />
        </View>
      </Animated.View>

      {showChrome && (
        <View style={styles.progressTrack} pointerEvents="none">
          <View style={[styles.progressFill, { flex: Math.max(progress, 0.01) }]} />
          <View style={{ flex: Math.max(1 - progress, 0.001) }} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.pageBackground,
    overflow: 'hidden',
  },
  videoHost: {
    ...StyleSheet.absoluteFillObject,
  },
  topVignette: {
    ...StyleSheet.absoluteFillObject,
  },
  bottomVignette: {
    ...StyleSheet.absoluteFillObject,
  },
  pauseWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pauseGlyph: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  progressTrack: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 10,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
});
