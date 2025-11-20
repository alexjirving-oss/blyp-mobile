import React from 'react';
import * as L from 'lucide-react-native';
import { View } from 'react-native';

// Map common Ionicons/AntDesign names to Lucide equivalents
const map = {
  // core nav/actions
  home: 'Home',
  search: 'Search',
  'search-outline': 'Search',
  add: 'Plus',
  plus: 'Plus',
  close: 'X',
  'close-circle': 'XCircle',
  check: 'Check',
  checkmark: 'Check',
  'check-circle': 'CheckCircle',
  'checkmark-circle': 'CheckCircle',
  settings: 'Settings',
  user: 'User',
  'person-outline': 'User',
  bell: 'Bell',
  menu: 'Menu',
  'menu-outline': 'Menu',
  more: 'MoreHorizontal',
  share: 'Share',
  star: 'Star',
  lock: 'Lock',
  'lock-closed': 'Lock',
  unlock: 'Unlock',

  // media
  camera: 'Camera',
  'camera-reverse': 'RefreshCw',
  video: 'Video',
  'videocam': 'Video',
  'videocam-off': 'VideoOff',
  images: 'Images',
  image: 'Image',
  mic: 'Mic',
  play: 'Play',
  'play-circle': 'PlayCircle',
  'play-circle-outline': 'PlayCircle',
  pause: 'Pause',
  upload: 'Upload',
  download: 'Download',

  // comms
  message: 'MessageCircle',
  chat: 'MessageCircle',
  chatbubble: 'MessageCircle',
  'chatbubbles-outline': 'MessageCircle',
  send: 'Send',

  // social
  heart: 'Heart',
  'heart-outline': 'Heart',
  like: 'Heart',
  flame: 'Flame',
  'trending-up': 'TrendingUp',
  gift: 'Gift',

  // system
  'arrow-back': 'ArrowLeft',
  back: 'ArrowLeft',
  'chevron-left': 'ChevronLeft',
  'chevron-right': 'ChevronRight',
  'closecircle': 'XCircle',
  'checkcircle': 'CheckCircle',
  alert: 'AlertCircle',
  'alert-circle': 'AlertCircle',

  // location/visibility
  location: 'MapPin',
  eye: 'Eye',
  'eye-off': 'EyeOff',

  // people/groups
  people: 'Users',
  person: 'User',

  // gaming/misc
  'trophy-outline': 'Trophy',
  'game-controller-outline': 'Gamepad2',
  wallet: 'Wallet',
  list: 'List',
  radio: 'Radio',
  'radio-outline': 'Radio',
  grid: 'Grid3X3',
  'grid-outline': 'Grid3X3',
  pulse: 'Activity',
  'pulse-outline': 'Activity',
  'paper-plane': 'Send',
};

export default function Icon({ name, size = 24, color, focused = false, style, strokeWidth }) {
  const key = (name || '').toString().toLowerCase();
  const lucideName = map[key] || 'Circle';
  const Comp = L[lucideName] || L.Circle;
  return (
    <View style={style}>
      <Comp size={size} color={color} strokeWidth={strokeWidth ?? (focused ? 2.5 : 2)} />
    </View>
  );
}
