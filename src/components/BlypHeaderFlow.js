import React from "react";
import { View, TouchableOpacity, StyleSheet, Text } from "react-native";
import HeaderContainer, { HEADER_ICON_COLOR } from "./HeaderContainer";
import BlypLogo from "./BlypLogo";
import HeaderMenuTabs from "./HeaderMenuTabs";
import Icon from "./Icon";
import { COLORS } from "../styles/theme";

/**
 * BlypHeaderFlow
 * ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
 * FLOW layout header (takes space, content renders below).
 * Identical chrome + identical tab row across ALL surfaces.
 *
 * Baseline reference: Home ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ #4ME (gold standard).
 *
 * testIDs emitted (for UI-rail bounds checks):
 *   blyp_header          ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ outer HeaderContainer wrapper
 *   blyp_header_chrome   ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ top row (menu / logo / search)
 *   blyp_header_left     ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ left action slot
 *   blyp_header_logo     ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ logo wrapper
 *   blyp_header_right    ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ right action slot
 *   blyp_header_tabs     ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ tab bar wrapper
 *   blyp_tab_<key>       ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ individual tab buttons (via testIDPrefix)
 *
 * Props:
 *  - tabs            : Array<{ key: string, label: string }>
 *  - activeKey       : string
 *  - onTabChange     : (key: string) => void
 *  - onMenuPress     : () => void              (optional)
 *  - onSearchPress   : () => void              (optional)
 *  - rightAction     : ReactNode               (optional, overrides search icon)
 *  - onLayout        : (e) => void             (optional)
 *  - pinnedKeys      : string[]                (optional, always-visible tab keys)
 *  - testIDBase      : string (default "blyp")
 */
export default function BlypHeaderFlow({
    tabs,
    activeKey,
    onTabChange,
    onMenuPress,
    onSearchPress,
    searchLabel = "Search",
    rightAction = null,
    headerLeftExtra = null,
    onLayout,
    matchHomePadding = true,
    pinnedKeys = undefined,
    testIDBase = "blyp",
}) {
    const base = testIDBase;

    return (
        <HeaderContainer
            testID={`${base}_header`}
            onLayout={onLayout}
            adaptiveTopPadding={matchHomePadding}
        >
            {/* Chrome row: menu | logo (true center) | actions */}
            <View
                testID={`${base}_header_chrome`}
                style={[flowStyles.headerTop, matchHomePadding && flowStyles.headerTopTight]}
            >
                <View testID={`${base}_header_left`} style={flowStyles.sideSlot}>
                    {onMenuPress ? (
                        <TouchableOpacity style={flowStyles.iconBtn} onPress={onMenuPress}>
                            <Icon name="menu" size={24} color={HEADER_ICON_COLOR} />
                        </TouchableOpacity>
                    ) : null}
                    {headerLeftExtra}
                </View>

                <View
                    testID={`${base}_header_logo`}
                    accessible={true}
                    accessibilityLabel="blyp_header_logo"
                    style={flowStyles.logoOverlay}
                    pointerEvents="none"
                >
                    <BlypLogo useGradientBackground={true} />
                </View>

                <View testID={`${base}_header_right`} style={[flowStyles.sideSlot, flowStyles.sideSlotRight]}>
                    {rightAction || (onSearchPress ? (
                        <TouchableOpacity style={flowStyles.searchPill} onPress={onSearchPress}>
                            <Icon name="search" size={16} color={HEADER_ICON_COLOR} />
                            <Text style={flowStyles.searchPillText}>{searchLabel}</Text>
                        </TouchableOpacity>
                    ) : null)}
                </View>
            </View>

            {/* Tab row */}
            <View testID={`${base}_header_tabs`} accessibilityLabel="blyp_header_tabs">
                <View style={[flowStyles.tabsDock, matchHomePadding && flowStyles.tabsDockTight]}>

                    <HeaderMenuTabs
                        tabs={tabs}
                        activeKey={activeKey}
                        onChange={onTabChange}
                        testIDPrefix={`${base}_tab`}
                        align="center"
                        pinnedKeys={pinnedKeys}
                    />

                </View>
            </View>
        </HeaderContainer>
    );
}

const flowStyles = StyleSheet.create({
    tabsDock: { marginTop: 8, paddingBottom: 0 },
    tabsDockTight: { marginTop: 4 },
    headerTop: {
        position: "relative",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 8,
        minHeight: 44,
    },
    headerTopTight: {
        minHeight: 40,
        paddingTop: 1,
    },
    sideSlot: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        minWidth: 72,
        zIndex: 1,
    },
    sideSlotRight: {
        justifyContent: "flex-end",
    },
    logoOverlay: {
        position: "absolute",
        left: 0,
        right: 0,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 0,
    },
    iconBtn: {
        padding: 8,
    },
    searchPill: {
        minHeight: 32,
        paddingHorizontal: 10,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        backgroundColor: COLORS.backgroundCard,
        borderWidth: 1,
        borderColor: COLORS.borderStrong,
    },
    searchPillText: {
        color: HEADER_ICON_COLOR,
        fontSize: 12,
        fontWeight: "700",
        includeFontPadding: false,
    },
});
