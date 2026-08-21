/**
 * Blyp Design System — Color Tokens
 *
 * Flat token set mirroring designSystem/palettes.ts (darkScheme).
 * Prefer `useTheme()` from '../ThemeProvider' for reactive colours.
 * Keep in sync with darkScheme (warm night: charcoal + coral sparingly).
 */

export const COLORS = {
    // ── Chrome + backgrounds (warm charcoal) ──────────────
    chrome: '#12141A',                 // app chrome / header bg
    page: '#12141A',                   // page / screen background
    surface: '#1A1C24',                // raised surface for cards on dark bg
    card: '#16181F',                   // card surface
    border: 'rgba(236,234,240,0.12)',  // subtle border
    divider: 'rgba(236,234,240,0.08)', // list dividers

    // ── Text (warm fog / muted) ───────────────────────────
    textPrimary: '#ECEAF0',
    textSecondary: '#9A97A6',
    textMuted: '#9A97A6',
    textDisabled: '#6B6878',

    // ── Brand accent (coral — sparingly) ──────────────────
    brandA: '#FF4D6D',
    brandB: '#FF4D6D',
    brandC: '#E83D5C',

    // ── Secondary (warm taupe; demoted off neon cyan) ─────
    electric: '#C4B5A5',

    // ── Status ────────────────────────────────────────────
    success: '#34D399',
    warning: '#FBBF24',
    danger: '#FB7185',
    info: '#60A5FA',

    // ── Misc ──────────────────────────────────────────────
    white: '#ffffff',
    black: '#000000',
    transparent: 'transparent',
} as const;

export const BRAND_GRADIENT = [COLORS.brandA, COLORS.brandB, COLORS.brandC] as const;
