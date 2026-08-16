import React from 'react';
import { formatGrid9Coins } from './grid9Format';
import { Text, View } from './nw';

/**
 * Golden pot-of-coins overlay for the spotlight (not a thin text banner).
 */
export function Grid9JackpotPot({
  coins,
  isSeed = false,
}: {
  coins: number;
  isSeed?: boolean;
}) {
  const amount = formatGrid9Coins(coins);
  return (
    <View className="items-center" style={{ width: 86 }}>
      <View className="relative h-[72px] w-[86px] items-center">
        <View className="absolute left-[18px] top-[6px] h-3 w-3 rounded-full bg-amber-300" />
        <View className="absolute left-[36px] top-[2px] h-3.5 w-3.5 rounded-full bg-yellow-300" />
        <View className="absolute left-[54px] top-[7px] h-3 w-3 rounded-full bg-amber-200" />
        <View className="absolute left-[26px] top-[14px] h-2.5 w-2.5 rounded-full bg-amber-100" />
        <View className="absolute left-[46px] top-[13px] h-2.5 w-2.5 rounded-full bg-yellow-200" />
        <View
          className="absolute bottom-0 items-center justify-end overflow-hidden"
          style={{
            width: 86,
            height: 52,
            borderTopLeftRadius: 10,
            borderTopRightRadius: 10,
            borderBottomLeftRadius: 28,
            borderBottomRightRadius: 28,
            backgroundColor: '#e8b423',
            borderWidth: 2,
            borderColor: '#fde68a',
          }}
        >
          <View
            className="absolute left-0 right-0 top-0"
            style={{ height: 10, backgroundColor: '#b45309' }}
          />
          <Text
            className="mb-1.5 text-center font-black text-blyp-ink"
            style={{ fontSize: amount.length > 4 ? 16 : 20, lineHeight: 22 }}
            numberOfLines={1}
          >
            {amount}
          </Text>
        </View>
      </View>
      <Text className="mt-0.5 text-[8px] font-black uppercase tracking-[1px] text-amber-200">
        {isSeed ? 'Seed pot' : 'Match pot'}
      </Text>
    </View>
  );
}
