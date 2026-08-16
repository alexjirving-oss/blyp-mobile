import React, { useMemo, useState } from 'react';
import {
  GRID9_MAX_ENTRY_FEE_COINS,
  GRID9_MIN_ENTRY_FEE_COINS,
} from './constants';
import { Text, TextInput, TouchableOpacity, View } from './nw';

export type Grid9EntryMode = 'portal' | 'public' | 'private';

const FEE_PRESETS = [0, 50, 100, 250, 500] as const;

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
  onCreatePrivate: (entryFeeCoins: number) => void;
  onJoinPrivate: (roomCode: string) => void;
}) {
  const [code, setCode] = useState('');
  const [entryFeeCoins, setEntryFeeCoins] = useState(0);
  const [customFee, setCustomFee] = useState('');

  const resolvedFee = useMemo(() => {
    const fromCustom = Math.floor(Number(customFee));
    if (customFee.trim() && Number.isFinite(fromCustom)) {
      return Math.min(
        GRID9_MAX_ENTRY_FEE_COINS,
        Math.max(GRID9_MIN_ENTRY_FEE_COINS, fromCustom),
      );
    }
    return Math.min(
      GRID9_MAX_ENTRY_FEE_COINS,
      Math.max(GRID9_MIN_ENTRY_FEE_COINS, entryFeeCoins),
    );
  }, [customFee, entryFeeCoins]);

  return (
    <View className="flex-1 items-center justify-center bg-blyp-ink px-6">
      <Text className="text-[11px] font-black uppercase tracking-[3px] text-blyp-primary/80">
        Grid 9
      </Text>
      <Text className="mt-3 text-center text-2xl font-black text-blyp-text">
        Enter the arena
      </Text>
      <Text className="mt-2 text-center text-xs font-semibold text-blyp-muted">
        Public drops into a shared ~30s lobby. Private waits on the host.
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
        <Text className="mt-2 text-center text-[10px] font-bold uppercase tracking-[1px] text-blyp-faint">
          Optional entry fee · 100% to jackpot
        </Text>
        <View className="mt-3 flex-row flex-wrap justify-center gap-2">
          {FEE_PRESETS.map((fee) => {
            const selected = customFee.trim() === '' && entryFeeCoins === fee;
            return (
              <TouchableOpacity
                key={fee}
                className={`rounded-lg border px-3 py-2 ${
                  selected
                    ? 'border-blyp-primary bg-blyp-primary/20'
                    : 'border-white/15 bg-blyp-ink'
                }`}
                activeOpacity={0.85}
                onPress={() => {
                  setCustomFee('');
                  setEntryFeeCoins(fee);
                }}
              >
                <Text
                  className={`text-[10px] font-black uppercase ${
                    selected ? 'text-blyp-primary' : 'text-blyp-muted'
                  }`}
                >
                  {fee === 0 ? 'Free' : `${fee}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TextInput
          className="mt-3 rounded-xl border border-white/15 bg-blyp-ink px-3 py-2 text-center text-[12px] font-bold text-blyp-text"
          value={customFee}
          onChangeText={setCustomFee}
          placeholder={`Custom fee 0–${GRID9_MAX_ENTRY_FEE_COINS}`}
          placeholderTextColor="#71717A"
          keyboardType="number-pad"
          maxLength={5}
        />
        <TouchableOpacity
          className="mt-3 items-center rounded-xl border border-white/20 bg-blyp-ink py-3"
          activeOpacity={0.85}
          onPress={() => onCreatePrivate(resolvedFee)}
        >
          <Text className="text-xs font-black uppercase tracking-[1px] text-blyp-primary">
            Create room
            {resolvedFee > 0 ? ` · ${resolvedFee} entry` : ' · free'}
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
