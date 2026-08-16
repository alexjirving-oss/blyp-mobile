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
      <div className="px-6 py-16 text-sm text-[var(--blyp-muted)]">
        Loading Activity…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-bold">Activity</h1>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          Log in to see follows, likes, and comments on your posts.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex rounded-full bg-[var(--blyp-teal)] px-5 py-2.5 text-sm font-bold text-[var(--blyp-ink)]"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 md:px-6">
      <h1 className="font-display text-3xl font-bold">Activity</h1>
      <p className="mt-1 text-sm text-[var(--blyp-muted)]">
        Follows, likes, and comments — Circle people first, same sources as the
        app.
      </p>
      {error ? (
        <p className="mt-4 text-sm text-red-400">{error}</p>
      ) : null}

      {circleActors.length > 0 ? (
        <div className="mt-6">
          <p className="mb-3 text-xs font-bold tracking-wide text-[var(--blyp-teal)]">
            From your Circle
          </p>
          <div className="flex gap-3.5 overflow-x-auto pb-1">
            {circleActors.map((p) => (
              <Link
                key={p.actorId}
                href={`/u/${encodeURIComponent(p.username)}`}
                className="flex w-[72px] shrink-0 flex-col items-center"
              >
                {p.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.avatar}
                    alt=""
                    className="h-14 w-14 rounded-full border-2 border-[var(--blyp-teal)] object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[var(--blyp-line)] bg-[var(--blyp-teal)] text-sm font-bold text-[var(--blyp-ink)]">
                    {(p.username || "S").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="mt-1.5 w-full truncate text-center text-[11px] font-semibold">
                  {p.username}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {!items.length ? (
        <p className="mt-10 text-sm text-[var(--blyp-muted)]">
          No recent activity yet.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--blyp-line)]">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-3.5">
              <Link
                href={`/u/${encodeURIComponent(item.username)}`}
                className="shrink-0"
              >
                {item.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.avatar}
                    alt=""
                    className={`h-10 w-10 rounded-full object-cover border-2 ${
                      item.inTopCircle
                        ? "border-[var(--blyp-teal)]"
                        : "border-[var(--blyp-line)]"
                    }`}
                  />
                ) : (
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full border-2 bg-[var(--blyp-teal)] text-sm font-bold text-[var(--blyp-ink)] ${
                      item.inTopCircle
                        ? "border-[var(--blyp-teal)]"
                        : "border-[var(--blyp-line)]"
                    }`}
                  >
                    {(item.username || "S").slice(0, 1).toUpperCase()}
                  </div>
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <Link
                    href={`/u/${encodeURIComponent(item.username)}`}
                    className="font-semibold hover:underline"
                  >
                    @{item.username}
                  </Link>{" "}
                  <span className="text-[var(--blyp-muted)]">
                    {activityVerb(item)}
                  </span>
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-[var(--blyp-muted)]">
                  <span>{formatWhen(item.ts)}</span>
                  {item.inTopCircle ? (
                    <span className="font-bold text-[var(--blyp-teal)]">
                      Circle
                    </span>
                  ) : item.inFollowing ? (
                    <span>Following</span>
                  ) : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
