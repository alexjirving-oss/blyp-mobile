import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const DEFAULT_REACTIONS = ['❤️', '🔥', '😂', '👏', '😮'];

/**
 * Soft reaction dock for live viewers — ink glass, no heavy pill chrome.
 */
export default function LiveReactionTray({ onReact, reactions = DEFAULT_REACTIONS, style }) {
  return (
    <View style={[styles.tray, style]} pointerEvents="box-none">
      {reactions.map((emoji) => (
        <TouchableOpacity
          key={emoji}
          style={styles.button}
          activeOpacity={0.65}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
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
    maxWidth: '64%',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(10,10,12,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  button: {
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  emoji: {
    fontSize: 17,
    lineHeight: 21,
    textAlign: 'center',
  },
});
