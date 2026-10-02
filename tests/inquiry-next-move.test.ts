import assert from "node:assert/strict";
import { test } from "node:test";
import { inquiryNextMove } from "../features/inquiries/next-move.ts";
import { foldMessageIntoConversation } from "../features/messaging/conversation.ts";
import { inquiryPipeline } from "../features/inquiries/pipeline.ts";
import { todayInbox } from "../features/today/inbox.ts";
import { inquiryInsights, replyTimeLabel } from "../features/reporting/inquiry-insights.ts";

const participant = { contactId: null, email: "emma@example.test", phone: null, name: "Emma" };

function thread(steps: Array<["inbound" | "outbound", string]>) {
  let current = null as ReturnType<typeof foldMessageIntoConversation> | null;
  for (const [direction, occurredAt] of steps) {
    current = foldMessageIntoConversation(current, {
      tenantId: "t1",
      projectId: "p1",
      leadId: "l1",
      participant,
      channel: "email",
      direction,
      subject: "Wedding",
      preview: "…",
      occurredAt,
    });
  }
  return current!;
}

test("a fresh inquiry with no thread is the studio's to answer, from when it arrived", () => {
  const move = inquiryNextMove({ conversations: [], projectId: "p1", receivedAt: "2026-09-28T10:00:00Z" });
  assert.equal(move.owner, "studio");
  assert.equal(move.replied, false);
  assert.equal(move.waitingSince, "2026-09-28T10:00:00Z");
});

test("once the studio replies, the couple owes the next message", () => {
  const conversation = thread([
    ["inbound", "2026-09-28T10:00:00Z"],
    ["outbound", "2026-09-28T11:00:00Z"],
  ]);
  const move = inquiryNextMove({ conversations: [conversation], projectId: "p1" });
  assert.equal(move.owner, "couple");
  assert.equal(move.replied, true);
  assert.equal(move.waitingSince, "2026-09-28T11:00:00Z");
});

test("when the couple writes back, it is the studio's move again", () => {
  const conversation = thread([
    ["inbound", "2026-09-28T10:00:00Z"],
    ["outbound", "2026-09-28T11:00:00Z"],
    ["inbound", "2026-09-30T09:00:00Z"],
  ]);
  const move = inquiryNextMove({ conversations: [conversation], projectId: "p1" });
  assert.equal(move.owner, "studio");
  assert.equal(move.replied, true);
  assert.equal(move.waitingSince, "2026-09-30T09:00:00Z");
});

test("a lead thread left behind as a pointer is not counted twice", () => {
  const live = thread([["inbound", "2026-09-28T10:00:00Z"]]);
  const moved = { ...thread([["outbound", "2026-09-29T10:00:00Z"]]), movedTo: live.id };
  const move = inquiryNextMove({ conversations: [live, moved], projectId: "p1", leadId: "l1" });
  assert.equal(move.owner, "studio");
});

test("threads older than the per-side fields still read by their last message", () => {
  const legacy = { projectId: "p1", lastMessageAt: "2026-09-28T11:00:00Z", lastMessageDirection: "outbound" };
  assert.equal(inquiryNextMove({ conversations: [legacy], projectId: "p1" }).owner, "couple");
});


const job = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  state,
  name: `${id} Wedding`,
  eventDate: "2027-06-12",
  createdAt: "2026-09-28T10:00:00Z",
  archivedAt: null,
  ...extra,
});

test("the pipeline lists inquiry-stage jobs and unconverted leads, once each, and never booked work", () => {
  const rows = inquiryPipeline({
    projects: [
      job("fresh", "LEAD", { leadId: "l1" }),
      job("consulting", "CONSULTATION"),
      job("booked", "BOOKED"),
      job("gone", "ARCHIVED", { archivedAt: "2026-09-01T00:00:00Z" }),
    ],
    leads: [
      { id: "l1", projectId: "fresh", status: "converted", displayName: "Sarah Nolan" },
      { id: "l2", projectId: "fresh", status: "converted", displayName: "Sarah Nolan" },
      { id: "l3", status: "new", displayName: "No Date Yet", createdAt: "2026-09-27T10:00:00Z" },
      { id: "maybe", status: "new", needsConfirmation: true },
      { id: "spam", status: "archived", notInquiry: true, archivedAt: "2026-09-02T00:00:00Z" },
    ],
    conversations: [],
  });
  assert.deepEqual(rows.map((row) => row.id).sort(), ["consulting", "fresh", "l3"]);
  assert.equal(rows.find((row) => row.id === "fresh")!.name, "Sarah Nolan");
  assert.equal(rows.find((row) => row.id === "fresh")!.stage, "new");
  // Nobody has written on it, so a consultation-stage job owes no message.
  assert.equal(rows.find((row) => row.id === "consulting")!.owner, null);
});

