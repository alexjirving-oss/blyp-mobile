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
    "What Blyp is: short video, LIVE, Stage, and coins on blyp.world and Google Play.",
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
    a: "No. Blyp runs as a full web product at blyp.world and as a mobile app on Google Play.",
  },
  {
    q: "Where can I download Blyp?",
    a: "Android: Google Play (com.blyp.mobile). Or open https://blyp.world/download/ for the store link.",
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
        Short video, LIVE streaming, Stage pages, and coins — on{" "}
        <strong className="font-semibold text-[var(--blyp-fog)]">blyp.world</strong>{" "}
        and Google Play. Reach is earned, not bought.
      </p>

      <section className="mt-12 space-y-4">
        <h2 className="font-display text-xl font-bold text-[var(--blyp-fog)]">
          Product
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-[var(--blyp-muted)]">
          <li>
            <Link href="/foryou/" className="text-[var(--blyp-teal)] hover:underline">
              For You
            </Link>{" "}
            — watch without an account.
          </li>
          <li>
            <Link href="/live/" className="text-[var(--blyp-teal)] hover:underline">
              LIVE
            </Link>{" "}
            — real sessions and gifts.
          </li>
          <li>Stage pages and coins on web and in-app.</li>
        </ul>
      </section>

      <section className="mt-12 space-y-3 text-sm text-[var(--blyp-muted)]">
        <h2 className="font-display text-xl font-bold text-[var(--blyp-fog)]">
          Contact
        </h2>
        <p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-[var(--blyp-teal)] hover:underline">
            {CONTACT_EMAIL}
          </a>
          {" · "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[var(--blyp-teal)] hover:underline">
            {SUPPORT_EMAIL}
          </a>
          {" · "}
          <a href={`mailto:${PRIVACY_EMAIL}`} className="text-[var(--blyp-teal)] hover:underline">
            {PRIVACY_EMAIL}
          </a>
        </p>
        <p>
          Spelled B-L-Y-P · Android{" "}
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--blyp-teal)] hover:underline"
          >
            com.blyp.mobile
          </a>
        </p>
      </section>

      <section className="mt-12 space-y-5">
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

      <p className="mt-14 flex flex-wrap gap-4">
        <Link
          href="/foryou/"
          className="inline-flex rounded-full bg-[var(--blyp-teal)] px-6 py-3 text-sm font-semibold text-[var(--blyp-ink)] transition hover:bg-[var(--blyp-teal-deep)] hover:text-[var(--blyp-fog)]"
        >
          Open For You
        </Link>
        <Link
          href="/download/"
          className="inline-flex rounded-full border border-[var(--blyp-line)] px-6 py-3 text-sm font-semibold text-[var(--blyp-fog)] transition hover:border-[var(--blyp-teal)]"
        >
          Download
        </Link>
      </p>
    </article>
  );
}
