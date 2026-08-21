/**
 * Blyp Design System — Color Schemes (light + dark)
 *
 * SINGLE SOURCE OF TRUTH for every colour in the app.
 *
 * Both schemes share the exact same shape (`ColorScheme`) so screens can be
 * written once and render correctly in either mode. The shape is a superset:
 * it keeps every legacy key used by the old `theme.js` / `blypTheme.ts` so
 * existing screens keep working, and adds secondary accent / gradient / glow
 * tokens (page gradient stops, scrims, strong borders).
 *
 * Brand language (product is dark-only in ThemeProvider) — warm night, aligned
 * to blyp.world `:root` (`apps/blyp-world/app/globals.css`):
 *   - Brand signal: coral `#FF4D6D` (CTA / LIVE / active chrome — sparingly)
 *   - Secondary: warm taupe `#C4B5A5` (demoted off neon cyan)
 *   - Page chrome: warm charcoal `#12141A`
 *   - Raised surfaces: `#1A1C24` / cards `#16181F`
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

  /** Secondary accent (warm taupe) + soft wash — not neon cyan */
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
  glowElectric: string;  // secondary warm glow (highlights)
  overlay: string;       // modal / scrim backdrop

  /** utility */
  white: string;
  black: string;
  transparent: string;
}

// Warm night — charcoal surfaces; coral is a sparing signal (CTA / LIVE / active).
// Aligned to web `--blyp-*` in apps/blyp-world/app/globals.css.

const BRAND = '#FF4D6D';
const BRAND_DIM = '#E83D5C';
const BRAND_LIGHT = '#FF7A92';
/** Demoted secondary (was neon cyan); matches web `--blyp-teal`. */
const WARM_TAUPE = '#C4B5A5';
const WARM_TAUPE_DIM = '#A89888';

export const darkScheme: ColorScheme = {
  background: '#12141A',
  bgGradient: ['#12141A', '#12141A', '#12141A'],
  chrome: 'rgba(18,20,26,0.92)',
  headerBackground: '#12141A',

  surface: '#1A1C24',
  surfaceAlt: '#22242E',
  card: '#16181F',
  cardSurface: '#1A1C24',

  border: 'rgba(236,234,240,0.12)',
  borderStrong: 'rgba(236,234,240,0.20)',
  divider: 'rgba(236,234,240,0.08)',

  textPrimary: '#ECEAF0',
  textSecondary: '#9A97A6',
  textMuted: '#9A97A6',
  textDisabled: '#6B6878',
  // White on coral CTAs (matches web `.blyp-studio-launch`).
  onBrand: '#FFFFFF',

  primary: BRAND,
  primaryDark: BRAND_DIM,
  primaryLight: BRAND_LIGHT,
  accent: BRAND,

  gradientStart: BRAND,
  gradientMiddle: BRAND,
  gradientEnd: BRAND_DIM,
  brandGradient: [BRAND, BRAND, BRAND_DIM],

  electric: WARM_TAUPE,
  electricSoft: 'rgba(255,77,109,0.14)',
  electricGradient: [WARM_TAUPE, WARM_TAUPE_DIM],

  success: '#34D399',
  warning: '#FBBF24',
  error: '#FB7185',
  info: '#60A5FA',

  shadow: '#000000',
  glow: BRAND,
  glowElectric: '#E0C090',
  overlay: 'rgba(0,0,0,0.62)',

  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
};

// Light mode: coral drives accent text/icons on light surfaces.
const BRAND_TEXT = '#D63A58';

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

  textPrimary: '#12141A',
  textSecondary: '#52525B',
  textMuted: '#71717A',
  textDisabled: '#A1A1AA',
  onBrand: '#FFFFFF',

  primary: BRAND_TEXT,
  primaryDark: '#B82E48',
  primaryLight: BRAND,
  accent: BRAND_TEXT,

  gradientStart: BRAND,
  gradientMiddle: BRAND,
  gradientEnd: BRAND_DIM,
  brandGradient: [BRAND, BRAND, BRAND_DIM],

  electric: '#8A7A6A',
  electricSoft: 'rgba(255,77,109,0.10)',
  electricGradient: [WARM_TAUPE, WARM_TAUPE_DIM],

  success: '#059669',
  warning: '#D97706',
  error: '#E11D48',
  info: '#2563EB',

  shadow: '#000000',
  glow: BRAND,
  glowElectric: '#E0C090',
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
 * On iOS the coloured `glow` shadows render as soft brand tints; on Android
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
      shadowOpacity: 0.22,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
    },
    /** soft warm tint for highlight/secondary elements */
    glowElectric: {
      elevation: 8,
      shadowColor: c.glowElectric,
      shadowOpacity: 0.20,
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
