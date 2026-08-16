import React, { useMemo, useState } from 'react';
import type { Grid9PublicPlayer } from './protocol';
import { playerInitials } from './grid9Format';
import { SentinelStage } from './SentinelStage';
import { Image, Text, View } from './nw';

type FeedLike = {
  kind?: string;
  playbackUrl?: string | null;
  hlsUrl?: string | null;
  streamUrl?: string | null;
  url?: string | null;
  characterId?: string;
};

function readUsableFeedUrl(feed: FeedLike | null | undefined): string | null {
  if (!feed || typeof feed !== 'object') return null;
  const candidates = [feed.playbackUrl, feed.hlsUrl, feed.streamUrl, feed.url];
  for (const value of candidates) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) {
      return value.trim();
    }
  }
  return null;
}

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
}: {
  player: Grid9PublicPlayer | null;
}) {
  const feed = (player as { feed?: FeedLike } | null)?.feed ?? null;
  const feedUrl = useMemo(() => readUsableFeedUrl(feed), [feed]);

  if (!player) {
    return (
      <View className="mx-4 mb-3 h-44 items-center justify-center rounded-2xl border border-white/10 bg-blyp-ink">
        <Text className="text-[10px] font-black uppercase tracking-[2px] text-blyp-faint">
          Spotlight
        </Text>
        <Text className="mt-1 text-sm font-semibold text-blyp-muted">Waiting for seat</Text>
      </View>
    );
  }

  if (player.kind === 'sentinel') {
    const characterId =
      typeof feed?.characterId === 'string' ? feed.characterId : null;
    return (
      <View className="mx-4 mb-3 h-44">
        <SentinelStage displayName={player.displayName} characterId={characterId} />
      </View>
    );
  }

  // Never mount frozen LIVE players — only a safe URL card or pending fallback.
  if (feedUrl) {
    return (
      <View className="mx-4 mb-3 h-44 overflow-hidden rounded-2xl border border-blyp-primary/35 bg-blyp-ink">
        <View className="flex-1 items-center justify-center px-4">
          <Text className="text-[10px] font-black uppercase tracking-[2px] text-blyp-primary">
            Live feed ready
          </Text>
          <Text className="mt-2 text-center text-sm font-extrabold text-blyp-text" numberOfLines={1}>
            {player.displayName}
          </Text>
          <Text className="mt-1 text-center text-[10px] font-semibold text-blyp-faint" numberOfLines={1}>
            {feedUrl}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="mx-4 mb-3 h-44">
      <HumanPendingCard player={player} note="LIVE FEED PENDING" />
    </View>
  );
}
