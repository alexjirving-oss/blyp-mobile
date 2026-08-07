/**
 * Pure Connect status helpers (no Stripe/DB imports — safe for unit tests).
 */

export type ConnectStatus = {
  linked: boolean;
  stripeAccountId?: string;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  /** Stripe requirements.currently_due — user must act (e.g. bank, ID). */
  currentlyDue: string[];
  pastDue: string[];
  pendingVerification: string[];
  disabledReason: string | null;
  /**
   * True when the user still needs an Account Link (missing account, form not
   * submitted, or Stripe has currently_due / past_due items).
   * False when only pending_verification remains (or payouts already enabled).
   */
  needsOnboarding: boolean;
  /** details_submitted and no currently_due/past_due — Express form complete. */
  onboardingComplete: boolean;
};

export function asReqList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/** Maps Stripe/DB flags into Connect UI decisions. */
export function deriveConnectFlags(input: {
  linked: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  chargesEnabled?: boolean;
  currentlyDue?: string[];
  pastDue?: string[];
  pendingVerification?: string[];
  disabledReason?: string | null;
  stripeAccountId?: string;
}): ConnectStatus {
  const currentlyDue = input.currentlyDue || [];
  const pastDue = input.pastDue || [];
  const pendingVerification = input.pendingVerification || [];
  const actionable = currentlyDue.length > 0 || pastDue.length > 0;
  const onboardingComplete = input.linked && !!input.detailsSubmitted && !actionable;
  // Re-open Connect only when Stripe still needs user input — not when the
  // form is done and Stripe is only verifying, or payouts are already on.
  const needsOnboarding =
    !input.linked || (!input.payoutsEnabled && (!input.detailsSubmitted || actionable));
  return {
    linked: input.linked,
    stripeAccountId: input.stripeAccountId,
    payoutsEnabled: !!input.payoutsEnabled,
    detailsSubmitted: !!input.detailsSubmitted,
    chargesEnabled: !!input.chargesEnabled,
    currentlyDue,
    pastDue,
    pendingVerification,
    disabledReason: input.disabledReason ?? null,
    needsOnboarding,
    onboardingComplete,
  };
}

export function humanizeConnectBlocker(status: ConnectStatus): string | null {
  if (!status.linked) return 'Connect a payout account to cash out gems.';
  const due = [...status.pastDue, ...status.currentlyDue];
  if (due.some((r) => /external_account|bank_account/i.test(r))) {
    return 'Stripe still needs a bank account before payouts can start.';
  }
  if (due.some((r) => /identity|verification|document|id_number/i.test(r))) {
    return 'Stripe still needs identity verification before payouts can start.';
  }
  if (due.length > 0) {
    return 'Stripe still needs a few payout details before you can withdraw.';
  }
  if (status.detailsSubmitted && !status.payoutsEnabled) {
    if (
      status.pendingVerification.length > 0 ||
      status.disabledReason === 'requirements.pending_verification'
    ) {
      return 'Stripe is verifying your payout account. You can withdraw once verification finishes.';
    }
    return 'Your payout account is linked, but Stripe has not enabled payouts yet.';
  }
  return null;
}
