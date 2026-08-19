export const LEFT_RAIL_IDS = ["dest", "program", "layouts", "more"] as const;
export const RIGHT_RAIL_IDS = [
  "goal",
  "team",
  "jukebox",
  "chat",
  "guests",
  "gifts",
] as const;

export type LeftRailId = (typeof LEFT_RAIL_IDS)[number];
export type RightRailId = (typeof RIGHT_RAIL_IDS)[number];

export const LEFT_RAIL_LABELS: Record<LeftRailId, string> = {
  dest: "Destinations",
  program: "Program source",
  layouts: "Layouts",
  more: "Scenes · alerts · audio",
};

export const RIGHT_RAIL_LABELS: Record<RightRailId, string> = {
  goal: "Live goal",
  team: "Team desk",
  jukebox: "Jukebox",
  chat: "Chat",
  guests: "Guests",
  gifts: "Gifts",
};

const LEFT_KEY = "blyp.liveStudio.leftRailOrder.v1";
const RIGHT_KEY = "blyp.liveStudio.rightRailOrder.v1";

function normalizeOrder<T extends string>(
  saved: unknown,
  canonical: readonly T[],
): T[] {
  const allow = new Set(canonical);
  const next: T[] = [];
  if (Array.isArray(saved)) {
    for (const id of saved) {
      if (typeof id === "string" && allow.has(id as T) && !next.includes(id as T)) {
        next.push(id as T);
      }
    }
  }
  for (const id of canonical) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

export function loadLeftRailOrder(): LeftRailId[] {
  if (typeof window === "undefined") return [...LEFT_RAIL_IDS];
  try {
    const raw = window.localStorage.getItem(LEFT_KEY);
    return normalizeOrder(raw ? JSON.parse(raw) : null, LEFT_RAIL_IDS);
  } catch {
    return [...LEFT_RAIL_IDS];
  }
}

export function loadRightRailOrder(): RightRailId[] {
  if (typeof window === "undefined") return [...RIGHT_RAIL_IDS];
  try {
    const raw = window.localStorage.getItem(RIGHT_KEY);
    return normalizeOrder(raw ? JSON.parse(raw) : null, RIGHT_RAIL_IDS);
  } catch {
    return [...RIGHT_RAIL_IDS];
  }
}

export function saveLeftRailOrder(order: LeftRailId[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEFT_KEY, JSON.stringify(order));
  } catch {
    /* quota */
  }
}

export function saveRightRailOrder(order: RightRailId[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RIGHT_KEY, JSON.stringify(order));
  } catch {
    /* quota */
  }
}

export function moveRailId<T extends string>(order: T[], id: T, dir: -1 | 1): T[] {
  const i = order.indexOf(id);
  if (i < 0) return order;
  const j = i + dir;
  if (j < 0 || j >= order.length) return order;
  const next = order.slice();
  const swap = next[j];
  next[j] = next[i];
  next[i] = swap;
  return next;
}
