import assert from "node:assert/strict";
import test from "node:test";
import {
  omittedKinds,
  proximityWeight,
  rankByUrgency,
  rankWithRepresentation,
  stalenessWeight,
  type RankableItem,
} from "../features/dashboard/urgency.ts";
import {
  describeStudioState,
  greetingFor,
  homeMetrics,
} from "../features/dashboard/home-metrics.ts";

const now = new Date(2026, 7, 18, 9, 0);
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const item = (over: Partial<RankableItem> & { id: string; kind: RankableItem["kind"] }): RankableItem => ({
  title: over.id,
  detail: "",
  href: "#",
  ...over,
});

test("a passed event date outranks everything else of its kind", () => {
  assert.ok(proximityWeight(iso(2026, 8, 15), now) > proximityWeight(iso(2026, 8, 19), now));
  assert.equal(proximityWeight(null, now), 0);
});

test("event proximity is banded, nearer is heavier", () => {
  const near = proximityWeight(iso(2026, 8, 20), now);
  const week = proximityWeight(iso(2026, 8, 24), now);
  const month = proximityWeight(iso(2026, 9, 10), now);
  const far = proximityWeight(iso(2027, 3, 1), now);
  assert.ok(near > week && week > month && month > far);
});

test("staleness accrues but is capped, so one old item cannot dominate", () => {
  const twoDays = stalenessWeight(new Date(2026, 7, 16).toISOString(), now);
  const tenDays = stalenessWeight(new Date(2026, 7, 8).toISOString(), now);
  const hundredDays = stalenessWeight(new Date(2026, 4, 10).toISOString(), now);
  assert.ok(tenDays > twoDays);
  assert.equal(tenDays, hundredDays, "staleness saturates at a week");
});

test("inquiries can no longer bury approvals and exceptions", () => {
  // The exact shape that broke the old queue: four inquiries ahead of everything.
  const items: RankableItem[] = [
    item({ id: "inq-1", kind: "inquiry", updatedAt: new Date(2026, 7, 17).toISOString() }),
    item({ id: "inq-2", kind: "inquiry", updatedAt: new Date(2026, 7, 17).toISOString() }),
    item({ id: "inq-3", kind: "inquiry", updatedAt: new Date(2026, 7, 17).toISOString() }),
    item({ id: "inq-4", kind: "inquiry", updatedAt: new Date(2026, 7, 17).toISOString() }),
    item({ id: "appr-1", kind: "approval", eventDate: iso(2026, 8, 22) }),
    item({ id: "exc-1", kind: "exception", eventDate: iso(2026, 8, 15) }),
  ];
  const ranked = rankByUrgency(items, { now, limit: 5 });
  const ids = ranked.map((entry) => entry.id);
  assert.equal(ids[0], "exc-1", "the slipped event must lead");
  assert.ok(ids.includes("appr-1"), "the approval must survive the cap");
  assert.equal(ranked.length, 5);
});

test("nothing is silently dropped without the UI being able to say so", () => {
  const items: RankableItem[] = [
    item({ id: "exc-1", kind: "exception", eventDate: iso(2026, 8, 15) }),
    item({ id: "exc-2", kind: "exception", eventDate: iso(2026, 8, 16) }),
    item({ id: "inq-1", kind: "inquiry" }),
  ];
  const shown = rankByUrgency(items, { now, limit: 2 });
  assert.deepEqual(omittedKinds(items, shown), ["inquiry"]);
  assert.deepEqual(omittedKinds(items, rankByUrgency(items, { now, limit: 3 })), []);
});

test("ranking is stable for equal scores", () => {
  const items: RankableItem[] = [
    item({ id: "older", kind: "approval", updatedAt: "2026-08-10T00:00:00.000Z" }),
    item({ id: "newer", kind: "approval", updatedAt: "2026-08-17T00:00:00.000Z" }),
  ];
  const a = rankByUrgency(items, { now }).map((entry) => entry.id);
  const b = rankByUrgency([...items].reverse(), { now }).map((entry) => entry.id);
  assert.deepEqual(a, b, "order must not depend on input order");
});

const projects = [
  { id: "p1", name: "Maya & Theo", state: "PLANNING", eventDate: iso(2026, 8, 15), readinessScore: 72 },
  { id: "p2", name: "Sofia & Miles", state: "READY", eventDate: iso(2026, 8, 22), readinessScore: 100 },
  { id: "p3", name: "Northstar", state: "BOOKED", eventDate: iso(2026, 9, 4), readinessScore: 46 },
  { id: "p4", name: "Archived", state: "ARCHIVED", eventDate: iso(2026, 8, 20), readinessScore: 10 },
];
const invoices = [
  { id: "i1", amountCents: 500_000, balanceCents: 0, status: "paid", dueDate: iso(2026, 7, 1) },
  { id: "i2", amountCents: 487_800, balanceCents: 191_000, status: "sent", dueDate: iso(2026, 8, 1) },
];

