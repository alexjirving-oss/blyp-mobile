/**
 * Blyp Design System — Color Schemes (light + dark)
 *
 * SINGLE SOURCE OF TRUTH for every colour in the app.
 *
 * Both schemes share the exact same shape (`ColorScheme`) so screens can be
 * written once and render correctly in either mode. The shape is a superset:
 * it keeps every legacy key used by the old `theme.js` / `blypTheme.ts` so
 * existing screens keep working, and adds the new "bright / punchy / 3D"
 * tokens (electric secondary accent, brand + accent gradients, glow colours,
 * page gradient stops, scrims, strong borders).
 *
 * Brand language (product is dark-only in ThemeProvider):
 *   - Brand signal: Mercedes-AMG PETRONAS teal `#00D2BE`
 *   - Secondary accent: electric aqua/cyan `#67E8F9`
 *   - Page chrome: editorial near-black `#0A0A0C` (never mixed grey/black roots)
 *   - Raised surfaces: `#141418` / cards `#121216`
 */

export interface ColorScheme {
  /** background base (solid) */
  background: string;
  /** full-page gradient stops (top → mid → bottom) */
  bgGradient: [string, string, string];
  /** header / nav chrome (semi-translucent) */
  chrome: string;
  headerBackground: string;

  /** raised opaque surface (cards that need solid bg) */
  surface: string;
  surfaceAlt: string;
  /** translucent glass card surface (sits over gradient) */
  card: string;
  cardSurface: string;

  /** hairline / outline borders */
  border: string;
  borderStrong: string;
  divider: string;

  /** text ramp */
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  /** text/icon colour that sits on top of the brand gradient */
  onBrand: string;

  /** brand (purple) + legacy "accent" (pink) */
  primary: string;
  primaryDark: string;
  primaryLight: string;
  accent: string;

  /** brand gradient stops (legacy individual keys + convenience array) */
  gradientStart: string;
  gradientMiddle: string;
  gradientEnd: string;
  brandGradient: [string, string, string];

  /** NEW secondary accent: electric cyan/aqua + its gradient */
  electric: string;
  electricSoft: string;
  electricGradient: [string, string];

  /** status */
  success: string;
  warning: string;
  error: string;
  info: string;

  /** depth helpers */
  shadow: string;        // base drop-shadow colour
  glow: string;          // brand-coloured glow (CTAs)
  glowElectric: string;  // cyan glow (highlights)
  overlay: string;       // modal / scrim backdrop

