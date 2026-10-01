import {
  isKnownTimeZone,
  zonedWallClockToUtc,
  type BusyInterval,
  type FreeBusyResult,
} from "./busy-time.js";

/**
 * Apple Calendar (iCloud) busy time, over CalDAV.
 *
 * iCloud has no OAuth for calendars. A third party reads one with the Apple
 * ID email and an *app-specific* password the owner makes at
 * account.apple.com → Sign-In and Security → App-Specific Passwords. That
 * password is a credential like any refresh token: it goes to Secret Manager
 * (oauth.ts saveCredential) and never into Firestore. The connection document
 * carries only what `appleConnectionRecord` below puts there — the email and
 * the calendar URLs, neither of which can sign in to anything.
 *
 * Everything that parses is pure and exported for tests; the two network
 * functions take a fetch so they can be driven without iCloud.
 */

export const ICLOUD_CALDAV_ROOT = "https://caldav.icloud.com/";

// ---------------------------------------------------------------------------
// Input

/**
 * An app-specific password is sixteen characters, shown as four groups of
 * four ("abcd-efgh-ijkl-mnop"). Accept it with or without the dashes and
 * spaces people paste, and refuse anything else — most often the studio's
 * real Apple ID password, which StudioCue must never hold and iCloud would
 * refuse anyway.
 */
export function normalizeAppSpecificPassword(raw: string): string | null {
  const compact = raw.replace(/[\s-]/g, "").toLowerCase();
  if (!/^[a-z0-9]{16}$/.test(compact)) return null;
  return compact.match(/.{4}/g)!.join("-");
}

export function isIcloudCalDavUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "caldav.icloud.com" || /^p\d+-caldav\.icloud\.com$/.test(url.hostname))
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// XML (WebDAV multistatus). Small and tolerant on purpose: iCloud answers in
// default-namespace form (<response xmlns="DAV:">), other servers prefix
// (<d:response>), and either must read the same.

const PREFIX = "(?:[A-Za-z_][\\w.-]*:)?";

function elementsNamed(xml: string, localName: string): Array<{ attributes: string; inner: string }> {
  const pattern = new RegExp(
    `<${PREFIX}${localName}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${PREFIX}${localName}\\s*>)`,
    "g",
  );
  const found: Array<{ attributes: string; inner: string }> = [];
  for (const match of xml.matchAll(pattern)) {
    found.push({ attributes: match[1] ?? "", inner: match[2] ?? "" });
  }
  return found;
}

function firstElement(xml: string, localName: string): string | null {
  return elementsNamed(xml, localName)[0]?.inner ?? null;
}

export function decodeXmlText(value: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(value);
  if (cdata) return cdata[1]!;
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export type DavResponse = {
  href: string;
  /** The <prop> contents of every propstat that answered 200. */
  props: string;
};

export function parseMultistatus(xml: string): DavResponse[] {
  return elementsNamed(xml, "response").map(({ inner }) => {
    const href = decodeXmlText((firstElement(inner, "href") ?? "").trim());
    const props = elementsNamed(inner, "propstat")
      .filter(({ inner: propstat }) => /\s200\b/.test(firstElement(propstat, "status") ?? ""))
      .map(({ inner: propstat }) => firstElement(propstat, "prop") ?? "")
      .join("\n");
    return { href, props };
  });
}

function hrefInside(props: string, property: string, base: string): string | null {
  const container = firstElement(props, property);
  if (!container) return null;
  const href = firstElement(container, "href");
  if (!href) return null;
  try {
    return new URL(decodeXmlText(href.trim()), base).toString();
  } catch {
    return null;
  }
}

export function parseCurrentUserPrincipal(xml: string, base: string): string | null {
  for (const response of parseMultistatus(xml)) {
    const found = hrefInside(response.props, "current-user-principal", base);
    if (found) return found;
  }
  return null;
}

export function parseCalendarHomeSet(xml: string, base: string): string | null {
  for (const response of parseMultistatus(xml)) {
    const found = hrefInside(response.props, "calendar-home-set", base);
    if (found) return found;
  }
  return null;
}

export type AppleCalendar = { url: string; name: string };

/**
 * The event calendars in a calendar home: collections whose resourcetype
 * says calendar and that hold VEVENTs. Reminders lists (VTODO only), the
 * scheduling inbox and outbox, and the home itself are left out.
 */
export function parseCalendarCollections(xml: string, base: string): AppleCalendar[] {
  const calendars: AppleCalendar[] = [];
  for (const response of parseMultistatus(xml)) {
    const resourceType = firstElement(response.props, "resourcetype") ?? "";
    if (!elementsNamed(resourceType, "calendar").length) continue;
    const components = firstElement(response.props, "supported-calendar-component-set");
    if (components !== null) {
      const names = elementsNamed(components, "comp").map(({ attributes }) =>
        (/name\s*=\s*"([^"]+)"/.exec(attributes)?.[1] ?? "").toUpperCase(),
      );
      if (names.length && !names.includes("VEVENT")) continue;
    }
    let url: string;
    try {
      url = new URL(response.href, base).toString();
    } catch {
      continue;
    }
    const name = decodeXmlText((firstElement(response.props, "displayname") ?? "").trim());
    calendars.push({ url, name: name || "Calendar" });
  }
  return calendars;
}

