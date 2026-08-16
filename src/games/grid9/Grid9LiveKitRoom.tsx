import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { StyleSheet, View as RnView } from 'react-native';
import {
  fetchGrid9LiveKitToken,
  type Grid9LiveKitCreds,
} from './grid9LiveKitToken';
import { requestCameraAndAudioPermission } from '../../utils/permissions';
import {
  burstGrid9Loudspeaker,
  configureGrid9LiveKitAudio,
  startGrid9LoudspeakerGuard,
  stopGrid9LoudspeakerGuard,
} from './grid9LiveKitAudio';
import { Text, View } from './nw';

type LiveKitMods = {
  LiveKitRoom: React.ComponentType<any>;
  VideoTrack: React.ComponentType<any>;
  useTracks: (sources?: any, opts?: any) => any[];
  TrackSource: any;
  useLocalParticipant?: () => {
    localParticipant?: {
      setMicrophoneEnabled?: (enabled: boolean) => Promise<void> | void;
    };
    isMicrophoneEnabled?: boolean;
  };
};

type Grid9LiveKitContextValue = {
  status: string;
  configured: boolean;
  mods: LiveKitMods | null;
  localParticipantId: string | null;
};

type Grid9MicContextValue = {
  micEnabled: boolean;
  canMute: boolean;
  toggleMic: () => void;
};

const Grid9LiveKitContext = createContext<Grid9LiveKitContextValue>({
  status: 'idle',
  configured: false,
  mods: null,
  localParticipantId: null,
});

const Grid9MicContext = createContext<Grid9MicContextValue>({
  micEnabled: true,
  canMute: false,
  toggleMic: () => undefined,
});

export function useGrid9LiveKit(): Grid9LiveKitContextValue {
  return useContext(Grid9LiveKitContext);
}

export function useGrid9Mic(): Grid9MicContextValue {
  return useContext(Grid9MicContext);
}

/**
 * Single LiveKit room for the whole arena: local combatant publishes once;
 * every seat tile subscribes via useGrid9SeatCameraTrack.
 */
