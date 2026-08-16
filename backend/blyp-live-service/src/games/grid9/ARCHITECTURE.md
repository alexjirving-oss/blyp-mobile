# Grid 9 — Phase 1 domain and storage architecture

## Scope

This phase fixes the contract before transport or persistence code is written. The canonical
TypeScript API is exported by `src/games/grid9/index.ts`. Phase 2 must implement these contracts
without allowing a client to calculate damage, alter health, choose a Sentinel action, change a
jackpot, or debit a balance.

The Blyp application is currently Expo/React Native, not a DOM React application. These contracts
are UI-agnostic. A mobile Tailwind implementation therefore means NativeWind-compatible utility
styles in Phase 4; a separate browser client would be a distinct surface using the same protocol.

## Non-negotiable invariants

1. A match always contains exactly nine slots with indices `0` through `8`.
2. A slot is occupied by one human or one Sentinel for the life of the match.
3. The matchmaker fills every empty lobby position with a Sentinel immediately (`0 ms`), then
   starts a 3-second presentation countdown.
4. Health, shield, cooldown, jackpot, elimination, proxy actions, and winner decisions are
   calculated only by the server.
5. The authenticated user comes from the Socket.IO handshake JWT. Paid intents do not carry a
   caller-supplied user ID.
6. Every client and server WebSocket message uses the `Grid9WireEnvelopeBase` and therefore
   carries a one-time, base64url nonce. Server nonces come from `crypto.randomBytes(16)`. Client
   SDKs must use an OS CSPRNG; a receiver can validate encoding and replay, but cannot infer how a
   remote peer generated a syntactically valid nonce.
7. The server binds `connectionSessionId` to the authenticated socket during `WELCOME`. A client
   cannot select or replace it. Pre-match nonces use `SET NX EX`; match nonces are fields in the
   atomic match aggregate. Reuse returns `NONCE_REPLAY`.
8. A paid action is not broadcast until one Redis `HSET` has committed the consumed nonce,
   idempotency receipt, escrow deduction, jackpot update, game effect, ledger entry, timer outbox,
   and state version into the match aggregate.
9. Redis in-match escrow is the spendable Grid 9 balance. Coins enter escrow through a durable,
   idempotent reservation against the platform wallet and unused coins are released during
   settlement. This prevents a Redis/Postgres shadow balance from being double-spent.
10. Public state never includes escrow balances, the server entropy seed, assignment-token
    hashes, or internal Sentinel decision settings.
11. Every game-state mutation increments `authority.stateVersion` once. Private escrow-only
    reservations do not. Every room event increments `authority.eventSequence` once. Clients
    request a snapshot on either room-state gap.
12. Ledger coin amounts are non-negative integers. Health and shield values are bounded by the
    rule snapshot persisted with the match.

## Match lifecycle

`initializing → lobby → countdown → combat → settling → completed`

`cancelled` is terminal and is used only for an operator cancellation or a non-recoverable system
failure. Escrow still settles when a match is cancelled.

Combat is real-time. A five-second server turn controls the spotlight and proxy/Sentinel action
tick; it does not grant a client temporary authority to attack. The spotlight is visible for
1.25 seconds. At most one free micro-drop is granted per turn.

The spotlight advances to the next surviving slot in grid order. Server-secret committed entropy
selects either:

- 5 coins, credited to a human's Grid 9 escrow or a Sentinel's mercenary bankroll; or
- 15 shield points, capped at 60.

The entropy seed is exactly 32 bytes encoded as unpadded base64url and remains private during
combat. The public commitment is lowercase hex SHA-256 over UTF-8
`grid9:{matchId}:{entropySeed}`. Terminal outcomes reveal the seed in `entropyReveal`, allowing
clients to verify the commitment and deterministic reward decisions. A micro-drop digest is
HMAC-SHA-256 keyed by the decoded seed over UTF-8
`grid9:micro-drop:{matchId}:{turnNumber}:{slotIndex}`. An even low bit in byte zero means coins; an
odd low bit means shield. The result stores the lowercase hex digest so it can be audited after
reveal.

At 15 minutes, if multiple boxes survive, the deterministic winner order is:

1. highest `health + shieldPoints`;
2. highest `health`;
3. highest damage dealt;
4. lowest slot index.

## Arsenal and jackpot

The initial, versioned catalog is in `catalog.ts`.

| Item | Cost | Jackpot | Effect | Cooldown |
| --- | ---: | ---: | --- | ---: |
| Arrow | 10 | 5 | 12 direct damage | 1.5 s |
| Fireball | 50 | 25 | 30 direct, 8 orthogonal splash, 15% shield pierce | 4 s |
| Mega Bomb | 200 | 100 | 55 direct, 20 all-adjacent splash, 25% shield pierce | 10 s |
| Basic Shield | 25 | 13 | +20 shield, capped at 60 | 3 s |

Shield pierce applies its percentage to health; remaining damage is absorbed by shield before
health. Splash never damages an already eliminated slot. A living combatant cannot target their
own slot with a weapon. Audience users may attack any surviving slot and may shield any surviving
slot. An eliminated human loses direct weapon/shield access and enters sabotage mode.

