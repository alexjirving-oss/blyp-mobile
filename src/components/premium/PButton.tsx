import React from 'react';
import {
    ActivityIndicator,
    View,
    type StyleProp,
    type TextStyle,
    type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../styles/ThemeProvider';
import { SURFACE_DEPTH } from '../../styles/designSystem/palettes';
import PressableLift from '../motion/PressableLift';
import { PText } from './PText';

type Variant = 'primary' | 'electric' | 'solid' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface PButtonProps {
    title: string;
    onPress?: () => void;
    variant?: Variant;
    size?: Size;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    disabled?: boolean;
    loading?: boolean;
    leading?: React.ReactNode;
    fullWidth?: boolean;
    testID?: string;
}

const SIZES: Record<Size, { height: number; px: number; font: number }> = {
    sm: { height: 38, px: 16, font: 13 },
    md: { height: 48, px: 22, font: 15 },
    lg: { height: 56, px: 28, font: 16 },
};

export function PButton({
    title,
    onPress,
    variant = 'primary',
    size = 'md',
    style,
    textStyle,
    disabled,
    loading,
    leading,
    fullWidth,
    testID,
}: PButtonProps) {
    const { colors, radius, shadows } = useTheme();
    const dims = SIZES[size];
    const base: ViewStyle = {
        height: dims.height,
        borderRadius: radius.pill,
        paddingHorizontal: dims.px,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        overflow: 'hidden',
    };
    const label = (
        <>
            {leading}
            {loading ? (
                <ActivityIndicator color={variant === 'ghost' ? colors.primary : colors.onBrand} />
            ) : (
                <PText variant="btn" tone={variant === 'ghost' ? 'brand' : 'onBrand'} style={[{ fontSize: dims.font }, textStyle]}>
                    {title}
                </PText>
            )}
        </>
    );
    const sheen = (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '48%',
                borderTopLeftRadius: radius.pill,
                borderTopRightRadius: radius.pill,
                backgroundColor: SURFACE_DEPTH.sheen,
            }}
        />
    );
    const wrapStyle: StyleProp<ViewStyle> = [
        { alignSelf: fullWidth ? 'stretch' : 'flex-start', opacity: disabled ? 0.5 : 1 },
        style,
    ];
    if (variant === 'ghost') {
        return (
            <PressableLift testID={testID} disabled={disabled || loading} onPress={onPress} pressedScale={0.97} lifted={false}
                style={[wrapStyle, base, { backgroundColor: colors.card, borderWidth: 1, borderColor: SURFACE_DEPTH.highlightBorderStrong }]}>
                {sheen}{label}
            </PressableLift>
        );
    }
    if (variant === 'solid') {
        return (
            <PressableLift testID={testID} disabled={disabled || loading} onPress={onPress} pressedScale={0.97} lifted={!disabled}
                style={[wrapStyle, base, { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: SURFACE_DEPTH.highlightBorder }]}>
                {sheen}{label}
            </PressableLift>
        );
    }
    const gradient = variant === 'electric' ? [colors.electricGradient[0], colors.electricGradient[1]] : colors.brandGradient;
    const glow = variant === 'electric' ? shadows.glowElectric : shadows.glow;
    return (
        <PressableLift testID={testID} disabled={disabled || loading} onPress={onPress} pressedScale={0.97} lifted={false}
            style={[wrapStyle, disabled ? shadows.none : glow]}>
            <LinearGradient colors={gradient as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={base}>
                {sheen}{label}
            </LinearGradient>
        </PressableLift>
    );
}
