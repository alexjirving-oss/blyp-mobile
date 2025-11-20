/*
  Jest tests for StreamSegmentsAdapter fallback logic.
  Uses simple stubs; does not hit real Firestore.
*/

jest.mock('../src/config/firebase', () => {
  const segmentsData = {
    liveStreams: {
      stream1: {
        currentSegment: 2,
        segments: {
          0: { url: 'u0' },
          1: { url: 'u1' },
          2: { url: 'u2' }
        }
      }
    }
  };
  return {
    db: {
      collection: (name) => ({
        doc: (id) => ({
          get: async () => ({
            exists: !!segmentsData[name]?.[id],
            data: () => segmentsData[name][id]
          }),
          collection: (sub) => ({
            get: async () => ({ empty: true, docs: [] }) // simulate no subcollection yet
          })
        })
      })
    }
  };
});

const adapter = require('../src/services/StreamSegmentsAdapter').default;

describe('StreamSegmentsAdapter', () => {
  test('fallback to legacy map when subcollection empty', async () => {
    const window = await adapter.getWindow('stream1', 3);
    expect(window.length).toBe(3);
    expect(window[0].source).toBe('legacyMap');
  });

  test('latest returns highest segment', async () => {
    const latest = await adapter.getLatest('stream1');
    expect(latest.url).toBe('u2');
  });

  test('empty stream returns []', async () => {
    const window = await adapter.getWindow('missing', 2);
    expect(window.length).toBe(0);
  });
});