Slots are row-major: `0 1 2 / 3 4 5 / 6 7 8`. Orthogonal splash uses Manhattan distance 1.
All-adjacent splash uses Chebyshev distance 1 and therefore includes diagonals. Damage against all
affected boxes is calculated from the same pre-action snapshot and applied simultaneously.
Piercing health damage is `floor(rawDamage * shieldPierceBps / 10000)`. The remaining damage hits
shield, then health. If one simultaneous blast would reduce every surviving box to zero, the
highest pre-action `health + shieldPoints` box receives Last Stand at 1 health; ties use highest
health, highest damage dealt, then lowest slot index. This preserves one last box deterministically.

Sabotage funding is 10–5,000 coins per intent. It atomically debits the eliminated user's escrow
and credits the selected surviving box's mercenary bankroll. Funding itself does not increase the
jackpot. The server spends that bankroll on catalog items at the next proxy tick; those purchases
then feed the jackpot normally. The proxy targets the lowest effective-health opponent, with
lowest slot index as the tie-break. A Sentinel's own un-sponsored actions use its `ai.targetStrategy`;
mercenary-bankroll actions always use the fixed proxy rule. Support totals remain attributed to the
eliminated sponsor.

Each proxy spend is a `Grid9ProxyPurchaseOperation` with a unique server operation ID. It uses
`fundingSource: "mercenary_bankroll"` and debits the beneficiary slot's bankroll in the same
aggregate `HSET` that applies damage, contributes to the jackpot, and records the ledger entry.
The same `HSET` stores `operation:{operationId}`. A retried timer operation returns that receipt;
a different canonical operation hash returns `INTENT_CONFLICT`.

Sentinels never mint a free paid weapon budget. They may purchase only from their
`mercenaryBankrollCoins`, funded by sponsor transfers or Sentinel coin micro-drops. Each decision
is a `Grid9SentinelPurchaseOperation` recording bankroll origin, AI target strategy, item, target,
before/after bankroll, state version, and canonical operation hash. It uses the same operation
receipt and atomic purchase path as a human-box proxy. The bankroll persists
`mercenarySponsorCoins` and `mercenaryMicroDropCoins`; automated purchases consume micro-drop
coins first, then sponsor coins.

If a human wins, the full jackpot enters payout settlement for that user. If a Sentinel wins, the
full jackpot becomes the next regional rollover. The Sentinel's highest contributor receives one
Sponsor's Pass; equal contributions are resolved by earliest first funding time, then user ID.
The pass bypasses the standard queue once, in the same region, and expires after 24 hours.
If a match is cancelled, no Sponsor's Pass is issued: all unused user escrow is released and the
entire jackpot rolls to the next match in that region.

## Command/query separation

Clients send intents, never state:

- `QUEUE_JOIN`
- `QUEUE_LEAVE`
- `MATCH_JOIN`
- `RESERVE_COINS`
- `FIRE_WEAPON`
- `PURCHASE_SHIELD`
- `FUND_MERCENARY`
- `REQUEST_SNAPSHOT`
- `PING`

The server protocol makes routing type-safe. `Grid9PrivateServerEventEnvelope` has
`routing: "private"` and `sequence: null`; it carries queue details, assignment tokens, snapshots,
escrow balances, rejections, and pongs only to one authenticated connection.
`Grid9RoomServerEventEnvelope` has `routing: "room"`, a non-null match ID, state version, and room
sequence. It carries the emitting `serverSessionId`, not a user's connection session. Room
broadcasts use `Grid9PublicPurchaseReceipt`, which excludes private balances and internal user IDs.
Each room event consumes one sequence number; private events never create a room sequence gap.

`sentAt` is diagnostic only. Server receipt time controls cooldowns, deadlines, nonce expiry, and
ordering. `expectedStateVersion` is required for match mutations. A stale value returns
`STALE_STATE` plus the authoritative version; it never causes the server to apply client state.

Idempotency uses `grid9CanonicalIntentHash`: SHA-256 of canonical JSON containing exactly
`authenticatedUserId`, `matchId`, `type`, and `payload`. Canonical JSON sorts object keys
lexicographically, preserves array order, normalizes negative zero to zero, and rejects undefined,
non-finite numbers, and non-plain objects. `sentAt`, nonce, and message ID are excluded so a safe
transport retry can reproduce the same intent hash.

### Escrow reservation and release

`RESERVE_COINS` accepts 10–20,000 whole coins. The platform wallet remains the durable source of
truth outside a match. Reservation uses one idempotency key across this sequence:

1. Commit a `LOCKED` platform-wallet ledger reservation.
2. Record `Grid9WalletReservationRecord` durably.
3. Add the reservation ID and amount to the match aggregate escrow field.
4. Return private `ESCROW_UPDATED`.

If the process fails after step 1, a reservation worker completes step 3 or releases the lock.
Repeating the intent returns the same reservation. Micro-drop coins increment
`microDropCreditCoins`, not `platformReservedCoins`, so settlement never refunds house credits as
paid wallet coins. Terminal settlement captures `spentPlatformCoins`, releases only unused platform
reservation coins, and records all release/capture amounts in `Grid9SettlementOutboxRecord`.

