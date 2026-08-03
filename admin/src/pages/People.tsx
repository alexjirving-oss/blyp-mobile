import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtRelative } from "../lib/format";
import AdminUserAvatar from "../components/AdminUserAvatar";
import { PageHeader, Spinner, ErrorNote, Badge, EmptyState } from "../components/ui";
import type { AdminUsersResponse, AdminUserRow } from "../types";

const PAGE = 25;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function Avatar({ user }: { user: AdminUserRow }) {
  return (
    <AdminUserAvatar
      photoURL={user.photoURL}
      displayName={user.displayName}
      username={user.username}
      userId={user.userId}
      size={30}
      borderRadius={9}
    />
  );
}

function statusBadge(user: AdminUserRow) {
  if (user.isBanned) return <Badge kind="err">Banned</Badge>;
  if (user.enabled === false) return <Badge kind="warn">Disabled</Badge>;
  if (user.userStatus && user.userStatus !== "CONFIRMED") return <Badge kind="warn">{user.userStatus}</Badge>;
  return <Badge kind="ok">Active</Badge>;
}

export default function People() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const q = useDebounced(query, 350);
  const [activeQuery, setActiveQuery] = useState(q);
  const effectiveOffset = activeQuery === q ? offset : 0;
  if (activeQuery !== q) {
    setActiveQuery(q);
    setOffset(0);
  }

  const res = useAsync<AdminUsersResponse>(
    () => api.get<AdminUsersResponse>(`/admin/users?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${effectiveOffset}`),
    [q, effectiveOffset]
  );

  const data = res.data;
  const total = data?.total ?? 0;
  const pageInfo = useMemo(() => {
    if (!data || total === 0) return "No users";
    const from = effectiveOffset + 1;
    const to = Math.min(effectiveOffset + PAGE, total);
    return `${from}–${to} of ${total.toLocaleString()}`;
  }, [data, effectiveOffset, total]);

  return (
    <div>
      <PageHeader
        title="People"
        subtitle="Every user on Blyp — search, inspect, and act"
        actions={
          <div className="row" style={{ gap: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>{pageInfo}</span>
            <button className="btn ghost tiny" onClick={() => res.reload()}>Refresh</button>
          </div>
        }
      />

      <div className="card" style={{ marginBottom: 14, padding: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, username, email, phone, or user ID…"
        />
      </div>

      {res.loading && <Spinner label="Loading users…" />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {data?.degraded && <ErrorNote>Degraded: {data.detail}</ErrorNote>}

      {data && !res.loading && (
        <>
          {data.items.length === 0 ? (
            <EmptyState>No users match “{q}”.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Role</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((u) => (
                    <tr key={u.userId} className="clickable" onClick={() => navigate(`/people/${encodeURIComponent(u.userId)}`)}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <Avatar user={u} />
                          <div>
                            <div style={{ fontWeight: 600 }}>{u.displayName || u.username || "—"}</div>
                            <div className="dim mono" style={{ fontSize: 11 }}>{u.username ? `@${u.username}` : u.userId.slice(0, 18)}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: 12 }}>{u.email || <span className="dim">no email</span>}</div>
                        <div className="dim" style={{ fontSize: 11 }}>{u.phoneNumber || ""}</div>
                      </td>
                      <td>{statusBadge(u)}</td>
                      <td>{u.role && u.role !== "user" ? <Badge kind="info">{u.role}</Badge> : <span className="dim">user</span>}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{fmtRelative(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row spread" style={{ marginTop: 14 }}>
            <button className="btn ghost tiny" disabled={effectiveOffset === 0} onClick={() => setOffset(Math.max(0, effectiveOffset - PAGE))}>← Previous</button>
            <span className="muted" style={{ fontSize: 12 }}>{pageInfo}</span>
            <button className="btn ghost tiny" disabled={effectiveOffset + PAGE >= total} onClick={() => setOffset(effectiveOffset + PAGE)}>Next →</button>
          </div>
        </>
      )}
    </div>
  );
}
