import {
  sanitizeStageUrl,
  normalizeStageConfig,
  normalizeStageLink,
  buildStageModel,
  buildStageChecklist,
  defaultStageConfig,
} from '../stageService';
import { STAGE_MAX_LINKS, STAGE_MAX_PINS, STAGE_MAX_TOP_CIRCLE } from '../stageCatalog';

describe('stageService', () => {
  test('sanitizeStageUrl blocks dangerous schemes and adds https', () => {
    expect(sanitizeStageUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeStageUrl('data:text/html,hi')).toBe('');
    expect(sanitizeStageUrl('blyp.world')).toBe('https://blyp.world/');
    expect(sanitizeStageUrl('https://blyp.world/x')).toBe('https://blyp.world/x');
  });

  test('normalizeStageConfig clamps arrays and defaults theme', () => {
    const cfg = normalizeStageConfig({
      themeId: 'nope',
      links: Array.from({ length: 10 }, (_, i) => ({ label: `L${i}`, url: `https://x.test/${i}` })),
      topCircle: Array.from({ length: 20 }, (_, i) => `u${i}`),
      pinnedPostIds: Array.from({ length: 9 }, (_, i) => `p${i}`),
      showPastLives: 'yes',
    });
    expect(cfg.themeId).toBe('midnight_teal');
    expect(cfg.links).toHaveLength(STAGE_MAX_LINKS);
    expect(cfg.topCircle).toHaveLength(STAGE_MAX_TOP_CIRCLE);
    expect(cfg.pinnedPostIds).toHaveLength(STAGE_MAX_PINS);
    expect(cfg.showPastLives).toBe(false);
  });

  test('normalizeStageLink drops bad urls', () => {
    expect(normalizeStageLink({ label: 'x', url: 'ftp://bad' })).toBeNull();
    expect(normalizeStageLink({ label: 'Site', url: 'example.com' })?.url).toBe('https://example.com/');
  });

  test('buildStageModel prefers stage display name and real bio (no fake welcome)', () => {
    const model = buildStageModel('uid1', {
      username: 'alex',
      displayName: 'alex',
      bio: '',
      stage: { displayName: 'Alex Stage', themeId: 'ember_stage', vibe: 'late nights' },
    });
    expect(model.displayName).toBe('Alex Stage');
    expect(model.username).toBe('alex');
    expect(model.bio).toBe('');
    expect(model.stage.vibe).toBe('late nights');
    expect(model.theme.id).toBe('ember_stage');
  });

  test('checklist reports empty Stage progress', () => {
    const model = buildStageModel('u', { username: 'a', stage: defaultStageConfig() });
    const list = buildStageChecklist(model);
    expect(list.every((x) => x.done === false || x.id === 'theme')).toBe(true);
    expect(list.find((x) => x.id === 'cover')?.done).toBe(false);
  });
});
