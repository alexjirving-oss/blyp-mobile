"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  WEB_COIN_PACKS,
  createCheckoutSession,
  fetchWallet,
} from "@/lib/economy";
import { useAuth } from "./AuthProvider";

export function WalletPanel() {
  const { session, requireAuth } = useAuth();
  const [coins, setCoins] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.idToken) {
      setCoins(null);
      return;
    }
    let alive = true;
    fetchWallet(session.idToken)
      .then((w) => {
        if (alive) setCoins(w.coins);
      })
      .catch(() => {
        if (alive) setCoins(null);
      });
    return () => {
      alive = false;
    };
  }, [session]);

  const buy = async (packId: string) => {
    if (requireAuth("Log in to buy coins")) return;
    if (!session) return;
    setBusyId(packId);
    setError(null);
    setNote(null);
    try {
      const { url } = await createCheckoutSession({
        packId,
        idToken: session.idToken,
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout unavailable");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--blyp-gold)]">
          Balance
        </p>
        <p className="font-display mt-2 text-4xl font-extrabold">
          {session
            ? coins == null
              ? "…"
              : coins.toLocaleString()
            : "—"}{" "}
          <span className="text-lg font-semibold text-[var(--blyp-muted)]">
            coins
          </span>
        </p>
        {!session ? (
          <p className="mt-3 text-sm text-[var(--blyp-muted)]">
            <Link href="/login" className="text-[var(--blyp-teal)]">
              Log in
            </Link>{" "}
            to see your ledger balance from live-service.
          </p>
        ) : null}
      </div>

      <div>
        <h2 className="font-display text-2xl font-bold">Top up on the web</h2>
        <p className="mt-2 max-w-xl text-sm text-[var(--blyp-muted)]">
          Same coin grants as the app IAP catalog. Stripe Checkout keeps more
          value off store fees — credits land on the shared wallet when webhook
          + secret are configured.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {WEB_COIN_PACKS.map((pack) => (
          <button
            key={pack.id}
            type="button"
            disabled={busyId === pack.id}
            onClick={() => buy(pack.id)}
            className="rounded-2xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-5 text-left transition hover:border-[var(--blyp-teal)] disabled:opacity-60"
          >
            <p className="font-display text-xl font-bold">
              {pack.coins.toLocaleString()}
            </p>
            <p className="mt-1 text-sm text-[var(--blyp-muted)]">{pack.blurb}</p>
            <p className="mt-4 text-base font-semibold text-[var(--blyp-gold)]">
              ${pack.priceUsd.toFixed(2)}
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--blyp-teal)]">
              {busyId === pack.id ? "Redirecting…" : "Buy with Stripe"}
            </p>
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-[var(--blyp-rose)]" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="text-sm text-[var(--blyp-muted)]">{note}</p> : null}
    </div>
  );
}
