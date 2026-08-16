import React from 'react';
import type { Grid9AuthoritativeGameState } from './protocol';
import type { Grid9ConnectionStatus } from './reconcile';
import {
  formatGrid9Coins,
  formatGrid9Countdown,
  formatGrid9Phase,
  getGrid9JackpotPool,
  remainingMs,
} from './grid9Format';
import { Text, TouchableOpacity, View } from './nw';

export function Grid9Header({
  match,
  connectionStatus,
  nowMs,
  onLeave,
  leaving = false,
}: {
  match: Grid9AuthoritativeGameState | null;
  connectionStatus: Grid9ConnectionStatus;
  nowMs: number;
  onLeave?: () => void;
  leaving?: boolean;
}) {
  const jackpotPool = getGrid9JackpotPool(match);
  const phaseLabel = formatGrid9Phase(match?.phase);
  const spotlightMs = remainingMs(match?.turn?.spotlightEndsAt, nowMs);
  const turnMs = remainingMs(match?.turn?.endsAt, nowMs);
  const phaseMs = remainingMs(match?.phaseEndsAt, nowMs);
  const turnNumber = match?.turn?.turnNumber;
  const live = connectionStatus === 'connected';

  return (
    <View className="z-10 w-full bg-blyp-ink px-4 pb-3 pt-2">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-[11px] font-extrabold tracking-[3px] text-blyp-faint">GRID 9</Text>
          <Text className="text-xs font-semibold uppercase tracking-[1px] text-blyp-primary">
            {phaseLabel}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <View
            className={`rounded-full border px-2.5 py-1 ${
              live
                ? 'border-blyp-primary/40 bg-blyp-primary/10'
                : 'border-red-500/40 bg-red-500/10'
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
              className="rounded-full border border-white/20 bg-blyp-surface px-3 py-1.5"
              activeOpacity={0.85}
              disabled={leaving}
              onPress={onLeave}
            >
              <Text className="text-[10px] font-black uppercase tracking-[1px] text-blyp-text">
                {leaving ? 'Leaving…' : 'Leave'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View className="mt-3 items-center rounded-2xl border border-blyp-primary/30 bg-blyp-card px-4 py-3">
        <Text className="text-[10px] font-bold uppercase tracking-[2px] text-blyp-muted">
          Jackpot pool
        </Text>
        <View className="mt-1 flex-row items-end">
          <Text className="text-4xl font-black tracking-tight text-blyp-primary">
            {formatGrid9Coins(jackpotPool)}
          </Text>
          <Text className="mb-1 ml-2 text-sm font-bold uppercase text-blyp-primaryLight">
            coins
          </Text>
        </View>
      </View>

      <View className="mt-3 flex-row">
        <View className="mr-2 flex-1 rounded-xl border border-white/10 bg-blyp-card px-3 py-2">
          <Text className="text-[10px] font-bold uppercase tracking-[1px] text-blyp-faint">
            Spotlight
          </Text>
          <Text className="mt-0.5 text-lg font-black text-blyp-primary">
            {match?.turn ? formatGrid9Countdown(spotlightMs) : '—'}
          </Text>
        </View>
        <View className="ml-2 flex-1 rounded-xl border border-white/10 bg-blyp-card px-3 py-2">
          <Text className="text-[10px] font-bold uppercase tracking-[1px] text-blyp-faint">
            {turnNumber != null ? `Turn ${turnNumber}` : match?.phase === 'countdown' ? 'Starts' : 'Turn'}
          </Text>
          <Text className="mt-0.5 text-lg font-black text-blyp-text">
            {match?.turn
              ? formatGrid9Countdown(turnMs)
              : match?.phaseEndsAt
                ? formatGrid9Countdown(phaseMs)
                : '—'}
          </Text>
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
