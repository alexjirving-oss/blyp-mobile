import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import './grid9.css';
import { GRID9_DEFAULT_MERCENARY_FUND_COINS, type Grid9ArsenalItem } from './catalog';
import { Grid9ActionDrawer } from './Grid9ActionDrawer';
import { Grid9Board } from './Grid9Board';
import { Grid9Header } from './Grid9Header';
import { Grid9WeaponsGalleryModal } from './Grid9WeaponsGalleryModal';
import {
  isValidGrid9Target,
  resolveGrid9DrawerMode,
  selectionFromArsenalItem,
  type Grid9ArsenalSelection,
} from './grid9Actions';
import { getGrid9SpotlightSlot, slotsForGrid9Board } from './grid9Format';
import { View } from './nw';
import { useGrid9 } from './useGrid9';

export function Grid9ArenaView() {
  const {
    match,
    session,
    connectionStatus,
    sendFireWeaponIntent,
    sendPurchaseShieldIntent,
    sendFundMercenaryIntent,
  } = useGrid9();
  const insets = useSafeAreaInsets();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [selection, setSelection] = useState<Grid9ArsenalSelection | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const localSlotIndex = session.assignment?.slotIndex ?? null;
  const spotlightSlotIndex = getGrid9SpotlightSlot(match);
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
    spotlightSlotIndex,
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

  return (
    <View className="flex-1 bg-slate-950" style={{ paddingTop: insets.top }}>
      <Grid9Header match={match} connectionStatus={connectionStatus} nowMs={nowMs} />
      <Grid9Board
        players={match?.players}
        spotlightSlotIndex={spotlightSlotIndex}
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
    </View>
  );
}
