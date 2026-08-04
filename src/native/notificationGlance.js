// notificationGlance.js
//
// JS wrapper for the Android on-device notification glance (see
// android/.../notifications/*). Everything here is read on-device only; nothing
// is ever sent to a server. iOS has no equivalent system API, so this is a
// no-op there and the Hub hides the feature.

import { NativeModules, Platform } from 'react-native';

const M = Platform.OS === 'android' ? NativeModules.BlypNotificationGlance : null;

export function isSupported() {
  return !!M;
}

export async function isAccessGranted() {
  if (!M) return false;
  try { return !!(await M.isAccessGranted()); } catch { return false; }
}

export async function openAccessSettings() {
  if (!M) return;
  try { await M.openAccessSettings(); } catch { /* ignore */ }
}

export async function getRecent() {
  if (!M) return [];
  try { return (await M.getRecent()) || []; } catch { return []; }
}

export async function clearRecent() {
  if (!M) return;
  try { await M.clear(); } catch { /* ignore */ }
}

// Best-effort friendly names for the common apps; falls back to the package tail.
const APP_NAMES = {
  'com.zhiliaoapp.musically': 'TikTok',
  'com.ss.android.ugc.trill': 'TikTok',
  'com.instagram.android': 'Instagram',
  'com.snapchat.android': 'Snapchat',
  'com.whatsapp': 'WhatsApp',
  'com.facebook.katana': 'Facebook',
  'com.facebook.orca': 'Messenger',
  'com.twitter.android': 'X',
  'com.reddit.frontpage': 'Reddit',
  'com.google.android.youtube': 'YouTube',
  'org.telegram.messenger': 'Telegram',
  'com.discord': 'Discord',
  'com.google.android.gm': 'Gmail',
};

export function appLabel(pkg) {
  if (APP_NAMES[pkg]) return APP_NAMES[pkg];
  const parts = String(pkg || '').split('.').filter(Boolean);
  const last = parts[parts.length - 1] || String(pkg || 'App');
  return last.charAt(0).toUpperCase() + last.slice(1);
}

export default {
  isSupported,
  isAccessGranted,
  openAccessSettings,
  getRecent,
  clearRecent,
  appLabel,
};
