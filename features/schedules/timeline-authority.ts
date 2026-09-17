/**
 * Whose timeline is the real one, for one wedding.
 *
 * With no planner, the studio's run of show is the timeline: vendors get a link
 * to it and crew work from it. With a planner it depends on the wedding — some
 * planners own the day and the photography plan has to follow theirs. Then the
 * run of show is the photographers' working copy, and what matters is where it
 * has drifted from the planner's latest version.
 *
 * So the studio pastes the planner's timeline as they sent it, and this reads
 * the times and titles out of it and lines them up against the run of show.
 * Deterministic on purpose: a comparison that decides whether a photographer
 * is at the ceremony on time shouldn't depend on a model's reading.
 *
 * Pure. Duplicated at functions/src/planning/timeline-authority.ts;
 * tests/timeline-authority.test.ts keeps the copies equal.
 */

export type TimelineAuthority = "studio" | "planner";

export const timelineAuthorities: readonly TimelineAuthority[] = ["studio", "planner"];

export type PlannerTimelineItem = {
  /** Minutes after local midnight on the wedding day. */
  minutes: number;
  title: string;
};

export type TimelineDifference =
  | { kind: "moved"; title: string; plannerTitle: string; ours: number; planner: number }
  | { kind: "only_planner"; title: string; planner: number }
  | { kind: "only_ours"; title: string; ours: number };

const MAX_ITEMS = 100;

const timeAtStart =
  /^\s*(?:[-*•]\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?:\s*(?:-|–|—|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?)?\s*(?:[-–—:|·]\s*)?(.*)$/i;

function meridiemOf(value: string | undefined): "am" | "pm" | null {
  if (!value) return null;
  return value.toLowerCase().startsWith("a") ? "am" : "pm";
}

/**
 * Reads "3:30 PM – Ceremony", "15:30 Ceremony", "4-5pm Cocktail hour" or
 * "• 6 Grand entrance". A time with no am/pm is the first reading that doesn't
 * go back before the row above it — a timeline runs forward, so "12:30" after
 * "10:00 AM" is lunchtime, and "7:30" after "5:00 PM" is evening. For the first
 * row, 8–11 is morning and 12–7 afternoon, which is how a wedding day runs.
 */
export function parsePlannerTimeline(text: string): PlannerTimelineItem[] {
  const items: PlannerTimelineItem[] = [];
  let previous: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (items.length >= MAX_ITEMS) break;
    const match = line.match(timeAtStart);
    if (!match) continue;
    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    const title = (match[7] ?? "").trim().replace(/^[-–—:|·]\s*/, "");
    // A bare number with no title ("2024") or an impossible time isn't a row.
    if (!title || /^\d+$/.test(title) || minute > 59 || hour > 23) continue;
    // "4 guests" or "2 photographers" isn't a time: a bare hour needs a
    // separator, a meridiem or minutes to count.
    if (!match[2] && !match[3] && !/^\s*(?:[-*•]\s*)?\d{1,2}\s*(?:-|–|—|:|\||·)/.test(line)) continue;
    const to24 = (meridiem: "am" | "pm") =>
      (meridiem === "pm" ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour) * 60 + minute;
    const meridiem = meridiemOf(match[3]) ?? meridiemOf(match[6]);
    let minutes: number;
    if (hour > 12 || hour === 0) minutes = hour * 60 + minute;
    else if (meridiem) minutes = to24(meridiem);
    else {
      const [earlier, later] = [to24("am"), to24("pm")].sort((left, right) => left - right) as [number, number];
      minutes =
        previous === null
          ? to24(hour >= 8 && hour <= 11 ? "am" : "pm")
          : (earlier >= previous ? earlier : later);
    }
    previous = minutes;
    items.push({ minutes, title: title.slice(0, 160) });
  }
  return items;
}

/** Minutes after local midnight of an instant, in the wedding's time zone. */
export function localMinutes(instant: string, timezone: string): number | null {
  const date = new Date(instant);
  if (Number.isNaN(date.valueOf())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: timezone || "UTC",
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? (hour % 24) * 60 + minute : null;
  } catch {
    return null;
  }
}

