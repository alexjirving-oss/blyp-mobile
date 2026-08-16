"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AGENCY_RATE_BASE,
  ECONOMY_BULLETS,
  MONEY_CARD_LEAD,
} from "@/lib/teamEconomy";
import {
  createTeamReferralWeb,
  type TeamBundle,
  type TeamReferral,
} from "@/lib/teams";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { ShareRecruitHub } from "../ShareRecruitHub";
import { Avatar, SectionTitle, fmt } from "../deskUi";

const CHECKLIST = [
  { id: "invite5", label: "Invite 5 hosts (TikTok DM / Discord / WhatsApp)" },
  { id: "discord", label: "Paste Discord announce into your server" },
  { id: "join", label: "Clear join requests same day" },
  { id: "battle", label: "Set one internal battle" },
  {
    id: "money",
    label: "Tell one host: they keep half; you earn 10% on gifts from Blyp’s half",
  },
  { id: "nudge", label: "Nudge inactive hosts (copy → paste)" },
] as const;

export function DeskRecruit({
  team,
  preview,
  inviteUrl,
  deepLink,
  session,
  onRefresh,
  onToast,
}: {
  team: TeamBundle;
  preview: boolean;
  inviteUrl: string;
  deepLink: string;
  session: { sub: string; idToken: string } | null;
  onRefresh: () => void;
  onToast: (msg: string) => void;
}) {
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [refName, setRefName] = useState("");
  const [refEmail, setRefEmail] = useState("");
  const [refNote, setRefNote] = useState("");
  const [refRole, setRefRole] = useState<"host" | "co-leader">("host");
  const [refBusy, setRefBusy] = useState(false);
  const [refDone, setRefDone] = useState<TeamReferral | null>(null);
  const [localReferrals, setLocalReferrals] = useState<TeamReferral[] | null>(
    null,
  );
  const referrals = localReferrals ?? team.referrals ?? [];

  const submitReferral = async (e: FormEvent) => {
    e.preventDefault();
    if (preview) {
      onToast("Preview only — invites save on your live desk");
      return;
    }
    if (!session) {
      onToast("Sign in to send an invite.");
      return;
    }
    setRefBusy(true);
    setRefDone(null);
    try {
      await ensureFirebaseFromCognito({
        cognitoIdToken: session.idToken,
        uid: session.sub,
      });
      const result = await createTeamReferralWeb({
        teamId: team.teamId,
        teamName: team.name,
        leaderUid: session.sub,
        leaderName: team.leaderName,
        email: refEmail,
        name: refName,
        note: refNote,
        roleHint: refRole,
        idToken: session.idToken,
      });
      setLocalReferrals([result.referral, ...referrals]);
      setRefDone(result.referral);
      setRefEmail("");
      setRefName("");
      setRefNote("");
      onToast(
        result.emailSent
          ? `Invite emailed to ${result.referral.email}`
          : `Invite saved — copy a message and send it to ${result.referral.email}`,
      );
      onRefresh();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setRefBusy(false);
    }
  };

  if (!team.isLeader) return null;

  return (
    <div className="space-y-6">
      <ShareRecruitHub
        teamName={team.name}
        inviteUrl={inviteUrl}
        leaderName={team.leaderName}
        deepLink={deepLink}
        onToast={onToast}
      />

      <section
        id="email-invite"
        className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 md:p-5"
      >
        <SectionTitle>Send them an invite (email)</SectionTitle>
        <p className="mb-4 text-sm text-[var(--blyp-muted)]">
          Prefer email? Save their address — we’ll try to send the invite. Still
          paste a TikTok/Discord blurb from Share & recruit if email doesn’t
          land.
        </p>
        <form onSubmit={submitReferral} className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={refName}
              onChange={(e) => setRefName(e.target.value)}
              placeholder="Name (optional)"
              maxLength={80}
              className="rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2.5 text-sm outline-none ring-[var(--blyp-teal)] focus:ring-1"
            />
            <select
              value={refRole}
              onChange={(e) =>
                setRefRole(e.target.value as "host" | "co-leader")
              }
              className="rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2.5 text-sm"
            >
              <option value="host">Host</option>
              <option value="co-leader">Co-leader</option>
            </select>
          </div>
          <input
            type="email"
            required
            value={refEmail}
            onChange={(e) => setRefEmail(e.target.value)}
            placeholder="host@email.com"
            maxLength={120}
            className="w-full rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2.5 text-sm outline-none ring-[var(--blyp-teal)] focus:ring-1"
          />
          <textarea
            value={refNote}
            onChange={(e) => setRefNote(e.target.value)}
            placeholder="Optional — nights they go live, market…"
            rows={2}
            maxLength={400}
            className="w-full resize-y rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2.5 text-sm outline-none ring-[var(--blyp-teal)] focus:ring-1"
          />
          <button
            type="submit"
            disabled={refBusy}
            className="rounded-lg bg-[var(--blyp-teal)] px-4 py-2.5 text-xs font-bold text-[var(--blyp-ink)] disabled:opacity-60"
          >
            {refBusy ? "Sending…" : "Send invite"}
          </button>
          {refDone ? (
            <div className="rounded-lg border border-[var(--blyp-teal)]/35 bg-[rgba(0,210,190,0.08)] px-3 py-3 text-sm">
              <p className="font-semibold text-[var(--blyp-teal)]">
                Invite queued for {refDone.email}
              </p>
            </div>
          ) : null}
        </form>
        {referrals.length > 0 ? (
          <div className="mt-5 border-t border-[var(--blyp-line)] pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--blyp-muted)]">
              Pending invites
            </p>
            <ul className="mt-3 space-y-2">
              {referrals.slice(0, 12).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)]/40 px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={r.name || r.email} size={36} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {r.name || r.email}
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-[var(--blyp-muted)]">
                          {r.roleHint}
                        </span>
                      </p>
                      <p className="truncate text-xs text-[var(--blyp-muted)]">
                        {r.email}
                        {r.note ? ` · ${r.note}` : ""}
                      </p>
                    </div>
                  </div>
                  <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--blyp-gold)]">
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 md:p-5">
        <SectionTitle>Money this week</SectionTitle>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="font-display text-xl font-bold text-[var(--blyp-teal)] sm:text-2xl">
              {MONEY_CARD_LEAD}
            </p>
            <ul className="mt-4 space-y-2 text-sm text-[var(--blyp-muted)]">
              {ECONOMY_BULLETS.map((b) => (
                <li key={b} className="flex gap-2">
                  <span className="text-[var(--blyp-teal)]">▸</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)]/50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--blyp-muted)]">
              This roster
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--blyp-muted)]">Est. gift spend</dt>
                <dd className="font-semibold">{fmt(team.estimatedGiftSpend)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--blyp-muted)]">Creator gems (half)</dt>
                <dd className="font-semibold">
                  {fmt(team.teamTotalGems || team.estimatedGiftSpend / 2)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--blyp-muted)]">
                  Your cut ({Math.round(AGENCY_RATE_BASE * 100)}%)
                </dt>
                <dd className="font-semibold text-[var(--blyp-gold)]">
                  {fmt(team.agencyEarningsDisplay)}
                  {team.agencyEarningsIsEstimate ? " est." : ""}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4">
          <SectionTitle>Day 1 checklist</SectionTitle>
          <ul className="space-y-2">
            {CHECKLIST.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!checklist[item.id]}
                    onChange={() =>
                      setChecklist((c) => ({
                        ...c,
                        [item.id]: !c[item.id],
                      }))
                    }
                    className="mt-1"
                  />
                  <span
                    className={
                      checklist[item.id]
                        ? "text-[var(--blyp-muted)] line-through"
                        : ""
                    }
                  >
                    {item.label}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4">
          <SectionTitle>Support</SectionTitle>
          <ul className="space-y-2 text-sm">
            <li>
              <a
                href="mailto:privacy@blyp.world?subject=Team%20support%20%2F%20appeal"
                className="font-semibold text-[var(--blyp-teal)]"
              >
                Email support / appeal →
              </a>
            </li>
            <li>
              <Link href="/live/studio/" className="font-semibold text-[var(--blyp-fog)]">
                LIVE studio →
              </Link>
            </li>
            <li>
              <Link href="/wallet/" className="font-semibold text-[var(--blyp-fog)]">
                Wallet →
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
