"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWallet } from "@/lib/economy";
import { useAuth } from "./AuthProvider";

/** Compact coins + gems chip for nav (same ledger as /wallet). */
export function HeaderWalletChip({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { session } = useAuth();
  const [coins, setCoins] = useState<number | null>(null);
  const [gems, setGems] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.idToken) {
      setCoins(null);
      setGems(null);
      setLoadError(null);
      return;
    }
    let alive = true;
    const load = () => {
      fetchWallet(session.idToken)
        .then((w) => {
          if (!alive) return;
          setCoins(w.coins);
          setGems(w.gems);
          setLoadError(null);
        })
        .catch((e) => {
          if (!alive) return;
          // Keep last good balances if we had them; never swallow forever as "…"
          setLoadError(
            e instanceof Error ? e.message : "Wallet unavailable",
          );
        });
    };
    load();
    const t = window.setInterval(load, 30_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [session]);

  if (!session) {
    return (
      <Link
        href="/wallet"
        className={className}
        aria-label="Get Coins"
      >
        {compact ? "Coins" : "Get Coins"}
      </Link>
    );
  }

  const coinLabel =
    coins == null ? (loadError ? "—" : "…") : coins.toLocaleString();
  const gemLabel =
    gems == null ? (loadError ? "—" : "…") : gems.toLocaleString();
  const title = loadError
    ? `Wallet error: ${loadError}`
    : `${coinLabel} coins · ${gemLabel} gems`;

  return (
    <Link
      href="/wallet"
      className={className}
      aria-label={
        loadError
          ? `Wallet error: ${loadError}`
          : `Wallet: ${coinLabel} coins, ${gemLabel} gems`
      }
      title={title}
    >
      {compact ? (
        <span>
          {coinLabel}
          <span className="opacity-70"> · </span>
          {gemLabel}
          <span className="ml-0.5 opacity-80">gems</span>
        </span>
      ) : (
        <span>
          {coinLabel} coins
          <span className="mx-1 opacity-50">·</span>
          {gemLabel} gems
        </span>
      )}
    </Link>
  );
}
