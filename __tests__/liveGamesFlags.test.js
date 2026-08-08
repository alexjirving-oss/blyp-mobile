jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: {} },
    manifest: { extra: {} },
  },
}));

describe('LiveGamesFlags', () => {
  let Constants;
  let isMarbleRaceEnabled;
  let isArtilleryEnabled;
  let isFrenemiesEnabled;
  let isReactionDuelEnabled;

  beforeEach(() => {
    jest.resetModules();
    Constants = require('expo-constants').default;
    Constants.expoConfig = { extra: {} };
    Constants.manifest = { extra: {} };
    delete process.env.EXPO_PUBLIC_LIVE_MARBLE_RACE_ENABLED;
    delete process.env.EXPO_PUBLIC_LIVE_ARTILLERY_ENABLED;
    delete process.env.EXPO_PUBLIC_LIVE_FRENEMIES_ENABLED;
    delete process.env.EXPO_PUBLIC_LIVE_REACTION_DUEL_ENABLED;
    ({
      isArtilleryEnabled,
      isFrenemiesEnabled,
      isMarbleRaceEnabled,
      isReactionDuelEnabled,
    } = require('../src/config/LiveGamesFlags'));
  });

  test('marble defaults ON when env and extra are empty (production ship path)', () => {
    expect(isMarbleRaceEnabled()).toBe(true);
  });

  test('marble respects explicit off via process.env', () => {
    process.env.EXPO_PUBLIC_LIVE_MARBLE_RACE_ENABLED = '0';
    expect(isMarbleRaceEnabled()).toBe(false);
  });

  test('marble respects expo.extra off (production Hermes path)', () => {
    Constants.expoConfig.extra.EXPO_PUBLIC_LIVE_MARBLE_RACE_ENABLED = '0';
    expect(isMarbleRaceEnabled()).toBe(false);
  });

  test('artillery defaults OFF unless set in extra', () => {
    expect(isArtilleryEnabled()).toBe(false);
    Constants.expoConfig.extra.EXPO_PUBLIC_LIVE_ARTILLERY_ENABLED = 'true';
    expect(isArtilleryEnabled()).toBe(true);
  });

  test('Reaction Duel defaults ON and respects an explicit off switch', () => {
    expect(isReactionDuelEnabled()).toBe(true);
    process.env.EXPO_PUBLIC_LIVE_REACTION_DUEL_ENABLED = 'off';
    expect(isReactionDuelEnabled()).toBe(false);
  });

  test('Frenemies defaults ON and respects an explicit off switch', () => {
    expect(isFrenemiesEnabled()).toBe(true);
    Constants.expoConfig.extra.EXPO_PUBLIC_LIVE_FRENEMIES_ENABLED = 'false';
    expect(isFrenemiesEnabled()).toBe(false);
  });
});
