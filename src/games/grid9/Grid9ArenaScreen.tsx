import React from 'react';
import { isGrid9Enabled } from '../../config/Grid9Flags';
import { Grid9ArenaView } from './Grid9ArenaView';
import { Grid9Provider } from './Grid9Provider';
import { Text, View } from './nw';

/** Flag-gated mount. Provider connect/close is the socket lifecycle. */
export function Grid9ArenaScreen() {
  const enabled = isGrid9Enabled();
  if (!enabled) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950 px-8">
        <Text className="text-[11px] font-black uppercase tracking-[3px] text-slate-500">
          Grid 9
        </Text>
        <Text className="mt-3 text-center text-base font-extrabold text-amber-400">
          Arena locked
        </Text>
        <Text className="mt-2 text-center text-xs font-semibold text-slate-400">
          Enable EXPO_PUBLIC_LIVE_GRID9_ENABLED to mount the match.
        </Text>
      </View>
    );
  }

  return (
    <Grid9Provider autoConnect enabled>
      <Grid9ArenaView />
    </Grid9Provider>
  );
}
