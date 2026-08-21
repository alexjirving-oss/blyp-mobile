/**
 * Curated Stage theme packs + wallpaper catalog.
 * Free-form CSS is never allowed — owners pick from this list only.
 */

export const STAGE_CONTENT_MAX = 720;
export const STAGE_MAX_LINKS = 5;
export const STAGE_MAX_TOP_CIRCLE = 8;
export const STAGE_MAX_PINS = 3;
export const STAGE_DISPLAY_NAME_MAX = 24;
export const STAGE_VIBE_MAX = 80;
export const STAGE_LINK_LABEL_MAX = 28;
export const STAGE_BIO_DISPLAY_MAX = 280;

/** @typedef {{ id: string, label: string, subtitle: string, free: boolean, colors: {
 *   bg: string, surface: string, accent: string, accentSoft: string,
 *   text: string, textMuted: string, border: string, coverFallback: [string, string],
 * }}} StageThemePack */

/** @type {StageThemePack[]} */
export const STAGE_THEME_PACKS = [
  {
    id: 'midnight_teal',
    label: 'Midnight Teal',
    subtitle: 'Blyp classic — dark chrome, PETRONAS accent',
    free: true,
    colors: {
      bg: '#0A0A0C',
      surface: '#141418',
      accent: '#FF2D55',
      accentSoft: 'rgba(255, 45, 85,0.16)',
      text: '#F5F5F7',
      textMuted: '#9CA3AF',
      border: '#27272E',
      coverFallback: ['#0B1F1C', '#FF2D55'],
    },
  },
  {
    id: 'neon_dusk',
    label: 'Neon Dusk',
    subtitle: 'Violet night with electric aqua edge',
    free: true,
    colors: {
      bg: '#0C0A12',
      surface: '#17141F',
      accent: '#67E8F9',
      accentSoft: 'rgba(103,232,249,0.14)',
      text: '#F8FAFC',
      textMuted: '#A5B4C8',
      border: '#2A2438',
      coverFallback: ['#1A1030', '#67E8F9'],
    },
  },
  {
    id: 'ember_stage',
    label: 'Ember Stage',
    subtitle: 'Warm charcoal with amber pulse',
    free: true,
    colors: {
      bg: '#100C0A',
      surface: '#1A1410',
      accent: '#F59E0B',
      accentSoft: 'rgba(245,158,11,0.14)',
      text: '#FFF7ED',
      textMuted: '#C4B5A0',
      border: '#3A2E22',
      coverFallback: ['#2A1608', '#F59E0B'],
    },
  },
  {
    id: 'arctic_signal',
    label: 'Arctic Signal',
    subtitle: 'Cool slate with crisp ice accent',
    free: true,
    colors: {
      bg: '#080B10',
      surface: '#10151C',
      accent: '#38BDF8',
      accentSoft: 'rgba(56,189,248,0.14)',
      text: '#F1F5F9',
      textMuted: '#94A3B8',
      border: '#1E293B',
      coverFallback: ['#0F172A', '#38BDF8'],
    },
  },
  {
    id: 'rose_garage',
    label: 'Rose Garage',
    subtitle: 'Soft rose on deep ink — later Plus feel, free for v1',
    free: true,
    colors: {
      bg: '#0E0A0C',
      surface: '#1A1216',
      accent: '#FB7185',
      accentSoft: 'rgba(251,113,133,0.14)',
      text: '#FFF1F2',
      textMuted: '#C4A4AB',
      border: '#3F2A32',
      coverFallback: ['#2A1018', '#FB7185'],
    },
  },
];

export const STAGE_WALLPAPERS = [
  {
    id: 'gradient_teal_fade',
    label: 'Teal Fade',
    themeHint: 'midnight_teal',
    colors: ['#061412', '#0A0A0C', '#FF2D55'],
  },
  {
    id: 'gradient_violet_haze',
    label: 'Violet Haze',
    themeHint: 'neon_dusk',
    colors: ['#12081F', '#0C0A12', '#67E8F9'],
  },
  {
    id: 'gradient_ember_wash',
    label: 'Ember Wash',
    themeHint: 'ember_stage',
    colors: ['#1A0C04', '#100C0A', '#F59E0B'],
  },
  {
    id: 'gradient_arctic_beam',
    label: 'Arctic Beam',
    themeHint: 'arctic_signal',
    colors: ['#061018', '#080B10', '#38BDF8'],
  },
  {
    id: 'gradient_rose_mist',
    label: 'Rose Mist',
    themeHint: 'rose_garage',
    colors: ['#18080E', '#0E0A0C', '#FB7185'],
  },
];

export const DEFAULT_STAGE_THEME_ID = 'midnight_teal';

export function getStageThemePack(themeId) {
  const id = String(themeId || '').trim();
  return STAGE_THEME_PACKS.find((p) => p.id === id) || STAGE_THEME_PACKS[0];
}

export function getStageWallpaper(wallpaperId) {
  const id = String(wallpaperId || '').trim();
  return STAGE_WALLPAPERS.find((w) => w.id === id) || null;
}

export function listFreeStageThemes() {
  return STAGE_THEME_PACKS.filter((p) => p.free);
}
