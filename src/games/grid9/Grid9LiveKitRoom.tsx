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
import { Text, View } from './nw';

type LiveKitMods = {
  LiveKitRoom: React.ComponentType<any>;
  VideoTrack: React.ComponentType<any>;
  useTracks: (opts?: any) => any[];
  TrackSource: any;
};

type Grid9LiveKitContextValue = {
  status: string;
  configured: boolean;
  mods: LiveKitMods | null;
  localParticipantId: string | null;
};

const Grid9LiveKitContext = createContext<Grid9LiveKitContextValue>({
  status: 'idle',
  configured: false,
  mods: null,
  localParticipantId: null,
});

export function useGrid9LiveKit(): Grid9LiveKitContextValue {
  return useContext(Grid9LiveKitContext);
}

/**
 * Single LiveKit room for the whole arena: local combatant publishes once;
 * every seat tile subscribes via useGrid9SeatCameraTrack.
 */
export function Grid9LiveKitProvider({
  matchId,
  enabled,
  publish,
  children,
  onStatus,
}: {
  matchId: string | null;
  enabled: boolean;
  publish: boolean;
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
        try {
          await lk.AudioSession?.configureAudio?.({
            android: {
              preferredOutputList: ['speaker', 'bluetooth', 'headset', 'earpiece'],
            },
            ios: { defaultOutput: 'speaker' },
          });
          await lk.AudioSession?.startAudioSession?.();
        } catch {
          /* soft */
        }
        if (cancelled) return;
        setMods({
          LiveKitRoom: lk.LiveKitRoom,
          VideoTrack: lk.VideoTrack,
          useTracks: lk.useTracks,
          TrackSource: client?.Track?.Source || null,
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
        lk.AudioSession?.stopAudioSession?.();
      } catch {
        /* soft */
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
        options={{ adaptiveStream: true, dynacast: true }}
        onError={() => {
          setStatus('room-error');
          onStatus?.('room-error');
        }}
      >
        {children}
      </Room>
    </Grid9LiveKitContext.Provider>
  );
}

/** Renders one camera tile for a participant identity inside the shared room. */
export function Grid9SeatCamera({
  participantId,
}: {
  participantId: string | null;
}) {
  const { mods } = useGrid9LiveKit();
  if (!mods || !participantId) return null;
  return (
    <Grid9SeatCameraInner
      participantId={participantId}
      VideoTrack={mods.VideoTrack}
      useTracks={mods.useTracks}
      TrackSource={mods.TrackSource}
    />
  );
}

function Grid9SeatCameraInner({
  participantId,
  VideoTrack,
  useTracks,
  TrackSource,
}: {
  participantId: string;
  VideoTrack: React.ComponentType<any>;
  useTracks: (sources?: any, opts?: any) => any[];
  TrackSource: any;
}) {
  // useTracks expects SourcesArray as first arg — NOT `{ sources: [...] }`.
  // Wrong shape throws / returns nothing → blank seat tiles (cam P0).
  const cameraSource = TrackSource?.Camera ?? 'camera';
  const tracks = useTracks([cameraSource]);
  const track = useMemo(() => {
    if (!Array.isArray(tracks)) return null;
    return (
      tracks.find(
        (item: any) =>
          String(item?.participant?.identity || '') === participantId &&
          item?.publication,
      ) ?? null
    );
  }, [participantId, tracks]);
  if (!track) return null;
  return (
    <RnView style={StyleSheet.absoluteFill} pointerEvents="none">
      <VideoTrack trackRef={track} style={StyleSheet.absoluteFill} objectFit="cover" />
    </RnView>
  );
}
