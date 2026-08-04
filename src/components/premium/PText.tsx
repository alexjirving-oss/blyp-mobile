import React from 'react';
import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { TYPE } from '../../styles/designSystem/typography';
import { useTheme } from '../../styles/ThemeProvider';

type Variant = keyof typeof TYPE;
type Tone = 'primary' | 'secondary' | 'muted' | 'brand' | 'onBrand';

interface PTextProps extends TextProps {
    variant?: Variant;
    /** Override the default colour tone for this variant. */
    tone?: Tone;
    style?: StyleProp<TextStyle>;
}

const DEFAULT_TONE: Record<Variant, Tone> = {
    h1: 'primary',
    h2: 'primary',
    body: 'primary',
    sub: 'secondary',
    cap: 'muted',
    btn: 'onBrand',
};

/**
 * PText — Premium text component backed by the design-system TYPE scale,
 * with colour resolved live from the active (light/dark) theme.
 */
export function PText({ variant = 'body', tone, style, ...props }: PTextProps) {
    const { colors } = useTheme();
    const toneColor: Record<Tone, string> = {
        primary: colors.textPrimary,
        secondary: colors.textSecondary,
        muted: colors.textMuted,
        brand: colors.primary,
        onBrand: colors.onBrand,
    };
    // Use TYPE for size/weight/spacing but resolve colour from the theme.
    const { color: _ignored, ...typeStyle } = TYPE[variant] as TextStyle;
    const resolved = toneColor[tone ?? DEFAULT_TONE[variant]];
    return <Text {...props} style={[typeStyle, { color: resolved }, style]} />;
}