/** "3:30 PM" */
export function formatMinutes(minutes: number): string {
  const hours24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const hour = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${hours24 < 12 ? "AM" : "PM"}`;
}

const filler = new Set(["the", "a", "an", "and", "of", "to", "at", "for", "with", "photos", "photo", "photography", "hour", "begins", "starts", "start", "time"]);

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((word) => word.replace(/s$/, ""))
      .filter((word) => word.length > 1 && !filler.has(word)),
  );
}

/**
 * How much two row titles agree.
 *
 * Dividing by the shorter title is what lets "Ceremony" match "Ceremony
 * begins". It also let "Reception Start & Details" match "Photographers arrive,
 * detail shots" on the single word "detail", and the panel duly reported the
 * reception as moved five hours. So one shared word is only enough when one of
 * the titles is a single word.
 */
function similarity(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  if (shared < 2 && Math.min(a.size, b.size) > 1) return 0;
  return shared / Math.min(a.size, b.size);
}

/** Moves smaller than this are rounding between two people's documents. */
const MOVED_THRESHOLD_MINUTES = 5;

/**
 * Where the run of show and the planner's timeline disagree. Rows are matched
 * by title — "Ceremony" to "Ceremony begins" — and, between equally good
 * matches, by the nearer time.
 */
export function compareTimelines(input: {
  ours: ReadonlyArray<{ title: string; startAt: string }>;
  timezone: string;
  planner: readonly PlannerTimelineItem[];
}): TimelineDifference[] {
  const ours = input.ours
    .map((item) => ({ title: item.title, minutes: localMinutes(item.startAt, input.timezone) }))
    .filter((item): item is { title: string; minutes: number } => item.minutes !== null);
  const candidates: Array<{ ourIndex: number; plannerIndex: number; score: number; gap: number }> = [];
  ours.forEach((our, ourIndex) => {
    input.planner.forEach((planned, plannerIndex) => {
      const score = similarity(our.title, planned.title);
      if (score >= 0.5) candidates.push({ ourIndex, plannerIndex, score, gap: Math.abs(our.minutes - planned.minutes) });
    });
  });
  candidates.sort((left, right) => right.score - left.score || left.gap - right.gap);
  // Half a day apart is two different moments that happen to share a word, not
  // one moment that moved — unless the titles are all but identical.
  const plausible = candidates.filter(
    (candidate) => candidate.gap <= 180 || candidate.score >= 0.8,
  );
  const matchedOurs = new Set<number>();
  const matchedPlanner = new Set<number>();
  const differences: Array<{ at: number; difference: TimelineDifference }> = [];
  for (const candidate of plausible) {
    if (matchedOurs.has(candidate.ourIndex) || matchedPlanner.has(candidate.plannerIndex)) continue;
    matchedOurs.add(candidate.ourIndex);
    matchedPlanner.add(candidate.plannerIndex);
    const our = ours[candidate.ourIndex]!;
    const planned = input.planner[candidate.plannerIndex]!;
    if (candidate.gap >= MOVED_THRESHOLD_MINUTES)
      differences.push({
        at: planned.minutes,
        difference: { kind: "moved", title: our.title, plannerTitle: planned.title, ours: our.minutes, planner: planned.minutes },
      });
  }
  input.planner.forEach((planned, index) => {
    if (!matchedPlanner.has(index))
      differences.push({ at: planned.minutes, difference: { kind: "only_planner", title: planned.title, planner: planned.minutes } });
  });
  ours.forEach((our, index) => {
    if (!matchedOurs.has(index))
      differences.push({ at: our.minutes, difference: { kind: "only_ours", title: our.title, ours: our.minutes } });
  });
  // In the order the day runs, moved rows first at each point: they're the ones
  // that put a photographer in the wrong place.
  const rank = { moved: 0, only_planner: 1, only_ours: 2 } as const;
  return differences
    .sort((left, right) => left.at - right.at || rank[left.difference.kind] - rank[right.difference.kind])
    .map((entry) => entry.difference);
}
