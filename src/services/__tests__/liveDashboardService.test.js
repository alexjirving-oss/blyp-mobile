/**
 * @jest-environment node
 */
const {
  normalizeLiveDashboard,
  buildDefaultLiveDashboard,
  getEnabledWidgets,
  listAddableWidgets,
  resolveStageDeskPro,
  FREE_SLOT_LIMIT,
  PRO_SLOT_LIMIT,
  getCatalogEntry,
  STAGE_DESK_NAME,
} = require('../liveDashboardService');

describe('liveDashboardService', () => {
  test('product name is Stage Desk', () => {
    expect(STAGE_DESK_NAME).toBe('Stage Desk');
  });

  test('normalize empty → default layout', () => {
    const d = normalizeLiveDashboard(null);
    expect(d.version).toBe(1);
    expect(d.themeId).toBe('pulse');
    expect(d.widgets.length).toBeGreaterThan(3);
    expect(d.widgets.every((w) => getCatalogEntry(w.type))).toBe(true);
  });

  test('buildDefaultLiveDashboard is stable core set', () => {
    const d = buildDefaultLiveDashboard();
    const types = d.widgets.map((w) => w.type);
    expect(types).toContain('goalBar');
    expect(types).toContain('layoutPicker');
    expect(types).toContain('guestInvites');
  });

  test('free tier caps enabled widgets', () => {
    const d = buildDefaultLiveDashboard();
    // Force many enabled
    d.widgets = d.widgets.map((w) => ({ ...w, enabled: true }));
    const enabled = getEnabledWidgets(d, { isPro: false });
    expect(enabled.length).toBeLessThanOrEqual(FREE_SLOT_LIMIT);
  });

  test('pro tier allows more slots and pro widgets', () => {
    const d = buildDefaultLiveDashboard();
    d.widgets.push({
      id: 'sd_soundAlerts_x',
      type: 'soundAlerts',
      enabled: true,
      config: { enabled: true },
    });
    const free = getEnabledWidgets(d, { isPro: false });
    const pro = getEnabledWidgets(d, { isPro: true });
    expect(free.some((w) => w.type === 'soundAlerts')).toBe(false);
    expect(pro.some((w) => w.type === 'soundAlerts')).toBe(true);
    expect(pro.length).toBeLessThanOrEqual(PRO_SLOT_LIMIT);
  });

  test('listAddableWidgets hides present + locked pro when free', () => {
    const d = buildDefaultLiveDashboard();
    const addable = listAddableWidgets(d, { isPro: false });
    expect(addable.every((c) => c.tier !== 'pro')).toBe(true);
    expect(addable.every((c) => !d.widgets.some((w) => w.type === c.type))).toBe(true);
  });

  test('resolveStageDeskPro respects entitlement', () => {
    expect(resolveStageDeskPro({ entitled: true })).toBe(true);
  });
});
