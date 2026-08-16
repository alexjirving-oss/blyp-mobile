import { useCallback, useContext, useMemo } from 'react';
import { Grid9Context } from './Grid9Provider';
import type { Grid9ShieldId, Grid9SlotIndex, Grid9WeaponId } from './constants';
import type { Grid9AuthoritativeGameState } from './protocol';
import type { Grid9ClientSession, Grid9ConnectionStatus } from './reconcile';

export interface Grid9HookValue {
  session: Grid9ClientSession;
  match: Grid9AuthoritativeGameState | null;
  connectionStatus: Grid9ConnectionStatus;
  enabled: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendQueueJoinIntent: (input: { region: string; sponsorPassId?: string | null }) => string;
  sendQueueLeaveIntent: (input?: { region?: string; ticketId?: string }) => string;
  leaveArena: (reason?: 'user' | 'navigation') => Promise<void>;
  sendMatchJoinIntent: (input?: {
    matchId?: string;
    region?: string;
    assignmentId?: string;
    assignmentToken?: string;
  }) => string;
  sendReserveCoinsIntent: (amountCoins: number) => string;
  sendFireWeaponIntent: (input: {
    weaponId: Grid9WeaponId;
    targetSlotIndex: Grid9SlotIndex | number;
  }) => string;
  sendSelectTargetIntent: (input: { targetSlotIndex: Grid9SlotIndex | number }) => string;
  sendPurchaseShieldIntent: (input: {
    beneficiarySlotIndex: Grid9SlotIndex | number;
    shieldId?: Grid9ShieldId;
  }) => string;
  sendFundMercenaryIntent: (input: {
    beneficiarySlotIndex: Grid9SlotIndex | number;
    amountCoins: number;
  }) => string;
  sendPrivateRoomCreateIntent: (input: {
    region: string;
    displayName?: string;
    entryFeeCoins?: number;
  }) => string;
  sendPrivateRoomJoinIntent: (input: { region: string; roomCode: string }) => string;
  sendStartPrivateMatchIntent: () => string;
  sendRequestSnapshotIntent: (matchId?: string) => string;
  sendPingIntent: () => string;
}

export function useGrid9(): Grid9HookValue {
  const context = useContext(Grid9Context);
  if (!context) {
    throw new Error('useGrid9 must be used within Grid9Provider');
  }
  const { session, connection, enabled } = context;

  const connect = useCallback(() => connection.connect(), [connection]);
  const disconnect = useCallback(() => connection.close(), [connection]);
  const sendQueueJoinIntent = useCallback(
    (input: { region: string; sponsorPassId?: string | null }) =>
      connection.sendQueueJoinIntent(input),
    [connection],
  );
  const sendQueueLeaveIntent = useCallback(
    (input?: { region?: string; ticketId?: string }) => connection.sendQueueLeaveIntent(input),
    [connection],
  );
  const leaveArena = useCallback(
    (reason: 'user' | 'navigation' = 'user') => connection.leaveArena(reason),
    [connection],
  );
  const sendMatchJoinIntent = useCallback(
    (input?: {
      matchId?: string;
      region?: string;
      assignmentId?: string;
      assignmentToken?: string;
    }) => connection.sendMatchJoinIntent(input),
    [connection],
  );
  const sendReserveCoinsIntent = useCallback(
    (amountCoins: number) => connection.sendReserveCoinsIntent(amountCoins),
    [connection],
  );
  const sendFireWeaponIntent = useCallback(
    (input: { weaponId: Grid9WeaponId; targetSlotIndex: Grid9SlotIndex | number }) =>
      connection.sendFireWeaponIntent(input),
    [connection],
  );
  const sendSelectTargetIntent = useCallback(
    (input: { targetSlotIndex: Grid9SlotIndex | number }) =>
      connection.sendSelectTargetIntent(input),
    [connection],
  );
  const sendPurchaseShieldIntent = useCallback(
    (input: { beneficiarySlotIndex: Grid9SlotIndex | number; shieldId?: Grid9ShieldId }) =>
      connection.sendPurchaseShieldIntent(input),
    [connection],
  );
  const sendFundMercenaryIntent = useCallback(
    (input: { beneficiarySlotIndex: Grid9SlotIndex | number; amountCoins: number }) =>
      connection.sendFundMercenaryIntent(input),
    [connection],
  );
  const sendPrivateRoomCreateIntent = useCallback(
    (input: { region: string; displayName?: string }) =>
      connection.sendPrivateRoomCreateIntent(input),
    [connection],
  );
  const sendPrivateRoomJoinIntent = useCallback(
    (input: { region: string; roomCode: string }) =>
      connection.sendPrivateRoomJoinIntent(input),
    [connection],
  );
  const sendStartPrivateMatchIntent = useCallback(
    () => connection.sendStartPrivateMatchIntent(),
    [connection],
  );
  const sendRequestSnapshotIntent = useCallback(
    (matchId?: string) => connection.sendRequestSnapshotIntent(matchId),
    [connection],
  );
  const sendPingIntent = useCallback(() => connection.sendPingIntent(), [connection]);

  return useMemo(
    () => ({
      session,
      match: session.match,
      connectionStatus: session.connectionStatus,
      enabled,
      connect,
      disconnect,
      sendQueueJoinIntent,
      sendQueueLeaveIntent,
      leaveArena,
      sendMatchJoinIntent,
      sendReserveCoinsIntent,
      sendFireWeaponIntent,
      sendSelectTargetIntent,
      sendPurchaseShieldIntent,
      sendFundMercenaryIntent,
      sendPrivateRoomCreateIntent,
      sendPrivateRoomJoinIntent,
      sendStartPrivateMatchIntent,
      sendRequestSnapshotIntent,
      sendPingIntent,
    }),
    [
      session,
      enabled,
      connect,
      disconnect,
      sendQueueJoinIntent,
      sendQueueLeaveIntent,
      leaveArena,
      sendMatchJoinIntent,
      sendReserveCoinsIntent,
      sendFireWeaponIntent,
      sendSelectTargetIntent,
      sendPurchaseShieldIntent,
      sendFundMercenaryIntent,
      sendPrivateRoomCreateIntent,
      sendPrivateRoomJoinIntent,
      sendStartPrivateMatchIntent,
      sendRequestSnapshotIntent,
      sendPingIntent,
    ],
  );
}
