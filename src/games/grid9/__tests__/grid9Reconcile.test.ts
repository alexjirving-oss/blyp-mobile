import {
  applyGrid9ServerEvent,
  asGrid9ServerEvent,
  createEmptyGrid9Session,
  readGrid9Sequence,
} from '../reconcile';
import type {
  Grid9AuthoritativeGameState,
  Grid9MatchCompletedEvent,
  Grid9StateSnapshotEvent,
  Grid9WeaponResolvedEvent,
  Grid9WelcomeEvent,
} from '../protocol';

function publicState(
  overrides: Partial<Grid9AuthoritativeGameState> = {},
): Grid9AuthoritativeGameState {
  return {
    schemaVersion: 1,
    game: 'grid9',
    matchId: 'match-1',
    liveSessionId: 'live-1',
    phase: 'combat',
    phaseStartedAt: '2026-08-15T00:00:00.000Z',
    phaseEndsAt: null,
    stateVersion: 4,
    eventSequence: 4,
    entropyCommitment: 'commit',
    players: [
      {
        slotId: 'slot-0',
        slotIndex: 0,
        kind: 'human',
        displayName: 'Alex',
        avatarUrl: null,
        status: 'alive',
        mode: 'combatant',
        health: 100,
        maxHealth: 100,
        shieldPoints: 0,
        maxShieldPoints: 60,
        mercenaryBankrollCoins: 0,
        publicProfileId: 'pub-1',
        connectionState: 'connected',
      },
      {
        slotId: 'slot-1',
        slotIndex: 1,
        kind: 'sentinel',
        displayName: 'S1',
        avatarUrl: null,
        status: 'alive',
        mode: 'combatant',
        health: 80,
        maxHealth: 100,
        shieldPoints: 10,
        maxShieldPoints: 60,
        mercenaryBankrollCoins: 0,
        sentinelId: 'sentinel-1',
        connectionState: 'not_applicable',
      },
    ],
    audienceCount: 0,
    turn: null,
    lastMicroDrop: null,
    lastAction: null,
    jackpot: {
      currency: 'coins',
      openingRolloverCoins: 0,
      purchaseContributionCoins: 0,
      currentCoins: 25,
      status: 'growing',
      rolloverSourceMatchId: null,
      rolloverDestinationMatchId: null,
      winnerSlotIndex: null,
      winnerPublicProfileId: null,
      winnerSentinelId: null,
      sponsorPassRecipientPublicProfileId: null,
    },
    outcome: null,
    rules: {},
    serverTime: '2026-08-15T00:00:00.000Z',
    ...overrides,
  };
}

function snapshotEvent(state = publicState()): Grid9StateSnapshotEvent {
  return {
    protocol: 'grid9.ws',
    protocolVersion: 2,
    direction: 'server_to_client',
    routing: 'private',
    type: 'STATE_SNAPSHOT',
    messageId: 'msg-snap',
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    sentAt: '2026-08-15T00:00:01.000Z',
    connectionSessionId: 'conn-1',
    matchId: state.matchId,
    sequence: null,
    stateVersion: state.stateVersion,
    causationIntentId: null,
    payload: { state, reason: 'join' },
  };
}

function weaponEvent(sequence: number, stateVersion = sequence): Grid9WeaponResolvedEvent {
  return {
    protocol: 'grid9.ws',
    protocolVersion: 2,
    direction: 'server_to_client',
    routing: 'room',
    type: 'WEAPON_RESOLVED',
    messageId: `msg-${sequence}`,
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    sentAt: '2026-08-15T00:00:02.000Z',
    serverSessionId: 'server-1',
    matchId: 'match-1',
    sequence,
    stateVersion,
    causationIntentId: 'intent-1',
    payload: {
      actor: { kind: 'human_player', publicProfileId: 'pub-1', displayName: 'Alex' },
      sourceSlotIndex: 0,
      targetSlotIndex: 1,
      weaponId: 'arrow',
      damage: [
        {
          slotIndex: 1,
          healthBefore: 80,
          healthAfter: 75,
          shieldBefore: 10,
          shieldAfter: 5,
          shieldDamage: 5,
          healthDamage: 5,
          eliminated: false,
          lastStandApplied: false,
        },
      ],
      receipt: {
        entryId: 'e1',
        intentId: 'intent-1',
        debitCoins: 10,
        jackpotContributionCoins: 5,
        stateVersion,
        committedAt: '2026-08-15T00:00:02.000Z',
      },
      jackpotCoins: 30,
    },
  };
}