export function Grid9LiveKitProvider({
  matchId,
  enabled,
  publish,
  forceUnmute = false,
  children,
  onStatus,
}: {
  matchId: string | null;
  enabled: boolean;
  publish: boolean;
  /** Spotlight / roulette called this seat up — force mic on. */
  forceUnmute?: boolean;
  children: React.ReactNode;
  onStatus?: (status: string) => void;
}) {
  const [creds, setCreds] = useState<Grid9LiveKitCreds | null>(null);
  const [status, setStatus] = useState('idle');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [mods, setMods] = useState<LiveKitMods | null>(null);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    if (!enabled || !matchId) {
      setCreds(null);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let allowed = !publish;
        if (publish) {
          setStatus('requesting-permission');
          onStatus?.('requesting-permission');
          allowed = await requestCameraAndAudioPermission();
          if (!allowed) {
            if (!cancelled) {
              setPermissionDenied(true);
              setStatus('permission-denied');
              onStatus?.('permission-denied');
            }
          } else if (!cancelled) {
            setPermissionDenied(false);
          }
        }
        const next = await fetchGrid9LiveKitToken(matchId);
        if (cancelled) return;
        if (!next) {
          setCreds(null);
          setConfigured(false);
          setStatus('unavailable');
          onStatus?.('unavailable');
          return;
        }
        setConfigured(true);
        setCreds(next);
        const ready = publish && !allowed ? 'permission-denied' : 'ready';
        setStatus(ready);
        onStatus?.(ready);
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          onStatus?.('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, matchId, publish, onStatus]);

  useEffect(() => {
    if (!creds) {
      setMods(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line global-require
        const { registerLiveKitGlobals } = require('../../runtime/registerLiveKitGlobals');
        registerLiveKitGlobals();
        // eslint-disable-next-line global-require
        const lk = require('@livekit/react-native');
        // eslint-disable-next-line global-require
        const client = require('livekit-client');
        await configureGrid9LiveKitAudio(lk);
        if (cancelled) {
          await stopGrid9LoudspeakerGuard(lk);
          return;
        }
        startGrid9LoudspeakerGuard(lk);
        setMods({
          LiveKitRoom: lk.LiveKitRoom,
          VideoTrack: lk.VideoTrack,
          useTracks: lk.useTracks,
          TrackSource: client?.Track?.Source || null,
          useLocalParticipant: lk.useLocalParticipant,
        });
      } catch {
        if (!cancelled) {
          setStatus('module-missing');
          onStatus?.('module-missing');
        }
      }
    })();
    return () => {
      cancelled = true;
      try {
        // eslint-disable-next-line global-require
        const lk = require('@livekit/react-native');
        void stopGrid9LoudspeakerGuard(lk);
      } catch {
        void stopGrid9LoudspeakerGuard();
      }
    };
  }, [creds, onStatus]);

  const value = useMemo<Grid9LiveKitContextValue>(
    () => ({
      status,
      configured,
      mods,
      localParticipantId: creds?.participantId ?? null,
    }),
    [status, configured, mods, creds?.participantId],
  );

  if (!enabled || !matchId) {
    return (
      <Grid9LiveKitContext.Provider value={value}>
        {children}
      </Grid9LiveKitContext.Provider>
    );
  }

  if (!creds || !mods) {
    return (
      <Grid9LiveKitContext.Provider value={value}>
        {children}
        {!configured || status === 'unavailable' ? (
          <View className="absolute left-3 right-3 top-1 z-20 rounded-lg border border-amber-400/50 bg-blyp-ink/90 px-2 py-1">
            <Text className="text-center text-[9px] font-black uppercase tracking-[1px] text-amber-300">
              LiveKit not configured on server — cams offline
            </Text>
          </View>
        ) : permissionDenied && publish ? (
          <View className="absolute left-3 right-3 top-1 z-20 rounded-lg border border-blyp-primary/50 bg-blyp-ink/90 px-2 py-1">
            <Text className="text-center text-[9px] font-black uppercase tracking-[1px] text-blyp-primary">
              Allow camera / mic for your seat tile
            </Text>
          </View>
        ) : null}
      </Grid9LiveKitContext.Provider>
    );
  }

  const Room = mods.LiveKitRoom;
  const shouldPublish = Boolean(publish && creds.canPublish && !permissionDenied);
  return (
    <Grid9LiveKitContext.Provider value={value}>
      <Room
        serverUrl={creds.url}
        token={creds.token}
        connect
        audio={shouldPublish}
        video={shouldPublish ? { facingMode: 'user' } : false}
        options={{ adaptiveStream: true, dynacast: true, autoSubscribe: true }}
        onConnected={() => {
          burstGrid9Loudspeaker();
        }}
        onError={() => {
          setStatus('room-error');
          onStatus?.('room-error');
        }}
      >
        <Grid9MicTree forceUnmute={forceUnmute && shouldPublish}>
          {children}
        </Grid9MicTree>
      </Room>
    </Grid9LiveKitContext.Provider>
  );
}

function Grid9MicTree({
  forceUnmute,
  children,
}: {
  forceUnmute: boolean;
  children: React.ReactNode;
}) {
  const { mods } = useGrid9LiveKit();
  const useLocalParticipant = mods?.useLocalParticipant;
  if (typeof useLocalParticipant !== 'function') {
    return <>{children}</>;
  }
  return (
    <Grid9MicBridge forceUnmute={forceUnmute} useLocalParticipant={useLocalParticipant}>
      {children}
    </Grid9MicBridge>
  );
}

function Grid9MicBridge({
  forceUnmute,
  useLocalParticipant,
  children,
}: {
  forceUnmute: boolean;
  useLocalParticipant: NonNullable<LiveKitMods['useLocalParticipant']>;
  children: React.ReactNode;
}) {
  const local = useLocalParticipant();
  const participant = local?.localParticipant;
  const micEnabled = local?.isMicrophoneEnabled !== false;

  useEffect(() => {
    if (!forceUnmute || !participant?.setMicrophoneEnabled) return;
    void Promise.resolve(participant.setMicrophoneEnabled(true)).catch(() => undefined);
  }, [forceUnmute, participant]);

  const value = useMemo<Grid9MicContextValue>(
    () => ({
      micEnabled,
      canMute: Boolean(participant?.setMicrophoneEnabled),
      toggleMic: () => {
        if (!participant?.setMicrophoneEnabled) return;
        void Promise.resolve(participant.setMicrophoneEnabled(!micEnabled)).catch(
          () => undefined,
        );
      },
    }),
    [micEnabled, participant],
  );

  return <Grid9MicContext.Provider value={value}>{children}</Grid9MicContext.Provider>;
}

/** Renders one camera tile for a participant identity inside the shared room. */
export function Grid9SeatCamera({
  participantId,
  identities,
}: {
  participantId: string | null;
  identities?: string[] | null;
}) {
  const { mods } = useGrid9LiveKit();
  const ids = (identities || []).filter(Boolean);
  if (participantId && !ids.includes(participantId)) ids.unshift(participantId);
  if (!mods || ids.length === 0) return null;
  return (
    <Grid9SeatCameraInner
      identities={ids}
      VideoTrack={mods.VideoTrack}
      useTracks={mods.useTracks}
      TrackSource={mods.TrackSource}
    />
  );
}

function Grid9SeatCameraInner({
  identities,
  VideoTrack,
  useTracks,
  TrackSource,
}: {
  identities: string[];
  VideoTrack: React.ComponentType<any>;
  useTracks: (sources?: any, opts?: any) => any[];
  TrackSource: any;
}) {
  // Default onlySubscribed:true hides remote cams until something already
  // subscribed — local publisher sees themselves, viewers see blank tiles.
  const cameraSource = TrackSource?.Camera ?? 'camera';
  const tracks = useTracks([cameraSource], { onlySubscribed: false });
  const track = useMemo(() => {
    if (!Array.isArray(tracks)) return null;
    return (
      tracks.find((item: any) => {
        const identity = String(item?.participant?.identity || '').trim();
        const name = String(item?.participant?.name || '').trim();
        return (
          Boolean(item?.publication) &&
          (identities.includes(identity) || identities.includes(name))
        );
      }) ?? null
    );
  }, [identities, tracks]);

  useEffect(() => {
    const pub = track?.publication as
      | { isSubscribed?: boolean; setSubscribed?: (next: boolean) => void }
      | undefined;
    if (pub && pub.isSubscribed === false && typeof pub.setSubscribed === 'function') {
      try {
        pub.setSubscribed(true);
      } catch {
        /* soft */
      }
    }
    // First joiner (Fold) snaps to earpiece when the later seat's peer connects.
    if (track && track?.participant?.isLocal !== true) {
      burstGrid9Loudspeaker();
    }
  }, [track]);

  if (!track) return null;
  return (
    <RnView style={StyleSheet.absoluteFill} pointerEvents="none">
      <VideoTrack trackRef={track} style={StyleSheet.absoluteFill} objectFit="cover" />
    </RnView>
  );
}
