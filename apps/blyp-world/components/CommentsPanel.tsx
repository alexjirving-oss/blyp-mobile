"use client";

import { useEffect, useRef, useState } from "react";
import {
  addPostComment,
  formatCommentTime,
  subscribePostComments,
  type PostComment,
} from "@/lib/comments";
import { useAuth } from "./AuthProvider";

type Props = {
  postId: string;
  open: boolean;
  onClose: () => void;
  onCountChange?: (count: number) => void;
};

export function CommentsPanel({ postId, open, onClose, onCountChange }: Props) {
  const { session, me, requireAuth } = useAuth();
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !postId) return;
    setLoading(true);
    setError(null);
    const unsub = subscribePostComments(
      postId,
      (next) => {
        setComments(next);
        setLoading(false);
        onCountChange?.(next.length);
      },
      (msg) => {
        setError(msg);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [open, postId, onCountChange]);

  if (!open) return null;

  const onSend = async () => {
    if (requireAuth("Log in to comment")) return;
    if (!session?.idToken || !session.sub) return;
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const username =
        me?.username ||
        (me?.displayName && !me.displayName.includes("@")
          ? me.displayName
          : null) ||
        (session.username && !session.username.includes("@")
          ? session.username
          : null) ||
        "User";
      await addPostComment({
        postId,
        userId: session.sub,
        cognitoIdToken: session.idToken,
        username,
        avatar: me?.photoURL,
        text: body,
      });
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send comment");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end bg-black/55 md:items-center md:justify-end">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close comments"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Comments"
        className="relative z-10 flex max-h-[70dvh] w-full flex-col rounded-t-2xl border border-white/10 bg-[rgba(12,12,16,0.98)] shadow-2xl backdrop-blur-md md:mb-0 md:max-w-[420px] md:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <p className="text-sm font-semibold">
            Comments{comments.length ? ` · ${comments.length}` : ""}
          </p>
          <button
            type="button"
            className="text-sm text-[var(--blyp-muted)]"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <p className="py-8 text-center text-sm text-[var(--blyp-muted)]">
              Loading…
            </p>
          ) : null}
          {!loading && !comments.length ? (
            <p className="py-8 text-center text-sm text-[var(--blyp-muted)]">
              No comments yet. Be the first.
            </p>
          ) : null}
          <ul className="space-y-4">
            {comments
              .filter((c) => !c.parentId)
              .map((c) => (
                <li key={c.id} className="flex gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--blyp-teal)] text-xs font-bold text-[var(--blyp-ink)]">
                    {c.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.avatar}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      (c.username || "U").slice(0, 1).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-semibold text-white">
                        @{c.username}
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--blyp-muted)]">
                        {formatCommentTime(c.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-snug text-white/90">
                      {c.text}
                    </p>
                  </div>
                </li>
              ))}
          </ul>
          {error ? (
            <p className="mt-3 text-center text-xs text-red-300">{error}</p>
          ) : null}
        </div>

        <div className="border-t border-white/10 p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
              placeholder={
                session ? "Add a comment…" : "Log in to comment"
              }
              maxLength={500}
              className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--blyp-teal)]"
            />
            <button
              type="button"
              disabled={sending || !text.trim()}
              onClick={() => void onSend()}
              className="rounded-full bg-[var(--blyp-teal)] px-4 py-2.5 text-sm font-bold text-[var(--blyp-ink)] disabled:opacity-40"
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
