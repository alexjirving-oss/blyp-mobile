import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const DEFAULT_REACTIONS = ['❤️', '😂', '🔥', '👏', '😮', '🎉'];

/**
 * Compact emoji reaction tray for live viewers. Docked above the bottom bar;
 * overflow is clipped so glyph edges never bleed off-screen as garbage pixels.
 */
export default function LiveReactionTray({ onReact, reactions = DEFAULT_REACTIONS, style }) {
  return (
    <View style={[styles.tray, style]} pointerEvents="box-none">
      {reactions.map((emoji) => (
        <TouchableOpacity
          key={emoji}
          style={styles.button}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
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
    maxWidth: '72%',
    gap: 0,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,12,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  button: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  emoji: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
  },
});
