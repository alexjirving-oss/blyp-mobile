import React, { useEffect, useMemo, useState } from 'react';
import type { Grid9AuthoritativeGameState, Grid9PublicPlayer } from './protocol';
import { Text, View } from './nw';

function humanJoinLabel(player: Grid9PublicPlayer): string | null {
  if (player.kind !== 'human') return null;
  const name = player.displayName?.trim() || 'Viewer';
  return `⚡ Viewer ${name} joined the room!`;
}

export function Grid9ArrivalTicker({
  match,
}: {
  match: Grid9AuthoritativeGameState | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const fingerprint = useMemo(() => {
    if (!match) return '';
    return match.players
      .filter((player) => player.kind === 'human')
      .map((player) => `${player.slotIndex}:${player.publicProfileId ?? player.displayName}`)
      .sort()
      .join('|');
  }, [match]);

  useEffect(() => {
    if (!match || !fingerprint) return;
    const humans = match.players.filter((player) => player.kind === 'human');
    const newest = humans[humans.length - 1];
    if (!newest) return;
    const label = humanJoinLabel(newest);
    if (!label) return;
    setMessage(label);
    const timer = setTimeout(() => setMessage(null), 4200);
    return () => clearTimeout(timer);
  }, [fingerprint, match]);

  if (!message) return null;

  return (
    <View className="mx-3 mb-2 rounded-xl border border-blyp-primary/30 bg-blyp-card/90 px-3 py-2">
      <Text className="text-center text-[11px] font-extrabold text-blyp-primary">{message}</Text>
    </View>
  );
}
