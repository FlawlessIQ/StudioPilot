import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BUSY_TIME_PROVIDERS,
  collectBusyIntervals,
  unionBusyIntervals,
  zonedWallClockToUtc,
} from "../functions/src/integrations/busy-time.ts";
import {
  graphCalendarViewUrl,
  outlookBusyFromGraph,
  parseGraphCalendarView,
} from "../functions/src/integrations/outlook-calendar.ts";
import {
  AppleCalendarAuthError,
  appleBusyFromCalDav,
  appleConnectionRecord,
  calendarQueryBody,
  discoverAppleCalendars,
  isIcloudCalDavUrl,
  normalizeAppSpecificPassword,
  parseCalendarCollections,
  parseCalendarDataPayloads,
  parseCalendarHomeSet,
  parseCurrentUserPrincipal,
  parseIcsBusy,
  resolveTzid,
} from "../functions/src/integrations/apple-calendar.ts";
import { MICROSOFT_CALENDAR_SCOPES, oauthClientPrefix } from "../functions/src/integrations/provider-config.ts";
import { providerUsesPkce } from "../functions/src/integrations/oauth-strategy.ts";
import { busyTimeProviders, offeredProviders, providerCapabilities } from "@/features/integrations/schema";
import { formatStudioTime, formatStudioTimeRange } from "@/features/consultations/studio-time";

/**
 * "Consultation availability… can this read someone's Google Calendar or Apple
 * calendar or Outlook calendar???" — a real studio, 2026-10-01. It read Google
 * only. These pin the two new readers, the union across all three, and the
 * studio-calendar timezone bug found on the way.
 */

const REPO = process.cwd();
const read = (path: string) => readFileSync(`${REPO}/${path}`, "utf8");

// ---------------------------------------------------------------------------
// Outlook (Microsoft Graph calendarView)

test("Graph calendarView: busy, tentative and away block; free, elsewhere and cancelled do not", () => {
  const body = {
    value: [
      { showAs: "busy", isAllDay: false, start: { dateTime: "2026-10-03T14:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-03T15:00:00.0000000", timeZone: "UTC" } },
      { showAs: "tentative", start: { dateTime: "2026-10-04T09:30:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-04T10:00:00.0000000", timeZone: "UTC" } },
      { showAs: "oof", start: { dateTime: "2026-10-05T12:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-05T13:00:00", timeZone: "UTC" } },
      { showAs: "free", start: { dateTime: "2026-10-06T12:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-06T13:00:00", timeZone: "UTC" } },
      { showAs: "workingElsewhere", start: { dateTime: "2026-10-07T12:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-07T13:00:00", timeZone: "UTC" } },
      { showAs: "busy", isCancelled: true, start: { dateTime: "2026-10-08T12:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-08T13:00:00", timeZone: "UTC" } },
    ],
  };
  assert.deepEqual(parseGraphCalendarView(body, "America/New_York"), [
    { start: "2026-10-03T14:00:00.000Z", end: "2026-10-03T15:00:00.000Z" },
    { start: "2026-10-04T09:30:00.000Z", end: "2026-10-04T10:00:00.000Z" },
    { start: "2026-10-05T12:00:00.000Z", end: "2026-10-05T13:00:00.000Z" },
  ]);
});

test("Graph all-day events land on the studio's day, not midnight UTC", () => {
  const body = {
    value: [
      { showAs: "busy", isAllDay: true, start: { dateTime: "2026-10-03T00:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-04T00:00:00.0000000", timeZone: "UTC" } },
    ],
  };
  assert.deepEqual(parseGraphCalendarView(body, "America/New_York"), [
    { start: "2026-10-03T04:00:00.000Z", end: "2026-10-04T04:00:00.000Z" },
  ]);
});

test("Graph times named in an IANA zone are honoured even if the UTC preference is ignored", () => {
  const body = {
    value: [
      { showAs: "busy", start: { dateTime: "2026-10-03T10:00:00", timeZone: "America/Chicago" }, end: { dateTime: "2026-10-03T11:00:00", timeZone: "America/Chicago" } },
    ],
  };
  assert.deepEqual(parseGraphCalendarView(body, "America/New_York"), [
    { start: "2026-10-03T15:00:00.000Z", end: "2026-10-03T16:00:00.000Z" },
  ]);
});