  /** utility */
  white: string;
  black: string;
  transparent: string;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// "Pulse" — editorial near-black chrome + one electric signal accent.
// Philosophy: quiet, neutral surfaces; content brings the colour; the accent
// is a sparing "signal", never a wash. Designed dark-first for a young audience.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Brand signal accent — Mercedes-AMG PETRONAS teal. Black text sits on top.
const BRAND = '#00D2BE';
const BRAND_DIM = '#00A89E';
const BRAND_LIGHT = '#7FEDE2';

export const darkScheme: ColorScheme = {
  background: '#0A0A0C',
  bgGradient: ['#0A0A0C', '#0A0A0C', '#0A0A0C'],
  chrome: 'rgba(10,10,12,0.82)',
  headerBackground: '#0A0A0C',

  surface: '#141418',
  surfaceAlt: '#1C1C22',
  card: '#121216',
  cardSurface: '#15151B',

  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  divider: 'rgba(255,255,255,0.06)',

  textPrimary: '#F5F5F7',
  textSecondary: '#A1A1AA',
  textMuted: '#71717A',
  textDisabled: '#52525B',
  // Black text sits on the brand accent for maximum punch + legibility.
  onBrand: '#0A0A0C',

  primary: BRAND,
  primaryDark: BRAND_DIM,
  primaryLight: BRAND_LIGHT,
  accent: BRAND,

  gradientStart: BRAND,
  gradientMiddle: BRAND,
  gradientEnd: BRAND_DIM,
  brandGradient: [BRAND, BRAND, BRAND_DIM],

  electric: '#67E8F9',
  electricSoft: 'rgba(103,232,249,0.14)',
  electricGradient: ['#67E8F9', '#22D3EE'],

  success: '#34D399',
  warning: '#FBBF24',
  error: '#FB7185',
  info: '#60A5FA',

  shadow: '#000000',
  glow: BRAND,
  glowElectric: '#67E8F9',
  overlay: 'rgba(0,0,0,0.62)',

  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
};

// Light mode: readable deep teal drives accent text/icons on light surfaces.
const BRAND_TEXT = '#007A70';

export const lightScheme: ColorScheme = {
  background: '#FAFAFA',
  bgGradient: ['#FFFFFF', '#FAFAFA', '#FAFAFA'],
  chrome: 'rgba(255,255,255,0.82)',
  headerBackground: '#FFFFFF',

  surface: '#FFFFFF',
  surfaceAlt: '#F4F4F5',
  card: '#FFFFFF',
  cardSurface: '#FFFFFF',

  border: 'rgba(0,0,0,0.08)',
  borderStrong: 'rgba(0,0,0,0.14)',
  divider: 'rgba(0,0,0,0.06)',

  textPrimary: '#0A0A0C',
  textSecondary: '#52525B',
  textMuted: '#71717A',
  textDisabled: '#A1A1AA',
  onBrand: '#0A0A0C',

  primary: BRAND_TEXT,
  primaryDark: '#006058',
  primaryLight: BRAND,
  accent: BRAND_TEXT,

  gradientStart: BRAND,
  gradientMiddle: BRAND,
  gradientEnd: BRAND_DIM,
  brandGradient: [BRAND, BRAND, BRAND_DIM],

  electric: '#0E7490',
  electricSoft: 'rgba(14,116,144,0.10)',
  electricGradient: ['#22D3EE', '#0891B2'],

  success: '#059669',
  warning: '#D97706',
  error: '#E11D48',
  info: '#2563EB',

  shadow: '#000000',
  glow: BRAND,
  glowElectric: '#22D3EE',
  overlay: 'rgba(0,0,0,0.42)',

  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
};

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedMode = 'light' | 'dark';

export const SCHEMES: Record<ResolvedMode, ColorScheme> = {
  dark: darkScheme,
  light: lightScheme,
};

/**
 * Build a set of 3D-friendly shadow/elevation presets for a given scheme.
 * On iOS the coloured `glow` shadows render as soft neon halos; on Android
 * the monochrome `elevation` provides depth (shadow colour is approximated).
 */
export function makeShadows(c: ColorScheme) {
  return {
    none: {
      elevation: 0,
      shadowColor: c.shadow,
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
    },
    sm: {
      elevation: 4,
      shadowColor: c.shadow,
      shadowOpacity: 0.2,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
    },
    md: {
      elevation: 8,
      shadowColor: c.shadow,
      shadowOpacity: 0.26,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 11 },
    },
    lg: {
      elevation: 14,
      shadowColor: c.shadow,
      shadowOpacity: 0.32,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 18 },
    },
    /** restrained brand-tint lift for primary CTAs */
    glow: {
      elevation: 8,
      shadowColor: c.glow,
      shadowOpacity: 0.28,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
    },
    /** soft cyan tint for highlight/secondary elements */
    glowElectric: {
      elevation: 8,
      shadowColor: c.glowElectric,
      shadowOpacity: 0.24,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
    },
  } as const;
}

/** Light edge / top sheen for raised surfaces (cards, pills, sheets). */
export const SURFACE_DEPTH = {
  highlightBorder: 'rgba(255,255,255,0.12)',
  highlightBorderStrong: 'rgba(255,255,255,0.18)',
  sheen: 'rgba(255,255,255,0.10)',
  insetShadow: 'rgba(0,0,0,0.35)',
} as const;

export type ShadowSet = ReturnType<typeof makeShadows>;

