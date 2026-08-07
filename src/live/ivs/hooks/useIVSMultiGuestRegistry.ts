import { useCallback, useRef, useState } from 'react';
import { MAX_STAGE_PUBLISHERS } from '../multiGuestLayout';

export type StreamEntry = {
  participantId: string;
  streamKey: string;
  addedAt: number;
  hasFirstFrame: boolean;
  isMuted: boolean;
  isCameraDisabled: boolean;
  isHost: boolean;
  /** Host-assigned guest slot (1-based) carried from the IVS token attributes via
   *  native. The single source of truth that keeps host + all viewers in sync. */
  slotIndex?: number;
};

type StreamUpsert = {
  participantId: string;
  streamKey: string;
  addedAt?: number;
  hasFirstFrame?: boolean;
  isMuted?: boolean;
  isCameraDisabled?: boolean;
  isHost?: boolean;
  slotIndex?: number;
};

type MultiGuestRegistryConfig = {
  maxPublishers?: number;
  visibleSlots?: number;
  overflowLimit?: number;
  batchWindowMs?: number;
};

type MultiGuestRegistry = {
  visibleStreams: StreamEntry[];
  overflowStreams: StreamEntry[];
  publisherCount: number;
  upsertStream: (entry: StreamUpsert) => void;
  removeStream: (streamKey: string) => void;
  removeParticipantStreams: (participantId: string) => void;
  markFirstFrame: (streamKey: string) => void;
  updateParticipantMuted: (participantId: string, isMuted: boolean) => void;
  updateParticipantCameraDisabled: (participantId: string, isCameraDisabled: boolean) => void;
  updateParticipantRole: (participantId: string, role?: string) => void;
  reset: () => void;
};

/** Host + 11 guests. Dropping below this silently blanks high guest slots. */
const DEFAULT_MAX_PUBLISHERS = MAX_STAGE_PUBLISHERS;
/** Render every on-stage publisher; UI places by sticky slotIndex. */
const DEFAULT_VISIBLE_SLOTS = MAX_STAGE_PUBLISHERS;
const DEFAULT_OVERFLOW_LIMIT = 0;
const DEFAULT_BATCH_WINDOW_MS = 75;

/**
 * Sticky ordering: host first, then by authoritative slotIndex.
 * Never re-rank by mute/join time — that compacted vacated boxes into lower tiles.
 */
const sortByStickySlot = (a: StreamEntry, b: StreamEntry) => {
  if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
  const sa = typeof a.slotIndex === 'number' && a.slotIndex >= 1 ? a.slotIndex : Number.MAX_SAFE_INTEGER;
  const sb = typeof b.slotIndex === 'number' && b.slotIndex >= 1 ? b.slotIndex : Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  if (a.addedAt !== b.addedAt) return a.addedAt - b.addedAt;
  return a.streamKey.localeCompare(b.streamKey);
};

