import React from 'react';
import {
    ActivityIndicator,
    Pressable,
    View,
    type StyleProp,
    type TextStyle,
    type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../styles/ThemeProvider';
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
    /** optional leading element (e.g. an icon) */
    leading?: React.ReactNode;
    fullWidth?: boolean;
    testID?: string;
}

const SIZES: Record<Size, { height: number; px: number; font: number }> = {
    sm: { height: 38, px: 16, font: 13 },
    md: { height: 48, px: 22, font: 15 },
    lg: { height: 56, px: 28, font: 16 },
};

/**
 * PButton — Premium CTA. Gradient + neon glow primary/electric variants, a
 * solid brand fill, and a glass ghost variant. Theme-aware (light + dark),
 * with a subtle press-scale for a tactile, 3D feel.
 */
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
        alignSelf: fullWidth ? 'stretch' : 'flex-start',
    };

    const label = (
        <>
            {leading}
            {loading ? (
                <ActivityIndicator color={variant === 'ghost' ? colors.primary : colors.onBrand} />
            ) : (
                <PText
                    variant="btn"
                    tone={variant === 'ghost' ? 'brand' : 'onBrand'}
                    style={[{ fontSize: dims.font }, textStyle]}
                >
                    {title}
                </PText>
            )}
        </>
    );

    if (variant === 'ghost') {
        return (
            <Pressable
                testID={testID}
                disabled={disabled || loading}
                onPress={onPress}
                style={({ pressed }) => [
                    base,
                    {
                        backgroundColor: colors.card,
                        borderWidth: 1,
                        borderColor: colors.borderStrong,
                        opacity: disabled ? 0.5 : 1,
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                    },
                    style,
                ]}
            >
                {label}
            </Pressable>
        );
    }

    if (variant === 'solid') {
        return (
            <Pressable
                testID={testID}
                disabled={disabled || loading}
                onPress={onPress}
                style={({ pressed }) => [
                    base,
                    shadows.sm,
                    {
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.border,
                        opacity: disabled ? 0.5 : 1,
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                    },
                    style,
                ]}
            >
                {label}
            </Pressable>
        );
    }

    const gradient =
        variant === 'electric'
            ? [colors.electricGradient[0], colors.electricGradient[1]]
            : colors.brandGradient;
    const glow = variant === 'electric' ? shadows.glowElectric : shadows.glow;

    return (
        <Pressable
            testID={testID}
            disabled={disabled || loading}
            onPress={onPress}
            style={({ pressed }) => [
                { alignSelf: fullWidth ? 'stretch' : 'flex-start' },
                disabled ? shadows.none : glow,
                { opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
                style,
            ]}
        >
            <LinearGradient colors={gradient as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={base}>
                {/* top sheen for the glossy 3D highlight */}
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: '52%',
                        borderTopLeftRadius: radius.pill,
                        borderTopRightRadius: radius.pill,
                        backgroundColor: 'rgba(255,255,255,0.18)',
                    }}
                />
                {label}
            </LinearGradient>
        </Pressable>
    );
}
