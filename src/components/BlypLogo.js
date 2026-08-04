import React from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { COLORS } from '../styles/theme';

/**
 * Kept for any importer expecting the old export.
 * @type {readonly [string, string, string]}
 */
export const BLYP_LOGO_GRADIENT_COLORS = [COLORS.primary, COLORS.primary, COLORS.primaryDark];

const LOGO_BASE = 26;
const LOGO_MIN = 24;
const LOGO_MAX = 28;

/**
 * Blyp wordmark — clean lowercase "blyp" with a single electric "pulse" dot.
 * Size is lightly responsive but capped so Fold cover/inner widths cannot
 * inflate the brand mark (was scaling to ~75–130px on 1080–1968 widths).
 */
const BlypLogo = ({ style, textStyle, useGradientBackground = true, gradientColors = undefined }) => {
  const { width } = useWindowDimensions();
  const scale = Math.min(1.08, Math.max(0.92, width / 390));
  const defaultSize = Math.round(Math.min(LOGO_MAX, Math.max(LOGO_MIN, LOGO_BASE * scale)));
  const size =
    textStyle && typeof textStyle.fontSize === 'number'
      ? Math.min(LOGO_MAX + 4, textStyle.fontSize)
      : defaultSize;
  const dot = Math.max(5, size * 0.16);
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-end' }, style]}>
      <Text
        allowFontScaling={false}
        style={[
          {
            fontSize: size,
            fontWeight: '800',
            letterSpacing: -size * 0.04,
            color: COLORS.textPrimary,
            includeFontPadding: false,
            lineHeight: Math.round(size * 1.05),
          },
          textStyle,
          // Keep size authoritative after textStyle merge so callers cannot
          // accidentally blow past the brand cap via responsiveFont().
          { fontSize: size, lineHeight: Math.round(size * 1.05) },
        ]}
      >
        blyp
      </Text>
      <View
        style={{
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: COLORS.primary,
          marginLeft: dot * 0.5,
          marginBottom: size * 0.16,
        }}
      />
    </View>
  );
};

export default BlypLogo;
