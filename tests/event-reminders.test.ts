import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import {
  CREW_REMINDER_DAYS_BEFORE,
  EVENT_REMINDER_DAYS_BEFORE,
  coupleReminderDecision,
  crewReminderDecision,
  crewReminderJobId,
  crewReminderPlan,
  eventReminderHold,
  eventReminderJobId,
  resolveEventZone,
  zonedCalendarDate,
} from "../functions/src/communications/event-reminders-core.ts";
import { sweepEventReminders } from "../functions/src/communications/event-reminders.ts";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";

/**
 * The couple's week-of reminder and each accepted crew member's call-time
 * reminder. Both templates existed for months with nothing queuing them.
 *
 * Every instant below is chosen against Los Angeles, where the UTC date is
 * already tomorrow from 5 PM: a scheduler reading "today" in UTC sends a day
 * early, and reads a 7 PM call as the next day's.
 */

const T = "tenant_a";
const P = "project_1";
const LA = "America/Los_Angeles";
const at = (iso: string) => new Date(iso);

const booked = (overrides: Record<string, unknown> = {}) => ({
  tenantId: T,
  name: "Avery & Sam",
  state: "BOOKED",
  eventDate: "2026-10-10",
  timezone: LA,
  venueName: "Hollow Oak Barn",
  clientContactIds: ["c1"],
  ...overrides,
});

const couple = (project: Record<string, unknown>, now: string) =>
  coupleReminderDecision({ tenantId: T, projectId: P, project, now: at(now), zone: LA });

// ---------- The couple: a week before, in the wedding's own zone ----------

test("the couple's reminder opens seven days out, at 9 AM in the wedding's zone — not UTC's", () => {
  assert.equal(EVENT_REMINDER_DAYS_BEFORE, 7);
  // Oct 3 01:00 UTC is still Oct 2, 6 PM in Los Angeles: a day early in UTC.
  assert.equal(zonedCalendarDate(at("2026-10-03T01:00:00Z"), "UTC"), "2026-10-03");
  assert.deepEqual(couple(booked(), "2026-10-03T01:00:00Z"), { send: false, reason: "not_yet" });
  // Oct 3, 8 AM in LA: the right day, too early.
  assert.deepEqual(couple(booked(), "2026-10-03T15:00:00Z"), { send: false, reason: "not_yet" });
  // Oct 3, 9 AM in LA.
  assert.deepEqual(couple(booked(), "2026-10-03T16:00:00Z"), {
    send: true,
    id: eventReminderJobId(T, P, "2026-10-10"),
    eventDate: "2026-10-10",
    zone: LA,
  });
});

test("a booking made inside the window is reminded at once, but not in the last two days", () => {
  // Oct 6, 7 AM LA: past the first day, so no 9 AM floor.
  assert.equal(couple(booked(), "2026-10-06T14:00:00Z").send, true);
  // Oct 8 is two days out — the last day it goes.
  assert.equal(couple(booked(), "2026-10-08T23:00:00Z").send, true);
  // Oct 9, LA: the day-before checklist is the note now.
  assert.deepEqual(couple(booked(), "2026-10-09T16:00:00Z"), { send: false, reason: "too_late" });
});

test("one reminder per job and wedding date, however often the scheduler runs", () => {
  const first = couple(booked(), "2026-10-03T16:00:00Z");
  const later = couple(booked(), "2026-10-05T20:00:00Z");
  assert.ok(first.send && later.send);
  assert.equal(first.id, later.id);
  // A wedding moved to the 17th gets the reminder for the 17th.
  const moved = couple(booked({ eventDate: "2026-10-17" }), "2026-10-10T16:00:00Z");
  assert.ok(moved.send);
  assert.notEqual(moved.id, first.id);
});

test("a quiet, called-off, put-away or unbooked job never reminds the couple", () => {
  const now = "2026-10-05T18:00:00Z";
  // An imported booking arrives quiet until the studio brings the couple in (ADR 0005).
  assert.deepEqual(couple(booked({ clientAutomationsPausedAt: "2026-09-01T00:00:00Z" }), now), {
    send: false,
    reason: "automations_paused",
  });
  assert.deepEqual(couple(booked({ state: "CANCELLED" }), now), { send: false, reason: "cancelled" });
  assert.deepEqual(couple(booked({ state: "LOST" }), now), { send: false, reason: "cancelled" });
  assert.deepEqual(couple(booked({ state: "POSTPONED" }), now), { send: false, reason: "on_hold" });
  assert.deepEqual(couple(booked({ archivedAt: "2026-10-01T00:00:00Z" }), now), { send: false, reason: "put_away" });
  assert.deepEqual(couple(booked({ state: "PROPOSAL_SENT" }), now), { send: false, reason: "not_booked" });
  for (const state of ["PLANNING", "READY"]) assert.equal(couple(booked({ state }), now).send, true);
});

