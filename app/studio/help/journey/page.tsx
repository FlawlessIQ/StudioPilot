import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WeddingJourney } from "@/components/help/wedding-journey";
import { PhotoStudioOnly } from "@/components/help/photo-studio-only";

export const metadata: Metadata = { title: "A wedding, start to finish" };

export default function WeddingJourneyPage() {
  return (
    <AppShell active="Help & guides">
      <div className="post-event-page help-page journey-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Help &amp; guides</p>
            <h1>A wedding, start to finish</h1>
            <p>
              What happens over the 12 to 18 months of one wedding: what StudioCue does by itself,
              what waits for your yes, and what your couple and your crew see along the way.
            </p>
          </div>
          <Link className="button button-light" href="/studio/help">
            <ArrowLeft aria-hidden="true" /> Back to help
          </Link>
        </header>
        <PhotoStudioOnly>
          <WeddingJourney />
        </PhotoStudioOnly>
      </div>
    </AppShell>
  );
}
