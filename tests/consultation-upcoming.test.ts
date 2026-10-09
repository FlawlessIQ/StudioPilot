import assert from "node:assert/strict";
import test from "node:test";
import { callLabel, callWhen, nextSalesCall, upcomingCalls } from "../features/consultations/upcoming";

const now = new Date("2026-10-09T19:30:00.000Z");
const call = (over: Record<string, unknown>) => ({
  id: "c",
  projectId: "p1",
  status: "scheduled",
  startsAt: "2026-10-10T16:00:00.000Z",
  endsAt: "2026-10-10T16:45:00.000Z",
  timezone: "America/New_York",
  mode: "in_person",
  archivedAt: null,
  ...over,
});

test("a booked call ahead is listed; cancelled, past and archived ones are not", () => {
  const rows = [
    call({ id: "later", startsAt: "2026-10-12T15:00:00.000Z", endsAt: "2026-10-12T15:45:00.000Z" }),
    call({ id: "soon" }),
    call({ id: "cancelled", status: "cancelled" }),
    call({ id: "rescheduled", status: "rescheduled" }),
    call({ id: "past", startsAt: "2026-10-08T16:00:00.000Z", endsAt: "2026-10-08T16:45:00.000Z" }),
    call({ id: "archived", archivedAt: "2026-10-09T00:00:00.000Z" }),
  ];
  assert.deepEqual(upcomingCalls(rows, now).map((row) => row.id), ["soon", "later"]);
});

test("a call in progress still counts", () => {
  const rows = [call({ startsAt: "2026-10-09T19:15:00.000Z", endsAt: "2026-10-09T20:00:00.000Z" })];
  assert.equal(upcomingCalls(rows, now).length, 1);
});

test("the job's next sales call ignores other jobs and the final details call", () => {
  const rows = [
    call({ id: "other-job", projectId: "p2" }),
    call({ id: "final", purpose: "final_details", startsAt: "2026-10-09T21:00:00.000Z", endsAt: "2026-10-09T21:30:00.000Z" }),
    call({ id: "sales" }),
  ];
  assert.equal(nextSalesCall(rows, "p1", now)?.id, "sales");
  assert.equal(nextSalesCall(rows, "p3", now), null);
});

test("the time is on the call's own clock, with how it happens", () => {
  assert.equal(callWhen(call({})), "Sat, Oct 10 at 12:00 PM");
  assert.equal(callLabel(call({})), "Sat, Oct 10 at 12:00 PM, in person");
  assert.equal(callLabel(call({ mode: "zoom", timezone: "America/Los_Angeles" })), "Sat, Oct 10 at 9:00 AM, on Zoom");
});
