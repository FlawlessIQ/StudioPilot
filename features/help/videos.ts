import manifest from "./video-manifest.json";

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

/** A playable video, with absolute URLs, or null when there isn't one to show. */
export function helpVideo(
  id: string | undefined,
  base = process.env.NEXT_PUBLIC_HOW_TO_MEDIA_BASE,
): (HelpVideo & { src: string; posterSrc: string; captionsSrc: string }) | null {
  if (!id || !base) return null;
  const entry = VIDEOS[id];
  if (!entry) return null;
  // Either a folder URL the file is appended to, or a template with {file}
  // in it — Firebase Storage's public URL puts the name mid-path:
  // …/o/public%2Fhow-to%2F{file}?alt=media
  const url = (file: string) =>
    base.includes("{file}")
      ? base.replace("{file}", encodeURIComponent(file))
      : `${base.replace(/\/+$/, "")}/${encodeURIComponent(file)}`;
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
