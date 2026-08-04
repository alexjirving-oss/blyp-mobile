// MatchdayReactions
//
// Collective reaction gauge + emoji storms. Sending a reaction hits the
// server's /economy/matchday/react which broadcasts via the Socket.io
// `matchday_event` channel to everyone in the room (including the sender), so
// every float originates from the same realtime path as live gifts.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import { sendMatchdayReaction } from '../../api/economyLiveApi';
import { logMatchdayEvent } from '../../services/matchdayAnalytics';

const EMOJIS = ['🔥', '⚽', '😱', '👏', '💚', '😡'];
const ACCENT = '#19D27C';

function FloatingEmoji({ emoji, leftPct, onDone }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 2200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => onDone?.());
  }, [progress, onDone]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -responsiveSize(170)] });
  const opacity = progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
  const scale = progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.6, 1.15, 0.9] });

  return (
    <Animated.Text
      style={[styles.float, { left: `${leftPct}%`, transform: [{ translateY }, { scale }], opacity }]}
      pointerEvents="none"
    >
      {emoji}
    </Animated.Text>
  );
}

export default function MatchdayReactions({ eventId, incoming }) {
  const [floats, setFloats] = useState([]);
  const gauge = useRef(new Animated.Value(0)).current;
  const intensityRef = useRef(0);
  const seqRef = useRef(0);

  // Decay the collective gauge so it reflects *recent* energy, not lifetime.
  useEffect(() => {
    const id = setInterval(() => {
      intensityRef.current = Math.max(0, intensityRef.current - 0.05);
      Animated.timing(gauge, { toValue: intensityRef.current, duration: 350, useNativeDriver: false }).start();
    }, 400);
    return () => clearInterval(id);
  }, [gauge]);

  const bump = (emoji) => {
    intensityRef.current = Math.min(1, intensityRef.current + 0.16);
    Animated.timing(gauge, { toValue: intensityRef.current, duration: 200, useNativeDriver: false }).start();
    const id = `${Date.now()}:${seqRef.current++}`;
    const leftPct = 8 + Math.random() * 78;
    setFloats((prev) => [...prev.slice(-24), { id, emoji, leftPct }]);
  };

  // Spawn a float for every inbound realtime reaction.
  useEffect(() => {
    if (incoming && incoming.type === 'matchday_reaction' && incoming.emoji) {
      bump(incoming.emoji);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  const removeFloat = (id) => setFloats((prev) => prev.filter((f) => f.id !== id));

  const send = async (emoji) => {
    try {
      logMatchdayEvent('reaction_send', { eventId, emoji });
      await sendMatchdayReaction({ eventId, emoji });
    } catch {
      // Optimistic fallback so the sender still sees their own reaction.
      bump(emoji);
    }
  };

  const widthInterpolate = gauge.interpolate({ inputRange: [0, 1], outputRange: ['4%', '100%'] });

  return (
    <View style={styles.wrap}>
      <View style={styles.overlay} pointerEvents="none">
        {floats.map((f) => (
          <FloatingEmoji key={f.id} emoji={f.emoji} leftPct={f.leftPct} onDone={() => removeFloat(f.id)} />
        ))}
      </View>

      <View style={styles.gaugeTrack}>
        <Animated.View style={[styles.gaugeFill, { width: widthInterpolate }]} />
      </View>
      <Text style={styles.gaugeLabel}>Crowd energy</Text>

      <View style={styles.bar}>
        {EMOJIS.map((e) => (
          <TouchableOpacity key={e} style={styles.emojiBtn} activeOpacity={0.7} onPress={() => send(e)}>
            <Text style={styles.emoji}>{e}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: responsiveSize(16) },
  overlay: {
    position: 'absolute',
    bottom: responsiveSize(60),
    left: 0,
    right: 0,
    height: responsiveSize(200),
  },
  float: { position: 'absolute', bottom: 0, fontSize: responsiveFont(28) },
  gaugeTrack: {
    height: responsiveSize(8),
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginTop: responsiveSize(6),
  },
  gaugeFill: { height: '100%', borderRadius: 999, backgroundColor: ACCENT },
  gaugeLabel: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: responsiveSize(4),
  },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: responsiveSize(10),
  },
  emojiBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: responsiveSize(8),
    marginHorizontal: responsiveSize(3),
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(12),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  emoji: { fontSize: responsiveFont(22) },
});