export function useIVSMultiGuestRegistry(config: MultiGuestRegistryConfig = {}): MultiGuestRegistry {
  const maxPublishers = config.maxPublishers ?? DEFAULT_MAX_PUBLISHERS;
  const visibleSlots = config.visibleSlots ?? DEFAULT_VISIBLE_SLOTS;
  const overflowLimit = config.overflowLimit ?? DEFAULT_OVERFLOW_LIMIT;
  const batchWindowMs = config.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS;

  const registryRef = useRef<Map<string, StreamEntry>>(new Map());
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [visibleStreams, setVisibleStreams] = useState<StreamEntry[]>([]);
  const [overflowStreams, setOverflowStreams] = useState<StreamEntry[]>([]);
  const [publisherCount, setPublisherCount] = useState<number>(0);

  const enforcePublisherLimit = useCallback(() => {
    const registry = registryRef.current;
    if (registry.size <= maxPublishers) return;

    // Drop newest non-host only — never evict the host stream.
    const nonHostEntries = Array.from(registry.values())
      .filter((entry) => !entry.isHost)
      .sort((a, b) => b.addedAt - a.addedAt);

    const toDrop = nonHostEntries[0];
    if (toDrop) {
      registry.delete(toDrop.streamKey);
      console.warn('[IVS_MULTI_GUEST][LIMIT]', {
        removedStreamKey: toDrop.streamKey,
        participantId: toDrop.participantId,
        maxPublishers,
      });
    }
  }, [maxPublishers]);

  const scheduleRecompute = useCallback(() => {
    if (batchTimerRef.current) return;
    batchTimerRef.current = setTimeout(() => {
      batchTimerRef.current = null;
      const registry = registryRef.current;
      const entries = Array.from(registry.values());
      // Always expose every publisher for sticky slot placement. Hiding until
      // first-frame left reserved boxes empty/black while peers already painted.
      // Tiles show a Joining placeholder when hasFirstFrame is still false.
      const renderable = entries;

      // Sticky: keep every renderable stream in its slot order. Do NOT dense-fill
      // vacated indices from a priority pool (that compacted box 3 into box 2).
      const ordered = renderable.slice().sort(sortByStickySlot);
      const nextVisible = ordered.slice(0, visibleSlots);
      const used = new Set(nextVisible.map((e) => e.streamKey));
      const overflowPool =
        overflowLimit > 0
          ? ordered.filter((entry) => !used.has(entry.streamKey)).slice(0, overflowLimit)
          : [];

      setVisibleStreams(nextVisible);
      setOverflowStreams(overflowPool);
      setPublisherCount(entries.length);
    }, batchWindowMs);
  }, [batchWindowMs, overflowLimit, visibleSlots]);

  const upsertStream = useCallback(
    (entry: StreamUpsert) => {
      const registry = registryRef.current;
      const existing = registry.get(entry.streamKey);
      const nextEntry: StreamEntry = {
        participantId: entry.participantId,
        streamKey: entry.streamKey,
        addedAt: existing?.addedAt ?? entry.addedAt ?? Date.now(),
        hasFirstFrame: entry.hasFirstFrame ?? existing?.hasFirstFrame ?? false,
        isMuted: entry.isMuted ?? existing?.isMuted ?? false,
        isCameraDisabled: entry.isCameraDisabled ?? existing?.isCameraDisabled ?? false,
        isHost: entry.isHost ?? existing?.isHost ?? false,
        slotIndex:
          typeof entry.slotIndex === 'number' && entry.slotIndex >= 1
            ? entry.slotIndex
            : existing?.slotIndex,
      };

      registry.set(entry.streamKey, nextEntry);
      enforcePublisherLimit();
      scheduleRecompute();
    },
    [enforcePublisherLimit, scheduleRecompute]
  );

  const markFirstFrame = useCallback(
    (streamKey: string) => {
      const registry = registryRef.current;
      const existing = registry.get(streamKey);
      if (!existing) return;
      if (existing.hasFirstFrame) return;
      registry.set(streamKey, { ...existing, hasFirstFrame: true });
      scheduleRecompute();
    },
    [scheduleRecompute]
  );

  const removeStream = useCallback(
    (streamKey: string) => {
      const registry = registryRef.current;
      if (!registry.has(streamKey)) return;
      registry.delete(streamKey);
      scheduleRecompute();
    },
    [scheduleRecompute]
  );

  const removeParticipantStreams = useCallback(
    (participantId: string) => {
      const registry = registryRef.current;
      let removed = false;
      Array.from(registry.entries()).forEach(([key, value]) => {
        if (value.participantId === participantId) {
          registry.delete(key);
          removed = true;
        }
      });
      if (removed) scheduleRecompute();
    },
    [scheduleRecompute]
  );

  const updateParticipantMuted = useCallback(
    (participantId: string, isMuted: boolean) => {
      const registry = registryRef.current;
      let changed = false;
      Array.from(registry.entries()).forEach(([key, value]) => {
        if (value.participantId === participantId && value.isMuted !== isMuted) {
          registry.set(key, { ...value, isMuted });
          changed = true;
        }
      });
      if (changed) scheduleRecompute();
    },
    [scheduleRecompute]
  );

  const updateParticipantCameraDisabled = useCallback(
    (participantId: string, isCameraDisabled: boolean) => {
      const registry = registryRef.current;
      let changed = false;
      Array.from(registry.entries()).forEach(([key, value]) => {
        if (value.participantId === participantId && value.isCameraDisabled !== isCameraDisabled) {
          registry.set(key, { ...value, isCameraDisabled });
          changed = true;
        }
      });
      if (changed) scheduleRecompute();
    },
    [scheduleRecompute]
  );

  const updateParticipantRole = useCallback(
    (participantId: string, role?: string) => {
      if (!role) return;
      const registry = registryRef.current;
      let changed = false;
      const isHost = role === 'host';
      Array.from(registry.entries()).forEach(([key, value]) => {
        if (value.participantId === participantId && value.isHost !== isHost) {
          registry.set(key, { ...value, isHost });
          changed = true;
        }
      });
      if (changed) scheduleRecompute();
    },
    [scheduleRecompute]
  );

  const reset = useCallback(() => {
    registryRef.current = new Map();
    setVisibleStreams([]);
    setOverflowStreams([]);
    setPublisherCount(0);
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
  }, []);

  return {
    visibleStreams,
    overflowStreams,
    publisherCount,
    upsertStream,
    removeStream,
    removeParticipantStreams,
    markFirstFrame,
    updateParticipantMuted,
    updateParticipantCameraDisabled,
    updateParticipantRole,
    reset,
  };
}
