import React, { useMemo, useRef, useState } from 'react';
import type { Grid9PublicPlayer } from './protocol';
import {
  formatGrid9Coins,
  formatGrid9Countdown,
  grid9HealthRatio,
  playerInitials,
} from './grid9Format';
import { GRID9_THEME } from './grid9Theme';
import type { Grid9VfxPoint } from './Grid9CombatVfxOverlay';
import { Grid9LiveKitSession } from './Grid9LiveKitSession';
import { SentinelStage } from './SentinelStage';
import { View as RnView } from 'react-native';
import { Image, Text, View } from './nw';

type FeedLike = {
  kind?: string;
  provider?: string;
  participantId?: string;
  streamId?: string;
  playbackUrl?: string | null;
  hlsUrl?: string | null;
  streamUrl?: string | null;
  url?: string | null;
  characterId?: string;
};

function HumanPendingCard({
  player,
  note,
}: {
  player: Grid9PublicPlayer;
  note: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!player.avatarUrl && !imageFailed;

  return (
    <View className="h-full w-full items-center justify-center overflow-hidden bg-blyp-card">
      <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-blyp-primary/60 bg-blyp-surface">
        {showImage ? (
          <Image
            className="h-16 w-16"
            source={{ uri: player.avatarUrl ?? undefined }}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Text className="text-lg font-black text-blyp-text">
            {playerInitials(player.displayName)}
          </Text>
        )}
      </View>
      <Text className="mt-2 text-sm font-extrabold text-blyp-text" numberOfLines={1}>
        {player.displayName}
      </Text>
      <View className="mt-1 rounded-full border border-blyp-primary/40 bg-blyp-primary/10 px-2 py-0.5">
        <Text className="text-[9px] font-black tracking-[2px] text-blyp-primary">{note}</Text>
      </View>
    </View>
  );
}

function StatBar({
  label,
  value,
  ratio,
  color,
}: {
  label: string;
  value: number;
  ratio: number;
  color: string;
}) {
  return (
    <View className="flex-1">
      <View className="mb-0.5 flex-row items-center justify-between">
        <Text className="text-[8px] font-black uppercase tracking-[1px]" style={{ color }}>
          {label} {Math.max(0, Math.floor(value))}
        </Text>
      </View>
      <View className="h-1 overflow-hidden rounded-full bg-black/50">
        <View
          className="h-1 rounded-full"
          style={{
            width: `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

/**
 * Mockup-aligned spotlight: ON AIR + timer + YOU on stage; GIFT/SP/HP bars;
 * Round / Next Spotlight / Audience Power chips on the right.
 */
export function Grid9SpotlightStage({
  player,
  matchId,
  publishLocalAv,
  isLocalSpotlight,
  jackpotCoins,
  turnNumber,
  countdownMs,
  nextSpotlightMs,
  onAir = true,
  onOriginMeasured,
}: {
  player: Grid9PublicPlayer | null;
  matchId?: string | null;
  publishLocalAv?: boolean;
  isLocalSpotlight?: boolean;
  jackpotCoins?: number;
  turnNumber?: number | null;
  countdownMs?: number | null;
  /** Separate chip for next-roulette / next spotlight. */
  nextSpotlightMs?: number | null;
  onAir?: boolean;
  /** Window-space origin near bottom-center of the stage for projectiles. */
  onOriginMeasured?: (point: Grid9VfxPoint | null) => void;
}) {
  const feed = (player as { feed?: FeedLike } | null)?.feed ?? null;
  const participantId = useMemo(() => {
    if (!player || player.kind !== 'human') return null;
    if (typeof feed?.participantId === 'string' && feed.participantId.trim()) {
      return feed.participantId.trim();
    }
    // Token mint uses userId when feed.participantId missing — never publicProfileId.
    const userId = (player as { userId?: string }).userId;
    if (typeof userId === 'string' && userId.trim()) return userId.trim();
    return null;
  }, [feed?.participantId, player]);

  const [avStatus, setAvStatus] = useState<string>('idle');
  // Connect whenever local combatant must publish OR spotlight is a human feed.
  // Previously LiveKit only mounted when spotlight was human — so cam/mic never
  // came up while a sentinel held the stage.
  const connectLiveKit =
    !!matchId &&
    (Boolean(publishLocalAv) ||
      (player?.kind === 'human' &&
        (avStatus === 'ready' || Boolean(feed?.provider === 'livekit'))));

  const hp = Math.max(0, Math.floor(player?.health ?? 0));
  const sp = Math.max(0, Math.floor(player?.shieldPoints ?? 0));
  const gift = Math.max(0, Math.floor(player?.mercenaryBankrollCoins ?? 0));
  const hpRatio = player ? grid9HealthRatio(player) : 0;
  const spRatio = Math.max(0, Math.min(1, sp / 100));
  const roundLabel =
    turnNumber != null && turnNumber > 0 ? `ROUND ${turnNumber} / ∞` : 'ROUND —';
  const stageRef = useRef<React.ElementRef<typeof RnView> | null>(null);

  const publishOrigin = () => {
    if (!onOriginMeasured) return;
    const anyNode = stageRef.current as unknown as {
      measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
    } | null;
    if (!anyNode?.measureInWindow) {
      onOriginMeasured(null);
      return;
    }
    try {
      anyNode.measureInWindow((x, y, w, h) => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) {
          onOriginMeasured(null);
          return;
        }
        onOriginMeasured({ x: x + w / 2, y: y + h - 18 });
      });
    } catch {
      onOriginMeasured(null);
    }
  };

  return (
    <View className="mb-1 px-3">
      {/* FOCAL jackpot — primary arena signal above the stage */}
      <View className="mb-1.5 items-center rounded-2xl border-2 border-amber-400/70 bg-amber-400/15 px-3 py-2">
        <Text className="text-[9px] font-black uppercase tracking-[3px] text-amber-200">
          Jackpot
        </Text>
        <Text className="mt-0.5 text-[28px] font-black leading-8 text-amber-300">
          {formatGrid9Coins(jackpotCoins ?? 0)}
        </Text>
      </View>

      <View className="flex-row">
      <RnView
        ref={stageRef}
        style={{
          marginRight: 8,
          height: 208,
          flex: 1,
          overflow: 'hidden',
          borderRadius: 16,
          borderWidth: 1,
          borderColor: `${GRID9_THEME.primary}66`,
          backgroundColor: GRID9_THEME.ink,
        }}
        onLayout={() => requestAnimationFrame(publishOrigin)}
      >
        {/* Top chips on stage */}
        <View className="absolute left-2 top-2 z-10 flex-row items-center gap-1.5">
          {onAir ? (
            <View className="rounded-full border border-blyp-primary/50 bg-blyp-ink/90 px-2 py-0.5">
              <Text className="text-[8px] font-black uppercase tracking-[1px] text-blyp-primary">
                ● On air
              </Text>
            </View>
          ) : null}
          <View className="rounded-full border border-white/20 bg-blyp-ink/90 px-2 py-0.5">
            <Text className="text-[8px] font-black uppercase tracking-[1px] text-blyp-text">
              {countdownMs != null && countdownMs >= 0
                ? formatGrid9Countdown(countdownMs)
                : '—:—'}
            </Text>
          </View>
          {isLocalSpotlight ? (
            <View className="rounded-full bg-blyp-primary px-2 py-0.5">
              <Text className="text-[8px] font-black uppercase text-blyp-ink">You</Text>
            </View>
          ) : null}
        </View>

        {!player ? (
          <View className="h-full items-center justify-center">
            <Text className="text-[10px] font-black uppercase tracking-[2px] text-blyp-faint">
              Spotlight
            </Text>
            <Text className="mt-1 text-sm font-semibold text-blyp-muted">Waiting for seat</Text>
          </View>
        ) : player.kind === 'sentinel' ? (
          <View className="h-full">
            {connectLiveKit ? (
              <Grid9LiveKitSession
                matchId={matchId ?? null}
                enabled
                publish={Boolean(publishLocalAv)}
                spotlightParticipantId={null}
                onStatus={setAvStatus}
              />
            ) : null}
            <SentinelStage
              displayName={player.displayName}
              characterId={typeof feed?.characterId === 'string' ? feed.characterId : null}
            />
          </View>
        ) : (
          <View className="h-full">
            {connectLiveKit ? (
              <Grid9LiveKitSession
                matchId={matchId ?? null}
                enabled
                publish={Boolean(publishLocalAv)}
                spotlightParticipantId={participantId}
                onStatus={setAvStatus}
              />
            ) : null}
            {avStatus === 'ready' || avStatus === 'idle' ? null : (
              <View className="absolute inset-0">
                <HumanPendingCard
                  player={player}
                  note={
                    avStatus === 'permission-denied'
                      ? 'CAM/MIC DENIED'
                      : avStatus === 'unavailable' || avStatus === 'module-missing'
                        ? 'A/V UNAVAILABLE'
                        : 'LIVE FEED PENDING'
                  }
                />
              </View>
            )}
            {avStatus === 'ready' ? null : avStatus === 'idle' && !connectLiveKit ? (
              <HumanPendingCard player={player} note="LIVE FEED PENDING" />
            ) : null}
          </View>
        )}

        {/* Bottom identity + GIFT / SP / HP on stage */}
        {player ? (
          <View className="absolute bottom-0 left-0 right-0 bg-blyp-ink/80 px-2.5 pb-2 pt-1.5">
            <View className="mb-1 flex-row items-end justify-between">
              <View className="flex-1 pr-2">
                <Text className="text-[12px] font-extrabold text-blyp-text" numberOfLines={1}>
                  {player.displayName}
                </Text>
                {player.kind === 'human' && player.publicProfileId ? (
                  <Text className="text-[9px] font-semibold text-blyp-primary" numberOfLines={1}>
                    @{player.publicProfileId}
                  </Text>
                ) : null}
              </View>
              <Text className="text-[8px] font-black uppercase tracking-[1px] text-blyp-primary">
                Spotlight
              </Text>
            </View>
            <Text className="mb-1 text-[12px] font-black text-amber-300">
              GIFT {formatGrid9Coins(gift)}
            </Text>
            <View className="flex-row gap-2">
              <StatBar label="SP" value={sp} ratio={spRatio} color={GRID9_THEME.sp} />
              <StatBar label="HP" value={hp} ratio={hpRatio} color={GRID9_THEME.hp} />
            </View>
          </View>
        ) : null}
      </RnView>

      {/* Side chips — Round / Next Spotlight / Audience Power */}
      <View className="w-[88px] justify-between py-0.5">
        <View className="rounded-xl border border-white/15 bg-blyp-card px-2 py-2">
          <Text className="text-[7px] font-bold uppercase tracking-[1px] text-blyp-faint">
            Round
          </Text>
          <Text className="mt-0.5 text-[10px] font-black text-blyp-text">{roundLabel}</Text>
        </View>
        <View className="rounded-xl border border-blyp-primary/35 bg-blyp-card px-2 py-2">
          <Text className="text-[7px] font-bold uppercase tracking-[1px] text-blyp-faint">
            Next spotlight
          </Text>
          <Text className="mt-0.5 text-[12px] font-black text-blyp-primary">
            {nextSpotlightMs != null && nextSpotlightMs >= 0
              ? formatGrid9Countdown(nextSpotlightMs)
              : '—:—'}
          </Text>
        </View>
        <View className="rounded-xl border border-amber-400/40 bg-blyp-card px-2 py-2">
          <Text className="text-[7px] font-bold uppercase tracking-[1px] text-blyp-faint">
            Pot chip
          </Text>
          <Text className="mt-0.5 text-[12px] font-black text-amber-300">
            ⚡ {formatGrid9Coins(jackpotCoins ?? 0)}
          </Text>
        </View>
      </View>
      </View>
    </View>
  );
}
