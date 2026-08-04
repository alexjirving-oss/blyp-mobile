import React from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../styles/ThemeProvider';

interface PCardProps extends ViewProps {
    style?: StyleProp<ViewStyle>;
    /**
     * glass   — translucent surface that floats over the page gradient
     * surface — solid raised surface
     * gradient— subtle brand-tinted gradient fill (hero cards)
     */
    variant?: 'glass' | 'surface' | 'gradient';
    /** depth: soft (default), raised, or a coloured neon glow */
    elevation?: 'flat' | 'soft' | 'raised' | 'glow';
    /** add a faint brand gradient hairline border for the 3D edge-lit look */
    gradientBorder?: boolean;
    padding?: number;
}

/**
 * PCard — Premium card: glass / surface / gradient with layered depth and an
 * optional edge-lit gradient border. Fully theme-aware (light + dark).
 */
export function PCard({
    style,
    variant = 'glass',
    elevation = 'soft',
    gradientBorder = false,
    padding,
    children,
    ...props
}: PCardProps) {
    const { colors, radius, shadows } = useTheme();

    const shadowStyle =
        elevation === 'flat'
            ? shadows.none
            : elevation === 'raised'
                ? shadows.md
                : elevation === 'glow'
                    ? shadows.glow
                    : shadows.sm;

    const bg =
        variant === 'surface' ? colors.surface : variant === 'gradient' ? 'transparent' : colors.card;

    const base: ViewStyle = {
        backgroundColor: bg,
        borderColor: colors.border,
        borderWidth: gradientBorder ? 0 : 1,
        borderRadius: radius.lg,
        padding: padding ?? 16,
        overflow: 'hidden',
    };

    const inner =
        variant === 'gradient' ? (
            <LinearGradient
                colors={[`${colors.primary}26`, `${colors.electric}1A`]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ ...base, backgroundColor: colors.surface }}
            >
                {children}
            </LinearGradient>
        ) : (
            <View style={base}>{children}</View>
        );

    if (gradientBorder) {
        return (
            <LinearGradient
                colors={[colors.primary, colors.electric]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[{ borderRadius: radius.lg + 1, padding: 1 }, shadowStyle, style]}
                {...(props as any)}
            >
                {inner}
            </LinearGradient>
        );
    }

    return (
        <View style={[shadowStyle, style]} {...props}>
            {inner}
        </View>
    );
}
