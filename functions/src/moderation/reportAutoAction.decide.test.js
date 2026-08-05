/**
 * Lightweight decide() checks for child_safety auto-hide hardening.
 * Run: node --test functions/src/moderation/reportAutoAction.decide.test.js
 * (compiled JS preferred once built)
 */
const assert = require('assert');

// Load from compiled output when present; otherwise skip compile-time TS.
let decide;
let CRITICAL_HIDE_REPORTERS;
try {
  ({
    __test: { decide, CRITICAL_HIDE_REPORTERS },
  } = require('../../lib/moderation/reportAutoAction.js'));
} catch {
  console.log('SKIP: compile functions first (npm run build)');
  process.exit(0);
}

function base(over = {}) {
  return {
    targetType: 'post',
    targetId: 'p1',
    reasonCode: 'child_safety',
    totalReports: 1,
    distinctReporters: 1,
    reasons: { child_safety: 1 },
    reportId: 'r1',
    ...over,
  };
}

const one = decide(base());
assert.strictEqual(one.hide, false, 'single child_safety reporter must not hide');
assert.strictEqual(one.alert, true, 'single child_safety still alerts for review');

const two = decide(base({ totalReports: 2, distinctReporters: 2, reasons: { child_safety: 2 } }));
assert.strictEqual(two.hide, true, 'two distinct child_safety reporters may hide');
assert.ok(CRITICAL_HIDE_REPORTERS >= 2);

const sameReporterTwice = decide(
  base({ totalReports: 5, distinctReporters: 1, reasons: { child_safety: 5 } })
);
assert.strictEqual(
  sameReporterTwice.hide,
  false,
  'many reports from one reporter must not hide'
);

console.log('reportAutoAction decide tests PASSED');
