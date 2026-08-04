import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import Icon from '../components/Icon';
import SettingsScreenShell from '../components/SettingsScreenShell';

const SUPPORT_EMAIL = 'support@blyp.app';

const HelpSupportScreen = ({ navigation }) => {
  const openMail = async () => {
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Blyp support')}`;
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) {
        Alert.alert('Email unavailable', `Write to ${SUPPORT_EMAIL}`);
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert('Email unavailable', `Write to ${SUPPORT_EMAIL}`);
    }
  };

  return (
    <SettingsScreenShell navigation={navigation} title="Help & Support">
      <Text style={styles.sectionTitle}>Get help</Text>
      <TouchableOpacity
        style={styles.actionRow}
        onPress={openMail}
        accessibilityRole="button"
        accessibilityLabel="Email support"
      >
        <Icon name="mail-outline" size={22} color="#A1A1AA" />
        <View style={styles.rowText}>
          <Text style={styles.actionText}>Email support</Text>
          <Text style={styles.subtitle}>{SUPPORT_EMAIL}</Text>
        </View>
      </TouchableOpacity>

      <Text style={styles.footnote}>
        Include your Blyp username and a short description of the issue. We do not ask for your
        password by email.
      </Text>
    </SettingsScreenShell>
  );
};

const styles = StyleSheet.create({
  sectionTitle: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  actionRow: {
    backgroundColor: '#141418',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowText: { flex: 1 },
  actionText: { color: '#F5F5F7', fontSize: 16, fontWeight: '500' },
  subtitle: { color: '#A1A1AA', fontSize: 13, marginTop: 4 },
  footnote: { color: '#52525B', fontSize: 12, lineHeight: 18, marginTop: 16 },
});

export default HelpSupportScreen;
