import React, { useCallback, useEffect, useState } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import searchService from '../../services/searchService';
import { Text, TextInput, TouchableOpacity, View } from './nw';

type SearchHit = {
  id: string;
  displayName: string;
  username?: string;
};

function inviteMessage(roomCode: string): string {
  return `Join my Grid 9 private room on Blyp.\nCode: ${roomCode}`;
}

/**
 * Private lobby share + invite. Copy / native share + search existing Blyp users.
 * Does not invent a new directory — uses searchService.searchUsers.
 */
export function Grid9PrivateInvitePanel({
  roomCode,
  entryFeeCoins = 0,
}: {
  roomCode: string | null | undefined;
  entryFeeCoins?: number;
}) {
  const code = String(roomCode || '').trim().toUpperCase();
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const onCopy = useCallback(async () => {
    if (!code) return;
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* soft */
    }
  }, [code]);

  const onShare = useCallback(async () => {
    if (!code) return;
    try {
      await Share.share({
        title: 'Grid 9 room',
        message: inviteMessage(code),
      });
    } catch {
      /* soft */
    }
  }, [code]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const users = await searchService.searchUsers(q, 12);
          if (cancelled) return;
          setHits(
            (users || []).map((u: any) => ({
              id: String(u.id || ''),
              displayName: String(u.displayName || u.username || 'User'),
              username: u.username ? String(u.username) : undefined,
            })).filter((u: SearchHit) => u.id),
          );
        } catch {
          if (!cancelled) setHits([]);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  if (!code) return null;

  return (
    <View className="mx-3 mb-2 rounded-2xl border border-blyp-primary/40 bg-blyp-card px-3 py-3">
      <Text className="text-center text-[10px] font-bold uppercase tracking-[2px] text-blyp-muted">
        Private room code
        {entryFeeCoins > 0 ? ` · entry ${entryFeeCoins}` : ' · free'}
      </Text>
      <Text className="mt-2 text-center text-3xl font-black tracking-[6px] text-blyp-primary">
        {code}
      </Text>
      <View className="mt-3 flex-row gap-2">
        <TouchableOpacity
          className="flex-1 items-center rounded-xl border border-blyp-primary/50 bg-blyp-primary/15 py-2.5"
          activeOpacity={0.85}
          onPress={() => void onCopy()}
        >
          <Text className="text-[11px] font-black uppercase tracking-[1px] text-blyp-primary">
            {copied ? 'Copied' : 'Copy'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 items-center rounded-xl border border-blyp-primary bg-blyp-primary py-2.5"
          activeOpacity={0.85}
          onPress={() => void onShare()}
        >
          <Text className="text-[11px] font-black uppercase tracking-[1px] text-blyp-ink">
            Share
          </Text>
        </TouchableOpacity>
      </View>

      <Text className="mt-4 text-[10px] font-bold uppercase tracking-[2px] text-blyp-faint">
        Invite people
      </Text>
      <TextInput
        className="mt-2 rounded-xl border border-white/15 bg-blyp-ink px-3 py-2 text-[12px] text-blyp-text"
        value={query}
        onChangeText={setQuery}
        placeholder="Search Blyp users…"
        placeholderTextColor="#71717A"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {searching ? (
        <Text className="mt-2 text-[10px] font-semibold text-blyp-muted">Searching…</Text>
      ) : null}
      {hits.slice(0, 6).map((hit) => (
        <TouchableOpacity
          key={hit.id}
          className="mt-2 flex-row items-center justify-between rounded-xl border border-white/10 bg-blyp-ink px-3 py-2"
          activeOpacity={0.85}
          onPress={() => {
            void Share.share({
              title: 'Grid 9 invite',
              message: `${hit.displayName} — ${inviteMessage(code)}`,
            });
          }}
        >
          <View className="flex-1 pr-2">
            <Text className="text-[12px] font-extrabold text-blyp-text" numberOfLines={1}>
              {hit.displayName}
            </Text>
            {hit.username ? (
              <Text className="text-[10px] font-semibold text-blyp-faint" numberOfLines={1}>
                @{hit.username}
              </Text>
            ) : null}
          </View>
          <Text className="text-[10px] font-black uppercase text-blyp-primary">Invite</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
