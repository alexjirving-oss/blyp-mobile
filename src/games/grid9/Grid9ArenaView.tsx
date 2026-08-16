import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View as RNView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import './grid9.css';
import {
  GRID9_ARSENAL_CATALOG,
  GRID9_DEFAULT_MERCENARY_FUND_COINS,
  GRID9_WEAPON_CATALOG,
  isGrid9HealWeapon,
  type Grid9ArsenalItem,
} from './catalog';
import { GRID9_DEFAULT_ESCROW_RESERVE_COINS, GRID9_HOUSE_SEED_COINS } from './constants';
import { Grid9LiveKitProvider, useGrid9Mic } from './Grid9LiveKitRoom';
import { shouldAutoUnmuteGrid9Mic } from './grid9Mic';
import { Grid9ActionDrawer } from './Grid9ActionDrawer';
import { Grid9ArrivalTicker } from './Grid9ArrivalTicker';
import { Grid9Board } from './Grid9Board';
import {
  Grid9CombatVfxOverlay,
  type Grid9CombatVfxCue,
  type Grid9VfxPoint,
} from './Grid9CombatVfxOverlay';
import { Grid9EntryPortal } from './Grid9EntryPortal';
import { Grid9TurnOverlay } from './Grid9TurnOverlay';
import { Grid9PrivateInvitePanel } from './Grid9PrivateInvitePanel';
import { Grid9SideRail } from './Grid9SideRail';
import { Grid9SpotlightStage } from './Grid9SpotlightStage';
import { Grid9VictoryModal } from './Grid9VictoryModal';
import { Grid9WeaponsGalleryModal } from './Grid9WeaponsGalleryModal';
import {
  isValidGrid9Target,
  resolveGrid9DrawerMode,
  selectionFromArsenalItem,
  type Grid9ArsenalSelection,
} from './grid9Actions';
import {
  getGrid9JackpotPool,
  getGrid9SpotlightSlot,
  remainingMs,
  slotsForGrid9Board,
} from './grid9Format';
import {
  cueForWeaponVfx,
  playGrid9Cue,
} from './grid9Audio';
import { Text, TouchableOpacity, View } from './nw';
import { useGrid9 } from './useGrid9';
import { useGrid9AccountCoinBalance } from './useGrid9AccountCoinBalance';

const DEFAULT_REGION = 'eu-west-2';

