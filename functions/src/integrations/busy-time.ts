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
 * One provider failing never fails the read: its reason is reported (the
 * caller logs it) and the others still count. Only when nothing is connected,
 * or everything connected failed, is the result `ok:false` — which callers
 * already treat as "no extra busy time", exactly as they did when Google was
 * the only source.
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
