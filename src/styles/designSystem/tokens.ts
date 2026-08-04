/**
 * Blyp Design System — Color Tokens
 *
 * Single source of truth for every colour in the app.
 * Import COLORS (or individual groups) instead of hardcoding hex values.
 *
 * Palette rationale:
 *   - Chrome/page use deep slate-blue for a luxury dark look
 *   - Card surfaces use translucent white for subtle glass layering
 *   - Brand accent is the existing purple→pink gradient (sparingly)
 *   - Text uses cool-neutral greys for readability
 */

// NOTE: Prefer `useTheme()` from '../ThemeProvider' for reactive light/dark
// colours. This flat token set mirrors the DARK scheme for any legacy/static
// importers and is kept in sync with designSystem/palettes.ts (darkScheme).
export const COLORS = {
    // ── Chrome + backgrounds (editorial near-black) ───────
    chrome: '#0A0A0C',                 // app chrome / header bg
    page: '#0A0A0C',                   // page / screen background
    surface: '#141418',                // raised surface for cards on dark bg
    card: '#121216',                   // card surface
    border: 'rgba(255,255,255,0.08)',  // subtle border
    divider: 'rgba(255,255,255,0.06)', // list dividers

    // ── Text (neutral zinc ramp) ─────────────────────────
    textPrimary: '#F5F5F7',
    textSecondary: '#A1A1AA',
    textMuted: '#71717A',
    textDisabled: '#52525B',

    // ── Brand accent (Mercedes-AMG PETRONAS teal) ───────
    brandA: '#00D2BE',
    brandB: '#00D2BE',
    brandC: '#00A89E',

    // ── Electric secondary accent (cyan highlight) ────────
    electric: '#67E8F9',

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
