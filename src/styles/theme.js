import { StyleSheet } from 'react-native';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';

// Common color palette — unified with the design system's DARK scheme
// (see src/styles/designSystem/palettes.ts). Keep these keys in sync with the
// dark scheme so legacy screens importing COLORS match the new look.
export const COLORS = {
  // Brand signal accent — Mercedes-AMG PETRONAS teal (used sparingly)
  primary: '#00D2BE',
  primaryDark: '#00A89E',
  primaryLight: '#7FEDE2',

  // Secondary (kept on-brand). Cyan is the cool highlight via `electric`.
  secondary: '#00D2BE',
  secondaryDark: '#00A89E',
  secondaryLight: '#7FEDE2',

  // Electric cyan highlight + glow
  electric: '#67E8F9',
  electricSoft: 'rgba(103,232,249,0.14)',
  glow: '#00D2BE',

  // Background colors (editorial near-black, neutral)
  background: '#0A0A0C',
  backgroundLight: '#141418',
  backgroundCard: '#121216',
  // Page background
  pageBackground: '#0A0A0C',
  // Input / tab-strip surface
  tabStripBackground: 'rgba(255,255,255,0.06)',

  // Text colors (neutral zinc ramp)
  textPrimary: '#F5F5F7',
  textSecondary: '#A1A1AA',
  textMuted: '#71717A',
  textDisabled: '#52525B',

  // Status colors
  success: '#34D399',
  warning: '#FBBF24',
  error: '#FB7185',
  info: '#60A5FA',

  // Utility colors
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',

  // Gradient colors (kept on-brand; gradients are used minimally now)
  gradientStart: '#00D2BE',
  gradientMiddle: '#00D2BE',
  gradientEnd: '#00A89E',

  // Screen background — flat near-black (no colour wash).
  screenGradientTop: '#0A0A0C',
  screenGradientMid: '#0A0A0C',
  screenGradientBot: '#0A0A0C',

  // Premium extras
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  divider: 'rgba(255,255,255,0.06)',
  cardGlass: '#121216',
  surface: '#141418',
  surfaceAlt: '#1C1C22',
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

// Soft layered depth + restrained teal tint (not neon)
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

// Canonical screen background — flat near-black (editorial, no colour wash).
// Import this wherever a full-page background is needed.
export const SCREEN_GRADIENT_COLORS = ['#0A0A0C', '#0A0A0C', '#0A0A0C'];

export default {
  COLORS,
  SPACING,
  FONT_SIZES,
  BORDER_RADIUS,
  SHADOWS,
  SURFACE_DEPTH,
  COMMON_STYLES,
};

