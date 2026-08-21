import assert from "node:assert/strict";
import test from "node:test";
import {
  bookedValueCents,
  handledThisWeek,
  todayInbox,
  type TodayInput,
  type TodayJourneyPosition,
} from "@/features/today/inbox";

const NOW = "2026-08-20T12:00:00.000Z";
const base: TodayInput = { now: NOW };

const journey = (
  overrides: Partial<TodayJourneyPosition> = {},
): TodayJourneyPosition => ({
  projectId: "project-1",
  projectName: "Chen Wedding",
  eventDate: "2027-10-09",
  state: "PROPOSAL",
  stepTitle: "Proposal",
  stepDetail: "Packages and pricing, ready to send",
  owner: "studio",
  actionLabel: "Prepare proposal",
  actionHref: "/studio/proposals/new?project=project-1",
  updatedAt: "2026-08-18T09:00:00.000Z",
  ...overrides,
});

test("an empty studio says so honestly", () => {
  const inbox = todayInbox(base);
  assert.deepEqual(inbox.act, []);
  assert.deepEqual(inbox.approve, []);
  assert.equal(inbox.summary, "Nothing needs you right now.");
});

test("jobs waiting on someone else are counted, not listed", () => {
  const inbox = todayInbox({
    ...base,
    journeys: [
      journey({ owner: "client" }),
      journey({ projectId: "p2", projectName: "Reed", owner: "provider" }),
    ],
  });
  assert.equal(inbox.act.length, 0);
  assert.equal(inbox.inMotion, 2);
  assert.match(inbox.summary, /^Nothing needs you\. 2 jobs are in motion/);
});

test("a job whose next step is yours becomes an Act item carrying that action", () => {
  const inbox = todayInbox({ ...base, journeys: [journey()] });
  assert.equal(inbox.act.length, 1);
  const item = inbox.act[0];
  assert.equal(item?.lane, "act");
  // The outstanding action, not the milestone name: "Chen Wedding —
  // proposal" reads as an announcement that a proposal exists.
  assert.equal(item?.title, "Chen Wedding — prepare proposal");
  assert.deepEqual(item?.action, {
    kind: "link",
    label: "Prepare proposal",
    href: "/studio/proposals/new?project=project-1",
  });
  // Every job-borne moment can open the job.
  assert.equal(item?.jobHref, "/studio/projects/project-1");
});

test("AI-prepared work lands in Approve as an in-place decision", () => {
  const inbox = todayInbox({
    ...base,
    aiActions: [
      {
        id: "ai-1",
        status: "review_required",
        title: "Confirm consultation brief",
        projectId: "project-1",
        updatedAt: "2026-08-20T08:00:00.000Z",
      },
    ],
    journeys: [journey({ owner: "client" })],
  });
  assert.equal(inbox.approve.length, 1);
  const item = inbox.approve[0];
  assert.equal(item?.lane, "approve");
  assert.equal(item?.action.kind, "approve");
  if (item?.action.kind === "approve") assert.equal(item.action.actionId, "ai-1");
  // The project name is resolved from the journey, never re-derived.
  assert.equal(item?.projectName, "Chen Wedding");
});

test("snoozed AI work stays out of the queue until its time", () => {
  const snoozed = todayInbox({
    ...base,
    aiActions: [
      {
        id: "ai-1",
        status: "review_required",
        snoozedUntil: "2026-08-25T00:00:00.000Z",
      },
    ],
  });
  assert.equal(snoozed.approve.length, 0);
  const due = todayInbox({
    ...base,
    aiActions: [
      {
        id: "ai-1",
        status: "review_required",
        snoozedUntil: "2026-08-19T00:00:00.000Z",
      },
    ],
  });
  assert.equal(due.approve.length, 1);
});

test("on the same event, an exception outranks a job step", () => {
  const inbox = todayInbox({
    ...base,
    invoiceReferences: [
      {
        id: "inv-1",
        projectId: "project-1",
        balanceCents: 195000,
        dueDate: "2026-08-01",
        status: "sent",
      },
    ],
    journeys: [journey()],
  });
  assert.equal(inbox.act[0]?.id, "invoice-inv-1");
  assert.equal(inbox.act[1]?.id, "journey-project-1");
});

test("an imminent event outranks admin on a distant one", () => {
  // The deliberate trade-off: a wedding in three days beats an overdue
  // balance on a wedding fourteen months out. Proximity dominates severity,
  // exactly as the shared urgency weights intend.
  const inbox = todayInbox({
    ...base,
    invoiceReferences: [
      {
        id: "inv-1",
        projectId: "project-1",
        balanceCents: 195000,
        dueDate: "2026-08-01",
        status: "sent",
      },
    ],
    journeys: [
      journey(),
      journey({
        projectId: "p2",
        projectName: "Soon Wedding",
        eventDate: "2026-08-22",
        stepTitle: "Run of show",
      }),
    ],
  });
  assert.equal(inbox.act[0]?.id, "journey-p2");
  assert.equal(inbox.act[1]?.id, "invoice-inv-1");
  assert.equal(inbox.act[2]?.id, "journey-project-1");
});

