"use client";

import { useMemo, useState, type FormEvent } from "react";
import type {
  AgencyLinkVisibility,
  TeamAgencyLink,
  TeamBundle,
} from "@/lib/teams";
import {
  lookupTeamForLink,
  proposeAgencyLinkWeb,
  respondAgencyLinkWeb,
} from "@/lib/teams";
import { SectionTitle } from "../deskUi";

export function DeskLinks({
  team,
  preview,
  sessionSub,
  sessionToken,
  withAuth,
  onToast,
}: {
  team: TeamBundle;
  preview?: boolean;
  sessionSub?: string;
  sessionToken?: string;
  withAuth: (fn: () => Promise<void>) => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const [peerId, setPeerId] = useState("");
  const [visibility, setVisibility] =
    useState<AgencyLinkVisibility>("private");
  const [lookupLabel, setLookupLabel] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const links = useMemo(() => team.agencyLinks || [], [team.agencyLinks]);
  const publicLinks = useMemo(
    () => links.filter((l) => l.visibility === "public" && l.status === "active"),
    [links],
  );
  const privateLinks = useMemo(
    () =>
      links.filter((l) => l.visibility === "private" && l.status === "active"),
    [links],
  );
  const pendingIn = useMemo(
    () => links.filter((l) => l.status === "pending" && l.isIncoming),
    [links],
  );
  const pendingOut = useMemo(
    () => links.filter((l) => l.status === "pending" && !l.isIncoming),
    [links],
  );

  if (!team.isLeader) return null;

  const resolvePeer = async () => {
    const raw = peerId.trim();
    if (!raw) {
      onToast("Paste the other agency’s team id (from their invite URL)");
      return;
    }
    // Accept full invite URLs: ?join=TEAMID
    let id = raw;
    try {
      if (raw.includes("join=")) {
        const u = new URL(
          raw.startsWith("http") ? raw : `https://blyp.world/teams/?${raw}`,
        );
        id = u.searchParams.get("join") || id;
      }
    } catch {
      // keep raw
    }
    setPeerId(id);
    if (preview) {
      setLookupLabel(`Preview peer · ${id}`);
      return;
    }
    const found = await lookupTeamForLink(id);
    if (!found) {
      setLookupLabel(null);
      onToast("Agency not found — check the team id");
      return;
    }
    setLookupLabel(`${found.name} · led by ${found.leaderName}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Agency links</SectionTitle>
        <p className="mt-[-0.5rem] text-sm text-[var(--blyp-muted)]">
          Pairwise only — public association or private link. Linking A↔Agency1
          and A↔Agency2 does not link Agency1↔Agency2.
        </p>
      </div>

      <section className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 md:p-5">
        <SectionTitle>Propose a link</SectionTitle>
        <form
          className="mt-2 space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const id = peerId.trim();
            if (!id) {
              onToast("Enter a peer team id");
              return;
            }
            setBusyAction("propose");
            void withAuth(async () => {
              if (!sessionSub || !sessionToken) return;
              await proposeAgencyLinkWeb({
                teamId: team.teamId,
                teamName: team.name,
                leaderUid: sessionSub,
                peerTeamId: id,
                visibility,
                idToken: sessionToken,
              });
              setPeerId("");
              setLookupLabel(null);
              onToast(
                visibility === "public"
                  ? "Public link proposed — waiting on their boss"
                  : "Private link proposed — waiting on their boss",
              );
            }).finally(() => setBusyAction(null));
          }}
        >
          <div className="flex flex-wrap gap-2">
            <input
              value={peerId}
              onChange={(e) => {
                setPeerId(e.target.value);
                setLookupLabel(null);
              }}
              placeholder="Peer team id or invite URL"
              className="min-w-[16rem] flex-1 rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void resolvePeer()}
              className="rounded-lg border border-[var(--blyp-line)] px-3 py-2 text-xs font-semibold"
            >
              Look up
            </button>
          </div>
          {lookupLabel ? (
            <p className="text-sm text-[var(--blyp-teal)]">{lookupLabel}</p>
          ) : null}
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="vis"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
              />
              Private link
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="vis"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />
              Public association
            </label>
          </div>
          <button
            type="submit"
            disabled={busyAction === "propose"}
            className="rounded-lg bg-[var(--blyp-teal)] px-3 py-2 text-xs font-bold text-[var(--blyp-ink)] disabled:opacity-50"
          >
            {busyAction === "propose" ? "Sending…" : "Send link request"}
          </button>
          <p className="text-xs text-[var(--blyp-muted)]">
            Your team id for peers:{" "}
            <code className="text-[var(--blyp-fog)]">{team.teamId}</code>
            {preview ? " · preview mode" : ""}
          </p>
        </form>
      </section>

      {(pendingIn.length > 0 || pendingOut.length > 0) && (
        <section className="rounded-xl border border-[var(--blyp-gold)]/30 bg-[rgba(232,196,124,0.06)] p-4 md:p-5">
          <SectionTitle>Pending</SectionTitle>
          <ul className="space-y-2">
            {pendingIn.map((l) => (
              <LinkRow
                key={l.id}
                link={l}
                tone="in"
                busy={busyAction === l.id}
                onAccept={() => {
                  setBusyAction(l.id);
                  void withAuth(async () => {
                    if (!sessionSub || !sessionToken) return;
                    await respondAgencyLinkWeb(
                      team.teamId,
                      l.id,
                      sessionSub,
                      "accept",
                      sessionToken,
                    );
                    onToast(`Linked with ${l.peerTeamName}`);
                  }).finally(() => setBusyAction(null));
                }}
                onReject={() => {
                  setBusyAction(l.id);
                  void withAuth(async () => {
                    if (!sessionSub || !sessionToken) return;
                    await respondAgencyLinkWeb(
                      team.teamId,
                      l.id,
                      sessionSub,
                      "reject",
                      sessionToken,
                    );
                    onToast("Link declined");
                  }).finally(() => setBusyAction(null));
                }}
              />
            ))}
            {pendingOut.map((l) => (
              <LinkRow
                key={l.id}
                link={l}
                tone="out"
                busy={busyAction === l.id}
                onRevoke={() => {
                  setBusyAction(l.id);
                  void withAuth(async () => {
                    if (!sessionSub || !sessionToken) return;
                    await respondAgencyLinkWeb(
                      team.teamId,
                      l.id,
                      sessionSub,
                      "revoke",
                      sessionToken,
                    );
                    onToast("Link request cancelled");
                  }).finally(() => setBusyAction(null));
                }}
              />
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <LinkColumn
          title="Public association"
          blurb="Visible on both team surfaces — recruitment signal that you battle with them. Roster pick still requires the link."
          links={publicLinks}
          empty="No public links yet"
          onRevoke={(l) => {
            setBusyAction(l.id);
            void withAuth(async () => {
              if (!sessionSub || !sessionToken) return;
              await respondAgencyLinkWeb(
                team.teamId,
                l.id,
                sessionSub,
                "revoke",
                sessionToken,
              );
              onToast("Public link revoked");
            }).finally(() => setBusyAction(null));
          }}
          busyId={busyAction}
        />
        <LinkColumn
          title="Private link"
          blurb="Known to bosses + eligible members only — quiet rivalries / soft tryouts. Same battle pick UX; no public alliance branding."
          links={privateLinks}
          empty="No private links yet"
          onRevoke={(l) => {
            setBusyAction(l.id);
            void withAuth(async () => {
              if (!sessionSub || !sessionToken) return;
              await respondAgencyLinkWeb(
                team.teamId,
                l.id,
                sessionSub,
                "revoke",
                sessionToken,
              );
              onToast("Private link revoked");
            }).finally(() => setBusyAction(null));
          }}
          busyId={busyAction}
        />
      </div>
    </div>
  );
}

function LinkColumn({
  title,
  blurb,
  links,
  empty,
  onRevoke,
  busyId,
}: {
  title: string;
  blurb: string;
  links: TeamAgencyLink[];
  empty: string;
  onRevoke: (l: TeamAgencyLink) => void;
  busyId: string | null;
}) {
  return (
    <div className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 md:p-5">
      <h3 className="font-display text-base font-bold">{title}</h3>
      <p className="mt-2 text-sm text-[var(--blyp-muted)]">{blurb}</p>
      {links.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-[var(--blyp-line)] px-3 py-6 text-center text-sm text-[var(--blyp-muted)]">
          {empty}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {links.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)]/40 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{l.peerTeamName}</p>
                <p className="truncate text-[10px] text-[var(--blyp-muted)]">
                  {l.peerTeamId}
                </p>
              </div>
              <button
                type="button"
                disabled={busyId === l.id}
                onClick={() => onRevoke(l)}
                className="shrink-0 text-[11px] font-semibold text-[var(--blyp-rose)] disabled:opacity-50"
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkRow({
  link,
  tone,
  busy,
  onAccept,
  onReject,
  onRevoke,
}: {
  link: TeamAgencyLink;
  tone: "in" | "out";
  busy?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  onRevoke?: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)]/50 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{link.peerTeamName}</p>
        <p className="text-[10px] text-[var(--blyp-muted)]">
          {tone === "in" ? "Incoming" : "Outgoing"} · {link.visibility}
        </p>
      </div>
      <div className="flex gap-2">
        {tone === "in" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onAccept}
              className="rounded-lg bg-[var(--blyp-teal)] px-2.5 py-1 text-[11px] font-bold text-[var(--blyp-ink)] disabled:opacity-50"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onReject}
              className="rounded-lg border border-[var(--blyp-line)] px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
            >
              Decline
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onRevoke}
            className="rounded-lg border border-[var(--blyp-line)] px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </li>
  );
}
