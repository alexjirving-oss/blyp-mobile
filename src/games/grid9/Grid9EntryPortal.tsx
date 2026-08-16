import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from './nw';

export type Grid9EntryMode = 'portal' | 'public' | 'private';

export function Grid9EntryPortal({
  connectionStatus,
  lastError,
  onPlayPublic,
  onCreatePrivate,
  onJoinPrivate,
}: {
  connectionStatus: string;
  lastError: string | null;
  onPlayPublic: () => void;
  onCreatePrivate: () => void;
  onJoinPrivate: (roomCode: string) => void;
}) {
  const [code, setCode] = useState('');

  return (
    <View className="flex-1 items-center justify-center bg-blyp-ink px-6">
      <Text className="text-[11px] font-black uppercase tracking-[3px] text-blyp-primary/80">
        Grid 9
      </Text>
      <Text className="mt-3 text-center text-2xl font-black text-blyp-text">
        Enter the arena
      </Text>
      <Text className="mt-2 text-center text-xs font-semibold text-blyp-muted">
        Public drops into a 15s lobby. Private waits on the host.
      </Text>

      <TouchableOpacity
        className="mt-8 w-full max-w-sm items-center rounded-2xl border-2 border-blyp-primary bg-blyp-primary px-4 py-4"
        activeOpacity={0.85}
        onPress={onPlayPublic}
      >
        <Text className="text-base font-black tracking-[1px] text-blyp-ink">
          PLAY GAME
        </Text>
        <Text className="mt-1 text-[10px] font-bold uppercase tracking-[1px] text-blyp-ink/70">
          Public queue · house seed 100
        </Text>
      </TouchableOpacity>

      <View className="mt-6 w-full max-w-sm rounded-2xl border border-white/15 bg-blyp-card px-4 py-4">
        <Text className="text-center text-sm font-extrabold text-blyp-text">
          Private Room
        </Text>
        <TouchableOpacity
          className="mt-3 items-center rounded-xl border border-white/20 bg-blyp-ink py-3"
          activeOpacity={0.85}
          onPress={onCreatePrivate}
        >
          <Text className="text-xs font-black uppercase tracking-[1px] text-blyp-primary">
            Create room
          </Text>
        </TouchableOpacity>
        <TextInput
          className="mt-3 rounded-xl border border-white/15 bg-blyp-ink px-3 py-3 text-center text-base font-black tracking-[4px] text-blyp-primaryLight"
          value={code}
          onChangeText={setCode}
          placeholder="ROOM CODE"
          placeholderTextColor="#71717A"
          autoCapitalize="characters"
          maxLength={8}
        />
        <TouchableOpacity
          className="mt-3 items-center rounded-xl border border-blyp-primary/60 bg-blyp-primary/15 py-3"
          activeOpacity={0.85}
          onPress={() => onJoinPrivate(code)}
        >
          <Text className="text-xs font-black uppercase tracking-[1px] text-blyp-primary">
            Join with code
          </Text>
        </TouchableOpacity>
      </View>

      <Text className="mt-6 text-[10px] font-bold uppercase tracking-[2px] text-blyp-faint">
        Socket · {connectionStatus}
      </Text>
      {lastError ? (
        <Text className="mt-2 text-center text-[11px] font-semibold text-red-400">{lastError}</Text>
      ) : null}
    </View>
  );
}
