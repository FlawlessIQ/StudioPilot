import type { Metadata } from "next";

/**
 * Each marketing page's own social card (public/og/<name>.png, 1200×630,
 * made by scripts/marketing/og-images.ts from stills of the journey film).
 *
 * Next.js replaces a parent's `openGraph` and `twitter` wholesale rather than
 * merging them, so a page that sets only its image loses the title and
 * description the root layout gave it. This sets all of them together.
 */
export const OG_IMAGES = [
  "home",
  "features",
  "pricing",
  "integrations",
  "wedding-photographers",
  "corporate",
  "sports",
  "for-crew",
  "for-clients",
  "how-to",
  "wedding-journey",
] as const;
export type OgImage = (typeof OG_IMAGES)[number];

export function marketingMetadata({
  title,
  socialTitle,
  description,
  path,
  og,
  absoluteTitle = false,
}: {
  /** The tab title; the root layout's template adds " · StudioCue". */
  title: string;
  /** The card's headline, when it should read differently from the tab. */
  socialTitle?: string;
  description: string;
  path: string;
  og: OgImage;
  /** The homepage names itself in full, without the template. */
  absoluteTitle?: boolean;
}): Metadata {
  const image = { url: `/og/${og}.png`, width: 1200, height: 630, alt: socialTitle ?? title };
  const cardTitle = socialTitle ?? (absoluteTitle ? title : `${title} · StudioCue`);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: cardTitle,
      description,
      url: path,
      siteName: "StudioCue",
      type: "website",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: cardTitle,
      description,
      images: [image.url],
    },
  };
}
