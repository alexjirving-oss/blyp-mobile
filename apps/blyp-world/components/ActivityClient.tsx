"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getActivity,
  setActivitySeen,
  type ActivityItem,
} from "@/lib/activity";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { useAuth } from "./AuthProvider";
import "./hub-neon.css";

function formatWhen(ts: number) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(ts).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function activityVerb(item: ActivityItem) {
  if (item.type === "follow") return "started following you";
  if (item.type === "like") {
    return item.text || `liked your ${item.postKind === "video" ? "video" : "post"}`;
  }
  if (item.type === "comment") {
    const t = String(item.text || "").trim();
    if (t && !t.startsWith("commented")) return `commented: ${t}`;
    return t || "commented on your post";
  }
  return item.text || "interacted with you";
}

export function ActivityClient() {
  const { session, loading, requireAuth } = useAuth();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!session?.sub) {
      requireAuth("Log in to see Activity");
      setItems([]);
      return;
    }

    let alive = true;
    (async () => {
      try {
        await ensureFirebaseFromCognito({
          cognitoIdToken: session.idToken,
          uid: session.sub,
        });
        const list = await getActivity(session.sub);
        if (!alive) return;
        setItems(list);
        await setActivitySeen({
          uid: session.sub,
          cognitoIdToken: session.idToken,
        });
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load activity");
          setItems([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [loading, session, requireAuth]);

  const circleActors = useMemo(() => {
    if (!items?.length) return [];
    const seen = new Set<string>();
    const out: { actorId: string; username: string; avatar?: string | null }[] =
      [];
    for (const item of items) {
      if (!item.inTopCircle || !item.actorId || seen.has(item.actorId)) continue;
      seen.add(item.actorId);
      out.push({
        actorId: item.actorId,
        username: item.username,
        avatar: item.avatar,
      });
      if (out.length >= 8) break;
    }
    return out;
  }, [items]);

  if (loading || items === null) {
    return (
      <div className="hub">
        <p className="hub-kicker">Inbox</p>
        <h1 className="hub-title">Activity</h1>
        <p className="hub-load">Loading follows, likes, and comments…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="hub">
        <p className="hub-kicker">Inbox</p>
        <h1 className="hub-title">Activity</h1>
        <p className="hub-lead">
          Follows, likes, and comments on your posts — same sources as the app.
        </p>
        <div className="hub-card">
          <div className="hub-empty">
            <div className="hub-empty-stage">
              <span>SIGNED OUT</span>
            </div>
            <h2>Log in to see activity</h2>
            <p>This feed stays empty until your account loads. No sample rows.</p>
            <Link href="/login" className="hub-go">
              Log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="hub">
      <header>
        <p className="hub-kicker">Inbox</p>
        <h1 className="hub-title">Activity</h1>
        <p className="hub-lead">
          Follows, likes, and comments. Circle people first, when they actually
          show up in this feed.
        </p>
      </header>
      {error ? <p className="hub-err">{error}</p> : null}

      {circleActors.length > 0 ? (
        <div className="hub-card" style={{ padding: "1rem 1rem 0.85rem" }}>
          <p className="hub-kicker">From your Circle</p>
          <div className="hub-circle">
            {circleActors.map((p) => (
              <Link
                key={p.actorId}
                href={`/u/${encodeURIComponent(p.username)}`}
                className="hub-circle-item"
              >
                <div className="hub-avatar hub-avatar-lg is-circle">
                  {p.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatar} alt="" />
                  ) : (
                    <span>{(p.username || "S").slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <span>{p.username}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {!items.length ? (
        <div className="hub-card">
          <div className="hub-empty">
            <div className="hub-empty-stage">
              <span>QUIET</span>
            </div>
            <h2>No activity yet</h2>
            <p>
              When someone follows you, likes a post, or comments, it lands
              here. Nothing is queued to pad this page.
            </p>
            <div className="hub-actions">
              <Link href="/upload" className="hub-go">
                Upload a video
              </Link>
              <Link href="/explore" className="hub-ghost">
                Find people
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <ul className="hub-card hub-list">
          {items.map((item) => (
            <li key={item.id}>
              <div className="hub-row">
                <Link
                  href={`/u/${encodeURIComponent(item.username)}`}
                  className={`hub-avatar hub-avatar-md${
                    item.inTopCircle ? " is-circle" : ""
                  }`}
                >
                  {item.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.avatar} alt="" />
                  ) : (
                    <span>
                      {(item.username || "S").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </Link>
                <div className="hub-row-copy is-wrap">
                  <p className="hub-row-name">
                    <Link href={`/u/${encodeURIComponent(item.username)}`}>
                      @{item.username}
                    </Link>{" "}
                    <span style={{ fontWeight: 500, color: "var(--blyp-muted)" }}>
                      {activityVerb(item)}
                    </span>
                  </p>
                  <p className="hub-row-meta">
                    {formatWhen(item.ts)}
                    {item.inTopCircle ? (
                      <>
                        {" · "}
                        <span className="hub-chip">Circle</span>
                      </>
                    ) : item.inFollowing ? (
                      " · Following"
                    ) : null}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
