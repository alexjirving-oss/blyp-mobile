import type Redis from 'ioredis';
import {
  GRID9_SHIELD_CATALOG,
  GRID9_WEAPON_CATALOG,
} from './catalog';

export function grid9PaidCatalogJson(): string {
  return JSON.stringify({
    weapons: Object.fromEntries(
      Object.entries(GRID9_WEAPON_CATALOG).map(([id, item]) => [
        id,
        {
          cost: item.costCoins,
          jackpot: item.jackpotContributionCoins,
        },
      ]),
    ),
    shields: Object.fromEntries(
      Object.entries(GRID9_SHIELD_CATALOG).map(([id, item]) => [
        id,
        {
          cost: item.costCoins,
          jackpot: item.jackpotContributionCoins,
        },
      ]),
    ),
  });
}

/**
 * Redis executes this script atomically. It performs every read/validation
 * before the sole mutating command: one multi-field HSET.
 * Paid catalog numbers are injected from catalog.ts at module load.
 */
export const GRID9_AGGREGATE_COMMIT_LUA = `
local aggregateKey = KEYS[1]
local request = cjson.decode(ARGV[1])
local paidCatalog = cjson.decode([=[${grid9PaidCatalogJson()}]=])

local function reply(status, code, detail)
  return cjson.encode({ status = status, code = code, detail = detail })
end

if request.intentField ~= cjson.null and request.intentField ~= nil then
  local existingIntentJson = redis.call('HGET', aggregateKey, request.intentField)
  if existingIntentJson then
    local existingIntent = cjson.decode(existingIntentJson)
    if existingIntent.canonicalIntentHash ~= request.canonicalIntentHash
      or existingIntent.userId ~= request.authenticatedUserId
      or existingIntent.commandType ~= request.commandType
      or existingIntent.matchId ~= request.matchId then
      return reply('REJECTED', 'INTENT_CONFLICT', existingIntentJson)
    end
    if existingIntent.status == 'committed' then
      if request.nonceField ~= cjson.null and request.nonceField ~= nil then
        local replayNonceJson = redis.call('HGET', aggregateKey, request.nonceField)
        if replayNonceJson then
          local replayNonce = cjson.decode(replayNonceJson)
          if replayNonce.intentId ~= request.intentId then
            return reply('REJECTED', 'NONCE_REPLAY', nil)
          end
        else
          for _, pair in ipairs(request.fields) do
            if pair[1] == request.nonceField then
              redis.call('HSET', aggregateKey, request.nonceField, pair[2])
              break
            end
          end
        end
      end
      return reply('REPLAY', nil, existingIntentJson)
    elseif existingIntent.status == 'rejected' then
      return reply('REJECTED', existingIntent.errorCode, existingIntentJson)
    end
  end
end

if request.operationField ~= cjson.null and request.operationField ~= nil then
  local existingOperationJson = redis.call('HGET', aggregateKey, request.operationField)
  if existingOperationJson then
    local existingOperation = cjson.decode(existingOperationJson)
    if existingOperation.canonicalOperationHash ~= request.canonicalOperationHash then
      return reply('REJECTED', 'INTENT_CONFLICT', existingOperationJson)
    end
    return reply('REPLAY', nil, existingOperationJson)
  end
end

if request.nonceField ~= cjson.null and request.nonceField ~= nil
  and redis.call('HEXISTS', aggregateKey, request.nonceField) == 1 then
  local existingNonce = cjson.decode(redis.call('HGET', aggregateKey, request.nonceField))
  if existingNonce.intentId ~= request.intentId then
    return reply('REJECTED', 'NONCE_REPLAY', nil)
  end
end

local currentStateJson = redis.call('HGET', aggregateKey, 'state')
if not currentStateJson then
  return reply('REJECTED', 'MATCH_NOT_FOUND', nil)
end

local currentState = cjson.decode(currentStateJson)
if tonumber(currentState.authority.stateVersion) ~= request.expectedStateVersion then
  return reply('REJECTED', 'STALE_STATE', currentStateJson)
end
if request.commandType == 'RESERVE_COINS'
  and currentState.phase ~= 'lobby_waiting'
  and currentState.phase ~= 'private_lobby'
  and currentState.phase ~= 'roulette'
  and currentState.phase ~= 'countdown'
  and currentState.phase ~= 'combat' then
  return reply('REJECTED', 'MATCH_NOT_ACTIVE', currentState.phase)
end
if (request.commandType == 'FIRE_WEAPON'
    or request.commandType == 'PURCHASE_SHIELD'
    or request.commandType == 'FUND_MERCENARY')
  and currentState.phase ~= 'combat' then
  return reply('REJECTED', 'MATCH_NOT_ACTIVE', currentState.phase)
end
if (request.commandType == 'SEND_ARSENAL_GIFT'
    or request.commandType == 'BUY_INVENTORY_ITEM')
  and currentState.phase ~= 'lobby_waiting'
  and currentState.phase ~= 'private_lobby'
  and currentState.phase ~= 'roulette'
  and currentState.phase ~= 'countdown'
  and currentState.phase ~= 'combat' then
  return reply('REJECTED', 'MATCH_NOT_ACTIVE', currentState.phase)
end
local newStateJson = nil
local newEscrowJson = nil
for _, pair in ipairs(request.fields) do
  if pair[1] == 'state' then newStateJson = pair[2] end
  if request.escrowField ~= cjson.null and pair[1] == request.escrowField then
    newEscrowJson = pair[2]
  end
end
if not newStateJson then
  return reply('REJECTED', 'INTERNAL_ERROR', 'missing state field')
end
local newState = cjson.decode(newStateJson)
if newState.authority.stateVersion ~= currentState.authority.stateVersion + request.stateVersionDelta then
  return reply('REJECTED', 'INTERNAL_ERROR', 'invalid state version delta')
end

if request.paidValidation ~= cjson.null and request.paidValidation ~= nil then
  local validation = request.paidValidation
  local ledgerJson = nil
  for _, pair in ipairs(request.fields) do
    if pair[1] == validation.ledgerField then ledgerJson = pair[2] end
  end
  if not ledgerJson then return reply('REJECTED', 'INTERNAL_ERROR', 'missing ledger field') end
  local ledger = cjson.decode(ledgerJson)
  local debit = -tonumber(request.escrowDelta)
  if ledger.actorUserId ~= request.authenticatedUserId
    or tonumber(ledger.debitCoins) ~= debit
    or tonumber(ledger.stateVersionBefore) ~= tonumber(currentState.authority.stateVersion)
    or tonumber(ledger.stateVersionAfter) ~= tonumber(newState.authority.stateVersion) then
    return reply('REJECTED', 'INTERNAL_ERROR', 'ledger authority mismatch')
  end

  local actorSlot = nil
  for index, player in ipairs(currentState.players) do
    if player.kind == 'human' and player.userId == request.authenticatedUserId then
      actorSlot = index - 1
      if player.status ~= 'alive' or player.mode ~= 'combatant' then
        if request.commandType ~= 'FUND_MERCENARY'
          and request.commandType ~= 'SEND_ARSENAL_GIFT' then
          return reply('REJECTED', 'NOT_ELIGIBLE', nil)
        end
      end
    end
  end
  local targetIndex = tonumber(validation.targetSlotIndex)
  local oldTarget = currentState.players[targetIndex + 1]
  local newTarget = newState.players[targetIndex + 1]
  if not oldTarget or not newTarget or oldTarget.status ~= 'alive' then
    return reply('REJECTED', 'TARGET_NOT_ALIVE', nil)
  end

  if request.commandType == 'FIRE_WEAPON' then
    if actorSlot == nil then
      return reply('REJECTED', 'NOT_ELIGIBLE', nil)
    end
    local item = paidCatalog.weapons[validation.itemId]
    if not item or ledger.itemId ~= validation.itemId then
      return reply('REJECTED', 'ITEM_NOT_FOUND', nil)
    end
    local funding = validation.fundingSource or 'actor_escrow'
    if funding == 'inventory' or funding == 'free_drop' then
      if debit ~= 0
        or tonumber(newState.jackpot.currentCoins) ~= tonumber(currentState.jackpot.currentCoins)
        or tonumber(ledger.jackpotDeltaCoins) ~= 0 then
        return reply('REJECTED', 'INTERNAL_ERROR', 'free action must be zero-cost')
      end
    else
      if debit ~= tonumber(item.cost) then
        return reply('REJECTED', 'ITEM_NOT_FOUND', nil)
      end
      if tonumber(newState.jackpot.currentCoins) - tonumber(currentState.jackpot.currentCoins) ~= tonumber(item.jackpot)
        or tonumber(ledger.jackpotDeltaCoins) ~= tonumber(item.jackpot) then
        return reply('REJECTED', 'INTERNAL_ERROR', 'jackpot delta mismatch')
      end
    end
    if actorSlot ~= nil and actorSlot == targetIndex then
      return reply('REJECTED', 'TARGET_SELF', nil)
    end
  elseif request.commandType == 'PURCHASE_SHIELD' then
    if actorSlot == nil then
      return reply('REJECTED', 'NOT_ELIGIBLE', nil)
    end
    local item = paidCatalog.shields[validation.itemId]
    if not item or ledger.itemId ~= validation.itemId then
      return reply('REJECTED', 'ITEM_NOT_FOUND', nil)
    end
    local funding = validation.fundingSource or 'actor_escrow'
    if funding == 'inventory' or funding == 'free_drop' then
      if debit ~= 0
        or tonumber(newState.jackpot.currentCoins) ~= tonumber(currentState.jackpot.currentCoins)
        or tonumber(ledger.jackpotDeltaCoins) ~= 0 then
        return reply('REJECTED', 'INTERNAL_ERROR', 'free shield must be zero-cost')
      end
    else
      if debit ~= tonumber(item.cost) then
        return reply('REJECTED', 'ITEM_NOT_FOUND', nil)
      end
      if tonumber(newState.jackpot.currentCoins) - tonumber(currentState.jackpot.currentCoins) ~= tonumber(item.jackpot)
        or tonumber(ledger.jackpotDeltaCoins) ~= tonumber(item.jackpot) then
        return reply('REJECTED', 'INTERNAL_ERROR', 'shield purchase mismatch')
      end
    end
  elseif request.commandType == 'FUND_MERCENARY' then
    if actorSlot == nil then return reply('REJECTED', 'NOT_ELIGIBLE', nil) end
    local actorPlayer = currentState.players[actorSlot + 1]
    if actorPlayer.status ~= 'eliminated' or actorPlayer.mode ~= 'sabotage' then
      return reply('REJECTED', 'NOT_ELIGIBLE', nil)
    end
    if debit < tonumber(currentState.rules.minMercenaryFundCoins)
      or debit > tonumber(currentState.rules.maxMercenaryFundCoins)
      or tonumber(newTarget.mercenaryBankrollCoins) - tonumber(oldTarget.mercenaryBankrollCoins) ~= debit
      or tonumber(newTarget.mercenarySponsorCoins) - tonumber(oldTarget.mercenarySponsorCoins) ~= debit
      or tonumber(newState.jackpot.currentCoins) ~= tonumber(currentState.jackpot.currentCoins)
      or tonumber(ledger.jackpotDeltaCoins) ~= 0 then
      return reply('REJECTED', 'INVALID_FUND_AMOUNT', nil)
    end
  elseif request.commandType == 'SEND_ARSENAL_GIFT'
    or request.commandType == 'BUY_INVENTORY_ITEM' then
    local item = paidCatalog.weapons[validation.itemId] or paidCatalog.shields[validation.itemId]
    if not item or ledger.itemId ~= validation.itemId then
      return reply('REJECTED', 'ITEM_NOT_FOUND', nil)
    end
    if debit ~= tonumber(item.cost) then
      return reply('REJECTED', 'ITEM_NOT_FOUND', nil)
    end
    local seatDelta = math.floor(debit * 7000 / 10000)
    local jackpotDelta = debit - seatDelta
    if tonumber(ledger.jackpotDeltaCoins) ~= jackpotDelta
      or tonumber(newState.jackpot.currentCoins) - tonumber(currentState.jackpot.currentCoins) ~= jackpotDelta
      or tonumber(newTarget.mercenaryBankrollCoins) - tonumber(oldTarget.mercenaryBankrollCoins) ~= seatDelta
      or tonumber(newTarget.mercenarySponsorCoins) - tonumber(oldTarget.mercenarySponsorCoins) ~= seatDelta then
      return reply('REJECTED', 'INTERNAL_ERROR', 'arsenal grant split mismatch')
    end
    if request.commandType == 'BUY_INVENTORY_ITEM' then
      if actorSlot == nil or actorSlot ~= targetIndex then
        return reply('REJECTED', 'NOT_ELIGIBLE', nil)
      end
    end
  end
end

if request.escrowField ~= cjson.null and request.escrowField ~= nil then
  local currentEscrowJson = redis.call('HGET', aggregateKey, request.escrowField)
  if request.expectedEscrowJson == cjson.null then
    if currentEscrowJson then
      return reply('REJECTED', 'STALE_STATE', currentEscrowJson)
    end
  elseif currentEscrowJson ~= request.expectedEscrowJson then
    return reply('REJECTED', 'STALE_STATE', currentEscrowJson)
  end

  local oldAvailable = 0
  if currentEscrowJson then
    local currentEscrow = cjson.decode(currentEscrowJson)
    if currentEscrow.status ~= 'open' then
      return reply('REJECTED', 'ESCROW_FROZEN', nil)
    end
    oldAvailable = tonumber(currentEscrow.availableCoins)
  end
  if request.escrowDelta < 0 and oldAvailable < -request.escrowDelta then
    return reply('REJECTED', 'INSUFFICIENT_FUNDS', tostring(oldAvailable))
  end
  if not newEscrowJson then
    return reply('REJECTED', 'INTERNAL_ERROR', 'missing escrow field')
  end
  local newEscrow = cjson.decode(newEscrowJson)
  if tonumber(newEscrow.availableCoins) ~= oldAvailable + request.escrowDelta then
    return reply('REJECTED', 'INTERNAL_ERROR', 'invalid escrow delta')
  end
end

local flat = {}
for _, pair in ipairs(request.fields) do
  table.insert(flat, pair[1])
  table.insert(flat, pair[2])
end
if #flat == 0 then
  return reply('REJECTED', 'INTERNAL_ERROR', 'empty aggregate commit')
end

redis.call('HSET', aggregateKey, unpack(flat))
return reply('COMMITTED', nil, nil)
`;

