import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { db } from '../../config/firebase';
import { COLORS } from '../../styles/theme';

/**
 * Bottom-left upward comment stream for For You (TikTok-style).
 * Newest at the bottom; older fade as they rise.
 */
export default function FeedCommentOverlay({
  postId,
  active = false,
  bottomInset = 96,
  maxVisible = 10,
  onCountChange,
}) {
  const { height: winHeight, width: winWidth } = useWindowDimensions();
  const [comments, setComments] = useState([]);

  useEffect(() => {
    if (!active || !postId || !db) {
      setComments([]);
      return undefined;
    }

    let unsub = null;
    try {
      unsub = db
        .collection('posts')
        .doc(String(postId))
        .collection('comments')
        .orderBy('createdAt', 'desc')
        .limit(40)
        .onSnapshot(
          (snapshot) => {
            const next = (snapshot?.docs || []).map((d) => {
              const data = d?.data?.() || {};
              return {
                id: d.id,
                username: data.username || data.displayName || 'User',
                text: String(data.text || '').trim(),
              };
            }).filter((c) => c.text.length > 0);
            setComments(next);
            try {
              onCountChange?.(String(postId), next.length);
            } catch {
              /* ignore */
            }
          },
          () => {
            setComments([]);
          }
        );
    } catch {
      setComments([]);
    }

    return () => {
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [active, postId, onCountChange]);

  const data = useMemo(() => {
    if (!Array.isArray(comments) || comments.length === 0) return [];
    return comments.slice(0, maxVisible);
  }, [comments, maxVisible]);

  if (!active || data.length === 0) return null;

  const maxHeight = Math.round(winHeight * 0.34);
  const maxWidth = Math.round(winWidth * 0.48);

  const renderItem = ({ item, index }) => (
    <View style={[styles.row, { opacity: Math.max(0.28, 1 - index * 0.12) }]}>
      <Text style={styles.line} allowFontScaling={false} numberOfLines={3}>
        <Text style={styles.username}>{item.username}</Text>
        <Text style={styles.sep}>{'  '}</Text>
        <Text style={styles.text}>{item.text}</Text>
      </Text>
    </View>
  );

  return (
    <View
      style={[styles.container, { bottom: bottomInset, maxHeight, width: maxWidth }]}
      pointerEvents="box-none"
    >
      <View style={{ maxHeight, overflow: 'hidden' }}>
        <FlatList
          data={data}
          inverted
          style={{ maxHeight, flexGrow: 0 }}
          keyExtractor={(item, index) => (item?.id != null ? String(item.id) : `c-${index}`)}
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
    left: 10,
    zIndex: 1100,
    elevation: 1100,
  },
  listContent: {
    paddingVertical: 4,
    justifyContent: 'flex-end',
  },
  row: {
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(10,10,12,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  line: {
    color: COLORS.white,
    fontSize: 13,
    lineHeight: 17,
  },
  username: {
    fontWeight: '800',
    color: COLORS.electric,
  },
  sep: {
    color: 'transparent',
  },
  text: {
    fontWeight: '500',
    color: 'rgba(255,255,255,0.92)',
  },
});
