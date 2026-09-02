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
 * The manual draft, seeded from whatever the studio already typed.
 *
 * "Build it myself" used to start a genuinely empty draft — one untitled row,
 * timed from coverage start and nothing else — while the form directly above
 * it held the ceremony time, the reception time, three locations and a note
 * about wheelchair access. All of it was dropped, and the provenance panel
 * then read "Nothing from this job yet — every time is a typical wedding",
 * which was false even for the one field that had been used.
 *
 * The order it happens in matters: the studio fills the form, is told AI
 * drafting is unavailable, and takes the only remaining path. Handing them a
 * blank page at that moment is the worst of the two failures.
 *
 * Times are ISO instants because that is what the review screen edits.
 * Anything absent is simply not seeded — this invents nothing, which is the
 * difference between it and a guess.
 */
export function seededManualSchedule(
  id: () => string,
  input: {
    coverageStartsAt: string | null;
    coverageEndsAt: string | null;
    ceremonyTime: string | null;
    receptionTime: string | null;
    locations: string | null;
  },
): ManualScheduleItemSeed[] {
  const instant = (value: string | null): string | null => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
  };
  const firstLocation =
    (input.locations ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)[0] ?? null;

  const coverageStart = instant(input.coverageStartsAt);
  const coverageEnd = instant(input.coverageEndsAt);
  const ceremony = instant(input.ceremonyTime);
  const reception = instant(input.receptionTime);

  const seeds: Array<{ startAt: string; title: string }> = [];
  if (coverageStart) seeds.push({ startAt: coverageStart, title: "" });
  if (ceremony) seeds.push({ startAt: ceremony, title: "Ceremony" });
  if (reception) seeds.push({ startAt: reception, title: "Reception" });

  // Nothing usable was entered, so this is the old empty draft.
  if (!seeds.length) {
    return [manualScheduleItem(id(), nextItemStart([], null))];
  }

  const ordered = seeds
    .slice()
    .sort((left, right) => left.startAt.localeCompare(right.startAt));

  return ordered.map((seed, index) => {
    const item = manualScheduleItem(id(), seed.startAt, seed.title);
    // Each item runs up to the next one, and the last to coverage end when
    // there is one — so the day reads as a continuous plan rather than a
    // column of default hours the studio has to retime one by one.
    const nextStart = ordered[index + 1]?.startAt ?? coverageEnd ?? null;
    const endAt =
      nextStart && nextStart > seed.startAt ? nextStart : item.endAt;
    return {
      ...item,
      endAt,
      location: index === 0 ? firstLocation : null,
    };
  });
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
