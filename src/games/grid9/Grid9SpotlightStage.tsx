import React, { useMemo, useState } from 'react';
import type { Grid9PublicPlayer } from './protocol';
import { formatGrid9Coins, formatGrid9Countdown, playerInitials } from './grid9Format';
import { Grid9LiveKitSession } from './Grid9LiveKitSession';
import { SentinelStage } from './SentinelStage';
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
    <View className="h-full w-full items-center justify-center overflow-hidden rounded-2xl border border-blyp-primary/30 bg-blyp-card">
      <View className="h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-blyp-primary/60 bg-blyp-surface">
        {showImage ? (
          <Image
            className="h-20 w-20"
            source={{ uri: player.avatarUrl ?? undefined }}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Text className="text-xl font-black text-blyp-text">
            {playerInitials(player.displayName)}
          </Text>
        )}
      </View>
      <Text className="mt-3 text-base font-extrabold text-blyp-text" numberOfLines={1}>
        {player.displayName}
      </Text>
      <View className="mt-2 rounded-full border border-blyp-primary/40 bg-blyp-primary/10 px-3 py-1">
        <Text className="text-[10px] font-black tracking-[2px] text-blyp-primary">
          {note}
        </Text>
      </View>
    </View>
  );
}

export function Grid9SpotlightStage({
  player,
  matchId,
  publishLocalAv,
  jackpotCoins,
  accountCoins,
  countdownMs,
  countdownLabel,
}: {
  player: Grid9PublicPlayer | null;
  matchId?: string | null;
  /** Local combatant should publish camera+mic into the Grid9 LiveKit room. */
  publishLocalAv?: boolean;
  jackpotCoins?: number;
  accountCoins?: number;
  countdownMs?: number | null;
  countdownLabel?: string;
}) {
  const feed = (player as { feed?: FeedLike } | null)?.feed ?? null;
  const participantId = useMemo(() => {
    if (!player || player.kind !== 'human') return null;
    if (typeof feed?.participantId === 'string' && feed.participantId.trim()) {
      return feed.participantId.trim();
    }
    return player.publicProfileId || null;
  }, [feed?.participantId, player]);

  const [avStatus, setAvStatus] = useState<string>('idle');
  const showLiveKit =
    !!matchId &&
    !!player &&
    player.kind === 'human' &&
    (publishLocalAv || avStatus === 'ready' || Boolean(feed?.provider === 'livekit'));

  return (
    <View className="mx-3 mb-2 h-48 overflow-hidden rounded-2xl border border-blyp-primary/35 bg-blyp-ink">
      {/* Corner chips: coins + timer inside spotlight */}
      <View className="absolute left-2 top-2 z-10 rounded-full border border-blyp-primary/40 bg-blyp-ink/85 px-2.5 py-1">
        <Text className="text-[9px] font-black uppercase tracking-[1px] text-blyp-primary">
          JP {formatGrid9Coins(jackpotCoins ?? 0)}
          {typeof accountCoins === 'number' ? ` · You ${formatGrid9Coins(accountCoins)}` : ''}
        </Text>
      </View>
      <View className="absolute right-2 top-2 z-10 rounded-full border border-white/20 bg-blyp-ink/85 px-2.5 py-1">
        <Text className="text-[9px] font-black uppercase tracking-[1px] text-blyp-text">
          {countdownLabel || 'Clock'}{' '}
          {countdownMs != null && countdownMs >= 0
            ? formatGrid9Countdown(countdownMs)
            : '—'}
        </Text>
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
          <SentinelStage
            displayName={player.displayName}
            characterId={typeof feed?.characterId === 'string' ? feed.characterId : null}
          />
        </View>
      ) : (
        <View className="h-full">
          {showLiveKit ? (
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
          {avStatus === 'ready' ? null : avStatus === 'idle' && !showLiveKit ? (
            <HumanPendingCard player={player} note="LIVE FEED PENDING" />
          ) : null}
          {avStatus === 'ready' ? (
            <View className="absolute bottom-2 left-0 right-0 items-center">
              <Text className="rounded-full bg-blyp-ink/70 px-2 py-0.5 text-[10px] font-extrabold text-blyp-primary">
                {player.displayName}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}
