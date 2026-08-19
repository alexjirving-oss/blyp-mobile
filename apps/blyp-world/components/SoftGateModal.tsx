"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import "./login-gate.css";

export function SoftGateModal() {
  const { gateReason, clearGate } = useAuth();
  const pathname = usePathname() || "/";
  if (!gateReason) return null;
  const next = pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : "/";

  return (
    <div className="lgate-scrim">
      <div role="dialog" aria-modal className="lgate-dialog lgate-card">
        <p className="lgate-kicker">Almost there</p>
        <h2 className="lgate-title">{gateReason}</h2>
        <p className="lgate-copy">
          Keep watching free. Log in with the same Blyp account as the app to
          like, gift, and buy coins.
        </p>
        <div className="lgate-actions">
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="lgate-go"
            onClick={clearGate}
          >
            Log in
          </Link>
          <button type="button" onClick={clearGate} className="lgate-ghost">
            Keep watching
          </button>
        </div>
      </div>
    </div>
  );
}
