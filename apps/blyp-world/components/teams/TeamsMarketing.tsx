"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { applyToRunTeamWeb } from "@/lib/teams";
import { siteUrl } from "@/lib/env";
import { MONEY_CARD_LEAD } from "@/lib/teamEconomy";
import { useAuth } from "../AuthProvider";
import { ShareRecruitHub } from "./ShareRecruitHub";
const COMPARE = [
  {
    tiktok: "Opaque diamond math + payout fog",
    blyp: "50/50 published. Creators keep their half.",
  },
  {
    tiktok: "Agency cut buried in partner rebates",
    blyp: "You earn 10% from Blyp’s half — LIVE, posts, messages, dating.",
  },
  {
    tiktok: "Ops = spreadsheets + group chats",
    blyp: "Desk: invite, who’s late, who’s live, battles, money this week.",
  },
] as const;
const DAY1 = [
  "Invite 5 hosts (TikTok DM / Discord / WhatsApp — copy buttons on the desk)",
  "Paste the Discord announce into your server",
  "Accept join requests same day",
  "Schedule one internal battle",
  "Walk one host through: they keep half; you earn from Blyp’s half on all gifts",
] as const;
const PREVIEWS = [
  {
    src: "/teams/desk-overview.png",
    alt: "Blyp Teams desk — KPIs and LIVE ops",
    caption: "Who’s live · hours this week · agency cut",
  },
  {
    src: "/teams/desk-roster.png",
    alt: "Blyp Teams roster",
    caption: "Roster · nudge inactive · export CSV",
  },
  {
    src: "/teams/desk-money.png",
    alt: "Blyp Teams money card",
    caption: "Money — 50/50 + cut on all gift surfaces",
  },
] as const;
export function ApplyForm({ onApplied }: { onApplied?: () => void }) {
  const { session, me, loading, requireAuth } = useAuth();
  const [teamName, setTeamName] = useState("");
  const [rosterSize, setRosterSize] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [pitch, setPitch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (requireAuth("Sign in to apply to run a team on Blyp.")) return;
    if (!session?.sub || !session.idToken) return;
    if (!pitch.trim()) {
      setError("Quick note: roster size, markets, how you run LIVE today.");
      return;
    }
    setSubmitting(true);
    try {
      const bridged = await ensureFirebaseFromCognito({
        cognitoIdToken: session.idToken,
        uid: session.sub,
      });
      if (!bridged) {
        throw new Error("Couldn’t connect your session. Refresh and try again.");
      }
      await applyToRunTeamWeb({
        uid: session.sub,
        displayName: me?.displayName || session.username || "Creator",
        username: me?.username || session.username || session.sub.slice(0, 8),
        photoURL: me?.photoURL || null,
        pitch: pitch.trim(),
        teamName: teamName.trim(),
        contactEmail: contactEmail.trim(),
        rosterSize: rosterSize.trim(),
      });
      setDone(true);
      onApplied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Application failed");
    } finally {
      setSubmitting(false);
    }
  };
  if (loading) {
    return <p className="text-sm text-[var(--blyp-muted)]">Loading session…</p>;
  }
  if (done) {
    return (
      <div className="rounded-2xl border border-[var(--blyp-teal)]/40 bg-[rgba(0,210,190,0.08)] px-5 py-6">
        <p className="font-display text-xl font-bold text-[var(--blyp-teal)]">
          Application sent
        </p>
        <p className="mt-2 text-sm text-[var(--blyp-muted)]">
          Same queue as the Blyp app. When approved, this page becomes your desk —
          invite hosts in day one.
        </p>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--blyp-muted)]">
          Sign in with Blyp to apply. Verified profiles only.
        </p>
        <Link
          href="/login?next=/teams#apply"
          className="inline-flex rounded-full bg-[var(--blyp-teal)] px-6 py-3 text-sm font-bold text-[var(--blyp-ink)]"
        >
          Log in to apply
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--blyp-muted)]">
            Team / agency name
          </span>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            maxLength={80}
            placeholder="e.g. North Star LIVE"
            className="w-full rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2.5 text-[var(--blyp-fog)] outline-none ring-[var(--blyp-teal)] focus:ring-1"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-[var(--blyp-muted)]">
            Roster size (approx)
          </span>
          <input
            value={rosterSize}
            onChange={(e) => setRosterSize(e.target.value)}
            maxLength={40}
            placeholder="e.g. 12 creators"
            className="w-full rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2.5 text-[var(--blyp-fog)] outline-none ring-[var(--blyp-teal)] focus:ring-1"
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1.5 block text-[var(--blyp-muted)]">Contact email</span>
        <input
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          maxLength={120}
          placeholder="you@agency.com"
          className="w-full rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2.5 text-[var(--blyp-fog)] outline-none ring-[var(--blyp-teal)] focus:ring-1"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block text-[var(--blyp-muted)]">
          Who you run + how you operate (short)
        </span>
        <textarea
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          required
          rows={4}
          maxLength={1000}
          placeholder="Markets, roster, Discord/WhatsApp ops, what you need from the desk…"
          className="w-full resize-y rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2.5 text-[var(--blyp-fog)] outline-none ring-[var(--blyp-teal)] focus:ring-1"
        />
      </label>
      {error ? (
        <p className="text-sm text-[var(--blyp-rose)]">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex rounded-full bg-[var(--blyp-teal)] px-6 py-3 text-sm font-bold text-[var(--blyp-ink)] disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Apply to run a team"}
      </button>
    </form>
  );
}
export function ApplicationStatusBanner({
  status,
  teamName,
}: {
  status: string;
  teamName?: string | null;
}) {
  const st = status.toLowerCase();
  if (st === "approved" || st === "accepted") {
    return (
      <div className="border-b border-[var(--blyp-teal)]/30 bg-[rgba(0,210,190,0.08)] px-5 py-3 text-center text-sm md:px-8">
        Approved{teamName ? ` · ${teamName}` : ""}. Refresh when your desk is live.
      </div>
    );
  }
  if (st === "rejected" || st === "declined") {
    return (
      <div className="border-b border-[var(--blyp-rose)]/30 bg-[rgba(240,160,184,0.08)] px-5 py-3 text-center text-sm md:px-8">
        Declined — update and re-apply, or email{" "}
        <a
          className="font-semibold text-[var(--blyp-teal)]"
          href="mailto:privacy@blyp.world?subject=Team%20application"
        >
          support
        </a>
        .
      </div>
    );
  }
  return (
    <div className="border-b border-[var(--blyp-gold)]/30 bg-[rgba(232,196,124,0.08)] px-5 py-3 text-center text-sm md:px-8">
      Application{" "}
      <span className="font-semibold text-[var(--blyp-gold)]">pending</span>
      {teamName ? ` · ${teamName}` : ""}. We’ll open your desk when approved.
    </div>
  );
}
function PreviewFigure({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="min-w-0">
      <div className="overflow-hidden rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
        {failed ? (
          <div className="flex aspect-[16/10] items-center justify-center px-4 text-center text-sm text-[var(--blyp-muted)]">
            Open{" "}
            <Link href="/teams/preview/" className="mx-1 text-[var(--blyp-teal)]">
              /teams/preview
            </Link>{" "}
            for the live desk UI
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            className="aspect-[16/10] w-full object-cover object-top"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <figcaption className="mt-3 text-sm text-[var(--blyp-muted)]">
        {caption}
      </figcaption>
    </figure>
  );
}
export function TeamsMarketing({
  showDashboardLink,
}: {
  showDashboardLink?: boolean;
}) {
  const demoInvite = `${siteUrl}/teams/?join=demo`;
  return (
    <div className="pb-24">
      <section className="relative overflow-hidden border-b border-[var(--blyp-line)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 55% at 88% 0%, rgba(0,210,190,0.22), transparent 55%), radial-gradient(45% 40% at 8% 80%, rgba(232,196,124,0.08), transparent 50%)",
          }}
        />
        <div className="relative mx-auto flex min-h-[62vh] max-w-5xl flex-col justify-end px-5 pb-14 pt-20 md:px-8 md:pb-18">
          <p className="font-display text-5xl font-extrabold tracking-tight text-[var(--blyp-fog)] sm:text-6xl md:text-7xl">
            Blyp
          </p>
          <h1 className="font-display mt-4 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-5xl">
            Run your Creator Network from one desk.
          </h1>
          <p className="mt-5 max-w-xl text-base text-[var(--blyp-muted)] sm:text-lg">
            Invite hosts where you already work. See who’s live, who’s late,
            battles tonight, money this week. Apply — then operate.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#apply"
              className="inline-flex rounded-full bg-[var(--blyp-teal)] px-6 py-3 text-sm font-bold text-[var(--blyp-ink)]"
            >
              Apply to run a team
            </a>
            <a
              href="#desk-preview"
              className="inline-flex rounded-full border border-[var(--blyp-line)] px-6 py-3 text-sm font-semibold text-[var(--blyp-fog)]"
            >
              See the desk
            </a>
            <a
              href="#money"
              className="inline-flex rounded-full border border-[var(--blyp-line)] px-6 py-3 text-sm font-semibold text-[var(--blyp-fog)]"
            >
              Your cut
            </a>
            {showDashboardLink ? (
              <a
                href="#dashboard"
                className="inline-flex rounded-full border border-[var(--blyp-teal)]/40 px-6 py-3 text-sm font-semibold text-[var(--blyp-teal)]"
              >
                Open your desk
              </a>
            ) : null}
          </div>
        </div>
      </section>
      <section
        id="desk-preview"
        className="border-b border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)]"
      >
        <div className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--blyp-teal)]">
            The desk
          </p>
          <h2 className="font-display mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            Tools, not a pitch deck.
          </h2>
          <p className="mt-3 max-w-2xl text-[var(--blyp-muted)]">
            Share & recruit · who’s live · inactive hosts · join requests ·
            battles · money this week.
          </p>
          <div className="mt-10 grid gap-8 lg:grid-cols-3">
            {PREVIEWS.map((p) => (
              <PreviewFigure key={p.src} {...p} />
            ))}
          </div>
          <p className="mt-8 text-sm text-[var(--blyp-muted)]">
            Click around:{" "}
            <Link
              href="/teams/preview/"
              className="font-semibold text-[var(--blyp-teal)]"
            >
              interactive desk preview
            </Link>
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-4xl px-5 py-14 md:px-8 md:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--blyp-teal)]">
          Vs TikTok agency tools
        </p>
        <h2 className="font-display mt-3 text-3xl font-bold tracking-tight">
          Three things that matter.
        </h2>
        <ul className="mt-8 divide-y divide-[var(--blyp-line)] border-y border-[var(--blyp-line)]">
          {COMPARE.map((row) => (
            <li
              key={row.tiktok}
              className="grid gap-2 py-4 md:grid-cols-2 md:gap-8"
            >
              <p className="text-sm text-[var(--blyp-fog)]/75">{row.tiktok}</p>
              <p className="text-sm font-medium text-[var(--blyp-fog)]">
                {row.blyp}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section
        id="money"
        className="border-y border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)]"
      >
        <div className="mx-auto max-w-4xl px-5 py-14 md:px-8 md:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--blyp-gold)]">
            Your cut
          </p>
          <h2 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            50/50. Creators keep their half.
          </h2>
          <p className="mt-5 max-w-2xl font-display text-xl font-bold text-[var(--blyp-teal)] sm:text-2xl">
            {MONEY_CARD_LEAD}
          </p>
          <p className="mt-3 text-sm text-[var(--blyp-muted)]">
            Growth tier up to 15%. No 30% withdraw fee on Blyp.
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-4xl px-5 py-14 md:px-8 md:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--blyp-teal)]">
          Share where you already work
        </p>
        <h2 className="font-display mt-3 text-3xl font-bold tracking-tight">
          TikTok DM · Discord · WhatsApp · Telegram · SMS
        </h2>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          No TikTok messaging API — copy → paste into the DM. That’s the job.
        </p>
        <div className="mt-6">
          <ShareRecruitHub
            compact
            teamName="Your team"
            inviteUrl={demoInvite}
            leaderName="you"
          />
        </div>
      </section>
      <section
        id="apply"
        className="border-t border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)]"
      >
        <div className="mx-auto grid max-w-5xl gap-12 px-5 py-14 md:grid-cols-2 md:px-8 md:py-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--blyp-teal)]">
              Day 1 checklist
            </p>
            <h2 className="font-display mt-3 text-3xl font-bold tracking-tight">
              Apply → desk → move hosts
            </h2>
            <ol className="mt-6 space-y-3 text-sm text-[var(--blyp-fog)]">
              {DAY1.map((item, i) => (
                <li key={item} className="flex gap-2">
                  <span className="font-semibold text-[var(--blyp-teal)]">
                    {i + 1}.
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <ApplyForm />
          </div>
        </div>
      </section>
    </div>
  );
}