test("an invoice with no due date is never reported as overdue", () => {
  const inbox = todayInbox({
    ...base,
    invoiceReferences: [
      { id: "inv-1", balanceCents: 500000, dueDate: "", status: "sent" },
    ],
  });
  assert.equal(inbox.act.length, 0);
});

test("completed receipts are FYI, never work", () => {
  const inbox = todayInbox({
    ...base,
    actionReceipts: [
      {
        id: "r-1",
        status: "completed",
        title: "Booking completed automatically",
        summary: "Signature and retainer verified.",
        projectId: "project-1",
      },
    ],
    journeys: [journey({ owner: "client" })],
  });
  assert.equal(inbox.fyi.length, 1);
  assert.equal(inbox.fyi[0]?.action.kind, "none");
  // FYI never inflates the "needs you" count.
  assert.match(inbox.summary, /^Nothing needs you\./);
});

test("a nameless inquiry is titled once, not twice", () => {
  const inbox = todayInbox({ ...base, leads: [{ id: "lead-1", status: "new" }] });
  assert.equal(inbox.act[0]?.title, "New inquiry");
});

test("the summary adds what the heading cannot say", () => {
  const inbox = todayInbox({
    ...base,
    aiActions: [{ id: "ai-1", status: "review_required", title: "Draft" }],
    journeys: [journey(), journey({ projectId: "p2", owner: "client" })],
  });
  assert.equal(inbox.summary, "1 only you can do · 1 ready to approve · 1 in motion.");
});

test("a job blocked by missing setup is not also told to proceed", () => {
  // The contradiction this replaces: "Smith can't be priced until a package
  // exists" shown beside "Smith — prepare proposal".
  const inbox = todayInbox({
    ...base,
    setupGaps: [
      {
        key: "packages",
        title: "Add your packages",
        detail: "Smith Wedding can't get a proposal until a package exists.",
        actionLabel: "Add a package",
        href: "/studio/packages/new",
        blocking: true,
        blockedProjectName: "Smith Wedding",
      },
    ],
    journeys: [
      journey({ projectId: "smith", projectName: "Smith Wedding" }),
      journey({ projectId: "chen", projectName: "Chen Wedding" }),
    ],
  });
  const ids = inbox.act.map((item) => item.id);
  assert.ok(ids.includes("setup-packages"));
  assert.ok(!ids.includes("journey-smith"), "blocked job must not also appear");
  // An unblocked job is untouched.
  assert.ok(ids.includes("journey-chen"));
});

test("items carry the facts needed to judge them without opening anything", () => {
  const inbox = todayInbox({
    ...base,
    journeys: [journey({ eventDate: "2026-08-28" })],
    invoiceReferences: [
      {
        id: "inv-1",
        projectId: "project-1",
        balanceCents: 195000,
        dueDate: "2026-08-01",
        status: "sent",
      },
    ],
  });
  const step = inbox.act.find((item) => item.id === "journey-project-1");
  assert.ok(step?.facts.some((fact) => fact.includes("Aug 28, 2026")));
  assert.equal(step?.band, "soon");

  const invoice = inbox.act.find((item) => item.id === "invoice-inv-1");
  // The amount is the headline now, not a chip among chips.
  assert.equal(invoice?.title, "$1,950 overdue");
  assert.ok(invoice?.facts.includes("due Aug 1, 2026"), invoice?.facts.join());
  assert.equal(invoice?.band, "overdue");
});

test("provider names keep their real capitalisation", () => {
  const inbox = todayInbox({
    ...base,
    integrationConnections: [
      { id: "c-1", provider: "quickbooks", status: "error" },
    ],
  });
  assert.equal(inbox.act[0]?.title, "Reconnect QuickBooks");
});

test("work left over from a past event is late, never 'this fortnight'", () => {
  const inbox = todayInbox({
    ...base,
    journeys: [
      journey({
        projectId: "past",
        projectName: "Johnson Wedding",
        eventDate: "2026-06-20",
        stepTitle: "Gallery delivered",
      }),
    ],
  });
  assert.equal(inbox.act[0]?.band, "overdue");
});