test("an answered inquiry moves to Talking and waits on the couple", () => {
  const [row] = inquiryPipeline({
    projects: [job("p1", "LEAD", { leadId: "l1" })],
    leads: [{ id: "l1", projectId: "p1", status: "converted" }],
    conversations: [thread([["inbound", "2026-09-28T10:00:00Z"], ["outbound", "2026-09-28T12:00:00Z"]])],
  });
  assert.equal(row!.stage, "talking");
  assert.equal(row!.owner, "couple");
});

test("Today answers an inquiry-stage job on its inquiry card, once, and not again after the reply", () => {
  const input = {
    now: "2026-09-28T13:00:00Z",
    projects: [job("p1", "LEAD", { leadId: "l1" })],
    leads: [
      { id: "l1", projectId: "p1", status: "converted", displayName: "Sarah Nolan", createdAt: "2026-09-28T10:00:00Z" },
      { id: "l2", projectId: "p1", status: "converted", displayName: "Sarah Nolan", createdAt: "2026-09-28T11:00:00Z" },
    ],
    journeys: [
      {
        projectId: "p1",
        projectName: "Sarah Nolan Wedding",
        eventDate: "2027-06-12",
        state: "LEAD",
        stepTitle: "First reply",
        stepDetail: "",
        owner: "studio" as const,
        actionLabel: "Review reply",
        actionHref: "/studio/projects/p1#prepared",
        updatedAt: null,
      },
    ],
  };
  const unanswered = todayInbox(input);
  const cards = unanswered.act.filter((item) => item.projectId === "p1");
  assert.equal(cards.length, 1, "one card for the couple, not one per lead plus a journey card");
  assert.equal(cards[0]!.action.kind, "inquiry");
  assert.equal(cards[0]!.jobHref, "/studio/projects/p1");

  const answered = todayInbox({
    ...input,
    conversations: [thread([["inbound", "2026-09-28T10:00:00Z"], ["outbound", "2026-09-28T12:00:00Z"]])],
  });
  assert.equal(answered.act.filter((item) => item.projectId === "p1").length, 0);
  // An inquiry is not an event on the books.
  assert.equal(answered.upcoming.length, 0);
});

test("a quiet couple's drafted follow-up rides on their card, and never in the approval lane", () => {
  const quiet = thread([["inbound", "2026-09-20T10:00:00Z"], ["outbound", "2026-09-21T10:00:00Z"]]);
  const inbox = todayInbox({
    now: "2026-09-25T13:00:00Z",
    projects: [job("p1", "LEAD", { leadId: "l1" })],
    leads: [{ id: "l1", projectId: "p1", status: "converted", displayName: "Sarah Nolan", createdAt: "2026-09-20T10:00:00Z" }],
    conversations: [quiet],
    aiActions: [
      {
        id: "nudge",
        status: "review_required",
        capability: "inquiry_follow_up",
        createdAt: "2026-09-24T14:00:00Z",
        structuredOutput: { leadId: "l1", subject: "Following up", body: "Hi Sarah", recipientEmail: "s@example.test" },
      },
    ],
  });
  const card = inbox.act.find((item) => item.projectId === "p1");
  assert.equal(card?.title, "Follow up with Sarah Nolan");
  assert.ok(card?.action.kind === "inquiry" && card.action.followUp && card.action.reply?.actionId === "nudge");
  assert.equal(inbox.approve.length, 0);
});