test("metrics count only active projects", () => {
  const m = homeMetrics({ now, projects, invoiceReferences: invoices });
  assert.equal(m.eventsThisMonth, 2, "August events, excluding the archived one");
  assert.equal(m.needsAttentionCount, 2);
  assert.equal(m.eventPassedCount, 1, "Maya & Theo's date has passed");
});

test("money comes from the invoices the dashboard already fetches", () => {
  const m = homeMetrics({ now, projects, invoiceReferences: invoices });
  assert.equal(m.bookedValueCents, 987_800);
  assert.equal(m.outstandingCents, 191_000);
  assert.equal(m.collectedCents, 796_800);
  assert.equal(m.overdueInvoiceCount, 1);
});

test("the next event skips dates already past", () => {
  const m = homeMetrics({ now, projects, invoiceReferences: invoices });
  assert.equal(m.nextEvent?.name, "Sofia & Miles");
  assert.equal(m.nextEvent?.daysAway, 4);
});

test("metrics tolerate empty inputs", () => {
  const m = homeMetrics({ now });
  assert.equal(m.bookedValueCents, 0);
  assert.equal(m.nextEvent, null);
  assert.equal(m.eventsThisMonth, 0);
});

test("the hero subhead counts real things and never invents work", () => {
  const metrics = homeMetrics({ now, projects, invoiceReferences: invoices });
  const line = describeStudioState({ metrics, approvalCount: 3, workingCount: 2 });
  assert.ok(line);
  assert.match(line, /2 events this month/);
  assert.match(line, /3 drafts ready for your approval/);
  assert.match(line, /2 jobs running/);
  assert.match(line, /1 overdue balance/);
  assert.match(line, /\.$/);
});

test("the subhead is null rather than a hollow claim when nothing is happening", () => {
  const empty = homeMetrics({ now });
  assert.equal(
    describeStudioState({ metrics: empty, approvalCount: 0, workingCount: 0 }),
    null,
  );
});

test("singular and plural both read correctly", () => {
  const metrics = homeMetrics({
    now,
    projects: [projects[0]],
    invoiceReferences: [invoices[1]],
  });
  const line = describeStudioState({ metrics, approvalCount: 1, workingCount: 1 });
  assert.ok(line);
  assert.match(line, /1 event this month/);
  assert.match(line, /1 draft ready/);
  assert.match(line, /1 job running/);
  assert.match(line, /1 overdue balance\./);
});

test("the greeting follows the clock", () => {
  assert.equal(greetingFor(new Date(2026, 7, 18, 8)), "Good morning");
  assert.equal(greetingFor(new Date(2026, 7, 18, 13)), "Good afternoon");
  assert.equal(greetingFor(new Date(2026, 7, 18, 21)), "Good evening");
});

test("no category is invisible, even when one kind dominates on urgency", () => {
  // The real demo tenant: five exceptions outranking seven approvals and three
  // inquiries. Pure urgency showed five exceptions and nothing else.
  const items: RankableItem[] = [
    ...Array.from({ length: 5 }, (_, i) =>
      item({ id: `exc-${i}`, kind: "exception", eventDate: iso(2026, 8, 15 + i) }),
    ),
    ...Array.from({ length: 7 }, (_, i) =>
      item({ id: `appr-${i}`, kind: "approval", eventDate: iso(2026, 9, 4) }),
    ),
    ...Array.from({ length: 3 }, (_, i) => item({ id: `inq-${i}`, kind: "inquiry" })),
  ];

  const pure = rankByUrgency(items, { now, limit: 5 });
  assert.deepEqual(
    [...new Set(pure.map((entry) => entry.kind))],
    ["exception"],
    "baseline: pure urgency hides everything but exceptions",
  );

  const mixed = rankWithRepresentation(items, { now, limit: 5 });
  assert.equal(mixed.length, 5);
  const kinds = new Set(mixed.map((entry) => entry.kind));
  assert.ok(kinds.has("exception") && kinds.has("approval") && kinds.has("inquiry"));
  assert.equal(mixed[0].kind, "exception", "the most urgent item still leads");
  assert.deepEqual(omittedKinds(items, mixed), []);
});

test("representation never pads beyond what exists", () => {
  const items: RankableItem[] = [
    item({ id: "exc-1", kind: "exception" }),
    item({ id: "appr-1", kind: "approval" }),
  ];
  const mixed = rankWithRepresentation(items, { now, limit: 5 });
  assert.equal(mixed.length, 2, "fewer items than the limit are returned as-is");
});

test("representation keeps global severity order in the result", () => {
  const items: RankableItem[] = [
    item({ id: "inq-1", kind: "inquiry" }),
    item({ id: "appr-1", kind: "approval" }),
    item({ id: "exc-1", kind: "exception" }),
    item({ id: "exc-2", kind: "exception" }),
  ];
  const mixed = rankWithRepresentation(items, { now, limit: 3 });
  const scores = mixed.map((entry) => entry.score);
  assert.deepEqual([...scores], [...scores].sort((a, b) => b - a));
});