Actor escrow spends house micro-drop coins first, then platform-reserved coins. The wallet tracks
`spentMicroDropCoins` and `spentPlatformCoins` separately, and every ledger entry records a
`fundingBreakdown`. For example, reserving 10, receiving 5, and spending 12 consumes 5 micro-drop
coins plus 7 platform coins; settlement captures 7 platform coins, releases 3, and expires no
remaining micro-drop credit. `spentCoins` is the sum of the two source-specific counters, never the
amount blindly captured from the platform reservation.
Each reservation records `capturedCoins` and `releasedCoins`; `settled` requires their sum to equal
the original amount, while `partially_settled` records retryable progress without losing either
side.

## Redis keyspace

The authoritative paid-action record is one Redis Hash:
`grid9:{matchId}:aggregate`. Every value is serialized before the first write. A Lua function reads
and validates fields, calculates the full next result, then performs one multi-field `HSET`.
Redis Lua does not roll back writes after a runtime error, so the script is forbidden from making
any write before that final command. The command commits these fields together:

| Aggregate field | Decoded contract |
| --- | --- |
| `state` | `Grid9GameState` |
| `sequence` | decimal room sequence |
| `escrow:{userId}` | `Grid9EscrowWallet` |
| `nonce:{userId}:{sha256}` | `Grid9ConsumedNonceRecord` |
| `intent:{userId}:{intentId}` | `Grid9IntentReceiptRecord`, including canonical intent hash and replay event |
| `operation:{operationId}` | `Grid9ServerOperationReceipt` for retry-safe server actions |
| `ledger:{entryId}` | immutable `Grid9LedgerEntry` |
| `settlement:{settlementId}` | `Grid9SettlementOutboxRecord` |
| `timer-outbox:{stateVersion}` | authoritative deadline projection work |

The aggregate expires 30 days after terminal settlement. Match state has a logical `expiresAt` of
24 hours; ledger, receipt, and settlement fields remain available for audit and recovery.
`Grid9LedgerEntry.entryId` is a server-generated UUID created before aggregate commit. A later
Redis Stream projection has its own stream ID and never replaces the ledger entry ID.

Supporting keys are:

| Key | Redis type | Expiry | Purpose |
| --- | --- | ---: | --- |
| `grid9:{matchId}:lock` | String | 8 s | non-ledger maintenance lock |
| `grid9:{matchId}:ledger-projection` | Stream | 30 d | rebuildable audit projection |
| `grid9:{matchId}:presence` | Hash | refreshed | connection ID → `Grid9PresenceEntry` |
| `grid9:{region}:regional-aggregate` | Hash | none | rollover, pass, and settlement dedupe fields |
| `grid9:{region}:regional-lock` | String | 8 s | non-ledger regional maintenance |
| `grid9:{region}:queue` | Sorted set | none | queue tickets by priority and time |
| `grid9:{region}:queue-entry:{ticketId}` | String | 5 min | `Grid9QueueEntry` |
| `grid9:{region}:assignment:{assignmentId}` | String | 30 s | `Grid9MatchAssignment` |
| `grid9:connection:{connectionSessionId}:nonce:{sha256}` | String | 10 min | pre-match nonce |
| `grid9:timers-projection` | Sorted set | none | rebuildable deadline index |

The regional aggregate uses fields `rollover`, `rollover-claim:{claimId}`,
`settlement:{settlementId}`, `sponsor-pass:{passId}`,
`nonce:{connectionSessionId}:{sha256}`, and `intent:{userId}:{intentId}`. This keeps regional money,
passes, and queue command idempotency co-located.

Queue priority uses score bands: Sponsor's Pass tickets use `0 + enqueuedEpochMs / 1e15`;
standard tickets use `1 + enqueuedEpochMs / 1e15`. Lower scores match first. A consumed pass and
its queue assignment are committed by one region-slot Lua operation. The operation changes the
pass from `available` to `reserved`, creates `Grid9MatchAssignment`, and removes the queue ticket.
An expired assignment returns the pass to `available`; a successful `MATCH_JOIN` changes it to
`consumed`.

`QUEUE_JOIN` and `QUEUE_LEAVE` include the region. Their nonce receipt, user-scoped intent receipt,
queue entry, and sorted-set mutation all use the same `{region}` slot and commit in one prevalidated
regional Lua operation. Retrying after an uncertain connection returns the stored private event.
The standalone connection nonce key is used only for side-effect-free `PING`.

The timer sorted set is not authoritative and is not part of a match transaction. Each state
mutation writes a versioned timer-outbox field atomically. A worker projects that field to the
sorted set, and a periodic repair scan rebuilds missing entries from aggregate state.

Regional rollover is an idempotent saga because a match hash tag and a region hash tag cannot share
one Redis Cluster transaction. Terminal match commit writes a `Grid9SettlementOutboxRecord`.
A worker retries it using `settlementId`. One regional Lua function checks
`settlement:{settlementId}` in the regional aggregate, updates rollover, creates the same-region
Sponsor's Pass, and stores `Grid9RegionalSettlementReceipt` in one `HSET`. Replays return that
receipt. The worker then marks the match settlement applied. A crash between the two commits is
safe because the regional dedupe field makes the external effect exactly once.

Opening rollover uses the inverse, exactly-once claim saga. Before creating a match, one regional
Lua operation moves `availableCoins` to `reservedCoins`, increments a fencing token, and writes a
leased `Grid9RolloverClaim` bound to one target match ID. New rollover credits arriving during the
lease add to `availableCoins`; they never change the reserved amount.

