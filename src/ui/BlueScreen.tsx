import React from "react";
import { Platform, StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Messenger-blue background color extracted from COLORS.background (#0A0A0C).
 * This is the authoritative "Blyp blue" used across all screens.
 */
export const BLYP_BLUE_BG = "#0A0A0C";

/**
 * BlueScreen
 * Production wrapper that enforces a consistent Messenger-blue background
 * across every screen in the app.
 *
 * Top inset is intentionally left to HeaderContainer / BlypHeaderFlow so
 * Home, Chat/Games, and Profile share one header baseline.
 */
export default function BlueScreen({ children }: React.PropsWithChildren<{}>) {
    return (
        <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
            <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
            <View style={styles.root}>{children}</View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: {
        flex: 1,
        backgroundColor: BLYP_BLUE_BG,
    },
    root: {
        flex: 1,
        backgroundColor: BLYP_BLUE_BG,
        ...(Platform.OS === "android" ? { paddingTop: 0 } : {}),
    },
});
