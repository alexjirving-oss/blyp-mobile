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

  useEffect(() => {
    if (!session?.idToken) {
      setCoins(null);
      setGems(null);
      return;
    }
    let alive = true;
    const load = () => {
      fetchWallet(session.idToken)
        .then((w) => {
          if (!alive) return;
          setCoins(w.coins);
          setGems(w.gems);
        })
        .catch(() => {
          /* keep last */
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

  const coinLabel = coins == null ? "…" : coins.toLocaleString();
  const gemLabel = gems == null ? "…" : gems.toLocaleString();

  return (
    <Link
      href="/wallet"
      className={className}
      aria-label={`Wallet: ${coinLabel} coins, ${gemLabel} gems`}
      title={`${coinLabel} coins · ${gemLabel} gems`}
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
