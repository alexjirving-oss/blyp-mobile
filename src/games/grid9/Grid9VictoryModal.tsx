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
      <View className="w-full max-w-sm rounded-3xl border-2 border-blyp-primary bg-blyp-ink px-5 py-6">
        <Text className="text-center text-[11px] font-black uppercase tracking-[3px] text-blyp-primary">
          YOU WON
        </Text>
        <Text className="mt-3 text-center text-2xl font-black text-blyp-text">
          {winnerName ? `${winnerName} wins` : 'Arena settled'}
        </Text>
        <Text className="mt-2 text-center text-sm font-extrabold text-blyp-primaryLight">
          Jackpot · {formatGrid9Coins(jackpotCoins)} coins
        </Text>
        <Text className="mt-4 text-center text-[11px] font-semibold text-blyp-muted">
          Winner credited {formatGrid9Coins(wonTokens)} Tokens (50%). Instant converts
          Tokens→coins at 1:1 + 15% bonus.
        </Text>
        <TouchableOpacity
          className="mt-4 items-center rounded-2xl border border-blyp-primary/60 bg-blyp-card py-3"
          disabled
        >
          <Text className="text-xs font-black uppercase tracking-[1px] text-blyp-primaryLight">
            Tokens · {formatGrid9Coins(wonTokens)} @ 50%
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className={`mt-2 items-center rounded-2xl border-2 border-blyp-primary py-3 ${
            isWinner && liveServiceBaseUrl && accessToken
              ? 'bg-blyp-primary'
              : 'bg-blyp-card opacity-50'
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
                ? 'text-blyp-ink'
                : 'text-blyp-muted'
            }`}
          >
            {converting
              ? 'Converting…'
              : `Instant · ~${formatGrid9Coins(instantCoins)} coins (+15%)`}
          </Text>
        </TouchableOpacity>
        {convertNote ? (
          <Text className="mt-2 text-center text-[11px] font-semibold text-blyp-muted">
            {convertNote}
          </Text>
        ) : null}
        <TouchableOpacity
          className="mt-3 items-center rounded-2xl border-2 border-blyp-primary bg-blyp-primary py-3"
          activeOpacity={0.85}
          onPress={onClose}
        >
          <Text className="text-xs font-black uppercase tracking-[1px] text-blyp-ink">
            Continue
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
