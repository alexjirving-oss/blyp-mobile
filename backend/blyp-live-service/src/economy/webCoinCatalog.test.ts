import assert from 'node:assert/strict';
import { findWebCoinPack, WEB_COIN_CATALOG } from './webCoinCatalog';

for (const pack of WEB_COIN_CATALOG) {
  assert.equal(pack.coinsGranted, pack.baseCoins + pack.bonusCoins, pack.packId);
  assert.equal(pack.bonusCoins, Math.round(pack.baseCoins * 0.15), `${pack.packId} ~15%`);
  assert.equal(pack.priceGbp * 100, pack.baseCoins, `${pack.packId} 1p/base`);
}

const p100 = findWebCoinPack('web.coinpack.100');
assert.ok(p100);
assert.equal(p100!.coinsGranted, 115);
assert.equal(findWebCoinPack('missing'), null);
console.log('webCoinCatalog.test: ok');