test("Outlook reader follows Graph's paging, asks for UTC, and never sends the token elsewhere", async () => {
  const seen: Array<{ url: string; prefer: string | null; authorization: string | null }> = [];
  const first = graphCalendarViewUrl("2026-10-01T00:00:00.000Z", "2026-10-31T00:00:00.000Z");
  const pages: Record<string, unknown> = {
    [first]: {
      value: [{ showAs: "busy", start: { dateTime: "2026-10-03T14:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-03T15:00:00", timeZone: "UTC" } }],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=abc",
    },
    "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=abc": {
      value: [{ showAs: "busy", start: { dateTime: "2026-10-09T14:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-09T15:00:00", timeZone: "UTC" } }],
    },
  };
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({ url, prefer: headers.get("prefer"), authorization: headers.get("authorization") });
    return new Response(JSON.stringify(pages[url] ?? {}), { status: 200 });
  };
  const result = await outlookBusyFromGraph({
    accessToken: "token-123",
    timeMinIso: "2026-10-01T00:00:00.000Z",
    timeMaxIso: "2026-10-31T00:00:00.000Z",
    studioTimeZone: "America/New_York",
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.busy.length, 2);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((call) => call.prefer === 'outlook.timezone="UTC"'));
  assert.ok(seen.every((call) => call.authorization === "Bearer token-123"));

  const hostile = await outlookBusyFromGraph({
    accessToken: "token-123",
    timeMinIso: "2026-10-01T00:00:00.000Z",
    timeMaxIso: "2026-10-31T00:00:00.000Z",
    studioTimeZone: "UTC",
    fetchImpl: async () =>
      new Response(JSON.stringify({ value: [], "@odata.nextLink": "https://evil.example/next" }), { status: 200 }),
  });
  assert.deepEqual(hostile, { ok: false, reason: "OUTLOOK_CALENDAR_NEXT_LINK_REJECTED" });
});

test("Outlook asks Microsoft for read-only calendar access, with PKCE, under MICROSOFT_* config", () => {
  assert.deepEqual([...MICROSOFT_CALENDAR_SCOPES], ["offline_access", "Calendars.Read"]);
  assert.ok(!MICROSOFT_CALENDAR_SCOPES.some((scope) => /ReadWrite/i.test(scope)));
  assert.equal(oauthClientPrefix("outlook_calendar"), "MICROSOFT");
  assert.equal(oauthClientPrefix("google_calendar"), "GOOGLE_CALENDAR");
  assert.equal(providerUsesPkce("outlook_calendar"), true);
});

// ---------------------------------------------------------------------------
// Apple (CalDAV)

const PRINCIPAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:"><response><href>/</href><propstat><prop><current-user-principal><href>/123456789/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;

const HOME_XML = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/123456789/principal/</d:href>
<d:propstat><d:prop><cal:calendar-home-set><d:href xmlns:d="DAV:">https://p52-caldav.icloud.com:443/123456789/calendars/</d:href></cal:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
</d:response></d:multistatus>`;

const CALENDARS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:">
 <response><href>/123456789/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype><displayname>home</displayname></prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/123456789/calendars/home/</href><propstat><prop><resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Home &amp; Studio</displayname><supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VEVENT"/></supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/123456789/calendars/tasks/</href><propstat><prop><resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Reminders</displayname><supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VTODO"/></supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
 <response><href>/123456789/calendars/inbox/</href><propstat><prop><resourcetype><collection/><schedule-inbox xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat>
   <propstat><prop><displayname/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response>
 <response><href>/123456789/calendars/work/</href><propstat><prop><resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Work</displayname></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>`;

test("CalDAV discovery parses principal, home set and event calendars in either namespace style", () => {
  assert.equal(
    parseCurrentUserPrincipal(PRINCIPAL_XML, "https://caldav.icloud.com/"),
    "https://caldav.icloud.com/123456789/principal/",
  );
  assert.equal(
    parseCalendarHomeSet(HOME_XML, "https://caldav.icloud.com/123456789/principal/"),
    "https://p52-caldav.icloud.com/123456789/calendars/",
  );
  assert.deepEqual(parseCalendarCollections(CALENDARS_XML, "https://p52-caldav.icloud.com/123456789/calendars/"), [
    { url: "https://p52-caldav.icloud.com/123456789/calendars/home/", name: "Home & Studio" },
    { url: "https://p52-caldav.icloud.com/123456789/calendars/work/", name: "Work" },
  ]);
});

