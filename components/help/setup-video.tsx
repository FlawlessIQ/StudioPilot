"use client";

import { Play, X } from "lucide-react";
import { FilmButton, useDismissed } from "@/components/help/journey-film";
import { useWorkspace } from "@/features/auth/workspace-context";
import { helpVideo, formatMinutes, videoSuitsTrade } from "@/features/help/videos";

/**
 * "Set up your studio" (the setup how-to video, v5): a new studio watching
 * the questions get answered — kinds of work, the form link, call hours,
 * prices pasted and added, the starter agreement finished.
 *
 * Alex Knight paid, reached setup and left within a minute (2026-10-16); the
 * video was there only behind the top bar's How to. So it sits at the top of
 * setup as a card until the studio is under way (four answers) or hides it,
 * then as one line. It plays in the film's dialog, on a press, never by itself.
 * Only where the recording fits the studio (videoSuitsTrade: it shows a
 * photographer's setup).
 */
const VIDEO = "setup";
const GUIDE = "/how-to/setup";
const BLURB = "a new studio set up, from its first question to a saved agreement.";
const storageKey = (userId: string | null) => `studiocue.setupVideo.dismissed:${userId ?? "anon"}`;

/** Whether this studio is offered the setup video at all. */
export function useOffersSetupVideo(): boolean {
  const { tenantTrade } = useWorkspace();
  return Boolean(helpVideo(VIDEO)) && videoSuitsTrade(VIDEO, tenantTrade);
}

/** Setup's card while the studio is starting out, then one line. */
export function SetupVideoCard({ answered }: { answered: number }) {
  const { userId } = useWorkspace();
  const [dismissed, dismiss] = useDismissed(storageKey(userId));
  const offered = useOffersSetupVideo();
  const video = helpVideo(VIDEO);
  if (!offered || !video) return null;
  const length = formatMinutes(video.durationSec);
  if (dismissed || answered >= 4) {
    return (
      <FilmButton blurb={BLURB} className="setup-video-line" href={GUIDE} linkLabel="Read the guide" title="Set up your studio" videoId={VIDEO}>
        <Play aria-hidden="true" size={13} /> Watch how it&apos;s done · {length}
      </FilmButton>
    );
  }
  return (
    <section aria-label="Watch setup being done" className="setup-video-card">
      <FilmButton blurb={BLURB} className="setup-video-poster" href={GUIDE} linkLabel="Read the guide" title="Set up your studio" videoId={VIDEO}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a poster on the public media host */}
        <img alt="" loading="lazy" src={video.posterSrc} />
        <span aria-hidden="true" className="journey-film-play">
          <Play size={18} />
        </span>
        <span aria-hidden="true" className="journey-film-length">
          {length}
        </span>
      </FilmButton>
      <div className="setup-video-copy">
        <strong>Watch it done first</strong>
        <small>
          A new studio set up in {length}: prices pasted in and turned into packages, call hours in one tap, the
          agreement finished from a few questions.
        </small>
        <FilmButton blurb={BLURB} className="button button-light button-sm" href={GUIDE} linkLabel="Read the guide" title="Set up your studio" videoId={VIDEO}>
          <Play aria-hidden="true" size={14} /> Watch · {length}
        </FilmButton>
      </div>
      <button aria-label="Hide this" className="journey-today-dismiss" onClick={dismiss} type="button">
        <X size={15} />
      </button>
    </section>
  );
}

/** Today's setup card: the same video, as a link beside "Continue setup". */
export function SetupVideoLink() {
  const offered = useOffersSetupVideo();
  const video = helpVideo(VIDEO);
  if (!offered || !video) return null;
  return (
    <FilmButton blurb={BLURB} className="setup-answer-link" href={GUIDE} linkLabel="Read the guide" title="Set up your studio" videoId={VIDEO}>
      <Play aria-hidden="true" size={13} /> Watch how · {formatMinutes(video.durationSec)}
    </FilmButton>
  );
}
