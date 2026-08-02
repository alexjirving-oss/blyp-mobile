import assert from 'node:assert/strict';
import test from 'node:test';

import { localSandboxEnabled } from '../src/agent.js';

test('local SDK sandbox is disabled only where Cursor does not support it', () => {
  assert.equal(localSandboxEnabled('win32'), false);
  assert.equal(localSandboxEnabled('linux'), true);
  assert.equal(localSandboxEnabled('darwin'), true);
});
