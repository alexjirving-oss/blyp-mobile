/**
 * Backward-compatible static theme.
 *
 * Historically this exported a hand-rolled `theme` object. It now points at the
 * unified design system's default (dark) theme so any module importing the
 * static `theme` keeps working. Prefer `useTheme()` (reactive light/dark) in
 * components; only use this for non-React / module-scope access.
 */
import { defaultTheme, type BlypTheme } from './ThemeProvider';

export const theme = defaultTheme;
export type { BlypTheme };
