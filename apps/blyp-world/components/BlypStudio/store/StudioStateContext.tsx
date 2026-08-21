"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { studioAudio } from "../audio/StudioAudioEngine";
import {
  defaultOverlays,
  type LayoutOrientation,
  type LayoutPreset,
  type OverlayAnchor,
  type OverlayInstance,
  type OverlayKind,
  createOverlay,
} from "../overlays/catalog";
import {
  GRID9_BUYBACK_COST_COINS,
  GRID9_HOUSE_JACKPOT_SEED,
  GRID9_MAX_HEALTH,
  GRID9_MAX_MATCH_DURATION_MS,
  GRID9_NUKE_DEMO_FACE_COINS,
  applyHpDelta,
  formatMatchClock,
  giftHpDelta,
  knockoutTokenPayout,
  pickFinaleWinnerSlotIndex,
  splitGrid9AudienceGiftCoins,
} from "@/lib/grid9Economy";

/** Per-aspect overlay xy/anchor snap so Portrait ≠ Landscape publish maps. */
type OverlayPosSnap = Partial<
  Record<OverlayKind, { x: number; y: number; anchor: OverlayAnchor }>
>;

function snapshotOverlayPos(overlays: OverlayInstance[]): OverlayPosSnap {
  const out: OverlayPosSnap = {};
  for (const o of overlays) {
    out[o.kind] = { x: o.x, y: o.y, anchor: o.anchor };
  }
  return out;
}

function applyOverlayPosSnap(
  overlays: OverlayInstance[],
  snap: OverlayPosSnap | undefined,
): OverlayInstance[] {
  if (!snap) return overlays;
  return overlays.map((o) => {
    const s = snap[o.kind];
    if (!s) return o;
    return { ...o, x: s.x, y: s.y, anchor: s.anchor };
  });
}

function emptyAspectLayouts(): Record<LayoutOrientation, LayoutPreset> {
  return { portrait: "solo", landscape: "solo" };
}

function emptyAspectOverlaySnaps(): Record<LayoutOrientation, OverlayPosSnap> {
  const base = snapshotOverlayPos(defaultOverlays());
  return {
    portrait: { ...base },
    landscape: { ...base },
  };
}

export type StreamHealth = "EXCELLENT" | "WARNING" | "CRITICAL" | "OFFLINE";
export type ActiveMode = "JUST_CHATTING" | "GRID9";
export type GridSlotKind = "empty" | "host" | "guest" | "sentinel";
export type DeskScene = "camera" | "screen" | "screen-pip";

/** @deprecated Phase 2 alias — prefer AuditionApplicant */
export type QueuedGuest = {
  id: string;
  displayName: string;
};

export type GridSlot = {
  index: number;
  kind: GridSlotKind;
  displayName: string | null;
  avatarLabel: string | null;
  health: number;
  shields: number;
  /** Knocked out (HP ≤ 0). */
  knockedOut: boolean;
  /** Pending/demo KO token payout (floor(face * 0.5)). */
  knockoutTokens: number;
  /** Accumulated seat-share credits (100% of gift faces; demo + live tally). */
  seatShareCoins: number;
};

export type AuditionApplicant = {
  id: string;
  username: string;
  avatarLabel: string;
  micChecked: boolean;
};

export type SocialFeedEvent = {
  id: string;
  text: string;
  createdAt: number;
};

const HOUSE_JACKPOT_SEED = GRID9_HOUSE_JACKPOT_SEED;
const DEFAULT_HEALTH = GRID9_MAX_HEALTH;
const DEFAULT_SHIELDS = 0;
/** Studio mock roulette duration (~4s decelerating highlight). */
export const ROULETTE_DURATION_MS = 4000;

const SENTINEL_NAMES = [
  "Sentinel-Alpha",
  "Sentinel-Bravo",
  "Sentinel-Charlie",
  "Sentinel-Delta",
  "Sentinel-Echo",
  "Sentinel-Foxtrot",
  "Sentinel-Golf",
  "Sentinel-Hotel",
] as const;

const MOCK_APPLICANTS: AuditionApplicant[] = [
  { id: "aud-1", username: "nova_byte", avatarLabel: "NB", micChecked: true },
  { id: "aud-2", username: "pixel_queen", avatarLabel: "PQ", micChecked: true },
  { id: "aud-3", username: "rift_runner", avatarLabel: "RR", micChecked: false },
  { id: "aud-4", username: "glow_fox", avatarLabel: "GF", micChecked: true },
  { id: "aud-5", username: "static_jay", avatarLabel: "SJ", micChecked: true },
];

const MOCK_GIFTS = [
  { viewer: "viewer_one", gift: "BOMB", slot: 2, coins: 500, kind: "damage" as const },
  { viewer: "coin_whale", gift: "ARROW", slot: 3, coins: 50, kind: "damage" as const },
  { viewer: "chatty_kat", gift: "KISS", slot: 1, coins: 100, kind: "heal" as const },
  { viewer: "grid_fan", gift: "FIREBALL", slot: 5, coins: 25, kind: "damage" as const },
] as const;