test("handled-this-week counts only work that genuinely completed, and only recently", () => {
  const now = new Date(NOW);
  const recent = "2026-08-19T10:00:00.000Z";
  const old = "2026-07-01T10:00:00.000Z";
  const count = handledThisWeek(
    {
      actionReceipts: [
        { id: "r1", status: "completed", completedAt: recent },
        { id: "r2", status: "completed", completedAt: old },
        { id: "r3", status: "failed", completedAt: recent },
      ],
      automationRuns: [
        { id: "a1", status: "succeeded", updatedAt: recent },
        { id: "a2", status: "queued", updatedAt: recent },
      ],
      emailJobs: [{ id: "e1", status: "sent", updatedAt: recent }],
    },
    now,
  );
  assert.equal(count, 3);
});

test("booked value counts won work, not invoices raised", () => {
  const value = bookedValueCents({
    projects: [
      { id: "p1", state: "BOOKED", packageSnapshotId: "s1" },
      { id: "p2", state: "DELIVERED", packageSnapshotId: "s2" },
      // Not yet won — a proposal is not a booking.
      { id: "p3", state: "PROPOSAL", packageSnapshotId: "s3" },
      // Won, but no snapshot to price it.
      { id: "p4", state: "PLANNING", packageSnapshotId: "missing" },
    ],
    packageSnapshots: [
      { id: "s1", totalCents: 650000 },
      { id: "s2", totalCents: 480000 },
      { id: "s3", totalCents: 900000 },
    ],
  });
  assert.equal(value, 1130000);
});

test("post-event work is only late once its own turnaround has passed", () => {
  const inbox = todayInbox({
    ...base,
    journeys: [
      // Shot three weeks ago and still editing — normal, not late.
      journey({
        projectId: "editing",
        projectName: "Rivera",
        eventDate: "2026-07-30",
        state: "POST_PRODUCTION",
        actionLabel: "Record delivery",
      }),
      // Delivered five months ago with the album still outstanding — late.
      journey({
        projectId: "album",
        projectName: "Whitfield",
        eventDate: "2026-03-15",
        state: "DELIVERED",
        actionLabel: "Draft the review request",
      }),
    ],
  });
  const band = (id: string) =>
    inbox.act.find((item) => item.id === `journey-${id}`)?.band;
  assert.equal(band("editing"), "soon");
  assert.equal(band("album"), "overdue");
});

test("an inquiry is ranked by how long it has gone unanswered, not by its event date", () => {
  const inbox = todayInbox({
    ...base,
    leads: [
      {
        id: "fresh",
        displayName: "Hana Park",
        eventDate: "2027-06-26",
        status: "new",
        receivedAt: "2026-08-20T08:00:00.000Z",
      },
      {
        id: "stale",
        displayName: "Aoife Donnelly",
        // A wedding 14 months out: the old banding called this "later" and
        // buried the studio's most perishable work.
        eventDate: "2027-10-06",
        status: "new",
        receivedAt: "2026-08-16T08:00:00.000Z",
      },
    ],
  });
  const band = (id: string) =>
    inbox.act.find((item) => item.id === `lead-${id}`)?.band;
  assert.equal(band("fresh"), "soon");
  assert.equal(band("stale"), "overdue");
  // Neither is ever filed under "when you get to it".
  assert.ok(inbox.act.every((item) => item.band !== "later"));
});

test("an unanswered inquiry outranks chasing money already earned", () => {
  const inbox = todayInbox({
    ...base,
    leads: [
      {
        id: "lead-1",
        displayName: "Aoife Donnelly",
        eventDate: "2027-10-06",
        status: "new",
        receivedAt: "2026-08-15T09:00:00.000Z",
      },
    ],
    invoiceReferences: [
      {
        id: "inv-1",
        projectId: "project-1",
        balanceCents: 268500,
        dueDate: "2026-03-14",
        status: "sent",
      },
    ],
    // The invoice's own job is months out, so proximity does not decide it.
    journeys: [journey({ eventDate: "2026-11-25", owner: "client" })],
  });
  assert.equal(inbox.act[0]?.id, "lead-lead-1");
  assert.equal(inbox.act[1]?.id, "invoice-inv-1");
});

test("dates on cards are written for a person, never as ISO", () => {
  const inbox = todayInbox({
    ...base,
    invoiceReferences: [
      {
        id: "inv-1",
        projectId: "project-1",
        balanceCents: 626500,
        dueDate: "2026-07-25",
        status: "sent",
      },
    ],
    tasks: [
      {
        id: "task-1",
        projectId: "project-1",
        title: "Confirm the family photo list",
        dueAt: "2026-08-17",
        status: "open",
      },
    ],
    journeys: [journey({ owner: "client" })],
  });
  const facts = inbox.act.flatMap((item) => item.facts);
  assert.ok(facts.includes("due Jul 25, 2026"));
  assert.ok(facts.includes("was due Aug 17, 2026"));
  // No fact anywhere may carry a raw YYYY-MM-DD.
  assert.deepEqual(
    facts.filter((fact) => /\d{4}-\d{2}-\d{2}/.test(fact)),
    [],
  );
});
