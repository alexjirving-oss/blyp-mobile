import { getUnlockedAmount } from './LockedEarningsStore'
import { WITHDRAWAL_POLICY } from './WithdrawalPolicy'

export function getWithdrawableCoins(hostId: string) {
    const unlocked = getUnlockedAmount(hostId)

    const afterFee =
        unlocked * (1 - WITHDRAWAL_POLICY.PLATFORM_FEE_PERCENT / 100)

    if (afterFee < WITHDRAWAL_POLICY.MIN_PAYOUT_COINS) {
        return 0
    }

    return Math.floor(afterFee)
}
