import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtRelative } from "../lib/format";
import { Spinner, ErrorNote, Badge, EmptyState } from "./ui";
import type { AuditResponse } from "../types";

const PAGE = 50;

const ACTION_LABELS: Record<string, { label: string; kind: "ok" | "warn" | "err" | "info" | "neutral" }> = {
  user_ban: { label: "Ban", kind: "err" },
  user_unban: { label: "Unban", kind: "ok" },
  user_capabilities_set: { label: "Capabilities", kind: "info" },
  user_message_queued: { label: "Message", kind: "neutral" },
  post_remove: { label: "Post removed", kind: "err" },
  post_restore: { label: "Post restored", kind: "ok" },
};

function actionBadge(action: string) {
  const a = ACTION_LABELS[action] || { label: action, kind: "neutral" as const };
  return <Badge kind={a.kind}>{a.label}</Badge>;
}

export default function AuditFeed({ action, searchable = true }: { action?: string; searchable?: boolean }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(id);
  }, [query]);
  const [activeQuery, setActiveQuery] = useState(debounced);
  const effectiveOffset = activeQuery === debounced ? offset : 0;
  if (activeQuery !== debounced) {
    setActiveQuery(debounced);
    setOffset(0);
  }

  const res = useAsync<AuditResponse>(
    () => api.get<AuditResponse>(`/admin/audit?q=${encodeURIComponent(debounced)}${action ? `&action=${encodeURIComponent(action)}` : ""}&limit=${PAGE}&offset=${effectiveOffset}`),
    [debounced, action, effectiveOffset]
  );
  const data = res.data;
  const total = data?.total ?? 0;

  return (
    <div>
      {searchable && (
        <div className="card" style={{ marginBottom: 12, padding: 12 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by actor or target ID…" />
        </div>
      )}

      {res.loading && <Spinner label="Loading audit log…" />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {data?.degraded && <ErrorNote>{data.detail}</ErrorNote>}

      {data && !res.loading && (
        data.items.length === 0 ? (
          <EmptyState>No audit entries yet. Actions you take (bans, restrictions, moderation) will appear here.</EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Action</th><th>Target</th><th>Actor</th><th>Details</th><th>When</th></tr>
                </thead>
                <tbody>
                  {data.items.map((a) => (
                    <tr key={a.id} className={a.targetType === "user" ? "clickable" : ""} onClick={() => a.targetType === "user" && navigate(`/people/${encodeURIComponent(a.targetId)}`)}>
                      <td>{actionBadge(a.action)}</td>
                      <td>
                        <div style={{ fontSize: 12 }}>{a.targetType || "—"}</div>
                        <div className="dim mono" style={{ fontSize: 11 }}>{a.targetId ? a.targetId.slice(0, 22) : "—"}</div>
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>{a.actorUserId || "—"}</td>
                      <td className="muted" style={{ fontSize: 11, maxWidth: 280 }}>
                        <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {summarize(a.metadata)}
                        </span>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>{fmtRelative(a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row spread" style={{ marginTop: 14 }}>
              <button className="btn ghost tiny" disabled={effectiveOffset === 0} onClick={() => setOffset(Math.max(0, effectiveOffset - PAGE))}>← Previous</button>
              <span className="muted" style={{ fontSize: 12 }}>{total.toLocaleString()} entries</span>
              <button className="btn ghost tiny" disabled={effectiveOffset + PAGE >= total} onClick={() => setOffset(effectiveOffset + PAGE)}>Next →</button>
            </div>
          </>
        )
      )}
    </div>
  );
}

function summarize(metadata: Record<string, unknown>): string {
  if (!metadata || typeof metadata !== "object") return "";
  const reason = metadata.reason;
  if (reason) return String(reason);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(metadata)) {
    if (v == null || typeof v === "object") continue;
    parts.push(`${k}: ${String(v)}`);
  }
  return parts.join(" · ");
}
