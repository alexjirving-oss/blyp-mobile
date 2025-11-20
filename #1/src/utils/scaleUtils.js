import { Dimensions, PixelRatio } from 'react-native';

// Get screen dimensions with fallback
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// Base dimensions for scaling calculations
const baseWidth = 375; // iPhone 11 Pro width
const baseHeight = 812; // iPhone 11 Pro height

// Standard scaling functions with safety checks
export const responsiveFont = (size) => {
  if (typeof size !== 'number' || isNaN(size) || size <= 0) {
    return 16; // Default font size fallback
  }
  if (!screenWidth || screenWidth <= 0 || !baseWidth) {
    return size; // Return original size if screen dimensions not available
  }
  const scale = screenWidth / baseWidth;
  const scaledSize = size * scale;
  return Math.round(PixelRatio.roundToNearestPixel(scaledSize));
};

export const responsiveSize = (size) => {
  if (typeof size !== 'number' || isNaN(size)) {
    return 0; // Default size fallback
  }
  if (!screenWidth || screenWidth <= 0 || !baseWidth) {
    return size; // Return original size if screen dimensions not available
  }
  const scale = screenWidth / baseWidth;
  const scaledSize = size * scale;
  return Math.round(PixelRatio.roundToNearestPixel(scaledSize));
};

// Percentage-based responsive functions with safety checks
export const responsiveWidth = (percentage) => {
  if (typeof percentage !== 'number' || isNaN(percentage) || !screenWidth) {
    return 100; // Default width fallback
  }
  return (screenWidth * percentage) / 100;
};

export const responsiveHeight = (percentage) => {
  if (typeof percentage !== 'number' || isNaN(percentage) || !screenHeight) {
    return 100; // Default height fallback
  }
  return (screenHeight * percentage) / 100;
};

// Semantic scaling aliases for better code readability
export const scaleFont = responsiveFont;
export const scalePadding = responsiveSize;
export const scaleMargin = responsiveSize;
export const scaleIcon = responsiveSize;
export const scaleBorder = responsiveSize;

// Common scaled dimensions for consistent UI
export const getScaledDimensions = () => ({
  buttonHeight: responsiveSize(48),
  inputHeight: responsiveSize(44),
  headerHeight: responsiveSize(120),
  tabBarHeight: responsiveSize(88),
  cardPadding: responsiveSize(16),
  sectionMargin: responsiveSize(20),
  borderRadius: responsiveSize(12),
  avatarSize: responsiveSize(50),
  iconSize: responsiveSize(24),
});

// Export basic configuration for components that need it
export const scalingConfig = {
  screenWidth,
  screenHeight,
};

// Default export with all functions
export default {
  responsiveFont,
  responsiveSize,
  responsiveWidth,
  responsiveHeight,
  scaleFont,
  scalePadding,
  scaleMargin,
  scaleIcon,
  scaleBorder,
  getScaledDimensions,
  scalingConfig,
};