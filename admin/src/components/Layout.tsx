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
      { to: "/people", label: "People", icon: "👤" },
      { to: "/content", label: "Content & Media", icon: "▦" },
      { to: "/live", label: "Live", icon: "◉" },
      { to: "/teams", label: "Teams", icon: "⚑" },
      { to: "/safety", label: "Trust & Safety", icon: "🛡" },
    ],
  },
  {
    section: "Business",
    items: [
      { to: "/economy", label: "Economy & Finance", icon: "◈" },
      { to: "/growth", label: "Growth & Analytics", icon: "📈" },
      { to: "/comms", label: "Comms", icon: "✉" },
    ],
  },
  {
    section: "Platform",
    items: [
      { to: "/config", label: "Configuration", icon: "⚙" },
      { to: "/ops", label: "System & Ops", icon: "❤" },
      { to: "/access", label: "Access & Security", icon: "🔑" },
    ],
  },
];

export default function Layout() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: "var(--sidebar-w)",
          flexShrink: 0,
          background: "var(--card)",
          borderRight: "1px solid var(--border)",
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
          padding: "16px 12px",
        }}
      >
        <div className="row" style={{ gap: 10, padding: "4px 8px 18px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "5px 11px 7px",
              borderRadius: 11,
              background: "linear-gradient(135deg, #00D2BE, #00A89E)",
              color: "#0A0A0C",
              fontWeight: 800,
              fontSize: 19,
            }}
          >
            Blyp
          </span>
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
                style={({ isActive }) => ({
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 10px",
                  borderRadius: 10,
                  fontSize: 13.5,
                  fontWeight: 600,
                  marginBottom: 2,
                  textDecoration: "none",
                  color: isActive ? "var(--on-brand)" : "var(--text-2)",
                  background: isActive ? "linear-gradient(135deg, var(--brand), var(--brand-dim))" : "transparent",
                })}
              >
                <span style={{ width: 18, textAlign: "center", fontSize: 13 }}>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            height: "var(--topbar-h)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
            padding: "0 24px",
            position: "sticky",
            top: 0,
            background: "rgba(10,10,12,0.82)",
            backdropFilter: "blur(8px)",
            zIndex: 10,
          }}
        >
          <span className="muted" style={{ fontSize: 12 }}>{session?.actorUserId}</span>
          <button
            className="btn ghost tiny"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Logout
          </button>
        </header>

        <main style={{ padding: 24, flex: 1, minWidth: 0 }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
