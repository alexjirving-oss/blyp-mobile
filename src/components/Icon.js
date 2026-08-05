import React from 'react';
import * as L from 'lucide-react-native';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Map common Ionicons/AntDesign names to Lucide equivalents
const map = {
  // core nav/actions
  home: 'Home',
  search: 'Search',
  'search-outline': 'Search',
  add: 'Plus',
  plus: 'Plus',
  remove: 'Minus',
  minus: 'Minus',
  crop: 'Crop',
  close: 'X',
  'close-circle': 'XCircle',
  check: 'Check',
  checkmark: 'Check',
  'check-circle': 'CheckCircle',
  'checkmark-circle': 'CheckCircle',
  settings: 'Settings',
  'chevron-up': 'ChevronUp',
  'chevron-down': 'ChevronDown',
  'chevron-left': 'ChevronLeft',
  'chevron-right': 'ChevronRight',
  user: 'User',
  'person-outline': 'User',
  bell: 'Bell',
  menu: 'Menu',
  'menu-outline': 'Menu',
  more: 'MoreHorizontal',
  share: 'Share',
  'share-outline': 'Share',
  'arrow-redo': 'Share',
  'arrow-redo-outline': 'Share',
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
  'mic-off': 'MicOff',
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
  'chatbubble-outline': 'MessageCircle',
  'chatbubbles-outline': 'MessageCircle',
  send: 'Send',
  'send-outline': 'Send',

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
  'chevron-down': 'ChevronDown',
  'chevron-up': 'ChevronUp',
  'add-circle': 'PlusCircle',
  'add-circle-outline': 'PlusCircle',
  refresh: 'RefreshCw',

  // sports
  football: 'Shield',
  'football-outline': 'Shield',
  flag: 'Flag',
  'flag-outline': 'Flag',
  car: 'Car',
  'car-sport': 'Car',
  trophy: 'Trophy',
  tv: 'Tv',
  'tv-outline': 'Tv',
  calendar: 'Calendar',
  'calendar-outline': 'Calendar',
  'closecircle': 'XCircle',
  'checkcircle': 'CheckCircle',
  alert: 'CircleAlert',
  'alert-circle': 'CircleAlert',

  // location/visibility
  location: 'MapPin',
  'location-outline': 'MapPin',
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
  'paper-plane-outline': 'Send',

  // extended nav / chevrons
  'chevron-back': 'ChevronLeft',
  'chevron-forward': 'ChevronRight',
  'arrow-forward': 'ArrowRight',
  'arrow-forward-outline': 'ArrowRight',
  'arrow-up': 'ArrowUp',
  'arrow-down': 'ArrowDown',
  'open-outline': 'ExternalLink',
  'open': 'ExternalLink',
  'globe': 'Globe',
  'globe-outline': 'Globe',
  'earth': 'Globe',
  'earth-outline': 'Globe',

  // content / blyp surfaces
  'sparkles': 'Sparkles',
  'sparkles-outline': 'Sparkles',
  'time': 'Clock',
  'time-outline': 'Clock',
  'bookmark': 'Bookmark',
  'bookmark-outline': 'Bookmark',
  'bookmarks-outline': 'Bookmark',
  'bookmarks': 'Bookmark',
  'folder': 'Folder',
  'folder-outline': 'Folder',
  'albums-outline': 'Album',
  'albums': 'Album',
  'image-outline': 'Image',
  'images-outline': 'Images',
  'play-outline': 'Play',
  'create': 'SquarePen',
  'create-outline': 'SquarePen',
  'pencil': 'Pencil',
  'trash': 'Trash2',
  'trash-outline': 'Trash2',
  'options-outline': 'SlidersHorizontal',
  'options': 'SlidersHorizontal',
  'filter': 'ListFilter',
  'filter-outline': 'ListFilter',
  'ellipse': 'Circle',
  'ellipse-outline': 'Circle',
  'stop': 'Square',
  'stop-circle': 'Square',

  // sharing / social
  'share-social': 'Share2',
  'share-social-outline': 'Share2',
  'notifications': 'Bell',
  'notifications-outline': 'Bell',
  'notifications-off-outline': 'BellOff',
  'person-circle': 'CircleUserRound',
  'person-circle-outline': 'CircleUserRound',
  'people-outline': 'Users',
  'heart-outline': 'Heart',
  'star-outline': 'Star',
  'flame-outline': 'Flame',
  'happy-outline': 'Smile',
  'happy': 'Smile',

  // comms extras
  'call': 'Phone',
  'call-outline': 'Phone',
  'chatbubble-ellipses-outline': 'MessageCircle',
  'chatbubble-ellipses': 'MessageCircle',
  'alert-circle-outline': 'CircleAlert',
  'reload-circle-outline': 'RefreshCw',
  'reload': 'RefreshCw',
  'refresh-outline': 'RefreshCw',
  'cloud-offline-outline': 'CloudOff',
  'cloud-offline': 'CloudOff',

  // misc app
  'camera-outline': 'Camera',
  'pricetag': 'Tag',
  'pricetag-outline': 'Tag',
  'pin': 'Pin',
  'pin-outline': 'Pin',
  'logo-bitcoin': 'Bitcoin',
  'card-outline': 'CreditCard',
  'card': 'CreditCard',
  'eye-outline': 'Eye',
  'log-out-outline': 'LogOut',
  'log-out': 'LogOut',
  'newspaper-outline': 'Newspaper',
  'newspaper': 'Newspaper',
  'trophy-outline': 'Trophy',
  'football-outline': 'Shield',
};

// Convert a kebab-case Ionicons-style name (minus -outline/-sharp) to a Lucide
// PascalCase component name, e.g. "share-social" -> "ShareSocial".
function autoLucideName(key) {
  const base = key.replace(/-(outline|sharp)$/, '');
  return base
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

// Returns a Lucide component name, or null when there's no good Lucide match.
function resolveLucide(key) {
  if (map[key]) return map[key];
  // Smart fallback: unmapped names that still match a Lucide component
  // (e.g. "image-outline" -> "Image") render instead of a blank circle.
  const auto = autoLucideName(key);
  if (auto && L[auto]) return auto;
  return null;
}

export default function Icon({ name, size = 24, color, focused = false, style, strokeWidth, fill }) {
  const key = (name || '').toString().toLowerCase();
  const lucideName = resolveLucide(key);
  if (lucideName) {
    const Comp = L[lucideName] || L.Circle;
    const solid = fill != null && fill !== false;
    return (
      <View style={style}>
        <Comp
          size={size}
          color={color}
          fill={solid ? (fill === true ? color : fill) : 'none'}
          strokeWidth={strokeWidth ?? (focused ? 2.5 : solid ? 1.5 : 2)}
        />
      </View>
    );
  }
  // The app names icons in the Ionicons convention. When there's no Lucide
  // match, render the real Ionicons glyph (e.g. "game-controller",
  // "person-add", "musical-notes") instead of degrading to a generic circle.
  if (Ionicons.glyphMap && Ionicons.glyphMap[key]) {
    return (
      <View style={style}>
        <Ionicons name={key} size={size} color={color} />
      </View>
    );
  }
  // Last resort: a neutral circle (keeps prior behaviour for truly unknown names).
  return (
    <View style={style}>
      <L.Circle size={size} color={color} strokeWidth={strokeWidth ?? (focused ? 2.5 : 2)} />
    </View>
  );
}
