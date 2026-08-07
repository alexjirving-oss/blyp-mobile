/**
 * Launch / Owner self-test unblocks for withdrawals.
 *
 * Softens account-age/new-payout holds and request velocity so a provider
 * failure can be retried immediately. Fraud freezes/review, chargebacks, KYC,
 * min payout, fee, open-request lock, and payout-value caps still apply.
 *
 * Eligible when userId is in:
 *   - WITHDRAW_TEST_SUBS (explicit env), or
 *   - ADMIN_ALLOWLIST_SUBS, or
 *   - Owner bootstrap seat (Alex)
 */

/** Keep in sync with BOOTSTRAP_STAFF_ROLES owner in adminRbac.ts */
const OWNER_BOOTSTRAP_SUBS = new Set<string>([
  '26522274-e001-70aa-51b6-bcbbdffc43bb', // Alex
]);

function parseSubCsv(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const part of String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    out.add(part);
  }
  return out;
}

export function isWithdrawLaunchTestUser(userId: string): boolean {
  const id = String(userId || '').trim();
  if (!id) return false;

  if (parseSubCsv(process.env.WITHDRAW_TEST_SUBS).has(id)) return true;
  if (parseSubCsv(process.env.ADMIN_ALLOWLIST_SUBS).has(id)) return true;
  if (OWNER_BOOTSTRAP_SUBS.has(id)) return true;

  return false;
}

/** Max gems a single launch-test / Owner gem credit may grant. */
export const LAUNCH_TEST_GEM_CREDIT_CAP = 5_000;

/** Owner self-test amounts at/below this skip pending_review from hold soft-flags. */
export const OWNER_SELF_TEST_AUTO_APPROVE_MAX_GEMS = 5_000;
