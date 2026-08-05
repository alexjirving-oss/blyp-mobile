import {
  PROMOTE_TYPE_WEIGHTS,
  PROMOTE_WEIGHT_CAP,
  buildPromoteBoostByUser,
  applyPromoteFairCap,
  promoteBoostAdjust,
  promoteWeightForType,
} from '../promoteBoostService';

describe('promoteBoostService', () => {
  test('weights are capped below admin boost tier', () => {
    expect(PROMOTE_TYPE_WEIGHTS.SPOTLIGHT).toBeLessThanOrEqual(PROMOTE_WEIGHT_CAP);
    expect(PROMOTE_TYPE_WEIGHTS.SPOTLIGHT).toBeLessThan(150);
    expect(promoteWeightForType('BATTLE')).toBe(50);
    expect(promoteWeightForType('TIME_SLOT')).toBe(70);
    expect(promoteWeightForType('SPOTLIGHT')).toBe(95);
  });

  test('buildPromoteBoostByUser keeps strongest type per user', () => {
    const map = buildPromoteBoostByUser([
      { userId: 'u1', promotionType: 'BATTLE', battleRef: 'b1' },
      { userId: 'u1', promotionType: 'SPOTLIGHT' },
      { userId: 'u2', promotionType: 'TIME_SLOT' },
    ]);
    expect(map.get('u1')).toEqual({ type: 'SPOTLIGHT', weight: 95, battleRef: null });
    expect(map.get('u2')).toEqual({ type: 'TIME_SLOT', weight: 70, battleRef: null });
  });

  test('applyPromoteFairCap limits promote share in top window', () => {
    const posts = [
      { id: 'p1', userId: 'prom1', promoteBoostWeight: 95 },
      { id: 'p2', userId: 'prom2', promoteBoostWeight: 70 },
      { id: 'p3', userId: 'prom3', promoteBoostWeight: 50 },
      { id: 'p4', userId: 'prom4', promoteBoostWeight: 50 },
      { id: 'o1', userId: 'org1', promoteBoostWeight: 0 },
      { id: 'o2', userId: 'org2', promoteBoostWeight: 0 },
      { id: 'o3', userId: 'org3', promoteBoostWeight: 0 },
      { id: 'o4', userId: 'org4', promoteBoostWeight: 0 },
      { id: 'o5', userId: 'org5', promoteBoostWeight: 0 },
      { id: 'o6', userId: 'org6', promoteBoostWeight: 0 },
    ];
    const capped = applyPromoteFairCap(posts, { windowSize: 6, maxShare: 1 / 3, maxPerUser: 2 });
    const top6 = capped.slice(0, 6);
    const promoteCount = top6.filter((p) => promoteBoostAdjust(p) > 0).length;
    expect(promoteCount).toBeLessThanOrEqual(2);
    expect(top6.some((p) => !promoteBoostAdjust(p))).toBe(true);
  });

  test('applyPromoteFairCap limits same promoted author in a window', () => {
    const posts = [
      { id: 'a1', userId: 'prom1', promoteBoostWeight: 95 },
      { id: 'a2', userId: 'prom1', promoteBoostWeight: 95 },
      { id: 'a3', userId: 'prom1', promoteBoostWeight: 95 },
      { id: 'o1', userId: 'org1', promoteBoostWeight: 0 },
      { id: 'o2', userId: 'org2', promoteBoostWeight: 0 },
      { id: 'o3', userId: 'org3', promoteBoostWeight: 0 },
      { id: 'o4', userId: 'org4', promoteBoostWeight: 0 },
      { id: 'o5', userId: 'org5', promoteBoostWeight: 0 },
      { id: 'o6', userId: 'org6', promoteBoostWeight: 0 },
    ];
    const capped = applyPromoteFairCap(posts, { windowSize: 6, maxShare: 0.5, maxPerUser: 2 });
    const top6 = capped.slice(0, 6);
    const fromProm1 = top6.filter((p) => p.userId === 'prom1').length;
    expect(fromProm1).toBeLessThanOrEqual(2);
    // Excess same-author promote is deferred past the top window, not dropped.
    expect(capped.filter((p) => p.userId === 'prom1')).toHaveLength(3);
  });
});