Match creation stores the claim ID, fencing token, and reserved coins in an `initializing` match.
The match is not joinable and cannot enter `lobby` until a regional finalize operation consumes the
same unexpired claim and fencing token. Finalize clears only `reservedCoins`, preserves any newly
credited `availableCoins`, and returns an idempotent receipt. A late creator with an expired or
superseded fence cannot finalize or activate its match.

After lease expiry, the regional operation may release the claim without reading another Redis
slot: it changes the claim to `released` and moves `reservedCoins` back to `availableCoins`.
Any orphaned `initializing` aggregate is then cancelled. Because activation requires the consumed
regional receipt, release can never race with a funded active match.

## Atomic paid-action boundary

The Phase 2 action script must receive only keys sharing `{matchId}` and perform this order:

1. Read the aggregate and reject if its nonce field exists.
2. Look up `intent:{authenticatedUserId}:{intentId}`. Return the stored receipt only when user,
   match, command type, and canonical intent hash all match. Reject `INTENT_CONFLICT` otherwise.
3. Decode state and reject a phase, version, eligibility, target, item, amount, or cooldown error.
4. Decode the actor escrow or proxy bankroll and reject insufficient funds.
5. Build the full next state, escrow/bankroll, nonce, receipt, timer outbox, and ledger JSON values
   without writing.
6. For a catalog purchase, add the exact catalog contribution to the match jackpot.
7. Apply shield, damage, elimination, or mercenary funding to the state.
8. Increment state version and reserve one sequence for each room event the result will emit.
9. Execute one `HSET` with every changed aggregate field.
10. Return the committed receipt and events to Node. Node may broadcast only this successful
    result. Stream/timer projections occur after commit and are replayable from aggregate fields.

No script command after the final `HSET` is allowed to affect action success. A process crash after
commit but before broadcast is repaired by the persisted replay event and the client's version-gap
snapshot.

## Canonical Redis state JSON

The following is a complete valid `Grid9GameState` instance. It is the exact JSON value stored in
field `state` at `grid9:{3f6582f0-808d-468b-b88f-e208aa56cff3}:aggregate`.