export function Grid9ArenaView({ spectate = false }: { spectate?: boolean }) {
  const {
    match,
    session,
    connectionStatus,
    leaveArena,
    sendQueueJoinIntent,
    sendReserveCoinsIntent,
    sendFireWeaponIntent,
    sendSelectTargetIntent,
    sendPurchaseShieldIntent,
    sendFundMercenaryIntent,
    sendPrivateRoomCreateIntent,
    sendPrivateRoomJoinIntent,
    sendStartPrivateMatchIntent,
  } = useGrid9();
  const { accountCoins, refresh: refreshAccountCoins } = useGrid9AccountCoinBalance(
    !spectate,
  );
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [entered, setEntered] = useState(spectate);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [selection, setSelection] = useState<Grid9ArsenalSelection | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [victoryDismissed, setVictoryDismissed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [localTargetSlot, setLocalTargetSlot] = useState<number | null>(null);
  const [vfxCue, setVfxCue] = useState<Grid9CombatVfxCue | null>(null);
  const overlayOriginRef = useRef<Grid9VfxPoint | null>(null);
  const spotlightOriginRef = useRef<Grid9VfxPoint | null>(null);
  const seatCentersRef = useRef<Array<Grid9VfxPoint | null>>(
    Array.from({ length: 9 }, () => null),
  );
  const lastVfxKeyRef = useRef<string | null>(null);
  const lastAudioActionKeyRef = useRef<string | null>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const prevModeRef = useRef<string | null>(null);
  const prevLocalStatusRef = useRef<string | null>(null);
  const arenaLivePlayedRef = useRef(false);
  const entryFeePlayedRef = useRef(false);
  const prevHealthRef = useRef<Record<number, { health: number; shield: number }>>(
    {},
  );
  const overlayRef = useRef<React.ElementRef<typeof RNView> | null>(null);

  const localSlotIndex = session.assignment?.slotIndex ?? null;
  const activeSlotIndex =
    match?.phase === 'roulette'
      ? match.roulette?.selectedSlotIndex ?? null
      : getGrid9SpotlightSlot(match);
  const rouletteCandidates =
    match?.phase === 'roulette' ? match.roulette?.candidateSlotIndices ?? [] : [];
  const localPlayer =
    localSlotIndex == null
      ? null
      : match?.players.find((player) => player.slotIndex === localSlotIndex) ?? null;
  const spotlightPlayer =
    activeSlotIndex == null
      ? null
      : match?.players.find((player) => player.slotIndex === activeSlotIndex) ?? null;
  const escrowCoins = Number(session.escrow?.availableCoins ?? 0);
  const freeDropLabel = match?.turn?.freeDropItemId
    ? String(match.turn.freeDropItemId).replace(/_/g, ' ')
    : null;
  const targeting = selection != null;
  const jackpotPool = getGrid9JackpotPool(match);
  const turnActed = Boolean(
    match?.turn &&
      ((match.turn.attacksUsedThisTurn ?? 0) >= 1 ||
        (match.turn.defensesUsedThisTurn ?? 0) >= 1 ||
        match.turn.autoResolved),
  );
  const lockedTargetSlot =
    match?.phase === 'combat' && !turnActed
      ? match.turn?.pendingTargetSlotIndex ?? localTargetSlot
      : null;
  // After act, do not paint leftover combat endsAt — server advances immediately.
  const countdownMs =
    match?.phase === 'combat' && match.turn
      ? turnActed
        ? 0
        : remainingMs(match.turn.endsAt, nowMs)
      : remainingMs(
          match?.phase === 'roulette'
            ? match.roulette?.endsAt ?? match.phaseEndsAt
            : match?.phaseEndsAt,
          nowMs,
        );

  const mode = resolveGrid9DrawerMode({
    targeting,
    phase: match?.phase,
    localPlayer,
    localSlotIndex,
    spotlightSlotIndex: activeSlotIndex,
    turnActed,
    pendingTarget: lockedTargetSlot != null,
  });

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      setGalleryOpen(false);
      setSelection(null);
      setActionError(null);
    };
  }, []);

  useEffect(() => {
    if (mode !== 'my_turn') setGalleryOpen(false);
  }, [mode]);

  useEffect(() => {
    if (match?.phase !== 'combat' || turnActed) {
      setLocalTargetSlot(null);
    }
  }, [match?.phase, match?.turn?.turnNumber, turnActed]);

  useEffect(() => {
    if (mode === 'my_turn' && lockedTargetSlot != null && !spectate) {
      setGalleryOpen(true);
    }
  }, [lockedTargetSlot, mode, spectate]);

  useEffect(() => {
    if (match?.phase !== 'completed') setVictoryDismissed(false);
  }, [match?.phase]);

  useEffect(() => {
    if (spectate && match) setEntered(true);
  }, [spectate, match]);

  // Phase / spotlight / victory transition SFX (mute-safe via playGrid9Cue).
  useEffect(() => {
    const phase = match?.phase ?? null;
    if (!phase) return;

    if (
      !arenaLivePlayedRef.current &&
      (phase === 'combat' || phase === 'roulette') &&
      entered
    ) {
      arenaLivePlayedRef.current = true;
      void playGrid9Cue('arena_live');
    }

    const prev = prevPhaseRef.current;
    if (prev !== phase) {
      if (phase === 'roulette') {
        if (prev === 'combat') void playGrid9Cue('turn_end');
        void playGrid9Cue('roulette_spin');
      } else if (phase === 'combat' && (prev === 'roulette' || prev == null)) {
        void playGrid9Cue('spotlight_select');
      } else if (phase === 'completed') {
        void playGrid9Cue('victory');
        void playGrid9Cue('jackpot_sting', { volume: 0.9 });
      }
      prevPhaseRef.current = phase;
    }
  }, [entered, match?.phase]);

  useEffect(() => {
    const fee = Number(match?.entryFeeCoins || 0);
    if (fee <= 0 || entryFeePlayedRef.current) return;
    if (match?.roomMode !== 'private') return;
    if (!localPlayer || localPlayer.kind !== 'human') return;
    entryFeePlayedRef.current = true;
    void playGrid9Cue('entry_fee');
  }, [localPlayer, match?.entryFeeCoins, match?.roomMode]);

  useEffect(() => {
    if (prevModeRef.current !== mode && mode === 'my_turn') {
      void playGrid9Cue('your_go');
    }
    prevModeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const status = localPlayer?.status ?? null;
    if (
      prevLocalStatusRef.current === 'alive' &&
      status === 'eliminated'
    ) {
      void playGrid9Cue('eliminated');
    }
    if (status) prevLocalStatusRef.current = status;
  }, [localPlayer?.status]);

  // Track prior HP/SP so floating amounts stay accurate after resolve.
  useEffect(() => {
    if (!match?.players) return;
    const next: Record<number, { health: number; shield: number }> = {};
    for (const player of match.players) {
      next[player.slotIndex] = {
        health: Number(player.health || 0),
        shield: Number(player.shieldPoints || 0),
      };
    }
    // Seed once without firing VFX.
    if (Object.keys(prevHealthRef.current).length === 0) {
      prevHealthRef.current = next;
    }
  }, [match?.players, match?.stateVersion]);

  useEffect(() => {
    const action = match?.lastAction as
      | {
          kind?: string;
          weaponId?: string;
          shieldId?: string | null;
          targetSlotIndex?: number;
          affectedSlotIndices?: number[];
          committedAt?: string;
          actor?: { displayName?: string };
        }
      | null
      | undefined;
    if (!action?.committedAt || !match) return;
    const key = `${action.committedAt}:${action.kind}:${action.weaponId || action.shieldId}:${action.targetSlotIndex}`;
    if (lastVfxKeyRef.current === key) return;
    lastVfxKeyRef.current = key;

    const targetSlot = Number(action.targetSlotIndex);
    if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot > 8) return;

    const toWindow = seatCentersRef.current[targetSlot];
    const fromWindow =
      spotlightOriginRef.current ||
      (activeSlotIndex != null ? seatCentersRef.current[activeSlotIndex] : null) ||
      toWindow;
    const overlay = overlayOriginRef.current;
    // Never skip VFX forever — synthesize tile centers when measure is late.
    const synth = (slot: number): Grid9VfxPoint => ({
      x: 40 + (slot % 3) * 110,
      y: 220 + Math.floor(slot / 3) * 110,
    });
    const toAbs = toWindow || synth(targetSlot);
    const fromAbs =
      fromWindow ||
      (activeSlotIndex != null ? synth(activeSlotIndex) : synth(targetSlot));
    const origin = overlay || { x: 0, y: 0 };
    const to = { x: toAbs.x - origin.x, y: toAbs.y - origin.y };
    const from = { x: fromAbs.x - origin.x, y: fromAbs.y - origin.y };
    const prev = prevHealthRef.current[targetSlot];
    const nowPlayer = match.players[targetSlot];
    const healthNow = Number(nowPlayer?.health || 0);
    const shieldNow = Number(nowPlayer?.shieldPoints || 0);
    const healthDelta = prev ? healthNow - prev.health : 0;
    const shieldDelta = prev ? shieldNow - prev.shield : 0;

    let cue: Grid9CombatVfxCue | null = null;
    if (action.kind === 'weapon' && action.weaponId) {
      if (isGrid9HealWeapon(action.weaponId) || healthDelta > 0) {
        const heal =
          healthDelta > 0
            ? healthDelta
            : Number(GRID9_WEAPON_CATALOG.kiss.healHealth);
        cue = {
          id: key,
          kind: 'heal',
          weaponId: action.weaponId,
          from,
          to,
          amount: heal,
        };
      } else {
        const catalogDmg = Number(
          (GRID9_ARSENAL_CATALOG as any)[action.weaponId]?.directDamage || 0,
        );
        const dealt =
          healthDelta < 0 || shieldDelta < 0
            ? Math.abs(Math.min(0, healthDelta)) + Math.abs(Math.min(0, shieldDelta))
            : catalogDmg;
        cue = {
          id: key,
          kind: 'projectile',
          weaponId: action.weaponId,
          from,
          to,
          amount: dealt > 0 ? -dealt : -catalogDmg || -1,
        };
      }
    } else if (action.kind === 'shield') {
      const gained = shieldDelta > 0 ? shieldDelta : 30;
      cue = {
        id: key,
        kind: 'shield',
        from,
        to,
        amount: gained,
        label: `+${gained} SP`,
      };
    }

    const snapshot: Record<number, { health: number; shield: number }> = {};
    for (const player of match.players) {
      snapshot[player.slotIndex] = {
        health: Number(player.health || 0),
        shield: Number(player.shieldPoints || 0),
      };
    }
    prevHealthRef.current = snapshot;
    if (cue) {
      if (lastAudioActionKeyRef.current !== key) {
        lastAudioActionKeyRef.current = key;
        const audio = cueForWeaponVfx(cue.kind, cue.weaponId);
        if (audio.fire) void playGrid9Cue(audio.fire);
        void playGrid9Cue(audio.impact);
        void playGrid9Cue('turn_end', { volume: 0.55 });
      }
      setVfxCue(cue);
    }
  }, [activeSlotIndex, match, match?.lastAction, match?.players, match?.stateVersion]);

  const onLeave = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await leaveArena('user');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Leave failed');
    } finally {
      setLeaving(false);
      if (navigation.canGoBack()) {
        navigation.goBack();
      }
    }
  }, [leaveArena, leaving, navigation]);

  const isActor =
    !spectate &&
    !turnActed &&
    match?.phase === 'combat' &&
    localSlotIndex != null &&
    activeSlotIndex === localSlotIndex &&
    localPlayer?.status === 'alive';

  const targetableSlotIndices = useMemo(() => {
    const intent =
      mode === 'proxy_war'
        ? 'mercenary'
        : selection?.kind === 'shield'
          ? 'shield'
          : selection?.kind === 'weapon' && isGrid9HealWeapon(selection.itemId)
            ? 'heal'
            : selection
              ? 'weapon'
              : isActor
                ? 'heal'
                : null;
    if (!intent) return [];
    if (intent === 'mercenary' && accountCoins < GRID9_DEFAULT_MERCENARY_FUND_COINS) {
      return [];
    }
    return slotsForGrid9Board(match?.players)
      .map((player, slotIndex) =>
        isValidGrid9Target({
          intent,
          player,
          slotIndex,
          localSlotIndex,
        })
          ? slotIndex
          : -1,
      )
      .filter((slotIndex) => slotIndex >= 0);
  }, [accountCoins, isActor, localSlotIndex, match?.players, mode, selection]);

  const ensureEscrowForSpend = useCallback(
    (costCoins: number) => {
      if (escrowCoins >= costCoins) return;
      if (accountCoins < costCoins) {
        throw new Error('Not enough account coins — buy coins in Wallet');
      }
      const amount = Math.max(
        costCoins,
        Math.min(accountCoins, GRID9_DEFAULT_ESCROW_RESERVE_COINS),
      );
      sendReserveCoinsIntent(amount);
    },
    [accountCoins, escrowCoins, sendReserveCoinsIntent],
  );

  const closeTargeting = useCallback(() => {
    setSelection(null);
    setLocalTargetSlot(null);
    setActionError(null);
  }, []);

  const fireAtSlot = useCallback(
    (slotIndex: number, nextSelection: NonNullable<typeof selection>) => {
      if (nextSelection.kind === 'weapon') {
        sendFireWeaponIntent({
          weaponId: nextSelection.itemId,
          targetSlotIndex: slotIndex,
        });
      } else {
        sendPurchaseShieldIntent({
          shieldId: nextSelection.itemId,
          beneficiarySlotIndex: slotIndex,
        });
      }
      setSelection(null);
      setLocalTargetSlot(null);
      setActionError(null);
      void refreshAccountCoins();
    },
    [refreshAccountCoins, sendFireWeaponIntent, sendPurchaseShieldIntent],
  );

  const onSelectItem = useCallback(
    (item: Grid9ArsenalItem) => {
      try {
        setActionError(null);
        const inv = localPlayer?.inventory ?? [];
        const free =
          match?.turn?.freeDropEquipped && match.turn.freeDropItemId === item.id;
        if (!inv.includes(item.id) && !free) {
          ensureEscrowForSpend(item.costCoins);
        }
        const next = selectionFromArsenalItem(item);
        setGalleryOpen(false);
        if (lockedTargetSlot != null) {
          fireAtSlot(lockedTargetSlot, next);
          return;
        }
        setSelection(next);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Cannot fund purchase');
      }
    },
    [ensureEscrowForSpend, fireAtSlot, localPlayer?.inventory, lockedTargetSlot, match?.turn],
  );

  const onSlotPress = useCallback(
    (slotIndex: number) => {
      try {
        if (mode === 'proxy_war') {
          ensureEscrowForSpend(GRID9_DEFAULT_MERCENARY_FUND_COINS);
          sendFundMercenaryIntent({
            beneficiarySlotIndex: slotIndex,
            amountCoins: GRID9_DEFAULT_MERCENARY_FUND_COINS,
          });
          setActionError(null);
          return;
        }
        if (selection) {
          fireAtSlot(slotIndex, selection);
          return;
        }
        if (isActor) {
          setLocalTargetSlot(slotIndex);
          setActionError(null);
          try {
            sendSelectTargetIntent({ targetSlotIndex: slotIndex });
          } catch (error) {
            setActionError(
              error instanceof Error ? error.message : 'Could not lock target',
            );
          }
        }
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Grid 9 action failed');
      }
    },
    [
      ensureEscrowForSpend,
      fireAtSlot,
      isActor,
      mode,
      selection,
      sendFundMercenaryIntent,
      sendSelectTargetIntent,
    ],
  );

  if (!entered && !match && !spectate) {
    return (
      <View className="flex-1 bg-blyp-ink" style={{ paddingTop: insets.top }}>
        <Grid9EntryPortal
          connectionStatus={connectionStatus}
          lastError={session.lastError}
          onPlayPublic={() => {
            try {
              sendQueueJoinIntent({ region: DEFAULT_REGION, sponsorPassId: null });
              setEntered(true);
              setActionError(null);
            } catch (error) {
              setActionError(error instanceof Error ? error.message : 'Queue join failed');
            }
          }}
          onCreatePrivate={(entryFeeCoins) => {
            try {
              sendPrivateRoomCreateIntent({
                region: DEFAULT_REGION,
                entryFeeCoins,
              });
              setEntered(true);
              setActionError(null);
            } catch (error) {
              setActionError(error instanceof Error ? error.message : 'Create room failed');
            }
          }}
          onJoinPrivate={(roomCode) => {
            try {
              sendPrivateRoomJoinIntent({ region: DEFAULT_REGION, roomCode });
              setEntered(true);
              setActionError(null);
            } catch (error) {
              setActionError(error instanceof Error ? error.message : 'Join room failed');
            }
          }}
        />
      </View>
    );
  }

  if (spectate && !match) {
    return (
      <View className="flex-1 items-center justify-center bg-blyp-ink px-8" style={{ paddingTop: insets.top }}>
        <Text className="text-[11px] font-black uppercase tracking-[3px] text-blyp-faint">
          Spectating
        </Text>
        <Text className="mt-3 text-center text-base font-extrabold text-blyp-primary">
          Joining as audience…
        </Text>
        <Text className="mt-2 text-center text-xs font-semibold text-blyp-muted">
          {session.lastError || connectionStatus}
        </Text>
      </View>
    );
  }

  const outcome = match?.outcome as
    | { jackpotCoins?: number; winnerDisplayName?: string | null }
    | null
    | undefined;
  const showVictory = match?.phase === 'completed' && !victoryDismissed;
  const isCombatant = Boolean(localPlayer && localPlayer.kind === 'human');

  const lockedTargetPlayer =
    lockedTargetSlot == null
      ? null
      : match?.players.find((player) => player.slotIndex === lockedTargetSlot) ?? null;
  const overlayTitle =
    match?.phase === 'combat' && !turnActed
      ? lockedTargetSlot == null
        ? 'Select a box'
        : 'Target locked'
      : null;
  const overlaySubtitle =
    match?.phase === 'combat' && !turnActed
      ? lockedTargetSlot == null
        ? 'Select your target'
        : lockedTargetPlayer?.displayName || `Seat ${lockedTargetSlot + 1}`
      : null;
  const overlayDetail =
    match?.phase === 'combat' && !turnActed
      ? lockedTargetSlot == null
        ? spotlightPlayer
          ? `${spotlightPlayer.displayName} is choosing`
          : 'Choosing a seat'
        : 'Select your weapon'
      : null;

  return (
    <View className="flex-1 bg-blyp-ink" style={{ paddingTop: insets.top }}>
      <RNView
        ref={overlayRef}
        style={{ position: 'relative' }}
        onLayout={() => {
          const node = overlayRef.current as unknown as {
            measureInWindow?: (
              cb: (x: number, y: number, w: number, h: number) => void,
            ) => void;
          } | null;
          node?.measureInWindow?.((x, y) => {
            if (Number.isFinite(x) && Number.isFinite(y)) {
              overlayOriginRef.current = { x, y };
            }
          });
        }}
      >
        <View className="pt-1">
        <Grid9LiveKitProvider
          matchId={match?.matchId ?? session.matchId}
          enabled={Boolean(match?.matchId || session.matchId)}
          publish={isCombatant && !spectate}
          forceUnmute={shouldAutoUnmuteGrid9Mic({
            isCombatant,
            spectate,
            localSlotIndex,
            activeSlotIndex,
          })}
        >
        <Grid9ArenaMuteChip visible={isCombatant && !spectate} />
        <Grid9SpotlightStage
          player={spotlightPlayer}
          matchId={match?.matchId ?? session.matchId}
          publishLocalAv={isCombatant && !spectate}
          isLocalSpotlight={
            localSlotIndex != null && activeSlotIndex === localSlotIndex
          }
          jackpotCoins={jackpotPool}
          houseSeedCoins={GRID9_HOUSE_SEED_COINS}
          isNewMatchPot={jackpotPool <= GRID9_HOUSE_SEED_COINS}
          turnNumber={match?.turn?.turnNumber ?? null}
          countdownMs={countdownMs}
          nextSpotlightMs={countdownMs}
          onAir={connectionStatus === 'connected' && !!spotlightPlayer}
          onOriginMeasured={(point) => {
            spotlightOriginRef.current = point;
          }}
        />
        {freeDropLabel && match?.phase === 'combat' ? (
          <View className="mx-3 mb-1 rounded-lg border border-blyp-primary/35 bg-blyp-primary/10 px-2 py-1">
            <Text className="text-center text-[9px] font-black uppercase tracking-[2px] text-blyp-primary">
              Free drop · {freeDropLabel}
            </Text>
          </View>
        ) : null}
        <Grid9Board
          players={match?.players}
          spotlightSlotIndex={activeSlotIndex}
          rouletteCandidateSlotIndices={rouletteCandidates}
          rouletteSelectedSlotIndex={
            match?.phase === 'roulette'
              ? match.roulette?.selectedSlotIndex ?? null
              : null
          }
          rouletteEndsAt={
            match?.phase === 'roulette' ? match.roulette?.endsAt ?? null : null
          }
          rouletteActive={match?.phase === 'roulette'}
          localSlotIndex={localSlotIndex}
          targetableSlotIndices={targetableSlotIndices}
          lockedTargetSlotIndex={lockedTargetSlot}
          onSlotPress={onSlotPress}
          onSeatCentersMeasured={(centers) => {
            seatCentersRef.current = centers;
          }}
        />
        <Grid9CombatVfxOverlay
          cue={vfxCue}
          onDone={(id) => {
            setVfxCue((prev) => (prev?.id === id ? null : prev));
          }}
        />
        <Grid9TurnOverlay
          visible={Boolean(overlayTitle)}
          title={overlayTitle || ''}
          subtitle={overlaySubtitle}
          detail={overlayDetail}
        />
        </Grid9LiveKitProvider>
        </View>
        <TouchableOpacity
          className="absolute right-2 top-1 z-40 rounded-full border border-white/30 bg-black/70 px-3 py-1.5"
          activeOpacity={0.85}
          disabled={leaving}
          onPress={onLeave}
        >
          <Text className="text-[10px] font-black uppercase tracking-[1px] text-white">
            {leaving ? '…' : 'Leave'}
          </Text>
        </TouchableOpacity>
      </RNView>

      {match?.phase === 'private_lobby' ? (
        <View className="px-0 pb-2">
          <Grid9PrivateInvitePanel
            roomCode={match.roomCode}
            entryFeeCoins={Number(match.entryFeeCoins || 0)}
          />
          <View className="mx-3 rounded-xl border border-blyp-primary/40 bg-blyp-card px-3 py-2">
            {match.ownerPublicProfileId &&
            localPlayer?.publicProfileId === match.ownerPublicProfileId ? (
              <TouchableOpacity
                className="items-center rounded-xl border border-blyp-primary bg-blyp-primary py-2"
                activeOpacity={0.85}
                onPress={() => {
                  try {
                    sendStartPrivateMatchIntent();
                  } catch (error) {
                    setActionError(error instanceof Error ? error.message : 'Start failed');
                  }
                }}
              >
                <Text className="text-xs font-black uppercase tracking-[1px] text-blyp-ink">
                  Host start match
                </Text>
              </TouchableOpacity>
            ) : (
              <Text className="text-center text-[11px] font-semibold text-blyp-faint">
                Waiting for host to start
              </Text>
            )}
          </View>
        </View>
      ) : null}

      {/* Rest of screen: social / audience only */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) }}
        keyboardShouldPersistTaps="handled"
      >
        <Grid9ArrivalTicker match={match} />
        <Grid9SideRail
          match={match}
          inventoryItemIds={localPlayer?.inventory ?? []}
          accountCoins={spectate ? 0 : accountCoins}
          canUsePowers={mode === 'my_turn' && !spectate}
          countdownMs={countdownMs}
          onPickArsenal={onSelectItem}
          onPickMercenary={() => {
            setActionError(null);
            // Proxy/fund flow: open targeting via mercenary mode by selecting fund path.
            try {
              ensureEscrowForSpend(GRID9_DEFAULT_MERCENARY_FUND_COINS);
              setActionError('Tap a surviving seat to fund as mercenary');
            } catch (error) {
              setActionError(
                error instanceof Error ? error.message : 'Cannot fund mercenary',
              );
            }
          }}
        />
      </ScrollView>

      <View style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
        <Grid9ActionDrawer
          mode={mode}
          availableCoins={accountCoins}
          mercenaryFundCoins={GRID9_DEFAULT_MERCENARY_FUND_COINS}
          countdownMs={countdownMs}
          lastError={actionError ?? session.lastError}
          onOpenGallery={() => {
            setActionError(null);
            void refreshAccountCoins();
            if (escrowCoins < 10 && accountCoins >= 10) {
              try {
                sendReserveCoinsIntent(
                  Math.min(accountCoins, GRID9_DEFAULT_ESCROW_RESERVE_COINS),
                );
              } catch {
                /* shown via lastError if needed */
              }
            }
            setGalleryOpen(true);
          }}
          onCancelTargeting={closeTargeting}
        />
      </View>
      <Grid9WeaponsGalleryModal
        visible={galleryOpen}
        accountCoins={accountCoins}
        inventoryItemIds={localPlayer?.inventory ?? []}
        freeDropItemId={
          match?.turn?.freeDropEquipped ? match.turn.freeDropItemId ?? null : null
        }
        onClose={() => setGalleryOpen(false)}
        onSelectItem={onSelectItem}
        onVisibleRefresh={() => {
          void refreshAccountCoins();
        }}
      />
      <Grid9VictoryModal
        visible={!!showVictory}
        jackpotCoins={Number(outcome?.jackpotCoins ?? match?.jackpot?.currentCoins ?? 0)}
        winnerName={outcome?.winnerDisplayName ?? null}
        onClose={() => setVictoryDismissed(true)}
      />
    </View>
  );
}

function Grid9ArenaMuteChip({ visible }: { visible: boolean }) {
  const { micEnabled, canMute, toggleMic } = useGrid9Mic();
  if (!visible || !canMute) return null;
  return (
    <View className="absolute left-2 top-1 z-40">
      <TouchableOpacity
        className="rounded-full border border-white/30 bg-black/70 px-3 py-1.5"
        activeOpacity={0.85}
        onPress={toggleMic}
      >
        <Text className="text-[10px] font-black uppercase tracking-[1px] text-white">
          {micEnabled ? 'Mic on' : 'Muted'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
