import {
  grid9HumanCamIdentities,
  grid9TrackMatchesCamIdentity,
} from '../grid9CamIdentity';
import type { Grid9PublicPlayer } from '../protocol';

function human(overrides: Partial<Grid9PublicPlayer> = {}): Grid9PublicPlayer {
  return {
    slotId: 'slot-0',
    slotIndex: 0,
    kind: 'human',
    displayName: 'Alex',
    avatarUrl: null,
    status: 'alive',
    mode: 'combatant',
    health: 100,
    maxHealth: 100,
    shieldPoints: 0,
    maxShieldPoints: 100,
    mercenaryBankrollCoins: 0,
    connectionState: 'connected',
    publicProfileId: 'alex',
    feed: { kind: 'human_live', participantId: 'user-alex' },
    ...overrides,
  };
}

describe('grid9HumanCamIdentities', () => {
  it('collects feed participantId and publicProfileId for viewer subscribe', () => {
    expect(grid9HumanCamIdentities(human())).toEqual(['user-alex', 'alex']);
  });

  it('matches a LiveKit track identity against those aliases', () => {
    expect(
      grid9TrackMatchesCamIdentity(
        { participant: { identity: 'user-alex' }, publication: {} },
        ['user-alex', 'alex'],
      ),
    ).toBe(true);
    expect(
      grid9TrackMatchesCamIdentity(
        { participant: { identity: 'someone-else' }, publication: {} },
        ['user-alex'],
      ),
    ).toBe(false);
  });
});
