import {
  Image as RNImage,
  Text as RNText,
  TouchableOpacity as RNTouchableOpacity,
  View as RNView,
} from 'react-native';
import { cssInterop } from 'nativewind';

export const View = cssInterop(RNView, { className: 'style' });
export const Text = cssInterop(RNText, { className: 'style' });
export const Image = cssInterop(RNImage, { className: 'style' });
export const TouchableOpacity = cssInterop(RNTouchableOpacity, { className: 'style' });
