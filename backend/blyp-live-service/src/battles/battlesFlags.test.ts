import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { battlesEnabled } from './battlesFlags';

describe('battlesFlags', () => {
  it('defaults to enabled when env unset', () => {
    const prev = process.env.LIVE_BATTLES_ENABLED;
    delete process.env.LIVE_BATTLES_ENABLED;
    assert.equal(battlesEnabled(), true);
    if (prev === undefined) delete process.env.LIVE_BATTLES_ENABLED;
    else process.env.LIVE_BATTLES_ENABLED = prev;
  });

  it('kill switch accepts 0/false/off/no', () => {
    const prev = process.env.LIVE_BATTLES_ENABLED;
    for (const v of ['0', 'false', 'OFF', 'no']) {
      process.env.LIVE_BATTLES_ENABLED = v;
      assert.equal(battlesEnabled(), false, v);
    }
    if (prev === undefined) delete process.env.LIVE_BATTLES_ENABLED;
    else process.env.LIVE_BATTLES_ENABLED = prev;
  });
});
