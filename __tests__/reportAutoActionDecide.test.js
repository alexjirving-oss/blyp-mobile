/**
 * child_safety auto-hide: require distinct reporters (not a single report).
 * Mirrors functions/src/moderation/reportAutoAction.ts decide() critical path.
 */

const CRITICAL_HIDE_REPORTERS = 2;
const CRITICAL_REASONS = new Set(['child_safety']);

function decide({ reasonCode, totalReports, distinctReporters }) {
  const reporters =
    Number.isFinite(Number(distinctReporters)) && Number(distinctReporters) > 0
      ? Number(distinctReporters)
      : totalReports;
  if (CRITICAL_REASONS.has(reasonCode)) {
    return {
      hide: reporters >= CRITICAL_HIDE_REPORTERS,
      alert: true,
      severity: 'critical',
    };
  }
  return { hide: false, alert: false, severity: 'normal' };
}

describe('reportAutoAction child_safety decide', () => {
  test('one reporter alerts but does not hide', () => {
    const v = decide({
      reasonCode: 'child_safety',
      totalReports: 1,
      distinctReporters: 1,
    });
    expect(v.hide).toBe(false);
    expect(v.alert).toBe(true);
  });

  test('two distinct reporters may hide', () => {
    const v = decide({
      reasonCode: 'child_safety',
      totalReports: 2,
      distinctReporters: 2,
    });
    expect(v.hide).toBe(true);
    expect(v.alert).toBe(true);
  });

  test('many reports from one reporter still do not hide', () => {
    const v = decide({
      reasonCode: 'child_safety',
      totalReports: 5,
      distinctReporters: 1,
    });
    expect(v.hide).toBe(false);
    expect(v.alert).toBe(true);
  });
});
