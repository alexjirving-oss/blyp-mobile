import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ROLE_BLURB, ROLE_DISPLAY, type AdminRole } from "../auth/permissions";
import { initials } from "../lib/format";

function tierClass(role?: string | null): string {
  switch (role) {
    case "owner":
      return "tier-badge tier-owner";
    case "executive":
      return "tier-badge tier-admin";
    case "admin":
      return "tier-badge tier-admin";
    case "trust_safety_lead":
      return "tier-badge tier-lead";
    case "moderator":
      return "tier-badge tier-lead";
    case "support":
      return "tier-badge tier-support";
    case "analyst_readonly":
      return "tier-badge tier-viewer";
    default:
      return "tier-badge tier-viewer";
  }
}

export default function AccountMenu() {
  const { me, session, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const role = (me?.role || null) as AdminRole | null;
  const display =
    me?.displayName?.trim() ||
    me?.email?.trim() ||
    (session?.actorUserId ? `${session.actorUserId.slice(0, 8)}…` : "Signed in");
  const subline = me?.email?.trim() || (session?.actorUserId ? session.actorUserId : "");
  const blurb = role ? ROLE_BLURB[role] : "Console access pending…";

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className="account-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`${display} · ${me?.roleDisplay || "…"}`}
      >
        <span className="account-avatar" aria-hidden>
          {initials(me?.displayName || me?.email || undefined, session?.actorUserId)}
        </span>
        <span className="account-meta hide-sm">
          <span className="account-name">{display}</span>
          <span className={tierClass(role)}>{me?.roleDisplay || ROLE_DISPLAY[role || "analyst_readonly"] || "…"}</span>
        </span>
        <span className={`account-chip-badge show-sm ${tierClass(role)}`}>{me?.roleDisplay || "…"}</span>
      </button>

      {open && (
        <div className="account-dropdown" role="menu">
          <div className="account-dropdown-head">
            <span className="account-avatar lg" aria-hidden>
              {initials(me?.displayName || me?.email || undefined, session?.actorUserId)}
            </span>
            <div>
              <div className="account-name">{display}</div>
              {subline && <div className="dim mono" style={{ fontSize: 11, marginTop: 2 }}>{subline}</div>}
              <div style={{ marginTop: 8 }}>
                <span className={tierClass(role)}>{me?.roleDisplay || "…"}</span>
              </div>
            </div>
          </div>
          <p className="account-blurb">{blurb}</p>
          <div className="account-actions">
            <Link to="/access" role="menuitem" className="account-action" onClick={() => setOpen(false)}>
              Access &amp; Security
            </Link>
            <button
              type="button"
              role="menuitem"
              className="account-action"
              onClick={() => {
                setOpen(false);
                logout();
                navigate("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
