import React, { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import type { Grid9PublicPlayer } from './protocol';
import { GRID9_ARSENAL_CATALOG } from './catalog';
import {
  formatGrid9Coins,
  grid9HealthRatio,
  isGrid9SlotEliminated,
  playerInitials,
} from './grid9Format';
import { GRID9_THEME } from './grid9Theme';
import { Image, Text, TouchableOpacity, View } from './nw';

function inventoryGlyphs(player: Grid9PublicPlayer | null): string[] {
  const ids = player?.inventory ?? [];
  return ids.slice(0, 4).map((id) => GRID9_ARSENAL_CATALOG[id]?.glyph ?? '•');
}

export function Grid9Slot({
  player,
  slotIndex,
  spotlighted,
  isLocal,
  targetable = false,
  spotlightChancePct = null,
  onPress,
}: {
  player: Grid9PublicPlayer | null;
  slotIndex: number;
  spotlighted: boolean;
  isLocal: boolean;
  targetable?: boolean;
  /** Equal-weight roulette chance among alive seats when known. */
  spotlightChancePct?: number | null;
  onPress?: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    if (!targetable) {
      pulse.setValue(0.35);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: 550, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0.35);
    };
  }, [pulse, targetable]);

  const eliminated = isGrid9SlotEliminated(player);
  const sentinel = player?.kind === 'sentinel';
  const ratio = player ? grid9HealthRatio(player) : 0;
  const healthLow = ratio <= 0.3;
  const showImage = !!player?.avatarUrl && !imageFailed;
  const sp = Math.max(0, Math.floor(player?.shieldPoints ?? 0));
  const hp = Math.max(0, Math.floor(player?.health ?? 0));
  const spRatio = Math.max(0, Math.min(1, sp / 100));
  const glyphs = inventoryGlyphs(player);
  const giftCoins = Math.max(0, Math.floor(player?.mercenaryBankrollCoins ?? 0));
  const badge =
    sentinel && player?.displayName
      ? player.displayName
          .split(/\s+/)
          .map((part) => part[0] || '')
          .join('')
          .slice(0, 2)
          .toUpperCase()
      : isLocal
        ? 'YOU'
        : player?.kind === 'human'
          ? 'HV'
          : null;

  const frameClass = targetable
    ? 'border-2 border-red-500 bg-blyp-card'
    : spotlighted
      ? 'border-2 border-blyp-primary bg-blyp-card'
      : sentinel
        ? 'border border-dashed border-blyp-primary/45 bg-blyp-card'
        : player
          ? 'border border-white/15 bg-blyp-card'
          : 'border border-white/10 bg-blyp-ink';

  const body = (
    <View className={`relative h-full w-full overflow-hidden rounded-xl ${frameClass}`}>
      {targetable ? (
        <Animated.View
          pointerEvents="none"
          style={{
            opacity: pulse,
            position: 'absolute',
            top: 2,
            right: 2,
            bottom: 2,
            left: 2,
            borderWidth: 2,
            borderColor: '#f87171',
            borderRadius: 10,
          }}
        />
      ) : null}

      <Text className="absolute left-1 top-1 z-10 text-[9px] font-black text-blyp-faint">
        {slotIndex + 1}
      </Text>
      {badge ? (
        <View className="absolute right-1 top-1 z-10 h-5 w-5 items-center justify-center rounded-full border border-blyp-primary/50 bg-blyp-ink/90">
          <Text className="text-[7px] font-black text-blyp-primary">{badge}</Text>
        </View>
      ) : null}

      <View className="flex-1 justify-between px-1 pb-1 pt-5">
        <View className="items-center">
          <View
            className={`h-9 w-9 items-center justify-center overflow-hidden rounded-lg border ${
              sentinel ? 'border-blyp-primary bg-blyp-primary/15' : 'border-white/20 bg-blyp-surface'
            }`}
          >
            {showImage ? (
              <Image
                className="h-9 w-9"
                source={{ uri: player?.avatarUrl ?? undefined }}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <Text
                className={`text-[10px] font-black ${
                  sentinel ? 'text-blyp-primary' : 'text-blyp-text'
                }`}
              >
                {player ? playerInitials(player.displayName) : String(slotIndex + 1)}
              </Text>
            )}
          </View>
          <Text
            className="mt-0.5 text-center text-[9px] font-bold text-blyp-text"
            numberOfLines={1}
          >
            {player?.displayName ?? `Seat ${slotIndex + 1}`}
          </Text>
        </View>

        {player ? (
          <View>
            <View className="mb-0.5 items-center rounded-md border border-amber-400/50 bg-amber-400/15 px-1 py-0.5">
              <Text className="text-[10px] font-black text-amber-300" numberOfLines={1}>
                ⚡ {formatGrid9Coins(giftCoins)}
              </Text>
            </View>
            <View className="mb-0.5 flex-row items-center justify-between">
              <Text className="text-[7px] font-black text-red-400">HP {hp}</Text>
              <Text className="text-[7px] font-black text-blyp-primary">SP {sp}</Text>
            </View>
            <View className="mb-0.5 h-1 overflow-hidden rounded-full bg-blyp-alt">
              <View
                className="h-1 rounded-full"
                style={{
                  width: `${Math.round(ratio * 100)}%`,
                  backgroundColor: healthLow ? GRID9_THEME.hp : GRID9_THEME.spAlt,
                }}
              />
            </View>
            <View className="mb-0.5 h-1 overflow-hidden rounded-full bg-blyp-alt">
              <View
                className="h-1 rounded-full"
                style={{
                  width: `${Math.round(spRatio * 100)}%`,
                  backgroundColor: GRID9_THEME.sp,
                }}
              />
            </View>
            {glyphs.length > 0 ? (
              <Text className="text-center text-[9px]" numberOfLines={1}>
                {glyphs.join(' ')}
              </Text>
            ) : (
              <Text className="text-center text-[7px] font-semibold text-blyp-faint">—</Text>
            )}
            {spotlighted && spotlightChancePct != null ? (
              <View className="mt-0.5">
                <Text className="text-center text-[6px] font-black uppercase tracking-[0.5px] text-blyp-primary">
                  Spotlight chance {Math.round(spotlightChancePct)}%
                </Text>
                <View className="mt-0.5 h-1 overflow-hidden rounded-full bg-blyp-alt">
                  <View
                    className="h-1 rounded-full bg-blyp-primary"
                    style={{ width: `${Math.round(spotlightChancePct)}%` }}
                  />
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {eliminated ? (
        <View className="absolute inset-0 items-center justify-center bg-black/80">
          <Text className="text-[9px] font-black tracking-[1px] text-red-500">OUT</Text>
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <TouchableOpacity className="h-full w-full" activeOpacity={0.88} onPress={onPress}>
      {body}
    </TouchableOpacity>
  );
}
