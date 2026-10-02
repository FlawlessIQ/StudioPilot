import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultThread, groupConversations } from "@/features/messaging/thread-groups";
import type { Conversation } from "@/features/messaging/conversation";
import { analyseFunnel, jobFunnelStages } from "@/features/operations/funnel";
import {
  readinessEvidenceFromFacts,
} from "@/features/readiness/checkpoint-evidence";
import { bookingIsConfirmed } from "@/features/inquiries/stages";
import { providerFailureKind } from "@/features/today/provider-failure";
import { taskIsOpenWork } from "@/features/tasks/live-work";
import { projectLifecycleProjection } from "@/features/projects/lifecycle-projection";

/**
 * The UI audit of 2026-10-02 (docs/ui-audit-2026-10-02.md): the logic behind
 * its fixes. The layout fixes are CSS and were checked on screen.
 */

const thread = (overrides: Partial<Conversation>): Conversation => ({
  id: "conv",
  tenantId: "t1",
  projectId: null,
  leadId: null,
  participant: { contactId: null, email: "couple@example.com", phone: null, name: "Replytest Couple" },
  channels: ["email"],
  subject: null,
  lastMessageAt: "2026-10-02T11:00:00.000Z",
  lastMessagePreview: "",
  lastMessageDirection: "outbound",
  lastMessageChannel: "email",
  studioUnreadCount: 0,
  clientUnreadCount: 0,
  messageCount: 1,
  status: "open",
  archivedAt: null,
  ...overrides,
});

test("a converted inquiry's split threads fold into one row on the job", () => {
  const groups = groupConversations([
    thread({
      id: "job-thread",
      projectId: "p1",
      leadId: "l1",
      subject: "Wedding inquiry",
      lastMessageAt: "2026-10-02T11:00:00.000Z",
      lastMessageDirection: "inbound",
      studioUnreadCount: 1,
      messageCount: 1,
    }),
    thread({
      id: "orphan-lead-thread",
      leadId: "l1",
      subject: "FlawlessIQ received your inquiry",
      lastMessageAt: "2026-10-02T11:01:00.000Z",
      messageCount: 1,
    }),
  ]);
  assert.equal(groups.length, 1);
  const [group] = groups;
  // Replies go to the job's thread.
  assert.equal(group.id, "job-thread");
  assert.deepEqual(group.memberIds, ["job-thread", "orphan-lead-thread"]);
  assert.equal(group.projectId, "p1");
  assert.equal(group.studioUnreadCount, 1);
  assert.equal(group.messageCount, 2);
  // The newest message heads the row.
  assert.equal(group.lastMessageAt, "2026-10-02T11:01:00.000Z");
});

test("a moved thread is a pointer, and two weddings stay two threads", () => {
  const groups = groupConversations([
    { ...thread({ id: "moved", leadId: "l1" }), movedTo: "job-thread" } as Conversation,
    thread({ id: "a", projectId: "p1" }),
    thread({ id: "b", projectId: "p2" }),
  ]);
  assert.deepEqual(groups.map((group) => group.id).sort(), ["a", "b"]);
});

test("the inbox opens on the newest unread thread, else the newest", () => {
  const list = [
    { id: "auto-reply", studioUnreadCount: 0 },
    { id: "inquiry", studioUnreadCount: 1 },
  ];
  assert.equal(defaultThread(list)?.id, "inquiry");
  assert.equal(defaultThread([{ id: "x", studioUnreadCount: 0 }])?.id, "x");
  assert.equal(defaultThread([]), null);
});

test("the funnel only narrows: each job counts at every stage it reached", () => {
  const stages = jobFunnelStages({
    projects: [
      { id: "p1", state: "LEAD" },
      { id: "p2", state: "PROPOSAL" },
      { id: "p3", state: "PLANNING" },
      { id: "p4", state: "LOST" },
      // Imported bookings never went through the funnel.
      { id: "p5", state: "BOOKED", importedAt: "2026-09-01T00:00:00.000Z" },
    ],
    // Two consultation records on one job are one job consulted.
    consultations: [{ projectId: "p2" }, { projectId: "p2" }, { projectId: "p4" }],
    proposals: [{ projectId: "p4", status: "declined" }],
    // An amendment signed on a booked job is not a second contract.
    contracts: [{ projectId: "p3", status: "completed" }, { projectId: "p3", status: "completed" }],
  });
  assert.deepEqual(
    stages.map((stage) => stage.value),
    [4, 3, 2, 1, 1],
  );
  const funnel = analyseFunnel(stages);
  for (let index = 1; index < funnel.steps.length; index += 1) {
    assert.ok(!funnel.steps[index].exceedsPrevious);
  }
});

