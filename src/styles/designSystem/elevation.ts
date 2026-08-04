/**
 * Blyp Design System — Elevation / Shadow Presets
 *
 * Android-friendly subtle shadows. Avoid cheap heavy drop-shadows.
 */
export const ELEVATION = {
    none: {
        elevation: 0,
        shadowOpacity: 0,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
    },
    card: {
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
    },
    raised: {
        elevation: 4,
        shadowColor: '#000',
        shadowOpacity: 0.20,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
    },
    modal: {
        elevation: 6,
        shadowColor: '#000',
        shadowOpacity: 0.22,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 10 },
    },
} as const;