const NY = "America/New_York";
const RANGE = {
  rangeStartMs: Date.parse("2026-10-01T00:00:00Z"),
  rangeEndMs: Date.parse("2026-11-01T00:00:00Z"),
  studioTimeZone: NY,
};

const vcal = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iCloud//EN", ...events, "END:VCALENDAR"].join("\r\n");

test("ICS: UTC, TZID, floating and all-day times; transparent and cancelled are not busy", () => {
  const ics = vcal(
    "BEGIN:VEVENT\r\nUID:utc\r\nDTSTART:20261003T140000Z\r\nDTEND:20261003T150000Z\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:tz\r\nDTSTART;TZID=America/Los_Angeles:20261004T090000\r\nDTEND;TZID=America/Los_Angeles:20261004T100000\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M\r\nDTSTART:19990101T000000Z\r\nEND:VALARM\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:floating\r\nDTSTART:20261005T110000\r\nDURATION:PT30M\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:allday\r\nDTSTART;VALUE=DATE:20261006\r\nDTEND;VALUE=DATE:20261007\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:allday-nodtend\r\nDTSTART;VALUE=DATE:20261009\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:free\r\nDTSTART:20261007T140000Z\r\nDTEND:20261007T150000Z\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:cancelled\r\nDTSTART:20261008T140000Z\r\nDTEND:20261008T150000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:outside\r\nDTSTART:20261203T140000Z\r\nDTEND:20261203T150000Z\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:zero\r\nDTSTART:20261010T140000Z\r\nEND:VEVENT",
  );
  assert.deepEqual(parseIcsBusy(ics, RANGE), [
    { start: "2026-10-03T14:00:00.000Z", end: "2026-10-03T15:00:00.000Z" },
    { start: "2026-10-04T16:00:00.000Z", end: "2026-10-04T17:00:00.000Z" },
    { start: "2026-10-05T15:00:00.000Z", end: "2026-10-05T15:30:00.000Z" },
    { start: "2026-10-06T04:00:00.000Z", end: "2026-10-07T04:00:00.000Z" },
    { start: "2026-10-09T04:00:00.000Z", end: "2026-10-10T04:00:00.000Z" },
  ]);
});

test("ICS: folded lines, quoted and path-style TZIDs, Windows zone names", () => {
  const ics = vcal(
    'BEGIN:VEVENT\r\nUID:folded\r\nSUMMARY:A long\r\n  title\r\nDTSTART;TZID="/mozilla.org/20050126_1/America/Chicago":20261012T\r\n 090000\r\nDTEND;TZID="/mozilla.org/20050126_1/America/Chicago":20261012T100000\r\nEND:VEVENT',
    "BEGIN:VEVENT\r\nUID:win\r\nDTSTART;TZID=Pacific Standard Time:20261013T090000\r\nDTEND;TZID=Pacific Standard Time:20261013T093000\r\nEND:VEVENT",
  );
  assert.deepEqual(parseIcsBusy(ics, RANGE), [
    { start: "2026-10-12T14:00:00.000Z", end: "2026-10-12T15:00:00.000Z" },
    { start: "2026-10-13T16:00:00.000Z", end: "2026-10-13T16:30:00.000Z" },
  ]);
  assert.equal(resolveTzid("Europe/London"), "Europe/London");
  assert.equal(resolveTzid("Not/AZone"), null);
});

test("ICS: an unexpanded weekly RRULE is expanded here, EXDATE and COUNT honoured", () => {
  const ics = vcal(
    "BEGIN:VEVENT\r\nUID:weekly\r\nDTSTART;TZID=America/New_York:20261005T100000\r\nDTEND;TZID=America/New_York:20261005T110000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4\r\nEXDATE;TZID=America/New_York:20261007T100000\r\nEND:VEVENT",
  );
  assert.deepEqual(parseIcsBusy(ics, RANGE), [
    { start: "2026-10-05T14:00:00.000Z", end: "2026-10-05T15:00:00.000Z" },
    { start: "2026-10-12T14:00:00.000Z", end: "2026-10-12T15:00:00.000Z" },
    { start: "2026-10-14T14:00:00.000Z", end: "2026-10-14T15:00:00.000Z" },
  ]);
});

