import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { GuideLibrary } from "@/components/help/guide-library";
import { EXPLAINERS } from "@/features/help/explainers";
import { HELP_AUDIENCE_LABELS, type HelpAudience } from "@/features/help/types";
import { marketingMetadata } from "@/features/marketing/metadata";

export const metadata = marketingMetadata({
  title: "How to use StudioCue",
  description:
    "Short guides to every step in StudioCue — for studios running their weddings, for couples in their portal, and for crew on the day.",
  path: "/how-to",
  og: "how-to",
});

const AUDIENCES: Array<{ audience: HelpAudience; intro: string }> = [
  { audience: "studio", intro: "Running your studio, from the first inquiry to the final gallery." },
  { audience: "couple", intro: "For couples: your portal, from booking to your photos." },
  { audience: "crew", intro: "For photographers and assistants working for a studio." },
];

export default function HowToPage() {
  return (
    <MarketingLayout
      description="Short, step-by-step guides to everything StudioCue does. The same guides are one tap away on every screen inside the product."
      eyebrow="Guides"
      hero="plain"
      title="How to use StudioCue"
    >
      <div className="how-to-public">
        <Link className="how-to-public-glossary" href="/how-to/wedding-journey">
          <span>
            <strong>A wedding, start to finish</strong>
            <small>One wedding from inquiry to closed: what runs by itself, what you approve, and what your couple and crew see.</small>
          </span>
          <ArrowRight aria-hidden="true" />
        </Link>
        {AUDIENCES.filter(({ audience }) => EXPLAINERS.some((guide) => guide.audience === audience)).map(
          ({ audience, intro }) => (
            <section className="how-to-public-section" id={audience} key={audience}>
              <h2>{HELP_AUDIENCE_LABELS[audience]}</h2>
              <p>{intro}</p>
              <GuideLibrary audience={audience} />
            </section>
          ),
        )}
        <Link className="how-to-public-glossary" href="/how-to/glossary">
          <span>
            <strong>Words to know</strong>
            <small>Readiness, the booking gate, retainers and the rest — each in a sentence.</small>
          </span>
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </MarketingLayout>
  );
}
