"use client";

import { useEffect, useRef, useState } from "react";
import { marketingMedia, type MarketingLoopId } from "@/features/marketing/media";

/**
 * A short silent clip of the product: muted, looping, inline, no controls —
 * the website's way of showing a screen doing its job rather than describing
 * it (features/marketing/media.ts names them).
 *
 * It degrades in steps, and never to a broken box:
 *   1. the loop plays once it's on screen (nothing downloads before that);
 *   2. reduced motion, or `still="phones"` on a phone, shows the poster only;
 *   3. a loop that fails to load leaves its poster;
 *   4. a poster that fails falls back to `fallbackPoster` (usually a chapter
 *      still of the film), and with neither the component renders nothing.
 *
 * The media check runs after hydration, so an image that failed before React
 * attached its handler is caught too (`complete && naturalWidth === 0`).
 */
export function LoopVideo({
  id,
  fallbackPoster = null,
  still = "never",
  className,
}: {
  id: MarketingLoopId;
  fallbackPoster?: string | null;
  /** "phones": a still poster at ≤640px, where a loop costs data and battery. */
  still?: "never" | "phones";
  className?: string;
}) {
  const clip = marketingMedia(id);
  const posters = [clip?.posterSrc, fallbackPoster].filter((src): src is string => Boolean(src));
  const [posterIndex, setPosterIndex] = useState(0);
  const [videoFailed, setVideoFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [inView, setInView] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const poster = posters[posterIndex] ?? null;

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const phone = window.matchMedia("(max-width: 640px)");
    const decide = () => setMotionAllowed(!reduce.matches && !(still === "phones" && phone.matches));
    decide();
    reduce.addEventListener("change", decide);
    phone.addEventListener("change", decide);
    return () => {
      reduce.removeEventListener("change", decide);
      phone.removeEventListener("change", decide);
    };
  }, [still]);

  useEffect(() => {
    const element = frame.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A poster that failed before hydration never fired our onError.
  useEffect(() => {
    const element = image.current;
    if (element && element.complete && element.naturalWidth === 0) setPosterIndex((index) => index + 1);
  }, [poster]);

  const showVideo = Boolean(clip) && motionAllowed && inView && !videoFailed;
  // No still left and no loop on its way: nothing, rather than an empty frame.
  if (!poster && !showVideo) return null;

  return (
    <div
      className={["mk-loop", className].filter(Boolean).join(" ")}
      data-playing={playing ? "true" : undefined}
      ref={frame}
    >
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element -- a poster on the public media host
        <img
          alt={clip?.alt ?? ""}
          decoding="async"
          loading="lazy"
          onError={() => setPosterIndex((index) => index + 1)}
          ref={image}
          src={poster}
        />
      ) : null}
      {showVideo && clip ? (
        <video
          aria-hidden="true"
          autoPlay
          disablePictureInPicture
          loop
          muted
          onError={() => {
            setVideoFailed(true);
            setPlaying(false);
          }}
          onPlaying={() => setPlaying(true)}
          playsInline
          preload="metadata"
          ref={(element) => {
            // `muted` must be a property before play() for autoplay to be allowed.
            if (element) element.muted = true;
          }}
          src={clip.src}
          tabIndex={-1}
        />
      ) : null}
    </div>
  );
}