function emptySlots(): GridSlot[] {
  return Array.from({ length: 9 }, (_, i) => {
    const index = i + 1;
    if (index === 1) {
      return {
        index,
        kind: "host" as const,
        displayName: "HOST",
        avatarLabel: "H",
        health: DEFAULT_HEALTH,
        shields: DEFAULT_SHIELDS,
        knockedOut: false,
        knockoutTokens: 0,
        seatShareCoins: 0,
      };
    }
    return {
      index,
      kind: "empty" as const,
      displayName: null,
      avatarLabel: null,
      health: DEFAULT_HEALTH,
      shields: DEFAULT_SHIELDS,
      knockedOut: false,
      knockoutTokens: 0,
      seatShareCoins: 0,
    };
  });
}

function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export type SocketStatus =
  | "offline"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";
export type EconomySource = "mock" | "live";

export type DirectorBackend = {
  mode: "live" | "mock";
  /** Return true if live path fully handled (skip local mock). */
  spinRoulette: () => boolean;
  autoFillSentinels: () => boolean;
  resetMatch: () => boolean;
  kickPlayer?: (targetUserId: string) => boolean;
  buyback?: () => boolean;
};

export type MatchEndReason = "last_standing" | "deadline_finale" | null;

export type StudioState = {
  /**
   * Live flag — Phase 4: driven by real IVS publish when GO LIVE succeeds.
   * Still UI-synced (pulse / END STREAM) via BottomConsole.
   */
  isLive: boolean;
  streamHealth: StreamHealth;
  activeMode: ActiveMode;
  /** House seed 100 on GRID9 enter / Reset Match. Gift +10% pot match + buybacks add here. */
  jackpotPool: number;
  /** Gift 100% seat credits (studio mock) or ARSENAL_GRANTED.seatCoins when live. */
  hostGems: number;
  topSupporters: string[];
  /** @deprecated use auditionQueue */
  queuedGuests: QueuedGuest[];
  auditionQueue: AuditionApplicant[];
  gridSlots: GridSlot[];
  socialFeed: SocialFeedEvent[];
  spotlightSlot: number;
  focusSlot: number | null;
  rouletteHighlightSlot: number | null;
  isRouletteSpinning: boolean;
  /** Epoch ms when the 60m mock/live match clock expires; null when idle. */
  matchDeadlineAt: number | null;
  /** Remaining ms for UI clock (ticked); null when no active match clock. */
  matchRemainingMs: number | null;
  /** Winner seat 1–9 after last-standing or deadline finale. */
  matchWinnerSlot: number | null;
  matchEndReason: MatchEndReason;
  publishError: string | null;
  publishBusy: boolean;
  socketStatus: SocketStatus;
  economySource: EconomySource;
  /** Clean Feed canvas draws STAND BY slate when true. */
  standBySignal: boolean;
  /** Webcam ended — freeze last frame / show host avatar. */
  cameraFrozen: boolean;
  /** Active host session id when GO LIVE succeeded (guest/chat poll). */
  hostSessionId: string | null;
  /** Program scene: camera / screen / screen+PIP. */
  deskScene: DeskScene;
  layoutOrientation: LayoutOrientation;
  layoutPreset: LayoutPreset;
  overlays: OverlayInstance[];
  /** Shared refs for Clean Feed → IVS (avoid re-render loops). */
  previewStreamRef: MutableRefObject<MediaStream | null>;
  cleanFeedStreamRef: MutableRefObject<MediaStream | null>;
  setHostSessionId: (id: string | null) => void;
  setDeskScene: (scene: DeskScene) => void;
  setLayoutOrientation: (o: LayoutOrientation) => void;
  setLayoutPreset: (p: LayoutPreset) => void;
  toggleOverlay: (id: string) => void;
  setOverlayCleanFeed: (id: string, visible: boolean) => void;
  addOverlay: (kind: OverlayKind) => void;
  setIsLive: (next: boolean) => void;
  toggleIsLive: () => void;
  setPublishError: (msg: string | null) => void;
  setPublishBusy: (busy: boolean) => void;
  setActiveMode: (mode: ActiveMode) => void;
  toggleGrid9Engine: () => void;
  spinRoulette: () => void;
  autoFillSentinels: () => void;
  resetMatch: () => void;
  promoteToGrid: (applicantId: string) => void;
  kickSlot: (slotIndex: number) => void;
  /** KO buyback: 500 coins → jackpot, revive at 1000 HP (mock) or emit BUYBACK (live). */
  buybackSlot: (slotIndex: number) => void;
  setFocusSlot: (slot: number | null) => void;
  setSocketStatus: (s: SocketStatus) => void;
  setEconomySource: (s: EconomySource) => void;
  setStandBySignal: (on: boolean) => void;
  setCameraFrozen: (on: boolean) => void;
  registerDirectorBackend: (backend: DirectorBackend | null) => void;
  pushFeed: (text: string) => void;
  applyLiveJackpot: (currentCoins: number, deltaCoins: number) => void;
  applyLiveGift: (args: {
    seatCoins: number;
    jackpotCoins: number;
    jackpotTotal?: number;
    text: string;
    viewer?: string;
    slotIndex?: number;
    healthAfter?: number;
    eliminated?: boolean;
    knockoutTokens?: number;
    costCoins?: number;
  }) => void;
  /** Demo Nuke / weapon strike on a cell (1–9). Returns false if cell already KO. */
  applyNukeStrike: (slotIndex1to9: number, faceCoins?: number) => boolean;
  applyLivePlayers: (
    players: Array<{
      slotIndex0to8: number;
      health: number;
      shields?: number;
      knockedOut?: boolean;
      seatShareCoins?: number;
      knockoutTokens?: number;
      displayName?: string | null;
    }>,
  ) => void;
  applyLiveRouletteStart: (args: {
    selectedSlot: number;
    candidateSlots: number[];
    endsAt: string | null;
  }) => void;
  applyLiveRouletteLand: (spotlightSlot: number | null) => void;
  applyLiveBuyback: (args: {
    slotIndex0to8: number;
    healthAfter: number;
    jackpotTotal: number;
    costCoins: number;
    displayName?: string;
  }) => void;
  applyLiveMatchCompleted: (args: {
    winnerSlot1to9: number | null;
    reason: MatchEndReason;
    jackpotCoins?: number;
  }) => void;
  applyLiveMatchDeadline: (deadlineIso: string | null) => void;
  formatMatchClock: typeof formatMatchClock;
};

