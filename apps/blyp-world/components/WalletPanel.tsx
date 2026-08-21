"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  WEB_COIN_PACKS,
  convertGemsToCoins,
  createCheckoutSession,
  fetchWallet,
  fetchWithdrawEligibility,
  requestWithdrawGems,
  saveWithdrawPaypalEmail,
  startWithdrawConnectOnboard,
  type WithdrawEligibility,
  type WithdrawPayoutMethod,
} from "@/lib/economy";
import {
  coinsFromGemsConvert,
  describeGemToCoinRate,
} from "@/lib/gemToCoinConvert";
import { useAuth } from "./AuthProvider";
import "./wallet-panel.css";

export function WalletPanel() {
  const { session, requireAuth } = useAuth();
  const [coins, setCoins] = useState<number | null>(null);
  const [gems, setGems] = useState<number | null>(null);
  const [gemAvailable, setGemAvailable] = useState<number | null>(null);
  const [gemPending, setGemPending] = useState<number | null>(null);
  const [gemConvertible, setGemConvertible] = useState<number | null>(null);
  const [eligibility, setEligibility] = useState<WithdrawEligibility | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [convertBusy, setConvertBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [withdrawMethod, setWithdrawMethod] =
    useState<WithdrawPayoutMethod>("paypal");
  const [amountGems, setAmountGems] = useState("");
  const [convertAmountGems, setConvertAmountGems] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [paypalBuyHint, setPaypalBuyHint] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session?.idToken) {
      setCoins(null);
      setGems(null);
      setGemAvailable(null);
      setGemPending(null);
      setGemConvertible(null);
      setEligibility(null);
      return;
    }
    try {
      const w = await fetchWallet(session.idToken);
      setCoins(w.coins);
      setGems(w.gems);
      setGemAvailable(w.gemAvailable);
      setGemPending(w.gemPending);
      setGemConvertible(w.gemConvertible);
      setConvertAmountGems((prev) => prev || String(w.gemConvertible || ""));
      setError(null);
    } catch (e) {
      // Keep last good balances if we had them (same as HeaderWalletChip).
      setError(
        e instanceof Error ? e.message : "Could not load wallet balances",
      );
    }
    try {
      const elig = await fetchWithdrawEligibility(session.idToken);
      setEligibility(elig);
      if (elig.paypal?.email) setPaypalEmail(elig.paypal.email);
      setAmountGems((prev) => prev || String(elig.minPayoutGems || 1000));
    } catch {
      // Keep last good eligibility on transient fail.
    }
  }, [session]);

  useEffect(() => {
    let alive = true;
    if (!session?.idToken) {
      setCoins(null);
      setGems(null);
      setGemConvertible(null);
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
        setGemConvertible(w.gemConvertible);
        setConvertAmountGems((prev) => prev || String(w.gemConvertible || ""));
        setError(null);
      } catch (e) {
        if (alive) {
          // Keep last good balances if we had them (same as HeaderWalletChip).
          setError(
            e instanceof Error ? e.message : "Could not load wallet balances",
          );
        }
      }
      try {
        const elig = await fetchWithdrawEligibility(session.idToken);
        if (!alive) return;
        setEligibility(elig);
        if (elig.paypal?.email) setPaypalEmail(elig.paypal.email);
        setAmountGems((prev) => prev || String(elig.minPayoutGems || 1000));
      } catch {
        // Keep last good eligibility on transient fail.
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

  const convert = async () => {
    if (requireAuth("Log in to convert gems")) return;
    if (!session) return;
    const amount = Math.floor(Number(convertAmountGems));
    const convertible = Math.max(0, Math.floor(Number(gemConvertible ?? gems) || 0));
    if (!Number.isFinite(amount) || amount < 1) {
      setError("Enter a valid gem amount to convert");
      return;
    }
    if (amount > convertible) {
      setError("You do not have that many gems to convert.");
      return;
    }
    setConvertBusy(true);
    setError(null);
    setNote(null);
    try {
      const out = await convertGemsToCoins({
        idToken: session.idToken,
        amountGems: amount,
      });
      const debited = Number(out.gemsDebited || 0);
      const credited = Number(out.coinsCredited || 0);
      if (out.kind === "replay" && debited === 0) {
        setNote(
          "That convert request was already applied. Gem balance refreshed.",
        );
      } else {
        setNote(
          `Converted ${(debited || amount).toLocaleString()} gems → ${(credited || coinsFromGemsConvert(amount)).toLocaleString()} coins. ${describeGemToCoinRate()}.`,
        );
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Convert failed");
    } finally {
      setConvertBusy(false);
    }
  };

  const minPayout = eligibility?.minPayoutGems ?? 1000;
  const feePct = eligibility?.platformFeePercent ?? 30;
  const paypalConfigured = eligibility?.paypal?.configured ?? false;
  const paypalReady = Boolean(eligibility?.paypal?.email);
  const bankReady = Boolean(eligibility?.connect?.payoutsEnabled);
  const convertPreview = coinsFromGemsConvert(
    Math.floor(Number(convertAmountGems) || 0),
  );

  return (
    <div className="wal">
      <header>
        <p className="wal-kicker">Economy</p>
        <h1 className="wal-title">Coins & Gems</h1>
        <p className="wal-lead">
          Same shared wallet as the Blyp app. Buy coins with card or PayPal;
          convert gems to coins instantly, or cash out cleared gem earnings.
        </p>
      </header>

      <div className="wal-stack">
        <div className="wal-balances">
          <div className="wal-stat wal-stat-coin">
            <p className="wal-stat-label">Coins</p>
            <p className="wal-stat-value">
              {session
                ? coins == null
                  ? error
                    ? "—"
                    : "…"
                  : coins.toLocaleString()
                : "—"}
              <span className="wal-stat-unit">coins</span>
            </p>
            <p className="wal-stat-hint">Spendable (purchased + bonus)</p>
          </div>
          <div className="wal-stat wal-stat-gem">
            <p className="wal-stat-label">Gems</p>
            <p className="wal-stat-value">
              {session
                ? gems == null
                  ? error
                    ? "—"
                    : "…"
                  : gems.toLocaleString()
                : "—"}
              <span className="wal-stat-unit">gems</span>
            </p>
            <p className="wal-stat-hint">
              {session && gemAvailable != null
                ? `${gemAvailable.toLocaleString()} available${
                    gemPending ? ` · ${gemPending.toLocaleString()} pending` : ""
                  } · ${(gemConvertible ?? gems ?? 0).toLocaleString()} convertible`
                : "Creator earnings from gifts"}
            </p>
          </div>
        </div>
        {!session ? (
          <p className="wal-copy">
            <Link href="/login" className="wal-link">
              Log in
            </Link>{" "}
            to see your ledger balance from live-service.
          </p>
        ) : null}

        <section className="wal-card">
          <h2 className="wal-h2">Convert gems → coins</h2>
          <p className="wal-copy">
            {describeGemToCoinRate()}. Converts immediately from your full gem
            wallet (cleared + pending). Coins are never cashable. Withdraw still
            waits ~7 days on cleared gems only.
          </p>

          {!session ? (
            <p className="wal-copy">
              <Link href="/login" className="wal-link">
                Log in
              </Link>{" "}
              to convert.
            </p>
          ) : (
            <div className="wal-body">
              <label className="wal-field">
                Amount (convertible{" "}
                {(gemConvertible ?? gems ?? 0).toLocaleString()} gems)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={convertAmountGems}
                  onChange={(e) => setConvertAmountGems(e.target.value)}
                  className="wal-input wal-input-sm"
                />
              </label>
              <p className="wal-copy">
                You receive ≈ {convertPreview.toLocaleString()} coins
              </p>
              <div className="wal-actions">
                <button
                  type="button"
                  disabled={convertBusy || (gemConvertible ?? 0) < 1}
                  onClick={() => void convert()}
                  className="wal-btn wal-btn-teal"
                >
                  {convertBusy ? "Converting…" : "Convert to coins"}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="wal-card">
          <h2 className="wal-h2">Withdraw gems</h2>
          <p className="wal-copy">
            Cash out cleared gem earnings (min {minPayout.toLocaleString()} gems).
            Platform fee {feePct}%. Purchased coins are never cashable.
          </p>

          {!session ? (
            <p className="wal-copy">
              <Link href="/login" className="wal-link">
                Log in
              </Link>{" "}
              to withdraw.
            </p>
          ) : (
            <div className="wal-body">
              <div className="wal-tabs">
                <button
                  type="button"
                  onClick={() => setWithdrawMethod("paypal")}
                  className={`wal-tab${withdrawMethod === "paypal" ? " is-on" : ""}`}
                >
                  PayPal
                </button>
                <button
                  type="button"
                  onClick={() => setWithdrawMethod("stripe_connect")}
                  className={`wal-tab${withdrawMethod === "stripe_connect" ? " is-on" : ""}`}
                >
                  Bank (Stripe)
                </button>
              </div>

              {withdrawMethod === "paypal" ? (
                <div className="wal-body">
                  <p className="wal-copy">
                    Payout to your PayPal email via PayPal Payouts.
                    {!paypalConfigured
                      ? " Backend PayPal credentials are not configured yet — UI is ready; Alex must add PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET on live-service."
                      : paypalReady
                        ? " Ready once you meet the min balance and policy checks."
                        : " Save your PayPal email below, then request a withdrawal."}
                  </p>
                  <label className="wal-field">
                    PayPal email
                    <input
                      type="email"
                      value={paypalEmail}
                      onChange={(e) => setPaypalEmail(e.target.value)}
                      className="wal-input"
                      placeholder="you@email.com"
                    />
                  </label>
                  <div className="wal-actions">
                    <button
                      type="button"
                      disabled={withdrawBusy || !paypalEmail}
                      onClick={() => void savePaypal()}
                      className="wal-btn wal-btn-ghost"
                    >
                      Save PayPal email
                    </button>
                  </div>
                </div>
              ) : (
                <div className="wal-body">
                  <p className="wal-copy">
                    Bank payout via Stripe Connect Express (UK). This is not
                    PayPal.
                    {eligibility?.connect?.blockerMessage
                      ? ` ${eligibility.connect.blockerMessage}`
                      : bankReady
                        ? " Bank account linked."
                        : " Link a bank account to continue."}
                  </p>
                  {!bankReady ? (
                    <div className="wal-actions">
                      <button
                        type="button"
                        disabled={withdrawBusy}
                        onClick={() => void connectBank()}
                        className="wal-btn wal-btn-teal"
                      >
                        {withdrawBusy ? "Opening Stripe…" : "Set up bank payouts"}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              <label className="wal-field">
                Amount (available{" "}
                {eligibility
                  ? eligibility.withdrawableGems.toLocaleString()
                  : gemAvailable?.toLocaleString() || "—"}{" "}
                gems)
                <input
                  type="number"
                  min={minPayout}
                  step={1}
                  value={amountGems}
                  onChange={(e) => setAmountGems(e.target.value)}
                  className="wal-input wal-input-sm"
                />
              </label>

              <div className="wal-actions">
                <button
                  type="button"
                  disabled={withdrawBusy}
                  onClick={() => void withdraw()}
                  className="wal-btn wal-btn-gold"
                >
                  {withdrawBusy
                    ? "Working…"
                    : withdrawMethod === "paypal"
                      ? "Withdraw to PayPal"
                      : "Withdraw to bank"}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="wal-packs-head">
          <h2 className="wal-h2">Get Coins on the web</h2>
          <p className="wal-copy">
            Best value on the web — 1 coin = 1p base, plus bonus coins on every
            pack. Pay with card or PayPal via Stripe Checkout. Credits go to
            your shared Blyp wallet.
          </p>
        </section>

        <div className="wal-packs">
          {WEB_COIN_PACKS.map((pack) => (
            <button
              key={pack.id}
              type="button"
              disabled={busyId === pack.id}
              onClick={() => buy(pack.id)}
              className="wal-pack"
            >
              <p className="wal-pack-coins">
                {pack.coins.toLocaleString()}{" "}
                <span className="wal-stat-unit">coins</span>
              </p>
              <p className="wal-pack-bonus">
                +{pack.bonusCoins.toLocaleString()} bonus coins
              </p>
              <p className="wal-pack-base">
                {pack.baseCoins.toLocaleString()} base @ 1p
              </p>
              <p className="wal-pack-price">£{pack.priceGbp.toFixed(2)}</p>
              <p className="wal-pack-cta">
                {busyId === pack.id ? "Redirecting…" : "Buy · Card or PayPal"}
              </p>
            </button>
          ))}
        </div>

        {paypalBuyHint ? (
          <p className="wal-alert wal-alert-muted">{paypalBuyHint}</p>
        ) : null}
        {error ? (
          <p className="wal-alert wal-alert-err" role="alert">
            {error}
          </p>
        ) : null}
        {note ? <p className="wal-alert wal-alert-ok">{note}</p> : null}
      </div>
    </div>
  );
}
