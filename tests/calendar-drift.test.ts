import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { driftFrom, sweepCalendarDrift } from "../functions/src/integrations/calendar-drift.ts";
import { todayInbox } from "@/features/today/inbox";

/**
 * Google Calendar read back (docs/roadmap.md, "Google Calendar inbound sync"):
 * a call deleted or moved in the studio's calendar is marked for the owner,
 * never cancelled or moved by Google.
 */
const call = { startsAt: "2026-11-03T19:00:00.000Z", endsAt: "2026-11-03T19:30:00.000Z" };

test("what Google says against the call as booked", () => {
  assert.deepEqual(driftFrom(call, null), { kind: "deleted" });
  assert.deepEqual(driftFrom(call, { status: "cancelled" }), { kind: "deleted" });
  // The same instant in another offset is the same time.
  assert.equal(driftFrom(call, { status: "confirmed", start: { dateTime: "2026-11-03T14:00:00-05:00" }, end: { dateTime: "2026-11-03T14:30:00-05:00" } }), null);
  assert.deepEqual(
    driftFrom(call, { status: "confirmed", start: { dateTime: "2026-11-04T19:00:00Z" }, end: { dateTime: "2026-11-04T19:30:00Z" } }),
    { kind: "moved", googleStartsAt: "2026-11-04T19:00:00.000Z", googleEndsAt: "2026-11-04T19:30:00.000Z" },
  );
  // An all-day event has no time to compare.
  assert.equal(driftFrom(call, { status: "confirmed", start: { date: "2026-11-03" }, end: { date: "2026-11-04" } }), null);
});

/** A Firestore with just what the sweep reads and writes. */
function fakeDb(docs: Record<string, Record<string, unknown>>) {
  const store = new Map(Object.entries(docs).map(([path, data]) => [path, { ...data }]));
  const snapshot = (path: string) => ({
    id: path.split("/")[1]!,
    ref: { update: async (patch: Record<string, unknown>) => void store.set(path, { ...store.get(path), ...patch }) },
    get: (field: string) => store.get(path)?.[field],
  });
  const query = (collection: string, filters: Array<[string, unknown]>) => ({
    where: (field: string, _op: string, value: unknown) => query(collection, [...filters, [field, value]]),
    limit: () => query(collection, filters),
    get: async () => ({
      docs: [...store.keys()]
        .filter((path) => path.startsWith(`${collection}/`) && filters.every(([field, value]) => store.get(path)?.[field] === value))
        .map(snapshot),
    }),
  });
  const audits: unknown[] = [];
  return {
    store,
    audits,
    db: {
      collection: (name: string) =>
        name === "auditEvents" ? { doc: () => ({ create: async (data: unknown) => void audits.push(data) }) } : query(name, []),
    },
  };
}

test("the sweep marks a deleted and a moved call, clears one that agrees again, and never touches status", async () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const { db, store, audits } = fakeDb({
    "integrationConnections/g": { tenantId: "t1", provider: "google_calendar", status: "connected" },
    "consultations/gone": { tenantId: "t1", projectId: "p1", status: "scheduled", ...call, calendarEventId: "ev-gone" },
    "consultations/moved": { tenantId: "t1", projectId: "p2", status: "scheduled", ...call, calendarEventId: "ev-moved" },
    "consultations/fine": {
      tenantId: "t1",
      projectId: "p3",
      status: "scheduled",
      ...call,
      calendarEventId: "ev-fine",
      calendarDrift: { kind: "deleted", detectedAt: "2026-10-19T00:00:00Z" },
    },
    "consultations/past": { tenantId: "t1", projectId: "p4", status: "scheduled", startsAt: "2026-10-01T19:00:00Z", endsAt: "2026-10-01T19:30:00Z", calendarEventId: "ev-past" },
    "consultations/kept": {
      tenantId: "t1",
      projectId: "p5",
      status: "scheduled",
      ...call,
      calendarEventId: "ev-kept",
      calendarDrift: { kind: "deleted", detectedAt: "2026-10-20T10:00:00Z", keptAt: "2026-10-20T11:30:00Z" },
    },
  });
  const asked: string[] = [];
  const fakeFetch = (async (url: string) => {
    const id = decodeURIComponent(url.split("/events/")[1]!);
    asked.push(id);
    if (id === "ev-gone") return new Response("", { status: 410 });
    const at = id === "ev-moved" ? ["2026-11-03T20:00:00Z", "2026-11-03T20:30:00Z"] : [call.startsAt, call.endsAt];
    return new Response(JSON.stringify({ status: "confirmed", start: { dateTime: at[0] }, end: { dateTime: at[1] } }), { status: 200 });
  }) as typeof fetch;
  const connect = (async () => ({
    mock: false,
    credential: { accessToken: "token" },
    document: { get: () => "primary" },
  })) as never;
  const tally = await sweepCalendarDrift({ db: db as never, now, connect, fetch: fakeFetch });
  // A past call, and one the owner just kept, are not read.
  assert.deepEqual(asked.sort(), ["ev-fine", "ev-gone", "ev-moved"]);
  assert.deepEqual([tally.marked, tally.cleared], [2, 1]);
  assert.equal((store.get("consultations/gone")!.calendarDrift as { kind: string }).kind, "deleted");
  assert.deepEqual(
    { ...(store.get("consultations/moved")!.calendarDrift as Record<string, unknown>), detectedAt: undefined },
    { kind: "moved", googleStartsAt: "2026-11-03T20:00:00.000Z", googleEndsAt: "2026-11-03T20:30:00.000Z", detectedAt: undefined },
  );
  assert.equal(store.get("consultations/fine")!.calendarDrift, null);
  for (const path of ["consultations/gone", "consultations/moved"]) assert.equal(store.get(path)!.status, "scheduled");
  assert.equal(audits.length, 2);
  // Run again: nothing new to write.
  const again = await sweepCalendarDrift({ db: db as never, now, connect, fetch: fakeFetch });
  assert.deepEqual([again.marked, again.cleared], [0, 0]);
});

