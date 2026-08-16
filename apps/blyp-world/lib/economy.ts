"use client";

import { liveServiceUrl } from "./env";
export { WEB_COIN_PACKS } from "./coinPacks";

export type WalletBalance = {
  coins: number;
  gems?: number;
};

export type GiftItem = {
  giftId: string;
  name: string;
  coinCost: number;
  emoji?: string;
};

export const FALLBACK_GIFTS: GiftItem[] = [
  { giftId: "heart", name: "Heart", coinCost: 1, emoji: "❤️" },
  { giftId: "thumbsup", name: "Thumbs Up", coinCost: 2, emoji: "👍" },
  { giftId: "clap", name: "Clap", coinCost: 5, emoji: "👏" },
  { giftId: "fire", name: "Fire", coinCost: 10, emoji: "🔥" },
  { giftId: "star", name: "Star", coinCost: 15, emoji: "⭐" },
  { giftId: "diamond", name: "Diamond", coinCost: 25, emoji: "💎" },
  { giftId: "crown", name: "Crown", coinCost: 50, emoji: "👑" },
  { giftId: "rocket", name: "Rocket", coinCost: 100, emoji: "🚀" },
];

async function economyFetch<T>(
  path: string,
  idToken: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>,
): Promise<T> {
  let url = `${liveServiceUrl}${path}`;
  if (method === "GET") {
    url += (url.includes("?") ? "&" : "?") + `_ts=${Date.now()}`;
  }
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      "Cache-Control": "no-cache",
    },
    cache: "no-store",
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (json as { error?: string; detail?: string })?.error ||
      (json as { detail?: string })?.detail ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

export async function fetchWallet(idToken: string): Promise<WalletBalance> {
  const data = await economyFetch<Record<string, unknown>>("/wallet", idToken);
  const coins = Number(
    data.coins ?? data.coinBalance ?? data.balance ?? data.purchasedCoins ?? 0,
  );
  return { coins: Number.isFinite(coins) ? coins : 0, gems: Number(data.gems) || 0 };
}

export async function fetchGiftCatalog(idToken: string): Promise<GiftItem[]> {
  try {
    const data = await economyFetch<{
      gifts?: Array<Record<string, unknown>>;
      catalog?: Array<Record<string, unknown>>;
    }>("/economy/catalog", idToken);
    const rows = data.gifts || data.catalog || [];
    const mapped = rows
      .map((g) => ({
        giftId: String(g.giftId || g.gift_id || ""),
        name: String(g.name || g.giftId || ""),
        coinCost: Number(g.coinCost ?? g.coin_cost ?? 0),
        emoji:
          (g.asset_json as { emoji?: string } | undefined)?.emoji ||
          (g.asset as { emoji?: string } | undefined)?.emoji ||
          undefined,
      }))
      .filter((g) => g.giftId && g.coinCost > 0);
    return mapped.length ? mapped : FALLBACK_GIFTS;
  } catch {
    return FALLBACK_GIFTS;
  }
}

export async function sendGift(opts: {
  idToken: string;
  postOrStreamId: string;
  receiverUserId: string;
  giftId: string;
  quantity?: number;
}): Promise<unknown> {
  const idempotencyKey = `web_${opts.postOrStreamId}_${opts.giftId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return economyFetch("/gift/send", opts.idToken, "POST", {
    idempotencyKey,
    streamId: opts.postOrStreamId,
    receiverUserId: opts.receiverUserId,
    giftId: opts.giftId,
    quantity: opts.quantity ?? 1,
  });
}

export async function createCheckoutSession(opts: {
  packId: string;
  idToken: string;
}): Promise<{ url: string }> {
  const res = await fetch("/.netlify/functions/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.idToken}`,
    },
    body: JSON.stringify({ packId: opts.packId }),
  });
  const json = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !json.url) {
    throw new Error(json.error || `Checkout failed (${res.status})`);
  }
  return { url: json.url };
}
