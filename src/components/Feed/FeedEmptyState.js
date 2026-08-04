import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { COLORS } from '../../styles/theme';
import BlypLogo from '../BlypLogo';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';

/**
 * FeedEmptyState — branded loading / empty experience for the Home feed.
 *
 * Props:
 *   mode: 'loading' | 'empty'
 *
 * - loading → spinner + "Loading your feed…"
 * - empty   → warm message encouraging follow / check back
 */
const FeedEmptyState = ({ mode = 'loading' }) => {
    const isLoading = mode === 'loading';

    return (
        <View style={styles.wrapper}>
            <BlypLogo style={styles.logo} textStyle={{ fontSize: responsiveFont(34) }} />

            <Text style={styles.primary} allowFontScaling={false}>
                {isLoading ? 'Welcome to blyp' : 'Your feed is quiet'}
            </Text>

            {isLoading ? (
                <>
                    <ActivityIndicator
                        size="large"
                        color={COLORS.primary}
                        style={styles.spinner}
                    />
                    <Text style={styles.secondary} allowFontScaling={false}>
                        Loading your feed…
                    </Text>
                </>
            ) : (
                <Text style={styles.secondary} allowFontScaling={false}>
                    Your feed is warming up.{'\n'}Follow creators or check back in a moment.
                </Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        flex: 1,
        backgroundColor: COLORS.background,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    logo: {
        marginBottom: responsiveSize(20),
    },
    primary: {
        fontSize: responsiveFont(22),
        fontWeight: '700',
        color: COLORS.textPrimary,
        marginBottom: responsiveSize(12),
        textAlign: 'center',
    },
    spinner: {
        marginBottom: responsiveSize(12),
    },
    secondary: {
        fontSize: responsiveFont(15),
        fontWeight: '500',
        color: COLORS.textMuted,
        textAlign: 'center',
        lineHeight: responsiveFont(22),
    },
});

export default FeedEmptyState;
