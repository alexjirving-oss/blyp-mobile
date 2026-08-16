import assert from 'node:assert/strict';
import {
  coinsFromTokensConvert,
  describeTokenToCoinRate,
} from './tokenToCoinConvert';
import {
  splitGrid9AudienceGiftCoins,
  tokensFromJackpotCoins,
} from '../games/grid9/constants';

assert.equal(coinsFromTokensConvert(50), 58, '50 tokens → ceil(57.5) = 58');
assert.equal(coinsFromTokensConvert(1), 2, '1 token → ceil(1.15) = 2');
assert.equal(coinsFromTokensConvert(100), 115);
assert.equal(coinsFromTokensConvert(0), 0);
assert.match(describeTokenToCoinRate(), /1 token = 1 coin \+ 15%/);

assert.equal(tokensFromJackpotCoins(100), 50);
assert.equal(tokensFromJackpotCoins(101), 50);
assert.deepEqual(splitGrid9AudienceGiftCoins(10), { seatCoins: 7, jackpotCoins: 3 });
assert.deepEqual(splitGrid9AudienceGiftCoins(15), { seatCoins: 10, jackpotCoins: 5 });

console.log('tokenToCoinConvert.test: ok');
