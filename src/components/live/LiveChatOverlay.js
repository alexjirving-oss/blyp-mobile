import React, { useMemo, useEffect } from 'react';
import { View, Text, Image, FlatList, StyleSheet, useWindowDimensions, Pressable } from 'react-native';

/**
 * Bottom-anchored live chat overlay (YouTube / TikTok Live style).
 *
 * Messages are pinned to the bottom of the screen and grow upward: the newest
 * message sits at the bottom, older messages scroll up and fade out at the top.
 * The list is independently scrollable so viewers can read back through history
 * without new messages yanking them to the bottom (inverted FlatList keeps the
 * scroll position stable while still sticking to "newest" when already at the
 * bottom).
 *
 * Props:
 *  - messages: array ordered OLDEST -> NEWEST, items { id, username, avatar, text }
 *  - bottomInset: distance from the bottom of the screen (px) to anchor above
 *    the bottom bar / reaction tray.
 *  - maxVisible: how many recent messages to keep mounted (perf cap).
 *  - onPressUser: optional (item) => void. When provided, tapping a message
 *    invokes it with the message ({ id, userId, username, avatar, text }) — used
 *    to gift a commenter.
 */
export default function LiveChatOverlay({ messages = [], bottomInset = 0, maxVisible = 8, onPressUser, onLayoutHeight }) {
  const { height: winHeight } = useWindowDimensions();

  // Inverted lists render from the bottom, so they want newest-first data.
  const data = useMemo(() => {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    const cleaned = messages.filter((m) => m && String(m.text || '').trim().length > 0);
    return cleaned.slice(-maxVisible).reverse();
  }, [messages, maxVisible]);

  useEffect(() => {
    if (data.length === 0 && typeof onLayoutHeight === 'function') {
      onLayoutHeight(0);
    }
  }, [data.length, onLayoutHeight]);

  if (data.length === 0) return null;

  // TikTok-style: the chat is a compact strip near the bottom — newest message
  // fully opaque, older ones progressively fading so they melt into the video
  // instead of covering it.
  const renderItem = ({ item, index }) => {
    const RowComponent = onPressUser ? Pressable : View;
    const rowProps = onPressUser
      ? { onPress: () => onPressUser(item), android_ripple: { color: 'rgba(255,255,255,0.12)', borderless: false } }
      : {};
    return (
      <RowComponent style={[styles.row, { opacity: Math.max(0.25, 1 - index * 0.14) }]} {...rowProps}>
        {item.avatar ? (
          <Image source={{ uri: item.avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarInitial} allowFontScaling={false}>
              {String(item.username || 'U').trim().charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.bubble}>
          <Text style={styles.line} allowFontScaling={false}>
            <Text style={styles.username}>{String(item.username || 'User')}</Text>
            <Text style={styles.sep}>{'  '}</Text>
            <Text style={styles.text}>{String(item.text || '')}</Text>
          </Text>
        </View>
      </RowComponent>
    );
  };

  // Hard cap: never taller than ~28% of the screen, and clip anything beyond it
  // (an inverted FlatList without clipping can expand past maxHeight on some RN
  // builds — that's what made the chat appear to cover the whole screen).
  const maxHeight = Math.round(winHeight * 0.28);

  return (
    <View
      style={[styles.container, { bottom: bottomInset, maxHeight }]}
      pointerEvents="box-none"
      onLayout={(e) => {
        if (typeof onLayoutHeight === 'function') {
          // Report real content height (not a forced empty 28% band).
          onLayoutHeight(e?.nativeEvent?.layout?.height || 0);
        }
      }}
    >
      <View style={{ maxHeight, overflow: 'hidden' }}>
      <FlatList
        data={data}
        inverted
        style={{ maxHeight, flexGrow: 0 }}
        keyExtractor={(item, index) => (item?.id != null ? String(item.id) : `msg-${index}`)}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        initialNumToRender={8}
        windowSize={3}
      />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 96, // keep clear of the right-side action rail / floating hearts
    zIndex: 40,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  listContent: {
    paddingTop: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 6,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  bubble: {
    flexShrink: 1,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  line: {
    flexShrink: 1,
  },
  username: {
    color: '#FFD54A',
    fontSize: 13,
    fontWeight: '800',
  },
  sep: {
    fontSize: 13,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
});
