import { createHmac } from 'crypto';
import type { Grid9SlotIndex } from './constants';

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
