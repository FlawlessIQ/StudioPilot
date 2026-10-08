import { isoToWallClock, spokenClock } from "./day-clock.js";
import { labelName, sortLabels } from "./crew-labels.js";

/**
 * A published run of show, as the page the studio hands out.
 *
 * The PDF printed `2027-08-14T17:30:00.000Z` in two columns, the schedule's id
 * and the project's id — a file meant for a couple, their planner and the
 * crew. GR Productions' own run of show (2026-10-06) is the model: what day,
 * where everyone gets ready, marries and celebrates, who covers what hours,
 * then the day at a glance — "12:30 – 1:00 PM · P1 V1 · Arrival & detail
 * photos · Getting Ready", with each team's finish called out.
 *
 * Everything is formatted here, in the wedding's zone, so the PDF service
 * only lays out text. Pure: no I/O.
 */

export type RunOfShowItem = {
  startAt: string;
  endAt: string;
  title: string;
  location?: string | null;
  notes?: string | null;
  description?: string | null;
  crewIds?: readonly string[];
};

export type RunOfShowRow = {
  time: string;
  title: string;
  crew: string[];
  where: string;
  /** Who finishes here: "P2 / V2 conclude 8:45 PM". */
  concludes: string;
};

export type RunOfShowDocument = {
  title: string;
  subtitle: string;
  facts: Array<{ label: string; value: string }>;
  rows: RunOfShowRow[];
  footer: string;
  fileName: string;
};

const TBD_SUFFIX = " — time TBD";
const shortPlace = (place: string) => place.split(",")[0]!.trim();
const sameMeridiem = (left: string, right: string) => (Number(left.slice(0, 2)) < 12) === (Number(right.slice(0, 2)) < 12);

/** "12:30 – 1:00 PM", "11:30 AM – 12:15 PM", or one time for a moment. */
export function timeRange(start: string, end: string): string {
  if (start === end) return spokenClock(start);
  const from = spokenClock(start);
  const to = spokenClock(end);
  return sameMeridiem(start, end) ? `${from.replace(/ (AM|PM)$/, "")} – ${to}` : `${from} – ${to}`;
}

