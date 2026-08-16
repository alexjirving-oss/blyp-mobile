import {
  ANDROID_PACKAGE_ID,
  CONTACT_EMAIL,
  DEFAULT_DESCRIPTION,
  OG_IMAGE_PATH,
  PLAY_STORE_URL,
  SAME_AS,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";

type JsonLdProps = {
  /** Extra nodes merged into the @graph (e.g. FAQPage on About). */
  extra?: Record<string, unknown>[];
};

/**
 * Organization + WebSite (+ SoftwareApplication) JSON-LD for brand entity signals.
 * Renders a single application/ld+json script (safe for static export).
 */
export function JsonLd({ extra = [] }: JsonLdProps) {
  const organization = {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    alternateName: ["Blyp App", "blyp.world"],
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/brand/blyp-app-tile-512.png`,
      width: 512,
      height: 512,
    },
    email: CONTACT_EMAIL,
    sameAs: SAME_AS,
    description: DEFAULT_DESCRIPTION,
  };

  const website = {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    publisher: { "@id": `${SITE_URL}/#organization` },
    inLanguage: "en",
  };

  const software = {
    "@type": ["SoftwareApplication", "MobileApplication"],
    "@id": `${SITE_URL}/#app`,
    name: SITE_NAME,
    operatingSystem: "Android",
    applicationCategory: "SocialNetworkingApplication",
    description: DEFAULT_DESCRIPTION,
    url: `${SITE_URL}/download/`,
    image: `${SITE_URL}${OG_IMAGE_PATH}`,
    downloadUrl: PLAY_STORE_URL,
    installUrl: PLAY_STORE_URL,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "GBP",
    },
    publisher: { "@id": `${SITE_URL}/#organization` },
    // Play package id as identifier (helpful for Google’s app ↔ site association)
    identifier: ANDROID_PACKAGE_ID,
  };

  const graph = [organization, website, software, ...extra];

  const payload = {
    "@context": "https://schema.org",
    "@graph": graph,
  };

  return (
    <script
      type="application/ld+json"
      // JSON-LD must be raw JSON text; dangerouslySetInnerHTML is the Next pattern.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  );
}
