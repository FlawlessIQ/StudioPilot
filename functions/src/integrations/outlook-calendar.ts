import {
  zonedMidnightToUtc,
  zonedWallClockToUtc,
  type BusyInterval,
  type FreeBusyResult,
} from "./busy-time.js";

/**
 * Outlook / Microsoft 365 busy time, through Microsoft Graph.
 *
 * Read-only by design: the OAuth grant asks for `Calendars.Read` and
 * `offline_access` and nothing else (see oauth.ts). StudioCue never writes to
 * an Outlook calendar — the studio asked for its busy time to be respected,
 * not for a second place consultations get written.
 *
 * `calendarView` rather than `getSchedule`: getSchedule needs the mailbox
 * address, caps a request at 62 days (availability asks for 90) and is not
 * available to personal outlook.com accounts. calendarView works for both
 * account kinds and needs only the token.
 */

export const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

/** Free and "working elsewhere" leave the studio bookable; the rest do not. */
const BUSY_SHOW_AS = new Set(["busy", "tentative", "oof"]);

type GraphDateTime = { dateTime?: unknown; timeZone?: unknown };

function parseGraphWallClock(value: string) {
  // Graph writes seven fractional digits ("2026-10-03T14:00:00.0000000"),
  // which not every Date parser accepts. Read the parts instead.
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
      value.trim(),
    );
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
    offset: match[7] ?? null,
  };
}

function offsetMs(offset: string): number {
  if (offset === "Z") return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

function graphInstant(value: GraphDateTime): number | null {
  const raw = typeof value.dateTime === "string" ? value.dateTime : "";
  const parts = parseGraphWallClock(raw);
  if (!parts) return null;
  const wall = {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
  if (parts.offset) {
    return (
      Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) -
      offsetMs(parts.offset)
    );
  }
  // The request sends Prefer: outlook.timezone="UTC", so this is UTC in
  // practice. A zone Graph names anyway is honoured when it is an IANA name;
  // Windows names ("Eastern Standard Time") fall back to UTC.
  const zone = typeof value.timeZone === "string" ? value.timeZone : "UTC";
  return zonedWallClockToUtc(wall, zone);
}

function graphDateOnly(value: GraphDateTime) {
  const raw = typeof value.dateTime === "string" ? value.dateTime : "";
  return parseGraphWallClock(raw);
}

/**
 * One page of `/me/calendarView` -> busy intervals.
 *
 * All-day events are floating dates, so they are placed on the studio's own
 * calendar day (`studioTimeZone`) rather than read as midnight UTC — which
 * for a New York studio would block 8pm the evening before and free up the
 * last four hours of the day itself.
 */
export function parseGraphCalendarView(
  body: unknown,
  studioTimeZone: string,
): BusyInterval[] {
  const record =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const events = Array.isArray(record.value) ? record.value : [];
  const busy: BusyInterval[] = [];
  for (const raw of events) {
    if (typeof raw !== "object" || raw === null) continue;
    const event = raw as Record<string, unknown>;
    if (event.isCancelled === true) continue;
    const showAs = typeof event.showAs === "string" ? event.showAs.toLowerCase() : "busy";
    if (!BUSY_SHOW_AS.has(showAs)) continue;
    const start = (event.start ?? {}) as GraphDateTime;
    const end = (event.end ?? {}) as GraphDateTime;
    let startMs: number | null;
    let endMs: number | null;
    if (event.isAllDay === true) {
      const startDate = graphDateOnly(start);
      const endDate = graphDateOnly(end);
      if (!startDate || !endDate) continue;
      startMs = zonedMidnightToUtc(startDate.year, startDate.month, startDate.day, studioTimeZone);
      endMs = zonedMidnightToUtc(endDate.year, endDate.month, endDate.day, studioTimeZone);
    } else {
      startMs = graphInstant(start);
      endMs = graphInstant(end);
    }
    if (startMs === null || endMs === null || !(endMs > startMs)) continue;
    busy.push({
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    });
  }
  return busy;
}

export function graphCalendarViewUrl(timeMinIso: string, timeMaxIso: string): string {
  const url = new URL(`${GRAPH_BASE_URL}/me/calendarView`);
  url.searchParams.set("startDateTime", timeMinIso);
  url.searchParams.set("endDateTime", timeMaxIso);
  url.searchParams.set("$select", "start,end,showAs,isAllDay,isCancelled");
  url.searchParams.set("$top", "250");
  return url.toString();
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Pages followed before giving up — 250 events a page, so 5,000 events. */
const MAX_PAGES = 20;

export async function outlookBusyFromGraph(input: {
  accessToken: string;
  timeMinIso: string;
  timeMaxIso: string;
  studioTimeZone: string;
  fetchImpl?: FetchLike;
}): Promise<FreeBusyResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const busy: BusyInterval[] = [];
  let next: string | null = graphCalendarViewUrl(input.timeMinIso, input.timeMaxIso);
  for (let page = 0; next && page < MAX_PAGES; page += 1) {
    // nextLink is Graph's own; refuse anything else so a bearer token can
    // never be sent to a host it was not issued for.
    if (!next.startsWith(`${GRAPH_BASE_URL}/`)) {
      return { ok: false, reason: "OUTLOOK_CALENDAR_NEXT_LINK_REJECTED" };
    }
    const response: Response = await fetchImpl(next, {
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        prefer: 'outlook.timezone="UTC"',
        accept: "application/json",
      },
    });
    if (!response.ok) {
      return { ok: false, reason: `OUTLOOK_CALENDAR_VIEW_FAILED:${response.status}` };
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    busy.push(...parseGraphCalendarView(body, input.studioTimeZone));
    next = typeof body["@odata.nextLink"] === "string" ? body["@odata.nextLink"] : null;
  }
  return { ok: true, busy };
}
