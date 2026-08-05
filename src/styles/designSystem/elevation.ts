/**
 * Blyp Design System — Elevation / Shadow Presets
 * Soft layered depth (not neon glow).
 */
export const ELEVATION = {
    none: {
        elevation: 0,
        shadowOpacity: 0,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
    },
    surfaceHighlight: {
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
        borderTopColor: 'rgba(255,255,255,0.18)',
    },
    soft: {
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.14,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
    },
    card: {
        elevation: 3,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
    },
    raised: {
        elevation: 5,
        shadowColor: '#000',
        shadowOpacity: 0.22,
        shadowRadius: 14,
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
