import React from 'react';
import type { Grid9AuthoritativeGameState } from './protocol';
import type { Grid9ConnectionStatus } from './reconcile';
import { Text, TouchableOpacity, View } from './nw';

/**
 * Mockup header: LIVE SHOWDOWN + GRID 9 ARENA + audience + leave.
 */
export function Grid9Header({
  connectionStatus,
  audienceCount = 0,
  onLeave,
  leaving = false,
}: {
  match?: Grid9AuthoritativeGameState | null;
  connectionStatus: Grid9ConnectionStatus;
  audienceCount?: number;
  nowMs?: number;
  onLeave?: () => void;
  leaving?: boolean;
}) {
  const live = connectionStatus === 'connected';
  const audienceLabel =
    audienceCount >= 1000
      ? `${(audienceCount / 1000).toFixed(audienceCount >= 10_000 ? 0 : 1)}K`
      : String(Math.max(0, audienceCount));

  return (
    <View className="mb-1 px-3 pt-1">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-2">
          <View
            className={`mb-1 self-start rounded-md px-2 py-0.5 ${
              live ? 'bg-violet-600/90' : 'bg-red-600/80'
            }`}
          >
            <Text className="text-[8px] font-black uppercase tracking-[1px] text-white">
              {live ? 'Live showdown' : connectionLabel(connectionStatus)}
            </Text>
          </View>
          <Text className="text-[18px] font-black tracking-[0.5px] text-blyp-text">
            GRID 9 ARENA
          </Text>
          <Text className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.5px] text-blyp-muted">
            9 streams · 1 spotlight · last creator standing
          </Text>
        </View>
        <View className="items-end gap-1.5">
          <View className="flex-row items-center rounded-full border border-blyp-primary/40 bg-blyp-ink/80 px-2.5 py-1">
            <Text className="text-[10px] font-black text-blyp-primary">👤 {audienceLabel}</Text>
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
          ) : null}
        </View>
      </View>
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
