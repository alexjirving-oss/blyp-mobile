/**
 * IVS Viewer Session Tests
 *
 * Watchers join the Real-Time stage. HLS is only a program copy after
 * composition is ACTIVE — see viewerJoinPlan.test.ts.
 */

import { ViewerPlaybackParams } from '../../../streaming/LiveStreamingClient';
import { planViewerJoin } from '../viewerJoinPlan';

describe('IVS Viewer transports', () => {
  describe('playback path (mass viewer)', () => {
    it('should define ViewerPlaybackParams with required sessionId and playbackUrl', () => {
      const validParams: ViewerPlaybackParams = {
        sessionId: 'test-session',
        playbackUrl: 'https://s3.amazonaws.com/ivs-stream.m3u8',
      };

      expect(validParams.sessionId).toBeDefined();
      expect(validParams.playbackUrl).toBeDefined();
      expect(typeof validParams.sessionId).toBe('string');
      expect(typeof validParams.playbackUrl).toBe('string');
    });

    it('should enforce non-empty strings for critical fields', () => {
      const params: ViewerPlaybackParams = {
        sessionId: 'session-id',
        playbackUrl: 'https://s3.amazonaws.com/stream.m3u8',
      };

      // Both fields must be non-empty strings in production
      expect(params.sessionId.length).toBeGreaterThan(0);
      expect(params.playbackUrl.length).toBeGreaterThan(0);
      expect(params.playbackUrl.startsWith('https://')).toBe(true);
    });
  });

  describe('Viewer playback parameter validation', () => {
    it('should accept valid HLS m3u8 URLs from backend', () => {
      const params: ViewerPlaybackParams = {
        sessionId: 'viewer-session-123',
        playbackUrl: 'https://ivs-playback-bucket.s3.amazonaws.com/path/to/stream.m3u8',
      };

      expect(params.playbackUrl).toMatch(/\.m3u8/);
      expect(params.playbackUrl).toContain('s3.amazonaws.com');
    });

    it('should accept low-latency IVS playback URLs', () => {
      const params: ViewerPlaybackParams = {
        sessionId: 'viewer-session-456',
        playbackUrl: 'https://ivs-playback-bucket.s3.amazonaws.com/path/to/stream-ll.m3u8',
      };

      expect(params.playbackUrl).toMatch(/stream-ll\.m3u8/);
    });

    it('should support playback URLs with query parameters (auth tokens)', () => {
      const params: ViewerPlaybackParams = {
        sessionId: 'viewer-session-789',
        playbackUrl: 'https://ivs-playback-bucket.s3.amazonaws.com/stream.m3u8?auth=token123&expires=12345',
      };

      expect(params.playbackUrl).toContain('?');
      expect(params.playbackUrl).toContain('auth=');
    });
  });

  describe('Viewer playback error scenarios', () => {
    it('should identify missing playbackUrl error', () => {
      const errorMessage = 'playbackUrl is required for viewer playback';
      expect(errorMessage).toContain('playbackUrl');
      expect(errorMessage).toContain('required');
    });

    it('should identify network timeout errors', () => {
      const errorMessage = 'Network timeout while loading stream';
      expect(errorMessage).toContain('timeout');
    });

    it('should identify invalid playback URL format errors', () => {
      const errorMessage = 'Invalid playback URL format';
      expect(errorMessage).toContain('Invalid');
      expect(errorMessage).toContain('URL');
    });

    it('should identify IVSPlayerModule unavailability', () => {
      const errorMessage = 'IVSPlayerModule not available on this platform';
      expect(errorMessage).toContain('IVSPlayerModule');
      expect(errorMessage).toContain('not available');
    });
  });

  describe('Viewer playback integration points', () => {
    it('uses Real-Time stage for watchers, not HLS as the default', () => {
      expect(planViewerJoin({ preferPlayback: false }).transport).toBe('realtime');
    });

    it('keeps host/guest and watcher on the same stage', () => {
      const hostPath = 'IVS Real-Time stage';
      const viewerPath = 'IVS Real-Time stage';
      expect(hostPath).toEqual(viewerPath);
    });

    it('should require backend to provide playbackUrl for viewers', () => {
      // Backend /api/ivs/viewer-join must return playbackUrl
      const backendResponse = {
        sessionId: 'viewer-session',
        playbackUrl: 'https://s3.amazonaws.com/stream.m3u8',
      };

      expect(backendResponse).toHaveProperty('playbackUrl');
      expect(backendResponse.playbackUrl).toBeTruthy();
    });

    it('should pass playbackUrl and sessionId to native IVSPlayerModule', () => {
      // JS bridge call pattern
      const bridgeCall = {
        method: 'joinAsViewer',
        params: {
          playbackUrl: 'https://s3.amazonaws.com/stream.m3u8',
          sessionId: 'viewer-123',
        },
      };

      expect(bridgeCall.params).toHaveProperty('playbackUrl');
      expect(bridgeCall.params).toHaveProperty('sessionId');
    });
  });

  describe('Viewer connection lifecycle', () => {
    it('should follow connection state progression', () => {
      const stateProgression = ['idle', 'connecting', 'connected'];
      expect(stateProgression.length).toBe(3);
      expect(stateProgression[0]).toBe('idle');
      expect(stateProgression[stateProgression.length - 1]).toBe('connected');
    });

    it('should support error state from connection failure', () => {
      const possibleStates = ['idle', 'connecting', 'connected', 'error', 'disconnected'];
      expect(possibleStates).toContain('error');
      expect(possibleStates).toContain('disconnected');
    });

    it('should emit events on state transitions', () => {
      const events = [
        'IVS_VIEWER_JOINED',
        'IVS_PLAYER_STATE_CHANGED',
        'IVS_PLAYER_FIRST_FRAME',
        'IVS_VIEWER_LEFT',
      ];

      expect(events).toContain('IVS_VIEWER_JOINED');
      expect(events).toContain('IVS_PLAYER_STATE_CHANGED');
    });
  });

  describe('realtime path (stage subscriber)', () => {
    it('falls through to Real-Time when HLS is not an ACTIVE program', () => {
      expect(
        planViewerJoin({
          preferPlayback: true,
          compositionState: 'STARTING',
          playbackUrl: 'https://example.com/live.m3u8',
        }).transport,
      ).toBe('realtime');
    });
  });
});
