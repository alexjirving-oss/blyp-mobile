import { useCallback, useRef, useState } from 'react';

export type StreamEntry = {
  participantId: string;
  streamKey: string;
  addedAt: number;
  hasFirstFrame: boolean;
  isMuted: boolean;
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
  updateParticipantRole: (participantId: string, role?: string) => void;
  reset: () => void;
};

const DEFAULT_MAX_PUBLISHERS = 11;
const DEFAULT_VISIBLE_SLOTS = 6;
const DEFAULT_OVERFLOW_LIMIT = 5;
const DEFAULT_BATCH_WINDOW_MS = 75;

const sortByPriority = (a: StreamEntry, b: StreamEntry) => {
  if (a.isMuted !== b.isMuted) return a.isMuted ? 1 : -1;
  if (a.addedAt !== b.addedAt) return a.addedAt - b.addedAt;
  return a.streamKey.localeCompare(b.streamKey);
};

export function useIVSMultiGuestRegistry(config: MultiGuestRegistryConfig = {}): MultiGuestRegistry {
  const maxPublishers = config.maxPublishers ?? DEFAULT_MAX_PUBLISHERS;
  const visibleSlots = config.visibleSlots ?? DEFAULT_VISIBLE_SLOTS;
  const overflowLimit = config.overflowLimit ?? DEFAULT_OVERFLOW_LIMIT;
  const batchWindowMs = config.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS;

  const registryRef = useRef<Map<string, StreamEntry>>(new Map());
  const visibleKeysRef = useRef<string[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [visibleStreams, setVisibleStreams] = useState<StreamEntry[]>([]);
  const [overflowStreams, setOverflowStreams] = useState<StreamEntry[]>([]);
  const [publisherCount, setPublisherCount] = useState<number>(0);

  const enforcePublisherLimit = useCallback(() => {
    const registry = registryRef.current;
    if (registry.size <= maxPublishers) return;

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
      let renderable = entries.filter((entry) => entry.hasFirstFrame);

      // If first-frame events are missing, fall back to any entries so UI can render instead of stalling
      if (renderable.length === 0 && entries.length > 0) {
        renderable = entries;
      }

      const hostEntry = renderable.find((entry) => entry.isHost) || null;
      const nextVisible: StreamEntry[] = [];
      const used = new Set<string>();

      if (hostEntry) {
        nextVisible.push(hostEntry);
        used.add(hostEntry.streamKey);
      }

      // Preserve existing visible ordering (excluding host) when still eligible
      visibleKeysRef.current.forEach((key) => {
        if (used.has(key)) return;
        const existing = registry.get(key);
        if (!existing) return;
        if (existing.isHost) return;
        if (!existing.hasFirstFrame) return;
        if (nextVisible.length >= visibleSlots) return;
        nextVisible.push(existing);
        used.add(key);
      });

      const candidatePool = renderable
        .filter((entry) => !used.has(entry.streamKey) && !entry.isHost)
        .sort(sortByPriority);

      while (nextVisible.length < visibleSlots && candidatePool.length > 0) {
        const entry = candidatePool.shift();
        if (!entry) break;
        nextVisible.push(entry);
        used.add(entry.streamKey);
      }

      const overflowPool = renderable
        .filter((entry) => !used.has(entry.streamKey) && !entry.isHost)
        .sort(sortByPriority)
        .slice(0, overflowLimit);

      visibleKeysRef.current = nextVisible.map((entry) => entry.streamKey);
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
    visibleKeysRef.current = [];
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
    updateParticipantRole,
    reset,
  };
}