describe('Grid 9 sequence reconciliation', () => {
  it('replaces local state from STATE_SNAPSHOT', () => {
    const applied = applyGrid9ServerEvent(createEmptyGrid9Session(), snapshotEvent());
    expect(applied.effects.dropped).toBe(false);
    expect(applied.session.match?.eventSequence).toBe(4);
    expect(applied.session.lastSeenSequence).toBe(4);
    expect(applied.session.lastSeenStateVersion).toBe(4);
  });

  it('applies the next room sequence and patches health', () => {
    const afterSnap = applyGrid9ServerEvent(createEmptyGrid9Session(), snapshotEvent()).session;
    const applied = applyGrid9ServerEvent(afterSnap, weaponEvent(5, 5));
    expect(applied.effects.dropped).toBe(false);
    expect(applied.session.lastSeenSequence).toBe(5);
    expect(applied.session.match?.players[1].health).toBe(75);
    expect(applied.session.match?.jackpot.currentCoins).toBe(30);
  });

  it('drops stale packets at or behind lastSeenSequence', () => {
    const afterSnap = applyGrid9ServerEvent(createEmptyGrid9Session(), snapshotEvent()).session;
    const applied = applyGrid9ServerEvent(afterSnap, weaponEvent(4, 4));
    expect(applied.effects.dropped).toBe(true);
    expect(applied.effects.requestSnapshot).toBe(false);
    expect(applied.session.droppedStalePackets).toBe(1);
    expect(applied.session.match?.players[1].health).toBe(80);
  });

  it('does not apply a sequence gap and asks for a snapshot', () => {
    const afterSnap = applyGrid9ServerEvent(createEmptyGrid9Session(), snapshotEvent()).session;
    const applied = applyGrid9ServerEvent(afterSnap, weaponEvent(7, 7));
    expect(applied.effects.dropped).toBe(true);
    expect(applied.effects.requestSnapshot).toBe(true);
    expect(applied.session.needsResync).toBe(true);
    expect(applied.session.match?.players[1].health).toBe(80);
  });

  it('treats sequenceId as an alias of sequence', () => {
    expect(readGrid9Sequence({ sequenceId: 9 })).toBe(9);
    const afterSnap = applyGrid9ServerEvent(createEmptyGrid9Session(), snapshotEvent()).session;
    const event = {
      ...weaponEvent(5, 5),
      sequence: undefined,
      sequenceId: 5,
    } as unknown as Grid9WeaponResolvedEvent;
    const applied = applyGrid9ServerEvent(afterSnap, event);
    expect(applied.effects.dropped).toBe(false);
    expect(applied.session.lastSeenSequence).toBe(5);
  });

  it('requests a snapshot for room events before any snapshot', () => {
    const applied = applyGrid9ServerEvent(createEmptyGrid9Session(), weaponEvent(1, 1));
    expect(applied.effects.dropped).toBe(true);
    expect(applied.effects.requestSnapshot).toBe(true);
  });

  it('requests a snapshot after WELCOME when a matchId is already known', () => {
    const seeded = {
      ...createEmptyGrid9Session(),
      matchId: 'match-1',
    };
    const welcome: Grid9WelcomeEvent = {
      protocol: 'grid9.ws',
      protocolVersion: 2,
      direction: 'server_to_client',
      routing: 'private',
      type: 'WELCOME',
      messageId: 'msg-w',
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
      sentAt: '2026-08-15T00:00:00.000Z',
      connectionSessionId: 'conn-2',
      matchId: null,
      sequence: null,
      stateVersion: null,
      causationIntentId: null,
      payload: {
        connectionId: 'sock-1',
        connectionSessionId: 'conn-2',
        serverTime: '2026-08-15T00:00:00.000Z',
        minimumProtocolVersion: 2,
        nonceTtlSeconds: 600,
      },
    };
    const applied = applyGrid9ServerEvent(seeded, welcome);
    expect(applied.session.connectionSessionId).toBe('conn-2');
    expect(applied.effects.requestSnapshot).toBe(true);
  });

  it('applies MATCH_COMPLETED when it is the next sequence', () => {
    const afterSnap = applyGrid9ServerEvent(createEmptyGrid9Session(), snapshotEvent()).session;
    const finalState = publicState({
      phase: 'completed',
      stateVersion: 5,
      eventSequence: 5,
    });
    const completed: Grid9MatchCompletedEvent = {
      protocol: 'grid9.ws',
      protocolVersion: 2,
      direction: 'server_to_client',
      routing: 'room',
      type: 'MATCH_COMPLETED',
      messageId: 'msg-end',
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
      sentAt: '2026-08-15T00:00:09.000Z',
      serverSessionId: 'server-1',
      matchId: 'match-1',
      sequence: 5,
      stateVersion: 5,
      causationIntentId: null,
      payload: { outcome: { reason: 'last_box_standing' }, finalState },
    };
    const applied = applyGrid9ServerEvent(afterSnap, completed);
    expect(applied.effects.dropped).toBe(false);
    expect(applied.session.match?.phase).toBe('completed');
  });

  it('applies ARSENAL_GRANTED into inventory and jackpot', () => {
    const afterSnap = applyGrid9ServerEvent(createEmptyGrid9Session(), snapshotEvent()).session;
    const granted = {
      protocol: 'grid9.ws' as const,
      protocolVersion: 2 as const,
      direction: 'server_to_client' as const,
      routing: 'room' as const,
      type: 'ARSENAL_GRANTED' as const,
      messageId: 'msg-gift',
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
      sentAt: '2026-08-15T00:00:03.000Z',
      serverSessionId: 'server-1',
      matchId: 'match-1',
      sequence: 5,
      stateVersion: 5,
      causationIntentId: 'intent-gift',
      payload: {
        senderPublicProfileId: 'aud',
        senderDisplayName: 'Viewer',
        recipientSlotIndex: 0 as const,
        itemId: 'arrow' as const,
        costCoins: 10,
        seatCoins: 7,
        jackpotCoins: 3,
        selfBuy: false,
        droppedItemId: null,
        inventoryAfter: ['arrow' as const],
        receipt: {
          entryId: 'e-gift',
          intentId: 'intent-gift',
          debitCoins: 10,
          jackpotContributionCoins: 3,
          stateVersion: 5,
          committedAt: '2026-08-15T00:00:03.000Z',
        },
        jackpotTotalCoins: 28,
      },
    };
    const applied = applyGrid9ServerEvent(afterSnap, granted);
    expect(applied.effects.dropped).toBe(false);
    expect(applied.session.match?.players[0].inventory).toEqual(['arrow']);
    expect(applied.session.match?.players[0].mercenaryBankrollCoins).toBe(7);
    expect(applied.session.match?.jackpot.currentCoins).toBe(28);
  });

  it('replaces kicked seat when PLAYER_CONNECTION_CHANGED carries replacementPlayer', () => {
    const afterSnap = applyGrid9ServerEvent(createEmptyGrid9Session(), snapshotEvent()).session;
    const kick = {
      protocol: 'grid9.ws' as const,
      protocolVersion: 2 as const,
      direction: 'server_to_client' as const,
      routing: 'room' as const,
      type: 'PLAYER_CONNECTION_CHANGED' as const,
      messageId: 'msg-kick',
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
      sentAt: '2026-08-15T00:00:04.000Z',
      serverSessionId: 'server-1',
      matchId: 'match-1',
      sequence: 5,
      stateVersion: 5,
      causationIntentId: 'intent-kick',
      payload: {
        slotIndex: 0 as const,
        connectionState: 'disconnected' as const,
        replacementPlayer: {
          slotId: 'slot-0',
          slotIndex: 0 as const,
          kind: 'sentinel' as const,
          displayName: 'Sentinel',
          avatarUrl: null,
          status: 'alive' as const,
          mode: 'combatant' as const,
          health: 100,
          maxHealth: 100,
          shieldPoints: 0,
          maxShieldPoints: 60,
          mercenaryBankrollCoins: 0,
          sentinelId: 'sentinel-kick',
          connectionState: 'not_applicable' as const,
        },
        audienceCount: 1,
      },
    };
    const applied = applyGrid9ServerEvent(afterSnap, kick);
    expect(applied.effects.dropped).toBe(false);
    expect(applied.session.match?.players[0].kind).toBe('sentinel');
    expect(applied.session.match?.audienceCount).toBe(1);
  });

  it('accepts protocolVersion 2 on the wire and rejects v1', () => {
    const welcome = {
      protocol: 'grid9.ws',
      protocolVersion: 2,
      direction: 'server_to_client',
      routing: 'private',
      type: 'WELCOME',
      messageId: 'msg-w2',
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
      sentAt: '2026-08-15T00:00:00.000Z',
      connectionSessionId: 'conn-3',
      matchId: null,
      sequence: null,
      stateVersion: null,
      causationIntentId: null,
      payload: {
        connectionId: 'sock-2',
        connectionSessionId: 'conn-3',
        serverTime: '2026-08-15T00:00:00.000Z',
        minimumProtocolVersion: 2,
        nonceTtlSeconds: 600,
      },
    };
    expect(asGrid9ServerEvent(welcome)?.type).toBe('WELCOME');
    expect(asGrid9ServerEvent({ ...welcome, protocolVersion: 1 })).toBeNull();
  });
});
