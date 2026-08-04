/**
 * Backward-compatible entry point for the theme hook.
 * The implementation now lives in ThemeProvider (reactive light/dark).
 */
export { useTheme } from './ThemeProvider';
export type { BlypTheme } from './ThemeProvider';
