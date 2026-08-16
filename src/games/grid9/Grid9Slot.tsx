import React, { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import type { Grid9PublicPlayer } from './protocol';
import {
  grid9HealthRatio,
  isGrid9SlotEliminated,
  playerInitials,
} from './grid9Format';
import { GRID9_THEME } from './grid9Theme';
import { Image, Text, TouchableOpacity, View } from './nw';

export function Grid9Slot({
  player,
  slotIndex,
  spotlighted,
  isLocal,
  targetable = false,
  onPress,
}: {
  player: Grid9PublicPlayer | null;
  slotIndex: number;
  spotlighted: boolean;
  isLocal: boolean;
  targetable?: boolean;
  onPress?: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    if (!targetable) {
      pulse.setValue(0.35);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: 550, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0.35);
    };
  }, [pulse, targetable]);

  const eliminated = isGrid9SlotEliminated(player);
  const sentinel = player?.kind === 'sentinel';
  const ratio = player ? grid9HealthRatio(player) : 0;
  const healthLow = ratio <= 0.3;
  const showImage = !!player?.avatarUrl && !imageFailed;
  const sp = Math.max(0, Math.floor(player?.shieldPoints ?? 0));
  const hp = Math.max(0, Math.floor(player?.health ?? 0));

  const frameClass = targetable
    ? 'border-4 border-red-500 bg-blyp-card'
    : spotlighted
      ? 'border-4 border-blyp-primary bg-blyp-card'
      : sentinel
        ? 'border-2 border-dashed border-blyp-primary/50 bg-blyp-card'
        : player
          ? 'border-2 border-white/15 bg-blyp-card'
          : 'border-2 border-white/10 bg-blyp-ink';

  const body = (
    <View className={`relative h-full w-full overflow-hidden rounded-2xl ${frameClass}`}>
      {spotlighted && !targetable ? (
        <View className="absolute inset-0 rounded-2xl border-2 border-blyp-primary/30" />
      ) : null}
      {targetable ? (
        <Animated.View
          pointerEvents="none"
          style={{
            opacity: pulse,
            position: 'absolute',
            top: 4,
            right: 4,
            bottom: 4,
            left: 4,
            borderWidth: 2,
            borderColor: '#f87171',
            borderRadius: 12,
          }}
        />
      ) : null}

      <View className="flex-1 justify-between px-1.5 pb-1.5 pt-2">
        <View className="items-center">
          <View
            className={`h-10 w-10 items-center justify-center overflow-hidden rounded-full border ${
              sentinel ? 'border-blyp-primary bg-blyp-primary/15' : 'border-white/20 bg-blyp-surface'
            }`}
          >
            {showImage ? (
              <Image
                className="h-10 w-10"
                source={{ uri: player?.avatarUrl ?? undefined }}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <Text
                className={`text-xs font-black ${
                  sentinel ? 'text-blyp-primary' : 'text-blyp-text'
                }`}
              >
                {player ? playerInitials(player.displayName) : String(slotIndex + 1)}
              </Text>
            )}
          </View>
          <Text
            className="mt-1 text-center text-[10px] font-bold text-blyp-text"
            numberOfLines={1}
          >
            {player?.displayName ?? `Box ${slotIndex + 1}`}
          </Text>
          {sentinel ? (
            <Text className="mt-0.5 text-[8px] font-black tracking-[1px] text-blyp-primary">
              SENTINEL
            </Text>
          ) : player ? (
            <Text className="mt-0.5 text-[8px] font-bold uppercase tracking-[1px] text-blyp-muted">
              {isLocal ? 'YOU' : 'HUMAN'}
            </Text>
          ) : (
            <Text className="mt-0.5 text-[8px] font-semibold uppercase text-blyp-faint">Empty</Text>
          )}
        </View>

        {player ? (
          <View className="mt-1">
            <View className="mb-0.5 flex-row items-center justify-between">
              <Text className="text-[8px] font-black text-blyp-primary">
                GIFT {Math.max(0, Math.floor(player.mercenaryBankrollCoins || 0))}
              </Text>
              <Text className="text-[8px] font-black text-red-400">HP {hp}</Text>
            </View>
            <View className="mb-0.5 flex-row items-center justify-between">
              <Text className="text-[8px] font-black text-sky-300">SP {sp}</Text>
              <Text className="text-[8px] font-bold text-blyp-faint"> </Text>
            </View>
            <View className="h-1.5 overflow-hidden rounded-full bg-blyp-alt">
              <View
                className="h-1.5 rounded-full"
                style={{
                  width: `${Math.round(ratio * 100)}%`,
                  backgroundColor: healthLow ? GRID9_THEME.hp : GRID9_THEME.spAlt,
                }}
              />
            </View>
          </View>
        ) : null}
      </View>

      {isLocal && player && !eliminated ? (
        <View className="absolute right-1 top-1 rounded-md bg-blyp-primary px-1 py-0.5">
          <Text className="text-[8px] font-black text-blyp-ink">YOU</Text>
        </View>
      ) : null}

      {eliminated ? (
        <View className="absolute inset-0 items-center justify-center bg-black/80">
          <Text className="text-xs font-black tracking-[2px] text-red-500">ELIMINATED</Text>
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <TouchableOpacity className="h-full w-full" activeOpacity={0.88} onPress={onPress}>
      {body}
    </TouchableOpacity>
  );
}
