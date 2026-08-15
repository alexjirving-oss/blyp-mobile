import React from 'react';
import { Modal, ScrollView } from 'react-native';
import {
  listGrid9Arsenal,
  type Grid9ArsenalItem,
} from './catalog';
import { canAffordGrid9Item } from './grid9Actions';
import { formatGrid9Coins } from './grid9Format';
import { Text, TouchableOpacity, View } from './nw';

export function Grid9WeaponsGalleryModal({
  visible,
  availableCoins,
  onClose,
  onSelectItem,
}: {
  visible: boolean;
  availableCoins: number;
  onClose: () => void;
  onSelectItem: (item: Grid9ArsenalItem) => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/70">
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={onClose} />
        <View className="rounded-t-3xl border-t border-amber-400/40 bg-slate-950 px-4 pb-6 pt-3">
          <View className="mb-3 items-center">
            <View className="mb-3 h-1.5 w-12 rounded-full bg-slate-600" />
            <Text className="text-[11px] font-black uppercase tracking-[2px] text-amber-400">
              Tactical arsenal
            </Text>
            <Text className="mt-1 text-xs font-semibold text-slate-400">
              Escrow {formatGrid9Coins(availableCoins)} coins
            </Text>
          </View>

          <ScrollView>
            {listGrid9Arsenal().map((item) => {
              const affordable = canAffordGrid9Item(availableCoins, item.costCoins);
              const stat =
                item.kind === 'weapon'
                  ? `${item.directDamage} dmg`
                  : `+${item.shieldPoints} shield`;
              return (
                <TouchableOpacity
                  key={item.id}
                  disabled={!affordable}
                  activeOpacity={0.85}
                  onPress={() => onSelectItem(item)}
                  className={`mb-2 flex-row items-center rounded-2xl border px-3 py-3 ${
                    affordable
                      ? 'border-amber-400/40 bg-slate-900'
                      : 'border-slate-800 bg-slate-950'
                  }`}
                >
                  <View
                    className={`mr-3 h-12 w-12 items-center justify-center rounded-xl ${
                      affordable ? 'bg-amber-400/15' : 'bg-slate-800'
                    }`}
                  >
                    <Text className="text-xl">{item.glyph}</Text>
                  </View>
                  <View className="flex-1">
                    <Text
                      className={`text-sm font-black ${
                        affordable ? 'text-slate-100' : 'text-slate-500'
                      }`}
                    >
                      {item.displayName}
                    </Text>
                    <Text className="mt-0.5 text-[11px] font-semibold text-slate-400">
                      {stat}
                      {item.kind === 'weapon' && item.adjacentDamage
                        ? ` · splash ${item.adjacentDamage}`
                        : ''}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text
                      className={`text-sm font-black ${
                        affordable ? 'text-amber-400' : 'text-slate-600'
                      }`}
                    >
                      {formatGrid9Coins(item.costCoins)}
                    </Text>
                    <Text className="text-[10px] font-bold uppercase text-slate-500">
                      {affordable ? 'coins' : 'locked'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            className="mt-2 items-center rounded-xl border border-slate-700 py-3"
            activeOpacity={0.85}
            onPress={onClose}
          >
            <Text className="text-xs font-black uppercase tracking-[1px] text-slate-300">
              Close
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
