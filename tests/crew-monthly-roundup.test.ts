import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import {
  orderRoundup,
  roundupEnabled,
  roundupEntry,
  roundupJobId,
  roundupMonthDue,
} from "../functions/src/crew/monthly-roundup-core.ts";
import { sweepCrewRoundups } from "../functions/src/crew/monthly-roundup.ts";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { cueHandoff } from "@/features/today/handoff";

/**
 * GR, 2026-10-07. Albert: "Once accepted they should be getting a reminder
 * every few months." Gabe: "Can we send out reminders for all jobs booked
 * monthly?" One email a month per crew member per studio, every accepted job
 * still ahead — the call-time reminder two days out was the only note before.
 */

const T = "tenant_gr";
const NY = "America/New_York";
const at = (iso: string) => new Date(iso);
const read = (path: string) => readFileSync(path, "utf8");

const project = (overrides: Record<string, unknown> = {}) => ({
  tenantId: T,
  name: "Maya Brooks Wedding",
  state: "BOOKED",
  eventDate: "2027-03-13",
  timezone: NY,
  venueName: "The Foundry",
  ...overrides,
});
const assignment = (overrides: Record<string, unknown> = {}) => ({
  tenantId: T,
  projectId: "p1",
  crewProfileId: "crew_sam",
  status: "accepted",
  role: "Second photographer",
  arrivalAt: "2027-03-13T17:00:00.000Z",
  ...overrides,
});

test("it goes on the 1st from 9 AM in the studio's zone, catches up to the 3rd, and never after", () => {
  // Nov 1, 8 AM in New York (EST from 2 AM that day): the right day, too early.
  assert.equal(roundupMonthDue(at("2026-11-01T13:00:00Z"), NY), null);
  assert.equal(roundupMonthDue(at("2026-11-01T14:00:00Z"), NY), "2026-11");
  // A missed run is made up on the 2nd and 3rd — the same month's, once.
  assert.equal(roundupMonthDue(at("2026-11-03T20:00:00Z"), NY), "2026-11");
  assert.equal(roundupMonthDue(at("2026-11-04T14:00:00Z"), NY), null);
  // Oct 31, 10 PM in New York is Nov 1 in UTC: not yet.
  assert.equal(roundupMonthDue(at("2026-11-01T02:00:00Z"), NY), null);
});

test("on unless the studio switches it off", () => {
  assert.equal(roundupEnabled({}), true);
  assert.equal(roundupEnabled({ crewOffers: { autoOfferOnBooking: true } }), true);
  assert.equal(roundupEnabled({ crewOffers: { monthlyRoundup: false } }), false);
  assert.equal(roundupEnabled(null), true);
});

test("only accepted jobs on a wedding still going ahead, and still ahead of them", () => {
  const entry = (row: Record<string, unknown>, job: Record<string, unknown> | null) =>
    roundupEntry({ assignmentId: "a1", assignment: row, project: job, tenantId: T, zone: NY, now: at("2026-11-01T14:00:00Z") });
  const listed = entry(assignment(), project());
  assert.deepEqual(listed, {
    assignmentId: "a1",
    projectId: "p1",
    date: "2027-03-13",
    jobName: "Maya Brooks Wedding",
    role: "Second photographer",
    arrivalAt: "2027-03-13T17:00:00.000Z",
    locationName: "The Foundry",
    timezone: NY,
  });
  assert.equal(entry(assignment({ status: "offered" }), project()), null, "an open offer isn't a booking");
  assert.equal(entry(assignment({ status: "withdrawn" }), project()), null);
  assert.equal(entry(assignment(), project({ state: "CANCELLED" })), null);
  assert.equal(entry(assignment(), project({ archivedAt: "2026-10-01" })), null);
  assert.equal(entry(assignment(), project({ state: "LEAD" })), null, "not booked yet");
  assert.equal(entry(assignment(), project({ tenantId: "someone_else" })), null);
  assert.equal(
    entry(assignment({ arrivalAt: "2026-10-20T17:00:00.000Z" }), project({ eventDate: "2026-10-20" })),
    null,
    "already behind them",
  );
  // A quiet (imported) wedding still lists: quiet is about the couple.
  assert.ok(entry(assignment(), project({ clientAutomationsPausedAt: "2026-09-01" })));
});

test("soonest first", () => {
  const base = { assignmentId: "x", projectId: "p", role: null, locationName: null, timezone: NY };
  const ordered = orderRoundup([
    { ...base, date: "2027-06-05", jobName: "June", arrivalAt: null },
    { ...base, date: "2027-03-13", jobName: "March, late", arrivalAt: "2027-03-13T20:00:00Z" },
    { ...base, date: "2027-03-13", jobName: "March, early", arrivalAt: "2027-03-13T15:00:00Z" },
  ]);
  assert.deepEqual(ordered.map((entry) => entry.jobName), ["March, early", "March, late", "June"]);
});

