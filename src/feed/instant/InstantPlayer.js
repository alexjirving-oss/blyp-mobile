/**
 * Instant cell player — BlypShorts only.
 * Rule: active plays unmuted; neighbors preload muted; never seek on promote.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../styles/theme';
import { nextPlayableUri } from '../resolvePlayableUri';
import { getShortsView, isShortsAvailable } from '../ShortsNative';
import { nativeMuted } from './audio';

const SPINNER_DELAY_MS = 320;

export default function InstantPlayer({
  uri,
  fallbackUris = null,
  poster,
  style,
  shouldPlay = false,
  shouldLoad = true,
  isMuted = true,
  role = 'active',
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
  const [showSpinner, setShowSpinner] = useState(false);
  const ladderRef = useRef(ladder);
  ladderRef.current = ladder;

  useEffect(() => {
    setActiveUri(ladder[0] || null);
    setReady(false);
    setFailed(false);
    setShowSpinner(false);
  }, [ladder]);

  useEffect(() => {
    if (ready || failed || !shouldPlay || !shouldLoad || !activeUri) {
      setShowSpinner(false);
      return undefined;
    }
    const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [ready, failed, shouldPlay, shouldLoad, activeUri]);

  const onNativeReady = useCallback(() => {
    setReady(true);
    setShowSpinner(false);
  }, []);

  const onNativeFirstFrame = useCallback(() => {
    setReady(true);
    setShowSpinner(false);
  }, []);

  const onNativeError = useCallback(() => {
    const next = nextPlayableUri(ladderRef.current, activeUri);
    if (next && next !== activeUri) {
      setReady(false);
      setShowSpinner(false);
      setActiveUri(next);
      return;
    }
    setFailed(true);
    setShowSpinner(false);
  }, [activeUri]);

  if (!shouldLoad || !activeUri) {
    return (
      <View style={[styles.root, style]}>
        {!!poster && (
          <Image source={{ uri: poster }} style={styles.layer} resizeMode="cover" />
        )}
      </View>
    );
  }

  if (!shortsOk || !ShortsView || failed) {
    return (
      <View style={[styles.root, style]}>
        {!!poster && (
          <Image source={{ uri: poster }} style={styles.layer} resizeMode="cover" />
        )}
        <View style={styles.failBanner} pointerEvents="none">
          <Text style={styles.failText} allowFontScaling={false}>
            {failed ? 'Video unavailable' : 'Player not linked'}
          </Text>
        </View>
      </View>
    );
  }

  const muted = nativeMuted({ shouldPlay, isMuted });

  return (
    <View style={[styles.root, style]}>
      {!!poster && !ready && (
        <Image source={{ uri: poster }} style={styles.layer} resizeMode="cover" />
      )}
      <ShortsView
        style={styles.layer}
        uri={activeUri}
        role={role === 'neighbor' ? 'neighbor' : 'active'}
        playing={!!shouldPlay}
        muted={muted}
        seekToMs={-1}
        resizeMode="none"
        onReady={onNativeReady}
        onFirstFrame={onNativeFirstFrame}
        onError={onNativeError}
      />
      {showSpinner ? (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : null}
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
