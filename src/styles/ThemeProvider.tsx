/**
 * Blyp Theme Provider
 *
 * Provides the product theme to the whole app. Chrome is dark-only
 * (near-black #0A0A0C + PETRONAS teal / aqua). `useTheme()` returns a rich
 * theme object whose `.colors` and `.spacing` shape is backward-compatible
 * with the previous `blypTheme`.
 */
import React, { createContext, useCallback, useContext, useMemo } from 'react';
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
  // Product chrome is dark-only: PETRONAS teal + aqua on near-black (#0A0A0C).
  // Light / system preferences used to flip some screens to grey/white while
  // others stayed black — that mismatch is gone. setMode is kept for API
  // compatibility but always resolves to dark.
  const preference: ThemeMode = 'dark';
  const setMode = useCallback((_mode: ThemeMode) => {
    AsyncStorage.setItem(STORAGE_KEY, 'dark').catch(() => {});
  }, []);
  const toggleMode = useCallback(() => {
    setMode('dark');
  }, [setMode]);

  const value = useMemo(
    () => buildTheme('dark', preference, setMode, toggleMode),
    [preference, setMode, toggleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Reactive theme hook. Returns the active light/dark theme. */
export function useTheme(): BlypTheme {
  return useContext(ThemeContext);
}

/** Static default (dark) theme for non-React contexts. */
export { defaultTheme, darkScheme };
