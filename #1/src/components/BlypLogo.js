import React from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { responsiveFont, scalePadding } from '../utils/scaleUtils';

const BlypLogo = ({ style, textStyle, useGradientBackground = true, gradientColors = ['#a855f7', '#d946ef', '#ec4899'] }) => {
  if (useGradientBackground) {
    return (
      <View style={[defaultStyles.logoContainer, style]}>
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={defaultStyles.logoGradient}
        >
          <Text style={[defaultStyles.logoText, textStyle]}>Blyp</Text>
        </LinearGradient>
      </View>
    );
  }

  return (
    <View style={[defaultStyles.logoContainer, style]}>
      <Text style={[defaultStyles.logoTextOnly, textStyle]}>Blyp</Text>
    </View>
  );
};

const defaultStyles = {
  logoContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoGradient: {
    paddingHorizontal: scalePadding(8),
    paddingVertical: scalePadding(4),
    borderRadius: scalePadding(8),
  },
  logoText: {
    fontSize: responsiveFont(32),
    fontWeight: '800',
    textAlign: 'center',
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  logoTextOnly: {
    fontSize: responsiveFont(32),
    fontWeight: '800',
    textAlign: 'center',
    color: '#ffffff',
    textShadowColor: 'rgba(168, 85, 247, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  }
};

export default BlypLogo;