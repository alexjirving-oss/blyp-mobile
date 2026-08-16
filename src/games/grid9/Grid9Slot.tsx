import React, { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import type { Grid9PublicPlayer } from './protocol';
import {
  formatGrid9Coins,
  grid9HealthRatio,
  isGrid9SlotEliminated,
  playerInitials,
} from './grid9Format';
import { GRID9_THEME } from './grid9Theme';
import { grid9SentinelPortrait } from './grid9SentinelPortraits';
import { Grid9SeatCamera } from './Grid9LiveKitRoom';
import { Image, Text, TouchableOpacity, View } from './nw';

function humanParticipantId(player: Grid9PublicPlayer | null): string | null {
  if (!player || player.kind !== 'human') return null;
  const feed = player.feed as { participantId?: string } | undefined;
  if (typeof feed?.participantId === 'string' && feed.participantId.trim()) {
    return feed.participantId.trim();
  }
  const userId = (player as { userId?: string }).userId;
  if (typeof userId === 'string' && userId.trim()) return userId.trim();
  return null;
}

function sentinelCharacterId(player: Grid9PublicPlayer | null): string | null {
  if (!player || player.kind !== 'sentinel') return null;
  const feed = player.feed as { characterId?: string } | undefined;
  if (typeof feed?.characterId === 'string' && feed.characterId.trim()) {
    return feed.characterId.trim();
  }
  return null;
}

/**
 * TikTok-style seat tile: full-bleed cam (human) or gruesome still (sentinel),
 * coin counter top-right, health bar bottom.
 */
export function Grid9Slot({
  player,
  slotIndex,
  spotlighted,
  isLocal,
  targetable = false,
  rouletteHighlight = false,
  onPress,
}: {
  player: Grid9PublicPlayer | null;
  slotIndex: number;
  spotlighted: boolean;
  isLocal: boolean;
  targetable?: boolean;
  /** Dramatic roulette highlight (slowing spin). */
  rouletteHighlight?: boolean;
  onPress?: () => void;
}) {
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    if (!targetable && !rouletteHighlight) {
      pulse.setValue(0.35);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 420, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0.35);
    };
  }, [pulse, targetable, rouletteHighlight]);

  const eliminated = isGrid9SlotEliminated(player);
  const sentinel = player?.kind === 'sentinel';
  const ratio = player ? grid9HealthRatio(player) : 0;
  const healthLow = ratio <= 0.3;
  const hp = Math.max(0, Math.floor(player?.health ?? 0));
  const giftCoins = Math.max(0, Math.floor(player?.mercenaryBankrollCoins ?? 0));
  const participantId = humanParticipantId(player);
  const characterId = sentinelCharacterId(player);
  const portrait = grid9SentinelPortrait(characterId);
  const [portraitFailed, setPortraitFailed] = useState(false);

  const frameClass = targetable
    ? 'border-2 border-red-500'
    : spotlighted || rouletteHighlight
      ? 'border-2 border-blyp-primary'
      : 'border border-white/20';

  const body = (
    <View className={`relative h-full w-full overflow-hidden rounded-xl bg-blyp-ink ${frameClass}`}>
      {/* Full-bleed media plane */}
      {player?.kind === 'human' ? (
        <View className="absolute inset-0 bg-blyp-surface">
          <Grid9SeatCamera participantId={participantId} />
          {!participantId ? (
            <View className="absolute inset-0 items-center justify-center bg-blyp-ink/70">
              <Text className="text-[10px] font-black text-blyp-muted">CAM</Text>
            </View>
          ) : null}
        </View>
      ) : sentinel ? (
        <View className="absolute inset-0 bg-[#1a0a0c]">
          {portrait && !portraitFailed ? (
            <Image
              className="h-full w-full"
              source={portrait}
              resizeMode="cover"
              onError={() => setPortraitFailed(true)}
            />
          ) : (
            <View className="h-full w-full items-center justify-center bg-[#2a1014]">
              <Text className="text-2xl font-black text-red-400">
                {playerInitials(player?.displayName || 'S')}
              </Text>
            </View>
          )}
          <View className="absolute inset-0 bg-red-950/25" />
        </View>
      ) : (
        <View className="absolute inset-0 items-center justify-center bg-blyp-ink">
          <Text className="text-[10px] font-black text-blyp-faint">{slotIndex + 1}</Text>
        </View>
      )}

      {(targetable || rouletteHighlight) && (
        <Animated.View
          pointerEvents="none"
          style={{
            opacity: pulse,
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            borderWidth: 3,
            borderColor: targetable ? '#f87171' : GRID9_THEME.primary,
            borderRadius: 12,
            zIndex: 4,
          }}
        />
      )}

      {/* Seat index */}
      <Text className="absolute left-1 top-1 z-10 text-[9px] font-black text-white/80">
        {slotIndex + 1}
      </Text>

      {/* Coin counter — PROMINENT top-right */}
      {player ? (
        <View className="absolute right-1 top-1 z-10 min-w-[42px] items-center rounded-md border border-amber-400/70 bg-black/75 px-1.5 py-0.5">
          <Text className="text-[11px] font-black text-amber-300" numberOfLines={1}>
            ⚡{formatGrid9Coins(giftCoins)}
          </Text>
        </View>
      ) : null}

      {/* Name + YOU / SENTINEL tag */}
      {player ? (
        <View className="absolute left-1 right-1 top-7 z-10">
          <Text className="text-[10px] font-extrabold text-white" numberOfLines={1}>
            {isLocal ? 'YOU · ' : ''}
            {player.displayName}
          </Text>
          {sentinel ? (
            <Text className="text-[8px] font-black uppercase tracking-[1px] text-red-300">
              Sentinel
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Health bar — bottom */}
      {player ? (
        <View className="absolute bottom-0 left-0 right-0 z-10 bg-black/70 px-1 pb-1 pt-0.5">
          <View className="mb-0.5 flex-row items-center justify-between">
            <Text className="text-[8px] font-black text-red-400">HP {hp}</Text>
            <Text className="text-[8px] font-black text-white/70">
              {Math.round(ratio * 100)}%
            </Text>
          </View>
          <View className="h-1.5 overflow-hidden rounded-full bg-white/20">
            <View
              className="h-1.5 rounded-full"
              style={{
                width: `${Math.round(ratio * 100)}%`,
                backgroundColor: healthLow ? GRID9_THEME.hp : GRID9_THEME.spAlt,
              }}
            />
          </View>
        </View>
      ) : null}

      {eliminated ? (
        <View className="absolute inset-0 z-20 items-center justify-center bg-black/85">
          <Text className="text-[11px] font-black tracking-[2px] text-red-500">OUT</Text>
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
