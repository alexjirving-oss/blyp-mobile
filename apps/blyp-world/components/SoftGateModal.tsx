"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";

export function SoftGateModal() {
  const { gateReason, clearGate } = useAuth();
  if (!gateReason) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal
        className="w-full max-w-md rounded-2xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-6 shadow-2xl"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--blyp-teal)]">
          Almost there
        </p>
        <h2 className="font-display mt-2 text-2xl font-bold">{gateReason}</h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--blyp-muted)]">
          Keep watching free. Log in with the same Blyp account as the app to
          like, gift, and buy coins.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-full bg-[var(--blyp-teal)] px-5 py-2.5 text-sm font-semibold text-[var(--blyp-ink)]"
            onClick={clearGate}
          >
            Log in
          </Link>
          <button
            type="button"
            onClick={clearGate}
            className="rounded-full border border-[var(--blyp-line)] px-5 py-2.5 text-sm font-semibold text-[var(--blyp-fog)]"
          >
            Keep watching
          </button>
        </div>
      </div>
    </div>
  );
}
