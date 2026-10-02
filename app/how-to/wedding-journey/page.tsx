import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { WeddingJourney } from "@/components/help/wedding-journey";

export const metadata: Metadata = {
  title: "A wedding, start to finish · How to",
  description:
    "One wedding from the first inquiry to the final gallery: what StudioCue does by itself, what the studio approves, and what the couple and crew see at each stage.",
  alternates: { canonical: "/how-to/wedding-journey" },
};

export default function WeddingJourneyPublicPage() {
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
            <small>Start a 14-day trial. Setup is six questions, most answered in a tap.</small>
          </span>
          <Link className="button button-dark" href="/auth/register">
            Start your free trial <ArrowRight aria-hidden="true" />
          </Link>
        </aside>
        <Link className="how-to-article-back" href="/how-to">
          <ArrowLeft aria-hidden="true" size={14} /> All guides
        </Link>
      </article>
    </MarketingLayout>
  );
}
