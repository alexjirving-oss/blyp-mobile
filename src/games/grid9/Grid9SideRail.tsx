import React, { useMemo, useState } from 'react';
import type { Grid9AuthoritativeGameState } from './protocol';
import { formatGrid9Coins } from './grid9Format';
import { Text, TextInput, TouchableOpacity, View } from './nw';

/**
 * Social / audience strip — viewers, gifters, chat. Patronus black/blue.
 */
export function Grid9SideRail({
  match,
}: {
  match: Grid9AuthoritativeGameState | null;
}) {
  const [chatDraft, setChatDraft] = useState('');
  const [chatLines, setChatLines] = useState<string[]>([
    'Say hi — chat is local for Wave 2 polish.',
  ]);

  const viewers = useMemo(() => {
    if (!match) return [] as string[];
    return match.players
      .filter((player) => player.kind === 'human')
      .map((player) => player.displayName?.trim() || 'Player');
  }, [match]);

  const supporters = useMemo(() => {
    if (!match) return [];
    const rows: Array<{ name: string; coins: number; seat: number }> = [];
    for (const player of match.players) {
      for (const entry of player.topSupporters ?? []) {
        rows.push({
          name: entry.displayName?.trim() || 'Supporter',
          coins: Number(entry.contributedCoins ?? 0),
          seat: player.slotIndex,
        });
      }
    }
    return rows
      .sort((a, b) => b.coins - a.coins || a.seat - b.seat)
      .slice(0, 6);
  }, [match]);

  const audienceCount = Number(match?.audienceCount ?? 0);

  return (
    <View className="mx-3 mb-2 flex-1">
      <View className="mb-2 rounded-xl border border-blyp-primary/25 bg-blyp-card px-3 py-2">
        <Text className="text-[10px] font-bold uppercase tracking-[2px] text-blyp-faint">
          Viewers · {audienceCount} watching
        </Text>
        {viewers.length === 0 ? (
          <Text className="mt-1 text-[11px] font-semibold text-blyp-muted">
            Waiting for humans to join the lobby…
          </Text>
        ) : (
          <Text className="mt-1 text-[11px] font-extrabold text-blyp-text" numberOfLines={2}>
            {viewers.join(' · ')}
          </Text>
        )}
      </View>

      <View className="mb-2 rounded-xl border border-blyp-primary/25 bg-blyp-card px-3 py-2">
        <Text className="text-[10px] font-bold uppercase tracking-[2px] text-blyp-faint">
          Gifters
        </Text>
        {supporters.length === 0 ? (
          <Text className="mt-1 text-[11px] font-semibold text-blyp-muted">
            Gift arsenal to climb the board
          </Text>
        ) : (
          supporters.map((row, index) => (
            <Text
              key={`${row.seat}-${row.name}-${index}`}
              className="mt-1 text-[11px] font-extrabold text-blyp-text"
            >
              {index + 1}. {row.name} · {formatGrid9Coins(row.coins)} · seat {row.seat + 1}
            </Text>
          ))
        )}
      </View>

      <View className="min-h-[88px] flex-1 rounded-xl border border-blyp-primary/25 bg-blyp-card px-3 py-2">
        <Text className="text-[10px] font-bold uppercase tracking-[2px] text-blyp-faint">
          Arena chat
        </Text>
        {chatLines.slice(-4).map((line, index) => (
          <Text key={`${line}-${index}`} className="mt-1 text-[10px] font-semibold text-blyp-muted">
            {line}
          </Text>
        ))}
        <View className="mt-2 flex-row items-center">
          <TextInput
            className="mr-2 flex-1 rounded-lg border border-white/15 bg-blyp-ink px-2 py-1 text-[11px] text-blyp-text"
            value={chatDraft}
            onChangeText={setChatDraft}
            placeholder="Say something…"
            placeholderTextColor="#64748b"
          />
          <TouchableOpacity
            className="rounded-lg border border-blyp-primary/50 bg-blyp-primary/15 px-2 py-1"
            activeOpacity={0.85}
            onPress={() => {
              const trimmed = chatDraft.trim();
              if (!trimmed) return;
              setChatLines((prev) => [...prev.slice(-8), `You: ${trimmed}`]);
              setChatDraft('');
            }}
          >
            <Text className="text-[10px] font-black uppercase text-blyp-primary">Send</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
