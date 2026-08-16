"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function WithdrawConnectReturnPage() {
  useEffect(() => {
    // Prefer finishing on web wallet; also offer the app deep link.
    const web = "/wallet?withdraw=connect-return";
    const deep = "blyp://withdraw/connect-return";
    try {
      // Attempt app handoff for mobile installs, then land on web wallet.
      window.location.href = deep;
      window.setTimeout(() => {
        window.location.replace(web);
      }, 700);
    } catch {
      window.location.href = web;
    }
  }, []);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5 text-center">
      <div>
        <h1 className="font-display text-2xl font-bold">Payout setup complete</h1>
        <p className="mt-3 text-[var(--blyp-muted)]">
          Return to your wallet to withdraw gems to your bank account.
        </p>
        <Link
          className="mt-6 inline-block rounded-full bg-[var(--blyp-teal)] px-5 py-3 font-semibold text-[var(--blyp-ink)]"
          href="/wallet?withdraw=connect-return"
        >
          Open wallet
        </Link>
        <p className="mt-4 text-sm text-[var(--blyp-muted)]">
          Or{" "}
          <a className="text-[var(--blyp-teal)]" href="blyp://withdraw/connect-return">
            open the Blyp app
          </a>
          .
        </p>
      </div>
    </div>
  );
}
