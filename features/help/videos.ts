import manifest from "./video-manifest.json";
import { DEFAULT_TRADE, tradeOf, tradeProfile, tradeVocab } from "@/features/trades/trades";

/**
 * The narrated videos that sit on top of some explainers.
 *
 * video-manifest.json is written by the video pipeline (scripts/how-to/),
 * never by hand: a video exists for the product only once it has been
 * recorded, approved and uploaded. The files live in a public Storage path
 * under NEXT_PUBLIC_HOW_TO_MEDIA_BASE; with that unset, explainers still show
 * and videos are simply left out.
 */

export type HelpVideo = {
  id: string;
  version: number;
  durationSec: number;
  orientation: "landscape" | "portrait";
  file: string;
  poster: string;
  captions: string;
  chapters: Array<{ at: number; title: string }>;
  transcript?: string;
  recordedAt?: string;
  recordedCommit?: string;
};

const VIDEOS = manifest as Record<string, Omit<HelpVideo, "id">>;

export function helpVideoIds(): string[] {
  return Object.keys(VIDEOS);
}

/**
 * Every video was recorded on a photography studio, in a photographer's
 * words, and a recording can't be reworded. So another trade is shown one
 * only when nothing it says is wrong for them: no photo words at all, and a
 * consultation, a proposal or delivery only where the trade has one by that
 * name. The written guide stands on its own without it.
 */
const PHOTO_NARRATION =
  /\b(photos?|photograph\w*|galler(?:y|ies)|shoots?|shooters?|shot lists?|albums?|coverage|deliverables?|sneak peeks?|retouching)\b/i;
const CONSULTATION_NARRATION = /\bconsultations?\b/i;
const CALL_NARRATION = /\b(a time to talk|book a call)\b/i;
const PROPOSAL_NARRATION = /\bproposals?\b/i;
const DELIVERY_NARRATION = /\bdeliver(y|ed|ing)?\b/i;

export function videoSuitsTrade(id: string | undefined, trade: unknown): boolean {
  if (tradeOf(trade) === DEFAULT_TRADE) return true;
  const entry = id ? VIDEOS[id] : undefined;
  // No transcript, no way to tell what it says.
  if (!entry?.transcript) return false;
  const said = [entry.transcript, ...entry.chapters.map((chapter) => chapter.title)].join(" ");
  const recorded = tradeVocab(DEFAULT_TRADE);
  const words = tradeVocab(trade);
  const has = tradeProfile(trade);
  if (PHOTO_NARRATION.test(said)) return false;
  if (CONSULTATION_NARRATION.test(said) && !(has.consultation && words.consultation === recorded.consultation)) return false;
  if (CALL_NARRATION.test(said) && !has.consultation) return false;
  if (PROPOSAL_NARRATION.test(said) && words.proposal !== recorded.proposal) return false;
  if (DELIVERY_NARRATION.test(said) && !has.delivery) return false;
  return true;
}

/**
 * A file's public URL under the media base: either a folder URL the file is
 * appended to, or a template with {file} in it — Firebase Storage's public URL
 * puts the name mid-path: …/o/public%2Fhow-to%2F{file}?alt=media. Shared with
 * the website's own clips (features/marketing/media.ts), which live in the
 * same folder.
 */
export function mediaUrl(base: string, file: string): string {
  return base.includes("{file}")
    ? base.replace("{file}", encodeURIComponent(file))
    : `${base.replace(/\/+$/, "")}/${encodeURIComponent(file)}`;
}

/** A playable video, with absolute URLs, or null when there isn't one to show. */
export function helpVideo(
  id: string | undefined,
  base = process.env.NEXT_PUBLIC_HOW_TO_MEDIA_BASE,
): (HelpVideo & { src: string; posterSrc: string; captionsSrc: string }) | null {
  if (!id || !base) return null;
  const entry = VIDEOS[id];
  if (!entry) return null;
  const url = (file: string) => mediaUrl(base, file);
  return {
    id,
    ...entry,
    src: url(entry.file),
    posterSrc: url(entry.poster),
    captionsSrc: url(entry.captions),
  };
}

export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** "6 min": a whole video's length the way a button says it. */
export function formatMinutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

/** ISO 8601 duration for schema.org (VideoObject.duration): PT6M8S. */
export function isoDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `PT${Math.floor(whole / 60)}M${whole % 60}S`;
}

/** A published video's length as a button says it ("6 min"), or null when it isn't published here. */
export function helpVideoLength(id: string | undefined): string | null {
  const video = helpVideo(id);
  return video ? formatMinutes(video.durationSec) : null;
}

/** "51 sec" under a minute and a half, else minutes: a short film's length on its button. */
export function filmLength(id: string | undefined): string | null {
  const video = helpVideo(id);
  if (!video) return null;
  return video.durationSec < 90 ? `${Math.round(video.durationSec)} sec` : formatMinutes(video.durationSec);
}
