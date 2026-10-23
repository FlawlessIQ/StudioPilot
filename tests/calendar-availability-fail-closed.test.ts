import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CALENDAR_AVAILABILITY_UNAVAILABLE,
  busyForBooking,
  collectBusyIntervals,
  decideCalendarAvailability,
} from "../functions/src/integrations/busy-time.ts";
import { generateConsultationSlots } from "../functions/src/booking/availability.ts";
import { BOOKING_PAUSED_CODE, bookingPaused, bookingPausedCopy } from "@/features/consultations/booking-paused";
import { CONNECTION_CONSEQUENCES as appConsequences } from "@/features/integrations/connection-consequence";
import { CONNECTION_CONSEQUENCES as serverConsequences } from "../functions/src/integrations/connection-alert.ts";

/**
 * Reliability audit, 2026-10-22: when a studio's connected calendar could not
 * be read, "no calendar answered" was treated as "no busy time", so a client's
 * booking link offered hours the studio's calendar already held — a silent
 * double-booking. A connected calendar that cannot be read now fails closed.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const settings = {
  durationMinutes: 45,
  bufferMinutes: 15,
  mode: "closed_default" as const,
  windows: [{ day: "thu" as const, startMinute: 9 * 60, endMinute: 12 * 60 }],
  unavailableWindows: [],
  blockedDates: [],
  meetingFormats: ["zoom" as const],
  inPersonLocation: null,
};
const now = new Date("2026-10-13T12:00:00Z");
// Thursday Oct 15, 9:00–12:00 Eastern: openings at 9, 10 and 11.
const ALL_HOURS = ["2026-10-15T13:00:00.000Z", "2026-10-15T14:00:00.000Z", "2026-10-15T15:00:00.000Z"];
const dentist = { start: "2026-10-15T14:00:00.000Z", end: "2026-10-15T14:45:00.000Z" };

/** The times a client is offered, from the decision alone. */
function offered(calendar: ReturnType<typeof decideCalendarAvailability>): string[] | "closed" {
  const taken = busyForBooking([], calendar);
  if (!taken.bookable) return "closed";
  return generateConsultationSlots({
    settings,
    timezone: "America/New_York",
    now,
    startInDays: 0,
    daysAhead: 4,
    busy: taken.busy,
    maxSlots: 50,
  }).map((slot) => slot.startsAt);
}

test("a calendar read OK: its busy time is subtracted", async () => {
  const calendar = decideCalendarAvailability(
    await collectBusyIntervals({
      providers: ["google_calendar"],
      fetchers: { google_calendar: async () => ({ ok: true, busy: [dentist] }) },
    }),
  );
  assert.equal(calendar.state, "ok");
  assert.deepEqual(offered(calendar), ["2026-10-15T13:00:00.000Z", "2026-10-15T15:00:00.000Z"]);
});

test("no calendar connected: the studio's hours alone, as before", async () => {
  const calendar = decideCalendarAvailability(await collectBusyIntervals({ providers: [], fetchers: {} }));
  assert.deepEqual(calendar, { state: "not_connected" });
  assert.deepEqual(offered(calendar), ALL_HOURS);
});

test("a connected calendar that could not be read fails closed: nothing is offered", async () => {
  for (const fetcher of [
    async () => ({ ok: false as const, reason: "GOOGLE_CALENDAR_FREEBUSY_FAILED:503" }),
    async () => {
      throw new Error("GOOGLE_CALENDAR_TOKEN_REFRESH_FAILED");
    },
  ]) {
    const calendar = decideCalendarAvailability(
      await collectBusyIntervals({ providers: ["google_calendar"], fetchers: { google_calendar: fetcher } }),
    );
    assert.equal(calendar.state, "unavailable");
    assert.equal(offered(calendar), "closed");
  }
  assert.deepEqual(busyForBooking([], { state: "unavailable", reason: "X", failures: [] }), {
    bookable: false,
    reason: CALENDAR_AVAILABILITY_UNAVAILABLE,
  });
});

test("one of several connected calendars failing fails closed too: its busy time is unknown", async () => {
  const calendar = decideCalendarAvailability(
    await collectBusyIntervals({
      providers: ["google_calendar", "outlook_calendar"],
      fetchers: {
        google_calendar: async () => ({ ok: true, busy: [dentist] }),
        outlook_calendar: async () => ({ ok: false, reason: "OUTLOOK_CALENDAR_VIEW_FAILED:500" }),
      },
    }),
  );
  assert.equal(calendar.state, "unavailable");
  assert.deepEqual(calendar.state === "unavailable" && calendar.failures.map((failure) => failure.provider), ["outlook_calendar"]);
  assert.equal(offered(calendar), "closed");
});