```json
{
  "schemaVersion": 1,
  "game": "grid9",
  "matchId": "3f6582f0-808d-468b-b88f-e208aa56cff3",
  "liveSessionId": "c29bbc4b-f65e-4b08-b1f0-e4df7c14d474",
  "region": "eu-west-2",
  "phase": "combat",
  "phaseStartedAt": "2026-08-15T03:30:03.000Z",
  "phaseEndsAt": "2026-08-15T03:45:03.000Z",
  "players": [
    {
      "slotId": "2ee90c5a-b1d6-4a72-a158-b68fe8ef7990",
      "slotIndex": 0,
      "kind": "human",
      "displayName": "Alex",
      "avatarUrl": "https://cdn.blyp.world/avatars/alex.jpg",
      "feed": {
        "kind": "human_live",
        "provider": "ivs",
        "streamId": "c29bbc4b-f65e-4b08-b1f0-e4df7c14d474",
        "participantId": "26522274-e001-70aa-51b6-bcbbdffc43bb"
      },
      "status": "alive",
      "mode": "combatant",
      "connectionState": "connected",
      "health": 88,
      "maxHealth": 100,
      "shieldPoints": 20,
      "maxShieldPoints": 60,
      "mercenaryBankrollCoins": 0,
      "mercenarySponsorCoins": 0,
      "mercenaryMicroDropCoins": 0,
      "supporterTotalCoins": 0,
      "topSupporters": [],
      "stats": {
        "attacksPurchased": 2,
        "shieldsPurchased": 1,
        "damageDealt": 24,
        "damageReceived": 12,
        "coinsSpent": 45,
        "mercenaryCoinsReceived": 0,
        "microDropsReceived": 1
      },
      "joinedAt": "2026-08-15T03:30:00.100Z",
      "eliminatedAt": null,
      "eliminatedBy": null,
      "lastDamagedAt": "2026-08-15T03:30:18.700Z",
      "userId": "26522274-e001-70aa-51b6-bcbbdffc43bb",
      "publicProfileId": "alex",
      "queueTicketId": "8d02e255-3bf0-46c2-a96e-5a687cd37d45",
      "sponsorPassId": null
    },
    {
      "slotId": "40540f48-a711-4772-a35a-c17d3f4ba4c9",
      "slotIndex": 1,
      "kind": "human",
      "displayName": "Riley",
      "avatarUrl": "https://cdn.blyp.world/avatars/riley.jpg",
      "feed": {
        "kind": "human_live",
        "provider": "livekit",
        "streamId": "c29bbc4b-f65e-4b08-b1f0-e4df7c14d474",
        "participantId": "f5c94675-d7ce-4d25-8729-9e32d04564b7"
      },
      "status": "eliminated",
      "mode": "sabotage",
      "connectionState": "connected",
      "health": 0,
      "maxHealth": 100,
      "shieldPoints": 0,
      "maxShieldPoints": 60,
      "mercenaryBankrollCoins": 0,
      "mercenarySponsorCoins": 0,
      "mercenaryMicroDropCoins": 0,
      "supporterTotalCoins": 0,
      "topSupporters": [],
      "stats": {
        "attacksPurchased": 1,
        "shieldsPurchased": 0,
        "damageDealt": 12,
        "damageReceived": 100,
        "coinsSpent": 10,
        "mercenaryCoinsReceived": 0,
        "microDropsReceived": 0
      },
      "joinedAt": "2026-08-15T03:30:00.250Z",
      "eliminatedAt": "2026-08-15T03:30:32.000Z",
      "eliminatedBy": {
        "kind": "human",
        "userId": "26522274-e001-70aa-51b6-bcbbdffc43bb",
        "publicProfileId": "alex",
        "displayName": "Alex"
      },
      "lastDamagedAt": "2026-08-15T03:30:32.000Z",
      "userId": "f5c94675-d7ce-4d25-8729-9e32d04564b7",
      "publicProfileId": "riley",
      "queueTicketId": "c4facbf2-2038-44df-97f6-d24b49ff3014",
      "sponsorPassId": null
    },
    {
      "slotId": "c808b95b-241d-409b-a49d-3caa9829033d",
      "slotIndex": 2,
      "kind": "sentinel",
      "displayName": "Sentinel Ember",
      "avatarUrl": null,
      "feed": {
        "kind": "sentinel_render",
        "characterId": "ember",
        "animationSeed": 2102
      },
      "status": "alive",
      "mode": "combatant",
      "connectionState": "not_applicable",
      "health": 70,
      "maxHealth": 100,
      "shieldPoints": 0,
      "maxShieldPoints": 60,
      "mercenaryBankrollCoins": 40,
      "mercenarySponsorCoins": 40,
      "mercenaryMicroDropCoins": 0,
      "supporterTotalCoins": 40,
      "topSupporters": [
        {
          "userId": "f5c94675-d7ce-4d25-8729-9e32d04564b7",
          "publicProfileId": "riley",
          "displayName": "Riley",
          "contributedCoins": 40,
          "firstFundedAt": "2026-08-15T03:30:35.000Z",
          "lastFundedAt": "2026-08-15T03:30:35.000Z"
        }
      ],
      "stats": {
        "attacksPurchased": 1,
        "shieldsPurchased": 0,
        "damageDealt": 12,
        "damageReceived": 30,
        "coinsSpent": 10,
        "mercenaryCoinsReceived": 40,
        "microDropsReceived": 0
      },
      "joinedAt": "2026-08-15T03:30:02.000Z",
      "eliminatedAt": null,
      "eliminatedBy": null,
      "lastDamagedAt": "2026-08-15T03:30:25.000Z",
      "sentinelId": "sentinel-ember-02",
      "ai": {
        "profileId": "balanced-v1",
        "targetStrategy": "lowest_health",
        "aggressionBps": 6000,
        "shieldBelowHealth": 35,
        "minimumReactionMs": 900,
        "maximumReactionMs": 2200
      }
    },
    {
      "slotId": "d713f142-eed6-4ff4-8a9d-0d9bfc6fa2c4",
      "slotIndex": 3,
      "kind": "sentinel",
      "displayName": "Sentinel Nova",
      "avatarUrl": null,
      "feed": {
        "kind": "sentinel_render",
        "characterId": "nova",
        "animationSeed": 3103
      },
      "status": "alive",
      "mode": "combatant",
      "connectionState": "not_applicable",
      "health": 100,
      "maxHealth": 100,
      "shieldPoints": 15,
      "maxShieldPoints": 60,
      "mercenaryBankrollCoins": 0,
      "mercenarySponsorCoins": 0,
      "mercenaryMicroDropCoins": 0,
      "supporterTotalCoins": 0,
      "topSupporters": [],
      "stats": {
        "attacksPurchased": 0,
        "shieldsPurchased": 0,
        "damageDealt": 0,
        "damageReceived": 0,
        "coinsSpent": 0,
        "mercenaryCoinsReceived": 0,
        "microDropsReceived": 1
      },
      "joinedAt": "2026-08-15T03:30:02.000Z",
      "eliminatedAt": null,
      "eliminatedBy": null,
      "lastDamagedAt": null,
      "sentinelId": "sentinel-nova-03",
      "ai": {
        "profileId": "defensive-v1",
        "targetStrategy": "highest_support",
        "aggressionBps": 4200,
        "shieldBelowHealth": 60,
        "minimumReactionMs": 1200,
        "maximumReactionMs": 2800
      }
    },
    {
      "slotId": "83c85525-3660-48bd-b340-f6f8356db662",
      "slotIndex": 4,
      "kind": "sentinel",
      "displayName": "Sentinel Vex",
      "avatarUrl": null,
      "feed": {
        "kind": "sentinel_render",
        "characterId": "vex",
        "animationSeed": 4104
      },
      "status": "alive",
      "mode": "combatant",
      "connectionState": "not_applicable",
      "health": 82,
      "maxHealth": 100,
      "shieldPoints": 0,
      "maxShieldPoints": 60,
      "mercenaryBankrollCoins": 0,
      "mercenarySponsorCoins": 0,
      "mercenaryMicroDropCoins": 0,
      "supporterTotalCoins": 0,
      "topSupporters": [],
      "stats": {
        "attacksPurchased": 2,
        "shieldsPurchased": 0,
        "damageDealt": 24,
        "damageReceived": 18,
        "coinsSpent": 20,
        "mercenaryCoinsReceived": 0,
        "microDropsReceived": 0
      },
      "joinedAt": "2026-08-15T03:30:02.000Z",
      "eliminatedAt": null,
      "eliminatedBy": null,
      "lastDamagedAt": "2026-08-15T03:30:21.000Z",
      "sentinelId": "sentinel-vex-04",
      "ai": {
        "profileId": "aggressive-v1",
        "targetStrategy": "lowest_health",
        "aggressionBps": 8200,
        "shieldBelowHealth": 25,
        "minimumReactionMs": 650,
        "maximumReactionMs": 1600
      }
    },
    {
      "slotId": "e2ee6c32-0cd3-4ce4-a263-197dd054fe07",
      "slotIndex": 5,
      "kind": "sentinel",
      "displayName": "Sentinel Echo",
      "avatarUrl": null,
      "feed": {
        "kind": "sentinel_render",
        "characterId": "echo",
        "animationSeed": 5105
      },
      "status": "alive",
      "mode": "combatant",
      "connectionState": "not_applicable",
      "health": 100,
      "maxHealth": 100,
      "shieldPoints": 0,
      "maxShieldPoints": 60,
      "mercenaryBankrollCoins": 0,
      "mercenarySponsorCoins": 0,
      "mercenaryMicroDropCoins": 0,
      "supporterTotalCoins": 0,
      "topSupporters": [],
      "stats": {
        "attacksPurchased": 0,
        "shieldsPurchased": 0,
        "damageDealt": 0,
        "damageReceived": 0,
        "coinsSpent": 0,
        "mercenaryCoinsReceived": 0,
        "microDropsReceived": 0
      },
      "joinedAt": "2026-08-15T03:30:02.000Z",
      "eliminatedAt": null,
      "eliminatedBy": null,
      "lastDamagedAt": null,
      "sentinelId": "sentinel-echo-05",
      "ai": {
        "profileId": "retaliatory-v1",
        "targetStrategy": "retaliatory",
        "aggressionBps": 6500,
        "shieldBelowHealth": 40,
        "minimumReactionMs": 850,
        "maximumReactionMs": 2100
      }
    },
    {
      "slotId": "154a0f44-b3dd-4576-97dc-0a7bfc154820",
      "slotIndex": 6,
      "kind": "sentinel",
      "displayName": "Sentinel Onyx",
      "avatarUrl": null,
      "feed": {
        "kind": "sentinel_render",
        "characterId": "onyx",
        "animationSeed": 6106
      },
      "status": "alive",
      "mode": "combatant",
      "connectionState": "not_applicable",
      "health": 76,
      "maxHealth": 100,
      "shieldPoints": 20,
      "maxShieldPoints": 60,
      "mercenaryBankrollCoins": 0,
      "mercenarySponsorCoins": 0,
      "mercenaryMicroDropCoins": 0,
      "supporterTotalCoins": 0,
      "topSupporters": [],
      "stats": {
        "attacksPurchased": 1,
        "shieldsPurchased": 1,
        "damageDealt": 12,
        "damageReceived": 24,
        "coinsSpent": 35,
        "mercenaryCoinsReceived": 0,
        "microDropsReceived": 0
      },
      "joinedAt": "2026-08-15T03:30:02.000Z",
      "eliminatedAt": null,
      "eliminatedBy": null,
      "lastDamagedAt": "2026-08-15T03:30:27.000Z",
      "sentinelId": "sentinel-onyx-06",
      "ai": {
        "profileId": "balanced-v1",
        "targetStrategy": "highest_health",
        "aggressionBps": 6000,
        "shieldBelowHealth": 35,
        "minimumReactionMs": 900,
        "maximumReactionMs": 2200
      }
    },
    {
      "slotId": "dc524497-f20b-4a3d-b7f3-08d4ed85ba21",
      "slotIndex": 7,
      "kind": "sentinel",
      "displayName": "Sentinel Pulse",
      "avatarUrl": null,
      "feed": {
        "kind": "sentinel_render",
        "characterId": "pulse",
        "animationSeed": 7107
      },
      "status": "alive",
      "mode": "combatant",
      "connectionState": "not_applicable",
      "health": 92,
      "maxHealth": 100,
      "shieldPoints": 0,
      "maxShieldPoints": 60,
      "mercenaryBankrollCoins": 0,
      "mercenarySponsorCoins": 0,
      "mercenaryMicroDropCoins": 0,
      "supporterTotalCoins": 0,
      "topSupporters": [],
      "stats": {
        "attacksPurchased": 1,
        "shieldsPurchased": 0,
        "damageDealt": 12,
        "damageReceived": 8,
        "coinsSpent": 10,
        "mercenaryCoinsReceived": 0,
        "microDropsReceived": 0
      },
      "joinedAt": "2026-08-15T03:30:02.000Z",
      "eliminatedAt": null,
      "eliminatedBy": null,
      "lastDamagedAt": "2026-08-15T03:30:29.000Z",
      "sentinelId": "sentinel-pulse-07",
      "ai": {
        "profileId": "random-v1",
        "targetStrategy": "random_survivor",
        "aggressionBps": 5500,
        "shieldBelowHealth": 40,
        "minimumReactionMs": 1000,
        "maximumReactionMs": 2400
      }
    },
    {
      "slotId": "89d38bc6-ab17-45f2-95c8-8ebee1d86df6",
      "slotIndex": 8,
      "kind": "sentinel",
      "displayName": "Sentinel Rift",
      "avatarUrl": null,
      "feed": {
        "kind": "sentinel_render",
        "characterId": "rift",
        "animationSeed": 8108
      },
      "status": "alive",
      "mode": "combatant",
      "connectionState": "not_applicable",
      "health": 100,
      "maxHealth": 100,
      "shieldPoints": 0,
      "maxShieldPoints": 60,
      "mercenaryBankrollCoins": 0,
      "mercenarySponsorCoins": 0,
      "mercenaryMicroDropCoins": 0,
      "supporterTotalCoins": 0,
      "topSupporters": [],
      "stats": {
        "attacksPurchased": 0,
        "shieldsPurchased": 0,
        "damageDealt": 0,
        "damageReceived": 0,
        "coinsSpent": 0,
        "mercenaryCoinsReceived": 0,
        "microDropsReceived": 0
      },
      "joinedAt": "2026-08-15T03:30:02.000Z",
      "eliminatedAt": null,
      "eliminatedBy": null,
      "lastDamagedAt": null,
      "sentinelId": "sentinel-rift-08",
      "ai": {
        "profileId": "aggressive-v1",
        "targetStrategy": "highest_support",
        "aggressionBps": 8200,
        "shieldBelowHealth": 25,
        "minimumReactionMs": 650,
        "maximumReactionMs": 1600
      }
    }
  ],
  "audienceCount": 1842,
  "turn": {
    "turnNumber": 8,
    "spotlightSlotIndex": 4,
    "startedAt": "2026-08-15T03:30:35.000Z",
    "spotlightEndsAt": "2026-08-15T03:30:36.250Z",
    "endsAt": "2026-08-15T03:30:40.000Z",
    "microDropAwarded": true
  },
  "lastMicroDrop": {
    "dropId": "483a2375-49d2-482f-94d5-c24042b486de",
    "turnNumber": 8,
    "recipientSlotIndex": 4,
    "reward": {
      "kind": "shield",
      "shieldPoints": 15
    },
    "entropyDigest": "3b90793c3b37c9ee4ae6bad1e17363b9a46c973bdcbb639671dfe90e9fb3f037",
    "awardedAt": "2026-08-15T03:30:36.250Z"
  },
  "lastAction": {
    "intentId": "8aab0f2a-9917-4eaa-b760-13ccbfa1c58f",
    "serverOperationId": null,
    "actor": {
      "kind": "human_player",
      "publicProfileId": "alex",
      "displayName": "Alex"
    },
    "kind": "weapon",
    "weaponId": "arrow",
    "shieldId": null,
    "targetSlotIndex": 7,
    "affectedSlotIndices": [7],
    "ledgerEntryId": "1733444198848-0",
    "committedAt": "2026-08-15T03:30:39.250Z"
  },
  "jackpot": {
    "currency": "coins",
    "openingRolloverCoins": 25,
    "openingRolloverClaimId": "04be905d-9030-49dd-b158-10a203a56df6",
    "openingRolloverFenceToken": 19,
    "openingRolloverClaimStatus": "consumed",
    "purchaseContributionCoins": 122,
    "currentCoins": 147,
    "status": "growing",
    "rolloverSourceMatchId": "d601525d-0b0d-4b90-a88c-5f8658940659",
    "rolloverDestinationMatchId": null,
    "winnerSlotIndex": null,
    "winnerUserId": null,
    "winnerSentinelId": null,
    "sponsorPassRecipientUserId": null
  },
  "outcome": null,
  "settlement": {
    "status": "not_started",
    "settlementId": null,
    "winnerPayoutCoins": 0,
    "rolloverCoins": 0,
    "escrowReleaseCoins": 0,
    "attemptCount": 0,
    "lastAttemptAt": null,
    "completedAt": null,
    "errorCode": null
  },
  "rules": {
    "rulesVersion": "2026-08-15.1",
    "slotCount": 9,
    "maxHealth": 100,
    "maxShieldPoints": 60,
    "sentinelFillDelayMs": 0,
    "countdownMs": 3000,
    "turnDurationMs": 5000,
    "spotlightDurationMs": 1250,
    "maxMatchDurationMs": 900000,
    "microDropCoinReward": 5,
    "microDropShieldReward": 15,
    "minEscrowReserveCoins": 10,
    "maxEscrowReserveCoins": 20000,
    "minMercenaryFundCoins": 10,
    "maxMercenaryFundCoins": 5000
  },
  "authority": {
    "stateVersion": 42,
    "eventSequence": 87,
    "entropySeed": "fjVfkwHQpX4j_wbKx-fQfN1l0urqzEiR7kLywHp6cqs",
    "entropyCommitment": "2bf2b9e7ad7e9d9892b00830ff66837429131d9a9e0b226901572bdfebd90abf",
    "nextTurnAt": "2026-08-15T03:30:40.000Z",
    "matchDeadlineAt": "2026-08-15T03:45:03.000Z",
    "cooldowns": {
      "26522274-e001-70aa-51b6-bcbbdffc43bb:arrow": {
        "actorKey": "user:26522274-e001-70aa-51b6-bcbbdffc43bb",
        "actor": {
          "kind": "human_player",
          "userId": "26522274-e001-70aa-51b6-bcbbdffc43bb",
          "publicProfileId": "alex",
          "displayName": "Alex"
        },
        "itemId": "arrow",
        "readyAt": "2026-08-15T03:30:40.750Z"
      }
    },
    "proxyNextActionAt": {
      "sentinel-ember-02": "2026-08-15T03:30:40.900Z",
      "sentinel-vex-04": "2026-08-15T03:30:40.650Z"
    },
    "mutationCount": 41,
    "lastMutationAt": "2026-08-15T03:30:39.250Z"
  },
  "createdAt": "2026-08-15T03:30:00.000Z",
  "updatedAt": "2026-08-15T03:30:39.250Z",
  "expiresAt": "2026-08-16T03:30:39.250Z"
}
```

