import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { db } from '../../config/firebase';
import { COLORS } from '../../styles/theme';

/** Visible comment slots (~3–4 high, not a tall column). */
const VISIBLE_ROWS = 4;
/** Approx row height incl. margin (1–2 lines; matches styles below). */
const ROW_ESTIMATE = 48;
/** Max comments pulled into the marquee cycle. */
const LOOP_CAP = 24;
/** Pixels/sec — steady upward crawl. */
const SCROLL_PX_PER_SEC = 28;

/**
 * Bottom-left upward comment stream for For You / MediaViewer (TikTok-style).
 * Short viewport (~3–4 comments) with a continuous marquee loop of available
 * comments. Idle (hidden) when there are none.
 */
export default function FeedCommentOverlay({
  postId,
  active = false,
  bottomInset = 96,
  onCountChange,
}) {
  const { width: winWidth } = useWindowDimensions();
  const [comments, setComments] = useState([]);
  const translateY = useRef(new Animated.Value(0)).current;
  const animRef = useRef(null);

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
            const next = (snapshot?.docs || [])
              .map((d) => {
                const data = d?.data?.() || {};
                return {
                  id: d.id,
                  username: data.username || data.displayName || 'User',
                  text: String(data.text || '').trim(),
                };
              })
              .filter((c) => c.text.length > 0);
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

  // Chronological for the rise (oldest first → newest); cap for perf.
  const loopItems = useMemo(() => {
    if (!Array.isArray(comments) || comments.length === 0) return [];
    return comments.slice(0, LOOP_CAP).slice().reverse();
  }, [comments]);

  const viewportHeight = VISIBLE_ROWS * ROW_ESTIMATE;

  // Duplicate once so translateY can wrap seamlessly across one cycle.
  const renderItems = useMemo(() => {
    if (loopItems.length === 0) return [];
    // With few comments, still duplicate so the loop has travel distance.
    return [...loopItems, ...loopItems];
  }, [loopItems]);

  const cycleHeight = loopItems.length * ROW_ESTIMATE;

  useEffect(() => {
    if (animRef.current) {
      try {
        animRef.current.stop();
      } catch {
        /* ignore */
      }
      animRef.current = null;
    }
    translateY.setValue(0);

    if (!active || cycleHeight <= 0 || loopItems.length === 0) {
      return undefined;
    }

    // One comment: show idle (no pointless spin). Two+ always loop.
    if (loopItems.length < 2) {
      return undefined;
    }

    const duration = Math.max(4000, Math.round((cycleHeight / SCROLL_PX_PER_SEC) * 1000));

    const run = () => {
      translateY.setValue(0);
      animRef.current = Animated.timing(translateY, {
        toValue: -cycleHeight,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      animRef.current.start(({ finished }) => {
        if (finished) run();
      });
    };
    run();

    return () => {
      if (animRef.current) {
        try {
          animRef.current.stop();
        } catch {
          /* ignore */
        }
        animRef.current = null;
      }
    };
  }, [active, cycleHeight, loopItems.length, translateY, viewportHeight]);

  if (!active || loopItems.length === 0) return null;

  const maxWidth = Math.round(winWidth * 0.48);

  return (
    <View
      style={[styles.container, { bottom: bottomInset, height: viewportHeight, width: maxWidth }]}
      pointerEvents="none"
    >
      <View style={[styles.clip, { height: viewportHeight }]}>
        <Animated.View style={{ transform: [{ translateY }] }}>
          {renderItems.map((item, index) => (
            <View
              key={`${item.id}-${index}`}
              style={[styles.row, { height: ROW_ESTIMATE - 6 }]}
            >
              <Text style={styles.line} allowFontScaling={false} numberOfLines={2}>
                <Text style={styles.username}>{item.username}</Text>
                <Text style={styles.sep}>{'  '}</Text>
                <Text style={styles.text}>{item.text}</Text>
              </Text>
            </View>
          ))}
        </Animated.View>
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
  clip: {
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  row: {
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(10,10,12,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
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
