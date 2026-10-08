import { isoToWallClock, wallClockToIso } from "@/features/schedules/day-clock";
import { titleIsTbd, withTbdTitle } from "@/features/schedules/day-plan";

/**
 * "Can we make dinner 7–8pm, cake cutting 8:30pm, and night pictures 9pm?"
 *
 * Gabe asked Cue exactly that on Albert's test wedding (GR, 2026-10-08), whose
 * timeline had those three lines as TBD. Cue said a draft was ready; nothing
 * was, and nothing could be: no action changed a line's time. This is the
 * deterministic half of the one that does. The model passes the studio's
 * words verbatim (Cue never supplies ids or times as data); this reads them,
 * finds each line on the published timeline, and the card shows every change
 * — editable — before anything is published.
 */

export type TimeRequest = {
  /** The words naming the line: "cake cutting". */
  phrase: string;
  /** "HH:MM", 24-hour. */
  start: string;
  end: string | null;
};

export type TimelineLine = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
};

export type TimeEdit = {
  itemId: string;
  /** The line's name without the TBD tail. */
  title: string;
  wasTbd: boolean;
  /** As it reads now: "TBD", or "4:00 PM – 5:00 PM". */
  before: string;
  start: string;
  end: string | null;
};

const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?`;
const RANGE = new RegExp(String.raw`${TIME}(?:\s*(?:-|–|—|to|until|till)\s*${TIME})?`, "i");

function clock(hour: string, minute: string | undefined, meridiem: string | undefined, fallback?: string): string | null {
  let h = Number(hour);
  const m = minute ? Number(minute) : 0;
  if (!Number.isFinite(h) || h > 23 || m > 59) return null;
  const tag = (meridiem ?? fallback ?? "").toLowerCase().replace(/\./g, "");
  if (tag === "pm" && h < 12) h += 12;
  else if (tag === "am" && h === 12) h = 0;
  // No am/pm and a 12-hour figure ("dinner at 7"): the afternoon or evening.
  // Nobody cuts a cake at 7 AM, and a morning call is written "9am" or "09:00".
  else if (!tag && h >= 1 && h <= 11 && !hour.startsWith("0")) h += 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Each "<what> <time>[–<time>]" in the request, in the order written. */
export function parseTimeRequests(text: string): TimeRequest[] {
  const requests: TimeRequest[] = [];
  const parts = text
    .replace(/^\s*(can|could|would)\s+(we|you)\s+(please\s+)?(make|move|set|change|put)\s+/i, "")
    .split(/\s*(?:,|;|\band\b|\n)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    const match = RANGE.exec(part);
    if (!match || match.index === undefined) continue;
    const phrase = part
      .slice(0, match.index)
      .replace(/\b(at|to|from|for|is|be|should be|make|move|set)\s*$/i, "")
      .replace(/[?.!:]+$/g, "")
      .trim();
    if (!phrase) continue;
    // "7-8pm": the end's am/pm applies to the start.
    const endMeridiem = match[6];
    const start = clock(match[1]!, match[2], match[3], endMeridiem);
    const end = match[4] ? clock(match[4], match[5], match[6], match[3]) : null;
    if (!start) continue;
    requests.push({ phrase, start, end });
  }
  return requests;
}

const STOP = new Set(["the", "a", "an", "and", "of", "with", "our", "their", "time", "tbd", "at", "to", "for", "photos", "photo", "pictures", "picture", "shots"]);
const words = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/(ing|s)$/, ""))
    .filter((word) => word.length > 1 && !STOP.has(word));

/** The line a phrase names: the most shared words, a TBD line on a tie, else null. */
export function matchLine(phrase: string, lines: readonly TimelineLine[]): TimelineLine | null {
  const wanted = new Set(words(phrase));
  // "night pictures" keeps "night" once "pictures" is dropped as a stop word;
  // a phrase that is only stop words matches nothing.
  if (!wanted.size) return null;
  let best: { line: TimelineLine; score: number } | null = null;
  for (const line of lines) {
    const have = new Set(words(withTbdTitle(line.title, false)));
    const score = [...wanted].filter((word) => have.has(word)).length;
    if (!score) continue;
    const better =
      !best ||
      score > best.score ||
      (score === best.score && titleIsTbd(line.title) && !titleIsTbd(best.line.title));
    if (better) best = { line, score };
  }
  return best?.line ?? null;
}

/** How a line's time reads now. */
export function lineTimeLabel(line: TimelineLine, zone: string): string {
  if (titleIsTbd(line.title)) return "TBD";
  const start = isoToWallClock(line.startAt, zone)?.clock;
  const end = isoToWallClock(line.endAt, zone)?.clock;
  if (!start) return "";
  return end && end !== start ? `${twelveHour(start)} – ${twelveHour(end)}` : twelveHour(start);
}

export function twelveHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** The changes a request makes, and the parts that named no line. */
export function planTimeEdits(
  text: string,
  lines: readonly TimelineLine[],
  zone: string,
): { edits: TimeEdit[]; unmatched: string[] } {
  const edits: TimeEdit[] = [];
  const unmatched: string[] = [];
  for (const request of parseTimeRequests(text)) {
    const line = matchLine(request.phrase, lines);
    if (!line || edits.some((edit) => edit.itemId === line.id)) {
      unmatched.push(request.phrase);
      continue;
    }
    edits.push({
      itemId: line.id,
      title: withTbdTitle(line.title, false),
      wasTbd: titleIsTbd(line.title),
      before: lineTimeLabel(line, zone),
      start: request.start,
      end: request.end,
    });
  }
  return { edits, unmatched };
}

/**
 * The timeline with the edits made: each line's new start (and end, when one
 * was given — otherwise it keeps its length), its TBD tail gone.
 */
export function applyTimeEdits<T extends TimelineLine>(
  items: readonly T[],
  edits: readonly Pick<TimeEdit, "itemId" | "start" | "end">[],
  day: string,
  zone: string,
): T[] {
  return items.map((item) => {
    const edit = edits.find((entry) => entry.itemId === item.id);
    if (!edit) return item;
    const startAt = wallClockToIso(day, edit.start, zone);
    if (!startAt) return item;
    const length = Math.max(0, Date.parse(item.endAt) - Date.parse(item.startAt));
    const endAt = edit.end
      ? wallClockToIso(day, edit.end, zone) ?? new Date(Date.parse(startAt) + length).toISOString()
      : new Date(Date.parse(startAt) + length).toISOString();
    return {
      ...item,
      startAt,
      endAt: Date.parse(endAt) >= Date.parse(startAt) ? endAt : startAt,
      title: withTbdTitle(item.title, false),
    };
  });
}