## Phase boundaries

Phase 1 contains contracts, catalog values, Redis keys, and invariant tests. It does not open a
socket, execute Redis commands, debit a wallet, or render UI. Those mutations belong to Phase 2
and must follow the atomic boundary above.

---

## Grid 9 v2 (Wave 1)

**Unlocked** 2026-08-16 as a protocol/product redesign. Client design: `src/games/grid9/GRID9_V2_DESIGN.md`.
Protocol version **2**, rules version **2026-08-16.4**. LIVE / IVS paths remain frozen; stage video is
Grid9-local LiveKit (or SentinelStage fallback).

### Authority that does not change

Redis match aggregate, Lua single-`HSET` commit, nonce replay rejection, room `eventSequence`,
Cognito socket identity, and escrow reservation/settlement remain the source of truth. Clients still
send intents only; they never invent HP, jackpot, or winner.

### Lifecycle (v2)

**Public:** `initializing` → `lobby_waiting` (~30s open lobby) → sentinel fill → `roulette` (≈3.5s) → `combat`
(30s action window; after act or timeout → immediate next roulette) → … → `settling` → `completed`.

Humans who Join during the same public lobby window coalesce into **one** open match (Redis
`open-public-lobby` pointer + seat replace). Private rooms are unchanged (code join / host start).

