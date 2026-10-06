import { mediaUrl } from "@/features/help/videos";

/**
 * The website's own clips (docs/marketing-video-onboarding-plan-2026-10-02.md
 * §1): short silent loops cut from the journey film, and the voiced teaser for
 * the trial checkout. They sit in the same public media folder as the how-to
 * videos (NEXT_PUBLIC_HOW_TO_MEDIA_BASE), named by the cutting pipeline, so
 * one typed map is the whole contract between it and the site.
 *
 * Unlike the how-to manifest, nothing here proves a file was uploaded: a name
 * is a promise. Every component that plays one must therefore survive a
 * missing file — LoopVideo falls back to the poster, then to a stand-in still,
 * then to nothing; the teaser hides itself — so the page never shows a broken
 * box (tests/marketing-claims.test.ts checks both components handle onError).
 */
type LoopEntry = {
  kind: "loop";
  file: string;
  poster: string;
  /** What the clip shows, for the people who can't see it. */
  alt: string;
};
type VoicedEntry = {
  kind: "voiced";
  file: string;
  poster: string;
  captions: string;
  alt: string;
};

export const MARKETING_MEDIA = {
  "hero-loop": {
    kind: "loop",
    file: "mk-hero-loop.v1.mp4",
    poster: "mk-hero-loop.v1.jpg",
    alt: "A couple's inquiry arrives, StudioCue drafts the reply on Today, the studio presses Send, and it lands on the couple's phone.",
  },
  today: {
    kind: "loop",
    file: "mk-loop-today.v1.mp4",
    poster: "mk-loop-today.v1.jpg",
    alt: "Today in StudioCue: the next steps for each job, already prepared and waiting for a yes.",
  },
  proposal: {
    kind: "loop",
    file: "mk-loop-proposal.v1.mp4",
    poster: "mk-loop-proposal.v1.jpg",
    alt: "A proposal drafted from the studio's package, then accepted by the client.",
  },
  sign: {
    kind: "loop",
    file: "mk-loop-sign.v1.mp4",
    poster: "mk-loop-sign.v1.jpg",
    alt: "The agreement, written from the accepted proposal, signed online.",
  },
  crew: {
    kind: "loop",
    file: "mk-loop-crew.v1.mp4",
    poster: "mk-loop-crew.v1.jpg",
    alt: "A crew offer accepted on a second shooter's phone.",
  },
  timeline: {
    kind: "loop",
    file: "mk-loop-timeline.v1.mp4",
    poster: "mk-loop-timeline.v1.jpg",
    alt: "A drafted run of show, approved by the studio.",
  },
  gallery: {
    kind: "loop",
    file: "mk-loop-gallery.v1.mp4",
    poster: "mk-loop-gallery.v1.jpg",
    alt: "The gallery released to the client's portal.",
  },
  teaser: {
    kind: "voiced",
    file: "mk-teaser.v2.mp4",
    poster: "mk-teaser.v2.jpg",
    captions: "mk-teaser.v2.vtt",
    alt: "What StudioCue does over a wedding, in about a minute.",
  },
} as const satisfies Record<string, LoopEntry | VoicedEntry>;

export type MarketingMediaId = keyof typeof MARKETING_MEDIA;
export type MarketingLoopId = {
  [K in MarketingMediaId]: (typeof MARKETING_MEDIA)[K]["kind"] extends "loop" ? K : never;
}[MarketingMediaId];

export type MarketingClip = {
  id: MarketingMediaId;
  kind: "loop" | "voiced";
  src: string;
  posterSrc: string;
  /** Voiced clips only. */
  captionsSrc: string | null;
  alt: string;
};

/** A clip's URLs, or null where there is no media base (local dev, previews). */
export function marketingMedia(
  id: MarketingMediaId,
  base = process.env.NEXT_PUBLIC_HOW_TO_MEDIA_BASE,
): MarketingClip | null {
  if (!base) return null;
  const entry: LoopEntry | VoicedEntry = MARKETING_MEDIA[id];
  return {
    id,
    kind: entry.kind,
    src: mediaUrl(base, entry.file),
    posterSrc: mediaUrl(base, entry.poster),
    captionsSrc: entry.kind === "voiced" ? mediaUrl(base, entry.captions) : null,
    alt: entry.alt,
  };
}

/**
 * Narrated films the website opens in a dialog, published through
 * scripts/how-to/publish.ts like the how-to videos (so they live in
 * features/help/video-manifest.json) but belonging to no guide: "One
 * Saturday" (scripts/how-to/one-saturday.ts).
 */
export const MARKETING_FILM_IDS = ["one-saturday"] as const;
