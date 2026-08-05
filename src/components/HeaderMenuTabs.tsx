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
  /**
   * Keys that stay pinned (always visible) on the left. Remaining tabs scroll.
   * Used on Home so "Home" stays reachable after For You-first landing when
   * interest topic pages overflow the strip.
   */
  pinnedKeys?: string[];
};

type TabButtonProps = {
  tab: HeaderMenuTab;
  isActive: boolean;
  onChange: (key: string) => void;
  testIDPrefix?: string;
  styles: ReturnType<typeof createStyles>;
  style?: object;
};

const TabButton: React.FC<TabButtonProps> = ({
  tab,
  isActive,
  onChange,
  testIDPrefix,
  styles,
  style,
}) => (
  <TouchableOpacity
    style={[styles.tab, style]}
    onPress={() => onChange(tab.key)}
    activeOpacity={0.7}
    testID={testIDPrefix ? `${testIDPrefix}_${tab.key}` : undefined}
    accessibilityLabel={testIDPrefix ? `${testIDPrefix}_${tab.key}` : undefined}
  >
    <View style={styles.pill}>
      <Text
        style={[styles.tabText, isActive && styles.activeTabText]}
        allowFontScaling={false}
        numberOfLines={1}
      >
        {tab.label}
      </Text>
    </View>
    <View style={[styles.indicator, isActive && styles.indicatorActive]} />
  </TouchableOpacity>
);

const HeaderMenuTabs: React.FC<Props> = ({
  tabs,
  activeKey,
  onChange,
  testIDPrefix,
  align = 'left',
  pinnedKeys,
}) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const safeTabs = tabs?.length ? tabs : [];
  const centered = align === 'center';

  const pinSet = useMemo(() => {
    if (!pinnedKeys?.length) return null;
    return new Set(pinnedKeys);
  }, [pinnedKeys]);

  const { pinned, scrollable } = useMemo(() => {
    if (!pinSet) return { pinned: [] as HeaderMenuTab[], scrollable: safeTabs };
    const pinnedList: HeaderMenuTab[] = [];
    const rest: HeaderMenuTab[] = [];
    // Preserve pinnedKeys order for the fixed strip.
    for (const key of pinnedKeys || []) {
      const tab = safeTabs.find((t) => t.key === key);
      if (tab) pinnedList.push(tab);
    }
    for (const tab of safeTabs) {
      if (!pinSet.has(tab.key)) rest.push(tab);
    }
    return { pinned: pinnedList, scrollable: rest };
  }, [safeTabs, pinSet, pinnedKeys]);

  if (pinned.length > 0) {
    return (
      <View style={[styles.tabContainer, styles.pinnedRow]}>
        <View style={styles.pinnedStrip}>
          {pinned.map((tab, index) => (
            <TabButton
              key={tab.key}
              tab={tab}
              isActive={activeKey === tab.key}
              onChange={onChange}
              testIDPrefix={testIDPrefix}
              styles={styles}
              style={index === pinned.length - 1 ? styles.tabPinnedLast : undefined}
            />
          ))}
        </View>
        {scrollable.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.scrollFlex}
            contentContainerStyle={styles.tabSelectorScroll}
          >
            {scrollable.map((tab, index) => (
              <TabButton
                key={tab.key}
                tab={tab}
                isActive={activeKey === tab.key}
                onChange={onChange}
                testIDPrefix={testIDPrefix}
                styles={styles}
                style={index === scrollable.length - 1 ? styles.tabLastCentered : undefined}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.tabContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.tabSelector, centered && styles.tabSelectorCenter]}
      >
        {safeTabs.map((tab, index) => {
          const isLast = index === safeTabs.length - 1;
          return (
            <TabButton
              key={tab.key}
              tab={tab}
              isActive={activeKey === tab.key}
              onChange={onChange}
              testIDPrefix={testIDPrefix}
              styles={styles}
              style={centered && isLast ? styles.tabLastCentered : undefined}
            />
          );
        })}
      </ScrollView>
    </View>
  );
};

const createStyles = (theme: BlypTheme) =>
  StyleSheet.create({
    tabContainer: { paddingBottom: 4 },
    pinnedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 16,
    },
    pinnedStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
    },
    tabPinnedLast: {
      marginRight: 12,
      paddingRight: 12,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: theme.colors.border || 'rgba(255,255,255,0.12)',
    },
    scrollFlex: { flex: 1 },
    tabSelectorScroll: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingRight: 16,
      paddingLeft: 4,
    },
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
