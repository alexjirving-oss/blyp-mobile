import { useState, type FormEvent } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

interface NavItem { to: string; label: string; icon: string; }

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [{ to: "/", label: "Command Center", icon: "◎" }],
  },
  {
    section: "Product",
    items: [{ to: "/workbook", label: "Product Workbook", icon: "▤" }],
  },
  {
    section: "Operate",
    items: [
      { to: "/people", label: "People", icon: "◇" },
      { to: "/agents", label: "Agent oversight", icon: "✦" },
      { to: "/content", label: "Content & Media", icon: "▦" },
      { to: "/import-schedule", label: "Import schedule", icon: "◷" },
      { to: "/live", label: "Live", icon: "◉" },
      { to: "/teams", label: "Teams", icon: "⚑" },
      { to: "/safety", label: "Trust & Safety", icon: "⬡" },
    ],
  },
  {
    section: "Business",
    items: [
      { to: "/economy", label: "Economy & Finance", icon: "◈" },
      { to: "/growth", label: "Growth & Analytics", icon: "△" },
      { to: "/comms", label: "Comms", icon: "✉" },
    ],
  },
  {
    section: "Platform",
    items: [
      { to: "/config", label: "Configuration", icon: "⚙" },
      { to: "/ops", label: "System & Ops", icon: "❤" },
      { to: "/access", label: "Access & Security", icon: "▣" },
    ],
  },
];

function shortActor(id?: string | null) {
  if (!id) return "—";
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export default function Layout() {
  const { session, logout, me } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const raw = q.trim();
    if (!raw) return;
    const lower = raw.toLowerCase();
    if (lower.startsWith("report:") || lower.startsWith("r:")) {
      navigate(`/safety?q=${encodeURIComponent(raw.replace(/^(report:|r:)/i, "").trim())}`);
    } else if (lower.includes("child") || lower === "csam" || lower === "child_safety") {
      navigate("/safety?lane=child_safety");
    } else if (/^[0-9a-f-]{20,}$/i.test(raw) || raw.includes("@") || raw.length >= 2) {
      navigate(`/people?q=${encodeURIComponent(raw)}`);
    } else {
      navigate(`/people?q=${encodeURIComponent(raw)}`);
    }
    setNavOpen(false);
  }

  return (
    <div className="admin-shell">
      <div className="env-banner" role="status">
        <strong>PROD</strong>
        <span>admin.blyp.world · Cognito allowlist + RBAC · mutations audited</span>
      </div>

      {navOpen && <button type="button" className="nav-scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />}

      <aside className={`admin-sidebar${navOpen ? " open" : ""}`}>
        <div className="row" style={{ gap: 10, padding: "4px 8px 18px" }}>
          <span className="brand-mark">Blyp</span>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em" }}>ADMIN</span>
        </div>

        {NAV.map((group) => (
          <div key={group.section} style={{ marginBottom: 14 }}>
            <div className="dim" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", padding: "0 8px 6px" }}>
              {group.section}
            </div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                onClick={() => setNavOpen(false)}
                className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              >
                <span style={{ width: 18, textAlign: "center", fontSize: 13 }}>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}

        <div className="sidebar-foot">
          <div className="dim" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>Session</div>
          <div className="mono" style={{ fontSize: 11, marginTop: 4 }} title={session?.actorUserId}>
            {shortActor(session?.actorUserId)}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {me?.roleDisplay || "Role…"} · allowlist + RBAC
          </div>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button type="button" className="btn ghost tiny nav-toggle" onClick={() => setNavOpen((v) => !v)}>
            Menu
          </button>
          <form className="omnibox" onSubmit={onSearch}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search users, email, sub… or child_safety"
              aria-label="Global search"
            />
            <button type="submit" className="btn tiny">Go</button>
          </form>
          <div className="row" style={{ gap: 10, marginLeft: "auto" }}>
            <span className="muted hide-sm" style={{ fontSize: 12 }} title={session?.actorUserId}>
              {shortActor(session?.actorUserId)}
            </span>
            <button
              className="btn ghost tiny"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              Logout
            </button>
          </div>
        </header>

        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