test("the email lists every job — day, job, role, call time, place — and links their jobs page", () => {
  const rendered = renderEmailTemplate({
    key: "crew_monthly_roundup",
    brand: { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null },
    recipientName: "Sam Rivera",
    projectName: null,
    values: {
      timezone: NY,
      actionUrl: "https://studio-cue.com/crew/jobs",
      jobs: [
        { date: "2027-03-13", jobName: "Maya Brooks Wedding", role: "Second photographer", arrivalAt: "2027-03-13T17:00:00.000Z", locationName: "The Foundry", timezone: NY },
        { date: "2027-06-05", jobName: "Chen Wedding", role: null, arrivalAt: null, locationName: null, timezone: NY },
      ],
    },
  });
  assert.equal(rendered.subject, "Your upcoming jobs with GR Productions");
  assert.match(rendered.text, /Hi Sam,/);
  assert.match(rendered.text, /2 jobs still ahead, soonest first/);
  assert.match(rendered.text, /Sat, Mar 13, 2027: Maya Brooks Wedding · Second photographer · call 12:00 PM EST · The Foundry/);
  assert.match(rendered.text, /Sat, Jun 5, 2027: Chen Wedding/);
  assert.match(rendered.html, /Open your jobs/);
  assert.match(rendered.text, /https:\/\/studio-cue\.com\/crew\/jobs/);
});

// ---------- The sweep, in a small in-memory Firestore ----------

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
    readonly filters: Array<[string, unknown]>,
  ) {}
  where(field: string, _op: string, value: unknown) {
    return new FakeQuery(this.db, this.name, [...this.filters, [field, value]]);
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
      .filter((snapshot) => this.filters.every(([field, value]) => snapshot.get(field) === value));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

function world() {
  const db = new FakeDb();
  db.store.set(`tenants/${T}`, { timezone: NY });
  db.store.set("projects/p1", project());
  db.store.set("projects/p2", project({ name: "Chen Wedding", eventDate: "2027-06-05" }));
  db.store.set("projects/p3", project({ name: "Called off", state: "CANCELLED" }));
  db.store.set("crewAssignments/a1", assignment());
  db.store.set("crewAssignments/a2", assignment({ projectId: "p2", arrivalAt: null }));
  db.store.set("crewAssignments/a3", assignment({ projectId: "p3" }));
  db.store.set("crewAssignments/a4", assignment({ crewProfileId: "crew_jo", status: "offered" }));
  db.store.set("crewProfiles/crew_sam", { tenantId: T, name: "Sam Rivera", email: "sam@example.com" });
  db.store.set("crewProfiles/crew_jo", { tenantId: T, name: "Jo Park", email: "jo@example.com" });
  return db;
}
const emailJobs = (db: FakeDb) =>
  [...db.store.entries()].filter(([path]) => path.startsWith("emailJobs/")).map(([, data]) => data);

test("one email per crew member a month, listing only what's still on, and never a second", async () => {
  const db = world();
  const fake = db as unknown as Firestore;
  // Oct 15: nothing is due mid-month.
  assert.deepEqual(await sweepCrewRoundups(fake, at("2026-10-15T14:00:00Z")), { idle: 1 });
  await sweepCrewRoundups(fake, at("2026-11-01T14:00:00Z"));
  await sweepCrewRoundups(fake, at("2026-11-01T15:00:00Z"));
  await sweepCrewRoundups(fake, at("2026-11-02T15:00:00Z"));
  const jobs = emailJobs(db);
  assert.equal(jobs.length, 1, "Jo has only an open offer; Sam gets one list");
  const job = jobs[0]!;
  assert.equal(job.id, roundupJobId(T, "crew_sam", "2026-11"));
  assert.equal(job.type, "crew_monthly_roundup");
  assert.equal(job.recipient, "sam@example.com");
  assert.equal(job.recipientName, "Sam Rivera");
  assert.deepEqual(job.assignmentIds, ["a1", "a2"], "the cancelled wedding is not on it");
  assert.match(String(job.actionUrl), /\/crew\/jobs$/);
  // Next month, the next list.
  await sweepCrewRoundups(fake, at("2026-12-01T14:00:00Z"));
  assert.equal(emailJobs(db).length, 2);
});

test("a studio that switched it off sends none", async () => {
  const db = world();
  db.store.set(`tenants/${T}`, { timezone: NY, crewOffers: { monthlyRoundup: false } });
  await sweepCrewRoundups(db as unknown as Firestore, at("2026-11-01T14:00:00Z"));
  assert.equal(emailJobs(db).length, 0);
});

test("it is read again as it sends, said on Today, held when billing lapses, and wired to deploy", () => {
  const worker = read("functions/src/operations/jobs.ts");
  assert.match(worker, /type === "crew_monthly_roundup" && Array\.isArray\(document\.get\("assignmentIds"\)\)/);
  assert.match(read("functions/src/index.ts"), /export \{ crewRoundupScheduler \} from "\.\/crew\/monthly-roundup\.js";/);
  assert.match(read("scripts/configure-production-function-invokers.sh"), /^\s+crewroundupscheduler$/m);
  assert.match(read("functions/src/saas/billing-hold.ts"), /"crew_monthly_roundup",/);
  assert.match(read("components/communications/email-template-designer.tsx"), /"crew_monthly_roundup",/);
  assert.match(read("components/crew/crew-offer-settings.tsx"), /Remind crew of their upcoming jobs every month/);
  assert.match(read("functions/src/crew/commands.ts"), /monthlyRoundup: z\.boolean\(\)\.optional\(\),/);

  const items = cueHandoff({
    now: "2026-11-01T16:00:00Z",
    emailJobs: [
      {
        id: "crew_monthly_roundup_x",
        type: "crew_monthly_roundup",
        status: "succeeded",
        completedAt: "2026-11-01T14:01:00Z",
        createdBy: "crew-roundup-scheduler",
        recipientName: "Sam Rivera",
        jobs: [{}, {}],
      },
    ],
  });
  assert.deepEqual(items.map((item) => item.line), ["Reminded Sam Rivera of their 2 upcoming jobs"]);
});
