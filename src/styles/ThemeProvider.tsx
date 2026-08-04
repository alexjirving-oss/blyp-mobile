/**
 * Blyp Theme Provider
 *
 * Provides a single, reactive theme to the whole app and powers light / dark /
 * system switching. `useTheme()` returns a rich theme object whose `.colors`
 * and `.spacing` shape is backward-compatible with the previous `blypTheme`,
 * so existing screens keep working while gaining live light/dark support.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SCHEMES,
  darkScheme,
  makeShadows,
  type ColorScheme,
  type ResolvedMode,
  type ThemeMode,
  type ShadowSet,
} from './designSystem/palettes';
import { RADIUS } from './designSystem/radius';
import { TYPE } from './designSystem/typography';

const STORAGE_KEY = '@blyp/themeMode';

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export interface BlypTheme {
  /** resolved mode actually being rendered */
  mode: ResolvedMode;
  isDark: boolean;
  /** user preference (may be 'system') */
  preference: ThemeMode;
  colors: ColorScheme;
  spacing: typeof SPACING;
  radius: typeof RADIUS;
  type: typeof TYPE;
  shadows: ShadowSet;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

function buildTheme(
  resolved: ResolvedMode,
  preference: ThemeMode,
  setMode: (m: ThemeMode) => void,
  toggleMode: () => void,
): BlypTheme {
  const colors = SCHEMES[resolved];
  return {
    mode: resolved,
    isDark: resolved === 'dark',
    preference,
    colors,
    spacing: SPACING,
    radius: RADIUS,
    type: TYPE,
    shadows: makeShadows(colors),
    setMode,
    toggleMode,
  };
}

// Default (used before the provider mounts / for any non-wrapped consumer):
// dark scheme, matching the app's historical look.
const defaultTheme = buildTheme('dark', 'system', () => {}, () => {});

const ThemeContext = createContext<BlypTheme>(defaultTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Blyp is a dark-first product: the entire app outside of the premium
  // themed screens is hard-coded to the dark palette. Defaulting to the OS
  // appearance made themed screens (e.g. the profile) flip to a white card on
  // devices set to light mode, clashing with the rest of the UI. Default to
  // dark and only switch when the user explicitly opts in via settings.
  const [preference, setPreference] = useState<ThemeMode>('dark');
  const [systemScheme, setSystemScheme] = useState<ResolvedMode>(
    (Appearance.getColorScheme() as ResolvedMode) || 'dark',
  );

  // Load persisted preference once.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (active && (saved === 'light' || saved === 'dark' || saved === 'system')) {
          setPreference(saved);
        }
      } catch {
        // ignore — fall back to system
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Track OS appearance changes (only matters when preference === 'system').
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme((colorScheme as ResolvedMode) || 'dark');
    });
    return () => sub.remove();
  }, []);

  const setMode = useCallback((mode: ThemeMode) => {
    setPreference(mode);
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  }, []);

  const resolved: ResolvedMode = preference === 'system' ? systemScheme : preference;

  const toggleMode = useCallback(() => {
    setMode(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setMode]);

  const value = useMemo(
    () => buildTheme(resolved, preference, setMode, toggleMode),
    [resolved, preference, setMode, toggleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Reactive theme hook. Returns the active light/dark theme. */
export function useTheme(): BlypTheme {
  return useContext(ThemeContext);
}

/** Static default (dark) theme for non-React contexts. */
export { defaultTheme, darkScheme };
