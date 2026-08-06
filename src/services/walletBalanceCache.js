// walletBalanceCache.js
// Last-known coin/gem balances so Profile Wallet paints immediately.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = (uid) => `@blyp/walletBalance/${uid || 'anon'}`;
const memory = new Map();

function normalize(snap) {
  if (!snap || typeof snap !== 'object') return null;
  const coins = Number(snap.coins);
  const gems = Number(snap.gems);
  return {
    coins: Number.isFinite(coins) ? coins : 0,
    gems: Number.isFinite(gems) ? gems : 0,
    updatedAt: Number(snap.updatedAt) || Date.now(),
  };
}

export function getCachedWalletBalance(uid) {
  if (!uid) return null;
  const hit = memory.get(uid);
  return hit ? { ...hit } : null;
}

export async function loadWalletBalanceFromStorage(uid) {
  if (!uid) return null;
  if (memory.has(uid)) return { ...memory.get(uid) };
  try {
    const raw = await AsyncStorage.getItem(KEY(uid));
    if (!raw) return null;
    const parsed = normalize(JSON.parse(raw));
    if (!parsed) return null;
    memory.set(uid, parsed);
    return { ...parsed };
  } catch {
    return null;
  }
}

export async function setWalletBalanceCache(uid, { coins, gems } = {}) {
  if (!uid) return null;
  const prev = memory.get(uid) || {};
  const next = normalize({
    coins: coins != null ? coins : prev.coins,
    gems: gems != null ? gems : prev.gems,
    updatedAt: Date.now(),
  });
  if (!next) return null;
  memory.set(uid, next);
  try {
    await AsyncStorage.setItem(KEY(uid), JSON.stringify(next));
  } catch {
    /* best-effort */
  }
  return { ...next };
}

export default {
  getCachedWalletBalance,
  loadWalletBalanceFromStorage,
  setWalletBalanceCache,
};
