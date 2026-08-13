jest.mock('../src/services/callService', () => ({
  startCall: jest.fn(async () => ({ ok: true, callId: 'c1' })),
}));

const {
  peerFromCallDoc,
  recentCallPeers,
} = require('../src/services/homeCallEntry');

describe('homeCallEntry', () => {
  const uid = 'me';

  it('resolves the other peer from a call doc', () => {
    const incoming = peerFromCallDoc(
      {
        callerId: 'them',
        calleeId: 'me',
        callerName: 'Alex',
        calleeName: 'Me',
        participants: ['me', 'them'],
        status: 'missed',
        createdAtMs: 100,
      },
      uid,
    );
    expect(incoming).toMatchObject({
      id: 'them',
      displayName: 'Alex',
      isOutgoing: false,
      isMissed: true,
    });

    const outgoing = peerFromCallDoc(
      {
        callerId: 'me',
        calleeId: 'you',
        callerName: 'Me',
        calleeName: 'Sam',
        participants: ['me', 'you'],
        status: 'ended',
        createdAtMs: 200,
      },
      uid,
    );
    expect(outgoing).toMatchObject({
      id: 'you',
      displayName: 'Sam',
      isOutgoing: true,
      isMissed: false,
    });
  });

  it('dedupes recents to the latest call per peer', () => {
    const peers = recentCallPeers(
      [
        {
          id: 'c1',
          callerId: 'a',
          calleeId: 'me',
          callerName: 'Ann',
          participants: ['me', 'a'],
          status: 'missed',
          createdAtMs: 300,
        },
        {
          id: 'c2',
          callerId: 'me',
          calleeId: 'a',
          calleeName: 'Ann',
          participants: ['me', 'a'],
          status: 'ended',
          createdAtMs: 100,
        },
        {
          id: 'c3',
          callerId: 'b',
          calleeId: 'me',
          callerName: 'Bea',
          participants: ['me', 'b'],
          status: 'ended',
          createdAtMs: 200,
        },
      ],
      uid,
      8,
    );
    expect(peers.map((p) => p.id)).toEqual(['a', 'b']);
    expect(peers[0].isMissed).toBe(true);
  });
});
