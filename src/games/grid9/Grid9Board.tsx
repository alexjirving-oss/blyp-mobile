import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Animated, View as RnView } from 'react-native';
import type { Grid9SlotIndex } from './constants';
import { GRID9_ROULETTE_DURATION_MS } from './constants';
import type { Grid9PublicPlayer } from './protocol';
import type { Grid9VfxPoint } from './Grid9CombatVfxOverlay';
import { slotsForGrid9Board } from './grid9Format';
import { Grid9Slot } from './Grid9Slot';
import { playGrid9Cue, playRouletteTick } from './grid9Audio';
import {
  buildGrid9RouletteTicks,
  grid9RouletteTickAtElapsed,
} from './grid9RouletteDrama';
import { View } from './nw';

const GAP = 6;

export function Grid9Board({
  players,
  spotlightSlotIndex,
  localSlotIndex,
  targetableSlotIndices = [],
  rouletteCandidateSlotIndices = [],
  rouletteSelectedSlotIndex = null,
  rouletteActive = false,
  rouletteEndsAt = null,
  lockedTargetSlotIndex = null,
  onSlotPress,
  onSeatCentersMeasured,
}: {
  players: Grid9PublicPlayer[] | undefined;
  spotlightSlotIndex: Grid9SlotIndex | null;
  localSlotIndex: number | null;
  targetableSlotIndices?: number[];
  rouletteCandidateSlotIndices?: number[];
  /** Authoritative winner — client animates toward this seat. */
  rouletteSelectedSlotIndex?: number | null;
  rouletteActive?: boolean;
  rouletteEndsAt?: string | null;
  lockedTargetSlotIndex?: number | null;
  onSlotPress?: (slotIndex: number) => void;
  onSeatCentersMeasured?: (centers: Array<Grid9VfxPoint | null>) => void;
}) {
  const [boardWidth, setBoardWidth] = useState(0);
  const [highlightSlot, setHighlightSlot] = useState<number | null>(null);
  const landedRef = useRef<string | null>(null);
  const seatRefs = useRef<Array<React.ElementRef<typeof RnView> | null>>(
    Array.from({ length: 9 }, () => null),
  );
  const slots = slotsForGrid9Board(players);
  const cell = boardWidth > 0 ? (boardWidth - GAP * 2) / 3 : 0;

  const candidates = useMemo(() => {
    const list = (rouletteCandidateSlotIndices || []).filter(
      (slot) => Number.isInteger(slot) && slot >= 0 && slot <= 8,
    );
    return list.length > 0
      ? list
      : slots
          .map((player, index) => (player?.status === 'alive' ? index : -1))
          .filter((index) => index >= 0);
  }, [rouletteCandidateSlotIndices, slots]);

  // Discrete beep-beep cadence toward the server-selected seat (not RAF flicker).
  useEffect(() => {
    if (!rouletteActive || candidates.length === 0) {
      setHighlightSlot(null);
      return;
    }
    const selected =
      rouletteSelectedSlotIndex != null && candidates.includes(rouletteSelectedSlotIndex)
        ? rouletteSelectedSlotIndex
        : candidates[candidates.length - 1];
    const selectedOffset = Math.max(0, candidates.indexOf(selected));
    const endsAtMs = rouletteEndsAt ? Date.parse(rouletteEndsAt) : NaN;
    const remaining = Number.isFinite(endsAtMs) ? endsAtMs - Date.now() : GRID9_ROULETTE_DURATION_MS;
    const duration = Number.isFinite(endsAtMs)
      ? Math.max(10_000, remaining)
      : GRID9_ROULETTE_DURATION_MS;
    const startedAt = Number.isFinite(endsAtMs) ? endsAtMs - duration : Date.now();
    const spinKey = `${selected}:${endsAtMs || duration}`;
    landedRef.current = null;

    const ticks = buildGrid9RouletteTicks({
      durationMs: duration,
      candidateCount: candidates.length,
      selectedOffset,
    });
    const apply = (tick: { candidateOffset: number; landed: boolean }, beep: boolean) => {
      setHighlightSlot(candidates[tick.candidateOffset] ?? selected);
      if (beep) void playRouletteTick();
      if (tick.landed && landedRef.current !== spinKey) {
        landedRef.current = spinKey;
        void playGrid9Cue('spotlight_select');
      }
    };

    const elapsed = Date.now() - startedAt;
    const current = grid9RouletteTickAtElapsed(elapsed, ticks);
    apply(current, elapsed < 80);
    const timers = ticks
      .filter((tick) => tick.atMs > elapsed)
      .map((tick) =>
        setTimeout(() => apply(tick, true), Math.max(0, tick.atMs - elapsed)),
      );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [
    candidates,
    rouletteActive,
    rouletteEndsAt,
    rouletteSelectedSlotIndex,
  ]);

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
    <View className="w-full items-center justify-center px-2 pb-1" onLayout={onLayout}>
      <View className="flex-row flex-wrap" style={{ width: boardWidth || '100%' }}>
        {slots.map((player, slotIndex) => {
          const rouletteHighlight =
            rouletteActive && highlightSlot === slotIndex;
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
                <Grid9Slot
                  player={player}
                  slotIndex={slotIndex}
                  spotlighted={spotlightSlotIndex === slotIndex && !rouletteActive}
                  isLocal={localSlotIndex === slotIndex}
                  targetable={targetableSlotIndices.includes(slotIndex)}
                  lockedTarget={lockedTargetSlotIndex === slotIndex}
                  rouletteHighlight={rouletteHighlight}
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
