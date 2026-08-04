import React from 'react';
import { View, ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../styles/ThemeProvider';
import { PText } from './PText';

interface PEmptyStateProps {
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    style?: StyleProp<ViewStyle>;
}

/**
 * PEmptyState — Centered empty-state placeholder.
 */
export function PEmptyState({ title, subtitle, icon, style }: PEmptyStateProps) {
    const { colors, spacing } = useTheme();
    return (
        <View style={[{ padding: spacing.xl, alignItems: 'center', justifyContent: 'center' }, style]}>
            {icon || <ActivityIndicator color={colors.primary} size="large" />}
            <View style={{ height: spacing.lg }} />
            <PText variant="h2" style={{ textAlign: 'center' }}>
                {title}
            </PText>
            {subtitle ? (
                <PText variant="sub" style={{ textAlign: 'center', marginTop: spacing.sm }}>
                    {subtitle}
                </PText>
            ) : null}
        </View>
    );
}
