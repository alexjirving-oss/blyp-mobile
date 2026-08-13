import assert from 'node:assert/strict';
import { coinsFromGemsConvert, describeGemToCoinRate } from './gemToCoinConvert';

assert.equal(coinsFromGemsConvert(50), 58, '50 gems → ceil(57.5) = 58');
assert.equal(coinsFromGemsConvert(1), 2, '1 gem → ceil(1.15) = 2');
assert.equal(coinsFromGemsConvert(100), 115, '100 gems → 115');
assert.equal(coinsFromGemsConvert(0), 0);
assert.equal(coinsFromGemsConvert(-5), 0);
assert.match(describeGemToCoinRate(), /1 gem = 1 coin \+ 15%/);
// Must NOT apply a second half.
assert.notEqual(coinsFromGemsConvert(50), Math.floor(50 * 0.5 * 1.15));
console.log('gemToCoinConvert.test: ok');
