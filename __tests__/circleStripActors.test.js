import { pickCircleStripActors } from '../src/services/activityService';

describe('pickCircleStripActors', () => {
  it('prefers Top Circle actors when present', () => {
    const items = [
      { actorId: 'f1', inFollowing: true, inTopCircle: false },
      { actorId: 'c1', inFollowing: true, inTopCircle: true },
      { actorId: 'f2', inFollowing: true, inTopCircle: false },
    ];
    expect(pickCircleStripActors(items).map((x) => x.actorId)).toEqual(['c1']);
  });

  it('falls back to following when Top Circle is empty', () => {
    const items = [
      { actorId: 'f1', inFollowing: true, inTopCircle: false },
      { actorId: 'x1', inFollowing: false, inTopCircle: false },
      { actorId: 'f2', inFollowing: true, inTopCircle: false },
      { actorId: 'f1', inFollowing: true, inTopCircle: false },
    ];
    expect(pickCircleStripActors(items).map((x) => x.actorId)).toEqual(['f1', 'f2']);
  });

  it('returns empty when neither graph is present', () => {
    expect(
      pickCircleStripActors([{ actorId: 'x', inFollowing: false, inTopCircle: false }]),
    ).toEqual([]);
  });
});
