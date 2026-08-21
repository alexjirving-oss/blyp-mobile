// YourBlypScreen.js
//
// Full-screen shell for the personal recap. The recap body is also reused in
// the Chat/Games surface, so navigation and data remain in one place.

import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import YourBlypContent from '../components/YourBlyp/YourBlypContent';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';

const YourBlypScreen = ({ navigation }) => {
  const goBack = useCallback(() => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation?.navigate?.('MainTabs');
  }, [navigation]);

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backButton}
            onPress={goBack}
            activeOpacity={0.78}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="chevron-back" size={21} color={COLORS.textPrimary} />
          </TouchableOpacity>

          <View style={styles.titleWrap}>
            <Text style={styles.eyebrow}>PERSONAL RECAP</Text>
            <Text style={styles.title}>Your Blyp</Text>
          </View>

          <View style={styles.signalMark}>
            <Icon name="pulse" size={19} color={COLORS.primary} />
          </View>
        </View>

        <View style={styles.headerRule} />
        <YourBlypContent navigation={navigation} />
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: responsiveSize(5),
  },
  header: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: responsiveSize(14),
    paddingVertical: responsiveSize(9),
  },
  backButton: {
    width: responsiveSize(42),
    height: responsiveSize(42),
    borderRadius: responsiveSize(14),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  titleWrap: {
    flex: 1,
    paddingHorizontal: responsiveSize(13),
  },
  eyebrow: {
    color: COLORS.primary,
    fontSize: responsiveFont(8),
    fontWeight: '900',
    letterSpacing: 1.35,
  },
  title: {
    marginTop: responsiveSize(2),
    color: COLORS.textPrimary,
    fontSize: responsiveFont(20),
    lineHeight: responsiveFont(24),
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  signalMark: {
    width: responsiveSize(42),
    height: responsiveSize(42),
    borderRadius: responsiveSize(14),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 45, 85,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 45, 85,0.22)',
  },
  headerRule: {
    width: '100%',
    height: 1,
    marginBottom: responsiveSize(3),
    backgroundColor: COLORS.divider,
  },
});

export default YourBlypScreen;
