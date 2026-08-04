/**
 * Shared chrome for settings-style screens.
 * Applies safe-area top inset so headers clear the Android status bar
 * when the app runs edge-to-edge / translucent.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';

export default function SettingsScreenShell({
  navigation,
  title,
  children,
  scroll = true,
  contentContainerStyle,
}) {
  const insets = useSafeAreaInsets();
  const Body = scroll ? ScrollView : View;
  const bodyProps = scroll
    ? { contentContainerStyle: [styles.content, contentContainerStyle], showsVerticalScrollIndicator: false }
    : { style: [styles.contentFlex, contentContainerStyle] };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 0) }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="chevron-back" size={24} color="#F5F5F7" />
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={{ width: 32 }} />
      </View>
      <Body {...bodyProps}>{children}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0C' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backButton: { padding: 8 },
  title: { color: '#F5F5F7', fontSize: 18, fontWeight: '600' },
  content: { padding: 16, paddingBottom: 40 },
  contentFlex: { flex: 1, padding: 16 },
});
