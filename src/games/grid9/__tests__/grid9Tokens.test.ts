import {
  coinsFromTokensConvert,
  GRID9_AUDIENCE_GIFT_JACKPOT_BPS,
  GRID9_AUDIENCE_GIFT_SEAT_BPS,
  tokensFromJackpotCoins,
} from '../constants';

describe('grid9 token + gift constants', () => {
  it('locks 70% seat / 30% jackpot gift split', () => {
    expect(GRID9_AUDIENCE_GIFT_SEAT_BPS).toBe(7000);
    expect(GRID9_AUDIENCE_GIFT_JACKPOT_BPS).toBe(3000);
  });

  it('credits tokens at 50% of jackpot', () => {
    expect(tokensFromJackpotCoins(200)).toBe(100);
  });

  it('instant converts tokens with +15% ceil', () => {
    expect(coinsFromTokensConvert(50)).toBe(58);
  });
});
