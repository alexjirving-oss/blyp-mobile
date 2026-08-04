import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../styles/useTheme';
import type { BlypTheme } from '../styles/blypTheme';

export type HeaderMenuTab = {
  key: string;
  label: string;
};

type Props = {
  tabs: HeaderMenuTab[];
  activeKey: string;
  onChange: (key: string) => void;
  /** Optional prefix for deterministic testIDs on each tab button (e.g. "blyp_tab") */
  testIDPrefix?: string;
  /** Horizontal alignment of the tab row. 'center' centers them (still scrollable
   * if they overflow); 'left' keeps the original left-aligned layout. */
  align?: 'left' | 'center';
};

const HeaderMenuTabs: React.FC<Props> = ({ tabs, activeKey, onChange, testIDPrefix, align = 'left' }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const safeTabs = tabs?.length ? tabs : [];
  const centered = align === 'center';

  return (
    <View style={styles.tabContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.tabSelector, centered && styles.tabSelectorCenter]}
      >
        {safeTabs.map((tab, index) => {
          const isActive = activeKey === tab.key;
          const isLast = index === safeTabs.length - 1;
          const label = (
            <Text
              style={[styles.tabText, isActive && styles.activeTabText]}
              allowFontScaling={false}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
          );

          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, centered && isLast && styles.tabLastCentered]}
              onPress={() => onChange(tab.key)}
              activeOpacity={0.7}
              testID={testIDPrefix ? `${testIDPrefix}_${tab.key}` : undefined}
              accessibilityLabel={testIDPrefix ? `${testIDPrefix}_${tab.key}` : undefined}
            >
              <View style={styles.pill}>{label}</View>
              <View style={[styles.indicator, isActive && styles.indicatorActive]} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const createStyles = (theme: BlypTheme) =>
  StyleSheet.create({
    tabContainer: { paddingBottom: 4 },
    tabSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
    },
    // When centered, let the content fill the width and center horizontally; it
    // still scrolls if the tabs ever overflow the available space.
    tabSelectorCenter: {
      flexGrow: 1,
      justifyContent: 'center',
    },
    tab: {
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 22,
    },
    // Drop the trailing margin on the last tab so the row is visually centered.
    tabLastCentered: {
      marginRight: 0,
    },
    pill: {
      paddingVertical: 8,
    },
    // The underline hugs the label width (alignSelf stretch) so it lines up under
    // "Live" and "Your Blyp" alike, instead of a fixed stub that floats off-centre.
    indicator: {
      height: 3,
      alignSelf: 'stretch',
      borderRadius: 3,
      marginTop: 1,
      backgroundColor: 'transparent',
    },
    indicatorActive: {
      backgroundColor: theme.colors.primary,
    },
    tabText: {
      color: theme.colors.textMuted,
      fontSize: 14,
      fontWeight: '600',
      letterSpacing: -0.2,
      includeFontPadding: false,
      textAlignVertical: 'center',
      lineHeight: 20,
    },
    activeTabText: { color: theme.colors.textPrimary, fontWeight: '700' },
  });

export default HeaderMenuTabs;
