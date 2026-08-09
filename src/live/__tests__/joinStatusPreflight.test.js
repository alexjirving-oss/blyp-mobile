import {
  findFocusedLiveStreamRoute,
  shouldEjectEndedLiveProbe,
  popIfEndedLiveProbe,
} from '../joinStatusPreflight';

function liveState(streamId, { nested } = {}) {
  const liveRoute = {
    name: 'LiveStreamScreen',
    params: { streamId, mode: 'viewer' },
    ...(nested
      ? { state: { index: 0, routes: [{ name: 'NestedChrome' }] } }
      : {}),
  };
  return {
    index: 1,
    routes: [{ name: 'Home' }, liveRoute],
  };
}

describe('joinStatusPreflight guards', () => {
  it('finds LiveStreamScreen on the focused path even with nested chrome', () => {
    const route = findFocusedLiveStreamRoute(liveState('abc', { nested: true }));
    expect(route?.params?.streamId).toBe('abc');
  });

  it('allows eject only when generation + route + streamId match', () => {
    expect(
      shouldEjectEndedLiveProbe({
        probeGeneration: 2,
        currentGeneration: 2,
        expectedStreamId: 'abc',
        navigationState: liveState('abc'),
      }),
    ).toBe(true);
  });

  it('blocks eject when a newer open superseded the probe', () => {
    expect(
      shouldEjectEndedLiveProbe({
        probeGeneration: 1,
        currentGeneration: 2,
        expectedStreamId: 'abc',
        navigationState: liveState('abc'),
      }),
    ).toBe(false);
  });

  it('blocks eject after the user left LiveStreamScreen', () => {
    expect(
      shouldEjectEndedLiveProbe({
        probeGeneration: 1,
        currentGeneration: 1,
        expectedStreamId: 'abc',
        navigationState: {
          index: 0,
          routes: [{ name: 'Home' }],
        },
      }),
    ).toBe(false);
  });

  it('blocks eject when focused live is a different streamId', () => {
    expect(
      shouldEjectEndedLiveProbe({
        probeGeneration: 1,
        currentGeneration: 1,
        expectedStreamId: 'abc',
        navigationState: liveState('other'),
      }),
    ).toBe(false);
  });

  it('popIfEndedLiveProbe uses the provided navigator and skips when unguarded', () => {
    const goBack = jest.fn();
    const nav = {
      canGoBack: () => true,
      goBack,
      getState: () => ({ index: 0, routes: [{ name: 'Home' }] }),
      getParent: () => null,
    };
    expect(
      popIfEndedLiveProbe(nav, {
        probeGeneration: 1,
        currentGeneration: 1,
        expectedStreamId: 'abc',
      }),
    ).toBe(false);
    expect(goBack).not.toHaveBeenCalled();

    nav.getState = () => liveState('abc');
    expect(
      popIfEndedLiveProbe(nav, {
        probeGeneration: 1,
        currentGeneration: 1,
        expectedStreamId: 'abc',
      }),
    ).toBe(true);
    expect(goBack).toHaveBeenCalledTimes(1);
  });
});
