/**
 * Client-facing unit tests for treasure chest service failure mapping.
 * (Server once-per-day / verified gates live in live-service treasureChestLogic.test)
 */

jest.mock('../src/api/economyLiveApi', () => ({
  callEconomyBackend: jest.fn(),
}));

const { callEconomyBackend } = require('../src/api/economyLiveApi');
const {
  peekTreasureChest,
  claimTreasureChest,
  claimTreasureChestBonus,
} = require('../src/services/treasureChestService');

describe('treasureChestService', () => {
  beforeEach(() => {
    callEconomyBackend.mockReset();
  });

  it('peek returns server peek payload', async () => {
    callEconomyBackend.mockResolvedValueOnce({
      ok: true,
      verified: true,
      claimableBase: 15,
      claimedToday: false,
    });
    const out = await peekTreasureChest();
    expect(out.ok).toBe(true);
    expect(out.claimableBase).toBe(15);
    expect(callEconomyBackend).toHaveBeenCalledWith('/economy/treasure-chest', 'GET');
  });

  it('maps not_verified from 403', async () => {
    const err = new Error('RESTRICTED');
    err.httpStatus = 403;
    err.code = 'RESTRICTED';
    err.detail = { reason: 'not_verified' };
    callEconomyBackend.mockRejectedValueOnce(err);
    const out = await claimTreasureChest();
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('not_verified');
  });

  it('bonus passes optional postId', async () => {
    callEconomyBackend.mockResolvedValueOnce({ ok: true, reward: 10, alreadyClaimed: false });
    const out = await claimTreasureChestBonus('post-1');
    expect(out.ok).toBe(true);
    expect(callEconomyBackend).toHaveBeenCalledWith(
      '/economy/treasure-chest/bonus',
      'POST',
      { postId: 'post-1' }
    );
  });
});
