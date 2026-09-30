"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, CirclePlay, CircleHelp } from "lucide-react";
import { explainer } from "@/features/help/explainers";
import { audienceForPath, helpForRoute } from "@/features/help/routes";
import { helpVideo, formatDuration } from "@/features/help/videos";
import type { Explainer, HelpAudience } from "@/features/help/types";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { KitRoot } from "@/components/kit/kit";
import { ExplainerView } from "@/components/help/explainer-view";
import { HelpVideoPlayer } from "@/components/help/video-player";
import { listenForHowTo } from "@/components/help/how-to-events";

/**
 * The "How to" button every studio, couple and crew screen carries, and the
 * popup it opens: the screen's written guide, its video when it has one, and
 * the other guides for the same screen.
 *
 * It also answers `?howto=<id>` in the URL — so an email, a support reply or
 * Cue can link straight to a guide — and requests from `openHowTo()`, which
 * is how a glossary word's "Learn more" opens the guide behind it.
 */
export function HowToButton({ variant }: { variant: "topbar" | "kit" }) {
  const pathname = usePathname();
  const audience: HelpAudience = audienceForPath(pathname) ?? "studio";
  const help = useMemo(() => helpForRoute(pathname, audience), [pathname, audience]);
  const [openId, setOpenId] = useState<string | null>(null);

  // `?howto=<id>` opens the guide on arrival. The parameter comes off the URL
  // once read, so closing the popup doesn't leave a link that reopens it.
  // Read from the location rather than useSearchParams, which would make
  // every page under the shell opt out of static rendering.
  useEffect(() => {
    const url = new URL(window.location.href);
    const linked = url.searchParams.get("howto");
    if (!linked) return;
    if (explainer(linked)) queueMicrotask(() => setOpenId(linked));
    url.searchParams.delete("howto");
    window.history.replaceState(window.history.state, "", url);
  }, [pathname]);

  useEffect(
    () =>
      listenForHowTo((id) => {
        if (explainer(id)) setOpenId(id);
      }),
    [],
  );

  const close = useCallback(() => setOpenId(null), []);
  const guide = openId ? explainer(openId) : undefined;
  // What's listed under the guide: this screen's other guides, less the one open.
  const related = [help.primary, ...help.related].filter((item) => item.id !== guide?.id);

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={variant === "kit" ? "How to use this screen" : undefined}
        className={variant === "kit" ? "kit-icon-button how-to-trigger" : "how-to-trigger"}
        onClick={() => setOpenId(help.primary.id)}
        type="button"
      >
        <CircleHelp aria-hidden="true" size={variant === "kit" ? 22 : 16} />
        {variant === "topbar" ? <span>How to</span> : null}
      </button>
      {guide ? (
        <SheetDialog label={guide.title} onClose={close} open width="wide">
          {audience === "studio" ? (
            <HowToPanel guide={guide} onPick={setOpenId} related={related} />
          ) : (
            <KitRoot className="kit-embed kit-sheet">
              <HowToPanel guide={guide} onPick={setOpenId} related={related} />
            </KitRoot>
          )}
        </SheetDialog>
      ) : null}
    </>
  );
}

function HowToPanel({
  guide,
  related,
  onPick,
}: {
  guide: Explainer;
  related: Explainer[];
  onPick: (id: string) => void;
}) {
  const allGuides = guide.audience === "studio" ? "/studio/help#guides" : "/how-to";
  return (
    <article className="how-to-panel">
      <header className="how-to-head">
        <p className="how-to-eyebrow">How to</p>
        <h2>{guide.title}</h2>
      </header>
      <HelpVideoPlayer id={guide.video} />
      <ExplainerView guide={guide} />
      {related.length ? (
        <section className="how-to-related" aria-label="Other guides">
          <h3>Also on this screen</h3>
          <ul>
            {related.map((item) => (
              <li key={item.id}>
                <button onClick={() => onPick(item.id)} type="button">
                  <GuideLabel guide={item} />
                  <ArrowRight aria-hidden="true" size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <footer className="how-to-foot">
        <Link
          href={allGuides}
          {...(guide.audience === "studio" ? {} : { target: "_blank", rel: "noopener noreferrer" })}
        >
          All guides <ArrowRight aria-hidden="true" size={14} />
        </Link>
      </footer>
    </article>
  );
}

/** A guide's title, with ▶ and its length when it has a video. */
export function GuideLabel({ guide }: { guide: Explainer }) {
  const video = helpVideo(guide.video);
  return (
    <span className="how-to-guide-label">
      <strong>{guide.title}</strong>
      {video ? (
        <small>
          <CirclePlay aria-hidden="true" size={13} /> {formatDuration(video.durationSec)}
        </small>
      ) : null}
    </span>
  );
}
