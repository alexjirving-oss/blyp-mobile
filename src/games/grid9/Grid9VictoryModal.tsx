import React, { useState } from 'react';
import {
  coinsFromTokensConvert,
  tokensFromJackpotCoins,
} from './constants';
import { formatGrid9Coins } from './grid9Format';
import { convertGrid9TokensToCoins } from './grid9TokenWallet';
import { Text, TouchableOpacity, View } from './nw';

export function Grid9VictoryModal({
  visible,
  jackpotCoins,
  winnerName,
  isWinner,
  liveServiceBaseUrl,
  accessToken,
  onClose,
}: {
  visible: boolean;
  jackpotCoins: number;
  winnerName: string | null;
  isWinner?: boolean;
  liveServiceBaseUrl?: string | null;
  accessToken?: string | null;
  onClose: () => void;
}) {
  const [converting, setConverting] = useState(false);
  const [convertNote, setConvertNote] = useState<string | null>(null);
  if (!visible) return null;

  const wonTokens = tokensFromJackpotCoins(jackpotCoins);
  const instantCoins = coinsFromTokensConvert(wonTokens);

  const onInstantConvert = async () => {
    if (!isWinner || !liveServiceBaseUrl || !accessToken || wonTokens < 1) return;
    setConverting(true);
    setConvertNote(null);
    try {
      const out = await convertGrid9TokensToCoins({
        liveServiceBaseUrl,
        accessToken,
        amountTokens: wonTokens,
        idempotencyKey: `grid9-instant-${Date.now()}`,
      });
      setConvertNote(
        `Converted ${out.tokensDebited} Tokens → ${out.coinsCredited} coins`,
      );
    } catch (error: any) {
      setConvertNote(error?.message || 'Convert failed');
    } finally {
      setConverting(false);
    }
  };

  return (
    <View className="absolute inset-0 z-50 items-center justify-center bg-black/80 px-6">
      <View className="w-full max-w-sm rounded-3xl border-2 border-amber-400 bg-slate-950 px-5 py-6">
        <Text className="text-center text-[11px] font-black uppercase tracking-[3px] text-amber-400">
          YOU WON
        </Text>
        <Text className="mt-3 text-center text-2xl font-black text-slate-50">
          {winnerName ? `${winnerName} wins` : 'Arena settled'}
        </Text>
        <Text className="mt-2 text-center text-sm font-extrabold text-amber-300">
          Jackpot · {formatGrid9Coins(jackpotCoins)} coins
        </Text>
        <Text className="mt-4 text-center text-[11px] font-semibold text-slate-400">
          Winner credited {formatGrid9Coins(wonTokens)} Tokens (50%). Instant converts
          Tokens→coins at 1:1 + 15% bonus.
        </Text>
        <TouchableOpacity
          className="mt-4 items-center rounded-2xl border border-amber-500/60 bg-slate-900 py-3"
          disabled
        >
          <Text className="text-xs font-black uppercase tracking-[1px] text-amber-200">
            Tokens · {formatGrid9Coins(wonTokens)} @ 50%
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className={`mt-2 items-center rounded-2xl border-2 border-amber-400 py-3 ${
            isWinner && liveServiceBaseUrl && accessToken
              ? 'bg-amber-400'
              : 'bg-slate-900 opacity-50'
          }`}
          activeOpacity={0.85}
          disabled={
            !isWinner || !liveServiceBaseUrl || !accessToken || converting || wonTokens < 1
          }
          onPress={() => {
            void onInstantConvert();
          }}
        >
          <Text
            className={`text-xs font-black uppercase tracking-[1px] ${
              isWinner && liveServiceBaseUrl && accessToken
                ? 'text-slate-950'
                : 'text-slate-400'
            }`}
          >
            {converting
              ? 'Converting…'
              : `Instant · ~${formatGrid9Coins(instantCoins)} coins (+15%)`}
          </Text>
        </TouchableOpacity>
        {convertNote ? (
          <Text className="mt-2 text-center text-[11px] font-semibold text-slate-300">
            {convertNote}
          </Text>
        ) : null}
        <TouchableOpacity
          className="mt-3 items-center rounded-2xl border-2 border-amber-400 bg-amber-400 py-3"
          activeOpacity={0.85}
          onPress={onClose}
        >
          <Text className="text-xs font-black uppercase tracking-[1px] text-slate-950">
            Continue
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
