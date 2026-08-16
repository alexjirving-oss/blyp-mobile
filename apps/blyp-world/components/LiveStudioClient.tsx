"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { startIvsWebHostPublish, type IvsHostPublishHandle } from "@/lib/ivsWebHost";
import {
  endLiveHostSession,
  fetchGuestRequests,
  heartbeatLiveHostSession,
  inviteGuest,
  loadActiveHostSession,
  persistActiveHostSession,
  rejectGuest,
  startLiveHostSession,
  watchUrlForSession,
  type GuestRequestRow,
  type LiveHostSession,
} from "@/lib/liveHost";

function pendingRequests(rows: GuestRequestRow[]): GuestRequestRow[] {
  return rows.filter((r) =>
    ["PENDING", "REQUESTED", "WAITING"].includes(
      String(r.status || "").toUpperCase(),
    ),
  );
}

function invitedOrLive(rows: GuestRequestRow[]): GuestRequestRow[] {
  return rows.filter((r) =>
    ["INVITED", "LIVE", "ACCEPTED"].includes(String(r.status || "").toUpperCase()),
  );
}

export function LiveStudioClient() {
  const { session, loading, requireAuth } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const publishRef = useRef<IvsHostPublishHandle | null>(null);

  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [active, setActive] = useState<LiveHostSession | null>(null);
  const [publishState, setPublishState] = useState<
    "idle" | "publishing" | "live" | "error"
  >("idle");
  const [guestRows, setGuestRows] = useState<GuestRequestRow[]>([]);
  const [guestPollError, setGuestPollError] = useState<string | null>(null);

  const pushToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    const restored = loadActiveHostSession();
    if (restored) setActive(restored);
  }, []);

  useEffect(() => {
    if (!title && session?.username) setTitle(`${session.username} LIVE`);
  }, [session?.username, title]);

  useEffect(() => {
    persistActiveHostSession(active);
  }, [active]);

  const stopPublish = useCallback(async () => {
    const handle = publishRef.current;
    publishRef.current = null;
    if (handle) {
      try {
        await handle.leave();
      } catch {
        /* ignore */
      }
    }
    setPublishState("idle");
  }, []);

  const beginPublish = useCallback(
    async (host: LiveHostSession) => {
      setPublishState("publishing");
      setError(null);
      try {
        const handle = await startIvsWebHostPublish({
          participantToken: host.hostToken,
          videoEl: videoRef.current,
        });
        publishRef.current = handle;
        setPublishState("live");
        pushToast("Camera publishing to stage");
      } catch (e) {
        setPublishState("error");
        setError(
          e instanceof Error
            ? e.message
            : "Failed to publish camera to IVS stage",
        );
      }
    },
    [pushToast],
  );

  // Resume publish after restore / remount when we still have a host token.
  useEffect(() => {
    if (!active?.hostToken) return;
    if (publishRef.current) return;
    if (publishState === "publishing" || publishState === "live") return;
    void beginPublish(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when session id changes
  }, [active?.sessionId]);

  useEffect(() => {
    return () => {
      void stopPublish();
    };
  }, [stopPublish]);

  // Host heartbeat — keeps Firestore discovery alive while Dynamo is LIVE.
  useEffect(() => {
    if (!active?.sessionId || !session?.idToken) return;
    const tick = async () => {
      try {
        await heartbeatLiveHostSession(session.idToken, active.sessionId);
      } catch {
        /* soft-fail until /api/live/heartbeat is deployed; Dynamo session stays LIVE */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 30_000);
    return () => {
      window.clearInterval(id);
    };
  }, [active?.sessionId, session?.idToken]);

  // Guest request poll — surface errors (production silently swallowed them).
  useEffect(() => {
    if (!active?.sessionId || !session?.idToken) {
      setGuestRows([]);
      setGuestPollError(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const rows = await fetchGuestRequests(
          session.idToken,
          active.sessionId,
        );
        if (!cancelled) {
          setGuestRows(rows);
          setGuestPollError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setGuestPollError(
            e instanceof Error ? e.message : "Failed to list guest requests",
          );
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active?.sessionId, session?.idToken]);

  const pending = useMemo(() => pendingRequests(guestRows), [guestRows]);
  const onStage = useMemo(() => invitedOrLive(guestRows), [guestRows]);
  const watchUrl = active ? watchUrlForSession(active.sessionId) : "";

  const onStart = async () => {
    if (!session?.idToken) {
      requireAuth("Log in to go LIVE");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ensureFirebaseFromCognito({
        cognitoIdToken: session.idToken,
        uid: session.sub,
      });
      const host = await startLiveHostSession(
        session.idToken,
        title.trim() || `${session.username || "Host"} LIVE`,
      );
      setActive(host);
      await beginPublish(host);
      try {
        await heartbeatLiveHostSession(session.idToken, host.sessionId);
      } catch {
        /* first heartbeat best-effort until live-service deploy lands */
      }
      pushToast("Session live — publishing from this browser");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start LIVE");
    } finally {
      setBusy(false);
    }
  };

  const onEnd = async () => {
    if (!session?.idToken || !active?.sessionId) return;
    setBusy(true);
    setError(null);
    try {
      await stopPublish();
      await endLiveHostSession(session.idToken, active.sessionId);
      setActive(null);
      setGuestRows([]);
      pushToast("LIVE ended");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to end LIVE");
    } finally {
      setBusy(false);
    }
  };

  const onGuestAction = async (
    action: "accept" | "reject",
    guestUserId: string,
  ) => {
    if (!session?.idToken || !active?.sessionId) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "accept") {
        await inviteGuest(session.idToken, active.sessionId, guestUserId);
        pushToast("Guest invited — they join from the app");
      } else {
        await rejectGuest(session.idToken, active.sessionId, guestUserId);
        pushToast("Guest rejected");
      }
      const rows = await fetchGuestRequests(
        session.idToken,
        active.sessionId,
      );
      setGuestRows(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guest action failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="px-6 py-16 text-sm text-[var(--blyp-muted)]">
        Loading studio…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--blyp-teal)]">
          LIVE Studio
        </p>
        <h1 className="font-display mt-2 text-3xl font-bold">
          Host from the browser
        </h1>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          Log in to create a session, publish camera/mic over IVS Real-Time, and
          accept guest requests from phones.
        </p>
        <button
          type="button"
          onClick={() => requireAuth("Log in to open LIVE Studio")}
          className="mt-8 inline-flex rounded-full bg-[var(--blyp-teal)] px-6 py-3 text-sm font-bold text-[var(--blyp-ink)]"
        >
          Log in
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-10 md:py-14">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--blyp-teal)]">
            LIVE Studio
          </p>
          <h1 className="font-display text-4xl font-extrabold tracking-tight md:text-5xl">
            Host operator desk
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--blyp-muted)]">
            Starts a real live-service session and publishes this browser&apos;s
            camera to the IVS stage so phones can see you and request to join.
          </p>
        </div>
        {active ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onEnd()}
            className="rounded-full bg-[#fe2c55] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            End LIVE
          </button>
        ) : null}
      </div>

      {toast ? (
        <p className="mb-4 rounded-lg border border-[var(--blyp-teal)]/40 bg-[rgba(0,210,190,0.1)] px-3 py-2 text-sm text-[var(--blyp-teal)]">
          {toast}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-lg border border-[var(--blyp-rose)]/40 bg-[rgba(240,160,184,0.08)] px-3 py-2 text-sm text-[var(--blyp-rose)]">
          {error}
        </p>
      ) : null}

      {active ? (
        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
          <section className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-[var(--blyp-line)] bg-black">
              <video
                ref={videoRef}
                className="aspect-video w-full object-cover"
                muted
                playsInline
                autoPlay
              />
            </div>
            <div className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 text-sm">
              <p className="font-semibold">{active.title}</p>
              <p className="mt-1 text-[var(--blyp-muted)]">
                Publish:{" "}
                <span className="text-[var(--blyp-fog)]">{publishState}</span>
                {" · "}
                Session{" "}
                <span className="font-mono text-xs">{active.sessionId}</span>
              </p>
              <p className="mt-2 break-all font-mono text-xs text-[var(--blyp-muted)]">
                Watch: {watchUrl}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--blyp-line)] px-3 py-2 text-xs font-semibold"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(watchUrl);
                      pushToast("Watch URL copied");
                    } catch {
                      pushToast("Copy failed");
                    }
                  }}
                >
                  Copy watch URL
                </button>
                {publishState !== "live" ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg bg-[var(--blyp-teal)] px-3 py-2 text-xs font-bold text-[var(--blyp-ink)] disabled:opacity-50"
                    onClick={() => void beginPublish(active)}
                  >
                    Retry camera publish
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 md:p-5">
              <h2 className="font-display text-lg font-bold tracking-tight">
                Guest requests
              </h2>
              <p className="mt-1 text-[10px] text-[var(--blyp-muted)]">
                live-service guest APIs · polls every 5s
              </p>
              {guestPollError ? (
                <p className="mt-3 rounded-lg border border-[var(--blyp-rose)]/30 px-3 py-2 text-xs text-[var(--blyp-rose)]">
                  Poll error: {guestPollError}
                </p>
              ) : null}
              {pending.length === 0 && onStage.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--blyp-muted)]">
                  No guest requests yet. Guests tap Join on the phone watch flow.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {pending.map((g) => (
                    <li
                      key={`p-${g.userId}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-[var(--blyp-gold)]/30 bg-[rgba(232,196,124,0.08)] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">
                          {g.userId}
                        </p>
                        <p className="text-[10px] text-[var(--blyp-gold)]">
                          PENDING
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onGuestAction("accept", g.userId)}
                          className="rounded-md bg-[var(--blyp-teal)] px-2 py-1 text-[10px] font-bold text-[var(--blyp-ink)]"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onGuestAction("reject", g.userId)}
                          className="rounded-md border border-[var(--blyp-line)] px-2 py-1 text-[10px] font-semibold"
                        >
                          Reject
                        </button>
                      </div>
                    </li>
                  ))}
                  {onStage.map((g) => (
                    <li
                      key={`s-${g.userId}`}
                      className="rounded-lg border border-[var(--blyp-line)] px-3 py-2 text-xs"
                    >
                      <span className="font-semibold">{g.userId}</span>
                      <span className="ml-2 text-[var(--blyp-muted)]">
                        {g.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[10px] leading-snug text-[var(--blyp-muted)]">
                Guests still publish from the Blyp app after Accept. Host video
                now publishes from this browser.
              </p>
            </section>
            <Link
              href="/live/"
              className="inline-flex text-xs font-semibold text-[var(--blyp-teal)]"
            >
              ← LIVE directory
            </Link>
          </aside>
        </div>
      ) : (
        <section className="max-w-xl space-y-4 rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-5">
          <h2 className="font-display text-lg font-bold tracking-tight">
            Start a session
          </h2>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--blyp-muted)]">
              Title
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${session.username || "Host"} LIVE`}
              maxLength={80}
              className="mt-2 w-full rounded-xl border border-[var(--blyp-line)] bg-black/30 px-4 py-3 text-sm outline-none ring-[var(--blyp-teal)] focus:ring-2"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onStart()}
            className="w-full rounded-full bg-[#fe2c55] px-5 py-3.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "Starting…" : "Go LIVE (camera + mic)"}
          </button>
          <p className="text-xs leading-relaxed text-[var(--blyp-muted)]">
            Uses Chrome/Edge camera permissions and IVS Real-Time Web Broadcast.
            Allow camera/mic when prompted.
          </p>
        </section>
      )}
    </div>
  );
}
