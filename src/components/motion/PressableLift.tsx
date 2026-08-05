import React from 'react';
import { TouchableOpacity, type TouchableOpacityProps } from 'react-native';

type Props = TouchableOpacityProps & { lifted?: boolean };

/** Thin stand-in until motion PressableLift ships; preserves profile action API. */
export default function PressableLift({ lifted: _lifted, activeOpacity = 0.85, ...rest }: Props) {
  return <TouchableOpacity activeOpacity={activeOpacity} {...rest} />;
}
