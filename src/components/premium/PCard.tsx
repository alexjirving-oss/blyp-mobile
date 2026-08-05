import React from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../styles/ThemeProvider';
import { SURFACE_DEPTH } from '../../styles/designSystem/palettes';

interface PCardProps extends ViewProps {
    style?: StyleProp<ViewStyle>;
    variant?: 'glass' | 'surface' | 'gradient';
    elevation?: 'flat' | 'soft' | 'raised' | 'glow';
    gradientBorder?: boolean;
    padding?: number;
}

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
        elevation === 'flat' ? shadows.none
            : elevation === 'raised' ? shadows.md
                : elevation === 'glow' ? shadows.glow
                    : shadows.sm;
    const bg = variant === 'surface' ? colors.surface : variant === 'gradient' ? 'transparent' : colors.card;
    const base: ViewStyle = {
        backgroundColor: bg,
        borderColor: SURFACE_DEPTH.highlightBorder,
        borderWidth: gradientBorder ? 0 : 1,
        borderRadius: radius.lg,
        padding: padding ?? 16,
        overflow: 'hidden',
    };
    const sheen = elevation === 'flat' ? null : (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: SURFACE_DEPTH.sheen }} />
    );
    const inner = variant === 'gradient' ? (
        <LinearGradient colors={[`${colors.primary}26`, `${colors.electric}1A`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ ...base, backgroundColor: colors.surface }}>
            {sheen}{children}
        </LinearGradient>
    ) : (
        <View style={base}>{sheen}{children}</View>
    );
    if (gradientBorder) {
        return (
            <LinearGradient colors={[colors.primary, colors.electric]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={[{ borderRadius: radius.lg + 1, padding: 1 }, shadowStyle, style]} {...(props as any)}>
                {inner}
            </LinearGradient>
        );
    }
    return <View style={[shadowStyle, style]} {...props}>{inner}</View>;
}
