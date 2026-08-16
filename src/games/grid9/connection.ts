import type { Socket } from 'socket.io-client';
import {
  createGrid9Socket,
  emitGrid9Intent,
  subscribeGrid9Channel,
} from '../../realtime/grid9GameSocket';
import type { Grid9ShieldId, Grid9SlotIndex, Grid9WeaponId } from './constants';
import {
  assertGrid9ClientIntent,
  buildFireWeaponIntent,
  buildFundMercenaryIntent,
  buildMatchJoinIntent,
  buildMatchLeaveIntent,
  buildPingIntent,
  buildPrivateRoomCreateIntent,
  buildPrivateRoomJoinIntent,
  buildPurchaseShieldIntent,
  buildQueueJoinIntent,
  buildQueueLeaveIntent,
  buildRequestSnapshotIntent,
  buildReserveCoinsIntent,
  buildStartPrivateMatchIntent,
} from './intents';
import type { Grid9ClientIntent } from './protocol';
import { applyGrid9ServerEvent, asGrid9ServerEvent, type Grid9ApplyEffects } from './reconcile';
import {
  getGrid9Session,
  patchGrid9Session,
  resetGrid9Session,
  setGrid9ConnectionStatus,
} from './store';

const WELCOME_TIMEOUT_MS = 12_000;
/** Matches live-service / contract tests; client auto-queue uses this region. */
const GRID9_DEFAULT_QUEUE_REGION = 'eu-west-2';

export class Grid9NotReadyError extends Error {
  constructor(message = 'Grid 9 socket is not ready') {
    super(message);
    this.name = 'Grid9NotReadyError';
  }
}

export class Grid9Connection {
  private socket: Socket | null = null;
  private unsubscribeChannel: (() => void) | null = null;
  private closed = true;
  private snapshotInFlight = false;
  private joinInFlight: string | null = null;
  private queueJoinInFlight = false;
  /** Wave 1: portal Play triggers queue; set true only for deep-link auto-queue. */
  autoQueueOnWelcome = false;
  private welcomeWaiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  async connect(): Promise<void> {
    if (this.socket?.connected && getGrid9Session().connectionSessionId) {
      return;
    }
    this.closed = false;
    if (!this.socket) {
      this.socket = createGrid9Socket();
      this.bindSocket(this.socket);
    }
    const hadSession = !!getGrid9Session().connectionSessionId;
    setGrid9ConnectionStatus(hadSession ? 'reconnecting' : 'connecting');
    if (!this.socket.connected) {
      this.socket.connect();
    }
    await this.waitForWelcome();
  }

