import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from './frenemiesSettings';

describe('frenemies defaultSettings', () => {
  it('defaults to 15s spin, auto-continue OFF, host pays', () => {
    const s = defaultSettings();
    assert.equal(s.spinMs, 15_000);
    assert.equal(s.autoContinue, false);
    assert.equal(s.housePays, false);
    assert.equal(s.throwCoins, 25);
    assert.equal(s.soloCoins, 25);
  });

  it('snaps spin to 10/15/20/30', () => {
    assert.equal(defaultSettings({ spinMs: 12_000 }).spinMs, 10_000);
    assert.equal(defaultSettings({ spinMs: 18_000 }).spinMs, 20_000);
    assert.equal(defaultSettings({ spinMs: 30_000 }).spinMs, 30_000);
  });

  it('clamps coin rewards to 0..500', () => {
    assert.equal(defaultSettings({ throwCoins: 999 }).throwCoins, 500);
    assert.equal(defaultSettings({ soloCoins: -3 }).soloCoins, 0);
  });
});
