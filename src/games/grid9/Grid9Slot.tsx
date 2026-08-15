import React, { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import type { Grid9PublicPlayer } from './protocol';
import {
  grid9HealthRatio,
  isGrid9SlotEliminated,
  playerInitials,
} from './grid9Format';
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

  const frameClass = targetable
    ? 'border-4 border-red-500 bg-slate-900'
    : spotlighted
      ? 'border-4 border-amber-400 bg-slate-900'
      : sentinel
        ? 'border-2 border-dashed border-amber-600 bg-slate-900'
        : player
          ? 'border-2 border-slate-500 bg-slate-900'
          : 'border-2 border-slate-800 bg-slate-950';

  const body = (
    <View className={`relative h-full w-full overflow-hidden rounded-2xl ${frameClass}`}>
      {spotlighted && !targetable ? (
        <View className="absolute inset-0 rounded-2xl border-2 border-amber-300/40" />
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
        >
          <View className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-red-400" />
          <View className="absolute right-1 top-1 h-2 w-2 border-r-2 border-t-2 border-red-400" />
          <View className="absolute bottom-1 left-1 h-2 w-2 border-b-2 border-l-2 border-red-400" />
          <View className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-red-400" />
        </Animated.View>
      ) : null}

      <View className="flex-1 items-center justify-center px-1.5 pt-2">
        <View
          className={`h-12 w-12 items-center justify-center overflow-hidden rounded-full border ${
            sentinel ? 'border-red-500 bg-red-500/15' : 'border-slate-600 bg-slate-800'
          }`}
        >
          {showImage ? (
            <Image
              className="h-12 w-12"
              source={{ uri: player?.avatarUrl ?? undefined }}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Text className={`text-sm font-black ${sentinel ? 'text-red-400' : 'text-slate-200'}`}>
              {player ? playerInitials(player.displayName) : String(slotIndex + 1)}
            </Text>
          )}
        </View>

        <Text
          className="mt-1.5 text-center text-[11px] font-bold text-slate-100"
          numberOfLines={1}
        >
          {player?.displayName ?? `Box ${slotIndex + 1}`}
        </Text>

        {sentinel ? (
          <View className="mt-1 rounded-full border border-red-500/70 bg-red-500/20 px-1.5 py-0.5">
            <Text className="text-[8px] font-black tracking-[1px] text-red-400">[SENTINEL]</Text>
          </View>
        ) : player ? (
          <View className="mt-1 flex-row items-center">
            <View
              className={`mr-1 h-1.5 w-1.5 rounded-full ${
                player.connectionState === 'connected'
                  ? 'bg-emerald-400'
                  : player.connectionState === 'reconnecting'
                    ? 'bg-amber-400'
                    : 'bg-red-500'
              }`}
            />
            <Text className="text-[9px] font-semibold uppercase text-slate-400">
              {isLocal ? 'You' : 'Human'}
            </Text>
          </View>
        ) : (
          <Text className="mt-1 text-[9px] font-semibold uppercase tracking-[1px] text-slate-600">
            Empty
          </Text>
        )}
      </View>

      {player ? (
        <View className="absolute bottom-0 left-0 right-0 px-1.5 pb-1.5">
          {player.shieldPoints > 0 ? (
            <Text className="mb-0.5 text-center text-[9px] font-bold text-sky-300">
              SHIELD {player.shieldPoints}
            </Text>
          ) : null}
          <View className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <View
              className={`h-1.5 rounded-full ${healthLow ? 'bg-red-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </View>
        </View>
      ) : null}

      {isLocal && player && !eliminated ? (
        <View className="absolute right-1 top-1 rounded-md bg-amber-400 px-1 py-0.5">
          <Text className="text-[8px] font-black text-slate-950">YOU</Text>
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
