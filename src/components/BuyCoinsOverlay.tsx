import React, { useMemo } from 'react';
import { Modal, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BlypLogo, { BLYP_LOGO_GRADIENT_COLORS } from './BlypLogo';
import Icon from './Icon';
import CoinStoreScreen from '../screens/CoinStoreScreen';
import { useTheme } from '../styles/useTheme';
import type { BlypTheme } from '../styles/blypTheme';

type Props = {
  visible: boolean;
  onClose: () => void;
  requiredCoins: number;
  currentCoins: number;
  title?: string;
  navigation?: any;
};

export default function BuyCoinsOverlay({
  visible,
  onClose,
  requiredCoins,
  currentCoins,
  title,
  navigation,
}: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const missing = useMemo(() => {
    const req = Number(requiredCoins || 0);
    const cur = Number(currentCoins || 0);
    return Math.max(0, req - cur);
  }, [requiredCoins, currentCoins]);

  const headerTitle = title || 'Buy Coins';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <Icon name="close" size={24} color={theme.colors.textPrimary} strokeWidth={1.5} style={{}} />
            </TouchableOpacity>

            <View style={styles.headerCenter}>
              <BlypLogo style={{}} textStyle={{}} useGradientBackground />
            </View>

            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.summary}>
            <Text style={styles.title}>{headerTitle}</Text>
            <Text style={styles.subtitle}>
              You need {Number(requiredCoins || 0).toLocaleString()} coins. You have {Number(currentCoins || 0).toLocaleString()}.
            </Text>

            {missing > 0 ? (
              <View style={styles.missingPill}>
                <LinearGradient
                  colors={BLYP_LOGO_GRADIENT_COLORS}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.missingPillGrad}
                >
                  <Text style={styles.missingText}>Missing {missing.toLocaleString()} coins</Text>
                </LinearGradient>
              </View>
            ) : null}
          </View>

          <View style={styles.content}>
            <CoinStoreScreen navigation={navigation ?? ({} as any)} embedded initialTab="coins" scrollToPackagesOnMount />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(theme: BlypTheme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    sheet: {
      height: '92%',
      backgroundColor: theme.colors.background,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 8,
      backgroundColor: theme.colors.background,
    },
    closeBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerSpacer: {
      width: 44,
      height: 44,
    },
    summary: {
      paddingHorizontal: 16,
      paddingBottom: 10,
    },
    title: {
      color: theme.colors.textPrimary,
      fontSize: 18,
      fontWeight: '800',
      textAlign: 'center',
      marginTop: 4,
    },
    subtitle: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      textAlign: 'center',
      marginTop: 6,
    },
    missingPill: {
      alignSelf: 'center',
      marginTop: 10,
      borderRadius: 999,
      overflow: 'hidden',
    },
    missingPillGrad: {
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    missingText: {
      color: theme.colors.onBrand,
      fontSize: 13,
      fontWeight: '800',
      textAlign: 'center',
    },
    content: {
      flex: 1,
    },
  });
}
