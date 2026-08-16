import { grid9BoxNumber, grid9BoxTurnLine } from '../grid9BoxTurnVo';
import { shouldAutoUnmuteGrid9Mic } from '../grid9Mic';

describe('grid9BoxTurnVo', () => {
  it('speaks the landed box number in words', () => {
    expect(grid9BoxNumber(0)).toBe(1);
    expect(grid9BoxNumber(1)).toBe(2);
    expect(grid9BoxNumber(8)).toBe(9);
    expect(grid9BoxTurnLine(1)).toBe('Box two, your turn');
    expect(grid9BoxTurnLine(2)).toBe('Box three, your turn');
  });
});

describe('shouldAutoUnmuteGrid9Mic', () => {
  it('unmutes only the local combatant when called up', () => {
    expect(
      shouldAutoUnmuteGrid9Mic({
        isCombatant: true,
        localSlotIndex: 2,
        activeSlotIndex: 2,
      }),
    ).toBe(true);
    expect(
      shouldAutoUnmuteGrid9Mic({
        isCombatant: true,
        localSlotIndex: 2,
        activeSlotIndex: 4,
      }),
    ).toBe(false);
    expect(
      shouldAutoUnmuteGrid9Mic({
        isCombatant: true,
        spectate: true,
        localSlotIndex: 2,
        activeSlotIndex: 2,
      }),
    ).toBe(false);
  });
});
