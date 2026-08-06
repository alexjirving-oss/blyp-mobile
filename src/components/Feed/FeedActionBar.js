import React from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Horizontal engagement chrome for For You / MediaViewer.
 *
 * Sits across the bottom of the video frame, above the app tab bar (Home) or
 * the home-indicator safe inset (fullscreen MediaViewer). Children are the
 * like / comment / share / gift / open controls, evenly spaced.
 *
 * Ring + count stack is ~66px; padding brings the strip to FEED_ACTION_BAR_HEIGHT.
 */
export const FEED_ACTION_BAR_HEIGHT = 72;

/** Comment marquee / hearts sit just above this bar. */
export function feedOverlayBottomInset(chromeBottom) {
  return Math.max(0, Number(chromeBottom) || 0) + FEED_ACTION_BAR_HEIGHT + 8;
}

export default function FeedActionBar({
  children,
  bottomOffset = 0,
  style,
  pointerEvents = 'box-none',
}) {
  return (
    <View
      style={[styles.bar, { bottom: bottomOffset }, style]}
      pointerEvents={pointerEvents}
    >
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 2,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-evenly',
    width: '100%',
  },
});