test("two weeks quiet offers the close; a closed inquiry leaves Today", () => {
  const quiet = thread([["inbound", "2026-09-01T10:00:00Z"], ["outbound", "2026-09-02T10:00:00Z"]]);
  const lead = { id: "l1", projectId: "p1", status: "converted", displayName: "Sarah Nolan", closeSuggestedAt: "2026-09-16T14:00:00Z" };
  const offered = todayInbox({
    now: "2026-09-16T15:00:00Z",
    projects: [job("p1", "LEAD", { leadId: "l1" })],
    leads: [lead],
    conversations: [quiet],
  });
  const card = offered.act.find((item) => item.projectId === "p1");
  assert.equal(card?.action.kind, "close_inquiry");
  const closed = todayInbox({
    now: "2026-09-16T15:00:00Z",
    projects: [job("p1", "LOST", { leadId: "l1" })],
    leads: [{ ...lead, status: "lost" }],
    conversations: [quiet],
  });
  assert.equal(closed.act.filter((item) => item.projectId === "p1").length, 0);
});


test("insights count couples once, by where StudioCue received them, with how fast and how many booked", () => {
  const insights = inquiryInsights({
    leads: [
      { id: "a1", projectId: "pa", createdAt: "2026-09-01T10:00:00Z", formBuilderLabel: "Squarespace form", source: "website_form" },
      { id: "a2", projectId: "pa", createdAt: "2026-09-02T10:00:00Z", formBuilderLabel: "Squarespace form", source: "website_form" },
      { id: "b1", projectId: "pb", createdAt: "2026-09-03T10:00:00Z", source: "forwarded_email" },
      { id: "c1", createdAt: "2026-09-04T10:00:00Z", source: "public_inquiry" },
      { id: "spam", createdAt: "2026-09-04T10:00:00Z", notInquiry: true },
      { id: "maybe", createdAt: "2026-09-04T10:00:00Z", needsConfirmation: true },
    ],
    projects: [
      { id: "pa", state: "BOOKED" },
      { id: "pb", state: "LOST", lostReason: "went_quiet" },
    ],
    conversations: [
      { id: "t1", projectId: "pa", firstOutboundAt: "2026-09-01T10:30:00Z" },
      { id: "t2", projectId: "pb", firstOutboundAt: "2026-09-03T16:00:00Z" },
      // The acknowledgement on a thread left behind is not a reply.
      { id: "t3", projectId: null, leadId: "c1", movedTo: "elsewhere", firstOutboundAt: "2026-09-04T10:00:01Z" },
    ],
  });
  assert.equal(insights.inquiries, 3);
  assert.equal(insights.booked, 1);
  assert.equal(insights.winRate, 33);
  assert.deepEqual(insights.sources.map((line) => [line.source, line.inquiries, line.booked]), [
    ["Squarespace form", 1, 1],
    ["Forwarded email", 1, 0],
    ["StudioCue inquiry form", 1, 0],
  ]);
  assert.equal(insights.replied, 2);
  assert.equal(insights.repliedWithinHour, 1);
  assert.equal(replyTimeLabel(insights.medianFirstReplyHours), "3 hours");
  assert.deepEqual(insights.closedReasons, [{ reason: "Went quiet", count: 1 }]);
});

test("a reply sent from the studio's own inbox is the couple's move, until they write again", () => {
  const answered = inquiryNextMove({
    conversations: [thread([["inbound", "2026-10-02T10:00:00Z"]])],
    projectId: "p1",
    leadId: "l1",
    repliedOutsideAt: "2026-10-02T10:20:00Z",
  });
  assert.equal(answered.owner, "couple");
  assert.equal(answered.replied, true);
  assert.equal(answered.waitingSince, "2026-10-02T10:20:00Z");

  const wroteBack = inquiryNextMove({
    conversations: [thread([["inbound", "2026-10-02T10:00:00Z"], ["inbound", "2026-10-03T09:00:00Z"]])],
    projectId: "p1",
    leadId: "l1",
    repliedOutsideAt: "2026-10-02T10:20:00Z",
  });
  assert.equal(wroteBack.owner, "studio");
});