/** Every calendar-data payload in a REPORT answer, decoded to ICS text. */
export function parseCalendarDataPayloads(xml: string): string[] {
  return parseMultistatus(xml)
    .map((response) => firstElement(response.props, "calendar-data"))
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(decodeXmlText);
}

// ---------------------------------------------------------------------------
// iCalendar (RFC 5545) -> busy intervals.

type IcsProperty = { name: string; params: Record<string, string>; value: string };

function parseIcsLine(line: string): IcsProperty | null {
  let quoted = false;
  let colon = -1;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    else if (character === ":" && !quoted) {
      colon = index;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segments: string[] = [];
  let current = "";
  quoted = false;
  for (const character of head) {
    if (character === '"') quoted = !quoted;
    if (character === ";" && !quoted) {
      segments.push(current);
      current = "";
    } else current += character;
  }
  segments.push(current);
  const [name, ...rawParams] = segments;
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const equals = raw.indexOf("=");
    if (equals < 0) continue;
    params[raw.slice(0, equals).toUpperCase()] = raw.slice(equals + 1).replace(/^"|"$/g, "");
  }
  return { name: (name ?? "").toUpperCase(), params, value };
}

/** VEVENT property lists, with nested components (VALARM) left out. */
export function icsEvents(ics: string): IcsProperty[][] {
  const lines = ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events: IcsProperty[][] = [];
  const stack: string[] = [];
  let current: IcsProperty[] | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const property = parseIcsLine(line);
    if (!property) continue;
    if (property.name === "BEGIN") {
      const component = property.value.trim().toUpperCase();
      stack.push(component);
      if (component === "VEVENT" && current === null) current = [];
      continue;
    }
    if (property.name === "END") {
      const component = stack.pop();
      if (component === "VEVENT" && current !== null && !stack.includes("VEVENT")) {
        events.push(current);
        current = null;
      }
      continue;
    }
    if (current !== null && stack.at(-1) === "VEVENT") current.push(property);
  }
  return events;
}

/** Common Windows zone names Outlook-originated invites carry as TZID. */
const WINDOWS_ZONES: Record<string, string> = {
  "eastern standard time": "America/New_York",
  "central standard time": "America/Chicago",
  "mountain standard time": "America/Denver",
  "us mountain standard time": "America/Phoenix",
  "pacific standard time": "America/Los_Angeles",
  "alaskan standard time": "America/Anchorage",
  "hawaiian standard time": "Pacific/Honolulu",
  "atlantic standard time": "America/Halifax",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "w. europe standard time": "Europe/Berlin",
  "romance standard time": "Europe/Paris",
  "central europe standard time": "Europe/Budapest",
  "aus eastern standard time": "Australia/Sydney",
};

export function resolveTzid(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const cleaned = tzid.trim().replace(/^"|"$/g, "");
  if (isKnownTimeZone(cleaned)) return cleaned;
  // "/mozilla.org/20050126_1/America/New_York" and friends.
  const segments = cleaned.split("/").filter(Boolean);
  for (const take of [2, 3, 1]) {
    const candidate = segments.slice(-take).join("/");
    if (candidate && isKnownTimeZone(candidate) && candidate.includes("/")) return candidate;
  }
  return WINDOWS_ZONES[cleaned.toLowerCase()] ?? null;
}

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };
type IcsTime = { wall: Wall; allDay: boolean; utc: boolean; zone: string };

