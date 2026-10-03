import manifest from "@/features/help/video-manifest.json";
import {
  EXPECTED_TIMELINE,
  JOURNEY_CHAPTER_IDS,
  JOURNEY_FILM_ID,
  JOURNEY_STOPS,
  type JourneyChapterId,
  type JourneyStop,
} from "@/features/journey/expected-timeline";

/**
 * The homepage's "One wedding, start to finish": the film's six-stop ribbon
 * (Inquiry · Booked · Planning · Wedding · Gallery · Closed), each stop opening
 * the film at its own moment.
 *
 * Derived, not typed out: the stop's stage is the one named like it (else its
 * first), the stage's chapter comes from features/journey/expected-timeline.ts,
 * and the chapter's start from the film's own chapter list in the manifest — so
 * a re-cut film moves every thumbnail with it.
 *
 * Closed has no chapter of its own; the last chapter ends on it. It opens at
 * "Last, Wrap up checks…" (5:41 in journey.v1.vtt), not at the chapter start,
 * which is the day after the wedding.
 */
const CLOSED_AT_SEC = 341;

type FilmEntry = { durationSec: number; chapters: Array<{ at: number; title: string }> };
const FILM = (manifest as Record<string, FilmEntry>)[JOURNEY_FILM_ID];

export type HomeJourneyStop = {
  id: JourneyStop;
  label: string;
  /** The journey page's stage this stop links to without JavaScript. */
  stageId: string;
  /** Whose poster is the thumbnail. */
  chapterId: JourneyChapterId;
  /** Seconds into the film. */
  startAt: number;
};

export function homeJourneyStops(): HomeJourneyStop[] {
  let lastChapter: JourneyChapterId = JOURNEY_CHAPTER_IDS[0];
  return JOURNEY_STOPS.map((stop) => {
    const stages = EXPECTED_TIMELINE.filter((stage) => stage.stop === stop.id);
    const stage = stages.find((candidate) => candidate.id === stop.id) ?? stages[0];
    if (!stage) throw new Error(`No stage for the ${stop.id} stop`);
    const chapterId = stage.video ?? lastChapter;
    lastChapter = chapterId;
    const chapterIndex = JOURNEY_CHAPTER_IDS.indexOf(chapterId);
    const chapterStart = FILM?.chapters[chapterIndex]?.at ?? 0;
    return {
      id: stop.id,
      label: stop.label,
      stageId: stage.id,
      chapterId,
      startAt: stage.video ? chapterStart : CLOSED_AT_SEC,
    };
  });
}