test("a queued couple reminder is read against the job again as it sends", () => {
  const job = { tenantId: T, projectId: P, eventDate: "2026-10-10", timezone: LA };
  const now = at("2026-10-05T18:00:00Z");
  assert.equal(eventReminderHold({ job, project: booked(), now }), null);
  assert.equal(eventReminderHold({ job, project: booked({ eventDate: "2026-10-17" }), now }), "date_changed");
  assert.equal(eventReminderHold({ job, project: booked({ state: "CANCELLED" }), now }), "cancelled");
  assert.equal(eventReminderHold({ job, project: booked({ state: "POSTPONED" }), now }), "on_hold");
  assert.equal(eventReminderHold({ job, project: booked({ clientAutomationsPausedAt: "x" }), now }), "automations_paused");
  assert.equal(eventReminderHold({ job, project: booked({ state: "EVENT_IN_PROGRESS" }), now }), "not_booked");
  assert.equal(eventReminderHold({ job, project: booked({ tenantId: "other" }), now }), "job_missing");
  assert.equal(eventReminderHold({ job, project: null, now }), "job_missing");
  // A retry stuck until the day: the day itself is too late.
  assert.equal(eventReminderHold({ job, project: booked(), now: at("2026-10-10T16:00:00Z") }), "event_passed");
});

// ---------- Crew: two days before their call ----------

const accepted = (overrides: Record<string, unknown> = {}) => ({
  tenantId: T,
  projectId: P,
  crewProfileId: "crew_1",
  role: "Second photographer",
  status: "accepted",
  // 10:00 AM PDT on the 10th, to 6:00 PM.
  arrivalAt: "2026-10-10T17:00:00.000Z",
  departureAt: "2026-10-11T01:00:00.000Z",
  locations: [{ name: "Hollow Oak Barn", address: "41 Ridge Road, Ojai, CA" }],
  currentScheduleId: "schedule_2",
  ...overrides,
});

const crew = (assignment: Record<string, unknown>, project: Record<string, unknown>, now: string) =>
  crewReminderDecision({ tenantId: T, assignmentId: "a1", assignment, project, now: at(now), zone: LA });

test("crew hear two days before their call, at 9 AM in the wedding's zone", () => {
  assert.equal(CREW_REMINDER_DAYS_BEFORE, 2);
  assert.deepEqual(crew(accepted(), booked(), "2026-10-08T15:00:00Z"), { send: false, reason: "not_yet" });
  assert.deepEqual(crew(accepted(), booked(), "2026-10-08T16:00:00Z"), {
    send: true,
    id: crewReminderJobId(T, "a1", "2026-10-10"),
    callDate: "2026-10-10",
    zone: LA,
  });
  // After the call time there is nothing to remind them of.
  assert.deepEqual(crew(accepted(), booked(), "2026-10-10T17:00:00Z"), { send: false, reason: "past" });
});

test("a 7 PM call is that evening's, not the next UTC day's", () => {
  // Oct 10 02:00 UTC is Oct 9, 7 PM in Los Angeles: a rehearsal-dinner call.
  const evening = accepted({ arrivalAt: "2026-10-10T02:00:00.000Z" });
  const decision = crew(evening, booked(), "2026-10-07T16:00:00Z");
  assert.deepEqual(decision, { send: true, id: crewReminderJobId(T, "a1", "2026-10-09"), callDate: "2026-10-09", zone: LA });
});

test("only accepted crew on a job still going ahead are reminded — quiet jobs included", () => {
  const now = "2026-10-08T18:00:00Z";
  for (const status of ["invited", "offered", "declined", "withdrawn", "cancelled", "expired"])
    assert.deepEqual(crew(accepted({ status }), booked(), now), { send: false, reason: "not_accepted" });
  assert.deepEqual(crew(accepted({ archivedAt: "x" }), booked(), now), { send: false, reason: "not_accepted" });
  assert.deepEqual(crew(accepted(), booked({ state: "CANCELLED" }), now), { send: false, reason: "cancelled" });
  assert.deepEqual(crew(accepted(), booked({ state: "POSTPONED" }), now), { send: false, reason: "on_hold" });
  assert.deepEqual(crew(accepted(), booked({ archivedAt: "x" }), now), { send: false, reason: "put_away" });
  // Quiet is about the couple: crew who accepted through StudioCue still hear.
  assert.equal(crew(accepted(), booked({ clientAutomationsPausedAt: "x" }), now).send, true);
});

