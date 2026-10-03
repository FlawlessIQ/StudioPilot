"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { JourneyFilmButton } from "@/components/help/journey-film";
import { formatDuration, helpVideo } from "@/features/help/videos";
import {
  EXPECTED_TIMELINE,
  JOURNEY_CHAPTER_IDS,
  JOURNEY_FILM_ID,
  JOURNEY_PAGE,
  journeyStageHref,
  type JourneyChapterId,
} from "@/features/journey/expected-timeline";

/**
 * One chapter of the journey film as a still: press it and the film opens at
 * that chapter. Without JavaScript it links to the chapter's stage on the
 * journey page. Without the film (no media base) it is nothing; a still that
 * fails to load takes the whole figure with it.
 */
export function FilmMoment({ chapterId, caption }: { chapterId: JourneyChapterId; caption: string }) {
  const [failed, setFailed] = useState(false);
  const film = helpVideo(JOURNEY_FILM_ID);
  const chapter = helpVideo(chapterId);
  if (!film || !chapter || failed) return null;
  const startAt = film.chapters[JOURNEY_CHAPTER_IDS.indexOf(chapterId)]?.at ?? 0;
  const stage = EXPECTED_TIMELINE.find((candidate) => candidate.video === chapterId);
  return (
    <figure className="mk-film-moment">
      <JourneyFilmButton
        className="mk-stop-link"
        href={stage ? journeyStageHref(stage.id) : JOURNEY_PAGE}
        label={`${caption} Watch this part of the film.`}
        startAt={startAt}
      >
        <span className="mk-stop-still">
          {/* eslint-disable-next-line @next/next/no-img-element -- a poster on the public media host */}
          <img alt="" decoding="async" loading="lazy" onError={() => setFailed(true)} src={chapter.posterSrc} />
          <span aria-hidden="true" className="journey-film-play">
            <Play size={16} />
          </span>
          <span aria-hidden="true" className="journey-film-length">
            {`From ${formatDuration(startAt)}`}
          </span>
        </span>
      </JourneyFilmButton>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
