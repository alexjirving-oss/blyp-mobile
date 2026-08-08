import React, { useMemo, useEffect } from 'react';
import { View, Text, Image, FlatList, StyleSheet, useWindowDimensions, Pressable } from 'react-native';
import { pickPublicLabel } from '../../utils/publicLabel';

const TEAL = '#00D2BE';

/**
 * Bottom-anchored live chat overlay (YouTube / TikTok Live style).
 *
 * Glass/teal Blyp chrome aligned with gift sheet + games picker.
 * Newest message sits at the bottom; older messages fade upward.
 */
export default function LiveChatOverlay({ messages = [], bottomInset = 0, maxVisible = 7, onPressUser, onLayoutHeight }) {
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
    return (
      <RowComponent style={[styles.row, { opacity: Math.max(0.32, 1 - index * 0.12) }]} {...rowProps}>
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

  const maxHeight = Math.round(winHeight * 0.24);

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
          initialNumToRender={7}
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
    right: 108,
    zIndex: 40,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  listContent: {
    paddingTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 5,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginRight: 7,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.28)',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  bubble: {
    flexShrink: 1,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(10,10,12,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  line: {
    flexShrink: 1,
  },
  username: {
    color: TEAL,
    fontSize: 12,
    fontWeight: '800',
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
