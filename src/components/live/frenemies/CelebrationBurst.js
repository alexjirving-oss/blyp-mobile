/**
 * Lightweight win / kick / coin celebration particles for Frenemies results.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

const GOLD = '#F5C542';
const TEAL = '#00D2BE';
const ROSE = '#FB7185';

function particlesForKind(kind) {
  const k = String(kind || '');
  if (k === 'throw' || k === 'solo_win') {
    return { glyphs: ['🪙', '✨', '💛', '🪙', '✦', '🪙', '✨', '💛'], tint: GOLD };
  }
  if (k === 'timeout_kick') {
    return { glyphs: ['💨', '⚡', '✦', '💨', '⚡', '✦', '💨', '⚡'], tint: ROSE };
  }
  if (k.includes('challenge') || k === 'win') {
    return { glyphs: ['♥', '✦', '💛', '♥', '✨', '💛', '♥', '✦'], tint: TEAL };
  }
  return { glyphs: ['✦', '✨', '💛', '✦', '✨', '💛', '✦', '✨'], tint: TEAL };
}

export default function CelebrationBurst({ resultKey, kind }) {
  const [items, setItems] = useState([]);
  const lastKey = useRef(null);

  useEffect(() => {
    if (!resultKey || resultKey === lastKey.current) return;
    lastKey.current = resultKey;
    const { glyphs } = particlesForKind(kind);
    const next = glyphs.map((glyph, i) => {
      const progress = new Animated.Value(0);
      const angle = (i / glyphs.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist = 48 + Math.random() * 72;
      return {
        id: `${resultKey}-${i}`,
        glyph,
        progress,
        tx: Math.cos(angle) * dist,
        ty: Math.sin(angle) * dist - 20,
        rot: (Math.random() - 0.5) * 50,
        size: 16 + Math.floor(Math.random() * 10),
      };
    });
    setItems(next);
    next.forEach((it, i) => {
      Animated.timing(it.progress, {
        toValue: 1,
        duration: 1100 + i * 40,
        delay: i * 28,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    const clear = setTimeout(() => setItems([]), 1600);
    return () => clearTimeout(clear);
  }, [resultKey, kind]);

  if (!items.length) return null;

  return (
    <View style={styles.root} pointerEvents="none">
      {items.map((it) => {
        const opacity = it.progress.interpolate({
          inputRange: [0, 0.15, 0.75, 1],
          outputRange: [0, 1, 1, 0],
        });
        const scale = it.progress.interpolate({
          inputRange: [0, 0.2, 1],
          outputRange: [0.4, 1.25, 0.85],
        });
        const translateX = it.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, it.tx],
        });
        const translateY = it.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, it.ty],
        });
        const rotate = it.progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${it.rot}deg`],
        });
        return (
          <Animated.View
            key={it.id}
            style={[
              styles.particle,
              { opacity, transform: [{ translateX }, { translateY }, { scale }, { rotate }] },
            ]}
          >
            <Text style={{ fontSize: it.size }} allowFontScaling={false}>
              {it.glyph}
            </Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 8,
  },
  particle: {
    position: 'absolute',
  },
});
