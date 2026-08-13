import React, { useCallback } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

/**
 * Horizontal home rail — FlatList + getItemLayout + snap.
 * No nested ScrollView, no video decoders. Cards are posters only.
 */
export default function HomeNextRail({
  data,
  itemWidth,
  gap = 12,
  height,
  renderCard,
  keyExtractor,
  contentPadding = 16,
}) {
  const snap = itemWidth + gap;
  const offsets = (data || []).map((_, i) => i * snap);

  const renderItem = useCallback(
    ({ item, index }) => (
      <View style={{ width: itemWidth, marginRight: index === data.length - 1 ? 0 : gap }}>
        {renderCard({ item, index })}
      </View>
    ),
    [data.length, gap, itemWidth, renderCard],
  );

  return (
    <FlatList
      horizontal
      data={data}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      style={height ? { height } : undefined}
      contentContainerStyle={[styles.content, { paddingHorizontal: contentPadding }]}
      showsHorizontalScrollIndicator={false}
      snapToOffsets={offsets}
      snapToAlignment="start"
      decelerationRate="fast"
      disableIntervalMomentum
      getItemLayout={(_, index) => ({
        length: snap,
        offset: snap * index,
        index,
      })}
      windowSize={5}
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews
      nestedScrollEnabled
    />
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'flex-start',
  },
});