export function runOfShowDocument(input: {
  items: readonly RunOfShowItem[];
  timeZone: string;
  version: number;
  publishedAt?: string | null;
  project: { name?: string | null; eventDate?: string | null; eventType?: string | null };
  /** Crew profile id → "P1", "V2" (crew-labels.ts). */
  crewLabels?: ReadonlyMap<string, string>;
}): RunOfShowDocument {
  const zone = input.timeZone;
  const items = [...input.items]
    .filter((item) => Number.isFinite(Date.parse(item.startAt)))
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  const labelsOf = (item: RunOfShowItem) =>
    sortLabels((item.crewIds ?? []).map((id) => input.crewLabels?.get(id) ?? "").filter(Boolean));
  const everyone = sortLabels([...(input.crewLabels?.values() ?? [])]);

  // Where the day happens, read off the lines themselves.
  const placeOf = (pattern: RegExp, avoid?: RegExp) =>
    items.find((item) => pattern.test(item.title) && !(avoid?.test(item.title)) && item.location?.trim())?.location?.trim() ?? null;
  const GETTING_READY_ROW = /detail|getting ready|dress|touch|robe|prep|arriv/i;
  /** The evening's moments: the reception, wherever it is. */
  const RECEPTION_ROW = /reception|entrance|cocktail|dinner|dance|cake|toast|speech|night|send.?off|sparkler|dessert|bouquet|garter|exit/i;
  const gettingReady = placeOf(GETTING_READY_ROW);
  const ceremony = placeOf(/ceremon/i, /travel|hide/i);
  const reception = placeOf(/reception|entrance|cocktail|dinner|first dance/i, /travel/i);

  const firstDay = items[0] ? isoToWallClock(items[0].startAt, zone)?.date : null;
  const day = (input.project.eventDate && /^\d{4}-\d{2}-\d{2}/.test(input.project.eventDate) ? input.project.eventDate.slice(0, 10) : firstDay) ?? null;
  const dayLabel = day
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))
    : null;

  const wedding = /wedding/i.test(String(input.project.eventType ?? input.project.name ?? ""));
  const trades = new Set(everyone.map((label) => label[0]));
  const title = `${wedding ? "Wedding " : ""}${trades.has("P") && trades.has("V") ? "Photo & Video " : ""}Run of Show`;
  const subtitle = [
    dayLabel,
    ceremony && reception && ceremony !== reception ? `Ceremony at ${shortPlace(ceremony)}` : null,
    ceremony && reception && ceremony !== reception ? `Reception at ${shortPlace(reception)}` : (ceremony ?? reception) ? `At ${shortPlace((ceremony ?? reception)!)}` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  const clock = (iso: string) => isoToWallClock(iso, zone)?.clock ?? null;
  /** A row names the place briefly: the full address is in the box above (as GR's does). */
  //
  // When getting ready and the reception share an address (GR, 2026-10-08:
  // both at 3434 Island Rd), the address alone can't tell them apart, and every
  // reception moment — cocktails, dinner, cake, night pictures — was labelled
  // "Getting ready". The line's own name decides then.
  const placeName = (location: string, title: string) => {
    if (!location) return "";
    const eveningRow = RECEPTION_ROW.test(title) && !GETTING_READY_ROW.test(title);
    const ceremonyRow = /ceremon/i.test(title);
    if (
      location === gettingReady &&
      !(location === reception && eveningRow) &&
      !(location === ceremony && ceremonyRow)
    )
      return "Getting ready";
    return location === ceremony || location === reception ? shortPlace(location) : location;
  };

  // Each person's hours, from the first line they're on to the last.
  const span = new Map<string, { start: number; end: number; lastIndex: number }>();
  items.forEach((item, index) => {
    for (const label of labelsOf(item)) {
      const current = span.get(label);
      const start = Date.parse(item.startAt);
      const end = Math.max(Date.parse(item.endAt), start);
      span.set(label, current
        ? { start: Math.min(current.start, start), end: Math.max(current.end, end), lastIndex: Math.max(current.lastIndex, index) }
        : { start, end, lastIndex: index });
    }
  });
  const hours = (label: string) => {
    const at = span.get(label)!;
    const from = clock(new Date(at.start).toISOString());
    const to = clock(new Date(at.end).toISOString());
    return from && to ? `${spokenClock(from)} – ${spokenClock(to)}` : "";
  };
  const coverage = (() => {
    if (span.size) {
      // Photo 1 with Video 1, and so on: a team, as the studio books it.
      const numbers = [...new Set([...span.keys()].map((label) => Number(label.slice(1))))].sort((a, b) => a - b);
      return numbers
        .map((number) => {
          const team = sortLabels([...span.keys()].filter((label) => Number(label.slice(1)) === number));
          const windows = team.map(hours);
          const starts = team.map((label) => windows[team.indexOf(label)]!.split(" – ")[0]);
          if (new Set(windows).size === 1) return `${team.map(labelName).join(" + ")}: ${windows[0]}`;
          // Together from the start, leaving at different times: "12:30 PM – 11:00 PM / 10:00 PM".
          if (new Set(starts).size === 1) return `${team.map(labelName).join(" + ")}: ${starts[0]} – ${windows.map((window) => window.split(" – ")[1]).join(" / ")}`;
          return team.map((label, index) => `${labelName(label)}: ${windows[index]}`).join("  |  ");
        })
        .join("  |  ");
    }
    const first = items[0];
    const last = items.reduce<RunOfShowItem | null>((latest, item) => (!latest || Date.parse(item.endAt) > Date.parse(latest.endAt) ? item : latest), null);
    const from = first ? clock(first.startAt) : null;
    const to = last ? clock(last.endAt) : null;
    return from && to ? `${spokenClock(from)} – ${spokenClock(to)}` : "";
  })();

  const facts = [
    gettingReady ? { label: "Getting ready", value: gettingReady } : null,
    ceremony && ceremony === reception
      ? { label: "Ceremony & reception", value: ceremony }
      : null,
    ceremony && ceremony !== reception ? { label: "Ceremony", value: ceremony } : null,
    reception && ceremony !== reception ? { label: "Reception", value: reception } : null,
    coverage ? { label: "Coverage", value: coverage } : null,
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact));

  const rows: RunOfShowRow[] = items.map((item, index) => {
    const tbd = item.title.endsWith(TBD_SUFFIX);
    const start = clock(item.startAt);
    const end = clock(item.endAt) ?? start;
    const crew = labelsOf(item);
    const leaving = [...span.entries()].filter(([, at]) => at.lastIndex === index).map(([label]) => label);
    const leavingClock = leaving.length ? clock(new Date(span.get(leaving[0]!)!.end).toISOString()) : null;
    const note = [item.notes, item.description].map((value) => String(value ?? "").trim()).find(Boolean) ?? "";
    return {
      time: tbd ? "TBD" : start && end ? timeRange(start, end) : "",
      title: tbd ? item.title.slice(0, -TBD_SUFFIX.length) : item.title,
      // Only when it isn't everyone: a line the whole crew is on needs no tags.
      crew: crew.length && crew.length < everyone.length ? crew : [],
      where: [placeName(item.location?.trim() ?? "", item.title), note].filter(Boolean).join(" — "),
      concludes: leaving.length
        ? `${sortLabels(leaving).join(" / ")} conclude${leaving.length === 1 ? "s" : ""}${leavingClock ? ` ${spokenClock(leavingClock)}` : ""}`
        : "",
    };
  });

  const zoneName =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "long" })
      .formatToParts(new Date(items[0]?.startAt ?? Date.now()))
      .find((part) => part.type === "timeZoneName")?.value ?? zone;
  const published = input.publishedAt && Number.isFinite(Date.parse(input.publishedAt))
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone }).format(new Date(input.publishedAt))
    : null;
  const slug = String(input.project.name ?? "run-of-show").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
  return {
    title,
    subtitle,
    facts,
    rows,
    footer: [`Version ${input.version}`, published ? `published ${published}` : null, `Times are ${zoneName}`].filter(Boolean).join(" · "),
    fileName: `${slug}-run-of-show-v${input.version}.pdf`,
  };
}
