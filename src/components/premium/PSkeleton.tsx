import React, { useEffect, useRef } from 'react';
import { Animated, type DimensionValue } from 'react-native';
import { useTheme } from '../../styles/ThemeProvider';

interface PSkeletonProps {
    h?: number;
    w?: DimensionValue;
    r?: number;
}

/**
 * PSkeleton — Placeholder box with a gentle pulse for loading states.
 */
export function PSkeleton({ h = 14, w = '100%', r }: PSkeletonProps) {
    const { colors, radius } = useTheme();
    const pulse = useRef(new Animated.Value(0.5)).current;

    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
                Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
            ]),
        );
        loop.start();
        return () => loop.stop();
    }, [pulse]);

    return (
        <Animated.View
            style={{
                height: h,
                width: w,
                borderRadius: r ?? radius.md,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pulse,
            }}
        />
    );
}
