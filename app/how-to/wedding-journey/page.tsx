import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { WeddingJourney } from "@/components/help/wedding-journey";
import { helpVideo, isoDuration } from "@/features/help/videos";
import { JOURNEY_FILM_ID, JOURNEY_PAGE } from "@/features/journey/expected-timeline";
import { setupQuestionCount } from "@/features/today/setup-gaps";
import { SITE_URL } from "@/lib/site";

const DESCRIPTION =
  "One wedding from the first inquiry to the final gallery: what StudioCue does by itself, what the studio approves, and what the couple and crew see at each stage.";

export const metadata: Metadata = {
  title: "A wedding, start to finish · How to",
  description: DESCRIPTION,
  alternates: { canonical: JOURNEY_PAGE },
};

const PAGE_URL = `${SITE_URL}${JOURNEY_PAGE}`;

/**
 * The film as a VideoObject, with one Clip per chapter so search can show its
 * key moments. Each Clip's url opens this page with the film cued at that
 * chapter (`?t=`, HelpVideoPlayer's startFromQuery).
 */
function filmStructuredData(): string | null {
  const film = helpVideo(JOURNEY_FILM_ID);
  if (!film) return null;
  const starts = film.chapters.map((chapter) => Math.floor(chapter.at));
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: "A wedding, start to finish",
    description: DESCRIPTION,
    thumbnailUrl: film.posterSrc,
    contentUrl: film.src,
    uploadDate: film.recordedAt,
    duration: isoDuration(film.durationSec),
    url: PAGE_URL,
    hasPart: film.chapters.map((chapter, index) => ({
      "@type": "Clip",
      name: chapter.title,
      startOffset: starts[index],
      endOffset: starts[index + 1] ?? Math.floor(film.durationSec),
      url: `${PAGE_URL}?t=${starts[index]}`,
    })),
  }).replace(/</g, "\\u003c");
}

export default function WeddingJourneyPublicPage() {
  const structuredData = filmStructuredData();
  return (
    <MarketingLayout
      description="One wedding from the first inquiry to the final gallery: what StudioCue does by itself, what you approve with a tap, and what your couple and your crew see at each stage."
      eyebrow="How to · Studios"
      hero="plain"
      title="A wedding, start to finish"
    >
      <article className="how-to-public">
        <WeddingJourney />
        <aside className="how-to-public-glossary journey-public-cta">
          <span>
            <strong>Run your next wedding this way</strong>
            <small>{`Start a 14-day trial. Setup is ${setupQuestionCount()} questions, most answered in a tap.`}</small>
          </span>
          <Link className="button button-dark" href="/auth/register">
            Start your free trial <ArrowRight aria-hidden="true" />
          </Link>
        </aside>
        <Link className="how-to-article-back" href="/how-to">
          <ArrowLeft aria-hidden="true" size={14} /> All guides
        </Link>
      </article>
      {structuredData ? (
        <script dangerouslySetInnerHTML={{ __html: structuredData }} type="application/ld+json" />
      ) : null}
    </MarketingLayout>
  );
}
