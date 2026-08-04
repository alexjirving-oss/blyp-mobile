import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../styles/theme';

/**
 * Shared header chrome. Top padding comes ONLY from safe-area insets so every
 * tab (Home / Chat / Games / Profile) lands on the same baseline.
 */
export const HEADER_PADDING_TOP = 50;
export const HEADER_ICON_COLOR = '#D4D4D8';
/** Extra gap below the status bar / notch before chrome content. */
export const HEADER_CONTENT_GAP = 6;

const HeaderContainer = ({
  children,
  useOverlay = false,
  onLayout,
  paddingBottom = 1,
  testID = undefined,
  // Kept for call-site compatibility; insets are always used now.
  adaptiveTopPadding = false,
  headerPaddingTopOverride = undefined,
}) => {
  const insets = useSafeAreaInsets();
  const resolvedTopPadding =
    typeof headerPaddingTopOverride === 'number'
      ? headerPaddingTopOverride
      : Math.max(insets.top, 0) + HEADER_CONTENT_GAP;

  const headerStyle = [styles.header, { paddingTop: resolvedTopPadding, paddingBottom }];

  if (useOverlay) {
    return (
      <View style={styles.headerOverlay}>
        <View style={headerStyle} onLayout={onLayout} testID={testID} accessible={true} accessibilityLabel={testID}>
          {children}
        </View>
      </View>
    );
  }

  return (
    <View style={headerStyle} onLayout={onLayout} testID={testID} accessible={true} accessibilityLabel={testID}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#0A0A0C',
    paddingTop: HEADER_PADDING_TOP,
    paddingBottom: 1,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    elevation: 0,
    shadowOpacity: 0,
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
});

export default HeaderContainer;
