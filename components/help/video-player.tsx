"use client";

import { useEffect, useRef } from "react";
import { helpVideo, formatDuration } from "@/features/help/videos";

/**
 * A how-to video: poster, captions on by default, and chapters that jump to
 * their moment. It never autoplays on a page — many people open a guide for
 * the text.
 *
 * `autoPlay` is for a player someone asked for by pressing Watch (the
 * journey film's dialog): the press is the user's gesture, so it starts with
 * sound where the browser allows it, and otherwise waits on its own play
 * button — one tap either way.
 *
 * `startFromQuery` honours `?t=<seconds>`, so the film's chapter links in the
 * page's structured data (VideoObject → Clip) open at their moment. It only
 * cues the film there; it does not start playing.
 */
export function HelpVideoPlayer({
  id,
  autoPlay = false,
  startFromQuery = false,
}: {
  id: string | undefined;
  autoPlay?: boolean;
  startFromQuery?: boolean;
}) {
  const video = helpVideo(id);
  const element = useRef<HTMLVideoElement>(null);
  const src = video?.src;

  useEffect(() => {
    const player = element.current;
    if (!player || !src) return;
    if (startFromQuery) {
      const at = Number(new URLSearchParams(window.location.search).get("t"));
      if (Number.isFinite(at) && at > 0) {
        // A media fragment cues the start without loading the whole file first.
        player.src = `${src}#t=${Math.floor(at)}`;
        player.scrollIntoView({ block: "center" });
      }
    }
    if (autoPlay) void player.play().catch(() => undefined);
  }, [autoPlay, startFromQuery, src]);

  if (!video) return null;
  return (
    <figure className="help-video" data-orientation={video.orientation}>
      {/* crossOrigin: captions from another origin load only with CORS. */}
      <video
        controls
        crossOrigin="anonymous"
        playsInline
        poster={video.posterSrc}
        preload={autoPlay ? "auto" : "none"}
        ref={element}
        src={video.src}
      >
        <track default kind="captions" label="English" src={video.captionsSrc} srcLang="en" />
      </video>
      {video.chapters.length > 1 ? (
        <figcaption>
          <ol className="help-video-chapters">
            {video.chapters.map((chapter) => (
              <li key={chapter.at}>
                <button
                  onClick={() => {
                    const player = element.current;
                    if (!player) return;
                    player.currentTime = chapter.at;
                    void player.play().catch(() => undefined);
                  }}
                  type="button"
                >
                  <span>{formatDuration(chapter.at)}</span> {chapter.title}
                </button>
              </li>
            ))}
          </ol>
        </figcaption>
      ) : null}
    </figure>
  );
}
