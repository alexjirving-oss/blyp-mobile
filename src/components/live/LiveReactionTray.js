import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const DEFAULT_REACTIONS = ['❤️', '😂', '🔥', '👏', '😮'];

/**
 * Compact emoji reaction strip for live viewers — glass rail matching gift/games chrome.
 * Shorter glyph set + tighter padding to cut bottom clutter.
 */
export default function LiveReactionTray({ onReact, reactions = DEFAULT_REACTIONS, style }) {
  return (
    <View style={[styles.tray, style]} pointerEvents="box-none">
      {reactions.map((emoji) => (
        <TouchableOpacity
          key={emoji}
          style={styles.button}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 3, right: 3 }}
          onPress={() => onReact?.(emoji)}
          accessibilityRole="button"
          accessibilityLabel={`React ${emoji}`}
        >
          <Text style={styles.emoji} allowFontScaling={false}>
            {emoji}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '68%',
    gap: 0,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,12,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.28)',
    overflow: 'hidden',
  },
  button: {
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  emoji: {
    fontSize: 18,
    lineHeight: 22,
    textAlign: 'center',
  },
});