test("with no call time on the assignment, the job's date and venue stand in", () => {
  const bare = accepted({ arrivalAt: null, departureAt: null, locations: [] });
  const decision = crew(bare, booked(), "2026-10-08T16:00:00Z");
  assert.deepEqual(decision, { send: true, id: crewReminderJobId(T, "a1", "2026-10-10"), callDate: "2026-10-10", zone: LA });
  // Without a time, the day itself is too late.
  assert.deepEqual(crew(bare, booked(), "2026-10-10T08:00:00Z"), { send: false, reason: "past" });
  const plan = crewReminderPlan({
    job: { tenantId: T, projectId: P, assignmentId: "a1", callDate: "2026-10-10", timezone: LA },
    assignment: bare,
    project: booked(),
    now: at("2026-10-08T16:01:00Z"),
  });
  assert.ok("values" in plan);
  assert.equal(plan.values.locationName, "Hollow Oak Barn");
  assert.equal(plan.values.arrivalAt, null);
  assert.equal(plan.values.callDate, "2026-10-10");
});

test("a queued crew reminder says the call time as the assignment has it now", () => {
  const job = { tenantId: T, projectId: P, assignmentId: "a1", callDate: "2026-10-10", timezone: LA };
  const now = at("2026-10-08T16:01:00Z");
  // Moved an hour earlier since it was queued: the email says 9 AM.
  const earlier = crewReminderPlan({ job, assignment: accepted({ arrivalAt: "2026-10-10T16:00:00.000Z" }), project: booked(), now });
  assert.ok("values" in earlier);
  assert.equal(earlier.values.arrivalAt, "2026-10-10T16:00:00.000Z");
  assert.equal(earlier.values.runOfShowShared, true);
  // Moved to another day: that day's reminder is its own.
  assert.deepEqual(crewReminderPlan({ job, assignment: accepted({ arrivalAt: "2026-10-11T17:00:00.000Z" }), project: booked(), now }), {
    hold: "call_date_changed",
  });
  assert.deepEqual(crewReminderPlan({ job, assignment: accepted({ status: "withdrawn" }), project: booked(), now }), { hold: "not_accepted" });
  assert.deepEqual(crewReminderPlan({ job, assignment: accepted(), project: booked({ state: "CANCELLED" }), now }), { hold: "cancelled" });
  assert.deepEqual(crewReminderPlan({ job, assignment: null, project: booked(), now }), { hold: "assignment_missing" });
  assert.deepEqual(crewReminderPlan({ job, assignment: accepted({ tenantId: "other" }), project: booked(), now }), { hold: "assignment_missing" });
});

test("an unknown zone falls back to the studio's, then UTC", () => {
  assert.equal(resolveEventZone("Not/AZone", "America/Chicago"), "America/Chicago");
  assert.equal(resolveEventZone(null, ""), "UTC");
});

// ---------- The emails carry the link that is their point ----------

const brand = {
  studioName: "GR Productions",
  productName: "StudioCue",
  accentColor: "#35664a",
  logoUrl: null,
  contactEmail: "hello@example.com",
};

test("the crew reminder names the call time in the wedding's clock, the place, and links the day sheet", () => {
  const rendered = renderEmailTemplate({
    key: "crew_reminder",
    brand,
    recipientName: "Jordan Lee",
    projectName: "Avery & Sam",
    values: {
      timezone: LA,
      role: "Second photographer",
      arrivalAt: "2026-10-10T17:00:00.000Z",
      departureAt: "2026-10-11T01:00:00.000Z",
      callDate: "2026-10-10",
      locationName: "Hollow Oak Barn",
      locationAddress: "41 Ridge Road, Ojai, CA",
      runOfShowShared: true,
      scheduleUrl: "https://studio-cue.com/crew/schedule?assignment=a1",
    },
  });
  assert.match(rendered.subject, /October 10, 2026/);
  assert.match(rendered.text, /Hi Jordan,/);
  assert.match(rendered.text, /Call time: October 10, 2026 at 10:00 AM PDT, until 6:00 PM PDT/);
  assert.match(rendered.text, /Where: Hollow Oak Barn — 41 Ridge Road, Ojai, CA/);
  assert.match(rendered.text, /Role: Second photographer/);
  assert.match(rendered.text, /crew\/schedule\?assignment=a1/);
  assert.match(rendered.html, /Open your day sheet/);
  assert.doesNotMatch(rendered.text, /update from your studio|Action needed/i);
});

