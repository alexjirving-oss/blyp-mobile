import React from 'react';
import { Platform, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../styles/ThemeProvider';

/**
 * ScreenContainer - A consistent screen wrapper with proper SafeArea handling
 *
 * Uses safe-area insets (not RN SafeAreaView) so Android edge-to-edge /
 * translucent status bars get a real top offset.
 */
const ScreenContainer = ({
  children,
  style = undefined,
  noSafeArea = false,
  statusBarColor = undefined,
  barStyle = undefined,
}) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const topPad = noSafeArea
    ? 0
    : Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0);

  return (
    <LinearGradient
      colors={colors.bgGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
    >
      <View style={[styles.container, { paddingTop: topPad }, style]}>
        <StatusBar
          barStyle={barStyle || (isDark ? 'light-content' : 'dark-content')}
          backgroundColor={statusBarColor || colors.bgGradient[0]}
          translucent={Platform.OS === 'android'}
        />
        {children}
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  }
});

export default ScreenContainer;

