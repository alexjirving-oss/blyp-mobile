import React, { useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Animated } from 'react-native';
import type { Grid9SlotIndex } from './constants';
import type { Grid9PublicPlayer } from './protocol';
import { slotsForGrid9Board } from './grid9Format';
import { Grid9Slot } from './Grid9Slot';
import { View } from './nw';

const GAP = 8;

export function Grid9Board({
  players,
  spotlightSlotIndex,
  localSlotIndex,
  targetableSlotIndices = [],
  rouletteCandidateSlotIndices = [],
  rouletteActive = false,
  onSlotPress,
}: {
  players: Grid9PublicPlayer[] | undefined;
  spotlightSlotIndex: Grid9SlotIndex | null;
  localSlotIndex: number | null;
  targetableSlotIndices?: number[];
  rouletteCandidateSlotIndices?: number[];
  rouletteActive?: boolean;
  onSlotPress?: (slotIndex: number) => void;
}) {
  const [boardWidth, setBoardWidth] = useState(0);
  const flash = useRef(new Animated.Value(0.35)).current;
  const slots = slotsForGrid9Board(players);
  const cell = boardWidth > 0 ? (boardWidth - GAP * 2) / 3 : 0;

  useEffect(() => {
    if (!rouletteActive) {
      flash.setValue(0.35);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flash, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(flash, { toValue: 0.25, duration: 280, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      flash.setValue(0.35);
    };
  }, [flash, rouletteActive]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.floor(event.nativeEvent.layout.width);
    if (next > 0 && next !== boardWidth) setBoardWidth(next);
  };

  return (
    <View className="w-full flex-1 items-center justify-center px-3" onLayout={onLayout}>
      <View className="flex-row flex-wrap" style={{ width: boardWidth || '100%' }}>
        {slots.map((player, slotIndex) => {
          const rouletteCandidate =
            rouletteActive && rouletteCandidateSlotIndices.includes(slotIndex);
          return (
            <View
              key={player?.slotId ?? `empty-${slotIndex}`}
              className="items-center justify-center"
              style={{
                width: cell || '33.333%',
                height: cell || undefined,
                aspectRatio: cell ? undefined : 1,
                padding: GAP / 2,
              }}
            >
              <View className="relative h-full w-full">
                {rouletteCandidate ? (
                  <Animated.View
                    pointerEvents="none"
                    style={{
                      opacity: flash,
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      bottom: 0,
                      left: 0,
                      borderWidth: 3,
                      borderColor: '#fbbf24',
                      borderRadius: 18,
                      zIndex: 2,
                    }}
                  />
                ) : null}
                <Grid9Slot
                  player={player}
                  slotIndex={slotIndex}
                  spotlighted={spotlightSlotIndex === slotIndex && !rouletteActive}
                  isLocal={localSlotIndex === slotIndex}
                  targetable={targetableSlotIndices.includes(slotIndex)}
                  onPress={
                    onSlotPress && targetableSlotIndices.includes(slotIndex)
                      ? () => onSlotPress(slotIndex)
                      : undefined
                  }
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
