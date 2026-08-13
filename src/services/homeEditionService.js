import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@blyp/homeEdition';
const listeners = new Set();
let current = 'next';
let hydrated = false;

function emit() {
  for (const fn of listeners) {
    try {
      fn(current);
    } catch {
      /* ignore */
    }
  }
}

async function hydrate() {
  if (hydrated) return current;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === 'classic' || raw === 'next') current = raw;
  } catch {
    /* keep default */
  }
  hydrated = true;
  emit();
  return current;
}

export function getHomeEdition() {
  return current;
}

export function subscribeHomeEdition(cb) {
  listeners.add(cb);
  void hydrate().then(() => cb(current));
  return () => listeners.delete(cb);
}

export async function setHomeEdition(next) {
  current = next === 'classic' ? 'classic' : 'next';
  emit();
  try {
    await AsyncStorage.setItem(KEY, current);
  } catch {
    /* ignore */
  }
  return current;
}
