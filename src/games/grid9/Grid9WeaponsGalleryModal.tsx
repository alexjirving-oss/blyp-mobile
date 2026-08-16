import React, { useEffect } from 'react';
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
  accountCoins,
  inventoryItemIds = [],
  freeDropItemId = null,
  onClose,
  onSelectItem,
  onVisibleRefresh,
}: {
  visible: boolean;
  /** Platform Blyp account coins (IAP /wallet) — not seat gift bankroll. */
  accountCoins: number;
  inventoryItemIds?: string[];
  freeDropItemId?: string | null;
  onClose: () => void;
  onSelectItem: (item: Grid9ArsenalItem) => void;
  onVisibleRefresh?: () => void;
}) {
  useEffect(() => {
    if (visible) onVisibleRefresh?.();
  }, [visible, onVisibleRefresh]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/70">
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={onClose} />
        <View className="rounded-t-3xl border-t border-blyp-primary/40 bg-blyp-ink px-4 pb-6 pt-3">
          <View className="mb-3 items-center">
            <View className="mb-3 h-1.5 w-12 rounded-full bg-white/20" />
            <Text className="text-[11px] font-black uppercase tracking-[2px] text-blyp-primary">
              Tactical arsenal
            </Text>
            <Text className="mt-1 text-xs font-semibold text-blyp-muted">
              Your coins {formatGrid9Coins(accountCoins)}
            </Text>
            <Text className="mt-0.5 text-[10px] font-semibold text-blyp-faint">
              Account balance · gifts land as seat bankroll
            </Text>
          </View>

          <ScrollView>
            {listGrid9Arsenal().map((item) => {
              const fromInventory = inventoryItemIds.includes(item.id);
              const fromFreeDrop = freeDropItemId === item.id;
              const affordable =
                fromInventory ||
                fromFreeDrop ||
                canAffordGrid9Item(accountCoins, item.costCoins);
              const priceLabel = fromFreeDrop
                ? 'FREE'
                : fromInventory
                  ? 'OWNED'
                  : formatGrid9Coins(item.costCoins);
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
                      ? 'border-blyp-primary/40 bg-blyp-card'
                      : 'border-white/10 bg-blyp-ink'
                  }`}
                >
                  <View
                    className={`mr-3 h-12 w-12 items-center justify-center rounded-xl ${
                      affordable ? 'bg-blyp-primary/15' : 'bg-blyp-alt'
                    }`}
                  >
                    <Text className="text-xl">{item.glyph}</Text>
                  </View>
                  <View className="flex-1">
                    <Text
                      className={`text-sm font-black ${
                        affordable ? 'text-blyp-text' : 'text-blyp-faint'
                      }`}
                    >
                      {item.displayName}
                    </Text>
                    <Text className="mt-0.5 text-[11px] font-semibold text-blyp-muted">
                      {stat}
                      {item.kind === 'weapon' && item.adjacentDamage
                        ? ` · splash ${item.adjacentDamage}`
                        : ''}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text
                      className={`text-sm font-black ${
                        affordable ? 'text-blyp-primary' : 'text-blyp-faint'
                      }`}
                    >
                      {priceLabel}
                    </Text>
                    <Text className="text-[10px] font-bold uppercase text-blyp-faint">
                      {fromFreeDrop || fromInventory
                        ? 'ready'
                        : affordable
                          ? 'coins'
                          : 'locked'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            className="mt-2 items-center rounded-xl border border-white/15 py-3"
            activeOpacity={0.85}
            onPress={onClose}
          >
            <Text className="text-xs font-black uppercase tracking-[1px] text-blyp-muted">
              Close
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
