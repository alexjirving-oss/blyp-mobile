import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_GUEST_SLOTS,
  MIN_GUEST_SLOT,
  collectUsedGuestSlots,
  pickSlotIndex,
} from './guestSlotAllocator';

describe('pickSlotIndex', () => {
  it('gives the first guest box 1 when nothing is used', () => {
    assert.equal(pickSlotIndex(new Set()), 1);
  });

  it('fills the lowest sticky hole (does not compact)', () => {
    assert.equal(pickSlotIndex(new Set([1, 3])), 2);
    assert.equal(pickSlotIndex(new Set([2, 3])), 1);
  });

  it('honors a free preferred slot', () => {
    assert.equal(pickSlotIndex(new Set([1]), 3), 3);
  });

  it('ignores preferred when taken and picks next free', () => {
    assert.equal(pickSlotIndex(new Set([1, 2]), 1), 3);
  });

  it('never returns slot 0 (host tile)', () => {
    const used = new Set<number>();
    for (let n = 0; n < 3; n += 1) {
      const slot = pickSlotIndex(used);
      assert.ok(slot >= MIN_GUEST_SLOT);
      assert.notEqual(slot, 0);
      used.add(slot);
    }
  });
});

describe('collectUsedGuestSlots', () => {
  it('does not let the host uid occupy a guest box', () => {
    const used = collectUsedGuestSlots(
      [
        { userId: 'host-1', state: 'LIVE', slotIndex: 1 },
        { userId: 'guest-a', state: 'LIVE', slotIndex: 2 },
      ],
      { hostUserId: 'host-1', isStale: () => false }
    );
    assert.deepEqual([...used].sort((a, b) => a - b), [2]);
    assert.equal(pickSlotIndex(used), 1);
  });

  it('ignores slot 0 and out-of-range indices', () => {
    const used = collectUsedGuestSlots(
      [
        { userId: 'g1', state: 'INVITED', slotIndex: 0 },
        { userId: 'g2', state: 'INVITED', slotIndex: MAX_GUEST_SLOTS + 1 },
        { userId: 'g3', state: 'INVITED', slotIndex: 1 },
      ],
      { isStale: () => false }
    );
    assert.deepEqual([...used], [1]);
  });

  it('ignores stale LIVE guests so their box can be reused', () => {
    const used = collectUsedGuestSlots(
      [{ userId: 'g1', state: 'LIVE', slotIndex: 1 }],
      { isStale: () => true }
    );
    assert.equal(used.size, 0);
    assert.equal(pickSlotIndex(used), 1);
  });
});
