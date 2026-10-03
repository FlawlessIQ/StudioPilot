"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { marketingMedia } from "@/features/marketing/media";

/**
 * The minute-long teaser beside "Start your 14-day trial" (plan A1): the card
 * wall is the biggest drop-off, so it shows what's on the other side of it.
 *
 * Voiced, so it never autoplays: a poster and a play button, then the player
 * with captions on and its own controls. It disappears rather than showing a
 * broken box — with no media base, or if the poster or the film fails to load
 * (checked after hydration too, for a poster that failed before React did).
 */
export function TrialTeaser() {
  const clip = marketingMedia("teaser");
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const element = image.current;
    if (element && element.complete && element.naturalWidth === 0) setFailed(true);
  }, []);

  if (!clip || failed) return null;
  return (
    <section aria-labelledby="trial-teaser-title" className="panel trial-teaser">
      <div className="trial-teaser-media">
        {playing ? (
          // The press is the gesture, so it starts with sound where allowed.
          <video
            autoPlay
            controls
            crossOrigin="anonymous"
            onError={() => setFailed(true)}
            playsInline
            poster={clip.posterSrc}
            src={clip.src}
          >
            {clip.captionsSrc ? (
              <track default kind="captions" label="English" src={clip.captionsSrc} srcLang="en" />
            ) : null}
          </video>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a poster on the public media host */}
            <img alt="" onError={() => setFailed(true)} ref={image} src={clip.posterSrc} />
            <button aria-label="Play: what the next 14 days look like" className="trial-teaser-play" onClick={() => setPlaying(true)} type="button">
              <span aria-hidden="true" className="journey-film-play">
                <Play size={22} />
              </span>
            </button>
          </>
        )}
      </div>
      <div className="trial-teaser-copy">
        <h2 id="trial-teaser-title">What the next 14 days look like</h2>
        <p>
          About a minute of StudioCue running a job for you: every step prepared, and every one
          waiting for your yes.
        </p>
        <p>Your card starts the trial. Nothing is charged for 14 days.</p>
      </div>
    </section>
  );
}
