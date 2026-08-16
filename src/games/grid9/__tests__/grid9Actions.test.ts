import { GRID9_ARSENAL_CATALOG, GRID9_DEFAULT_MERCENARY_FUND_COINS, listGrid9Arsenal } from '../catalog';
import {
  canAffordGrid9Item,
  isValidGrid9Target,
  resolveGrid9DrawerMode,
  selectionFromArsenalItem,
} from '../grid9Actions';
import type { Grid9PublicPlayer } from '../protocol';

function player(overrides: Partial<Grid9PublicPlayer> = {}): Grid9PublicPlayer {
  return {
    slotId: 'slot-0',
    slotIndex: 0,
    kind: 'human',
    displayName: 'Alex',
    avatarUrl: null,
    status: 'alive',
    mode: 'combatant',
    health: 100,
    maxHealth: 100,
    shieldPoints: 0,
    maxShieldPoints: 100,
    mercenaryBankrollCoins: 0,
    connectionState: 'connected',
    ...overrides,
  };
}

describe('Grid 9 action rules', () => {
  it('mirrors the live catalog costs and Wave 1 names', () => {
    expect(GRID9_ARSENAL_CATALOG.arrow.costCoins).toBe(10);
    expect(GRID9_ARSENAL_CATALOG.fireball.costCoins).toBe(25);
    expect(GRID9_ARSENAL_CATALOG.mega_bomb.costCoins).toBe(50);
    expect(GRID9_ARSENAL_CATALOG.basic_shield.costCoins).toBe(15);
    expect(listGrid9Arsenal().map((item) => item.displayName)).toEqual([
      'Arrow',
      'Fireball',
      'Mega Bomb',
      'Shield',
    ]);
    expect(GRID9_DEFAULT_MERCENARY_FUND_COINS).toBe(25);
  });

  it('opens the gallery only on the local spotlight while alive', () => {
    expect(
      resolveGrid9DrawerMode({
        targeting: false,
        phase: 'combat',
        localPlayer: player({ slotIndex: 2 }),
        localSlotIndex: 2,
        spotlightSlotIndex: 2,
      }),
    ).toBe('my_turn');
    expect(
      resolveGrid9DrawerMode({
        targeting: false,
        phase: 'combat',
        localPlayer: player({ slotIndex: 2 }),
        localSlotIndex: 2,
        spotlightSlotIndex: 5,
      }),
    ).toBe('waiting');
  });

  it('enters targeting and proxy-war states from the local seat', () => {
    expect(
      resolveGrid9DrawerMode({
        targeting: true,
        phase: 'combat',
        localPlayer: player(),
        localSlotIndex: 0,
        spotlightSlotIndex: 0,
      }),
    ).toBe('targeting');
    expect(
      resolveGrid9DrawerMode({
        targeting: false,
        phase: 'combat',
        localPlayer: player({ status: 'eliminated', health: 0, mode: 'sabotage' }),
        localSlotIndex: 0,
        spotlightSlotIndex: 3,
      }),
    ).toBe('proxy_war');
  });

  it('blocks unaffordable arsenal items and illegal targets', () => {
    expect(canAffordGrid9Item(9, 10)).toBe(false);
    expect(canAffordGrid9Item(10, 10)).toBe(true);
    const alive = player({ slotIndex: 1 });
    expect(
      isValidGrid9Target({
        intent: 'weapon',
        player: alive,
        slotIndex: 1,
        localSlotIndex: 1,
      }),
    ).toBe(false);
    expect(
      isValidGrid9Target({
        intent: 'weapon',
        player: alive,
        slotIndex: 1,
        localSlotIndex: 0,
      }),
    ).toBe(true);
    expect(
      isValidGrid9Target({
        intent: 'shield',
        player: alive,
        slotIndex: 1,
        localSlotIndex: 1,
      }),
    ).toBe(true);
    expect(
      isValidGrid9Target({
        intent: 'mercenary',
        player: player({ status: 'eliminated', health: 0, slotIndex: 4 }),
        slotIndex: 4,
        localSlotIndex: 0,
      }),
    ).toBe(false);
  });

  it('maps catalog items onto typed targeting selections', () => {
    expect(selectionFromArsenalItem(GRID9_ARSENAL_CATALOG.arrow)).toEqual({
      kind: 'weapon',
      itemId: 'arrow',
    });
    expect(selectionFromArsenalItem(GRID9_ARSENAL_CATALOG.basic_shield)).toEqual({
      kind: 'shield',
      itemId: 'basic_shield',
    });
  });
});
