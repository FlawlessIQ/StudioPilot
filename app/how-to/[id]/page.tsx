import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { ExplainerView } from "@/components/help/explainer-view";
import { HelpVideoPlayer } from "@/components/help/video-player";
import { EXPLAINERS, explainer } from "@/features/help/explainers";
import { HELP_AUDIENCE_LABELS } from "@/features/help/types";
import { helpVideo } from "@/features/help/videos";
import { SITE_URL } from "@/lib/site";

export function generateStaticParams() {
  return EXPLAINERS.map((guide) => ({ id: guide.id }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const guide = explainer((await params).id);
  if (!guide) return {};
  return {
    title: `${guide.title} · How to`,
    description: guide.summary,
    alternates: { canonical: `/how-to/${guide.id}` },
  };
}

export default async function HowToGuidePage({ params }: { params: Promise<{ id: string }> }) {
  const guide = explainer((await params).id);
  if (!guide) notFound();
  const video = helpVideo(guide.video);
  const others = EXPLAINERS.filter((item) => item.audience === guide.audience && item.id !== guide.id);
  return (
    <MarketingLayout
      description={guide.summary}
      eyebrow={`How to · ${HELP_AUDIENCE_LABELS[guide.audience]}`}
      hero="plain"
      title={guide.title}
    >
      <article className="how-to-article">
        <HelpVideoPlayer id={guide.video} />
        <ExplainerView guide={guide} headingLevel={2} />
        {others.length ? (
          <nav aria-label="More guides" className="how-to-article-more">
            <h2>More guides</h2>
            <ul>
              {others.map((item) => (
                <li key={item.id}>
                  <Link href={`/how-to/${item.id}`}>
                    {item.title} <ArrowRight aria-hidden="true" size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <Link className="how-to-article-back" href="/how-to">
          <ArrowLeft aria-hidden="true" size={14} /> All guides
        </Link>
      </article>
      {video ? (
        <script
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "VideoObject",
              name: guide.title,
              description: guide.summary,
              thumbnailUrl: video.posterSrc,
              contentUrl: video.src,
              uploadDate: video.recordedAt,
              duration: `PT${Math.floor(video.durationSec / 60)}M${Math.round(video.durationSec % 60)}S`,
              url: `${SITE_URL}/how-to/${guide.id}`,
            }).replace(/</g, "\\u003c"),
          }}
          type="application/ld+json"
        />
      ) : null}
    </MarketingLayout>
  );
}
