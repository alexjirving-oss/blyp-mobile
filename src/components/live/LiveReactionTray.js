import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const DEFAULT_REACTIONS = ['❤️', '😂', '🔥', '👏', '😮', '🎉'];

/**
 * Compact emoji reaction tray for live viewers. Tapping an emoji invokes
 * `onReact(emoji)`, which the screen turns into a floating reaction burst.
 */
export default function LiveReactionTray({ onReact, reactions = DEFAULT_REACTIONS, style }) {
  return (
    <View style={[styles.tray, style]}>
      {reactions.map((emoji) => (
        <TouchableOpacity
          key={emoji}
          style={styles.button}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          onPress={() => onReact?.(emoji)}
        >
          <Text style={styles.emoji} allowFontScaling={false}>{emoji}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,12,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  button: {
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  emoji: {
    fontSize: 22,
  },
});
