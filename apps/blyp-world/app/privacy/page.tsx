import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-5 py-12 text-[var(--blyp-muted)]">
      <h1 className="font-display text-4xl font-extrabold text-[var(--blyp-fog)]">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm">Last updated: 2026-08-10</p>
      <div className="mt-8 space-y-4 leading-relaxed">
        <p>
          Blyp (&quot;we&quot;, &quot;us&quot;) operates the Blyp mobile app and
          blyp.world. This policy explains what we collect and how we use it.
        </p>
        <h2 className="font-display pt-4 text-2xl font-bold text-[var(--blyp-fog)]">
          Contact
        </h2>
        <p>
          Privacy requests:{" "}
          <a className="text-[var(--blyp-teal)]" href="mailto:privacy@blyp.world">
            privacy@blyp.world
          </a>
        </p>
        <h2 className="font-display pt-4 text-2xl font-bold text-[var(--blyp-fog)]">
          Data we process
        </h2>
        <p>
          Account identifiers (email, username), profile and Stage content, posts
          and LIVE activity, wallet/ledger events, device diagnostics, and
          support messages — as needed to run Blyp.
        </p>
        <h2 className="font-display pt-4 text-2xl font-bold text-[var(--blyp-fog)]">
          Your choices
        </h2>
        <p>
          You can request account and data deletion via{" "}
          <Link className="text-[var(--blyp-teal)]" href="/delete-account">
            Account &amp; Data Deletion
          </Link>
          .
        </p>
      </div>
    </article>
  );
}
