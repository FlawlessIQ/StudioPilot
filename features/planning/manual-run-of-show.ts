/**
 * Starting a run of show by hand.
 *
 * `publishSchedule` takes items and does not care where they came from, but the
 * only caller in the product set them from an AI draft — so a studio whose
 * workspace has AI switched off ("AI drafting isn't switched on for this
 * workspace yet") had no way to produce a schedule at all. "Final run of show
 * approved" is a blocking readiness checkpoint, which left waiving it as the
 * only path to a ready wedding.
 *
 * These build the same item shape the review screen already edits, so the
 * manual path reuses the whole review-and-publish surface rather than growing a
 * second one.
 */

export type ManualScheduleItemSeed = {
  id: string;
  startAt: string;
  endAt: string;
  title: string;
  description: string;
  location: string | null;
  address: string | null;
  travelMinutes: number;
  photographerIds: string[];
  participants: string[];
  vendorContactIds: string[];
  equipment: string[];
  notes: string | null;
  visibility: "studio";
  blockingIssues: string[];
  sourceReferences: [];
};

const HOUR = 60 * 60 * 1000;

/** One empty hour, starting where the coverage or the previous item leaves off. */
export function manualScheduleItem(
  id: string,
  startAt: string,
  title = "",
): ManualScheduleItemSeed {
  const start = new Date(startAt);
  const startIso = Number.isFinite(start.valueOf())
    ? start.toISOString()
    : new Date().toISOString();
  return {
    id,
    startAt: startIso,
    endAt: new Date(new Date(startIso).valueOf() + HOUR).toISOString(),
    title,
    description: "",
    location: null,
    address: null,
    travelMinutes: 0,
    photographerIds: [],
    participants: [],
    vendorContactIds: [],
    equipment: [],
    notes: null,
    visibility: "studio",
    blockingIssues: [],
    sourceReferences: [],
  };
}

/**
 * Where the next item should begin: after the last one, or at coverage start.
 *
 * Sorting by start rather than trusting array order, because the review screen
 * lets a photographer retime any row.
 */
export function nextItemStart(
  items: readonly { startAt: string; endAt: string }[],
  coverageStartsAt: string | null,
): string {
  const ends = items
    .map((item) => new Date(item.endAt).valueOf())
    .filter((value) => Number.isFinite(value));
  if (ends.length > 0) return new Date(Math.max(...ends)).toISOString();
  const start = coverageStartsAt ? new Date(coverageStartsAt) : null;
  if (start && Number.isFinite(start.valueOf())) return start.toISOString();
  return new Date().toISOString();
}

/**
 * Whether these items may be published.
 *
 * `publishSchedule` validates server-side; this is so the button can say why
 * instead of failing. Every item needs a title and a span that moves forwards —
 * an empty row a photographer forgot to fill is the likely mistake.
 */
export function manualScheduleBlockers(
  items: readonly { title: string; startAt: string; endAt: string }[],
): string[] {
  if (items.length === 0) return ["Add at least one item."];
  const blockers: string[] = [];
  const untitled = items.filter((item) => !item.title.trim()).length;
  if (untitled > 0) {
    blockers.push(
      untitled === 1
        ? "One item still needs a title."
        : `${untitled} items still need titles.`,
    );
  }
  const backwards = items.filter(
    (item) => new Date(item.endAt).valueOf() <= new Date(item.startAt).valueOf(),
  ).length;
  if (backwards > 0) {
    blockers.push(
      backwards === 1
        ? "One item ends before it starts."
        : `${backwards} items end before they start.`,
    );
  }
  return blockers;
}
