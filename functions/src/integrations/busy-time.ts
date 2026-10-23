/**
 * Busy time from every calendar a studio has connected.
 *
 * Consultation availability used to subtract busy time read from Google
 * Calendar only. A studio that keeps its diary in Outlook or on an iPhone had
 * no way to stop a couple booking over a dentist appointment, and asked
 * exactly that: "can this read someone's Google Calendar or Apple calendar or
 * Outlook calendar?"
 *
 * Pure: no Firebase, no network. provider-runtime.ts supplies the fetchers;
 * this decides what to do with what they return.
 */

export type BusyInterval = { start: string; end: string };
export type FreeBusyResult =
  | { ok: true; busy: BusyInterval[] }
  | { ok: false; reason: string };

/** Providers that can tell StudioCue when the studio is busy. */
export const BUSY_TIME_PROVIDERS = [
  "google_calendar",
  "outlook_calendar",
  "apple_calendar",
] as const;
export type BusyTimeProvider = (typeof BUSY_TIME_PROVIDERS)[number];

export function isBusyTimeProvider(value: unknown): value is BusyTimeProvider {
  return (BUSY_TIME_PROVIDERS as readonly unknown[]).includes(value);
}

export type BusyFetcher = () => Promise<FreeBusyResult>;

export type CollectedBusy =
  | {
      ok: true;
      busy: BusyInterval[];
      /** Providers whose busy time is included. */
      sources: BusyTimeProvider[];
      /** Providers that were connected and failed; their time is absent. */
      failures: Array<{ provider: BusyTimeProvider; reason: string }>;
    }
  | {
      ok: false;
      reason: string;
      failures: Array<{ provider: BusyTimeProvider; reason: string }>;
    };

/**
 * Sort, drop anything unreadable or empty, and merge overlaps — so two
 * calendars holding the same meeting count once, and a caller testing
 * overlap tests against the smallest list.
 */