  close(): void {
    this.closed = true;
    this.rejectWelcomeWaiters(new Error('Grid 9 connection closed'));
    this.snapshotInFlight = false;
    this.joinInFlight = null;
    this.queueJoinInFlight = false;
    if (this.unsubscribeChannel) {
      this.unsubscribeChannel();
      this.unsubscribeChannel = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    resetGrid9Session();
    setGrid9ConnectionStatus('disconnected');
  }

  sendQueueJoinIntent(input: { region: string; sponsorPassId?: string | null }): string {
    patchGrid9Session({ region: input.region });
    return this.emitBuilt(
      buildQueueJoinIntent(this.requireSession(), {
        region: input.region,
        sponsorPassId: input.sponsorPassId ?? null,
      }),
    );
  }

  sendPrivateRoomCreateIntent(input: { region: string; displayName?: string }): string {
    patchGrid9Session({ region: input.region });
    return this.emitBuilt(
      buildPrivateRoomCreateIntent(this.requireSession(), input),
    );
  }

  sendPrivateRoomJoinIntent(input: { region: string; roomCode: string }): string {
    patchGrid9Session({ region: input.region });
    return this.emitBuilt(
      buildPrivateRoomJoinIntent(this.requireSession(), input),
    );
  }

  sendStartPrivateMatchIntent(): string {
    const command = this.requireMatchCommand();
    return this.emitBuilt(
      buildStartPrivateMatchIntent(this.requireSession(), command),
    );
  }

  sendQueueLeaveIntent(input?: { region?: string; ticketId?: string }): string {
    const session = getGrid9Session();
    const region = input?.region ?? session.region;
    const ticketId = input?.ticketId ?? session.queue?.entry?.ticketId;
    if (!region || !ticketId) {
      throw new Grid9NotReadyError('Grid 9 queue leave needs a region and ticket');
    }
    return this.emitBuilt(
      buildQueueLeaveIntent(this.requireSession(), { region, ticketId }),
    );
  }

  sendMatchLeaveIntent(input?: { matchId?: string; reason?: 'user' | 'navigation' }): string {
    const session = getGrid9Session();
    const matchId = input?.matchId ?? session.matchId ?? session.assignment?.matchId;
    if (!matchId) {
      throw new Grid9NotReadyError('Grid 9 match leave needs a matchId');
    }
    return this.emitBuilt(
      buildMatchLeaveIntent(this.requireSession(), {
        matchId,
        expectedStateVersion: session.lastSeenStateVersion,
        reason: input?.reason ?? 'user',
      }),
    );
  }

  /**
   * Best-effort leave: MATCH_LEAVE and/or QUEUE_LEAVE, then reset local session.
   * Does not throw if already left / not queued.
   */
  async leaveArena(reason: 'user' | 'navigation' = 'user'): Promise<void> {
    const session = getGrid9Session();
    try {
      if (session.matchId || session.assignment?.matchId) {
        this.sendMatchLeaveIntent({ reason });
      }
    } catch {
      /* already clear */
    }
    try {
      if (session.queue?.entry?.ticketId) {
        this.sendQueueLeaveIntent();
      }
    } catch {
      /* already clear */
    }
    resetGrid9Session();
  }

  sendMatchJoinIntent(input?: {
    matchId?: string;
    region?: string;
    assignmentId?: string;
    assignmentToken?: string;
  }): string {
    const session = getGrid9Session();
    const assignment = session.assignment;
    const matchId = input?.matchId ?? assignment?.matchId ?? session.matchId;
    const region = input?.region ?? session.region;
    const assignmentId = input?.assignmentId ?? assignment?.assignmentId;
    const assignmentToken = input?.assignmentToken ?? assignment?.assignmentToken;
    if (!matchId || !region || !assignmentId || !assignmentToken) {
      throw new Grid9NotReadyError('Grid 9 match join needs an assignment and region');
    }
    this.joinInFlight = assignmentId;
    try {
      return this.emitBuilt(
        buildMatchJoinIntent(this.requireSession(), {
          matchId,
          region,
          assignmentId,
          assignmentToken,
        }),
      );
    } catch (error) {
      this.joinInFlight = null;
      throw error;
    }
  }

  sendReserveCoinsIntent(amountCoins: number): string {
    const command = this.requireMatchCommand();
    return this.emitBuilt(
      buildReserveCoinsIntent(this.requireSession(), {
        ...command,
        amountCoins,
      }),
    );
  }

  sendFireWeaponIntent(input: {
    weaponId: Grid9WeaponId;
    targetSlotIndex: Grid9SlotIndex | number;
  }): string {
    const command = this.requireMatchCommand();
    return this.emitBuilt(
      buildFireWeaponIntent(this.requireSession(), {
        ...command,
        weaponId: input.weaponId,
        targetSlotIndex: input.targetSlotIndex,
      }),
    );
  }

  sendPurchaseShieldIntent(input: {
    beneficiarySlotIndex: Grid9SlotIndex | number;
    shieldId?: Grid9ShieldId;
  }): string {
    const command = this.requireMatchCommand();
    return this.emitBuilt(
      buildPurchaseShieldIntent(this.requireSession(), {
        ...command,
        beneficiarySlotIndex: input.beneficiarySlotIndex,
        shieldId: input.shieldId,
      }),
    );
  }

  sendFundMercenaryIntent(input: {
    beneficiarySlotIndex: Grid9SlotIndex | number;
    amountCoins: number;
  }): string {
    const command = this.requireMatchCommand();
    return this.emitBuilt(
      buildFundMercenaryIntent(this.requireSession(), {
        ...command,
        beneficiarySlotIndex: input.beneficiarySlotIndex,
        amountCoins: input.amountCoins,
      }),
    );
  }

  sendRequestSnapshotIntent(matchId?: string): string {
    const session = getGrid9Session();
    const resolvedMatchId = matchId ?? session.matchId;
    if (!resolvedMatchId) {
      throw new Grid9NotReadyError('Grid 9 snapshot requires a matchId');
    }
    this.snapshotInFlight = true;
    try {
      return this.emitBuilt(
        buildRequestSnapshotIntent(this.requireSession(), {
          matchId: resolvedMatchId,
          lastSeenStateVersion: session.lastSeenStateVersion,
          lastSeenSequence: session.lastSeenSequence,
        }),
      );
    } catch (error) {
      this.snapshotInFlight = false;
      throw error;
    }
  }

  sendPingIntent(): string {
    return this.emitBuilt(buildPingIntent(this.requireSession()));
  }

  private emitBuilt(intent: Grid9ClientIntent): string {
    const socket = this.socket;
    if (!socket?.connected) {
      throw new Grid9NotReadyError();
    }
    emitGrid9Intent(socket, assertGrid9ClientIntent(intent));
    return intent.intentId;
  }

  private requireSession(): { connectionSessionId: string } {
    const connectionSessionId = getGrid9Session().connectionSessionId;
    if (!connectionSessionId) {
      throw new Grid9NotReadyError('Grid 9 WELCOME has not assigned a connection session');
    }
    return { connectionSessionId };
  }

  private requireMatchCommand(): { matchId: string; expectedStateVersion: number } {
    const session = getGrid9Session();
    const matchId = session.matchId;
    const expectedStateVersion = session.lastSeenStateVersion ?? session.match?.stateVersion;
    if (!matchId || expectedStateVersion == null) {
      throw new Grid9NotReadyError('Grid 9 paid intents need a snapshot and stateVersion');
    }
    return { matchId, expectedStateVersion };
  }

  private bindSocket(socket: Socket): void {
    this.unsubscribeChannel = subscribeGrid9Channel(socket, (raw) => {
      this.onChannelMessage(raw);
    });
    socket.on('connect', () => {
      if (this.closed) return;
      const session = getGrid9Session();
      setGrid9ConnectionStatus(session.connectionSessionId ? 'reconnecting' : 'connecting');
    });
    socket.on('disconnect', (reason) => {
      if (this.closed) return;
      this.snapshotInFlight = false;
      this.joinInFlight = null;
      this.queueJoinInFlight = false;
      patchGrid9Session({
        connectionStatus: 'reconnecting',
        connectionSessionId: null,
        connectionId: null,
        lastError: String(reason || 'disconnected'),
      });
    });
    socket.on('connect_error', (error) => {
      if (this.closed) return;
      patchGrid9Session({
        connectionStatus: 'disconnected',
        lastError: error?.message || 'Grid 9 connect failed',
      });
      this.rejectWelcomeWaiters(error instanceof Error ? error : new Error('Grid 9 connect failed'));
    });
  }

  private onChannelMessage(raw: unknown): void {
    const event = asGrid9ServerEvent(raw);
    if (!event) return;
    const applied = applyGrid9ServerEvent(getGrid9Session(), event);
    patchGrid9Session(() => applied.session);
    if (event.type === 'WELCOME') {
      this.resolveWelcomeWaiters();
    }
    if (event.type === 'QUEUE_STATUS') {
      this.queueJoinInFlight = false;
    }
    if (event.type === 'STATE_SNAPSHOT') {
      this.snapshotInFlight = false;
      this.joinInFlight = null;
    }
    if (event.type === 'INTENT_REJECTED') {
      this.joinInFlight = null;
      this.queueJoinInFlight = false;
    }
    this.handleEffects(applied.effects);
    if (event.type === 'WELCOME') {
      // After snapshot/join effects: only auto-queue when not resuming a match.
      this.maybeAutoQueueJoinAfterWelcome();
    }
  }

  /**
   * Leave STANDBY: after WELCOME assigns connectionSessionId, join the region
   * queue once. Skip if already queued / assigned / in a match (reconnect resume
   * uses REQUEST_SNAPSHOT via handleEffects instead).
   */
  private maybeAutoQueueJoinAfterWelcome(): void {
    if (!this.autoQueueOnWelcome) return;
    if (this.closed || this.queueJoinInFlight) return;
    const session = getGrid9Session();
    if (!session.connectionSessionId) return;
    if (session.matchId || session.assignment || session.match) return;
    const queueStatus = session.queue?.status;
    if (queueStatus === 'queued' || queueStatus === 'matching' || queueStatus === 'assigned') {
      return;
    }
    try {
      this.queueJoinInFlight = true;
      this.sendQueueJoinIntent({
        region: GRID9_DEFAULT_QUEUE_REGION,
        sponsorPassId: null,
      });
    } catch (error) {
      this.queueJoinInFlight = false;
      patchGrid9Session({
        lastError: error instanceof Error ? error.message : 'Grid 9 auto queue join failed',
      });
    }
  }

  private handleEffects(effects: Grid9ApplyEffects): void {
    if (this.closed) return;
    if (effects.joinMatch) {
      const assignmentId = getGrid9Session().assignment?.assignmentId;
      if (assignmentId && this.joinInFlight !== assignmentId) {
        try {
          this.sendMatchJoinIntent();
        } catch (error) {
          patchGrid9Session({
            lastError: error instanceof Error ? error.message : 'Grid 9 match join failed',
          });
        }
      }
    }
    if (effects.requestSnapshot && !this.snapshotInFlight && getGrid9Session().matchId) {
      try {
        this.sendRequestSnapshotIntent();
      } catch (error) {
        this.snapshotInFlight = false;
        patchGrid9Session({
          lastError: error instanceof Error ? error.message : 'Grid 9 snapshot request failed',
        });
      }
    }
  }

  private waitForWelcome(): Promise<void> {
    if (getGrid9Session().connectionSessionId && this.socket?.connected) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.welcomeWaiters.push(waiter);
      const timer = setTimeout(() => {
        this.welcomeWaiters = this.welcomeWaiters.filter((item) => item !== waiter);
        reject(new Grid9NotReadyError('Grid 9 WELCOME timed out'));
      }, WELCOME_TIMEOUT_MS);
      const finish = waiter.resolve;
      waiter.resolve = () => {
        clearTimeout(timer);
        finish();
      };
    });
  }

  private resolveWelcomeWaiters(): void {
    const waiters = this.welcomeWaiters.splice(0);
    for (const waiter of waiters) waiter.resolve();
  }

  private rejectWelcomeWaiters(error: Error): void {
    const waiters = this.welcomeWaiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }
}

let activeConnection: Grid9Connection | null = null;

export function getGrid9Connection(): Grid9Connection {
  if (!activeConnection) {
    activeConnection = new Grid9Connection();
  }
  return activeConnection;
}

export function resetGrid9ConnectionForTests(): void {
  if (activeConnection) {
    activeConnection.close();
    activeConnection = null;
  }
}
