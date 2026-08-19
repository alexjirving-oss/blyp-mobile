/**
 * Ordered alert queue for LIVE Studio (TTS / SFX / feed).
 * Pause holds playback; cancel clears pending; replay re-fires last played.
 */

export type StudioAlertKind = "gift" | "chat" | "join" | "manual" | "sfx";

export type StudioAlertItem = {
  id: string;
  kind: StudioAlertKind;
  text: string;
  /** Optional sting pad id when this alert should also play SFX */
  stingId?: string;
  at: number;
  status: "pending" | "playing" | "done" | "cancelled";
};

export type StudioAlertQueueState = {
  items: StudioAlertItem[];
  paused: boolean;
  lastPlayed: StudioAlertItem | null;
};

export function createEmptyAlertQueue(): StudioAlertQueueState {
  return { items: [], paused: false, lastPlayed: null };
}

export function enqueueAlert(
  state: StudioAlertQueueState,
  partial: Omit<StudioAlertItem, "id" | "at" | "status"> & {
    id?: string;
    at?: number;
  },
): StudioAlertQueueState {
  const item: StudioAlertItem = {
    id:
      partial.id ||
      `al-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    kind: partial.kind,
    text: partial.text.trim().slice(0, 200),
    stingId: partial.stingId,
    at: partial.at ?? Date.now(),
    status: "pending",
  };
  if (!item.text && !item.stingId) return state;
  return {
    ...state,
    items: [...state.items, item].slice(-40),
  };
}

export function setAlertQueuePaused(
  state: StudioAlertQueueState,
  paused: boolean,
): StudioAlertQueueState {
  return { ...state, paused };
}

export function clearAlertQueue(
  state: StudioAlertQueueState,
): StudioAlertQueueState {
  return {
    ...state,
    items: state.items
      .filter((i) => i.status === "playing")
      .map((i) => ({ ...i, status: "cancelled" as const })),
    lastPlayed: state.lastPlayed,
  };
}

export function cancelAlert(
  state: StudioAlertQueueState,
  id: string,
): StudioAlertQueueState {
  return {
    ...state,
    items: state.items.map((i) =>
      i.id === id && i.status === "pending"
        ? { ...i, status: "cancelled" as const }
        : i,
    ),
  };
}

/** Next pending item, or null if paused / empty. */
export function peekNextAlert(
  state: StudioAlertQueueState,
): StudioAlertItem | null {
  if (state.paused) return null;
  if (state.items.some((i) => i.status === "playing")) return null;
  return state.items.find((i) => i.status === "pending") ?? null;
}

export function markAlertPlaying(
  state: StudioAlertQueueState,
  id: string,
): StudioAlertQueueState {
  return {
    ...state,
    items: state.items.map((i) =>
      i.id === id ? { ...i, status: "playing" as const } : i,
    ),
  };
}

export function markAlertDone(
  state: StudioAlertQueueState,
  id: string,
): StudioAlertQueueState {
  const played = state.items.find((i) => i.id === id) ?? null;
  return {
    ...state,
    lastPlayed: played
      ? { ...played, status: "done" }
      : state.lastPlayed,
    items: state.items.map((i) =>
      i.id === id ? { ...i, status: "done" as const } : i,
    ),
  };
}

export function pendingAlertCount(state: StudioAlertQueueState): number {
  return state.items.filter((i) => i.status === "pending").length;
}