export function unionBusyIntervals(
  lists: ReadonlyArray<ReadonlyArray<BusyInterval>>,
): BusyInterval[] {
  const ranges = lists
    .flat()
    .map((interval) => ({
      start: Date.parse(interval.start),
      end: Date.parse(interval.end),
    }))
    .filter(
      (range) =>
        Number.isFinite(range.start) &&
        Number.isFinite(range.end) &&
        range.end > range.start,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged.map((range) => ({
    start: new Date(range.start).toISOString(),
    end: new Date(range.end).toISOString(),
  }));
}

/**
 * Ask every connected busy-time provider at once and union the answers.
 *
 * This only collects: the busy time of every provider that answered, and the
 * reason of every one that did not. Whether anyone may book on what came
 * back is `decideCalendarAvailability` below, which fails closed when any
 * connected calendar went unread. `ok:false` with no failures means nothing
 * is connected.
 */
export async function collectBusyIntervals(input: {
  providers: readonly BusyTimeProvider[];
  fetchers: Partial<Record<BusyTimeProvider, BusyFetcher>>;
}): Promise<CollectedBusy> {
  const providers = [...new Set(input.providers)];
  if (!providers.length) {
    return { ok: false, reason: "CALENDAR_NOT_CONNECTED", failures: [] };
  }
  const settled = await Promise.all(
    providers.map(async (provider) => {
      const fetcher = input.fetchers[provider];
      if (!fetcher) {
        return {
          provider,
          result: {
            ok: false,
            reason: `${provider.toUpperCase()}_FREEBUSY_UNSUPPORTED`,
          } as FreeBusyResult,
        };
      }
      try {
        return { provider, result: await fetcher() };
      } catch (caught: unknown) {
        return {
          provider,
          result: {
            ok: false,
            reason: caught instanceof Error ? caught.message : "FREEBUSY_FAILED",
          } as FreeBusyResult,
        };
      }
    }),
  );
  const failures: Array<{ provider: BusyTimeProvider; reason: string }> = [];
  const sources: BusyTimeProvider[] = [];
  const lists: BusyInterval[][] = [];
  for (const { provider, result } of settled) {
    if (result.ok) {
      sources.push(provider);
      lists.push(result.busy);
    } else {
      failures.push({ provider, reason: result.reason });
    }
  }
  if (!sources.length) {
    return {
      ok: false,
      reason: failures[0]?.reason ?? "FREEBUSY_FAILED",
      failures,
    };
  }
  return { ok: true, busy: unionBusyIntervals(lists), sources, failures };
}

/**
 * The code a booking link answers with when the studio's calendar could not
 * be read, and the operational alert's code (provider-runtime.ts).
 */
export const CALENDAR_AVAILABILITY_UNAVAILABLE = "CALENDAR_AVAILABILITY_UNAVAILABLE";

/**
 * What a read of the studio's calendars means for anyone choosing a time.
 *
 * - `ok`: every connected calendar answered; its busy time is subtracted.
 * - `not_connected`: the studio connected no calendar. Times come from its
 *   hours and StudioCue's own bookings alone, as they always have: nothing
 *   is being hidden from us.
 * - `unavailable`: a calendar is connected (or was, and broke) and could not
 *   be read. Its busy time is unknown, so no time may be offered from it.
 */
export type CalendarAvailability =
  | { state: "ok"; busy: BusyInterval[]; sources: BusyTimeProvider[] }
  | { state: "not_connected" }
  | {
      state: "unavailable";
      reason: string;
      failures: Array<{ provider: BusyTimeProvider; reason: string }>;
    };

/**
 * Fail closed when a connected calendar went unread.
 *
 * Until 2026-10-22 "no calendar answered" read as "no busy time", so a
 * client's booking link offered every hour the studio keeps, including the
 * ones its calendar holds: a silent double-booking (reliability audit,
 * 2026-10-22).
 *
 * Partial success fails closed too. When Google answers and Outlook does not,
 * Google's busy time says nothing about Outlook's — a studio connects a
 * second calendar precisely because the first does not hold everything — so
 * the hours Outlook holds are as unknown as if nothing had answered. Offering
 * them is the same double-booking, only rarer and harder to notice. A pause
 * in online booking, which the client is told about and the studio is
 * alerted to, costs far less than two clients holding one hour.
 */
export function decideCalendarAvailability(collected: CollectedBusy): CalendarAvailability {
  if (collected.failures.length) {
    return {
      state: "unavailable",
      reason: collected.failures[0]?.reason ?? "FREEBUSY_FAILED",
      failures: collected.failures,
    };
  }
  if (!collected.ok) {
    return collected.reason === "CALENDAR_NOT_CONNECTED"
      ? { state: "not_connected" }
      : { state: "unavailable", reason: collected.reason, failures: [] };
  }
  return { state: "ok", busy: collected.busy, sources: collected.sources };
}

/**
 * The busy time a client's bookable times are generated around: StudioCue's
 * own bookings plus the calendar's — or, when the calendar could not be
 * read, nothing bookable at all.
 */
export function busyForBooking(
  internal: readonly BusyInterval[],
  calendar: CalendarAvailability,
):
  | { bookable: true; busy: BusyInterval[] }
  | { bookable: false; reason: typeof CALENDAR_AVAILABILITY_UNAVAILABLE } {
  if (calendar.state === "unavailable") {
    return { bookable: false, reason: CALENDAR_AVAILABILITY_UNAVAILABLE };
  }
  return {
    bookable: true,
    busy: calendar.state === "ok" ? [...internal, ...calendar.busy] : [...internal],
  };
}

// ---------------------------------------------------------------------------
// Wall-clock time in a named zone -> UTC. Shared by the Outlook and CalDAV
// parsers, both of which meet times that are not in UTC.

function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(instantMs));
  const raw =
    parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(raw);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/** True when the runtime knows this IANA zone name. */
export function isKnownTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * The UTC instant at which `timeZone`'s clocks read `wall`. Unknown zones
 * resolve as UTC rather than throwing — a busy block an hour off is better
 * than a calendar that cannot be read at all.
 */
export function zonedWallClockToUtc(wall: WallClock, timeZone: string): number {
  const guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  if (!isKnownTimeZone(timeZone) || /^(utc|etc\/utc|gmt|z)$/i.test(timeZone)) {
    return guess;
  }
  const offset = offsetMinutesAt(guess, timeZone);
  const resolved = guess - offset * 60_000;
  const second = offsetMinutesAt(resolved, timeZone);
  return second === offset ? resolved : guess - second * 60_000;
}

/** Midnight at the start of `yyyy-mm-dd` in `timeZone`, as epoch ms. */
export function zonedMidnightToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  return zonedWallClockToUtc(
    { year, month, day, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}
