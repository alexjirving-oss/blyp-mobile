import React from 'react';
import { Text, View } from './nw';

/**
 * Theatrical turn prompt — visible on every screen, not a tiny chip.
 */
export function Grid9TurnOverlay({
  visible,
  title,
  subtitle,
  detail,
}: {
  visible: boolean;
  title: string;
  subtitle?: string | null;
  detail?: string | null;
}) {
  if (!visible || !title) return null;
  return (
    <View
      pointerEvents="none"
      className="absolute left-2 right-2 top-1 z-30 items-center"
    >
      <View className="w-full items-center rounded-2xl border-2 border-blyp-primary bg-black/82 px-3 py-3">
        <Text className="text-center text-[22px] font-black uppercase leading-7 tracking-[2px] text-blyp-primary">
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-1 text-center text-[16px] font-black uppercase leading-5 tracking-[1px] text-white">
            {subtitle}
          </Text>
        ) : null}
        {detail ? (
          <Text className="mt-1 text-center text-[13px] font-extrabold text-amber-300">
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
