// Lightweight winner celebration + Rematch CTA for live 1v1 matches.
// Uses a small pool of Animated particles (no heavy libs) so live stays smooth.

import React, { useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, Animated, Easing, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import Icon from '../Icon';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import { MATCH_BAR_LEFT, MATCH_BAR_RIGHT } from './MatchBar';

const PARTICLE_COUNT = 18;
const COLORS_POOL = [MATCH_BAR_LEFT, MATCH_BAR_RIGHT, '#FFD54A', '#FFFFFF', '#FB7185'];

function ConfettiBurst({ active }) {
  const pieces = useMemo(
    () => Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      id: i,
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      o: new Animated.Value(0),
      r: new Animated.Value(0),
      color: COLORS_POOL[i % COLORS_POOL.length],
      w: 4 + (i % 3) * 2,
      h: 6 + (i % 4) * 2,
    })),
    []
  );
  const ranRef = useRef(false);

  useEffect(() => {
    if (!active) {
      ranRef.current = false;
      return;
    }
    if (ranRef.current) return;
    ranRef.current = true;
    pieces.forEach((p, i) => {
      const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (i % 2) * 0.2;
      const dist = 50 + (i % 5) * 18;
      p.x.setValue(0);
      p.y.setValue(0);
      p.o.setValue(1);
      p.r.setValue(0);
      Animated.parallel([
        Animated.timing(p.x, {
          toValue: Math.cos(angle) * dist,
          duration: 900 + (i % 4) * 80,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(p.y, {
          toValue: Math.sin(angle) * dist * 0.55 + 40 + (i % 3) * 12,
          duration: 950 + (i % 4) * 70,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(p.r, {
          toValue: (i % 2 === 0 ? 1 : -1) * (2 + (i % 3)),
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(420),
          Animated.timing(p.o, { toValue: 0, duration: 480, useNativeDriver: true }),
        ]),
      ]).start();
    });
  }, [active, pieces]);

  if (!active) return null;
  return (
    <View style={styles.confetti} pointerEvents="none">
      {pieces.map((p) => (
        <Animated.View
          key={p.id}
          style={{
            position: 'absolute',
            width: p.w,
            height: p.h,
            borderRadius: 1,
            backgroundColor: p.color,
            opacity: p.o,
            transform: [
              { translateX: p.x },
              { translateY: p.y },
              { rotate: p.r.interpolate({
                inputRange: [-4, 4],
                outputRange: ['-240deg', '240deg'],
              }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

/**
 * @param {object} props
 * @param {string} props.title
 * @param {'creator'|'opponent'|null} props.winnerSide
 * @param {boolean} [props.canRematch]
 * @param {boolean} [props.rematching]
 * @param {() => void} [props.onRematch]
 */
export default function MatchWinBanner({
  title,
  winnerSide,
  canRematch = false,
  rematching = false,
  onRematch,
}) {
  const pop = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    opacity.setValue(0);
    pop.setValue(0.85);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }),
    ]).start();
  }, [title, opacity, pop]);

  const accent = winnerSide === 'opponent' ? MATCH_BAR_RIGHT : MATCH_BAR_LEFT;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <ConfettiBurst active />
      <Animated.View style={[styles.banner, { borderColor: accent, opacity, transform: [{ scale: pop }] }]}>
        <Icon name="trophy" size={responsiveFont(18)} color="#0A0A0C" />
        <Text style={styles.bannerText} numberOfLines={2}>{title}</Text>
      </Animated.View>
      {canRematch ? (
        <TouchableOpacity
          style={styles.rematchBtn}
          onPress={onRematch}
          disabled={rematching}
          activeOpacity={0.88}
        >
          {rematching ? (
            <ActivityIndicator color="#0A0A0C" />
          ) : (
            <>
              <Icon name="refresh" size={responsiveFont(16)} color="#0A0A0C" />
              <Text style={styles.rematchText}>Rematch</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginTop: responsiveSize(14),
    gap: responsiveSize(12),
  },
  confetti: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(8),
    backgroundColor: '#FFD54A',
    borderRadius: responsiveSize(22),
    paddingVertical: responsiveSize(10),
    paddingHorizontal: responsiveSize(18),
    borderWidth: 2,
    maxWidth: '92%',
    zIndex: 2,
  },
  bannerText: {
    color: '#0A0A0C',
    fontWeight: '900',
    fontSize: responsiveFont(15),
    flexShrink: 1,
  },
  rematchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(8),
    backgroundColor: MATCH_BAR_LEFT,
    borderRadius: responsiveSize(24),
    paddingVertical: responsiveSize(12),
    paddingHorizontal: responsiveSize(24),
    zIndex: 2,
  },
  rematchText: {
    color: '#0A0A0C',
    fontWeight: '900',
    fontSize: responsiveFont(15),
  },
});
