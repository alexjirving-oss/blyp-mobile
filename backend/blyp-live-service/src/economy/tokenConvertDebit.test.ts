import assert from 'node:assert/strict';
import { allocateTokenConvertDebit } from './tokenConvertDebit';

const a = allocateTokenConvertDebit(100, 0, 50);
assert.equal(a.ok, true);
if (a.ok) {
  assert.equal(a.fromAvailable, 50);
  assert.equal(a.fromPending, 0);
}

const b = allocateTokenConvertDebit(40, 30, 50);
assert.equal(b.ok, true);
if (b.ok) {
  assert.equal(b.fromAvailable, 40, 'available-first');
  assert.equal(b.fromPending, 10);
}

const c = allocateTokenConvertDebit(10, 5, 100);
assert.equal(c.ok, false);

const d = allocateTokenConvertDebit(0, 20, 15);
assert.equal(d.ok, true);
if (d.ok) {
  assert.equal(d.fromAvailable, 0);
  assert.equal(d.fromPending, 15);
}

console.log('tokenConvertDebit.test: ok');