test("Today asks the owner, in words, and offers the three answers", () => {
  const inbox = todayInbox({
    now: "2026-10-20T12:00:00.000Z",
    projects: [{ id: "p1", name: "Smith Wedding", state: "PROPOSAL" }],
    consultations: [
      { id: "c1", projectId: "p1", status: "scheduled", timezone: "America/New_York", ...call, calendarDrift: { kind: "deleted", detectedAt: "2026-10-20T11:00:00Z" } },
      {
        id: "c2",
        projectId: "p1",
        status: "scheduled",
        timezone: "America/New_York",
        ...call,
        calendarDrift: { kind: "moved", googleStartsAt: "2026-11-04T19:00:00.000Z", googleEndsAt: "2026-11-04T19:30:00.000Z", detectedAt: "2026-10-20T11:00:00Z" },
      },
      // Kept: the restore job is putting it back.
      { id: "c3", projectId: "p1", status: "scheduled", ...call, calendarDrift: { kind: "deleted", detectedAt: "x", keptAt: "y" } },
      // Cancelled since.
      { id: "c4", projectId: "p1", status: "cancelled", ...call, calendarDrift: { kind: "deleted", detectedAt: "x" } },
    ],
  } as never) as unknown as { act: Array<{ id: string; title: string; detail: string; action: { kind: string; label: string } }> };
  const cards = inbox.act.filter((item) => item.action.kind === "calendar_drift");
  assert.deepEqual(cards.map((card) => card.id).sort(), ["calendar-drift-c1", "calendar-drift-c2"]);
  const gone = cards.find((card) => card.id === "calendar-drift-c1")!;
  assert.equal(gone.title, "A call came off your Google Calendar");
  assert.match(gone.detail, /Tue, Nov 3 at 2:00 PM is still booked here, and your client still has its confirmation/);
  assert.equal(gone.action.label, "Keep it booked");
  const moved = cards.find((card) => card.id === "calendar-drift-c2")!;
  assert.match(moved.detail, /Google has it on Wed, Nov 4 at 2:00 PM\. Here, and in your client's confirmation, it's Tue, Nov 3 at 2:00 PM\./);
  assert.equal(moved.action.label, "Use Google's time");
});

test("wired: the sweep runs, may run, and every answer clears the mark", () => {
  assert.match(readFileSync("functions/src/index.ts", "utf8"), /calendarDriftSweep/);
  assert.match(readFileSync("scripts/configure-production-function-invokers.sh", "utf8"), /^\s+calendardriftsweep$/m);
  const commands = readFileSync("functions/src/booking/commands.ts", "utf8");
  // Cancel and move clear it; keep queues the restore.
  assert.equal((commands.match(/calendarDrift: null,/g) ?? []).length, 2);
  assert.match(commands, /type: "restore_consultation_event"/);
  assert.match(readFileSync("functions/src/operations/jobs.ts", "utf8"), /"restore_consultation_event"\)\s+return restoreConsultationEvent/);
  // Google is never allowed to cancel a call.
  assert.doesNotMatch(readFileSync("functions/src/integrations/calendar-drift.ts", "utf8"), /status: "cancelled"/);
});
