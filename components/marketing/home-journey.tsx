"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { JourneyFilmButton } from "@/components/help/journey-film";
import { formatDuration, helpVideo } from "@/features/help/videos";
import { journeyStageHref, type JourneyStop } from "@/features/journey/expected-timeline";
import { marketingMedia } from "@/features/marketing/media";
import { homeJourneyStops } from "@/features/marketing/journey-stops";

/**
 * "One wedding, start to finish": the film's ribbon of six stops, each a
 * still of its chapter that opens the film at that moment. Without a
 * published film each stop is a link to its stage on the journey page, and
 * the stills are left out.
 */
const WHAT_HAPPENS: Record<JourneyStop, string> = {
  inquiry: "It becomes a job the moment it arrives, with your reply already written.",
  booked: "Proposal accepted, agreement signed online, retainer paid. Then your crew get their offers.",
  planning: "The couple's forms fill in from what they've already told you, and the run of show is drafted.",
  wedding: "The week of: the couple's note and the crew's call times go out without you writing them.",
  gallery: "Release the gallery. The review ask and album reminders run themselves.",
  closed: "When the balance, gallery and crew all check out, the job closes.",
};

export function HomeJourney() {
  const stops = homeJourneyStops();
  return (
    <ol className="mk-stops">
      {stops.map((stop, index) => {
        // Gallery and Closed share the last chapter; the gallery loop's own
        // poster tells them apart once it's uploaded.
        const posters = [
          stop.id === "gallery" ? marketingMedia("gallery")?.posterSrc : null,
          helpVideo(stop.chapterId)?.posterSrc,
        ].filter((src): src is string => Boolean(src));
        return (
          <li className="mk-stop" key={stop.id}>
            <JourneyFilmButton
              className="mk-stop-link"
              href={journeyStageHref(stop.stageId)}
              label={`${stop.label}: watch this part of the film`}
              startAt={stop.startAt}
            >
              <StopStill posters={posters} startAt={stop.startAt} />
              <span className="mk-stop-label">
                <span aria-hidden="true" className="mk-stop-num">
                  {index + 1}
                </span>
                {stop.label}
              </span>
            </JourneyFilmButton>
            <p>{WHAT_HAPPENS[stop.id]}</p>
          </li>
        );
      })}
    </ol>
  );
}

function StopStill({ posters, startAt }: { posters: string[]; startAt: number }) {
  const [index, setIndex] = useState(0);
  const src = posters[index];
  if (!src) return null;
  return (
    <span className="mk-stop-still">
      {/* eslint-disable-next-line @next/next/no-img-element -- a poster on the public media host */}
      <img alt="" decoding="async" loading="lazy" onError={() => setIndex((at) => at + 1)} src={src} />
      <span aria-hidden="true" className="journey-film-play">
        <Play size={16} />
      </span>
      <span aria-hidden="true" className="journey-film-length">
        {`From ${formatDuration(startAt)}`}
      </span>
    </span>
  );
}