test("ICS: a daily rule keeps the wall-clock time across the DST change", () => {
  const ics = vcal(
    "BEGIN:VEVENT\r\nUID:daily\r\nDTSTART;TZID=America/New_York:20261030T090000\r\nDTEND;TZID=America/New_York:20261030T093000\r\nRRULE:FREQ=DAILY;UNTIL=20261103T235959Z\r\nEND:VEVENT",
  );
  const busy = parseIcsBusy(ics, { ...RANGE, rangeEndMs: Date.parse("2026-11-05T00:00:00Z") });
  assert.deepEqual(
    busy.map((interval) => interval.start),
    [
      "2026-10-30T13:00:00.000Z",
      "2026-10-31T13:00:00.000Z",
      "2026-11-01T14:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "2026-11-03T14:00:00.000Z",
    ],
  );
});

test("CalDAV REPORT answers are decoded, including entity-escaped and CDATA calendar data", () => {
  const ics = vcal("BEGIN:VEVENT\r\nUID:x\r\nDTSTART:20261003T140000Z\r\nDTEND:20261003T150000Z\r\nEND:VEVENT");
  const escaped = ics.replace(/\r\n/g, "&#13;\n");
  const xml = `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
<response><href>/1/calendars/home/a.ics</href><propstat><prop><C:calendar-data>${escaped}</C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/1/calendars/home/b.ics</href><propstat><prop><C:calendar-data><![CDATA[${ics.replaceAll("20261003", "20261004")}]]></C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>`;
  const payloads = parseCalendarDataPayloads(xml);
  assert.equal(payloads.length, 2);
  const busy = payloads.flatMap((payload) => parseIcsBusy(payload, RANGE));
  assert.deepEqual(busy.map((interval) => interval.start), [
    "2026-10-03T14:00:00.000Z",
    "2026-10-04T14:00:00.000Z",
  ]);
  const body = calendarQueryBody("2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
  assert.match(body, /<c:time-range start="20261001T000000Z" end="20261101T000000Z"\/>/);
  assert.match(body, /<c:expand start="20261001T000000Z"/);
});

type Call = { method: string; url: string; authorization: string | null; depth: string | null };

function icloud(responses: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ method: String(init?.method), url, authorization: headers.get("authorization"), depth: headers.get("depth") });
    const answer = responses[`${init?.method} ${url}`];
    return answer ? answer() : new Response("", { status: 404 });
  };
  return { calls, fetchImpl };
}

const multistatus = (xml: string) => () => new Response(xml, { status: 207 });

test("Apple discovery walks principal -> home -> calendars, following iCloud's redirect by hand", async () => {
  const { calls, fetchImpl } = icloud({
    "PROPFIND https://caldav.icloud.com/": () =>
      new Response("", { status: 301, headers: { location: "https://p52-caldav.icloud.com/" } }),
    "PROPFIND https://p52-caldav.icloud.com/": multistatus(PRINCIPAL_XML),
    "PROPFIND https://p52-caldav.icloud.com/123456789/principal/": multistatus(HOME_XML),
    "PROPFIND https://p52-caldav.icloud.com/123456789/calendars/": multistatus(CALENDARS_XML),
  });
  const found = await discoverAppleCalendars({ appleId: "studio@icloud.com", appPassword: "abcd-efgh-ijkl-mnop", fetchImpl });
  assert.deepEqual(found.calendars.map((calendar) => calendar.name), ["Home & Studio", "Work"]);
  const basic = `Basic ${Buffer.from("studio@icloud.com:abcd-efgh-ijkl-mnop").toString("base64")}`;
  assert.ok(calls.every((call) => call.authorization === basic));
  assert.deepEqual(calls.map((call) => call.depth), ["0", "0", "0", "1"]);
});

