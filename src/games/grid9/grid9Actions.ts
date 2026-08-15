import { isGrid9SlotEliminated } from './grid9Format';
import type { Grid9ArsenalItem, Grid9ArsenalItemId } from './catalog';
import type { Grid9PublicPlayer } from './protocol';

export type Grid9DrawerMode = 'idle' | 'my_turn' | 'waiting' | 'targeting' | 'proxy_war';

export type Grid9ArsenalSelection =
  | { kind: 'weapon'; itemId: Extract<Grid9ArsenalItemId, 'arrow' | 'fireball' | 'mega_bomb'> }
  | { kind: 'shield'; itemId: Extract<Grid9ArsenalItemId, 'basic_shield'> };

export function resolveGrid9DrawerMode(input: {
  targeting: boolean;
  phase: string | null | undefined;
  localPlayer: Grid9PublicPlayer | null;
  localSlotIndex: number | null;
  spotlightSlotIndex: number | null;
}): Grid9DrawerMode {
  if (input.targeting) return 'targeting';
  if (!input.localPlayer || input.localSlotIndex == null) return 'idle';
  if (isGrid9SlotEliminated(input.localPlayer) || input.localPlayer.mode === 'sabotage') {
    return input.phase === 'combat' ? 'proxy_war' : 'idle';
  }
  if (input.phase !== 'combat' || input.localPlayer.status !== 'alive') return 'waiting';
  if (input.spotlightSlotIndex === input.localSlotIndex) return 'my_turn';
  return 'waiting';
}

export function canAffordGrid9Item(availableCoins: number, costCoins: number): boolean {
  return Number.isFinite(availableCoins) && availableCoins >= costCoins;
}

export function isValidGrid9Target(input: {
  intent: 'weapon' | 'shield' | 'mercenary';
  player: Grid9PublicPlayer | null;
  slotIndex: number;
  localSlotIndex: number | null;
}): boolean {
  if (!input.player || isGrid9SlotEliminated(input.player)) return false;
  if (input.intent === 'shield') return true;
  return input.localSlotIndex == null || input.slotIndex !== input.localSlotIndex;
}

export function selectionFromArsenalItem(item: Grid9ArsenalItem): Grid9ArsenalSelection {
  if (item.kind === 'shield') {
    return { kind: 'shield', itemId: item.id };
  }
  return { kind: 'weapon', itemId: item.id };
}
