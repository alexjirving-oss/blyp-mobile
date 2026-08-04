import React, { useState } from 'react';
import { TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../styles/ThemeProvider';
import { PText } from './PText';

interface PInputProps {
    label?: string;
    value?: string;
    onChangeText?: (text: string) => void;
    placeholder?: string;
    style?: StyleProp<ViewStyle>;
    secureTextEntry?: boolean;
    testID?: string;
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    keyboardType?: 'default' | 'email-address' | 'number-pad' | 'numeric';
}

/**
 * PInput — Premium text input with label and glass surface. Focus state lights
 * up the border with the brand colour for a subtle 3D / interactive feel.
 */
export function PInput({
    label,
    value,
    onChangeText,
    placeholder,
    style,
    secureTextEntry,
    testID,
    autoCapitalize,
    keyboardType,
}: PInputProps) {
    const { colors, radius, spacing } = useTheme();
    const [focused, setFocused] = useState(false);

    return (
        <View style={style}>
            {label ? (
                <PText variant="cap" style={{ marginBottom: spacing.sm }}>
                    {label}
                </PText>
            ) : null}
            <View
                style={{
                    backgroundColor: colors.card,
                    borderColor: focused ? colors.primary : colors.border,
                    borderWidth: focused ? 1.5 : 1,
                    borderRadius: radius.lg,
                    paddingHorizontal: spacing.md,
                    height: 50,
                    justifyContent: 'center',
                }}
            >
                <TextInput
                    testID={testID}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={secureTextEntry}
                    autoCapitalize={autoCapitalize}
                    keyboardType={keyboardType}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    style={{ color: colors.textPrimary, fontSize: 15, padding: 0 }}
                />
            </View>
        </View>
    );
}
