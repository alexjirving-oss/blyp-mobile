import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

export type Grid9VfxPoint = { x: number; y: number };

export type Grid9CombatVfxCue = {
  id: string;
  kind: 'projectile' | 'shield' | 'heal';
  weaponId?: string;
  from: Grid9VfxPoint;
  to: Grid9VfxPoint;
  /** Signed float text: negative damage, positive heal/SP. */
  amount: number;
  label?: string;
};

function projectileColor(weaponId?: string): string {
  switch (weaponId) {
    case 'fireball':
    case 'mega_bomb':
      return '#FF8A1F';
    case 'arrow':
      return '#7FEDE2';
    case 'kiss':
      return '#FF6BB5';
    default:
      return '#FFB347';
  }
}

/**
 * Absolute overlay: trail → impact + floating number.
 * Soft-fails when measures are missing (caller should not enqueue incomplete cues).
 */
export function Grid9CombatVfxOverlay({
  cue,
  onDone,
}: {
  cue: Grid9CombatVfxCue | null;
  onDone?: (id: string) => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const impact = useRef(new Animated.Value(0)).current;
  const floatY = useRef(new Animated.Value(0)).current;
  const floatOp = useRef(new Animated.Value(0)).current;
  const [active, setActive] = useState<Grid9CombatVfxCue | null>(null);

  useEffect(() => {
    if (!cue) return;
    setActive(cue);
    progress.setValue(0);
    impact.setValue(0);
    floatY.setValue(0);
    floatOp.setValue(0);

    const isProjectile = cue.kind === 'projectile';
    const trailMs = isProjectile ? 420 : 40;
    const impactMs = 520;

    const trail = Animated.timing(progress, {
      toValue: 1,
      duration: trailMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    const burst = Animated.parallel([
      Animated.sequence([
        Animated.timing(impact, {
          toValue: 1,
          duration: impactMs * 0.45,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(impact, {
          toValue: 0,
          duration: impactMs * 0.55,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(floatOp, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(floatY, {
        toValue: -36,
        duration: impactMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    const anim = Animated.sequence([
      trail,
      burst,
      Animated.timing(floatOp, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]);

    anim.start(({ finished }) => {
      if (finished) {
        onDone?.(cue.id);
        setActive(null);
      }
    });

    return () => {
      anim.stop();
    };
  }, [cue, floatOp, floatY, impact, onDone, progress]);

  const trailStyle = useMemo(() => {
    if (!active || active.kind !== 'projectile') return null;
    const dx = active.to.x - active.from.x;
    const dy = active.to.y - active.from.y;
    const arc = Math.min(72, Math.max(28, Math.abs(dx) * 0.22 + 36));
    const translateX = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [active.from.x, active.to.x],
    });
    const translateY = progress.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [active.from.y, (active.from.y + active.to.y) / 2 - arc, active.to.y],
    });
    const opacity = progress.interpolate({
      inputRange: [0, 0.85, 1],
      outputRange: [0.95, 1, 0.2],
    });
    const scale = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0.7, 1.15],
    });
    return {
      transform: [{ translateX }, { translateY }, { scale }],
      opacity,
      color: projectileColor(active.weaponId),
      dx,
      dy,
    };
  }, [active, progress]);

  if (!active) return null;

  const amountText =
    active.label ||
    (active.amount === 0
      ? ''
      : active.amount > 0
        ? `+${Math.round(active.amount)}`
        : `${Math.round(active.amount)}`);
  const amountColor =
    active.kind === 'heal'
      ? '#4ADE80'
      : active.kind === 'shield'
        ? '#00D2BE'
        : '#FF3B30';

  const burstScale = impact.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, active.kind === 'heal' ? 1.35 : 1.8],
  });
  const burstOp = impact.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 1, 0],
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {trailStyle ? (
        <>
          <Animated.View
            style={[
              styles.trail,
              {
                backgroundColor: trailStyle.color,
                shadowColor: trailStyle.color,
                opacity: trailStyle.opacity,
                transform: trailStyle.transform,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.head,
              {
                backgroundColor: '#FFF7E6',
                shadowColor: trailStyle.color,
                opacity: trailStyle.opacity,
                transform: trailStyle.transform,
              },
            ]}
          />
        </>
      ) : null}

      <Animated.View
        style={[
          styles.burst,
          {
            left: active.to.x - 28,
            top: active.to.y - 28,
            opacity: burstOp,
            transform: [{ scale: burstScale }],
            backgroundColor:
              active.kind === 'heal'
                ? 'rgba(255,107,181,0.55)'
                : active.kind === 'shield'
                  ? 'rgba(0,210,190,0.45)'
                  : 'rgba(255,80,20,0.55)',
            borderColor:
              active.kind === 'heal'
                ? '#FF6BB5'
                : active.kind === 'shield'
                  ? '#00D2BE'
                  : '#FF8A1F',
          },
        ]}
      />

      {amountText ? (
        <Animated.View
          style={{
            position: 'absolute',
            left: active.to.x - 40,
            top: active.to.y - 18,
            width: 80,
            alignItems: 'center',
            opacity: floatOp,
            transform: [{ translateY: floatY }],
          }}
        >
          <Text style={[styles.floatText, { color: amountColor }]}>{amountText}</Text>
          {active.kind === 'heal' ? (
            <Text style={styles.heart}>♥</Text>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trail: {
    position: 'absolute',
    width: 54,
    height: 10,
    borderRadius: 8,
    marginLeft: -27,
    marginTop: -5,
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  head: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    marginTop: -8,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  burst: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
  },
  floatText: {
    fontSize: 28,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  heart: {
    marginTop: -4,
    fontSize: 16,
    color: '#FF6BB5',
  },
});