test("a broken connection (marked error) still counts as connected, not as none", () => {
  const runtime = read("functions/src/operations/provider-runtime.ts");
  const reader = runtime.slice(runtime.indexOf("export async function getCalendarBusyIntervals"));
  // Read every connection, not only "connected" ones: a calendar marked
  // "error" would otherwise read as "not connected" one request later.
  assert.match(reader, /collection\("integrationConnections"\)\.where\("tenantId","==",tenantId\)\.get\(\)/);
  assert.match(reader, /status"\)==="error"/);
  assert.match(reader, /_CONNECTION_BROKEN:/);
  assert.match(reader, /availability=decideCalendarAvailability\(collected\)/);
});

test("the studio learns about it: the broken-connection email, or one operational error an hour", () => {
  const runtime = read("functions/src/operations/provider-runtime.ts");
  const report = runtime.slice(runtime.indexOf("async function reportCalendarUnavailable"));
  assert.match(report, /queueConnectionBrokenAlert\(db,/);
  assert.match(report, /studiocueOperationalError:true/);
  assert.match(report, /code:CALENDAR_AVAILABILITY_UNAVAILABLE/);
  assert.match(report, /publicRateLimits\/calendar_unavailable_\$\{tenantId\}/);
  assert.match(runtime, /CALENDAR_UNAVAILABLE_ALERT_WINDOW_MS=60\*60\*1000/);
  // What the email says stops is what now happens, on both copies.
  for (const provider of ["google_calendar", "outlook_calendar", "apple_calendar"]) {
    assert.match(serverConsequences[provider]!.stops, /booking links won't offer clients any times until you reconnect/);
    assert.equal(appConsequences[provider]!.stops, serverConsequences[provider]!.stops);
  }
});

test("every place a client picks a time refuses while the calendar can't be read", () => {
  const scheduling = read("functions/src/booking/public-scheduling.ts");
  assert.match(scheduling, /return busyForBooking\(busy, await getCalendarBusyIntervals\(tenantId, fromIso, toIso\)\);/);
  // Both slot builders (a call's link and a trial's week) answer with the flag.
  assert.equal(scheduling.match(/if \(!taken\.bookable\) return \{[^}]*\.\.\.bookingPaused\(\) \};/g)?.length, 2);
  assert.match(scheduling, /bookingUnavailable: true, reason: CALENDAR_AVAILABILITY_UNAVAILABLE/);
  // Booking from the link and from the couple's inquiry page both refuse.
  assert.equal(scheduling.match(/if \(availability\.bookingUnavailable\) throw new Error\("CALENDAR_AVAILABILITY_UNAVAILABLE"\);/g)?.length, 2);
  assert.equal(BOOKING_PAUSED_CODE, CALENDAR_AVAILABILITY_UNAVAILABLE);
  // No reader of the calendar still treats an unread one as free.
  for (const path of [
    "functions/src/booking/public-scheduling.ts",
    "functions/src/booking/consultation-availability-query.ts",
    "functions/src/contracts/amendments.ts",
  ]) {
    assert.doesNotMatch(read(path), /\.ok\) busy\.push|busy\.ok &&|calendar\.ok/, path);
  }
  const studioQuery = read("functions/src/booking/consultation-availability-query.ts");
  assert.match(studioQuery, /calendarAvailability: calendar\.state/);
  assert.match(read("functions/src/contracts/amendments.ts"), /Your calendar couldn't be read, so check you're free then\./);
});

test("the client is told plainly, in the studio's name", () => {
  assert.equal(
    bookingPausedCopy("Lumen Studio"),
    "Online booking is briefly unavailable. Please contact Lumen Studio directly — reply to their email and they’ll find a time with you.",
  );
  assert.match(bookingPausedCopy(""), /Please contact the studio directly/);
  assert.equal(bookingPaused({ bookingUnavailable: true, slots: [] }), true);
  assert.equal(bookingPaused({ slots: [] }), false);
  assert.equal(bookingPaused(null), false);

  const scheduler = read("components/booking/public-consultation-scheduler.tsx");
  assert.match(scheduler, /setPaused\(bookingPaused\(availability\)\);/);
  assert.match(scheduler, /<Note icon=\{CalendarDays\}>\{bookingPausedCopy\(preview\?\.studioName\)\}<\/Note>/);
  assert.match(scheduler, /\(status === "ready" \|\| status === "booking"\) && !paused \?/);
  assert.match(scheduler, /caught\.message === BOOKING_PAUSED_CODE/);

  const inquiry = read("components/inquiries/couple-inquiry-page.tsx");
  assert.match(inquiry, /setPaused\(bookingPaused\(result\)\);/);
  assert.match(inquiry, /<Note icon=\{CalendarDays\}>\{bookingPausedCopy\(preview\.studioName\)\}<\/Note>/);
  assert.match(inquiry, /step === "time" && !noCall && preview\?\.takesBookings && !paused \?/);
  assert.match(inquiry, /caught\.message === BOOKING_PAUSED_CODE/);

  // The studio's own calendar says its links are offering nothing.
  assert.match(
    read("components/booking/studio-calendar.tsx"),
    /calendarAvailability === "unavailable" \?[\s\S]*?booking links aren&apos;t offering clients/,
  );
});
