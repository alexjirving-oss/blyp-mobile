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
import { Text, View } from './nw';

export function Grid9Header({
  match,
  connectionStatus,
  nowMs,
}: {
  match: Grid9AuthoritativeGameState | null;
  connectionStatus: Grid9ConnectionStatus;
  nowMs: number;
}) {
  const jackpotPool = getGrid9JackpotPool(match);
  const phaseLabel = formatGrid9Phase(match?.phase);
  const spotlightMs = remainingMs(match?.turn?.spotlightEndsAt, nowMs);
  const turnMs = remainingMs(match?.turn?.endsAt, nowMs);
  const phaseMs = remainingMs(match?.phaseEndsAt, nowMs);
  const turnNumber = match?.turn?.turnNumber;
  const live = connectionStatus === 'connected';

  return (
    <View className="z-10 w-full bg-slate-950 px-4 pb-3 pt-2">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-[11px] font-extrabold tracking-[3px] text-slate-500">GRID 9</Text>
          <Text className="text-xs font-semibold uppercase tracking-[1px] text-amber-400">
            {phaseLabel}
          </Text>
        </View>
        <View
          className={`rounded-full border px-2.5 py-1 ${
            live ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'
          }`}
        >
          <Text
            className={`text-[10px] font-bold uppercase tracking-[1px] ${
              live ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {connectionLabel(connectionStatus)}
          </Text>
        </View>
      </View>

      <View className="mt-3 items-center rounded-2xl border border-amber-400/30 bg-slate-900 px-4 py-3">
        <Text className="text-[10px] font-bold uppercase tracking-[2px] text-slate-400">
          Jackpot pool
        </Text>
        <View className="mt-1 flex-row items-end">
          <Text className="text-4xl font-black tracking-tight text-amber-400">
            {formatGrid9Coins(jackpotPool)}
          </Text>
          <Text className="mb-1 ml-2 text-sm font-bold uppercase text-amber-200/80">coins</Text>
        </View>
      </View>

      <View className="mt-3 flex-row">
        <View className="mr-2 flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
          <Text className="text-[10px] font-bold uppercase tracking-[1px] text-slate-500">
            Spotlight
          </Text>
          <Text className="mt-0.5 text-lg font-black text-amber-400">
            {match?.turn ? formatGrid9Countdown(spotlightMs) : '—'}
          </Text>
        </View>
        <View className="ml-2 flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
          <Text className="text-[10px] font-bold uppercase tracking-[1px] text-slate-500">
            {turnNumber != null ? `Turn ${turnNumber}` : match?.phase === 'countdown' ? 'Starts' : 'Turn'}
          </Text>
          <Text className="mt-0.5 text-lg font-black text-slate-100">
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
