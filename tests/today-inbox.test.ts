import assert from "node:assert/strict";
import test from "node:test";
import {
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
  assert.equal(item?.title, "Chen Wedding — proposal");
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
  assert.ok(invoice?.facts.includes("$1,950"), invoice?.facts.join());
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
