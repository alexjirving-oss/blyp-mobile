"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import { useAuth } from "@/components/AuthProvider";
import { playBombStrike } from "../fx/bombStrikeBus";
import { useStudioState } from "../store/StudioStateContext";
import { STUDIO_TO_GRID9_MAP } from "./PROTOCOL_MAP";
import {
  buildStudioIntent,
  createStudioGrid9Socket,
  emitStudioGrid9Intent,
  subscribeStudioGrid9Channel,
  type StudioGrid9WireEvent,
} from "./studioGrid9Socket";

/**
 * Connects BlypStudio to blyp-live-service Grid 9 channel when authenticated.
 * Maps director actions to real intents where they exist; otherwise mock fallback.
 */
export function useStudioGrid9Bridge() {
  const { session } = useAuth();
  const {
    activeMode,
    registerDirectorBackend,
    applyLiveJackpot,
    applyLiveGift,
    applyLivePlayers,
    applyLiveRouletteStart,
    applyLiveRouletteLand,
    applyLiveBuyback,
    applyLiveMatchCompleted,
    applyLiveMatchDeadline,
    setSocketStatus,
    setEconomySource,
    pushFeed,
  } = useStudioState();

  const socketRef = useRef<Socket | null>(null);
  const connectionSessionIdRef = useRef<string | null>(null);
  const matchIdRef = useRef<string | null>(null);
  const stateVersionRef = useRef(0);
  const ownerUserIdRef = useRef<string | null>(null);
  const connectedRef = useRef(false);

  const isHost = useCallback(() => {
    const uid = session?.sub;
    const owner = ownerUserIdRef.current;
    return Boolean(uid && owner && uid === owner);
  }, [session?.sub]);

  const handleEvent = useCallback(
    (event: StudioGrid9WireEvent) => {
      const type = String(event.type || "");
      const payload = (event.payload || {}) as Record<string, unknown>;

      if (type === "WELCOME") {
        const sid = String(
          payload.connectionSessionId || event.connectionSessionId || "",
        );
        if (sid) connectionSessionIdRef.current = sid;
        connectedRef.current = true;
        setSocketStatus("connected");
        setEconomySource("live");
        pushFeed("🔌 Grid 9 socket connected (live economy). Mock gift drip paused.");
        return;
      }

      if (type === "PRIVATE_ROOM_STATUS") {
        ownerUserIdRef.current = String(payload.ownerUserId || "") || null;
        if (typeof payload.matchId === "string") {
          matchIdRef.current = payload.matchId;
        }
        return;
      }

      if (type === "STATE_SNAPSHOT") {
        const state = payload.state as Record<string, unknown> | undefined;
        if (state) {
          if (typeof state.ownerUserId === "string") {
            ownerUserIdRef.current = state.ownerUserId;
          }
          if (typeof event.matchId === "string") {
            matchIdRef.current = event.matchId;
          }
          const jackpot = state.jackpot as { currentCoins?: number } | undefined;
          if (typeof jackpot?.currentCoins === "number") {
            applyLiveJackpot(jackpot.currentCoins, 0);
          }
          const authority = state.authority as
            | { matchDeadlineAt?: string }
            | undefined;
          if (typeof authority?.matchDeadlineAt === "string") {
            applyLiveMatchDeadline(authority.matchDeadlineAt);
          }
          if (Array.isArray(state.players)) {
            applyLivePlayers(
              (state.players as Array<Record<string, unknown>>).map((p) => ({
                slotIndex0to8: Number(p.slotIndex),
                health: Number(p.health),
                shields: Number(p.shieldPoints || 0),
                knockedOut: String(p.status) === "eliminated",
                seatShareCoins: Number(p.supporterTotalCoins || 0),
                knockoutTokens:
                  String(p.status) === "eliminated"
                    ? Math.floor(Number(p.knockoutPayoutFaceCoins || 0) / 2)
                    : 0,
                displayName:
                  typeof p.displayName === "string" ? p.displayName : null,
              })),
            );
          }
          if (typeof event.stateVersion === "number") {
            stateVersionRef.current = event.stateVersion;
          }
        }
        return;
      }

      if (type === "JACKPOT_CHANGED") {
        const jackpot = payload.jackpot as { currentCoins?: number } | undefined;
        const delta = Number(payload.deltaCoins || 0);
        if (typeof jackpot?.currentCoins === "number") {
          applyLiveJackpot(jackpot.currentCoins, delta);
        }
        return;
      }

      if (type === "ARSENAL_GRANTED") {
        const seat = Number(payload.seatCoins || 0);
        const jp = Number(payload.jackpotCoins || 0);
        const total = Number(payload.jackpotTotalCoins || 0);
        const name = String(payload.senderDisplayName || "viewer");
        const item = String(payload.itemId || "GIFT");
        const slot = Number(payload.recipientSlotIndex ?? 0) + 1; // server 0–8 → studio 1–9
        const healthAfter = Number(payload.healthAfter);
        const eliminated = Boolean(payload.eliminated);
        const knockoutTokens = Number(payload.knockoutTokens || 0);
        const costCoins = Number(payload.costCoins || 0);
        applyLiveGift({
          seatCoins: seat,
          jackpotCoins: jp,
          jackpotTotal: total || undefined,
          text: `⚡ @${name} dropped ${item} on Slot ${slot}! (+${jp} pot)${
            eliminated ? ` · KO → ${knockoutTokens} tokens` : ""
          }`,
          viewer: name,
          slotIndex: slot,
          healthAfter: Number.isFinite(healthAfter) ? healthAfter : undefined,
          eliminated,
          knockoutTokens,
          costCoins,
        });
        if (eliminated || (Number.isFinite(healthAfter) && costCoins > 0)) {
          const cell = Number(payload.recipientSlotIndex);
          if (Number.isFinite(cell) && cell >= 0 && cell <= 8) {
            playBombStrike(cell);
          }
        }
        return;
      }

      if (type === "WEAPON_RESOLVED") {
        const target = Number(payload.targetSlotIndex);
        if (Number.isFinite(target) && target >= 0 && target <= 8) {
          playBombStrike(target);
          pushFeed(`💥 Weapon hit cell ${target} (slot ${target + 1})`);
          const damage = Array.isArray(payload.damage)
            ? (payload.damage as Array<Record<string, unknown>>)
            : [];
          if (damage.length > 0) {
            applyLivePlayers(
              damage.map((d) => ({
                slotIndex0to8: Number(d.slotIndex),
                health: Number(d.healthAfter),
                knockedOut: Boolean(d.eliminated),
              })),
            );
          }
        }
        return;
      }

      if (type === "ROULETTE_START") {
        const selected = Number(payload.selectedSlotIndex);
        const candidates = Array.isArray(payload.candidateSlotIndices)
          ? (payload.candidateSlotIndices as number[])
          : [];
        applyLiveRouletteStart({
          // server 0–8 → studio 1–9
          selectedSlot: Number.isFinite(selected) ? selected + 1 : 1,
          candidateSlots: candidates.map((c) => c + 1),
          endsAt: typeof payload.endsAt === "string" ? payload.endsAt : null,
        });
        return;
      }

      if (type === "ROULETTE_LAND") {
        const turn = payload.turn as { spotlightSlotIndex?: number } | undefined;
        const spot =
          typeof turn?.spotlightSlotIndex === "number"
            ? turn.spotlightSlotIndex + 1
            : null;
        applyLiveRouletteLand(spot);
        return;
      }

      if (type === "PLAYER_BUYBACK") {
        applyLiveBuyback({
          slotIndex0to8: Number(payload.slotIndex),
          healthAfter: Number(payload.healthAfter),
          jackpotTotal: Number(payload.jackpotTotalCoins),
          costCoins: Number(payload.costCoins || 0),
          displayName:
            typeof payload.displayName === "string"
              ? payload.displayName
              : undefined,
        });
        return;
      }

      if (type === "MATCH_COMPLETED") {
        const outcome = payload.outcome as
          | {
              winnerSlotIndex?: number | null;
              reason?: string;
              jackpotCoins?: number;
            }
          | undefined;
        const reasonRaw = String(outcome?.reason || "");
        const reason =
          reasonRaw === "last_box_standing"
            ? ("last_standing" as const)
            : reasonRaw.includes("duration") || reasonRaw.includes("health")
              ? ("deadline_finale" as const)
              : ("deadline_finale" as const);
        const winner0 = outcome?.winnerSlotIndex;
        applyLiveMatchCompleted({
          winnerSlot1to9:
            typeof winner0 === "number" && Number.isFinite(winner0)
              ? winner0 + 1
              : null,
          reason,
          jackpotCoins:
            typeof outcome?.jackpotCoins === "number"
              ? outcome.jackpotCoins
              : undefined,
        });
        return;
      }

      if (typeof event.stateVersion === "number") {
        stateVersionRef.current = event.stateVersion;
      }
    },
    [
      applyLiveBuyback,
      applyLiveGift,
      applyLiveJackpot,
      applyLiveMatchCompleted,
      applyLiveMatchDeadline,
      applyLivePlayers,
      applyLiveRouletteLand,
      applyLiveRouletteStart,
      pushFeed,
      setEconomySource,
      setSocketStatus,
    ],
  );

  useEffect(() => {
    if (!session?.idToken) {
      setSocketStatus("offline");
      setEconomySource("mock");
      registerDirectorBackend(null);
      return;
    }

    // Connect whenever studio is open with auth (economy live); GRID9 mode not required for listen.
    let cancelled = false;
    const socket = createStudioGrid9Socket(async () => session.idToken);
    socketRef.current = socket;
    setSocketStatus("connecting");

    const unsub = subscribeStudioGrid9Channel(socket, handleEvent);
    socket.on("connect_error", (err: Error) => {
      if (cancelled) return;
      setSocketStatus("error");
      setEconomySource("mock");
      pushFeed(`⚠️ Grid 9 socket error — mock director fallback. (${err.message})`);
    });
    socket.on("disconnect", () => {
      if (cancelled) return;
      connectedRef.current = false;
      setSocketStatus("disconnected");
      setEconomySource("mock");
    });
    socket.connect();

    const backend = {
      mode: "live" as const,
      spinRoulette: () => {
        // No START_ROULETTE intent. Host may START_PRIVATE_MATCH to begin server loop.
        const conn = connectionSessionIdRef.current;
        const matchId = matchIdRef.current;
        const sock = socketRef.current;
        if (!connectedRef.current || !conn || !sock) {
          pushFeed(
            `[mock] Spin — socket offline (${STUDIO_TO_GRID9_MAP.spinRoulette.note})`,
          );
          return false;
        }
        if (!isHost()) {
          pushFeed("⚠️ Spin: host-only admin path (ownerUserId mismatch). Using local mock.");
          return false;
        }
        if (!matchId) {
          pushFeed(
            `[mock] Spin — no matchId; cannot START_PRIVATE_MATCH. ${STUDIO_TO_GRID9_MAP.spinRoulette.note}`,
          );
          return false;
        }
        emitStudioGrid9Intent(
          sock,
          buildStudioIntent({
            connectionSessionId: conn,
            type: "START_PRIVATE_MATCH",
            matchId,
            expectedStateVersion: stateVersionRef.current,
            payload: { confirm: true },
          }),
        );
        pushFeed(
          "📡 Emitted START_PRIVATE_MATCH (host). Roulette still server-driven (ROULETTE_START).",
        );
        // Still run local mock spin for HUD unless/until ROULETTE_START arrives.
        return false;
      },
      autoFillSentinels: () => {
        pushFeed(
          `[mock] Auto-Fill Sentinels — ${STUDIO_TO_GRID9_MAP.autoFillSentinels.note}`,
        );
        return false;
      },
      resetMatch: () => {
        const conn = connectionSessionIdRef.current;
        const matchId = matchIdRef.current;
        const sock = socketRef.current;
        if (connectedRef.current && conn && matchId && sock) {
          emitStudioGrid9Intent(
            sock,
            buildStudioIntent({
              connectionSessionId: conn,
              type: "MATCH_LEAVE",
              matchId,
              expectedStateVersion: stateVersionRef.current,
              payload: { reason: "user" },
            }),
          );
          pushFeed("📡 Emitted MATCH_LEAVE; local lobby reset follows.");
          matchIdRef.current = null;
        } else {
          pushFeed("[mock] Reset Match — no live match to leave.");
        }
        return false; // always also run local reset
      },
      kickPlayer: (targetUserId: string) => {
        const conn = connectionSessionIdRef.current;
        const matchId = matchIdRef.current;
        const sock = socketRef.current;
        if (!connectedRef.current || !conn || !matchId || !sock) return false;
        if (!isHost()) {
          pushFeed("⚠️ Kick blocked — not room owner.");
          return true; // handled (rejected)
        }
        emitStudioGrid9Intent(
          sock,
          buildStudioIntent({
            connectionSessionId: conn,
            type: "KICK_PLAYER",
            matchId,
            expectedStateVersion: stateVersionRef.current,
            payload: { targetUserId },
          }),
        );
        pushFeed(`📡 Emitted KICK_PLAYER for ${targetUserId}`);
        return true;
      },
      buyback: () => {
        const conn = connectionSessionIdRef.current;
        const matchId = matchIdRef.current;
        const sock = socketRef.current;
        if (!connectedRef.current || !conn || !matchId || !sock) {
          return false;
        }
        emitStudioGrid9Intent(
          sock,
          buildStudioIntent({
            connectionSessionId: conn,
            type: "BUYBACK",
            matchId,
            expectedStateVersion: stateVersionRef.current,
            payload: { confirm: true },
          }),
        );
        pushFeed("📡 Emitted BUYBACK (500 → jackpot · full HP).");
        return true;
      },
    };

    registerDirectorBackend(backend);

    return () => {
      cancelled = true;
      registerDirectorBackend(null);
      unsub();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      connectedRef.current = false;
      connectionSessionIdRef.current = null;
      setSocketStatus("offline");
      setEconomySource("mock");
    };
  }, [
    session?.idToken,
    handleEvent,
    isHost,
    pushFeed,
    registerDirectorBackend,
    setEconomySource,
    setSocketStatus,
  ]);

  // Surface GRID9 mode in feed once (optional cue).
  useEffect(() => {
    if (activeMode === "GRID9" && connectedRef.current) {
      pushFeed("🎮 GRID9 mode — listening for ROULETTE_* / JACKPOT_CHANGED / ARSENAL_GRANTED.");
    }
  }, [activeMode, pushFeed]);
}
