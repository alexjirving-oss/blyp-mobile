"use client";

import "./director-chrome.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchStreamGiftSummary,
  subscribeLiveChat,
  type LiveChatComment,
  type StreamGiftSummary,
} from "@/lib/live";
import {
  fetchGuestRequests,
  inviteGuest,
  rejectGuest,
  type GuestRequestRow,
} from "@/lib/liveHost";
import { RollingNumber } from "../ui/RollingNumber";
import { useStudioState } from "../store/StudioStateContext";

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

export function SocialPanel() {
  const { session } = useAuth();
  const {
    socialFeed,
    jackpotPool,
    hostGems,
    activeMode,
    hostSessionId,
    isLive,
    pushFeed,
  } = useStudioState();

  const [guestRows, setGuestRows] = useState<GuestRequestRow[]>([]);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  const [chat, setChat] = useState<LiveChatComment[]>([]);
  const [gifts, setGifts] = useState<StreamGiftSummary | null>(null);

  useEffect(() => {
    if (!hostSessionId || !session?.idToken) {
      setGuestRows([]);
      setGuestError(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const rows = await fetchGuestRequests(session.idToken, hostSessionId);
        if (!cancelled) {
          setGuestRows(rows);
          setGuestError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setGuestError(
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
  }, [hostSessionId, session?.idToken]);

  useEffect(() => {
    if (!hostSessionId) {
      setChat([]);
      return;
    }
    return subscribeLiveChat(hostSessionId, setChat);
  }, [hostSessionId]);

  useEffect(() => {
    if (!hostSessionId || !session?.idToken) {
      setGifts(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const summary = await fetchStreamGiftSummary(
        session.idToken,
        hostSessionId,
      );
      if (!cancelled) setGifts(summary);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [hostSessionId, session?.idToken]);

  const pending = useMemo(() => pendingRequests(guestRows), [guestRows]);
  const onStage = useMemo(() => invitedOrLive(guestRows), [guestRows]);

  const onGuestAction = useCallback(
    async (action: "accept" | "reject", guestUserId: string) => {
      if (!session?.idToken || !hostSessionId) return;
      setGuestBusy(true);
      try {
        if (action === "accept") {
          await inviteGuest(session.idToken, hostSessionId, guestUserId);
          pushFeed(`Guest invited · ${guestUserId.slice(0, 8)}…`);
        } else {
          await rejectGuest(session.idToken, hostSessionId, guestUserId);
          pushFeed(`Guest rejected · ${guestUserId.slice(0, 8)}…`);
        }
        const rows = await fetchGuestRequests(session.idToken, hostSessionId);
        setGuestRows(rows);
      } catch (e) {
        setGuestError(e instanceof Error ? e.message : "Guest action failed");
      } finally {
        setGuestBusy(false);
      }
    },
    [hostSessionId, pushFeed, session?.idToken],
  );

  return (
    <aside className="blyp-studio-region blyp-studio-right blyp-studio-scroll g9-dir">
      <p className="g9-dir-kicker">Social / Economy</p>

      <div className="g9-dir-card">
        <div className="g9-dir-stat-label">Session coins</div>
        <div className="g9-dir-stat-gold">
          <RollingNumber value={jackpotPool} />{" "}
          <span className="g9-dir-unit">
            {activeMode === "GRID9" ? "JACKPOT" : "POOL"}
          </span>
        </div>
        <div className="g9-dir-stat-label g9-dir-gap-md">
          Host gems
        </div>
        <div className="g9-dir-stat-teal">{hostGems}</div>
        {gifts ? (
          <div className="g9-dir-stat-sub">
            {gifts.coinsReceived.toLocaleString()} coins ·{" "}
            {gifts.viewerGiftCount} gifts
          </div>
        ) : null}
      </div>

      <div className="g9-dir-card">
        <div className="g9-dir-card-title">Guests</div>
        {!isLive || !hostSessionId ? (
          <p className="g9-dir-hint">
            GO LIVE to accept join requests from the app.
          </p>
        ) : guestError ? (
          <p className="blyp-studio-publish-error">{guestError}</p>
        ) : pending.length === 0 && onStage.length === 0 ? (
          <p className="g9-dir-hint">No requests yet.</p>
        ) : (
          <ul className="blyp-studio-list">
            {pending.map((g) => (
              <li key={`p-${g.userId}`} className="blyp-studio-list-row">
                <span className="min-w-0 flex-1 truncate text-[var(--blyp-fog)]">
                  {g.userId}
                </span>
                <button
                  type="button"
                  className="blyp-studio-mini-btn is-on"
                  disabled={guestBusy}
                  onClick={() => void onGuestAction("accept", g.userId)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="blyp-studio-mini-btn is-danger"
                  disabled={guestBusy}
                  onClick={() => void onGuestAction("reject", g.userId)}
                >
                  Reject
                </button>
              </li>
            ))}
            {onStage.map((g) => (
              <li key={`s-${g.userId}`} className="blyp-studio-list-row">
                <span className="min-w-0 flex-1 truncate text-[var(--blyp-fog)]">
                  {g.userId}
                </span>
                <span className="g9-dir-hint">{g.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="g9-dir-card">
        <div className="g9-dir-card-title">Chat</div>
        <ul className="blyp-studio-feed g9-dir-feed-cap">
          {chat.length === 0 ? (
            <li className="g9-dir-hint">
              Comments from the watch page land here when live.
            </li>
          ) : (
            chat.slice(0, 30).map((c) => (
              <li key={c.id} className="blyp-studio-feed-item">
                <strong>{c.displayName || c.username}</strong> {c.text}
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="g9-dir-card is-flush">
        <div className="g9-dir-card-title">Live feed</div>
        <ul className="blyp-studio-feed">
          {socialFeed.length === 0 && (
            <li className="g9-dir-hint">
              Director events and gifts appear here.
            </li>
          )}
          {socialFeed.map((evt) => (
            <li key={evt.id} className="blyp-studio-feed-item">
              {evt.text}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
