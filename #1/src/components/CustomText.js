import React from 'react';
import { Text } from 'react-native';
import { responsiveFont } from '../utils/scaleUtils';

// Wrapper to clamp font scaling globally
export default function CustomText({ children, style, baseSize, allowScale = true, ...rest }) {
  let computedStyle = style;
  if (baseSize) {
    const scaled = responsiveFont(baseSize);
    computedStyle = [style, { fontSize: scaled }];
  }
  return (
    <Text
      maxFontSizeMultiplier={allowScale ? 1.0 : 1.0}
      allowFontScaling={allowScale}
      style={computedStyle}
      {...rest}
    >
      {children}
    </Text>
  );
}
