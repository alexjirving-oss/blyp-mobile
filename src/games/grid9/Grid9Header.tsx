import React from 'react';
import type { Grid9AuthoritativeGameState } from './protocol';
import type { Grid9ConnectionStatus } from './reconcile';
import { Text, TouchableOpacity, View } from './nw';

/**
 * Compact top chrome only — leave + live chip. Coins/timer live inside spotlight.
 */
export function Grid9Header({
  connectionStatus,
  onLeave,
  leaving = false,
}: {
  match?: Grid9AuthoritativeGameState | null;
  connectionStatus: Grid9ConnectionStatus;
  nowMs?: number;
  onLeave?: () => void;
  leaving?: boolean;
}) {
  const live = connectionStatus === 'connected';

  return (
    <View className="absolute left-0 right-0 top-0 z-20 flex-row items-center justify-between px-3 pt-1">
      <View
        className={`rounded-full border px-2.5 py-1 ${
          live
            ? 'border-blyp-primary/40 bg-blyp-ink/80'
            : 'border-red-500/40 bg-blyp-ink/80'
        }`}
      >
        <Text
          className={`text-[10px] font-bold uppercase tracking-[1px] ${
            live ? 'text-blyp-primary' : 'text-red-400'
          }`}
        >
          {connectionLabel(connectionStatus)}
        </Text>
      </View>
      {onLeave ? (
        <TouchableOpacity
          className="rounded-full border border-white/25 bg-blyp-ink/85 px-3 py-1.5"
          activeOpacity={0.85}
          disabled={leaving}
          onPress={onLeave}
        >
          <Text className="text-[10px] font-black uppercase tracking-[1px] text-blyp-text">
            {leaving ? '…' : 'Leave'}
          </Text>
        </TouchableOpacity>
      ) : (
        <View />
      )}
    </View>
  );
}

function connectionLabel(status: Grid9ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Live';
    case 'connecting':
      return 'Connecting';
    case 'reconnecting':
      return 'Reconnecting';
    case 'disconnected':
      return 'Offline';
    default:
      return 'Idle';
  }
}