test("Apple discovery: a refused password is an auth error; a redirect off iCloud is refused", async () => {
  const refused = icloud({ "PROPFIND https://caldav.icloud.com/": () => new Response("", { status: 401 }) });
  await assert.rejects(
    discoverAppleCalendars({ appleId: "a@icloud.com", appPassword: "abcd-efgh-ijkl-mnop", fetchImpl: refused.fetchImpl }),
    (error: unknown) => error instanceof AppleCalendarAuthError && error.message === "APPLE_CALENDAR_AUTH_FAILED",
  );
  const hijack = icloud({
    "PROPFIND https://caldav.icloud.com/": () =>
      new Response("", { status: 302, headers: { location: "https://evil.example/collect" } }),
  });
  await assert.rejects(
    discoverAppleCalendars({ appleId: "a@icloud.com", appPassword: "abcd-efgh-ijkl-mnop", fetchImpl: hijack.fetchImpl }),
    /APPLE_CALENDAR_HOST_REJECTED/,
  );
  assert.equal(hijack.calls.length, 1, "credentials were sent to a non-iCloud host");
  assert.equal(isIcloudCalDavUrl("https://p7-caldav.icloud.com/1/calendars/home/"), true);
  assert.equal(isIcloudCalDavUrl("http://caldav.icloud.com/"), false);
  assert.equal(isIcloudCalDavUrl("https://caldav.icloud.com.evil.example/"), false);
});

