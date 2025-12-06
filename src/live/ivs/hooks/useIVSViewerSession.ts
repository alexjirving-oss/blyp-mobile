/**
 * IVS Viewer Session Hook
 * 
 * React hook for managing IVS streaming session from viewer perspective.
 * Uses LiveStreamingClient abstraction for unified multi-platform support.
 * Handles viewer lifecycle, token fetching, and network quality monitoring.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  LiveStreamingClient,
  NetworkQuality,
  ViewerSessionParams,
} from '../../../streaming/LiveStreamingClient';
import { getIVSNativeClient } from '../../../streaming/IVSNativeClient';
import { ivsViewerJoin } from '../../../api/ivsLiveApi';

export type IVSConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

type UseIVSViewerSessionArgs = {
  streamId: string;
  enabled: boolean;
  autoJoin?: boolean;
};

type UseIVSViewerSessionResult = {
  connectionState: IVSConnectionState;
  networkQuality: NetworkQuality;
  joinStream: () => Promise<void>;
  leaveStream: () => Promise<void>;
  error: string | null;
};

export function useIVSViewerSession(args: UseIVSViewerSessionArgs): UseIVSViewerSessionResult {
  const { streamId, enabled, autoJoin = true } = args;
  const [connectionState, setConnectionState] = useState<IVSConnectionState>('idle');
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>(NetworkQuality.UNKNOWN);
  const [error, setError] = useState<string | null>(null);

  const client: LiveStreamingClient = getIVSNativeClient();

  // Fetch token and join as viewer
  const joinStream = useCallback(async () => {
    if (!enabled) {
      setError('Viewer session not enabled');
      return;
    }

    try {
      setConnectionState('connecting');
      setError(null);

      console.log('[IVS_VIEWER][JOIN_STREAM]', { streamId });

      // 1. Fetch viewer token from backend
      const response = await ivsViewerJoin({
        streamId,
      });

      console.log('[IVS_VIEWER][TOKEN_RECEIVED]', {
        streamId: response.streamId,
        stageArn: response.stageArn,
      });

      // 2. Join as viewer via LiveStreamingClient
      // Note: Backend should return playbackUrl in response; using stageArn as fallback
      const playbackUrl = (response as any).playbackUrl || response.stageArn;
      const viewerParams: ViewerSessionParams = {
        playbackUrl,
        sessionId: response.streamId,
      };

      await client.joinAsViewer(viewerParams);
      setConnectionState('connected');

      console.log('[IVS_VIEWER][JOINED]', { streamId: response.streamId });
    } catch (err) {
      console.error('[IVS_VIEWER][JOIN_ERROR]', err);
      setError(err instanceof Error ? err.message : 'Failed to join stream');
      setConnectionState('disconnected');
    }
  }, [client, enabled, streamId]);

  // Leave stream
  const leaveStream = useCallback(async () => {
    try {
      console.log('[IVS_VIEWER][LEAVE_STREAM]', { streamId });
      
      await client.leaveAsViewer();
      
      setConnectionState('idle');
      console.log('[IVS_VIEWER][LEFT]');
    } catch (err) {
      console.error('[IVS_VIEWER][LEAVE_ERROR]', err);
      setError(err instanceof Error ? err.message : 'Failed to leave stream');
    }
  }, [client, streamId]);

  // Listen to LiveStreamingClient events
  useEffect(() => {
    if (!enabled) return;

    // Network quality updated
    const unsubNetworkQuality = client.on('networkQualityUpdated', (event) => {
      console.log('[IVS_VIEWER][NETWORK_QUALITY]', event.payload);
      const payload = event.payload as any;
      setNetworkQuality(payload.quality);
    });

    // Error event
    const unsubError = client.on('error', (event) => {
      console.error('[IVS_VIEWER][ERROR]', event.payload);
      const payload = event.payload as any;
      setError(payload.message);
      if (payload.fatal) {
        setConnectionState('disconnected');
      }
    });

    // Cleanup subscriptions on unmount
    return () => {
      unsubNetworkQuality();
      unsubError();
    };
  }, [enabled, client]);

  // Auto-join on mount if enabled
  useEffect(() => {
    if (!enabled || !autoJoin || connectionState !== 'idle') return;
    void joinStream();
  }, [enabled, autoJoin, connectionState, joinStream]);

  return {
    connectionState,
    networkQuality,
    joinStream,
    leaveStream,
    error,
  };
}