export type Grid9AtomicCommitRequest = {
  matchId: string;
  intentId: string | null;
  authenticatedUserId: string | null;
  commandType: string | null;
  canonicalIntentHash: string | null;
  canonicalOperationHash: string | null;
  expectedStateVersion: number;
  stateVersionDelta: 0 | 1;
  escrowField: string | null;
  expectedEscrowJson: string | null;
  escrowDelta: number;
  nonceField: string | null;
  intentField: string | null;
  operationField: string | null;
  paidValidation: {
    ledgerField: string;
    itemId: string | null;
    targetSlotIndex: number;
    fundingSource?: 'actor_escrow' | 'inventory' | 'free_drop' | 'mercenary_bankroll';
  } | null;
  fields: Array<[field: string, value: string]>;
};

export type Grid9AtomicCommitResult = {
  status: 'COMMITTED' | 'REPLAY' | 'REJECTED';
  code: string | null;
  detail: string | null;
};

let scriptShaPromise: Promise<string> | null = null;

async function scriptSha(redis: Redis): Promise<string> {
  if (!scriptShaPromise) {
    scriptShaPromise = Promise.resolve(
      redis.script('LOAD', GRID9_AGGREGATE_COMMIT_LUA) as Promise<string>,
    ).catch((error) => {
      scriptShaPromise = null;
      throw error;
    });
  }
  return scriptShaPromise;
}

export async function commitGrid9Aggregate(
  redis: Redis,
  aggregateKey: string,
  request: Grid9AtomicCommitRequest,
): Promise<Grid9AtomicCommitResult> {
  const fieldNames = request.fields.map(([field]) => field);
  if (new Set(fieldNames).size !== fieldNames.length) {
    throw new TypeError('Grid 9 aggregate commit contains duplicate fields');
  }
  const execute = async () => {
    const sha = await scriptSha(redis);
    return redis.evalsha(
      sha,
      1,
      aggregateKey,
      JSON.stringify(request),
    ) as Promise<string>;
  };

  let raw: string;
  try {
    raw = await execute();
  } catch (error: any) {
    if (!String(error?.message || error).includes('NOSCRIPT')) throw error;
    scriptShaPromise = null;
    raw = await execute();
  }
  return JSON.parse(raw) as Grid9AtomicCommitResult;
}
