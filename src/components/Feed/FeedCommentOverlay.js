import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { db } from '../../config/firebase';
import { COLORS } from '../../styles/theme';
import {
  LOOP_CAP,
  ROW_ESTIMATE,
  VISIBLE_ROWS,
  buildLoopItems,
  buildMarqueeRenderItems,
  dedupeCommentsById,
  shouldMarqueeLoop,
} from './feedCommentMarquee';

/** Pixels/sec — steady upward crawl. */
const SCROLL_PX_PER_SEC = 28;

/**
 * Bottom-left upward comment stream for For You / MediaViewer (TikTok-style).
 * Short viewport (~3–4 comments) with a continuous marquee loop of available
 * comments. Idle (hidden) when there are none.
 *
 * Important: the list is only duplicated for seamless wrap when the cycle is
 * tall enough that the clone starts at/below the clip edge — otherwise a
 * single comment would render as two stacked bubbles.
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
            const mapped = (snapshot?.docs || []).map((d) => {
              const data = d?.data?.() || {};
              return {
                id: d.id,
                username: data.username || data.displayName || 'User',
                text: String(data.text || '').trim(),
              };
            });
            const next = dedupeCommentsById(mapped);
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

  const loopItems = useMemo(() => buildLoopItems(comments, LOOP_CAP), [comments]);

  const viewportHeight = VISIBLE_ROWS * ROW_ESTIMATE;
  const cycleHeight = loopItems.length * ROW_ESTIMATE;
  const looping = shouldMarqueeLoop(loopItems.length, cycleHeight, viewportHeight);

  const renderItems = useMemo(
    () => buildMarqueeRenderItems(loopItems, looping),
    [loopItems, looping]
  );

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

    if (!active || !looping || cycleHeight <= 0) {
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
  }, [active, cycleHeight, looping, translateY]);

  if (!active || loopItems.length === 0) return null;

  const maxWidth = Math.round(winWidth * 0.48);

  return (
    <View
      style={[styles.container, { bottom: bottomInset, height: viewportHeight, width: maxWidth }]}
      pointerEvents="none"
    >
      <View style={[styles.clip, { height: viewportHeight }]}>
        <Animated.View style={{ transform: [{ translateY }] }}>
          {renderItems.map(({ item, key }) => (
            <View
              key={key}
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
