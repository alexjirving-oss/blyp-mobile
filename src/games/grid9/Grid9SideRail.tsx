import React, { useMemo, useState } from 'react';
import type { Grid9AuthoritativeGameState } from './protocol';
import { formatGrid9Coins } from './grid9Format';
import { Text, TextInput, TouchableOpacity, View } from './nw';

export function Grid9SideRail({
  match,
}: {
  match: Grid9AuthoritativeGameState | null;
}) {
  const [chatDraft, setChatDraft] = useState('');
  const [chatLines, setChatLines] = useState<string[]>([
    'Chat is local-only for Wave 2 polish.',
  ]);

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
      .slice(0, 5);
  }, [match]);

  return (
    <View className="mx-4 mb-2 flex-row gap-2">
      <View className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2">
        <Text className="text-[10px] font-bold uppercase tracking-[2px] text-slate-500">
          Top supporters
        </Text>
        {supporters.length === 0 ? (
          <Text className="mt-1 text-[11px] font-semibold text-slate-500">
            Fund a mercenary to climb the board
          </Text>
        ) : (
          supporters.map((row, index) => (
            <Text
              key={`${row.seat}-${row.name}-${index}`}
              className="mt-1 text-[11px] font-extrabold text-slate-200"
            >
              {index + 1}. {row.name} · {formatGrid9Coins(row.coins)} · seat {row.seat + 1}
            </Text>
          ))
        )}
      </View>
      <View className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2">
        <Text className="text-[10px] font-bold uppercase tracking-[2px] text-slate-500">
          Arena chat
        </Text>
        {chatLines.slice(-3).map((line, index) => (
          <Text key={`${line}-${index}`} className="mt-1 text-[10px] font-semibold text-slate-400">
            {line}
          </Text>
        ))}
        <View className="mt-2 flex-row items-center">
          <TextInput
            className="mr-2 flex-1 rounded-lg border border-slate-600 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
            value={chatDraft}
            onChangeText={setChatDraft}
            placeholder="Say something…"
            placeholderTextColor="#64748b"
          />
          <TouchableOpacity
            className="rounded-lg border border-amber-500/50 bg-amber-500/15 px-2 py-1"
            activeOpacity={0.85}
            onPress={() => {
              const trimmed = chatDraft.trim();
              if (!trimmed) return;
              setChatLines((prev) => [...prev.slice(-8), `You: ${trimmed}`]);
              setChatDraft('');
            }}
          >
            <Text className="text-[10px] font-black uppercase text-amber-300">Send</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
