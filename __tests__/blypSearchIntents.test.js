import { needsLocationForQuery, stripNearMePhrases } from '../src/services/locationService';
import { looksLikeWatch } from '../src/services/userWatchService';
import { looksLikeEventWatch } from '../src/services/eventWatchService';
import { parseReminder } from '../src/services/reminderService';

describe('locationService', () => {
  it('detects near-me queries', () => {
    expect(needsLocationForQuery('takeaways near me')).toBe(true);
    expect(needsLocationForQuery('coffee nearby')).toBe(true);
    expect(needsLocationForQuery('funny football clips')).toBe(false);
  });

  it('strips proximity phrases', () => {
    expect(stripNearMePhrases('takeaways near me')).toBe('takeaways');
  });
});

describe('eventWatchService', () => {
  it('detects battle event watches', () => {
    expect(looksLikeEventWatch("notify me when there's a battle")).toBe(true);
    expect(looksLikeEventWatch('tell me when a battle goes live')).toBe(true);
    expect(looksLikeEventWatch('arrange a battle between me and Jordan')).toBe(false);
  });
});

describe('userWatchService', () => {
  it('detects live watch phrasing', () => {
    expect(looksLikeWatch("remind me of when Melody's next live")).toBe(true);
    expect(looksLikeWatch('notify me when Melody goes live')).toBe(true);
    expect(looksLikeWatch('takeaways near me')).toBe(false);
  });
});

describe('reminderService vs watch', () => {
  it('does not treat live watches as calendar reminders', () => {
    expect(parseReminder("remind me when Melody goes live").isReminder).toBe(false);
    expect(parseReminder('remind me to buy milk tomorrow').isReminder).toBe(true);
  });
});
