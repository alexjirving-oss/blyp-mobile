import React from 'react';
import { 
  View, 
  StyleSheet, 
  SafeAreaView, 
  StatusBar, 
  Platform
} from 'react-native';

/**
 * ScreenContainer - A consistent screen wrapper with proper SafeArea handling
 * 
 * This component provides consistent screen layout across the app by:
 * 1. Using SafeAreaView for proper insets on iOS/Android
 * 2. Setting consistent status bar styling
 * 3. Handling edge cases with notches/cutouts
 * 
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Screen content
 * @param {Object} props.style - Additional styles for the container
 * @param {boolean} props.noSafeArea - Whether to disable SafeAreaView (useful for screens with custom headers)
 * @param {string} props.statusBarColor - Custom status bar color (default: '#0f172a')
 * @param {string} props.barStyle - Status bar style ('light-content' or 'dark-content')
 */
const ScreenContainer = ({ 
  children, 
  style, 
  noSafeArea = false,
  statusBarColor = '#0f172a',
  barStyle = 'light-content'
}) => {
  // Use regular View if noSafeArea is true
  const Container = noSafeArea ? View : SafeAreaView;
  
  return (
    <Container style={[styles.container, style]}>
      <StatusBar 
        barStyle={barStyle} 
        backgroundColor={statusBarColor}
        translucent={Platform.OS === 'android'} 
      />
      {children}
    </Container>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    // Add padding for Android when using translucent status bar
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  }
});

export default ScreenContainer;