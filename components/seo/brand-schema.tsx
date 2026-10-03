import { planCards } from "@/config/saas-plans";
import { SITE_URL } from "@/lib/site";

/**
 * Who StudioCue is, for search engines: one Organization, one WebSite and
 * the SoftwareApplication, linked by @id, on the home page.
 *
 * This is what lets a search for "StudioCue" — or "Studio Cue", the way
 * people say it, against a page of audio-studio cue systems — resolve to
 * this site, show "StudioCue" as the site name, and use the mark as its logo
 * (Google: site names and Organization structured data).
 *
 * Only facts. No ratings or reviews until there are real ones to cite, and
 * `sameAs` lists only profiles that exist: add each one here as it's made
 * (YouTube, LinkedIn, Instagram, Product Hunt…).
 */
export const BRAND_SAME_AS: string[] = [];

export const BRAND_DESCRIPTION =
  "StudioCue (also written Studio Cue) is software for photography studios that runs every wedding and event from the first inquiry to the final gallery. It drafts each next step — the reply, the proposal, the agreement, the timeline, the crew offer — for the studio to approve, and gives the couple and the crew their own app.";

export function brandSchema() {
  const prices = planCards.map((plan) => plan.monthlyCents / 100);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "StudioCue",
        alternateName: ["Studio Cue", "StudioCue app"],
        url: `${SITE_URL}/`,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_URL}/brand/icon-512.png`,
          width: 512,
          height: 512,
        },
        description: BRAND_DESCRIPTION,
        ...(BRAND_SAME_AS.length ? { sameAs: BRAND_SAME_AS } : {}),
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          url: `${SITE_URL}/support`,
          availableLanguage: "English",
        },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: "StudioCue",
        alternateName: ["Studio Cue", "studio-cue.com"],
        url: `${SITE_URL}/`,
        inLanguage: "en-US",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: "StudioCue",
        alternateName: "Studio Cue",
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Photography studio management",
        operatingSystem: "Web, iOS, Android (browser)",
        url: `${SITE_URL}/`,
        description: BRAND_DESCRIPTION,
        publisher: { "@id": `${SITE_URL}/#organization` },
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "USD",
          lowPrice: Math.min(...prices).toFixed(2),
          highPrice: Math.max(...prices).toFixed(2),
          offerCount: prices.length,
        },
      },
    ],
  };
}

/** The JSON-LD script tag for the home page. */
export function BrandSchema() {
  return (
    <script
      type="application/ld+json"
      // Built from constants above, never user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(brandSchema()).replace(/</g, "\\u003c") }}
    />
  );
}
