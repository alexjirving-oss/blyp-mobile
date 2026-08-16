import { createHmac } from 'crypto';
import type { Grid9ArsenalItemId } from './catalog';
import {
  GRID9_FREE_DROP_WEIGHTS,
  type Grid9SlotIndex,
} from './constants';

export type Grid9MicroDropRewardKind = 'coins' | 'shield';

export interface Grid9MicroDropEntropyProof {
  digest: string;
  rewardKind: Grid9MicroDropRewardKind;
}

export function deriveGrid9MicroDrop(args: {
  entropySeed: string;
  matchId: string;
  turnNumber: number;
  slotIndex: Grid9SlotIndex;
}): Grid9MicroDropEntropyProof {
  const key = Buffer.from(args.entropySeed, 'base64url');
  if (key.length !== 32) {
    throw new RangeError('entropySeed must decode to exactly 32 bytes');
  }
  if (!Number.isSafeInteger(args.turnNumber) || args.turnNumber < 0) {
    throw new RangeError('turnNumber must be a non-negative safe integer');
  }
  const message = `grid9:micro-drop:${args.matchId}:${args.turnNumber}:${args.slotIndex}`;
  const digestBytes = createHmac('sha256', key).update(message, 'utf8').digest();
  return {
    digest: digestBytes.toString('hex'),
    rewardKind: (digestBytes[0] & 1) === 0 ? 'coins' : 'shield',
  };
}

function decodeEntropyKey(entropySeed: string): Buffer {
  const key = Buffer.from(entropySeed, 'base64url');
  if (key.length !== 32) {
    throw new RangeError('entropySeed must decode to exactly 32 bytes');
  }
  return key;
}

export function deriveGrid9RouletteSlot(args: {
  entropySeed: string;
  matchId: string;
  turnNumber: number;
  candidateSlotIndices: readonly Grid9SlotIndex[];
}): { digest: string; selectedSlotIndex: Grid9SlotIndex } {
  if (args.candidateSlotIndices.length === 0) {
    throw new RangeError('roulette requires at least one candidate');
  }
  const key = decodeEntropyKey(args.entropySeed);
  const message = `grid9:roulette:${args.matchId}:${args.turnNumber}:${args.candidateSlotIndices.join(',')}`;
  const digestBytes = createHmac('sha256', key).update(message, 'utf8').digest();
  const index = digestBytes.readUInt32BE(0) % args.candidateSlotIndices.length;
  return {
    digest: digestBytes.toString('hex'),
    selectedSlotIndex: args.candidateSlotIndices[index],
  };
}

const FREE_DROP_ORDER = [
  'arrow',
  'basic_shield',
  'fireball',
  'mega_bomb',
] as const satisfies readonly Grid9ArsenalItemId[];

export function deriveGrid9FreeDrop(args: {
  entropySeed: string;
  matchId: string;
  turnNumber: number;
  slotIndex: Grid9SlotIndex;
}): { digest: string; itemId: Grid9ArsenalItemId } {
  const key = decodeEntropyKey(args.entropySeed);
  const message = `grid9:free-drop:${args.matchId}:${args.turnNumber}:${args.slotIndex}`;
  const digestBytes = createHmac('sha256', key).update(message, 'utf8').digest();
  const roll = digestBytes.readUInt32BE(0) % 100;
  let cursor = 0;
  for (const itemId of FREE_DROP_ORDER) {
    cursor += GRID9_FREE_DROP_WEIGHTS[itemId];
    if (roll < cursor) {
      return { digest: digestBytes.toString('hex'), itemId };
    }
  }
  return { digest: digestBytes.toString('hex'), itemId: 'arrow' };
}
