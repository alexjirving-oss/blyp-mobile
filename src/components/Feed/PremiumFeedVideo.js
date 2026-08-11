import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ForYouVideo from '../../feed/ForYouVideo';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { FEED_VIDEO_VERTICAL_NUDGE_Y } from './feedVideoLayout';

const { width: FRAME_W, height: FRAME_H } = Dimensions.get('window');

/**
 * PremiumFeedVideo — full-screen VOD playback chrome.
 *
 * Frame is always absolute-fill (TikTok-stable). Natural size / aspect never
 * changes parent layout — fit is handled inside ForYouVideo / BlypShorts via
 * contain|cover matrix. Wide clips may paint a bottom fade once aspect is
 * known; that is overlay-only and does not reflow the cell.
 *
 * Cover / custom-fit frames apply FEED_VIDEO_VERTICAL_NUDGE_Y so the subject
 * sits optically between header chrome and the absolute tab bar / viewer footer.
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
  const [aspect, setAspect] = useState(0);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const lastProgressEmitRef = useRef(0);
  const pauseOpacity = useRef(new Animated.Value(0)).current;
  const playing = shouldPlay && !paused;

  const fitMode = mediaDisplay?.fitMode;
  // Zoom-out (0.5) through zoom-in (2.5) — must match VideoFramingSheet / postEditService.
  const userScale = Math.min(2.5, Math.max(0.5, Number(mediaDisplay?.scale) || 1));
  const offsetX = Math.min(1, Math.max(-1, Number(mediaDisplay?.offsetX) || 0));
  const offsetY = Math.min(1, Math.max(-1, Number(mediaDisplay?.offsetY) || 0));
  // Only an explicit creator choice of `cover` crops; auto/missing/contain → fit.
  const useCover = fitMode === 'cover';

  const isWide = !useCover && aspect > 1.15;
  const resizeMode = useCover ? 'cover' : 'contain';

  // New source → forget prior aspect (chrome only; never drives layout).
  useEffect(() => {
    setAspect(0);
  }, [uri]);

  useEffect(() => {
    Animated.timing(pauseOpacity, {
      toValue: paused ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [paused, pauseOpacity]);

  const handleNaturalSize = useCallback(
    (ns) => {
      if (ns?.width > 0 && ns?.height > 0) {
        const a = ns.width / ns.height;
        if (a > 0) setAspect((prev) => (Math.abs(prev - a) < 0.001 ? prev : a));
      }
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

  const framingTransform = useMemo(() => {
    if (!mediaDisplay) return null;
    // Map normalized offsets (-1..1) to real screen travel so drag/nudge
    // actually repositions the clip. Use |scale - 1| so zoom-out (<1) gets
    // a usable pan range (sliding the smaller video within the frame).
    const scaleDelta = Math.abs(userScale - 1);
    const overflowX = Math.max(
      FRAME_W * (userScale < 1 ? 0.4 : 0.28),
      (FRAME_W * scaleDelta) / 2,
    );
    const overflowY = Math.max(
      FRAME_H * (userScale < 1 ? 0.32 : 0.22),
      (FRAME_H * scaleDelta) / 2,
    );
    const tx = offsetX * overflowX;
    const ty = offsetY * overflowY;
    if (userScale === 1 && tx === 0 && ty === 0 && !mediaDisplay?.fitMode) return null;
    return [{ translateX: tx }, { translateY: ty }, { scale: userScale }];
  }, [mediaDisplay, offsetX, offsetY, userScale]);

  // Fixed host: optical nudge + creator framing via transform only (no layout).
  const hostTransform = useMemo(() => {
    const parts = [];
    if (FEED_VIDEO_VERTICAL_NUDGE_Y) {
      parts.push({ translateY: FEED_VIDEO_VERTICAL_NUDGE_Y });
    }
    if (framingTransform) parts.push(...framingTransform);
    return parts.length ? parts : null;
  }, [framingTransform]);

  return (
    <View style={[styles.root, style]}>
      <View style={[styles.videoHost, hostTransform ? { transform: hostTransform } : null]}>
        <ForYouVideo
          uri={uri}
          fallbackUris={fallbackUris}
          poster={poster}
          style={StyleSheet.absoluteFill}
          resizeMode={resizeMode}
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
          {isWide && (
            <LinearGradient
              pointerEvents="none"
              colors={['transparent', 'rgba(10,10,12,0.9)', COLORS.pageBackground]}
              style={styles.wideFade}
            />
          )}
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
  wideFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '28%',
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
