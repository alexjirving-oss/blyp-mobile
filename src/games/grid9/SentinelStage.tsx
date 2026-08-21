import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { playerInitials } from './grid9Format';
import { GRID9_THEME } from './grid9Theme';
import { Text, View } from './nw';

const WAVE_BARS = [0.35, 0.7, 0.45, 0.9, 0.55, 0.8, 0.4, 0.65] as const;

export function SentinelStage({
  displayName,
  characterId,
}: {
  displayName: string;
  characterId?: string | null;
}) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  const waves = useRef(WAVE_BARS.map(() => new Animated.Value(0.3))).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
      ]),
    );
    pulseLoop.start();
    const waveLoops = waves.map((bar, index) => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 1,
            duration: 320 + index * 40,
            useNativeDriver: true,
          }),
          Animated.timing(bar, {
            toValue: 0.25,
            duration: 320 + index * 40,
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return loop;
    });
    return () => {
      pulseLoop.stop();
      waveLoops.forEach((loop) => loop.stop());
    };
  }, [pulse, waves]);

  const tag = String(displayName || 'SENTINEL')
    .replace(/^Sentinel\s+/i, '')
    .trim()
    .toUpperCase();

  return (
    <View className="h-full w-full items-center justify-center overflow-hidden rounded-2xl border border-blyp-primary/40 bg-blyp-ink">
      <Animated.View
        pointerEvents="none"
        style={{
          opacity: pulse,
          position: 'absolute',
          top: 12,
          right: 12,
          bottom: 12,
          left: 12,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: 'rgba(255, 45, 85,0.35)',
        }}
      />
      <View className="h-24 w-24 items-center justify-center rounded-full border-2 border-blyp-primary bg-blyp-primary/15">
        <Text className="text-2xl font-black text-blyp-primary">
          {playerInitials(displayName)}
        </Text>
      </View>
      <View className="mt-3 rounded-full border border-blyp-primary/50 bg-blyp-primary/15 px-3 py-1">
        <Text className="text-[10px] font-black tracking-[2px] text-blyp-primary">
          SENTINEL {tag || 'BOT'}
        </Text>
      </View>
      {characterId ? (
        <Text className="mt-1 text-[9px] font-semibold uppercase tracking-[1px] text-blyp-faint">
          {characterId}
        </Text>
      ) : null}
      <View className="mt-4 h-10 flex-row items-end justify-center gap-1">
        {waves.map((bar, index) => (
          <Animated.View
            key={`wave-${index}`}
            style={{
              width: 5,
              height: 36,
              borderRadius: 2,
              backgroundColor: GRID9_THEME.primary,
              opacity: 0.85,
              transform: [{ scaleY: bar }],
            }}
          />
        ))}
      </View>
    </View>
  );
}
