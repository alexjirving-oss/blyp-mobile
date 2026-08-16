import React from 'react';
import type { Grid9DrawerMode } from './grid9Actions';
import { formatGrid9Coins } from './grid9Format';
import { Text, TouchableOpacity, View } from './nw';

export function Grid9ActionDrawer({
  mode,
  availableCoins,
  mercenaryFundCoins,
  lastError,
  countdownMs = null,
  onOpenGallery,
  onCancelTargeting,
}: {
  mode: Grid9DrawerMode;
  availableCoins: number;
  mercenaryFundCoins: number;
  lastError: string | null;
  countdownMs?: number | null;
  onOpenGallery: () => void;
  onCancelTargeting: () => void;
}) {
  return (
    <View className="border-t border-blyp-primary/25 bg-blyp-card px-3 pt-2">
      {mode === 'my_turn' ? (
        <TouchableOpacity
          className="items-center rounded-xl border-2 border-blyp-primary bg-blyp-primary px-4 py-3"
          activeOpacity={0.85}
          onPress={onOpenGallery}
        >
          <Text className="text-center text-sm font-black tracking-[1px] text-blyp-ink">
            Open weapons gallery
          </Text>
          <Text className="mt-0.5 text-center text-[10px] font-bold uppercase tracking-[1px] text-blyp-ink/80">
            Your coins {formatGrid9Coins(availableCoins)}
          </Text>
        </TouchableOpacity>
      ) : null}

      {mode === 'targeting' ? (
        <View className="rounded-xl border border-blyp-primary/50 bg-blyp-ink px-4 py-2.5">
          <Text className="text-center text-sm font-extrabold text-blyp-primary">
            Tap target box on grid
          </Text>
          <TouchableOpacity
            className="mt-2 items-center rounded-xl border border-white/15 bg-blyp-surface py-2"
            activeOpacity={0.85}
            onPress={onCancelTargeting}
          >
            <Text className="text-xs font-black uppercase tracking-[1px] text-blyp-text">
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {mode === 'proxy_war' ? (
        <View className="rounded-xl border border-red-500 bg-red-500/15 px-4 py-2.5">
          <Text className="text-center text-sm font-black text-red-400">
            Proxy war: tap a surviving box to fund as mercenary
          </Text>
          <Text className="mt-1 text-center text-[11px] font-bold uppercase tracking-[1px] text-red-200/80">
            {formatGrid9Coins(mercenaryFundCoins)} coins · your balance{' '}
            {formatGrid9Coins(availableCoins)}
          </Text>
        </View>
      ) : null}

      {lastError ? (
        <Text className="mt-2 text-center text-[11px] font-semibold text-red-400">{lastError}</Text>
      ) : null}
    </View>
  );
}
