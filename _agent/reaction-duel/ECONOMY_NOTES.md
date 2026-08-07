# Reaction Duel economy notes

This ship changes only Reaction Duel. It does **not** rebuild Play Console IAP
SKUs, global gem valuation, or cash-out rates.

## Shipped duel model

- Each player locks **100 coins**.
- The winner receives **300 coins** through the existing non-withdrawable
  HOUSE/admin-credit wallet path; the two entries remove 200 coins and the house
  supplies the additional 100.
- A five-round draw refunds both entries. A disconnect before both entries lock
  refunds every locked entry. After both lock, one player disconnecting forfeits
  the 300-coin prize to the player who remains.

## Intended future model (not implemented here)

- Buy **N coins for £N/100**: 99p → 99 coins, £4.99 → 499 coins.
- Coins are not cashable. Gifts remain coins during a live; when that live ends,
  coins convert to gems at a 1:1 count. Gems cash out at about half the coin
  purchase value.
- A 300-coin Duel prize therefore becomes 300 gems at live end through the
  live-end conversion once that economy model exists. No separate conversion
  was added in this pass.
