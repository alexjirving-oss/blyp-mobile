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

export type StreamHealth = "EXCELLENT" | "WARNING" | "CRITICAL" | "OFFLINE";
export type ActiveMode = "JUST_CHATTING" | "GRID9";
export type GridSlotKind = "empty" | "host" | "guest" | "sentinel";

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

const HOUSE_JACKPOT_SEED = 100;
const DEFAULT_HEALTH = 100;
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
  { viewer: "viewer_one", gift: "SHIELD", slot: 1, coins: 100 },
  { viewer: "coin_whale", gift: "BOOST", slot: 3, coins: 50 },
  { viewer: "chatty_kat", gift: "HEART", slot: 1, coins: 20 },
  { viewer: "grid_fan", gift: "SHIELD", slot: 5, coins: 100 },
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
      };
    }
    return {
      index,
      kind: "empty" as const,
      displayName: null,
      avatarLabel: null,
      health: DEFAULT_HEALTH,
      shields: DEFAULT_SHIELDS,
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
};

export type StudioState = {
  /**
   * Live flag — Phase 4: driven by real IVS publish when GO LIVE succeeds.
   * Still UI-synced (pulse / END STREAM) via BottomConsole.
   */
  isLive: boolean;
  streamHealth: StreamHealth;
  activeMode: ActiveMode;
  /** House seed 100 on GRID9 enter / Reset Match. Gift 30% allocations add here. */
  jackpotPool: number;
  /** Gift 70% allocations tally (studio mock) or ARSENAL_GRANTED.seatCoins when live. */
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
  publishError: string | null;
  publishBusy: boolean;
  socketStatus: SocketStatus;
  economySource: EconomySource;
  /** Clean Feed canvas draws STAND BY slate when true. */
  standBySignal: boolean;
  /** Webcam ended — freeze last frame / show host avatar. */
  cameraFrozen: boolean;
  /** Shared refs for Clean Feed → IVS (avoid re-render loops). */
  previewStreamRef: MutableRefObject<MediaStream | null>;
  cleanFeedStreamRef: MutableRefObject<MediaStream | null>;
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
  }) => void;
  applyLiveRouletteStart: (args: {
    selectedSlot: number;
    candidateSlots: number[];
    endsAt: string | null;
  }) => void;
  applyLiveRouletteLand: (spotlightSlot: number | null) => void;
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
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("offline");
  const [economySource, setEconomySource] = useState<EconomySource>("mock");
  const [standBySignal, setStandBySignal] = useState(false);
  const [cameraFrozen, setCameraFrozen] = useState(false);
  const rouletteTimers = useRef<number[]>([]);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const cleanFeedStreamRef = useRef<MediaStream | null>(null);
  const directorBackendRef = useRef<DirectorBackend | null>(null);
  const gridSlotsRef = useRef(gridSlots);
  const auditionQueueRef = useRef(auditionQueue);
  gridSlotsRef.current = gridSlots;
  auditionQueueRef.current = auditionQueue;

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

  const applyGiftAllocation = useCallback(
    (coins: number, text: string, viewer?: string) => {
      const toJackpot = Math.round(coins * 0.3);
      const toGems = coins - toJackpot;
      setJackpotPool((p) => p + toJackpot);
      setHostGems((g) => g + toGems);
      if (viewer) {
        setTopSupporters((prev) => {
          const next = [viewer, ...prev.filter((v) => v !== viewer)];
          return next.slice(0, 3);
        });
      }
      studioAudio.playGiftDrop();
      pushFeed(text);
    },
    [pushFeed],
  );

  // Mock gift drip while in GRID9 — paused when live socket economy is active.
  useEffect(() => {
    if (activeMode !== "GRID9") return;
    if (economySource === "live") return;
    let i = 0;
    const id = window.setInterval(() => {
      const g = MOCK_GIFTS[i % MOCK_GIFTS.length];
      i += 1;
      const jackpotAdd = Math.round(g.coins * 0.3);
      applyGiftAllocation(
        g.coins,
        `[mock] ⚡ @${g.viewer} dropped ${g.gift} on Slot ${g.slot}! (+${jackpotAdd} Coins to Jackpot)`,
        g.viewer,
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
      studioAudio.playGiftDrop();
      pushFeed(args.text);
    },
    [pushFeed],
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
    pushFeed("🎮 Grid 9 lobby armed — house jackpot seeded at 100.");
  }, [clearRouletteTimers, pushFeed]);

  const setActiveMode = useCallback(
    (mode: ActiveMode) => {
      if (mode === "GRID9") enterGrid9();
      else {
        setActiveModeRaw("JUST_CHATTING");
        clearRouletteTimers();
        setIsRouletteSpinning(false);
        setRouletteHighlightSlot(null);
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
        return "JUST_CHATTING";
      }
      setJackpotPool(HOUSE_JACKPOT_SEED);
      setGridSlots(emptySlots());
      setSpotlightSlot(1);
      pushFeed("🎮 Grid 9 lobby armed — house jackpot seeded at 100.");
      return "GRID9";
    });
  }, [clearRouletteTimers, pushFeed]);

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
    pushFeed("↺ Match reset — lobby slots cleared, jackpot reseeded to 100.");
  }, [clearRouletteTimers, pushFeed]);

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
      publishError,
      publishBusy,
      socketStatus,
      economySource,
      standBySignal,
      cameraFrozen,
      previewStreamRef,
      cleanFeedStreamRef,
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
      setFocusSlot,
      setSocketStatus,
      setEconomySource,
      setStandBySignal,
      setCameraFrozen,
      registerDirectorBackend,
      pushFeed,
      applyLiveJackpot,
      applyLiveGift,
      applyLiveRouletteStart,
      applyLiveRouletteLand,
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
      publishError,
      publishBusy,
      socketStatus,
      economySource,
      standBySignal,
      cameraFrozen,
      setIsLive,
      toggleIsLive,
      setActiveMode,
      toggleGrid9Engine,
      spinRoulette,
      autoFillSentinels,
      resetMatch,
      promoteToGrid,
      kickSlot,
      registerDirectorBackend,
      pushFeed,
      applyLiveJackpot,
      applyLiveGift,
      applyLiveRouletteStart,
      applyLiveRouletteLand,
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
