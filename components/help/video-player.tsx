"use client";

import { useRef } from "react";
import { helpVideo, formatDuration } from "@/features/help/videos";

/**
 * A how-to video: poster, captions on by default, and chapters that jump to
 * their moment. It never autoplays — many people open a guide for the text.
 */
export function HelpVideoPlayer({ id }: { id: string | undefined }) {
  const video = helpVideo(id);
  const element = useRef<HTMLVideoElement>(null);
  if (!video) return null;
  return (
    <figure className="help-video" data-orientation={video.orientation}>
      {/* crossOrigin: captions from another origin load only with CORS. */}
      <video
        controls
        crossOrigin="anonymous"
        playsInline
        poster={video.posterSrc}
        preload="none"
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
