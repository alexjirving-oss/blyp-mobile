/**
 * Pure debit allocation for gems→coins convert.
 * Available first so cleared UI balance drops; then pending.
 */
import assert from 'node:assert/strict';

function allocateConvertDebit(gemAvailable: number, gemPending: number, amount: number) {
  const avail = Math.max(0, Math.floor(gemAvailable));
  const pending = Math.max(0, Math.floor(gemPending));
  const need = Math.max(0, Math.floor(amount));
  const convertible = avail + pending;
  if (need > convertible) {
    return { ok: false as const, fromAvailable: 0, fromPending: 0, convertible };
  }
  const fromAvailable = need <= avail ? need : avail;
  const fromPending = need - fromAvailable;
  return { ok: true as const, fromAvailable, fromPending, convertible };
}

{
  const a = allocateConvertDebit(501, 1000, 501);
  assert.equal(a.ok, true);
  assert.equal(a.fromAvailable, 501, 'cleared 501 must debit first');
  assert.equal(a.fromPending, 0);
}

{
  const a = allocateConvertDebit(100, 400, 250);
  assert.equal(a.ok, true);
  assert.equal(a.fromAvailable, 100);
  assert.equal(a.fromPending, 150);
}

{
  const a = allocateConvertDebit(0, 501, 501);
  assert.equal(a.ok, true);
  assert.equal(a.fromAvailable, 0);
  assert.equal(a.fromPending, 501);
}

{
  const a = allocateConvertDebit(501, 0, 502);
  assert.equal(a.ok, false);
}

console.log('gemConvertDebit.test: ok');
