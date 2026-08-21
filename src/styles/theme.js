import { StyleSheet } from 'react-native';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';

// Common color palette — unified with the design system's DARK scheme
// (see src/styles/designSystem/palettes.ts). Keep these keys in sync with the
// dark scheme so legacy screens importing COLORS match the warm-night look.
export const COLORS = {
  // Brand signal — coral (CTA / LIVE / active chrome; sparingly)
  primary: '#FF4D6D',
  primaryDark: '#E83D5C',
  primaryLight: '#FF7A92',

  // Secondary stays on brand coral; warm taupe is the soft highlight via `electric`.
  secondary: '#FF4D6D',
  secondaryDark: '#E83D5C',
  secondaryLight: '#FF7A92',

  // Warm taupe secondary (demoted off neon cyan) + soft coral wash
  electric: '#C4B5A5',
  electricSoft: 'rgba(255,77,109,0.14)',
  glow: '#FF4D6D',

  // Background colors (warm charcoal)
  background: '#12141A',
  backgroundLight: '#1A1C24',
  backgroundCard: '#16181F',
  // Page background
  pageBackground: '#12141A',
  // Input / tab-strip surface
  tabStripBackground: 'rgba(236,234,240,0.06)',

  // Text colors (warm fog / muted)
  textPrimary: '#ECEAF0',
  textSecondary: '#9A97A6',
  textMuted: '#9A97A6',
  textDisabled: '#6B6878',

  // Status colors
  success: '#34D399',
  warning: '#FBBF24',
  error: '#FB7185',
  info: '#60A5FA',

  // Utility colors
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',

  // Gradient colors (coral; used sparingly)
  gradientStart: '#FF4D6D',
  gradientMiddle: '#FF4D6D',
  gradientEnd: '#E83D5C',

  // Screen background — flat warm charcoal (no neon wash).
  screenGradientTop: '#12141A',
  screenGradientMid: '#12141A',
  screenGradientBot: '#12141A',

  // Premium extras
  border: 'rgba(236,234,240,0.12)',
  borderStrong: 'rgba(236,234,240,0.20)',
  divider: 'rgba(236,234,240,0.08)',
  cardGlass: '#16181F',
  surface: '#1A1C24',
  surfaceAlt: '#22242E',
};

// Common spacing values
export const SPACING = {
  xs: responsiveSize(4),
  sm: responsiveSize(8),
  md: responsiveSize(16),
  lg: responsiveSize(24),
  xl: responsiveSize(32),
  xxl: responsiveSize(48),
};

// Common font sizes
export const FONT_SIZES = {
  xs: responsiveFont(10),
  sm: responsiveFont(12),
  md: responsiveFont(14),
  lg: responsiveFont(16),
  xl: responsiveFont(18),
  xxl: responsiveFont(24),
  xxxl: responsiveFont(32),
};

// Common border radius values
export const BORDER_RADIUS = {
  xs: responsiveSize(4),
  sm: responsiveSize(8),
  md: responsiveSize(12),
  lg: responsiveSize(16),
  xl: responsiveSize(24),
  round: responsiveSize(50),
};

// Soft layered depth + restrained coral tint (not neon)
export const SURFACE_DEPTH = {
  highlightBorder: 'rgba(255,255,255,0.12)',
  highlightBorderStrong: 'rgba(255,255,255,0.18)',
  sheen: 'rgba(255,255,255,0.10)',
  insetShadow: 'rgba(0,0,0,0.35)',
};

export const SHADOWS = {
  small: {
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  medium: {
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 11 },
    shadowOpacity: 0.26,
    shadowRadius: 18,
    elevation: 8,
  },
  large: {
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.32,
    shadowRadius: 28,
    elevation: 14,
  },
  glow: {
    shadowColor: COLORS.glow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 8,
  },
};

// Common component styles
export const COMMON_STYLES = StyleSheet.create({
  // Layout
  flex1: { flex: 1 },
  flexRow: { flexDirection: 'row' },
  flexColumn: { flexDirection: 'column' },
  center: { justifyContent: 'center', alignItems: 'center' },
  centerHorizontal: { alignItems: 'center' },
  centerVertical: { justifyContent: 'center' },
  spaceBetween: { justifyContent: 'space-between' },
  spaceAround: { justifyContent: 'space-around' },
  spaceEvenly: { justifyContent: 'space-evenly' },

  // Positioning
  absolute: { position: 'absolute' },
  relative: { position: 'relative' },

  // Background
  backgroundPrimary: { backgroundColor: COLORS.pageBackground },
  backgroundSecondary: { backgroundColor: COLORS.backgroundLight },
  backgroundCard: { backgroundColor: COLORS.backgroundCard },

  // Text styles
  textPrimary: { color: COLORS.textPrimary },
  textSecondary: { color: COLORS.textSecondary },
  textMuted: { color: COLORS.textMuted },
  textCenter: { textAlign: 'center' },
  textLeft: { textAlign: 'left' },
  textRight: { textAlign: 'right' },

  // Font weights
  fontLight: { fontWeight: '300' },
  fontRegular: { fontWeight: '400' },
  fontMedium: { fontWeight: '500' },
  fontSemiBold: { fontWeight: '600' },
  fontBold: { fontWeight: '700' },

  // Borders
  borderPrimary: { borderColor: COLORS.primary },
  borderSecondary: { borderColor: COLORS.secondary },
  borderLight: { borderColor: COLORS.backgroundLight },

  // Common padding
  paddingXs: { padding: SPACING.xs },
  paddingSm: { padding: SPACING.sm },
  paddingMd: { padding: SPACING.md },
  paddingLg: { padding: SPACING.lg },
  paddingXl: { padding: SPACING.xl },

  // Common margin
  marginXs: { margin: SPACING.xs },
  marginSm: { margin: SPACING.sm },
  marginMd: { margin: SPACING.md },
  marginLg: { margin: SPACING.lg },
  marginXl: { margin: SPACING.xl },

  // Common buttons
  button: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
  },

  buttonPrimary: {
    backgroundColor: COLORS.primary,
  },

  buttonSecondary: {
    backgroundColor: COLORS.secondary,
  },

  buttonOutline: {
    backgroundColor: COLORS.transparent,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },

  // Common cards — soft elevation + light edge highlight
  card: {
    backgroundColor: COLORS.backgroundCard,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: SURFACE_DEPTH.highlightBorder,
    ...SHADOWS.medium,
  },

  // Common inputs
  input: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
  },

  // Safe area
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.pageBackground,
  },

  // Loading state
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.pageBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// Canonical screen background — flat warm charcoal (no neon wash).
// Import this wherever a full-page background is needed.
export const SCREEN_GRADIENT_COLORS = ['#12141A', '#12141A', '#12141A'];

export default {
  COLORS,
  SPACING,
  FONT_SIZES,
  BORDER_RADIUS,
  SHADOWS,
  SURFACE_DEPTH,
  COMMON_STYLES,
};

