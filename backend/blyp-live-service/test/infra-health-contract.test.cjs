const test = require('node:test');
const assert = require('node:assert/strict');

const { checkRedis } = require('../dist/economy/infra');

test('checkRedis connects a lazy client before pinging it', async () => {
  let status = 'wait';
  const calls = [];
  const redis = {
    get status() {
      return status;
    },
    async connect() {
      calls.push('connect');
      status = 'ready';
    },
    async ping() {
      calls.push('ping');
      return 'PONG';
    },
  };

  const result = await checkRedis(redis);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ['connect', 'ping']);
});

test('checkRedis fails fast without pinging a client that is not ready', async () => {
  let connectCalled = false;
  let pingCalled = false;
  const redis = {
    status: 'connecting',
    async connect() {
      connectCalled = true;
    },
    async ping() {
      pingCalled = true;
      return 'PONG';
    },
  };

  const result = await checkRedis(redis);

  assert.deepEqual(result, {
    ok: false,
    error: 'Redis is not ready (status: connecting)',
  });
  assert.equal(connectCalled, false);
  assert.equal(pingCalled, false);
});

test('checkRedis reports an unexpected ping response', async () => {
  const redis = {
    status: 'ready',
    async connect() {
      throw new Error('connect should not be called for a ready client');
    },
    async ping() {
      return 'NOT_PONG';
    },
  };

  const result = await checkRedis(redis);

  assert.deepEqual(result, {
    ok: false,
    error: 'Unexpected PING response: NOT_PONG',
  });
});
