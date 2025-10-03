import { StyleSheet } from 'react-native';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';

// Common color palette
export const COLORS = {
  // Primary colors
  primary: '#a855f7',
  primaryDark: '#9333ea',
  primaryLight: '#c084fc',
  
  // Secondary colors
  secondary: '#ec4899',
  secondaryDark: '#db2777',
  secondaryLight: '#f472b6',
  
  // Background colors
  background: '#0f172a',
  backgroundLight: '#1e293b',
  backgroundCard: '#334155',
  
  // Text colors
  textPrimary: '#ffffff',
  textSecondary: '#e2e8f0',
  textMuted: '#94a3b8',
  textDisabled: '#64748b',
  
  // Status colors
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
  
  // Utility colors
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
  
  // Gradient colors
  gradientStart: '#a855f7',
  gradientMiddle: '#d946ef',
  gradientEnd: '#ec4899',
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

// Shadow styles
export const SHADOWS = {
  small: {
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  medium: {
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  large: {
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
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
  backgroundPrimary: { backgroundColor: COLORS.background },
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
  
  // Common cards
  card: {
    backgroundColor: COLORS.backgroundCard,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
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
    backgroundColor: COLORS.background,
  },
  
  // Loading state
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    ...COMMON_STYLES.center,
  },
});

export default {
  COLORS,
  SPACING,
  FONT_SIZES,
  BORDER_RADIUS,
  SHADOWS,
  COMMON_STYLES,
};