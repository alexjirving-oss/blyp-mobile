/**
 * Blyp Design System — Color Tokens
 *
 * Flat token set mirroring designSystem/palettes.ts (darkScheme).
 * Prefer `useTheme()` from '../ThemeProvider' for reactive colours.
 * Keep in sync with darkScheme (black canvas + pink #FF2D55).
 */

export const COLORS = {
    // ── Chrome + backgrounds (true black) ──────────────
    chrome: '#000000',
    page: '#000000',
    surface: '#141416',
    card: '#121214',
    border: 'rgba(236,234,240,0.12)',
    divider: 'rgba(236,234,240,0.08)',

    // ── Text ──────────────────────────────────────────
    textPrimary: '#FFFFFF',
    textSecondary: '#A1A1AA',
    textMuted: '#8E8E93',
    textDisabled: '#636366',

    // ── Brand accent (pink — sparingly) ───────────────
    brandA: '#FF2D55',
    brandB: '#FF2D55',
    brandC: '#E01E45',

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