const StudioStateContext = createContext<StudioState | null>(null);

export function StudioStateProvider({ children }: { children: ReactNode }) {
  const [isLive, setIsLiveRaw] = useState(false);
  const [streamHealth, setStreamHealth] = useState<StreamHealth>("OFFLINE");
  const [activeMode, setActiveModeRaw] = useState<ActiveMode>("JUST_CHATTING");
  const [jackpotPool, setJackpotPool] = useState(0);
  const [hostGems, setHostGems] = useState(0);
  const [topSupporters, setTopSupporters] = useState<string[]>([]);
  const [auditionQueue, setAuditionQueue] =
    useState<AuditionApplicant[]>(MOCK_APPLICANTS);
  const [gridSlots, setGridSlots] = useState<GridSlot[]>(emptySlots);
  const [socialFeed, setSocialFeed] = useState<SocialFeedEvent[]>([]);
  const [spotlightSlot, setSpotlightSlot] = useState(1);
  const [focusSlot, setFocusSlot] = useState<number | null>(null);
  const [rouletteHighlightSlot, setRouletteHighlightSlot] = useState<
    number | null
  >(null);
  const [isRouletteSpinning, setIsRouletteSpinning] = useState(false);
  const [matchDeadlineAt, setMatchDeadlineAt] = useState<number | null>(null);
  const [matchRemainingMs, setMatchRemainingMs] = useState<number | null>(null);
  const [matchWinnerSlot, setMatchWinnerSlot] = useState<number | null>(null);
  const [matchEndReason, setMatchEndReason] = useState<MatchEndReason>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("offline");
  const [economySource, setEconomySource] = useState<EconomySource>("mock");
  const [standBySignal, setStandBySignal] = useState(false);
  const [cameraFrozen, setCameraFrozen] = useState(false);
  const [hostSessionId, setHostSessionId] = useState<string | null>(null);
  const [deskScene, setDeskScene] = useState<DeskScene>("camera");
  const [layoutOrientation, setLayoutOrientationRaw] =
    useState<LayoutOrientation>("portrait");
  const [layoutPreset, setLayoutPresetRaw] = useState<LayoutPreset>("solo");
  const [overlays, setOverlays] = useState<OverlayInstance[]>(() =>
    defaultOverlays(),
  );
  const layoutOrientationRef = useRef<LayoutOrientation>("portrait");
  const layoutByAspectRef = useRef(emptyAspectLayouts());
  const overlaySnapByAspectRef = useRef(emptyAspectOverlaySnaps());
  layoutOrientationRef.current = layoutOrientation;
  const rouletteTimers = useRef<number[]>([]);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const cleanFeedStreamRef = useRef<MediaStream | null>(null);
  const directorBackendRef = useRef<DirectorBackend | null>(null);
  const gridSlotsRef = useRef(gridSlots);
  const auditionQueueRef = useRef(auditionQueue);
  gridSlotsRef.current = gridSlots;
  auditionQueueRef.current = auditionQueue;

  const setLayoutOrientation = useCallback((next: LayoutOrientation) => {
    const cur = layoutOrientationRef.current;
    if (next === cur) return;
    setOverlays((prev) => {
      overlaySnapByAspectRef.current[cur] = snapshotOverlayPos(prev);
      return applyOverlayPosSnap(prev, overlaySnapByAspectRef.current[next]);
    });
    setLayoutPresetRaw(layoutByAspectRef.current[next]);
    setLayoutOrientationRaw(next);
  }, []);

  const setLayoutPreset = useCallback((preset: LayoutPreset) => {
    layoutByAspectRef.current[layoutOrientationRef.current] = preset;
    setLayoutPresetRaw(preset);
  }, []);

  const clearRouletteTimers = useCallback(() => {
    rouletteTimers.current.forEach((id) => window.clearTimeout(id));
    rouletteTimers.current = [];
  }, []);

  useEffect(() => () => clearRouletteTimers(), [clearRouletteTimers]);

  const pushFeed = useCallback((text: string) => {
    setSocialFeed((prev) =>
      [
        { id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, createdAt: Date.now() },
        ...prev,
      ].slice(0, 40),
    );
  }, []);

  const matchEndReasonRef = useRef<MatchEndReason>(null);
  matchEndReasonRef.current = matchEndReason;

  const armMatchClock = useCallback((deadlineMs?: number) => {
    const deadline =
      typeof deadlineMs === "number" && Number.isFinite(deadlineMs)
        ? deadlineMs
        : Date.now() + GRID9_MAX_MATCH_DURATION_MS;
    setMatchDeadlineAt(deadline);
    setMatchRemainingMs(Math.max(0, deadline - Date.now()));
    setMatchWinnerSlot(null);
    setMatchEndReason(null);
  }, []);

  const resolveMatchFromSlots = useCallback(
    (slots: GridSlot[], reason: Exclude<MatchEndReason, null>) => {
      if (matchEndReasonRef.current) return;
      const occupied = slots.filter((s) => s.kind !== "empty");
      if (reason === "last_standing") {
        const alive = occupied.filter((s) => !s.knockedOut && s.health > 0);
        if (alive.length !== 1) return;
        const winner = alive[0]!.index;
        matchEndReasonRef.current = "last_standing";
        setMatchWinnerSlot(winner);
        setMatchEndReason("last_standing");
        setMatchRemainingMs(0);
        pushFeed(
          `🏆 Last standing — Slot ${winner} (${alive[0]!.displayName ?? "player"}) wins.`,
        );
        return;
      }
      const winner0 = pickFinaleWinnerSlotIndex(
        occupied.map((s) => ({
          slotIndex: s.index - 1,
          health: s.health,
          shields: s.shields,
          knockedOut: s.knockedOut,
        })),
      );
      if (winner0 == null) {
        matchEndReasonRef.current = "deadline_finale";
        setMatchEndReason("deadline_finale");
        setMatchRemainingMs(0);
        pushFeed("⏱ Match clock expired — no survivors.");
        return;
      }
      const winner = winner0 + 1;
      matchEndReasonRef.current = "deadline_finale";
      setMatchWinnerSlot(winner);
      setMatchEndReason("deadline_finale");
      setMatchRemainingMs(0);
      const name =
        occupied.find((s) => s.index === winner)?.displayName ?? "player";
      pushFeed(
        `⏱ Deadline finale — Slot ${winner} (${name}) wins (highest HP+shield).`,
      );
    },
    [pushFeed],
  );

  // Match countdown tick + deadline finale (mock). Live uses MATCH_COMPLETED.
  useEffect(() => {
    if (activeMode !== "GRID9" || matchDeadlineAt == null || matchEndReason) {
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, matchDeadlineAt - Date.now());
      setMatchRemainingMs(remaining);
      if (remaining <= 0 && economySource === "mock") {
        resolveMatchFromSlots(gridSlotsRef.current, "deadline_finale");
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [
    activeMode,
    matchDeadlineAt,
    matchEndReason,
    economySource,
    resolveMatchFromSlots,
  ]);

  const toggleOverlay = useCallback((id: string) => {
    setOverlays((prev) =>
      prev.map((o) => (o.id === id ? { ...o, enabled: !o.enabled } : o)),
    );
  }, []);

  const setOverlayCleanFeed = useCallback((id: string, visible: boolean) => {
    setOverlays((prev) =>
      prev.map((o) =>
        o.id === id ? { ...o, visibleOnCleanFeed: visible } : o,
      ),
    );
  }, []);

  const addOverlay = useCallback((kind: OverlayKind) => {
    setOverlays((prev) => {
      if (prev.some((o) => o.kind === kind && o.enabled)) return prev;
      return [...prev, createOverlay(kind)];
    });
  }, []);

  const applyGiftAllocation = useCallback(
    (
      coins: number,
      text: string,
      viewer?: string,
      opts?: {
        slotIndex?: number;
        kind?: "damage" | "heal";
      },
    ) => {
      const { seatCoins, jackpotCoins } = splitGrid9AudienceGiftCoins(coins);
      setJackpotPool((p) => p + jackpotCoins);
      setHostGems((g) => g + seatCoins);
      if (viewer) {
        setTopSupporters((prev) => {
          const next = [viewer, ...prev.filter((v) => v !== viewer)];
          return next.slice(0, 3);
        });
      }
      const slotIndex = opts?.slotIndex;
      const kind = opts?.kind ?? "damage";
      if (typeof slotIndex === "number") {
        setGridSlots((slots) => {
          const next = slots.map((s) => {
            if (s.index !== slotIndex || s.knockedOut) return s;
            const delta = giftHpDelta(coins, kind);
            const { health, eliminated } = applyHpDelta(s.health, delta);
            const koTokens = eliminated ? knockoutTokenPayout(coins) : 0;
            return {
              ...s,
              health,
              knockedOut: eliminated,
              knockoutTokens: eliminated ? koTokens : s.knockoutTokens,
              seatShareCoins: s.seatShareCoins + seatCoins,
            };
          });
          if (economySource === "mock") {
            queueMicrotask(() =>
              resolveMatchFromSlots(next, "last_standing"),
            );
          }
          return next;
        });
      }
      studioAudio.playGiftDrop();
      pushFeed(text);
    },
    [pushFeed, economySource, resolveMatchFromSlots],
  );

  // Mock gift drip while in GRID9 — paused when live socket economy is active.
  useEffect(() => {
    if (activeMode !== "GRID9") return;
    if (economySource === "live") return;
    let i = 0;
    const id = window.setInterval(() => {
      const g = MOCK_GIFTS[i % MOCK_GIFTS.length];
      i += 1;
      const { jackpotCoins } = splitGrid9AudienceGiftCoins(g.coins);
      const hpNote =
        g.kind === "heal"
          ? `+${g.coins} HP`
          : `−${g.coins} HP`;
      applyGiftAllocation(
        g.coins,
        `[mock] ⚡ @${g.viewer} dropped ${g.gift} on Slot ${g.slot} (${hpNote}; seat +${g.coins} / pot +${jackpotCoins} match)`,
        g.viewer,
        { slotIndex: g.slot, kind: g.kind },
      );
    }, 7000);
    return () => window.clearInterval(id);
  }, [activeMode, economySource, applyGiftAllocation]);

  const registerDirectorBackend = useCallback(
    (backend: DirectorBackend | null) => {
      directorBackendRef.current = backend;
    },
    [],
  );

  const applyLiveJackpot = useCallback(
    (currentCoins: number, deltaCoins: number) => {
      setJackpotPool(currentCoins);
      if (deltaCoins !== 0) {
        pushFeed(
          `💰 JACKPOT_CHANGED → ${currentCoins} (Δ ${deltaCoins > 0 ? "+" : ""}${deltaCoins})`,
        );
      }
    },
    [pushFeed],
  );

  const applyLiveGift = useCallback(
    (args: {
      seatCoins: number;
      jackpotCoins: number;
      jackpotTotal?: number;
      text: string;
      viewer?: string;
      slotIndex?: number;
      healthAfter?: number;
      eliminated?: boolean;
      knockoutTokens?: number;
      costCoins?: number;
    }) => {
      if (typeof args.jackpotTotal === "number") {
        setJackpotPool(args.jackpotTotal);
      } else {
        setJackpotPool((p) => p + args.jackpotCoins);
      }
      setHostGems((g) => g + args.seatCoins);
      if (args.viewer) {
        setTopSupporters((prev) => {
          const next = [args.viewer!, ...prev.filter((v) => v !== args.viewer)];
          return next.slice(0, 3);
        });
      }
      if (typeof args.slotIndex === "number") {
        setGridSlots((slots) =>
          slots.map((s) => {
            if (s.index !== args.slotIndex) return s;
            const health =
              typeof args.healthAfter === "number" ? args.healthAfter : s.health;
            const eliminated = Boolean(args.eliminated) || health <= 0;
            return {
              ...s,
              health,
              knockedOut: eliminated,
              knockoutTokens: eliminated
                ? (args.knockoutTokens ??
                  knockoutTokenPayout(args.costCoins ?? 0))
                : s.knockoutTokens,
              seatShareCoins: s.seatShareCoins + args.seatCoins,
            };
          }),
        );
      }
      studioAudio.playGiftDrop();
      pushFeed(args.text);
    },
    [pushFeed],
  );

  const applyNukeStrike = useCallback(
    (slotIndex1to9: number, faceCoins = GRID9_NUKE_DEMO_FACE_COINS) => {
      const slot = gridSlotsRef.current.find((s) => s.index === slotIndex1to9);
      if (!slot || slot.knockedOut) return false;
      const { seatCoins, jackpotCoins } = splitGrid9AudienceGiftCoins(faceCoins);
      setJackpotPool((p) => p + jackpotCoins);
      setHostGems((g) => g + seatCoins);
      let didKo = false;
      let koTokens = 0;
      setGridSlots((slots) => {
        const next = slots.map((s) => {
          if (s.index !== slotIndex1to9 || s.knockedOut) return s;
          const { health, eliminated } = applyHpDelta(
            s.health,
            giftHpDelta(faceCoins, "damage"),
          );
          koTokens = eliminated ? knockoutTokenPayout(faceCoins) : 0;
          didKo = eliminated;
          return {
            ...s,
            health,
            knockedOut: eliminated,
            knockoutTokens: eliminated ? koTokens : s.knockoutTokens,
            seatShareCoins: s.seatShareCoins + seatCoins,
          };
        });
        if (economySource === "mock") {
          queueMicrotask(() => resolveMatchFromSlots(next, "last_standing"));
        }
        return next;
      });
      pushFeed(
        `💥 Nuke −${faceCoins} HP on Slot ${slotIndex1to9} (+${jackpotCoins} pot)` +
          (didKo ? ` · KO → ${koTokens} tokens` : ""),
      );
      return true;
    },
    [pushFeed, economySource, resolveMatchFromSlots],
  );

  const applyLivePlayers = useCallback(
    (
      players: Array<{
        slotIndex0to8: number;
        health: number;
        shields?: number;
        knockedOut?: boolean;
        seatShareCoins?: number;
        knockoutTokens?: number;
        displayName?: string | null;
      }>,
    ) => {
      setGridSlots((slots) =>
        slots.map((s) => {
          const p = players.find((x) => x.slotIndex0to8 + 1 === s.index);
          if (!p) return s;
          const health = Math.max(0, Math.floor(p.health));
          const knockedOut = p.knockedOut ?? health <= 0;
          return {
            ...s,
            health,
            shields:
              typeof p.shields === "number" ? p.shields : s.shields,
            knockedOut,
            seatShareCoins:
              typeof p.seatShareCoins === "number"
                ? p.seatShareCoins
                : s.seatShareCoins,
            knockoutTokens:
              typeof p.knockoutTokens === "number"
                ? p.knockoutTokens
                : knockedOut
                  ? s.knockoutTokens
                  : 0,
            displayName:
              p.displayName !== undefined ? p.displayName : s.displayName,
            kind:
              s.kind === "empty" && p.displayName
                ? ("guest" as const)
                : s.kind,
          };
        }),
      );
    },
    [],
  );

  const runLocalSpin = useCallback(
    (forcedWinner?: number) => {
      clearRouletteTimers();
      setIsRouletteSpinning(true);
      const winner = forcedWinner ?? 1 + Math.floor(Math.random() * 9);
      const steps = 28;
      let delay = 40;
      let elapsed = 0;
      let seat = 1;
      for (let step = 0; step < steps; step++) {
        const isLast = step === steps - 1;
        elapsed += delay;
        const slotAtTick = isLast ? winner : ((seat - 1) % 9) + 1;
        seat = slotAtTick + 1;
        const timer = window.setTimeout(() => {
          setRouletteHighlightSlot(slotAtTick);
          studioAudio.playRouletteTick();
          if (isLast) {
            setSpotlightSlot(winner);
            setFocusSlot(winner);
            setIsRouletteSpinning(false);
            studioAudio.playSpotlightSurge();
            pushFeed(`🎰 Roulette landed on Slot ${winner}.`);
          }
        }, elapsed);
        rouletteTimers.current.push(timer);
        delay = Math.min(220, delay * 1.12);
      }
    },
    [clearRouletteTimers, pushFeed],
  );

  const applyLiveRouletteStart = useCallback(
    (args: {
      selectedSlot: number;
      candidateSlots: number[];
      endsAt: string | null;
    }) => {
      pushFeed(
        `📡 ROULETTE_START → seat ${args.selectedSlot}${args.endsAt ? ` · ends ${args.endsAt}` : ""}`,
      );
      runLocalSpin(args.selectedSlot);
    },
    [pushFeed, runLocalSpin],
  );

  const applyLiveRouletteLand = useCallback(
    (spot: number | null) => {
      if (spot != null) {
        setSpotlightSlot(spot);
        setFocusSlot(spot);
        setRouletteHighlightSlot(spot);
      }
      setIsRouletteSpinning(false);
      studioAudio.playSpotlightSurge();
      pushFeed(
        spot != null
          ? `📡 ROULETTE_LAND → Slot ${spot}`
          : "📡 ROULETTE_LAND",
      );
    },
    [pushFeed],
  );
  const setIsLive = useCallback((next: boolean) => {
    setIsLiveRaw(next);
    setStreamHealth(next ? "EXCELLENT" : "OFFLINE");
  }, []);

  const toggleIsLive = useCallback(() => {
    setIsLiveRaw((prev) => {
      const next = !prev;
      setStreamHealth(next ? "EXCELLENT" : "OFFLINE");
      return next;
    });
  }, []);

  const enterGrid9 = useCallback(() => {
    setActiveModeRaw("GRID9");
    setJackpotPool(HOUSE_JACKPOT_SEED);
    setGridSlots(emptySlots());
    setSpotlightSlot(1);
    setRouletteHighlightSlot(null);
    setIsRouletteSpinning(false);
    clearRouletteTimers();
    armMatchClock();
    pushFeed(
      "🎮 Grid 9 lobby armed — house jackpot seeded at 100 · 60:00 match clock.",
    );
  }, [clearRouletteTimers, pushFeed, armMatchClock]);

  const setActiveMode = useCallback(
    (mode: ActiveMode) => {
      if (mode === "GRID9") enterGrid9();
      else {
        setActiveModeRaw("JUST_CHATTING");
        clearRouletteTimers();
        setIsRouletteSpinning(false);
        setRouletteHighlightSlot(null);
        setMatchDeadlineAt(null);
        setMatchRemainingMs(null);
        setMatchWinnerSlot(null);
        setMatchEndReason(null);
      }
    },
    [clearRouletteTimers, enterGrid9],
  );

  const toggleGrid9Engine = useCallback(() => {
    setActiveModeRaw((m) => {
      if (m === "GRID9") {
        clearRouletteTimers();
        setIsRouletteSpinning(false);
        setRouletteHighlightSlot(null);
        setMatchDeadlineAt(null);
        setMatchRemainingMs(null);
        setMatchWinnerSlot(null);
        setMatchEndReason(null);
        return "JUST_CHATTING";
      }
      setJackpotPool(HOUSE_JACKPOT_SEED);
      setGridSlots(emptySlots());
      setSpotlightSlot(1);
      armMatchClock();
      pushFeed(
        "🎮 Grid 9 lobby armed — house jackpot seeded at 100 · 60:00 match clock.",
      );
      return "GRID9";
    });
  }, [clearRouletteTimers, pushFeed, armMatchClock]);

  const spinRoulette = useCallback(() => {
    if (isRouletteSpinning) return;
    const handled = directorBackendRef.current?.spinRoulette() === true;
    if (handled) return;
    runLocalSpin();
  }, [isRouletteSpinning, runLocalSpin]);

  const autoFillSentinels = useCallback(() => {
    directorBackendRef.current?.autoFillSentinels();
    setGridSlots((prev) => {
      let s = 0;
      return prev.map((slot) => {
        if (slot.kind !== "empty") return slot;
        const name = SENTINEL_NAMES[s % SENTINEL_NAMES.length];
        s += 1;
        return {
          ...slot,
          kind: "sentinel" as const,
          displayName: name,
          avatarLabel: initials(name),
          health: DEFAULT_HEALTH,
          shields: DEFAULT_SHIELDS,
          knockedOut: false,
          knockoutTokens: 0,
          seatShareCoins: 0,
        };
      });
    });
    pushFeed("🤖 Empty seats filled with Sentinels.");
  }, [pushFeed]);

  const resetMatch = useCallback(() => {
    directorBackendRef.current?.resetMatch();
    clearRouletteTimers();
    setIsRouletteSpinning(false);
    setRouletteHighlightSlot(null);
    setSpotlightSlot(1);
    setFocusSlot(null);
    setGridSlots(emptySlots());
    setJackpotPool(HOUSE_JACKPOT_SEED);
    setHostGems(0);
    setAuditionQueue(MOCK_APPLICANTS);
    setStandBySignal(false);
    armMatchClock();
    pushFeed(
      "↺ Match reset — lobby cleared, jackpot reseeded to 100, clock 60:00.",
    );
  }, [clearRouletteTimers, pushFeed, armMatchClock]);

  const buybackSlot = useCallback(
    (slotIndex: number) => {
      if (matchEndReasonRef.current) {
        pushFeed("⚠️ Match already resolved — buyback closed.");
        return;
      }
      const handled = directorBackendRef.current?.buyback?.() === true;
      if (handled) return;
      const target = gridSlotsRef.current.find((s) => s.index === slotIndex);
      if (!target || target.kind === "empty" || !target.knockedOut) {
        pushFeed("⚠️ Buyback only for knocked-out seats.");
        return;
      }
      setJackpotPool((p) => p + GRID9_BUYBACK_COST_COINS);
      setGridSlots((slots) =>
        slots.map((s) =>
          s.index === slotIndex
            ? {
                ...s,
                health: DEFAULT_HEALTH,
                shields: DEFAULT_SHIELDS,
                knockedOut: false,
                knockoutTokens: 0,
              }
            : s,
        ),
      );
      setMatchWinnerSlot(null);
      setMatchEndReason(null);
      matchEndReasonRef.current = null;
      pushFeed(
        `♻️ Buyback Slot ${slotIndex} — ${GRID9_BUYBACK_COST_COINS} → jackpot · HP ${DEFAULT_HEALTH}`,
      );
    },
    [pushFeed],
  );

  const applyLiveBuyback = useCallback(
    (args: {
      slotIndex0to8: number;
      healthAfter: number;
      jackpotTotal: number;
      costCoins: number;
      displayName?: string;
    }) => {
      setJackpotPool(args.jackpotTotal);
      const slot1 = args.slotIndex0to8 + 1;
      setGridSlots((slots) =>
        slots.map((s) =>
          s.index === slot1
            ? {
                ...s,
                health: args.healthAfter,
                shields: 0,
                knockedOut: false,
                knockoutTokens: 0,
              }
            : s,
        ),
      );
      setMatchWinnerSlot(null);
      setMatchEndReason(null);
      matchEndReasonRef.current = null;
      pushFeed(
        `♻️ PLAYER_BUYBACK Slot ${slot1}${args.displayName ? ` · ${args.displayName}` : ""} — ${args.costCoins} → pot`,
      );
    },
    [pushFeed],
  );

  const applyLiveMatchCompleted = useCallback(
    (args: {
      winnerSlot1to9: number | null;
      reason: MatchEndReason;
      jackpotCoins?: number;
    }) => {
      if (typeof args.jackpotCoins === "number") {
        setJackpotPool(args.jackpotCoins);
      }
      setMatchWinnerSlot(args.winnerSlot1to9);
      setMatchEndReason(args.reason);
      matchEndReasonRef.current = args.reason;
      setMatchRemainingMs(0);
      pushFeed(
        args.winnerSlot1to9 != null
          ? `🏆 MATCH_COMPLETED — Slot ${args.winnerSlot1to9} (${args.reason ?? "resolved"})`
          : `🏆 MATCH_COMPLETED — no winner (${args.reason ?? "resolved"})`,
      );
    },
    [pushFeed],
  );

  const applyLiveMatchDeadline = useCallback((deadlineIso: string | null) => {
    if (!deadlineIso) return;
    const ms = Date.parse(deadlineIso);
    if (!Number.isFinite(ms)) return;
    setMatchDeadlineAt(ms);
    setMatchRemainingMs(Math.max(0, ms - Date.now()));
  }, []);

  const promoteToGrid = useCallback(
    (applicantId: string) => {
      const applicant = auditionQueueRef.current.find((a) => a.id === applicantId);
      if (!applicant) return;
      const open = gridSlotsRef.current.find((s) => s.kind === "empty");
      if (!open) {
        pushFeed("⚠️ No open grid slot for promote.");
        return;
      }
      setGridSlots((slots) =>
        slots.map((s) =>
          s.index === open.index
            ? {
                ...s,
                kind: "guest" as const,
                displayName: applicant.username,
                avatarLabel: applicant.avatarLabel,
                health: DEFAULT_HEALTH,
                shields: DEFAULT_SHIELDS,
                knockedOut: false,
                knockoutTokens: 0,
                seatShareCoins: 0,
              }
            : s,
        ),
      );
      setAuditionQueue((queue) => queue.filter((a) => a.id !== applicantId));
      pushFeed(`✅ @${applicant.username} promoted to Slot ${open.index}.`);
    },
    [pushFeed],
  );

  const kickSlot = useCallback(
    (slotIndex: number) => {
      if (slotIndex === 1) {
        pushFeed("⚠️ Host Slot 1 cannot be kicked.");
        return;
      }
      const target = gridSlotsRef.current.find((s) => s.index === slotIndex);
      if (!target || target.kind === "empty") return;
      const name = target.displayName ?? `Slot ${slotIndex}`;
      setGridSlots((slots) =>
        slots.map((s) =>
          s.index === slotIndex
            ? {
                ...s,
                kind: "empty" as const,
                displayName: null,
                avatarLabel: null,
                health: DEFAULT_HEALTH,
                shields: DEFAULT_SHIELDS,
                knockedOut: false,
                knockoutTokens: 0,
                seatShareCoins: 0,
              }
            : s,
        ),
      );
      pushFeed(`👢 Removed ${name} from Slot ${slotIndex}.`);
    },
    [pushFeed],
  );

  const queuedGuests = useMemo<QueuedGuest[]>(
    () =>
      auditionQueue.map((a) => ({ id: a.id, displayName: a.username })),
    [auditionQueue],
  );

  const value = useMemo<StudioState>(
    () => ({
      isLive,
      streamHealth,
      activeMode,
      jackpotPool,
      hostGems,
      topSupporters,
      queuedGuests,
      auditionQueue,
      gridSlots,
      socialFeed,
      spotlightSlot,
      focusSlot,
      rouletteHighlightSlot,
      isRouletteSpinning,
      matchDeadlineAt,
      matchRemainingMs,
      matchWinnerSlot,
      matchEndReason,
      publishError,
      publishBusy,
      socketStatus,
      economySource,
      standBySignal,
      cameraFrozen,
      hostSessionId,
      deskScene,
      layoutOrientation,
      layoutPreset,
      overlays,
      previewStreamRef,
      cleanFeedStreamRef,
      setHostSessionId,
      setDeskScene,
      setLayoutOrientation,
      setLayoutPreset,
      toggleOverlay,
      setOverlayCleanFeed,
      addOverlay,
      setIsLive,
      toggleIsLive,
      setPublishError,
      setPublishBusy,
      setActiveMode,
      toggleGrid9Engine,
      spinRoulette,
      autoFillSentinels,
      resetMatch,
      promoteToGrid,
      kickSlot,
      buybackSlot,
      setFocusSlot,
      setSocketStatus,
      setEconomySource,
      setStandBySignal,
      setCameraFrozen,
      registerDirectorBackend,
      pushFeed,
      applyLiveJackpot,
      applyLiveGift,
      applyNukeStrike,
      applyLivePlayers,
      applyLiveRouletteStart,
      applyLiveRouletteLand,
      applyLiveBuyback,
      applyLiveMatchCompleted,
      applyLiveMatchDeadline,
      formatMatchClock,
    }),
    [
      isLive,
      streamHealth,
      activeMode,
      jackpotPool,
      hostGems,
      topSupporters,
      queuedGuests,
      auditionQueue,
      gridSlots,
      socialFeed,
      spotlightSlot,
      focusSlot,
      rouletteHighlightSlot,
      isRouletteSpinning,
      matchDeadlineAt,
      matchRemainingMs,
      matchWinnerSlot,
      matchEndReason,
      publishError,
      publishBusy,
      socketStatus,
      economySource,
      standBySignal,
      cameraFrozen,
      hostSessionId,
      deskScene,
      layoutOrientation,
      layoutPreset,
      overlays,
      setLayoutOrientation,
      setLayoutPreset,
      toggleOverlay,
      setOverlayCleanFeed,
      addOverlay,
      setIsLive,
      toggleIsLive,
      setActiveMode,
      toggleGrid9Engine,
      spinRoulette,
      autoFillSentinels,
      resetMatch,
      promoteToGrid,
      kickSlot,
      buybackSlot,
      registerDirectorBackend,
      pushFeed,
      applyLiveJackpot,
      applyLiveGift,
      applyNukeStrike,
      applyLivePlayers,
      applyLiveRouletteStart,
      applyLiveRouletteLand,
      applyLiveBuyback,
      applyLiveMatchCompleted,
      applyLiveMatchDeadline,
    ],
  );

  return (
    <StudioStateContext.Provider value={value}>
      {children}
    </StudioStateContext.Provider>
  );
}

export function useStudioState(): StudioState {
  const ctx = useContext(StudioStateContext);
  if (!ctx) {
    throw new Error("useStudioState must be used within StudioStateProvider");
  }
  return ctx;
}
