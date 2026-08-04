import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../styles/ThemeProvider';

interface PDividerProps {
    inset?: number;
}

/**
 * PDivider — Subtle 1px divider matching the active theme's border colour.
 */
export function PDivider({ inset = 0 }: PDividerProps) {
    const { colors } = useTheme();
    return (
        <View
            style={{
                height: 1,
                backgroundColor: colors.divider,
                marginLeft: inset,
            }}
        />
    );
}
