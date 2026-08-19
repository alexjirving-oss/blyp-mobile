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
import "./inbox-client.css";

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
    return <div className="inb-load">Loading Messages…</div>;
  }

  if (!session) {
    return (
      <div className="inb-gate">
        <h1>Messages</h1>
        <p>Log in with your Blyp account to read and send DMs.</p>
        <Link href="/login" className="inb-login">
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="inb">
      <aside className={`inb-side${activeId ? " is-hidden" : ""}`}>
        <div className="inb-side-head">
          <p className="inb-kicker">Inbox</p>
          <h1 className="inb-title">Messages</h1>
        </div>
        {error ? <p className="inb-err">{error}</p> : null}
        {!threads.length ? (
          <div className="inb-empty">
            No conversations yet. Start a chat from someone’s Stage in the app,
            then it appears here.
          </div>
        ) : (
          <ul className="inb-list">
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
                    className={`inb-thread${activeId === thread.id ? " is-on" : ""}`}
                  >
                    <div className="inb-avatar">
                      {profile?.photoURL ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={profile.photoURL} alt="" />
                      ) : (
                        <span>{(title || "B").slice(0, 1).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="inb-thread-meta">
                      <div className="inb-thread-row">
                        <p className="inb-thread-name">{title}</p>
                        <span className="inb-thread-time">
                          {formatTime(thread.lastMessageTimeMs)}
                        </span>
                      </div>
                      <p className="inb-thread-preview">
                        {thread.lastMessage || "—"}
                      </p>
                    </div>
                    {thread.unreadCount > 0 ? (
                      <span className="inb-unread">{thread.unreadCount}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className={`inb-pane${activeId ? " is-open" : ""}`}>
        {!activeThread || !peer ? (
          <div className="inb-placeholder">Select a conversation</div>
        ) : (
          <>
            <div className="inb-chat-head">
              <button
                type="button"
                className="inb-back"
                onClick={() => setActiveId(null)}
              >
                ← Back
              </button>
              {peer.photoURL ? (
                <div className="inb-avatar inb-avatar-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={peer.photoURL} alt="" />
                </div>
              ) : (
                <div className="inb-avatar inb-avatar-sm">
                  {(peer.displayName || "B").slice(0, 1).toUpperCase()}
                </div>
              )}
              <Link
                href={`/u/${encodeURIComponent(peer.username)}`}
                className="inb-peer"
              >
                {peer.displayName}
                <span>@{peer.username}</span>
              </Link>
            </div>
            <div className="inb-messages">
              {messages.map((m) => {
                const mine = m.senderId === session.sub;
                return (
                  <div
                    key={m.id}
                    className={`inb-row ${mine ? "is-mine" : "is-theirs"}`}
                  >
                    <div
                      className={`inb-bubble ${mine ? "inb-bubble-mine" : "inb-bubble-theirs"}`}
                    >
                      <p>{m.text}</p>
                      <p className="inb-stamp">{formatTime(m.timestampMs)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <form
              className="inb-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void onSend();
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message…"
                className="inb-input"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="inb-send"
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
