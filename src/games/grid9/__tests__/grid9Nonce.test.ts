import { createGrid9ClientNonce, isGrid9NonceEncoding } from '../nonce';
import { buildFireWeaponIntent, buildFundMercenaryIntent } from '../intents';

describe('Grid 9 client nonce', () => {
  it('mints a 128-bit base64url nonce the server encoding check accepts', () => {
    const nonce = createGrid9ClientNonce();
    expect(isGrid9NonceEncoding(nonce)).toBe(true);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{22,}$/);
  });

  it('rejects UUID-shaped values', () => {
    expect(isGrid9NonceEncoding('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('attaches a unique nonce to fire and fund intents', () => {
    const session = { connectionSessionId: 'conn-1' };
    const fire = buildFireWeaponIntent(session, {
      matchId: 'match-1',
      expectedStateVersion: 4,
      weaponId: 'arrow',
      targetSlotIndex: 3,
    });
    const fund = buildFundMercenaryIntent(session, {
      matchId: 'match-1',
      expectedStateVersion: 4,
      beneficiarySlotIndex: 2,
      amountCoins: 25,
    });
    expect(isGrid9NonceEncoding(fire.nonce)).toBe(true);
    expect(isGrid9NonceEncoding(fund.nonce)).toBe(true);
    expect(fire.nonce).not.toBe(fund.nonce);
    expect(fire.intentId).not.toBe(fund.intentId);
    expect(fire.expectedStateVersion).toBe(4);
    expect(fund.matchId).toBe('match-1');
  });
});
