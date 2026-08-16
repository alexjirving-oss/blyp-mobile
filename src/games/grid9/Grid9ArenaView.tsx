import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import './grid9.css';
import { GRID9_DEFAULT_MERCENARY_FUND_COINS, type Grid9ArsenalItem } from './catalog';
import { Grid9ActionDrawer } from './Grid9ActionDrawer';
import { Grid9ArrivalTicker } from './Grid9ArrivalTicker';
import { Grid9Board } from './Grid9Board';
import { Grid9EntryPortal } from './Grid9EntryPortal';
import { Grid9Header } from './Grid9Header';
import { Grid9SideRail } from './Grid9SideRail';
import { Grid9VictoryModal } from './Grid9VictoryModal';
import { Grid9WeaponsGalleryModal } from './Grid9WeaponsGalleryModal';
import {
  isValidGrid9Target,
  resolveGrid9DrawerMode,
  selectionFromArsenalItem,
  type Grid9ArsenalSelection,
} from './grid9Actions';
import { getGrid9SpotlightSlot, slotsForGrid9Board } from './grid9Format';
import { Text, TouchableOpacity, View } from './nw';
import { useGrid9 } from './useGrid9';

const DEFAULT_REGION = 'eu-west-2';

export function Grid9ArenaView() {
  const {
    match,
    session,
    connectionStatus,
    sendQueueJoinIntent,
    sendFireWeaponIntent,
    sendPurchaseShieldIntent,
    sendFundMercenaryIntent,
    sendPrivateRoomCreateIntent,
    sendPrivateRoomJoinIntent,
    sendStartPrivateMatchIntent,
  } = useGrid9();
  const insets = useSafeAreaInsets();
  const [entered, setEntered] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [selection, setSelection] = useState<Grid9ArsenalSelection | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [victoryDismissed, setVictoryDismissed] = useState(false);

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
  const availableCoins = Number(session.escrow?.availableCoins ?? 0);
  const targeting = selection != null;

  const mode = resolveGrid9DrawerMode({
    targeting,
    phase: match?.phase,
    localPlayer,
    localSlotIndex,
    spotlightSlotIndex: activeSlotIndex,
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
    if (match?.phase !== 'completed') setVictoryDismissed(false);
  }, [match?.phase]);

  const targetableSlotIndices = useMemo(() => {
    const intent =
      mode === 'proxy_war' ? 'mercenary' : selection?.kind === 'shield' ? 'shield' : selection ? 'weapon' : null;
    if (!intent) return [];
    if (intent === 'mercenary' && availableCoins < GRID9_DEFAULT_MERCENARY_FUND_COINS) {
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
  }, [availableCoins, localSlotIndex, match?.players, mode, selection]);

  const closeTargeting = useCallback(() => {
    setSelection(null);
    setActionError(null);
  }, []);

  const onSelectItem = useCallback((item: Grid9ArsenalItem) => {
    setActionError(null);
    setSelection(selectionFromArsenalItem(item));
    setGalleryOpen(false);
  }, []);

  const onSlotPress = useCallback(
    (slotIndex: number) => {
      try {
        if (mode === 'proxy_war') {
          sendFundMercenaryIntent({
            beneficiarySlotIndex: slotIndex,
            amountCoins: GRID9_DEFAULT_MERCENARY_FUND_COINS,
          });
          setActionError(null);
          return;
        }
        if (!selection) return;
        if (selection.kind === 'weapon') {
          sendFireWeaponIntent({
            weaponId: selection.itemId,
            targetSlotIndex: slotIndex,
          });
        } else {
          sendPurchaseShieldIntent({
            shieldId: selection.itemId,
            beneficiarySlotIndex: slotIndex,
          });
        }
        setSelection(null);
        setActionError(null);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Grid 9 action failed');
      }
    },
    [mode, selection, sendFireWeaponIntent, sendFundMercenaryIntent, sendPurchaseShieldIntent],
  );

  if (!entered && !match) {
    return (
      <View className="flex-1 bg-slate-950" style={{ paddingTop: insets.top }}>
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
          onCreatePrivate={() => {
            try {
              sendPrivateRoomCreateIntent({ region: DEFAULT_REGION });
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

  const outcome = match?.outcome as
    | { jackpotCoins?: number; winnerDisplayName?: string | null }
    | null
    | undefined;
  const showVictory = match?.phase === 'completed' && !victoryDismissed;

  return (
    <View className="flex-1 bg-slate-950" style={{ paddingTop: insets.top }}>
      <Grid9Header match={match} connectionStatus={connectionStatus} nowMs={nowMs} />
      <Grid9ArrivalTicker match={match} />
      <Grid9SideRail match={match} />
      {match?.phase === 'private_lobby' ? (
        <View className="px-4 pb-2">
          <View className="rounded-2xl border border-amber-400/40 bg-slate-900 px-3 py-3">
            <Text className="text-center text-[10px] font-bold uppercase tracking-[2px] text-slate-400">
              Private lobby · code {match.roomCode ?? '······'}
            </Text>
            {match.ownerPublicProfileId &&
            localPlayer?.publicProfileId === match.ownerPublicProfileId ? (
              <TouchableOpacity
                className="mt-2 items-center rounded-xl border border-amber-400 bg-amber-400 py-2.5"
                activeOpacity={0.85}
                onPress={() => {
                  try {
                    sendStartPrivateMatchIntent();
                  } catch (error) {
                    setActionError(error instanceof Error ? error.message : 'Start failed');
                  }
                }}
              >
                <Text className="text-xs font-black uppercase tracking-[1px] text-slate-950">
                  Host start match
                </Text>
              </TouchableOpacity>
            ) : (
              <Text className="mt-2 text-center text-[11px] font-semibold text-slate-500">
                Waiting for host to start
              </Text>
            )}
          </View>
        </View>
      ) : null}
      <Grid9Board
        players={match?.players}
        spotlightSlotIndex={activeSlotIndex}
        rouletteCandidateSlotIndices={rouletteCandidates}
        rouletteActive={match?.phase === 'roulette'}
        localSlotIndex={localSlotIndex}
        targetableSlotIndices={targetableSlotIndices}
        onSlotPress={onSlotPress}
      />
      <View style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <Grid9ActionDrawer
          mode={mode}
          availableCoins={availableCoins}
          mercenaryFundCoins={GRID9_DEFAULT_MERCENARY_FUND_COINS}
          lastError={actionError ?? session.lastError}
          onOpenGallery={() => {
            setActionError(null);
            setGalleryOpen(true);
          }}
          onCancelTargeting={closeTargeting}
        />
      </View>
      <Grid9WeaponsGalleryModal
        visible={galleryOpen}
        availableCoins={availableCoins}
        onClose={() => setGalleryOpen(false)}
        onSelectItem={onSelectItem}
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
