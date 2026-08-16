import React, { useMemo, useState } from 'react';
import {
  GRID9_ARSENAL_CATALOG,
  GRID9_DEFAULT_MERCENARY_FUND_COINS,
  type Grid9ArsenalItem,
} from './catalog';
import type { Grid9AuthoritativeGameState } from './protocol';
import { formatGrid9Coins, formatGrid9Countdown } from './grid9Format';
import { Text, TextInput, TouchableOpacity, View } from './nw';

type SocialTab = 'chat' | 'feed' | 'gifters';

const POWER_SLOTS: Array<{
  id: string;
  label: string;
  blurb: string;
  glyph: string;
  catalogId?: 'fireball' | 'basic_shield' | 'kiss' | 'coins';
}> = [
  {
    id: 'fireball',
    label: 'Fireball',
    blurb: 'Damage opponent',
    glyph: '🔥',
    catalogId: 'fireball',
  },
  {
    id: 'shield',
    label: 'Shield',
    blurb: 'Protect a seat',
    glyph: '🛡',
    catalogId: 'basic_shield',
  },
  {
    id: 'kiss',
    label: 'Kiss',
    blurb: 'Restore +20 HP',
    glyph: '💋',
    catalogId: 'kiss',
  },
  {
    id: 'coins',
    label: 'Coins',
    blurb: 'Fund mercenary',
    glyph: '🪙',
    catalogId: 'coins',
  },
];

/**
 * Mockup lower half: ARENA CHAT | BATTLE FEED | TOP GIFTERS + Active Powers rail.
 */
