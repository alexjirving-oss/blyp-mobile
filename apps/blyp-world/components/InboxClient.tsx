"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import {
  markThreadRead,
  otherParticipant,
  sendMessage,
  subscribeMessages,
  subscribeThreads,
  type ChatMessage,
  type ChatThread,
} from "@/lib/messaging";
import { hydrateProfiles, type SocialProfile } from "@/lib/social";
import { useAuth } from "./AuthProvider";

function formatTime(ms: number) {
  if (!ms) return "";
  const d = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  if (diff < 86_400_000) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function InboxClient() {
  const { session, loading, requireAuth, firebaseReady } = useAuth();
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, SocialProfile>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!session?.sub) {
      requireAuth("Log in to open Messages");
      setThreads([]);
      return;
    }

    let unsub: (() => void) | undefined;
    let alive = true;

    (async () => {
      try {
        const bridged = await ensureFirebaseFromCognito({
          cognitoIdToken: session.idToken,
          uid: session.sub,
        });
        if (!alive) return;
        if (!bridged) {
          setError(
            "Couldn’t connect your messaging session. Tap refresh or try again in a moment.",
          );
          setThreads([]);
          return;
        }
        unsub = subscribeThreads(
          session.sub,
          (list) => {
            setThreads(list);
            setError(null);
          },
          (err) => {
            setError(err.message);
            setThreads([]);
          },
        );
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to open inbox");
          setThreads([]);
        }
      }
    })();

    return () => {
      alive = false;
      unsub?.();
    };
  }, [loading, session, requireAuth, firebaseReady]);

  useEffect(() => {
    if (!session?.sub || !threads?.length) return;
    const ids = threads
      .map((t) => otherParticipant(t, session.sub).userId)
      .filter(Boolean);
    let alive = true;
    hydrateProfiles(ids).then((list) => {
      if (!alive) return;
      const map: Record<string, SocialProfile> = {};
      for (const p of list) map[p.userId] = p;
      setProfiles(map);
    });
    return () => {
      alive = false;
    };
  }, [threads, session?.sub]);

  // Stage Message CTA: /inbox?with=<uid> opens existing thread if present.
  useEffect(() => {
    if (!session?.sub || !threads?.length || activeId) return;
    try {
      const withUid = new URLSearchParams(window.location.search).get("with");
      if (!withUid) return;
      const match = threads.find((t) =>
        t.participantIds.includes(withUid),
      );
      if (match) setActiveId(match.id);
    } catch {
      /* ignore */
    }
  }, [threads, session?.sub, activeId]);

  useEffect(() => {
    if (!activeId || !session?.sub) {
      setMessages([]);
      return;
    }
    const unsub = subscribeMessages(
      activeId,
      (msgs) => setMessages(msgs),
      (err) => setError(err.message),
    );
    void markThreadRead(activeId, session.sub).catch(() => {});
    return () => unsub();
  }, [activeId, session?.sub]);

  const activeThread = useMemo(
    () => threads?.find((t) => t.id === activeId) || null,
    [threads, activeId],
  );

  const peer = useMemo(() => {
    if (!activeThread || !session?.sub) return null;
    const other = otherParticipant(activeThread, session.sub);
    return profiles[other.userId] || {
      userId: other.userId,
      username: other.name,
      displayName: other.name,
      photoURL: null,
      isLive: false,
      liveStreamId: null,
    };
  }, [activeThread, session?.sub, profiles]);

  const onSend = useCallback(async () => {
    if (!session?.sub || !activeId || !draft.trim()) return;
    setSending(true);
    try {
      const bridged = await ensureFirebaseFromCognito({
        cognitoIdToken: session.idToken,
        uid: session.sub,
      });
      if (!bridged) throw new Error("Session not ready — try again");
      await sendMessage(
        activeId,
        session.sub,
        session.username || "me",
        draft,
      );
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }, [session, activeId, draft]);

  if (loading || threads === null) {
    return (
      <div className="px-6 py-16 text-sm text-[var(--blyp-muted)]">
        Loading Messages…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-bold">Messages</h1>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          Log in with your Blyp account to read and send DMs.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-flex rounded-full bg-[var(--blyp-teal)] px-6 py-3 text-sm font-bold text-[var(--blyp-ink)]"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-4xl flex-col md:h-[calc(100dvh-4rem)] md:flex-row">
      <aside
        className={`w-full border-[var(--blyp-line)] md:w-[320px] md:border-r ${
          activeId ? "hidden md:flex md:flex-col" : "flex flex-col"
        }`}
      >
        <div className="border-b border-[var(--blyp-line)] px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--blyp-teal)]">
            Inbox
          </p>
          <h1 className="font-display mt-1 text-2xl font-bold">Messages</h1>
        </div>
        {error ? (
          <p className="px-4 py-3 text-sm text-red-300">{error}</p>
        ) : null}
        {!threads.length ? (
          <div className="px-4 py-10 text-sm text-[var(--blyp-muted)]">
            No conversations yet. Start a chat from someone’s Stage in the app,
            then it appears here.
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto">
            {threads.map((thread) => {
              const other = otherParticipant(thread, session.sub);
              const profile = profiles[other.userId];
              const title =
                profile?.displayName ||
                profile?.username ||
                other.name ||
                "Chat";
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(thread.id)}
                    className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.03] ${
                      activeId === thread.id ? "bg-white/[0.05]" : ""
                    }`}
                  >
                    <div className="flex h-11 w-11 shrink-0 overflow-hidden rounded-full bg-[var(--blyp-teal)] text-sm font-bold text-[var(--blyp-ink)]">
                      {profile?.photoURL ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={profile.photoURL}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          {(title || "B").slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate font-semibold">{title}</p>
                        <span className="shrink-0 text-[11px] text-[var(--blyp-muted)]">
                          {formatTime(thread.lastMessageTimeMs)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-[var(--blyp-muted)]">
                        {thread.lastMessage || "—"}
                      </p>
                    </div>
                    {thread.unreadCount > 0 ? (
                      <span className="mt-1 rounded-full bg-[var(--blyp-teal)] px-1.5 text-[10px] font-bold text-[var(--blyp-ink)]">
                        {thread.unreadCount}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section
        className={`min-w-0 flex-1 flex-col ${
          activeId ? "flex" : "hidden md:flex"
        }`}
      >
        {!activeThread || !peer ? (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-[var(--blyp-muted)]">
            Select a conversation
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-[var(--blyp-line)] px-4 py-3">
              <button
                type="button"
                className="text-sm text-[var(--blyp-muted)] md:hidden"
                onClick={() => setActiveId(null)}
              >
                ← Back
              </button>
              {peer.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={peer.photoURL}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--blyp-teal)] text-xs font-bold text-[var(--blyp-ink)]">
                  {(peer.displayName || "B").slice(0, 1).toUpperCase()}
                </div>
              )}
              <Link
                href={`/u/${encodeURIComponent(peer.username)}`}
                className="min-w-0 font-semibold"
              >
                {peer.displayName}
                <span className="ml-2 text-sm font-normal text-[var(--blyp-muted)]">
                  @{peer.username}
                </span>
              </Link>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {messages.map((m) => {
                const mine = m.senderId === session.sub;
                return (
                  <div
                    key={m.id}
                    className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                        mine
                          ? "bg-[var(--blyp-teal)] text-[var(--blyp-ink)]"
                          : "bg-white/10 text-[var(--blyp-fog)]"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.text}</p>
                      <p
                        className={`mt-1 text-[10px] ${
                          mine ? "text-black/50" : "text-[var(--blyp-muted)]"
                        }`}
                      >
                        {formatTime(m.timestampMs)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <form
              className="flex gap-2 border-t border-[var(--blyp-line)] p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void onSend();
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message…"
                className="min-w-0 flex-1 rounded-full border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] px-4 py-2.5 text-sm outline-none focus:border-[var(--blyp-teal)]"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="rounded-full bg-[var(--blyp-teal)] px-5 py-2.5 text-sm font-bold text-[var(--blyp-ink)] disabled:opacity-40"
              >
                Send
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
