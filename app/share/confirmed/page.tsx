import type { Metadata } from "next";

export const metadata: Metadata = { title: "Confirmed" };

/**
 * Where a vendor lands after confirming a run of show. A static segment, so it
 * wins over the `[token]` route rather than being read as a token.
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
      </article>
    </main>
  );
}