test("a booked job's contract and retainer are evidenced by the booking gate", () => {
  const base = {
    contractStatus: "draft",
    retainerInvoiceStatus: null,
    finalInvoiceStatus: null,
    questionnaireStatus: null,
    questionnaireAnswers: null,
    scheduleStatus: null,
    scheduleItems: null,
    crewAccepted: 0,
    crewRequired: 0,
    crewAcknowledgedCurrent: 0,
    coiStatus: null,
    insuranceRequired: null,
  };
  const unbooked = readinessEvidenceFromFacts(base);
  assert.equal(unbooked.contractCompleted, false);
  assert.equal(unbooked.retainerPaid, false);
  const booked = readinessEvidenceFromFacts({ ...base, bookingConfirmed: true });
  assert.equal(booked.contractCompleted, true);
  assert.equal(booked.retainerPaid, true);
  // The final balance is not part of the gate.
  assert.equal(booked.finalBalancePaid, false);
});

test("booking is confirmed by the gate's stamp or a booked-and-after state", () => {
  assert.equal(bookingIsConfirmed({ state: "PLANNING" }), true);
  assert.equal(bookingIsConfirmed({ state: "POSTPONED", bookingCompletedAt: "2026-06-01T00:00:00Z" }), true);
  assert.equal(bookingIsConfirmed({ state: "RETAINER_PENDING" }), false);
  assert.equal(bookingIsConfirmed({ state: "LOST" }), false);
});

test("the functions mirror of the evidence rules reads the booking gate too", () => {
  const mirror = readFileSync("functions/src/workflow/checkpoint-evidence.ts", "utf8");
  assert.match(mirror, /input\.contractStatus === "completed" \|\| input\.bookingConfirmed === true/);
  assert.match(mirror, /paid\(input\.retainerInvoiceStatus\) \|\| input\.bookingConfirmed === true/);
  const loader = readFileSync("functions/src/workflow/readiness-evidence-loader.ts", "utf8");
  assert.match(loader, /bookingConfirmed,/);
});

test("an unsent draft after a signed agreement is not the client's to sign", () => {
  const projection = projectLifecycleProjection({
    project: { id: "p1", state: "PLANNING" },
    contracts: [
      { id: "c1", status: "completed", createdAt: "2026-05-01" },
      { id: "c2", status: "draft", createdAt: "2026-09-01" },
    ],
  });
  assert.equal(
    projection.lanes.client.some((item) => item.id.startsWith("contract-")),
    false,
  );
  const amendmentOut = projectLifecycleProjection({
    project: { id: "p1", state: "PLANNING" },
    contracts: [
      { id: "c1", status: "completed" },
      { id: "c2", status: "sent" },
    ],
  });
  assert.equal(
    amendmentOut.lanes.client.some((item) => item.id === "contract-c2"),
    true,
  );
});

test("archived checkpoints are not outstanding work", () => {
  const projection = projectLifecycleProjection({
    project: { id: "p1", state: "PLANNING" },
    checkpoints: [
      { id: "k1", name: "Retainer paid", status: "not_started", ownerType: "client", archivedAt: "2026-06-01" },
    ],
  });
  assert.equal(projection.lanes.client.length, 0);
});

test("every failed step on Today wears a glyph", () => {
  assert.equal(providerFailureKind("create_quickbooks_invoice"), "invoice");
  assert.equal(providerFailureKind("create_dropbox_sign_request"), "contract");
  assert.equal(providerFailureKind("create_consultation_resources"), "calendar");
  assert.equal(providerFailureKind("add_crew_calendar_invite"), "crew");
  assert.equal(providerFailureKind("upload_dropbox_document"), "document");
  assert.equal(providerFailureKind("something_new"), "automation");
});

test("the bell counts open work only", () => {
  assert.equal(taskIsOpenWork({ status: "not_started" }), true);
  assert.equal(taskIsOpenWork({ status: "complete" }), false);
  assert.equal(taskIsOpenWork({ status: "cancelled" }), false);
  assert.equal(taskIsOpenWork({ status: "not_started", archivedAt: "2026-09-01" }), false);
  assert.equal(taskIsOpenWork({ status: "not_started", projectState: "CANCELLED" }), false);
});

test("send-time thread scope follows a converted lead onto its job", () => {
  const conversation = readFileSync("functions/src/communications/conversation.ts", "utf8");
  assert.match(conversation, /export async function resolveThreadScope/);
  assert.match(conversation, /await resolveThreadScope\(firestore, incoming\)/);
  const jobs = readFileSync("functions/src/operations/jobs.ts", "utf8");
  assert.match(jobs, /const scope = await resolveThreadScope\(/);
});