test("before the run of show is out, the crew reminder says so — and still links the day sheet", () => {
  const rendered = renderEmailTemplate({
    key: "crew_reminder",
    brand,
    recipientName: "Jordan Lee",
    projectName: "Avery & Sam",
    values: {
      timezone: LA,
      callDate: "2026-10-10",
      locationName: "Hollow Oak Barn",
      runOfShowShared: false,
      scheduleUrl: "https://studio-cue.com/crew/schedule?assignment=a1",
    },
  });
  assert.match(rendered.text, /hasn't published the run of show yet/);
  assert.match(rendered.text, /October 10, 2026/);
  assert.match(rendered.text, /crew\/schedule\?assignment=a1/);
});

test("the couple's reminder links their timeline first, and their portal under it", () => {
  const withTimeline = renderEmailTemplate({
    key: "event_reminder",
    brand,
    recipientName: "Avery Stone",
    projectName: "Avery & Sam",
    values: {
      timezone: LA,
      eventDate: "2026-10-10",
      scheduleUrl: "https://studio-cue.com/client/schedule",
      portalUrl: "https://studio-cue.com/client",
    },
  });
  assert.match(withTimeline.text, /on October 10, 2026/);
  assert.match(withTimeline.html, /See your timeline/);
  assert.match(withTimeline.text, /https:\/\/studio-cue\.com\/client\/schedule/);
  assert.match(withTimeline.text, /Your project portal: https:\/\/studio-cue\.com\/client/);

  const portalOnly = renderEmailTemplate({
    key: "event_reminder",
    brand,
    recipientName: "Avery Stone",
    projectName: "Avery & Sam",
    values: { timezone: LA, eventDate: "2026-10-10", portalUrl: "https://studio-cue.com/client" },
  });
  assert.match(portalOnly.html, /Open your portal/);
  assert.doesNotMatch(portalOnly.html, /See your timeline/);
});

// ---------- The sweep: idempotent, in a small in-memory Firestore ----------

type Data = Record<string, unknown>;
class FakeDb {
  store = new Map<string, Data>();
  doc(path: string) {
    return {
      id: path.split("/").pop()!,
      path,
      get: async () => this.snapshot(path),
      create: async (data: Data) => {
        if (this.store.has(path)) throw Object.assign(new Error("already exists"), { code: 6 });
        this.store.set(path, structuredClone(data));
      },
    };
  }
  snapshot(path: string) {
    const data = this.store.get(path);
    return {
      exists: data !== undefined,
      id: path.split("/").pop()!,
      get: (field: string) => data?.[field],
      data: () => (data ? structuredClone(data) : undefined),
    };
  }
  collection(name: string) {
    return new FakeQuery(this, name, []);
  }
}
class FakeQuery {
  constructor(
    readonly db: FakeDb,
    readonly name: string,
    readonly filters: Array<[string, string, unknown]>,
  ) {}
  where(field: string, op: string, value: unknown) {
    return new FakeQuery(this.db, this.name, [...this.filters, [field, op, value]]);
  }
  orderBy() {
    return this;
  }
  limit() {
    return this;
  }
  startAfter() {
    return this;
  }
  async get() {
    const docs = [...this.db.store.keys()]
      .filter((path) => path.startsWith(`${this.name}/`))
      .map((path) => this.db.snapshot(path))
      .filter((snapshot) =>
        this.filters.every(([field, op, value]) => {
          const actual = snapshot.get(field) as string;
          if (op === ">=") return actual >= (value as string);
          if (op === "<=") return actual <= (value as string);
          return actual === value;
        }),
      );
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

function world() {
  const db = new FakeDb();
  db.store.set(`tenants/${T}`, { timezone: "America/New_York" });
  db.store.set(`projects/${P}`, booked());
  db.store.set("contacts/c1", { tenantId: T, email: "avery@example.com" });
  db.store.set("crewAssignments/a1", accepted());
  db.store.set("crewAssignments/a2", accepted({ crewProfileId: "crew_2", status: "declined" }));
  db.store.set("crewProfiles/crew_1", { tenantId: T, name: "Jordan Lee", email: "jordan@example.com" });
  db.store.set("crewProfiles/crew_2", { tenantId: T, name: "Riley Park", email: "riley@example.com" });
  db.store.set("schedules/schedule_2", {
    tenantId: T,
    projectId: P,
    status: "published",
    items: [{ visibility: "shared", title: "Ceremony" }],
  });
  return db;
}

const emailJobs = (db: FakeDb) =>
  [...db.store.entries()].filter(([path]) => path.startsWith("emailJobs/")).map(([, data]) => data);

test("the sweep queues one couple and one crew reminder, and never a second", async () => {
  const db = world();
  // Oct 8, 9 AM in Los Angeles: both are due.
  const now = at("2026-10-08T16:00:00Z");
  await sweepEventReminders(db as unknown as Firestore, now);
  await sweepEventReminders(db as unknown as Firestore, at("2026-10-08T17:00:00Z"));
  await sweepEventReminders(db as unknown as Firestore, at("2026-10-09T01:00:00Z"));
  const jobs = emailJobs(db);
  assert.equal(jobs.length, 2, JSON.stringify(jobs.map((job) => job.id)));
  const coupleJob = jobs.find((job) => job.type === "event_reminder")!;
  assert.equal(coupleJob.id, eventReminderJobId(T, P, "2026-10-10"));
  assert.equal(coupleJob.timezone, LA, "the wedding's zone, not the studio's");
  assert.equal(coupleJob.clientOutreachGuard, true);
  assert.match(String(coupleJob.scheduleUrl), /\/client\/schedule$/);
  assert.match(String(coupleJob.portalUrl), /\/client$/);
  const crewJob = jobs.find((job) => job.type === "crew_reminder")!;
  assert.equal(crewJob.id, crewReminderJobId(T, "a1", "2026-10-10"));
  assert.equal(crewJob.recipient, "jordan@example.com");
  assert.equal(crewJob.recipientName, "Jordan Lee");
  assert.equal(crewJob.assignmentId, "a1");
  assert.match(String(crewJob.scheduleUrl), /\/crew\/schedule\?assignment=a1$/);
  assert.equal(crewJob.arrivalAt, "2026-10-10T17:00:00.000Z");
  assert.equal(crewJob.locationAddress, "41 Ridge Road, Ojai, CA");
});

test("the sweep writes nothing to a quiet couple, but still reminds its crew", async () => {
  const db = world();
  db.store.set(`projects/${P}`, booked({ clientAutomationsPausedAt: "2026-09-01T00:00:00Z" }));
  await sweepEventReminders(db as unknown as Firestore, at("2026-10-08T16:00:00Z"));
  assert.deepEqual(
    emailJobs(db).map((job) => job.type),
    ["crew_reminder"],
  );
});

test("no client email, no couple job — and it is looked for again next run", async () => {
  const db = world();
  db.store.set("contacts/c1", { tenantId: T, email: "" });
  await sweepEventReminders(db as unknown as Firestore, at("2026-10-05T16:00:00Z"));
  assert.equal(emailJobs(db).length, 0);
  db.store.set("contacts/c1", { tenantId: T, email: "avery@example.com" });
  await sweepEventReminders(db as unknown as Firestore, at("2026-10-05T17:00:00Z"));
  assert.deepEqual(emailJobs(db).map((job) => job.type), ["event_reminder"]);
});

// ---------- Wiring ----------

const read = (path: string) => readFileSync(path, "utf8");

test("the scheduler is exported and allowed to be invoked", () => {
  assert.match(read("functions/src/index.ts"), /eventReminderScheduler/);
  assert.match(
    read("scripts/configure-production-function-invokers.sh"),
    /^\s+eventreminderscheduler$/m,
    "a scheduler missing here 403s after the next invoker reset",
  );
});

test("the email sender reads both reminders against the job as they go", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /eventReminderHoldFor\(getFirestore\(\), document\)/);
  assert.match(jobs, /crewReminderPlanFor\(getFirestore\(\), document\)/);
  assert.match(jobs, /\.\.\.consultationValues, \.\.\.reminderValues/);
  // event_reminder stays on the held-for-quiet-couples list.
  assert.match(read("functions/src/imports/existing-booking.ts"), /"event_reminder",/);
});
