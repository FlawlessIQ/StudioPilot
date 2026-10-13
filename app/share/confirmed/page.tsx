import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Confirmed" };

/**
 * Where a vendor used to land after confirming a run of show; confirming now
 * returns them to their own timeline (/share/[token]?confirmed=1). Kept for an
 * old form or bookmark, with a way off it. A static segment, so it wins over
 * the `[token]` route rather than being read as a token.
 */
export default function RunOfShowConfirmedPage() {
  return (
    <main className="ds-root ros-share" data-ds-theme="emerald">
      <article className="ros-share-card">
        <p className="ros-eyebrow">Run of show</p>
        <h1>You&rsquo;re confirmed ✓</h1>
        <p className="ros-lead">
          Thanks — the studio has been notified that the timeline works for you.
          If anything changes on their end, they&rsquo;ll send you an updated
          link.
        </p>
        <p className="ros-lead">
          Your timeline link still opens the latest version. You can close this
          page, or <Link href="/">see what StudioCue does</Link>.
        </p>
      </article>
    </main>
  );
}
