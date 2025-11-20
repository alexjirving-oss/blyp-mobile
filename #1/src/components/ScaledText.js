import React from 'react';
import { Text } from 'react-native';

const ScaledText = ({ children, style, allowFontScaling = false, ...props }) => {
  return (
    <Text 
      {...props}
      style={style}
      allowFontScaling={allowFontScaling}
    >
      {children}
    </Text>
  );
};

export default ScaledText;