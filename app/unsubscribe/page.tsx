import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Unsubscribe from StudioCue", robots: { index: false, follow: false } };

/**
 * Where the unsubscribe link in StudioCue's own sales mail lands
 * (app/api/public/unsubscribe). One button, so a mail scanner following the
 * link can't opt anyone out.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const done = params.done === "1";
  const failed = params.failed === "1" || (!done && (!params.e || !params.t));
  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <header>
        <Link href="/"><Logo /></Link>
      </header>
      <article>
        <p className="eyebrow">Email preferences</p>
        {done ? (
          <>
            <h1>You&apos;re unsubscribed</h1>
            <p>StudioCue won&apos;t email you about trying StudioCue again. Emails from the studios you work with aren&apos;t affected.</p>
          </>
        ) : failed ? (
          <>
            <h1>This link didn&apos;t work</h1>
            <p>
              {"Email "}
              <a href="mailto:support@studio-cue.com">support@studio-cue.com</a>
              {" from the address you'd like taken off, and we'll do it by hand."}
            </p>
          </>
        ) : (
          <>
            <h1>Stop emails about StudioCue?</h1>
            <p>You won&apos;t hear from StudioCue about trying it again. Emails from the studios you work with aren&apos;t affected.</p>
            <form action="/api/public/unsubscribe" method="post">
              <input name="e" type="hidden" value={params.e} />
              <input name="t" type="hidden" value={params.t} />
              <button className="button button-dark" type="submit">Unsubscribe</button>
            </form>
          </>
        )}
      </article>
    </main>
  );
}