**Private:** `initializing` → `private_lobby` (indefinite) until host `START_PRIVATE_MATCH` →
sentinel fill → same `roulette` / `combat` loop.

Legacy phase name `countdown` is retired in new matches; timer reason becomes `lobby_waiting_end`
/ `roulette_end` / `turn_end`.

### Roulette + turn clock

Spotlight is no longer sequential grid order. Server RNG picks among living slots, broadcasts
`ROULETTE_START`, then after `rouletteDurationMs` lands with `ROULETTE_LAND` and starts a 30s
`combat` turn (`TURN_TICK` / turn state). Timeout or disconnect auto-shields (if defense unused)
or auto-passes, then advances to the next roulette.

### Catalog (locked with Lua)

| Item | Cost | Jackpot | Effect |
| --- | ---: | ---: | --- |
| Arrow | 10 | 5 | 20 direct |
| Fireball | 25 | 12 | 40 direct + 10 orthogonal |
| Mega Bomb | 50 | 25 | 60 direct |
| Shield | 15 | 8 | +30 SP, cap 100 |

Inventory capacity 3. Roulette land free drop weights: 70 / 20 / 8 / 2 (Arrow / Shield / Fireball /
Mega Bomb). Per turn: max 1 attack + 1 defense for the active combatant.

### Room mode + host

