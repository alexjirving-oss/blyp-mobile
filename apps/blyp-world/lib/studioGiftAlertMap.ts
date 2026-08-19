/**
 * Map gift events → sting + feed flash for LIVE Studio.
 * Local prefs only — not a full TikFinity asset library.
 */

import type { StingId } from "@/components/BlypStudio/audio/StudioAudioEngine";

const KEY = "blyp.liveStudio.giftAlertMap.v1";

export type GiftAlertMapPrefs = {
  /** Default sting for any gift */
  defaultSting: StingId;
  /** Minimum coin delta before alert fires */
  minCoins: number;
  /** Flash gift overlay widget when alert fires */
  flashGiftOverlay: boolean;
  /** High-tier threshold (coins) → airhorn */
  highTierCoins: number;
  highTierSting: StingId;
};

export const DEFAULT_GIFT_ALERT_MAP: GiftAlertMapPrefs = {
  defaultSting: "gift",
  minCoins: 1,
  flashGiftOverlay: true,
  highTierCoins: 500,
  highTierSting: "airhorn",
};

export function loadGiftAlertMap(): GiftAlertMapPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_GIFT_ALERT_MAP };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_GIFT_ALERT_MAP };
    const p = JSON.parse(raw) as Partial<GiftAlertMapPrefs>;
    return {
      defaultSting: (p.defaultSting as StingId) || "gift",
      minCoins: Math.max(1, Number(p.minCoins) || 1),
      flashGiftOverlay: p.flashGiftOverlay !== false,
      highTierCoins: Math.max(1, Number(p.highTierCoins) || 500),
      highTierSting: (p.highTierSting as StingId) || "airhorn",
    };
  } catch {
    return { ...DEFAULT_GIFT_ALERT_MAP };
  }
}

export function saveGiftAlertMap(prefs: GiftAlertMapPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* quota */
  }
}

export function resolveGiftSting(
  coins: number,
  prefs: GiftAlertMapPrefs = loadGiftAlertMap(),
): StingId | null {
  if (coins < prefs.minCoins) return null;
  if (coins >= prefs.highTierCoins) return prefs.highTierSting;
  return prefs.defaultSting;
}
