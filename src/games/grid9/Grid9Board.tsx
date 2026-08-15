import React, { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
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
  onSlotPress,
}: {
  players: Grid9PublicPlayer[] | undefined;
  spotlightSlotIndex: Grid9SlotIndex | null;
  localSlotIndex: number | null;
  targetableSlotIndices?: number[];
  onSlotPress?: (slotIndex: number) => void;
}) {
  const [boardWidth, setBoardWidth] = useState(0);
  const slots = slotsForGrid9Board(players);
  const cell = boardWidth > 0 ? (boardWidth - GAP * 2) / 3 : 0;

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.floor(event.nativeEvent.layout.width);
    if (next > 0 && next !== boardWidth) setBoardWidth(next);
  };

  return (
    <View className="w-full flex-1 items-center justify-center px-3" onLayout={onLayout}>
      <View className="flex-row flex-wrap" style={{ width: boardWidth || '100%' }}>
        {slots.map((player, slotIndex) => (
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
            <Grid9Slot
              player={player}
              slotIndex={slotIndex}
              spotlighted={spotlightSlotIndex === slotIndex}
              isLocal={localSlotIndex === slotIndex}
              targetable={targetableSlotIndices.includes(slotIndex)}
              onPress={
                onSlotPress && targetableSlotIndices.includes(slotIndex)
                  ? () => onSlotPress(slotIndex)
                  : undefined
              }
            />
          </View>
        ))}
      </View>
    </View>
  );
}
