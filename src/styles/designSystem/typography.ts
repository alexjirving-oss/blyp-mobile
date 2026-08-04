/**
 * Blyp Design System — Typography Presets
 */
import { COLORS } from './tokens';

export const TYPE = {
    h1: { fontSize: 22, fontWeight: '800' as const, color: COLORS.textPrimary, letterSpacing: 0.2 },
    h2: { fontSize: 18, fontWeight: '700' as const, color: COLORS.textPrimary },
    body: { fontSize: 15, fontWeight: '500' as const, color: COLORS.textPrimary, lineHeight: 21 },
    sub: { fontSize: 13, fontWeight: '500' as const, color: COLORS.textSecondary, lineHeight: 18 },
    cap: { fontSize: 12, fontWeight: '600' as const, color: COLORS.textMuted, letterSpacing: 0.2 },
    btn: { fontSize: 14, fontWeight: '700' as const, color: COLORS.textPrimary },
} as const;
