import React, { useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Animated, View as RnView } from 'react-native';
import type { Grid9SlotIndex } from './constants';
import type { Grid9PublicPlayer } from './protocol';
import type { Grid9VfxPoint } from './Grid9CombatVfxOverlay';
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
  spotlightChanceBySlot = null,
  onSlotPress,
  onSeatCentersMeasured,
}: {
  players: Grid9PublicPlayer[] | undefined;
  spotlightSlotIndex: Grid9SlotIndex | null;
  localSlotIndex: number | null;
  targetableSlotIndices?: number[];
  rouletteCandidateSlotIndices?: number[];
  rouletteActive?: boolean;
  spotlightChanceBySlot?: Array<number | null> | null;
  onSlotPress?: (slotIndex: number) => void;
  /** Window-space centers for VFX (soft-fail if unavailable). */
  onSeatCentersMeasured?: (centers: Array<Grid9VfxPoint | null>) => void;
}) {
  const [boardWidth, setBoardWidth] = useState(0);
  const flash = useRef(new Animated.Value(0.35)).current;
  const seatRefs = useRef<Array<React.ElementRef<typeof RnView> | null>>(
    Array.from({ length: 9 }, () => null),
  );
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

  const publishCenters = () => {
    if (!onSeatCentersMeasured) return;
    const centers: Array<Grid9VfxPoint | null> = Array.from({ length: 9 }, () => null);
    let pending = 9;
    seatRefs.current.forEach((node, slotIndex) => {
      const anyNode = node as unknown as {
        measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
      } | null;
      if (!anyNode?.measureInWindow) {
        pending -= 1;
        if (pending <= 0) onSeatCentersMeasured(centers);
        return;
      }
      try {
        anyNode.measureInWindow((x, y, w, h) => {
          if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
            centers[slotIndex] = { x: x + w / 2, y: y + h / 2 };
          }
          pending -= 1;
          if (pending <= 0) onSeatCentersMeasured(centers);
        });
      } catch {
        pending -= 1;
        if (pending <= 0) onSeatCentersMeasured(centers);
      }
    });
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.floor(event.nativeEvent.layout.width);
    if (next > 0 && next !== boardWidth) setBoardWidth(next);
    requestAnimationFrame(publishCenters);
  };

  return (
    <View className="w-full items-center justify-center px-3 pb-1" onLayout={onLayout}>
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
              <RnView
                style={{ position: 'relative', height: '100%', width: '100%' }}
                ref={(node) => {
                  seatRefs.current[slotIndex] = node;
                }}
                onLayout={() => requestAnimationFrame(publishCenters)}
              >
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
                      borderColor: '#00D2BE',
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
                  spotlightChancePct={spotlightChanceBySlot?.[slotIndex] ?? null}
                  onPress={
                    onSlotPress && targetableSlotIndices.includes(slotIndex)
                      ? () => onSlotPress(slotIndex)
                      : undefined
                  }
                />
              </RnView>
            </View>
          );
        })}
      </View>
    </View>
  );
}
