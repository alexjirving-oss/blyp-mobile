import React, { useEffect, useRef } from 'react';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { isGrid9Enabled } from '../../config/Grid9Flags';
import { getGrid9Connection } from './connection';
import { Grid9ArenaView } from './Grid9ArenaView';
import { Grid9Provider } from './Grid9Provider';
import { patchGrid9Session, resetGrid9Session } from './store';
import { Text, View } from './nw';

type Grid9ArenaParams = {
  matchId?: string;
  mode?: 'play' | 'spectate';
};

/**
 * Flag-gated mount. Spectate mode: set matchId, disable auto-queue, REQUEST_SNAPSHOT as audience.
 */
export function Grid9ArenaScreen() {
  const enabled = isGrid9Enabled();
  const route = useRoute<RouteProp<Record<string, Grid9ArenaParams>, string>>();
  const matchId = typeof route.params?.matchId === 'string' ? route.params.matchId.trim() : '';
  const spectate = route.params?.mode === 'spectate' && matchId.length > 0;
  const spectateArmed = useRef(false);

  useEffect(() => {
    if (!enabled || !spectate) return;
    spectateArmed.current = true;
    const connection = getGrid9Connection();
    connection.autoQueueOnWelcome = false;
    resetGrid9Session();
    patchGrid9Session({ matchId });
    void connection.connect().catch((error: unknown) => {
      if (__DEV__) {
        console.warn('[grid9] spectate connect failed', error);
      }
    });
    return () => {
      connection.autoQueueOnWelcome = false;
      connection.close();
      spectateArmed.current = false;
    };
  }, [enabled, spectate, matchId]);

  if (!enabled) {
    return (
      <View className="flex-1 items-center justify-center bg-blyp-ink px-8">
        <Text className="text-[11px] font-black uppercase tracking-[3px] text-blyp-faint">
          Grid 9
        </Text>
        <Text className="mt-3 text-center text-base font-extrabold text-blyp-primary">
          Arena locked
        </Text>
        <Text className="mt-2 text-center text-xs font-semibold text-blyp-muted">
          Enable EXPO_PUBLIC_LIVE_GRID9_ENABLED to mount the match.
        </Text>
      </View>
    );
  }

  return (
    <Grid9Provider autoConnect={!spectate} enabled>
      <Grid9ArenaView spectate={spectate} />
    </Grid9Provider>
  );
}
