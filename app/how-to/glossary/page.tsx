import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { GlossaryList } from "@/components/help/guide-library";
import { HELP_AUDIENCE_LABELS, type HelpAudience } from "@/features/help/types";

export const metadata: Metadata = {
  title: "Words to know · How to",
  description: "The words StudioCue uses — readiness, the booking gate, retainers and more — each explained in a sentence.",
  alternates: { canonical: "/how-to/glossary" },
};

const AUDIENCES: HelpAudience[] = ["studio", "couple", "crew"];

export default function GlossaryPage() {
  return (
    <MarketingLayout
      description="The words StudioCue uses, each in a sentence or two. Inside the product, the same explanations sit behind the ⓘ beside each word."
      eyebrow="How to"
      hero="plain"
      title="Words to know"
    >
      <article className="how-to-article">
        {AUDIENCES.map((audience) => (
          <section className="how-to-public-section" id={audience} key={audience}>
            <h2>{HELP_AUDIENCE_LABELS[audience]}</h2>
            <GlossaryList audience={audience} />
          </section>
        ))}
        <Link className="how-to-article-back" href="/how-to">
          <ArrowLeft aria-hidden="true" size={14} /> All guides
        </Link>
      </article>
    </MarketingLayout>
  );
}