test("Apple busy: one failing calendar is skipped; a refused password is flagged", async () => {
  const report = `<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>/1/calendars/home/a.ics</href><propstat><prop><calendar-data xmlns="urn:ietf:params:xml:ns:caldav">${vcal(
    "BEGIN:VEVENT\nUID:a\nDTSTART:20261003T140000Z\nDTEND:20261003T150000Z\nEND:VEVENT",
  )}</calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
  const home = "https://p52-caldav.icloud.com/1/calendars/home/";
  const gone = "https://p52-caldav.icloud.com/1/calendars/deleted/";
  const partial = icloud({ [`REPORT ${home}`]: multistatus(report) });
  const result = await appleBusyFromCalDav({
    appleId: "a@icloud.com",
    appPassword: "abcd-efgh-ijkl-mnop",
    calendarUrls: [home, gone, "https://evil.example/cal/"],
    timeMinIso: "2026-10-01T00:00:00.000Z",
    timeMaxIso: "2026-11-01T00:00:00.000Z",
    studioTimeZone: NY,
    fetchImpl: partial.fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.busy, [{ start: "2026-10-03T14:00:00.000Z", end: "2026-10-03T15:00:00.000Z" }]);
  assert.equal(result.skipped?.length, 1);
  assert.ok(!partial.calls.some((call) => call.url.includes("evil.example")));

  const revoked = icloud({ [`REPORT ${home}`]: () => new Response("", { status: 401 }) });
  const refused = await appleBusyFromCalDav({
    appleId: "a@icloud.com",
    appPassword: "abcd-efgh-ijkl-mnop",
    calendarUrls: [home],
    timeMinIso: "2026-10-01T00:00:00.000Z",
    timeMaxIso: "2026-11-01T00:00:00.000Z",
    studioTimeZone: NY,
    fetchImpl: revoked.fetchImpl,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.authFailed, true);
});

test("only an app-specific password is accepted, never an Apple ID password", () => {
  assert.equal(normalizeAppSpecificPassword("abcd-efgh-ijkl-mnop"), "abcd-efgh-ijkl-mnop");
  assert.equal(normalizeAppSpecificPassword(" ABCD efgh-IJKL mnop "), "abcd-efgh-ijkl-mnop");
  assert.equal(normalizeAppSpecificPassword("abcdefghijklmnop"), "abcd-efgh-ijkl-mnop");
  assert.equal(normalizeAppSpecificPassword("MyApplePassword1!"), null);
  assert.equal(normalizeAppSpecificPassword("short"), null);
});

// ---------------------------------------------------------------------------
// Union across providers

test("busy intervals from several calendars are unioned and merged", () => {
  assert.deepEqual(
    unionBusyIntervals([
      [{ start: "2026-10-03T14:00:00Z", end: "2026-10-03T15:00:00Z" }],
      [
        { start: "2026-10-03T14:30:00.000Z", end: "2026-10-03T16:00:00.000Z" },
        { start: "2026-10-04T09:00:00.000Z", end: "2026-10-04T09:00:00.000Z" },
        { start: "garbage", end: "2026-10-04T10:00:00.000Z" },
      ],
      [{ start: "2026-10-02T10:00:00.000Z", end: "2026-10-02T11:00:00.000Z" }],
    ]),
    [
      { start: "2026-10-02T10:00:00.000Z", end: "2026-10-02T11:00:00.000Z" },
      { start: "2026-10-03T14:00:00.000Z", end: "2026-10-03T16:00:00.000Z" },
    ],
  );
});

test("one provider failing or throwing never fails the slot list", async () => {
  const collected = await collectBusyIntervals({
    providers: ["google_calendar", "outlook_calendar", "apple_calendar"],
    fetchers: {
      google_calendar: async () => ({ ok: true, busy: [{ start: "2026-10-03T14:00:00.000Z", end: "2026-10-03T15:00:00.000Z" }] }),
      outlook_calendar: async () => {
        throw new Error("OUTLOOK_CALENDAR_TOKEN_REFRESH_FAILED");
      },
      apple_calendar: async () => ({ ok: false, reason: "APPLE_CALENDAR_AUTH_FAILED" }),
    },
  });
  assert.equal(collected.ok, true);
  assert.deepEqual(collected.ok && collected.sources, ["google_calendar"]);
  assert.deepEqual(collected.ok && collected.busy, [{ start: "2026-10-03T14:00:00.000Z", end: "2026-10-03T15:00:00.000Z" }]);
  assert.deepEqual(
    collected.failures.map((failure) => failure.provider).sort(),
    ["apple_calendar", "outlook_calendar"],
  );

  const none = await collectBusyIntervals({ providers: [], fetchers: {} });
  assert.deepEqual(none, { ok: false, reason: "CALENDAR_NOT_CONNECTED", failures: [] });

  const allFailed = await collectBusyIntervals({
    providers: ["apple_calendar"],
    fetchers: { apple_calendar: async () => ({ ok: false, reason: "APPLE_CALENDAR_AUTH_FAILED" }) },
  });
  assert.equal(allFailed.ok, false);
  assert.equal(!allFailed.ok && allFailed.reason, "APPLE_CALENDAR_AUTH_FAILED");
});

test("zoned wall-clock conversion handles DST and unknown zones", () => {
  const wall = { year: 2026, month: 7, day: 1, hour: 9, minute: 0, second: 0 };
  assert.equal(new Date(zonedWallClockToUtc(wall, NY)).toISOString(), "2026-07-01T13:00:00.000Z");
  assert.equal(new Date(zonedWallClockToUtc({ ...wall, month: 12 }, NY)).toISOString(), "2026-12-01T14:00:00.000Z");
  assert.equal(new Date(zonedWallClockToUtc(wall, "Nope/Zone")).toISOString(), "2026-07-01T09:00:00.000Z");
});

test("the server and the app agree on which providers give busy time, and those are read-only", () => {
  assert.deepEqual([...busyTimeProviders].sort(), [...BUSY_TIME_PROVIDERS].sort());
  for (const provider of ["outlook_calendar", "apple_calendar"] as const) {
    assert.ok(offeredProviders.has(provider));
    // Never the "calendar" capability: that is writing events, and stays Google's.
    assert.deepEqual([...providerCapabilities[provider]], []);
  }
  const runtime = read("functions/src/operations/provider-runtime.ts");
  const fetchers = /const freeBusyFetchers[^{]*\{([\s\S]*?)\};/.exec(runtime)?.[1] ?? "";
  for (const provider of BUSY_TIME_PROVIDERS) assert.match(fetchers, new RegExp(`${provider}:`));
});

// ---------------------------------------------------------------------------
// Secrets stay out of Firestore

test("the Apple connection document cannot carry the password", () => {
  const record = appleConnectionRecord({
    tenantId: "tenant_1",
    appleId: "studio@icloud.com",
    calendars: [{ url: "https://p52-caldav.icloud.com/1/calendars/home/", name: "Home" }],
    credentialReference: "projects/p/secrets/studiohub-tenant_1-apple_calendar/versions/latest",
    userId: "user_1",
    now: "2026-10-01T00:00:00.000Z",
    mockMode: false,
  });
  assert.ok(!JSON.stringify(record).includes("abcd-efgh"));
  assert.ok(!Object.keys(record).some((key) => /password|secret|token/i.test(key)));

  const source = read("functions/src/integrations/apple-calendar.ts");
  const signature = /export function appleConnectionRecord\(input: \{([\s\S]*?)\}\)/.exec(source)?.[1] ?? "";
  assert.ok(signature.length > 0, "appleConnectionRecord signature not found");
  assert.doesNotMatch(signature, /password/i, "appleConnectionRecord must not take a password");
});

test("the app-specific password goes to Secret Manager only — never a Firestore write or a log", () => {
  const oauth = read("functions/src/integrations/oauth.ts");
  const handler = oauth.slice(oauth.indexOf("async function connectAppleCalendar"), oauth.indexOf("export const integrationOAuth"));
  assert.ok(handler.length > 0, "connectAppleCalendar not found");
  // The only place the normalized password is passed on is the vault.
  const uses = handler.split("\n").filter((line) => /\bappPassword\b/.test(line));
  for (const line of uses) {
    assert.doesNotMatch(line, /\.(set|update|create)\(|console\./, `password near a write or log: ${line.trim()}`);
  }
  assert.match(handler, /saveCredential\(input\.tenantId, "apple_calendar", \{\s*accessToken: appPassword,/);
  // Writes go through the record builder that cannot take one.
  assert.match(handler, /appleConnectionRecord\(\{/);
  // A validation failure must not echo the request (which holds the password).
  assert.doesNotMatch(handler, /parsed\.error\.message|JSON\.stringify\(body\)|JSON\.stringify\(parsed/);
});

test("Outlook's client secret is never bound at deploy time (it would fail every deploy until it exists)", () => {
  const functionsIndexed = [
    "functions/src/integrations/oauth.ts",
    "functions/src/booking/public-scheduling.ts",
    "functions/src/booking/consultation-availability-query.ts",
    "functions/src/operations/jobs.ts",
    "functions/src/operations/task-queue.ts",
  ];
  for (const file of functionsIndexed) {
    const secrets = [...read(file).matchAll(/secrets:\s*\[([\s\S]*?)\]/g)].map((match) => match[1]).join(",");
    assert.doesNotMatch(secrets, /MICROSOFT_CLIENT_SECRET/, `${file} binds MICROSOFT_CLIENT_SECRET`);
  }
  assert.match(read("functions/src/integrations/oauth.ts"), /platformSecret\("MICROSOFT_CLIENT_SECRET"\)/);
  assert.match(read("functions/src/operations/provider-runtime.ts"), /platformSecret\("MICROSOFT_CLIENT_SECRET"\)/);
  assert.match(read("scripts/configure-production-secrets.sh"), /^\s+MICROSOFT_CLIENT_SECRET$/m);
});

test("no new Cloud Function: Apple and Outlook ride the existing integration endpoints, which are on the invoker allowlist", () => {
  const index = read("functions/src/index.ts");
  assert.doesNotMatch(index, /outlook|apple|calendarBusy/i);
  assert.match(index, /integrationOAuth as integrationOAuthEast4/);
  const invokers = read("scripts/configure-production-function-invokers.sh");
  for (const service of ["integrationoautheast4", "consultationavailabilityquery", "publicconsultationscheduling"]) {
    assert.match(invokers, new RegExp(`^\\s+${service}$`, "m"), `${service} missing from the invoker allowlist`);
  }
});

// ---------------------------------------------------------------------------
// Studio calendar: the studio's clock, not the browser's

test("studio times format in the studio's zone whatever the reader's zone is", () => {
  const startsAt = "2026-10-03T18:00:00.000Z";
  const endsAt = "2026-10-03T18:45:00.000Z";
  assert.equal(formatStudioTime(startsAt, "America/New_York"), "2:00 PM");
  assert.equal(formatStudioTime(startsAt, "America/Los_Angeles"), "11:00 AM");
  assert.equal(formatStudioTime(startsAt, "Europe/London"), "7:00 PM");
  assert.equal(formatStudioTimeRange(startsAt, endsAt, "America/New_York"), "2:00 PM – 2:45 PM");
  assert.equal(formatStudioTime("not a date", "America/New_York"), "");
  // An unknown zone falls back rather than throwing during render.
  assert.match(formatStudioTime(startsAt, "Not/AZone"), /^\d{1,2}:\d{2} [AP]M$/);
});

test("the studio calendar shows and sends the studio's timezone, never the browser's", () => {
  const calendar = read("components/booking/studio-calendar.tsx");
  assert.doesNotMatch(calendar, /resolvedOptions\(\)\.timeZone/, "a command still sends the browser's zone");
  assert.doesNotMatch(calendar, /"h:mm a"/, "a time is still drawn on the browser's clock");
  assert.match(calendar, /formatStudioTimeRange\(/);
});
