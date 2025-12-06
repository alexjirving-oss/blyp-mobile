/**
 * IVS Host Session Hook
 * 
 * React hook for managing IVS streaming session from host perspective.
 * Uses LiveStreamingClient abstraction for unified multi-platform support.
 * Handles host lifecycle, local media state, token fetching, and participants tracking.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  LiveStreamingClient,
  StreamParticipant,
  NetworkQuality,
  HostSessionParams,
} from '../../../streaming/LiveStreamingClient';
import { getIVSNativeClient } from '../../../streaming/IVSNativeClient';
import { ivsHostStart } from '../../../api/ivsLiveApi';

export type IVSConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

type UseIVSHostSessionArgs = {
  enabled: boolean;
  streamId?: string;
  title?: string;
};

type UseIVSHostSessionResult = {
  connectionState: IVSConnectionState;
  participants: StreamParticipant[];
  networkQuality: NetworkQuality;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  startStreaming: () => Promise<void>;
  stopStreaming: () => Promise<void>;
  setMicEnabled: (enabled: boolean) => Promise<void>;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
  switchCamera: () => Promise<void>;
  error: string | null;
};

export function useIVSHostSession(args: UseIVSHostSessionArgs): UseIVSHostSessionResult {
  const { enabled, streamId: externalStreamId, title } = args;

  const [connectionState, setConnectionState] = useState<IVSConnectionState>('idle');
  const [participants, setParticipants] = useState<StreamParticipant[]>([]);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>(NetworkQuality.UNKNOWN);
  const [isMicEnabled, setIsMicEnabledState] = useState(true);
  const [isCameraEnabled, setIsCameraEnabledState] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamId, setStreamId] = useState<string | null>(externalStreamId || null);

  const client: LiveStreamingClient = getIVSNativeClient();

  // Fetch token and start native broadcast
  const startStreaming = useCallback(async () => {
    if (!enabled) {
      setError('Host session not enabled');
      return;
    }

    try {
      setConnectionState('connecting');
      setError(null);

      console.log('[IVS_HOST][START_STREAMING]', { streamId, title });

      // 1. Fetch participant token from backend
      const response = await ivsHostStart({
        streamId: streamId || undefined,
        title,
      });

      console.log('[IVS_HOST][TOKEN_RECEIVED]', {
        streamId: response.streamId,
        stageArn: response.stageArn,
      });

      // 2. Update streamId
      setStreamId(response.streamId);

      // 3. Start host session via LiveStreamingClient
      const hostParams: HostSessionParams = {
        stageArn: response.stageArn,
        token: response.participantToken,
        sessionId: response.streamId,
      };

      await client.startHostSession(hostParams);
      setConnectionState('connected');

      console.log('[IVS_HOST][STREAMING_STARTED]', { streamId: response.streamId });
    } catch (err) {
      console.error('[IVS_HOST][START_ERROR]', err);
      setError(err instanceof Error ? err.message : 'Failed to start streaming');
      setConnectionState('disconnected');
    }
  }, [client, enabled, streamId, title]);

  // Stop streaming and disconnect
  const stopStreaming = useCallback(async () => {
    try {
      console.log('[IVS_HOST][STOP_STREAMING]', { streamId });
      
      await client.stopHostSession();
      
      setConnectionState('idle');
      console.log('[IVS_HOST][STREAMING_STOPPED]');
    } catch (err) {
      console.error('[IVS_HOST][STOP_ERROR]', err);
      setError(err instanceof Error ? err.message : 'Failed to stop streaming');
      setConnectionState('disconnected');
    }
  }, [client, streamId]);

  // Media control callbacks
  const setMicEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        await client.setMicEnabled(enabled);
        setIsMicEnabledState(enabled);
      } catch (err) {
        console.error('[IVS_HOST][SET_MIC_ERROR]', err);
        throw err;
      }
    },
    [client]
  );

  const setCameraEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        await client.setCameraEnabled(enabled);
        setIsCameraEnabledState(enabled);
      } catch (err) {
        console.error('[IVS_HOST][SET_CAMERA_ERROR]', err);
        throw err;
      }
    },
    [client]
  );

  const switchCamera = useCallback(async () => {
    try {
      await client.switchCamera();
    } catch (err) {
      console.error('[IVS_HOST][SWITCH_CAMERA_ERROR]', err);
      throw err;
    }
  }, [client]);

  // Listen to LiveStreamingClient events
  useEffect(() => {
    if (!enabled) return;

    // Local participant joined
    const unsubLocalJoined = client.on('localJoined', (event) => {
      console.log('[IVS_HOST][LOCAL_JOINED]', event.payload);
    });

    // Local participant left
    const unsubLocalLeft = client.on('localLeft', (event) => {
      console.log('[IVS_HOST][LOCAL_LEFT]', event.payload);
    });

    // Remote participant joined
    const unsubRemoteJoined = client.on('remoteParticipantJoined', (event) => {
      console.log('[IVS_HOST][REMOTE_JOINED]', event.payload);
      // Update participants list
      setParticipants(client.getParticipants());
    });

    // Remote participant updated
    const unsubRemoteUpdated = client.on('remoteParticipantUpdated', (event) => {
      console.log('[IVS_HOST][REMOTE_UPDATED]', event.payload);
      // Update participants list
      setParticipants(client.getParticipants());
    });

    // Remote participant left
    const unsubRemoteLeft = client.on('remoteParticipantLeft', (event) => {
      console.log('[IVS_HOST][REMOTE_LEFT]', event.payload);
      // Update participants list
      setParticipants(client.getParticipants());
    });

    // Network quality updated
    const unsubNetworkQuality = client.on('networkQualityUpdated', (event) => {
      console.log('[IVS_HOST][NETWORK_QUALITY]', event.payload);
      const payload = event.payload as any;
      setNetworkQuality(payload.quality);
    });

    // Error event
    const unsubError = client.on('error', (event) => {
      console.error('[IVS_HOST][ERROR]', event.payload);
      const payload = event.payload as any;
      setError(payload.message);
      if (payload.fatal) {
        setConnectionState('disconnected');
      }
    });

    // Cleanup subscriptions on unmount
    return () => {
      unsubLocalJoined();
      unsubLocalLeft();
      unsubRemoteJoined();
      unsubRemoteUpdated();
      unsubRemoteLeft();
      unsubNetworkQuality();
      unsubError();
    };
  }, [enabled, client]);

  return {
    connectionState,
    participants,
    networkQuality,
    isMicEnabled,
    isCameraEnabled,
    startStreaming,
    stopStreaming,
    setMicEnabled,
    setCameraEnabled,
    switchCamera,
    error,
  };
}
