import React, { useMemo, useEffect } from 'react';
import { View, Text, Image, FlatList, StyleSheet, useWindowDimensions, Pressable } from 'react-native';
import { pickPublicLabel } from '../../utils/publicLabel';

const TEAL = '#00D2BE';

/**
 * Cinematic live chat overlay — soft ink bubbles, teal handles.
 * Newest message at the bottom; older rows fade upward.
 */
export default function LiveChatOverlay({ messages = [], bottomInset = 0, maxVisible = 6, onPressUser, onLayoutHeight }) {
  const { height: winHeight } = useWindowDimensions();

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

  const renderItem = ({ item, index }) => {
    const username = pickPublicLabel(
      {
        username: item?.username,
        handle: item?.handle,
        displayName: item?.displayName,
        userName: item?.userName,
        name: item?.name,
      },
      { uid: item?.userId || item?.uid, fallback: item?.system ? 'Viewer' : 'User' },
    );
    const RowComponent = onPressUser ? Pressable : View;
    const rowProps = onPressUser
      ? { onPress: () => onPressUser(item), android_ripple: { color: 'rgba(0,210,190,0.18)', borderless: false } }
      : {};
    const fade = Math.max(0.28, 1 - index * 0.14);
    return (
      <RowComponent style={[styles.row, { opacity: fade }]} {...rowProps}>
        {item.avatar ? (
          <Image source={{ uri: item.avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarInitial} allowFontScaling={false}>
              {username.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.bubble}>
          <Text style={styles.line} allowFontScaling={false}>
            <Text style={styles.username}>{username}</Text>
            <Text style={styles.sep}>{'  '}</Text>
            <Text style={styles.text}>{String(item.text || '')}</Text>
          </Text>
        </View>
      </RowComponent>
    );
  };

  const maxHeight = Math.round(winHeight * 0.22);

  return (
    <View
      style={[styles.container, { bottom: bottomInset, maxHeight }]}
      pointerEvents="box-none"
      onLayout={(e) => {
        if (typeof onLayoutHeight === 'function') {
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
          initialNumToRender={6}
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
    right: 104,
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
    marginTop: 4,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginRight: 7,
    backgroundColor: 'rgba(10,10,12,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.4)',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,210,190,0.18)',
  },
  avatarInitial: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  bubble: {
    flexShrink: 1,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 14,
    borderBottomLeftRadius: 5,
    backgroundColor: 'rgba(10,10,12,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  line: {
    flexShrink: 1,
  },
  username: {
    color: TEAL,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.15,
  },
  sep: {
    fontSize: 12,
  },
  text: {
    color: 'rgba(255,255,255,0.94)',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 17,
  },
});
