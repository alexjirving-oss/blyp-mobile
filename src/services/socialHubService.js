// socialHubService.js
//
// Phase 0 of the Blyp Hub — "your calm command center".
//
// This phase is deliberately the lowest-risk, fully cross-platform slice:
//   • a launcher that opens the social apps you already use (deep link → web fallback)
//   • outward sharing of a Blyp link via the native share sheet
//
// Charter-aligned by design: this module reads NOTHING from other apps and sends
// NOTHING to any server. Which apps you keep in your hub is stored ONLY on your
// device (AsyncStorage). Later phases (a "what's new" digest and, on Android, an
// on-device notification glance) build on top without changing this contract.

import { Linking, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'blyp.hub.apps.v1';

// The catalog. `appUrl` is the native scheme we try first; `webUrl` is the
// always-works fallback if the app isn't installed. No private data is ever read.
export const HUB_PLATFORMS = [
  { id: 'tiktok', label: 'TikTok', icon: 'logo-tiktok', appUrl: 'tiktok://', webUrl: 'https://www.tiktok.com', shareOut: true },
  { id: 'instagram', label: 'Instagram', icon: 'logo-instagram', appUrl: 'instagram://app', webUrl: 'https://www.instagram.com', shareOut: true },
  { id: 'snapchat', label: 'Snapchat', icon: 'logo-snapchat', appUrl: 'snapchat://', webUrl: 'https://www.snapchat.com', shareOut: true },
  { id: 'youtube', label: 'YouTube', icon: 'logo-youtube', appUrl: 'youtube://', webUrl: 'https://www.youtube.com', shareOut: true },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp', appUrl: 'whatsapp://', webUrl: 'https://web.whatsapp.com', shareOut: true },
  { id: 'facebook', label: 'Facebook', icon: 'logo-facebook', appUrl: 'fb://', webUrl: 'https://www.facebook.com', shareOut: true },
  { id: 'x', label: 'X', icon: 'logo-twitter', appUrl: 'twitter://', webUrl: 'https://x.com', shareOut: true },
  { id: 'reddit', label: 'Reddit', icon: 'logo-reddit', appUrl: 'reddit://', webUrl: 'https://www.reddit.com', shareOut: true },
  { id: 'discord', label: 'Discord', icon: 'logo-discord', appUrl: 'discord://', webUrl: 'https://discord.com/app', shareOut: false },
  { id: 'telegram', label: 'Telegram', icon: 'paper-plane', appUrl: 'tg://', webUrl: 'https://web.telegram.org', shareOut: true },
];

// A friendly default set so the hub isn't empty on first open.
const DEFAULT_IDS = ['tiktok', 'instagram', 'snapchat', 'youtube', 'whatsapp'];

export function getPlatform(id) {
  return HUB_PLATFORMS.find((p) => p.id === id) || null;
}

/** The user's chosen hub apps (ids), stored on-device only. */
export async function getEnabledIds() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw == null) return [...DEFAULT_IDS];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.filter((id) => !!getPlatform(id));
  } catch { /* fall through */ }
  return [...DEFAULT_IDS];
}

/** Resolve enabled ids to full platform objects, preserving catalog order. */
export async function getEnabledPlatforms() {
  const ids = new Set(await getEnabledIds());
  return HUB_PLATFORMS.filter((p) => ids.has(p.id));
}

export async function setEnabledIds(ids) {
  const clean = Array.from(new Set((ids || []).filter((id) => !!getPlatform(id))));
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); } catch { /* ignore */ }
  return clean;
}

export async function toggleApp(id) {
  if (!getPlatform(id)) return getEnabledIds();
  const ids = await getEnabledIds();
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  return setEnabledIds(next);
}

/**
 * Open an app: try its native scheme, fall back to the web. Returns how it opened.
 * Reads nothing — this is just a launcher.
 */
export async function launchApp(app) {
  const platform = typeof app === 'string' ? getPlatform(app) : app;
  if (!platform) return { ok: false, via: 'none' };
  try {
    await Linking.openURL(platform.appUrl);
    return { ok: true, via: 'app' };
  } catch {
    try {
      await Linking.openURL(platform.webUrl);
      return { ok: true, via: 'web' };
    } catch {
      return { ok: false, via: 'none' };
    }
  }
}

/** Outward share via the native share sheet (post once → anywhere installed). */
export async function shareOut({ message, url } = {}) {
  const text = [message, url].filter(Boolean).join(' ').trim() || 'Check out Blyp';
  try {
    await Share.share({ message: text, ...(url ? { url } : {}) });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || 'share-failed' };
  }
}

export default {
  HUB_PLATFORMS,
  getPlatform,
  getEnabledIds,
  getEnabledPlatforms,
  setEnabledIds,
  toggleApp,
  launchApp,
  shareOut,
};
