import type { Metadata } from "next";
import Link from "next/link";
import {
  CONTACT_EMAIL,
  DEFAULT_DESCRIPTION,
  OG_IMAGE_PATH,
  PLAY_STORE_URL,
  PRIVACY_EMAIL,
  SITE_URL,
  SUPPORT_EMAIL,
} from "@/lib/site";

export const metadata: Metadata = {
  title: "About Blyp",
  description:
    "What Blyp is: a short-video and LIVE social product on blyp.world and Google Play. Brand spelling Blyp (B-L-Y-P), company contacts, and how to get the app.",
  alternates: { canonical: "/about/" },
  openGraph: {
    title: "About Blyp",
    description: DEFAULT_DESCRIPTION,
    url: `${SITE_URL}/about/`,
    images: [{ url: OG_IMAGE_PATH }],
  },
};

const FAQ = [
  {
    q: "What is Blyp?",
    a: "Blyp is a short-video and live-streaming product. Watch For You clips, join LIVE sessions, use Stage pages, and gift with Blyp coins — on the web and in the Android app.",
  },
  {
    q: "How do you spell Blyp?",
    a: "Blyp — B-L-Y-P. The website is blyp.world. The Android package is com.blyp.mobile on Google Play.",
  },
  {
    q: "Is Blyp only an app?",
    a: "No. Blyp runs as a full web product at blyp.world and as a mobile app on Google Play. Reach is earned, not bought.",
  },
  {
    q: "Where can I download Blyp?",
    a: "Android: Google Play (com.blyp.mobile). Or open https://blyp.world/download/ for the current store link.",
  },
] as const;

export default function AboutPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };

  return (
    <article className="mx-auto max-w-[720px] px-5 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <p className="font-display text-sm font-semibold uppercase tracking-[0.28em] text-[var(--blyp-teal)]">
        About
      </p>
      <h1 className="font-display mt-3 text-4xl font-extrabold tracking-tight text-[var(--blyp-fog)] sm:text-5xl">
        Blyp
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-[var(--blyp-muted)]">
        Blyp (B-L-Y-P) is a live-first social product: short video, LIVE
        streaming, Stage creator pages, and coins — on{" "}
        <strong className="font-semibold text-[var(--blyp-fog)]">blyp.world</strong>{" "}
        and on Google Play.
      </p>

      <section className="mt-12 space-y-4">
        <h2 className="font-display text-xl font-bold text-[var(--blyp-fog)]">
          What we make
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-[var(--blyp-muted)]">
          <li>
            <Link href="/foryou/" className="text-[var(--blyp-teal)] hover:underline">
              For You
            </Link>{" "}
            — watch short video without an account.
          </li>
          <li>
            <Link href="/live/" className="text-[var(--blyp-teal)] hover:underline">
              LIVE
            </Link>{" "}
            — real sessions, gifts, and creator tools.
          </li>
          <li>
            Stage pages for creators, plus coins on web and in-app.
          </li>
        </ul>
      </section>

      <section className="mt-12 space-y-4">
        <h2 className="font-display text-xl font-bold text-[var(--blyp-fog)]">
          Company & contact
        </h2>
        <p className="text-[var(--blyp-muted)]">
          Blyp operates primarily online (no public walk-in storefront). Use
          these contacts for brand and product inquiries:
        </p>
        <dl className="space-y-3 text-sm text-[var(--blyp-muted)]">
          <div>
            <dt className="font-semibold text-[var(--blyp-fog)]">Brand name</dt>
            <dd>Blyp (B-L-Y-P)</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--blyp-fog)]">Website</dt>
            <dd>
              <a href={SITE_URL} className="text-[var(--blyp-teal)] hover:underline">
                {SITE_URL}
              </a>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--blyp-fog)]">General</dt>
            <dd>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-[var(--blyp-teal)] hover:underline"
              >
                {CONTACT_EMAIL}
              </a>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--blyp-fog)]">Support</dt>
            <dd>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-[var(--blyp-teal)] hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--blyp-fog)]">Privacy</dt>
            <dd>
              <a
                href={`mailto:${PRIVACY_EMAIL}`}
                className="text-[var(--blyp-teal)] hover:underline"
              >
                {PRIVACY_EMAIL}
              </a>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--blyp-fog)]">Android app</dt>
            <dd>
              <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--blyp-teal)] hover:underline"
              >
                Google Play — com.blyp.mobile
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-12 space-y-6">
        <h2 className="font-display text-xl font-bold text-[var(--blyp-fog)]">
          FAQ
        </h2>
        {FAQ.map((item) => (
          <div key={item.q}>
            <h3 className="font-semibold text-[var(--blyp-fog)]">{item.q}</h3>
            <p className="mt-1 text-[var(--blyp-muted)]">{item.a}</p>
          </div>
        ))}
      </section>

      <p className="mt-14">
        <Link
          href="/download/"
          className="inline-flex rounded-full bg-[var(--blyp-teal)] px-6 py-3 text-sm font-semibold text-[var(--blyp-ink)] transition hover:bg-[var(--blyp-teal-deep)] hover:text-[var(--blyp-fog)]"
        >
          Get Blyp on Google Play
        </Link>
      </p>
    </article>
  );
}
