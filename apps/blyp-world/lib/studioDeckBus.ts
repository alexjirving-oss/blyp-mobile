/**
 * Cross-tab / Stream Deck companion bus for LIVE Studio.
 * Deck page + Elgato Website actions write commands; booth listens.
 */

export const STUDIO_DECK_CHANNEL = "blyp.liveStudio.deck.v1";
export const STUDIO_DECK_CMD_KEY = "blyp.liveStudio.deckCommand.v1";

export type StudioDeckCommand =
  | { type: "sting"; id: string; at: number }
  | { type: "stop-music"; at: number }
  | { type: "scene"; scene: "camera" | "screen" | "screen-pip"; at: number }
  | { type: "layout"; presetIndex: number; at: number }
  | { type: "overlay-toggle"; id: string; at: number }
  | { type: "go-live"; at: number }
  | { type: "end-live"; at: number }
  | { type: "mic-toggle"; at: number }
  | { type: "cam-toggle"; at: number };

export function postStudioDeckCommand(
  cmd: StudioDeckCommand | Omit<StudioDeckCommand, "at">,
): void {
  if (typeof window === "undefined") return;
  const full = {
    ...cmd,
    at: "at" in cmd && typeof cmd.at === "number" ? cmd.at : Date.now(),
  } as StudioDeckCommand;
  try {
    window.localStorage.setItem(STUDIO_DECK_CMD_KEY, JSON.stringify(full));
  } catch {
    /* ignore */
  }
  try {
    const ch = new BroadcastChannel(STUDIO_DECK_CHANNEL);
    ch.postMessage(full);
    ch.close();
  } catch {
    /* ignore */
  }
}

export function parseStudioDeckCommand(raw: unknown): StudioDeckCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = String(o.type || "");
  const at = typeof o.at === "number" ? o.at : Date.now();
  switch (type) {
    case "sting":
      return typeof o.id === "string" ? { type, id: o.id, at } : null;
    case "stop-music":
      return { type, at };
    case "scene":
      if (
        o.scene === "camera" ||
        o.scene === "screen" ||
        o.scene === "screen-pip"
      ) {
        return { type, scene: o.scene, at };
      }
      return null;
    case "layout":
      return typeof o.presetIndex === "number"
        ? { type, presetIndex: o.presetIndex, at }
        : null;
    case "overlay-toggle":
      return typeof o.id === "string" ? { type, id: o.id, at } : null;
    case "go-live":
    case "end-live":
    case "mic-toggle":
    case "cam-toggle":
      return { type, at };
    default:
      return null;
  }
}

export function subscribeStudioDeckCommands(
  onCommand: (cmd: StudioDeckCommand) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  let lastAt = 0;

  const handle = (raw: unknown) => {
    const cmd = parseStudioDeckCommand(raw);
    if (!cmd || cmd.at <= lastAt) return;
    lastAt = cmd.at;
    onCommand(cmd);
  };

  const onStorage = (e: StorageEvent) => {
    if (e.key !== STUDIO_DECK_CMD_KEY || !e.newValue) return;
    try {
      handle(JSON.parse(e.newValue));
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("storage", onStorage);

  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(STUDIO_DECK_CHANNEL);
    ch.onmessage = (ev) => handle(ev.data);
  } catch {
    ch = null;
  }

  // Consume pending URL action from deck deep-link (?deck=sting:gift)
  try {
    const url = new URL(window.location.href);
    const deck = url.searchParams.get("deck");
    if (deck) {
      const [kind, arg] = deck.split(":");
      if (kind === "sting" && arg) handle({ type: "sting", id: arg, at: Date.now() });
      if (kind === "scene" && arg) {
        handle({ type: "scene", scene: arg as "camera", at: Date.now() });
      }
      if (kind === "stop") handle({ type: "stop-music", at: Date.now() });
      url.searchParams.delete("deck");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  } catch {
    /* ignore */
  }

  return () => {
    window.removeEventListener("storage", onStorage);
    try {
      ch?.close();
    } catch {
      /* ignore */
    }
  };
}
