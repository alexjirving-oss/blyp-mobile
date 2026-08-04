import type React from 'react';
import type { StatusBarStyle, StyleProp, ViewStyle } from 'react-native';

export interface ScreenContainerProps {
    children?: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    noSafeArea?: boolean;
    statusBarColor?: string;
    barStyle?: StatusBarStyle;
}

export default function ScreenContainer(props: ScreenContainerProps): React.JSX.Element;