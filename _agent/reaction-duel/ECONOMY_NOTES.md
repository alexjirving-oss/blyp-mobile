# Reaction Duel economy

## Stake and prize

- The live host chooses one whole-coin stake from **25–5,000 coins**.
- The UI offers **50 / 100 / 250 / 500** presets plus a custom amount.
- The opponent confirms the same server-owned stake by locking it. The duel cannot
  begin until both players have locked that exact amount.
- The winner prize is always **3 × stake**. Two players fund 2 × stake; the house
  tops up the remaining 1 × stake.
- Examples: 50 → 150, 100 → 300, 250 → 750, and custom X → 3X.
- A draw or a host-ended duel refunds each lock in its original paid-coin and
  bonus-coin proportions.

## Live coins, then gems

Reaction Duel winnings use two explicit stages:

1. **During the live:** the server writes one idempotent
   `REACTION_DUEL_PRIZE` ledger credit with currency `COIN`. It is scoped to the
   live session and remains pending until that live ends. No GEM is credited
   mid-live.
2. **When the live ends:** `endLiveSession` first closes/refunds any unfinished
   duel, then calls `settleReactionDuelLiveCoins`. Each pending prize coin row is
   marked `CONVERTED`, and one idempotent `REACTION_DUEL_GEM_SETTLEMENT` row
   credits the winner's gem wallet.

The count conversion is **1:1**: 300 live coins become 300 gems. Product
valuation remains separate from count: a gem's cash-out value is **one-half of
the nominal live-coin value**. Coins themselves are not cash-withdrawable.
Normal earned-gem controls still apply, including the production pending hold,
withdrawal eligibility, and platform fee.

The live-only coin prize does not enter the generally spendable wallet before
conversion. This prevents a winner from spending the same prize during the live
and then receiving its full gem conversion again at live end.

## Idempotency

- Entry debits/refunds are unique per duel and player.
- Prize coin credit is unique per duel.
- Gem settlement is unique per duel and consumes only pending prize rows for the
  ending session.
- Retrying live end returns zero unsettled prizes after the first successful
  conversion; it cannot mint a second gem credit.
