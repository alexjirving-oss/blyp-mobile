import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account & Data Deletion",
};

export default function DeleteAccountPage() {
  return (
    <article className="mx-auto max-w-3xl px-5 py-12 text-[var(--blyp-muted)]">
      <p className="mb-3 inline-block rounded-full border border-[rgba(0,210,190,0.35)] bg-[rgba(0,210,190,0.12)] px-3 py-1 text-xs text-[var(--blyp-teal)]">
        Google Play: Data deletion URL
      </p>
      <h1 className="font-display text-4xl font-extrabold text-[var(--blyp-fog)]">
        Account &amp; Data Deletion
      </h1>
      <p className="mt-2 text-sm">Last updated: 2026-08-10</p>
      <div className="mt-8 space-y-4 leading-relaxed">
        <h2 className="font-display text-xl font-bold text-[var(--blyp-fog)]">
          How to request deletion
        </h2>
        <p>
          Email{" "}
          <a
            className="text-[var(--blyp-teal)]"
            href="mailto:privacy@blyp.world?subject=Blyp%20Account%20Deletion%20Request"
          >
            privacy@blyp.world
          </a>{" "}
          with the email you use for Blyp, your username if known, and the words{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5 text-[var(--blyp-fog)]">
            Delete my Blyp account
          </code>
          .
        </p>
        <h2 className="font-display text-xl font-bold text-[var(--blyp-fog)]">
          What we delete
        </h2>
        <p>
          We delete or anonymize account profile data, posts you own where
          feasible, and wallet identifiers subject to legal retention for
          payments and fraud prevention.
        </p>
      </div>
    </article>
  );
}
