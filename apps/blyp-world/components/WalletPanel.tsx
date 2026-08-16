"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  WEB_COIN_PACKS,
  createCheckoutSession,
  fetchWallet,
  fetchWithdrawEligibility,
  requestWithdrawGems,
  saveWithdrawPaypalEmail,
  startWithdrawConnectOnboard,
  type WithdrawEligibility,
  type WithdrawPayoutMethod,
} from "@/lib/economy";
import { useAuth } from "./AuthProvider";

export function WalletPanel() {
  const { session, requireAuth } = useAuth();
  const [coins, setCoins] = useState<number | null>(null);
  const [gems, setGems] = useState<number | null>(null);
  const [gemAvailable, setGemAvailable] = useState<number | null>(null);
  const [gemPending, setGemPending] = useState<number | null>(null);
  const [eligibility, setEligibility] = useState<WithdrawEligibility | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [withdrawMethod, setWithdrawMethod] =
    useState<WithdrawPayoutMethod>("paypal");
  const [amountGems, setAmountGems] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [paypalBuyHint, setPaypalBuyHint] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session?.idToken) {
      setCoins(null);
      setGems(null);
      setGemAvailable(null);
      setGemPending(null);
      setEligibility(null);
      return;
    }
    try {
      const w = await fetchWallet(session.idToken);
      setCoins(w.coins);
      setGems(w.gems);
      setGemAvailable(w.gemAvailable);
      setGemPending(w.gemPending);
    } catch {
      setCoins(null);
      setGems(null);
    }
    try {
      const elig = await fetchWithdrawEligibility(session.idToken);
      setEligibility(elig);
      if (elig.paypal?.email) setPaypalEmail(elig.paypal.email);
      setAmountGems((prev) => prev || String(elig.minPayoutGems || 1000));
    } catch {
      setEligibility(null);
    }
  }, [session]);

  useEffect(() => {
    let alive = true;
    if (!session?.idToken) {
      setCoins(null);
      setGems(null);
      return;
    }
    void (async () => {
      try {
        const w = await fetchWallet(session.idToken);
        if (!alive) return;
        setCoins(w.coins);
        setGems(w.gems);
        setGemAvailable(w.gemAvailable);
        setGemPending(w.gemPending);
      } catch {
        if (alive) {
          setCoins(null);
          setGems(null);
        }
      }
      try {
        const elig = await fetchWithdrawEligibility(session.idToken);
        if (!alive) return;
        setEligibility(elig);
        if (elig.paypal?.email) setPaypalEmail(elig.paypal.email);
        setAmountGems((prev) => prev || String(elig.minPayoutGems || 1000));
      } catch {
        if (alive) setEligibility(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session]);

  useEffect(() => {
    if (!session?.idToken) return;

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    let delayed: number | undefined;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("checkout") === "success") {
        setNote("Payment received — updating your shared wallet…");
        delayed = window.setTimeout(() => void refresh(), 1200);
      }
      if (
        params.get("withdraw") === "connect-return" ||
        params.get("withdraw") === "connect-refresh"
      ) {
        setNote("Checking Stripe bank payout setup…");
        delayed = window.setTimeout(() => void refresh(), 800);
      }
    } catch {
      /* ignore */
    }

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      if (delayed != null) window.clearTimeout(delayed);
    };
  }, [session, refresh]);

  const buy = async (packId: string) => {
    if (requireAuth("Log in to buy coins")) return;
    if (!session) return;
    setBusyId(packId);
    setError(null);
    setNote(null);
    setPaypalBuyHint(null);
    try {
      const { url, paypalOffered } = await createCheckoutSession({
        packId,
        idToken: session.idToken,
      });
      if (paypalOffered === false) {
        setPaypalBuyHint(
          "PayPal is not enabled on the Stripe account yet — Checkout will offer card. Enable PayPal in Stripe Dashboard → Settings → Payment methods (GBP).",
        );
      }
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout unavailable");
    } finally {
      setBusyId(null);
    }
  };

  const connectBank = async () => {
    if (requireAuth("Log in to set up bank withdrawals")) return;
    if (!session) return;
    setWithdrawBusy(true);
    setError(null);
    setNote(null);
    try {
      const origin = window.location.origin;
      const out = await startWithdrawConnectOnboard({
        idToken: session.idToken,
        returnUrl: `${origin}/withdraw/connect-return`,
        refreshUrl: `${origin}/withdraw/connect-refresh`,
      });
      if (out.alreadyComplete) {
        setNote("Bank payout account is already linked.");
        await refresh();
        return;
      }
      if (!out.url) throw new Error("Stripe did not return an onboarding link");
      window.location.href = out.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connect onboarding failed");
    } finally {
      setWithdrawBusy(false);
    }
  };

  const savePaypal = async () => {
    if (requireAuth("Log in to save PayPal email")) return;
    if (!session) return;
    setWithdrawBusy(true);
    setError(null);
    try {
      await saveWithdrawPaypalEmail({
        idToken: session.idToken,
        paypalEmail,
      });
      setNote("PayPal email saved for gem withdrawals.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save PayPal email");
    } finally {
      setWithdrawBusy(false);
    }
  };

  const withdraw = async () => {
    if (requireAuth("Log in to withdraw gems")) return;
    if (!session) return;
    const amount = Math.floor(Number(amountGems));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid gem amount");
      return;
    }
    setWithdrawBusy(true);
    setError(null);
    setNote(null);
    try {
      if (withdrawMethod === "paypal" && paypalEmail) {
        await saveWithdrawPaypalEmail({
          idToken: session.idToken,
          paypalEmail,
        });
      }
      const out = await requestWithdrawGems({
        idToken: session.idToken,
        amountGems: amount,
        method: withdrawMethod,
        paypalEmail:
          withdrawMethod === "paypal" ? paypalEmail || undefined : undefined,
      });
      const netGbp = (Number(out.netMinor || 0) / 100).toFixed(2);
      if (out.status === "pending_review") {
        setNote(
          `Withdrawal submitted for review (${out.amountGems.toLocaleString()} gems → ~£${netGbp} after fee).`,
        );
      } else {
        setNote(
          withdrawMethod === "paypal"
            ? `PayPal payout sent for ${out.amountGems.toLocaleString()} gems (~£${netGbp} net).`
            : `Bank payout processing for ${out.amountGems.toLocaleString()} gems (~£${netGbp} net).`,
        );
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Withdrawal failed");
    } finally {
      setWithdrawBusy(false);
    }
  };

  const minPayout = eligibility?.minPayoutGems ?? 1000;
  const feePct = eligibility?.platformFeePercent ?? 30;
  const paypalConfigured = eligibility?.paypal?.configured ?? false;
  const paypalReady = Boolean(eligibility?.paypal?.email);
  const bankReady = Boolean(eligibility?.connect?.payoutsEnabled);

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="rounded-2xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--blyp-gold)]">
          Balance
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="font-display text-3xl font-extrabold sm:text-4xl">
              {session
                ? coins == null
                  ? "…"
                  : coins.toLocaleString()
                : "—"}{" "}
              <span className="text-base font-semibold text-[var(--blyp-muted)] sm:text-lg">
                coins
              </span>
            </p>
            <p className="mt-1 text-xs text-[var(--blyp-muted)]">
              Spendable (purchased + bonus)
            </p>
          </div>
          <div>
            <p className="font-display text-3xl font-extrabold sm:text-4xl">
              {session
                ? gems == null
                  ? "…"
                  : gems.toLocaleString()
                : "—"}{" "}
              <span className="text-base font-semibold text-[var(--blyp-muted)] sm:text-lg">
                gems
              </span>
            </p>
            <p className="mt-1 text-xs text-[var(--blyp-muted)]">
              {session && gemAvailable != null
                ? `${gemAvailable.toLocaleString()} available${
                    gemPending ? ` · ${gemPending.toLocaleString()} pending` : ""
                  }`
                : "Creator earnings from gifts"}
            </p>
          </div>
        </div>
        {!session ? (
          <p className="mt-3 text-sm text-[var(--blyp-muted)]">
            <Link href="/login" className="text-[var(--blyp-teal)]">
              Log in
            </Link>{" "}
            to see your ledger balance from live-service.
          </p>
        ) : (
          <p className="mt-3 text-sm text-[var(--blyp-muted)]">
            Same shared wallet as the Blyp app.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 sm:p-6">
        <h2 className="font-display text-xl font-bold sm:text-2xl">
          Withdraw gems
        </h2>
        <p className="mt-2 max-w-xl text-sm text-[var(--blyp-muted)]">
          Cash out cleared gem earnings (min {minPayout.toLocaleString()} gems).
          Platform fee {feePct}%. Purchased coins are never cashable.
        </p>

        {!session ? (
          <p className="mt-4 text-sm text-[var(--blyp-muted)]">
            <Link href="/login" className="text-[var(--blyp-teal)]">
              Log in
            </Link>{" "}
            to withdraw.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setWithdrawMethod("paypal")}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  withdrawMethod === "paypal"
                    ? "bg-[var(--blyp-teal)] text-[var(--blyp-ink)]"
                    : "border border-[var(--blyp-line)] text-[var(--blyp-muted)]"
                }`}
              >
                PayPal
              </button>
              <button
                type="button"
                onClick={() => setWithdrawMethod("stripe_connect")}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  withdrawMethod === "stripe_connect"
                    ? "bg-[var(--blyp-teal)] text-[var(--blyp-ink)]"
                    : "border border-[var(--blyp-line)] text-[var(--blyp-muted)]"
                }`}
              >
                Bank (Stripe)
              </button>
            </div>

            {withdrawMethod === "paypal" ? (
              <div className="space-y-3">
                <p className="text-sm text-[var(--blyp-muted)]">
                  Payout to your PayPal email via PayPal Payouts.
                  {!paypalConfigured
                    ? " Backend PayPal credentials are not configured yet — UI is ready; Alex must add PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET on live-service."
                    : paypalReady
                      ? " Ready once you meet the min balance and policy checks."
                      : " Save your PayPal email below, then request a withdrawal."}
                </p>
                <label className="block text-sm">
                  <span className="text-[var(--blyp-muted)]">PayPal email</span>
                  <input
                    type="email"
                    value={paypalEmail}
                    onChange={(e) => setPaypalEmail(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--blyp-line)] bg-black/30 px-3 py-2"
                    placeholder="you@email.com"
                  />
                </label>
                <button
                  type="button"
                  disabled={withdrawBusy || !paypalEmail}
                  onClick={() => void savePaypal()}
                  className="rounded-full border border-[var(--blyp-line)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  Save PayPal email
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-[var(--blyp-muted)]">
                  Bank payout via Stripe Connect Express (UK). This is not PayPal.
                  {eligibility?.connect?.blockerMessage
                    ? ` ${eligibility.connect.blockerMessage}`
                    : bankReady
                      ? " Bank account linked."
                      : " Link a bank account to continue."}
                </p>
                {!bankReady ? (
                  <button
                    type="button"
                    disabled={withdrawBusy}
                    onClick={() => void connectBank()}
                    className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {withdrawBusy ? "Opening Stripe…" : "Set up bank payouts"}
                  </button>
                ) : null}
              </div>
            )}

            <label className="block text-sm">
              <span className="text-[var(--blyp-muted)]">
                Amount (available{" "}
                {eligibility
                  ? eligibility.withdrawableGems.toLocaleString()
                  : gemAvailable?.toLocaleString() || "—"}{" "}
                gems)
              </span>
              <input
                type="number"
                min={minPayout}
                step={1}
                value={amountGems}
                onChange={(e) => setAmountGems(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--blyp-line)] bg-black/30 px-3 py-2 sm:max-w-xs"
              />
            </label>

            <button
              type="button"
              disabled={withdrawBusy}
              onClick={() => void withdraw()}
              className="rounded-full bg-[var(--blyp-gold)] px-5 py-2.5 text-sm font-bold text-[var(--blyp-ink)] disabled:opacity-50"
            >
              {withdrawBusy
                ? "Working…"
                : withdrawMethod === "paypal"
                  ? "Withdraw to PayPal"
                  : "Withdraw to bank"}
            </button>
          </div>
        )}
      </div>

      <div>
        <h2 className="font-display text-xl font-bold sm:text-2xl">
          Get Coins on the web
        </h2>
        <p className="mt-2 max-w-xl text-sm text-[var(--blyp-muted)]">
          Best value on the web — 1 coin = 1p base, plus bonus coins on every
          pack. Pay with card or PayPal via Stripe Checkout. Credits go to your
          shared Blyp wallet.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {WEB_COIN_PACKS.map((pack) => (
          <button
            key={pack.id}
            type="button"
            disabled={busyId === pack.id}
            onClick={() => buy(pack.id)}
            className="rounded-2xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 text-left transition hover:border-[var(--blyp-teal)] disabled:opacity-60 sm:p-5"
          >
            <p className="font-display text-xl font-bold">
              {pack.coins.toLocaleString()}{" "}
              <span className="text-sm font-semibold text-[var(--blyp-muted)]">
                coins
              </span>
            </p>
            <p className="mt-1 text-sm text-[var(--blyp-teal)]">
              +{pack.bonusCoins.toLocaleString()} bonus coins
            </p>
            <p className="mt-1 text-xs text-[var(--blyp-muted)]">
              {pack.baseCoins.toLocaleString()} base @ 1p
            </p>
            <p className="mt-4 text-base font-semibold text-[var(--blyp-gold)]">
              £{pack.priceGbp.toFixed(2)}
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--blyp-teal)]">
              {busyId === pack.id
                ? "Redirecting…"
                : "Buy · Card or PayPal"}
            </p>
          </button>
        ))}
      </div>

      {paypalBuyHint ? (
        <p className="text-sm text-[var(--blyp-muted)]">{paypalBuyHint}</p>
      ) : null}
      {error ? (
        <p className="text-sm text-[var(--blyp-rose)]" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="text-sm text-[var(--blyp-muted)]">{note}</p> : null}
    </div>
  );
}