export function Grid9SideRail({
  match,
  inventoryItemIds = [],
  accountCoins = 0,
  canUsePowers = false,
  countdownMs = null,
  onPickArsenal,
  onPickMercenary,
}: {
  match: Grid9AuthoritativeGameState | null;
  inventoryItemIds?: string[];
  accountCoins?: number;
  canUsePowers?: boolean;
  countdownMs?: number | null;
  onPickArsenal?: (item: Grid9ArsenalItem) => void;
  onPickMercenary?: () => void;
}) {
  const [tab, setTab] = useState<SocialTab>('chat');
  const [chatDraft, setChatDraft] = useState('');
  const [chatLines, setChatLines] = useState<string[]>([
    'Say hi — chat is local for Wave 2 polish.',
  ]);

  const inventoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const id of inventoryItemIds) {
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }, [inventoryItemIds]);

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
      .slice(0, 8);
  }, [match]);

  const battleFeed = useMemo(() => {
    const lines: string[] = [];
    const action = match?.lastAction as
      | {
          kind?: string;
          weaponId?: string;
          shieldId?: string;
          targetSlotIndex?: number;
          actor?: { displayName?: string };
        }
      | null
      | undefined;
    if (action?.kind === 'weapon' && action.weaponId) {
      const name = action.actor?.displayName || 'Player';
      const item = GRID9_ARSENAL_CATALOG[action.weaponId as keyof typeof GRID9_ARSENAL_CATALOG];
      lines.push(
        `${name} used ${item?.displayName || action.weaponId} on seat #${
          Number(action.targetSlotIndex ?? 0) + 1
        }`,
      );
    } else if (action?.kind === 'shield' && action.shieldId) {
      const name = action.actor?.displayName || 'Player';
      lines.push(
        `${name} shielded seat #${Number(action.targetSlotIndex ?? 0) + 1}`,
      );
    }
    if (match?.phase === 'roulette') {
      lines.push('Roulette spinning among survivors…');
    }
    if (
      countdownMs != null &&
      countdownMs >= 0 &&
      (match?.phase === 'combat' || match?.phase === 'roulette')
    ) {
      lines.push(`Next spotlight ${formatGrid9Countdown(countdownMs)}`);
    }
    return lines.length > 0 ? lines : ['Battle feed updates as actions land.'];
  }, [countdownMs, match?.lastAction, match?.phase]);

  const audienceCount = Number(match?.audienceCount ?? 0);
  const chatCount = Math.max(audienceCount, chatLines.length);

  return (
    <View className="mx-3 mb-2 flex-row">
      <View className="mr-2 min-h-[160px] flex-1 rounded-xl border border-blyp-primary/25 bg-blyp-card px-2 py-2">
        <View className="mb-2 flex-row">
          {(
            [
              ['chat', `Arena chat · ${chatCount}`],
              ['feed', 'Battle feed'],
              ['gifters', 'Top gifters'],
            ] as const
          ).map(([key, label]) => {
            const active = tab === key;
            return (
              <TouchableOpacity
                key={key}
                className={`mr-1 flex-1 rounded-lg px-1 py-1.5 ${
                  active ? 'bg-blyp-primary/15' : 'bg-transparent'
                }`}
                activeOpacity={0.85}
                onPress={() => setTab(key)}
              >
                <Text
                  className={`text-center text-[8px] font-black uppercase tracking-[0.5px] ${
                    active ? 'text-blyp-primary' : 'text-blyp-faint'
                  }`}
                  numberOfLines={1}
                >
                  {label}
                </Text>
                {active ? (
                  <View className="mx-auto mt-1 h-0.5 w-8 rounded-full bg-blyp-primary" />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {tab === 'chat' ? (
          <View>
            {chatLines.slice(-5).map((line, index) => (
              <Text
                key={`${line}-${index}`}
                className="mt-1 text-[10px] font-semibold text-blyp-muted"
              >
                {line}
              </Text>
            ))}
            <View className="mt-2 flex-row items-center">
              <TextInput
                className="mr-2 flex-1 rounded-lg border border-white/15 bg-blyp-ink px-2 py-1.5 text-[11px] text-blyp-text"
                value={chatDraft}
                onChangeText={setChatDraft}
                placeholder="Say something…"
                placeholderTextColor="#64748b"
              />
              <TouchableOpacity
                className="rounded-lg border border-blyp-primary/50 bg-blyp-primary/15 px-2 py-1.5"
                activeOpacity={0.85}
                onPress={() => {
                  const trimmed = chatDraft.trim();
                  if (!trimmed) return;
                  setChatLines((prev) => [...prev.slice(-8), `You: ${trimmed}`]);
                  setChatDraft('');
                }}
              >
                <Text className="text-[10px] font-black text-blyp-primary">➤</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {tab === 'feed' ? (
          <View>
            {battleFeed.map((line, index) => (
              <Text
                key={`${line}-${index}`}
                className="mt-1 text-[10px] font-semibold text-blyp-muted"
              >
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        {tab === 'gifters' ? (
          <View>
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
                  {index + 1}. {row.name} · {formatGrid9Coins(row.coins)} · seat{' '}
                  {row.seat + 1}
                </Text>
              ))
            )}
          </View>
        ) : null}
      </View>

      <View className="w-[108px] rounded-xl border border-blyp-primary/30 bg-blyp-card px-1.5 py-2">
        <Text className="mb-1 text-center text-[8px] font-black uppercase tracking-[1px] text-blyp-faint">
          Active powers
        </Text>
        {POWER_SLOTS.map((slot) => {
          const count =
            slot.catalogId === 'coins'
              ? '∞'
              : String(inventoryCounts[slot.catalogId || ''] || 0);
          return (
            <TouchableOpacity
              key={slot.id}
              className="mb-1 rounded-lg border border-white/10 bg-blyp-ink px-1.5 py-1.5"
              activeOpacity={0.85}
              disabled={!canUsePowers}
              onPress={() => {
                if (!canUsePowers) return;
                if (slot.catalogId === 'coins') {
                  onPickMercenary?.();
                  return;
                }
                const item = GRID9_ARSENAL_CATALOG[slot.catalogId!];
                if (item) onPickArsenal?.(item);
              }}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-[10px] font-extrabold text-blyp-text" numberOfLines={1}>
                  {slot.glyph} {slot.label}
                </Text>
                <Text className="text-[9px] font-black text-blyp-primary">{count}</Text>
              </View>
              <Text className="text-[7px] font-semibold text-blyp-faint" numberOfLines={1}>
                {slot.blurb}
              </Text>
            </TouchableOpacity>
          );
        })}
        <Text className="mt-1 text-center text-[8px] font-bold text-amber-300">
          🪙 {formatGrid9Coins(accountCoins)}
          {canUsePowers ? '' : ''}
        </Text>
        <Text className="text-center text-[7px] font-semibold text-blyp-faint">
          Fund {GRID9_DEFAULT_MERCENARY_FUND_COINS}
        </Text>
      </View>
    </View>
  );
}
