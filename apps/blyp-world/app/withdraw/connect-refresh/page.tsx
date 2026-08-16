"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function WithdrawConnectRefreshPage() {
  useEffect(() => {
    const web = "/wallet?withdraw=connect-refresh";
    const deep = "blyp://withdraw/connect-refresh";
    try {
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
        <h1 className="font-display text-2xl font-bold">Continue payout setup</h1>
        <p className="mt-3 text-[var(--blyp-muted)]">
          Stripe needs you to finish bank onboarding. Open your wallet to try again.
        </p>
        <Link
          className="mt-6 inline-block rounded-full bg-[var(--blyp-teal)] px-5 py-3 font-semibold text-[var(--blyp-ink)]"
          href="/wallet?withdraw=connect-refresh"
        >
          Open wallet
        </Link>
        <p className="mt-4 text-sm text-[var(--blyp-muted)]">
          Or{" "}
          <a className="text-[var(--blyp-teal)]" href="blyp://withdraw/connect-refresh">
            open the Blyp app
          </a>
          .
        </p>
      </div>
    </div>
  );
}