Match state carries `roomMode: "public" | "private"`, `ownerUserId`, and optional `roomCode`.
Host-only intents (`START_PRIVATE_MATCH`, `KICK_PLAYER`, `CHANGE_SETTINGS`) require
`socket.userId === ownerUserId`.

### Economy (locked)

Public matches seed `houseSeedCoins = 100` into the jackpot pool.

**Victory Tokens (SoT):** human winners are credited `floor(jackpotCoins * GRID9_TOKEN_PAYOUT_BPS / 10000)`
into `wallets.token_available` (not raw coins). Instant convert:
`POST /wallet/convert-tokens` → `ceil(tokens * 1.15)` spendable coins (gems paths remain read-only).

**Audience weapon gifts:** `SEND_ARSENAL_GIFT` / `BUY_INVENTORY_ITEM` debit catalog `costCoins`, split
`GRID9_AUDIENCE_GIFT_SEAT_BPS=7000` bankroll + `GRID9_AUDIENCE_GIFT_JACKPOT_BPS=3000` jackpot, and grant
the arsenal item into inventory (FIFO drop oldest at capacity 3). Audience cannot FIRE arsenal;
only the roulette-active seat fires from inventory/on-turn purchase.

**Disconnect:** `GRID9_DISCONNECT_GRACE_MS=9000` then auto-resolve spotlight turn.

**Kick:** host demotes seat → audience + Sentinel fill.

Wave constants:
`GRID9_AUDIENCE_GIFT_SEAT_BPS=7000`, `GRID9_AUDIENCE_GIFT_JACKPOT_BPS=3000`,
`GRID9_TOKEN_PAYOUT_BPS=5000`, `GRID9_TOKEN_CONVERT_BONUS_BPS=1500`.

### New intents / events (additive)

Intents: `PRIVATE_ROOM_CREATE`, `PRIVATE_ROOM_JOIN`, `START_PRIVATE_MATCH`, `KICK_PLAYER`,
`CHANGE_SETTINGS`.

Room events: `ROULETTE_START`, `ROULETTE_LAND`, `TURN_TICK` (plus existing resolve/completion events).