function parseIcsTime(property: IcsProperty | undefined, studioTimeZone: string): IcsTime | null {
  if (!property) return null;
  const value = property.value.trim().split(",")[0] ?? "";
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date || property.params.VALUE?.toUpperCase() === "DATE") {
    const parts = date ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!parts) return null;
    return {
      wall: { year: Number(parts[1]), month: Number(parts[2]), day: Number(parts[3]), hour: 0, minute: 0, second: 0 },
      allDay: true,
      utc: false,
      zone: studioTimeZone,
    };
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!dateTime) return null;
  return {
    wall: {
      year: Number(dateTime[1]),
      month: Number(dateTime[2]),
      day: Number(dateTime[3]),
      hour: Number(dateTime[4]),
      minute: Number(dateTime[5]),
      second: Number(dateTime[6]),
    },
    allDay: false,
    utc: dateTime[7] === "Z",
    // Floating times (no Z, no TZID) are the studio's own clock.
    zone: resolveTzid(property.params.TZID) ?? studioTimeZone,
  };
}

function toUtc(time: IcsTime, wall: Wall = time.wall): number {
  if (time.utc) return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return zonedWallClockToUtc(wall, time.zone);
}

function addDays(wall: Wall, days: number): Wall {
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return { ...wall, year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** RFC 5545 DURATION -> {days, ms}. Days stay separate so all-day math is by date. */
export function parseIcsDuration(value: string): { days: number; ms: number } | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const days = (Number(match[2] ?? 0) * 7 + Number(match[3] ?? 0)) * sign;
  const ms = ((Number(match[4] ?? 0) * 60 + Number(match[5] ?? 0)) * 60 + Number(match[6] ?? 0)) * 1000 * sign;
  return { days, ms };
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

type Rule = { freq: string; interval: number; count: number | null; untilMs: number | null; byDay: number[] | null };

function parseRule(value: string, studioTimeZone: string): Rule | null {
  const parts = Object.fromEntries(
    value.split(";").map((pair) => {
      const [key, raw] = pair.split("=");
      return [String(key).toUpperCase(), String(raw ?? "")];
    }),
  ) as Record<string, string>;
  const freq = (parts.FREQ ?? "").toUpperCase();
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  // Anything richer than "every N days/weeks(on these days)/months/years" is
  // left to the server's <expand>; see appleBusyFromCalDav.
  for (const unsupported of ["BYMONTHDAY", "BYSETPOS", "BYYEARDAY", "BYWEEKNO", "BYMONTH", "BYHOUR", "BYMINUTE", "BYSECOND"]) {
    if (parts[unsupported]) return null;
  }
  let byDay: number[] | null = null;
  if (parts.BYDAY) {
    if (freq !== "WEEKLY") return null;
    byDay = [];
    for (const token of parts.BYDAY.split(",")) {
      const index = WEEKDAYS.indexOf(token.trim().toUpperCase());
      if (index < 0) return null;
      byDay.push(index);
    }
  }
  let untilMs: number | null = null;
  if (parts.UNTIL) {
    const until = parseIcsTime({ name: "UNTIL", params: {}, value: parts.UNTIL }, studioTimeZone);
    if (!until) return null;
    untilMs = until.allDay ? toUtc(until, addDays(until.wall, 1)) - 1 : toUtc(until);
  }
  const interval = Math.max(1, Number(parts.INTERVAL ?? 1) || 1);
  const count = parts.COUNT ? Math.max(0, Number(parts.COUNT) || 0) : null;
  return { freq, interval, count, untilMs, byDay };
}

const MAX_OCCURRENCES = 2000;

/** Wall-clock starts of a recurring event, in order, from DTSTART on. */
function* occurrences(start: Wall, rule: Rule): Generator<Wall> {
  const weekday = (wall: Wall) => new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  if (rule.freq === "WEEKLY") {
    const days = [...new Set(rule.byDay ?? [weekday(start)])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    // Weeks begin Monday (WKST default).
    const weekStart = addDays(start, -((weekday(start) + 6) % 7));
    for (let week = 0; week < MAX_OCCURRENCES; week += 1) {
      const monday = addDays(weekStart, week * 7 * rule.interval);
      for (const day of days) {
        const candidate = addDays(monday, (day + 6) % 7);
        const candidateKey = Date.UTC(candidate.year, candidate.month - 1, candidate.day);
        if (candidateKey < Date.UTC(start.year, start.month - 1, start.day)) continue;
        yield candidate;
      }
    }
    return;
  }
  for (let step = 0; step < MAX_OCCURRENCES; step += 1) {
    if (rule.freq === "DAILY") {
      yield addDays(start, step * rule.interval);
      continue;
    }
    const months = rule.freq === "MONTHLY" ? step * rule.interval : step * rule.interval * 12;
    const monthIndex = start.month - 1 + months;
    const year = start.year + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    // The 31st in a 30-day month, or 29 February in a common year, does not
    // occur (RFC 5545 §3.3.10): skip it rather than rolling into next month.
    const probe = new Date(Date.UTC(year, month - 1, start.day));
    if (probe.getUTCMonth() !== month - 1) continue;
    yield { ...start, year, month };
  }
}

/**
 * ICS text -> busy intervals overlapping [rangeStartMs, rangeEndMs).
 *
 * - UTC, TZID-zoned and floating times; floating and all-day dates are read
 *   on the studio's clock (`studioTimeZone`).
 * - TRANSP:TRANSPARENT ("show as free") and STATUS:CANCELLED are skipped.
 * - DTEND, else DURATION, else one day for an all-day event; a timed event
 *   with neither is zero-length and blocks nothing.
 * - Recurrence is normally expanded by the server (the REPORT asks for
 *   <expand>). If a VEVENT still carries an RRULE, the simple shapes are
 *   expanded here, EXDATEs honoured; anything richer keeps only its first
 *   occurrence.
 */
export function parseIcsBusy(
  ics: string,
  input: { rangeStartMs: number; rangeEndMs: number; studioTimeZone: string },
): BusyInterval[] {
  const busy: BusyInterval[] = [];
  const push = (startMs: number, endMs: number) => {
    if (!(endMs > startMs)) return;
    if (endMs <= input.rangeStartMs || startMs >= input.rangeEndMs) return;
    busy.push({ start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() });
  };
  for (const properties of icsEvents(ics)) {
    const get = (name: string) => properties.find((property) => property.name === name);
    if ((get("STATUS")?.value ?? "").trim().toUpperCase() === "CANCELLED") continue;
    if ((get("TRANSP")?.value ?? "").trim().toUpperCase() === "TRANSPARENT") continue;
    const start = parseIcsTime(get("DTSTART"), input.studioTimeZone);
    if (!start) continue;
    const end = parseIcsTime(get("DTEND"), input.studioTimeZone);
    const duration = get("DURATION") ? parseIcsDuration(get("DURATION")!.value) : null;

    // Length as (days, ms) so an all-day or DST-spanning event keeps its
    // calendar shape on each recurrence.
    let lengthDays = 0;
    let lengthMs = 0;
    if (end) {
      if (start.allDay && end.allDay) {
        lengthDays = Math.round(
          (Date.UTC(end.wall.year, end.wall.month - 1, end.wall.day) -
            Date.UTC(start.wall.year, start.wall.month - 1, start.wall.day)) /
            86_400_000,
        );
      } else {
        lengthMs = toUtc(end) - toUtc(start);
      }
    } else if (duration) {
      lengthDays = duration.days;
      lengthMs = duration.ms;
    } else if (start.allDay) {
      lengthDays = 1;
    }
    const intervalFor = (wall: Wall): [number, number] => {
      const startMs = toUtc(start, wall);
      if (start.allDay) {
        const endMs = toUtc(start, addDays(wall, lengthDays)) + lengthMs;
        return [startMs, endMs];
      }
      if (lengthDays) {
        return [startMs, toUtc(start, addDays(wall, lengthDays)) + lengthMs];
      }
      return [startMs, startMs + lengthMs];
    };

    const ruleProperty = get("RRULE");
    const rule = ruleProperty && !get("RECURRENCE-ID") ? parseRule(ruleProperty.value, input.studioTimeZone) : null;
    if (!rule) {
      const [startMs, endMs] = intervalFor(start.wall);
      push(startMs, endMs);
      continue;
    }
    const excluded = new Set<number>();
    for (const exdate of properties.filter((property) => property.name === "EXDATE")) {
      for (const value of exdate.value.split(",")) {
        const parsed = parseIcsTime({ ...exdate, value }, input.studioTimeZone);
        if (parsed) excluded.add(toUtc(parsed));
      }
    }
    let produced = 0;
    for (const wall of occurrences(start.wall, rule)) {
      if (rule.count !== null && produced >= rule.count) break;
      const [startMs, endMs] = intervalFor(wall);
      if (rule.untilMs !== null && startMs > rule.untilMs) break;
      if (startMs >= input.rangeEndMs) break;
      produced += 1;
      if (excluded.has(startMs)) continue;
      push(startMs, endMs);
    }
  }
  return busy;
}

// ---------------------------------------------------------------------------
// Network

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class AppleCalendarAuthError extends Error {
  constructor() {
    super("APPLE_CALENDAR_AUTH_FAILED");
  }
}

const basicAuthorization = (appleId: string, appPassword: string) =>
  `Basic ${Buffer.from(`${appleId}:${appPassword}`).toString("base64")}`;

/**
 * One WebDAV request. Redirects are followed by hand, and only to iCloud's
 * own CalDAV hosts: fetch drops Authorization on a cross-host redirect, and
 * following one anywhere else would hand the studio's password to it.
 */
async function davRequest(
  fetchImpl: FetchLike,
  method: "PROPFIND" | "REPORT",
  url: string,
  credentials: { appleId: string; appPassword: string },
  body: string,
  depth: "0" | "1",
): Promise<{ status: number; text: string; url: string }> {
  let target = url;
  for (let hop = 0; hop < 4; hop += 1) {
    if (!isIcloudCalDavUrl(target)) throw new Error("APPLE_CALENDAR_HOST_REJECTED");
    const response = await fetchImpl(target, {
      method,
      redirect: "manual",
      headers: {
        authorization: basicAuthorization(credentials.appleId, credentials.appPassword),
        depth,
        "content-type": "application/xml; charset=utf-8",
        accept: "application/xml, text/xml",
      },
      body,
    });
    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`APPLE_CALENDAR_REDIRECT_INVALID:${response.status}`);
      target = new URL(location, target).toString();
      continue;
    }
    if (response.status === 401 || response.status === 403) throw new AppleCalendarAuthError();
    const text = await response.text().catch(() => "");
    return { status: response.status, text, url: target };
  }
  throw new Error("APPLE_CALENDAR_TOO_MANY_REDIRECTS");
}

const PRINCIPAL_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
const HOME_SET_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>';
const CALENDARS_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>';

/**
 * Principal -> calendar home -> event calendars (RFC 4791 §7.1, RFC 6764).
 * Throws AppleCalendarAuthError on a wrong email or password.
 */
export async function discoverAppleCalendars(input: {
  appleId: string;
  appPassword: string;
  fetchImpl?: FetchLike;
}): Promise<{ principalUrl: string; homeUrl: string; calendars: AppleCalendar[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const credentials = { appleId: input.appleId, appPassword: input.appPassword };
  const root = await davRequest(fetchImpl, "PROPFIND", ICLOUD_CALDAV_ROOT, credentials, PRINCIPAL_BODY, "0");
  if (root.status !== 207) throw new Error(`APPLE_CALENDAR_DISCOVERY_FAILED:${root.status}`);
  const principalUrl = parseCurrentUserPrincipal(root.text, root.url);
  if (!principalUrl) throw new Error("APPLE_CALENDAR_PRINCIPAL_MISSING");
  const principal = await davRequest(fetchImpl, "PROPFIND", principalUrl, credentials, HOME_SET_BODY, "0");
  if (principal.status !== 207) throw new Error(`APPLE_CALENDAR_DISCOVERY_FAILED:${principal.status}`);
  const homeUrl = parseCalendarHomeSet(principal.text, principal.url);
  if (!homeUrl) throw new Error("APPLE_CALENDAR_HOME_MISSING");
  const home = await davRequest(fetchImpl, "PROPFIND", homeUrl, credentials, CALENDARS_BODY, "1");
  if (home.status !== 207) throw new Error(`APPLE_CALENDAR_DISCOVERY_FAILED:${home.status}`);
  const calendars = parseCalendarCollections(home.text, home.url).filter(
    (calendar) => calendar.url.replace(/\/$/, "") !== homeUrl.replace(/\/$/, "") && isIcloudCalDavUrl(calendar.url),
  );
  return { principalUrl, homeUrl, calendars };
}

const icsStamp = (iso: string) =>
  new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function calendarQueryBody(timeMinIso: string, timeMaxIso: string): string {
  const start = icsStamp(timeMinIso);
  const end = icsStamp(timeMaxIso);
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
    `<d:prop><c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data></d:prop>` +
    '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
    `<c:time-range start="${start}" end="${end}"/>` +
    "</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>"
  );
}

/**
 * Busy time across the chosen calendars. A calendar that fails is skipped
 * and named in `skipped` (one deleted calendar must not hide the others);
 * only when every calendar fails is the provider reported as failed. A
 * refused password is reported as `authFailed` so the caller can mark the
 * connection for the studio to reconnect.
 */
export async function appleBusyFromCalDav(input: {
  appleId: string;
  appPassword: string;
  calendarUrls: readonly string[];
  timeMinIso: string;
  timeMaxIso: string;
  studioTimeZone: string;
  fetchImpl?: FetchLike;
}): Promise<FreeBusyResult & { authFailed?: boolean; skipped?: string[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const urls = input.calendarUrls.filter(isIcloudCalDavUrl);
  if (!urls.length) return { ok: false, reason: "APPLE_CALENDAR_NO_CALENDARS" };
  const body = calendarQueryBody(input.timeMinIso, input.timeMaxIso);
  const range = {
    rangeStartMs: Date.parse(input.timeMinIso),
    rangeEndMs: Date.parse(input.timeMaxIso),
    studioTimeZone: input.studioTimeZone,
  };
  const busy: BusyInterval[] = [];
  const skipped: string[] = [];
  for (const url of urls) {
    try {
      const answer = await davRequest(
        fetchImpl,
        "REPORT",
        url,
        { appleId: input.appleId, appPassword: input.appPassword },
        body,
        "1",
      );
      if (answer.status !== 207) {
        skipped.push(`${url}:${answer.status}`);
        continue;
      }
      for (const ics of parseCalendarDataPayloads(answer.text)) {
        busy.push(...parseIcsBusy(ics, range));
      }
    } catch (caught: unknown) {
      if (caught instanceof AppleCalendarAuthError) {
        return { ok: false, reason: caught.message, authFailed: true };
      }
      skipped.push(`${url}:${caught instanceof Error ? caught.message : "FAILED"}`);
    }
  }
  if (skipped.length === urls.length) {
    return { ok: false, reason: `APPLE_CALENDAR_REPORT_FAILED:${skipped[0]}`, skipped };
  }
  return { ok: true, busy, skipped };
}

// ---------------------------------------------------------------------------
// The connection document

/**
 * What an Apple Calendar connection stores in Firestore.
 *
 * Deliberately takes no password: the only way for the app-specific password
 * to reach this document would be to add a parameter here, and
 * tests/calendar-busy-providers.test.ts fails if one appears.
 */
export function appleConnectionRecord(input: {
  tenantId: string;
  appleId: string;
  calendars: readonly AppleCalendar[];
  credentialReference: string | null;
  userId: string;
  now: string;
  mockMode: boolean;
}): Record<string, unknown> {
  const connectionId = `${input.tenantId}_apple_calendar`;
  return {
    id: connectionId,
    tenantId: input.tenantId,
    provider: "apple_calendar",
    status: "connected",
    providerAccountId: input.appleId,
    displayName: input.appleId,
    encryptedCredentialRef: input.credentialReference,
    selectedResourceId: null,
    calendarUrls: input.calendars.map((calendar) => calendar.url),
    calendarNames: input.calendars.map((calendar) => calendar.name),
    scopes: ["caldav:read"],
    connectedAt: input.now,
    lastHealthCheckAt: null,
    lastHealthLatencyMs: null,
    diagnostics: null,
    diagnosticSeverity: null,
    diagnosticRecommendation: null,
    diagnosticFailedJobs7d: null,
    lastError: null,
    mockMode: input.mockMode,
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.userId,
    updatedBy: input.userId,
    archivedAt: null,
  };
}
