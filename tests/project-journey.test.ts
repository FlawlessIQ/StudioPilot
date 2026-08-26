import assert from "node:assert/strict";
import test from "node:test";
import { projectJourney, type JourneyInput } from "@/features/journey/steps";

const base: JourneyInput = {
  projectId: "project-1",
  state: "LEAD",
  eventDate: "2026-10-14",
  today: "2026-08-06",
  lead: { id: "lead-1", status: "new" },
  hasConsultation: false,
  proposalStatus: null,
  contractStatus: null,
  retainerInvoiceStatus: null,
  finalInvoiceStatus: null,
  questionnaireStatus: null,
  questionnaireHasAnswers: false,
  scheduleStatus: null,
  scheduleHasUsableItems: false,
  crewAccepted: 0,
  crewCascadeActive: false,
  coiStatus: null,
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
};

test("a fresh lead's one next action is the first reply", () => {
  const { steps, current } = projectJourney(base);
  assert.equal(current?.key, "first_reply");
  assert.equal(current?.action?.kind, "link");
  // Exactly one current step across the whole journey.
  assert.equal(steps.filter((step) => step.status === "current").length, 1);
});

test("a replied lead moves the journey to the consultation", () => {
  const { current } = projectJourney({
    ...base,
    lead: { id: "lead-1", status: "contacted" },
  });
  assert.equal(current?.key, "consultation");
});

test("waiting-on-client steps do not block the next studio action", () => {
  const { steps, current } = projectJourney({
    ...base,
    state: "CONTRACT_PENDING",
    lead: { id: "lead-1", status: "converted" },
    hasConsultation: true,
    proposalStatus: "accepted",
    contractStatus: "sent",
  });
  const contract = steps.find((step) => step.key === "contract");
  assert.equal(contract?.status, "waiting_client");
  // With the contract out for signature, the studio's own next move is the
  // retainer invoice.
  assert.equal(current?.key, "retainer");
});

test("a booked project with a submitted form points at the run of show", () => {
  const { current } = projectJourney({
    ...base,
    state: "PLANNING",
    lead: { id: "lead-1", status: "converted" },
    hasConsultation: true,
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainerInvoiceStatus: "paid",
    questionnaireStatus: "submitted",
    questionnaireHasAnswers: true,
  });
  assert.equal(current?.key, "run_of_show");
  assert.equal(current?.action?.kind, "link");
  assert.ok(
    current?.action?.kind === "link" &&
      current.action.href.includes("/studio/schedules/new"),
  );
});

test("the final balance stays upcoming until 45 days out, then activates", () => {
  const planned: JourneyInput = {
    ...base,
    state: "PLANNING",
    lead: null,
    hasConsultation: true,
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainerInvoiceStatus: "paid",
    questionnaireStatus: "locked",
    questionnaireHasAnswers: true,
    scheduleStatus: "published",
    scheduleHasUsableItems: true,
    crewAccepted: 2,
    coiStatus: "sent_to_venue",
  };
  const early = projectJourney({ ...planned, today: "2026-07-01" });
  assert.equal(
    early.steps.find((step) => step.key === "final_balance")?.status,
    "upcoming",
  );
  const near = projectJourney({ ...planned, today: "2026-09-14" });
  assert.equal(near.current?.key, "final_balance");
});

test("day-before checklist becomes the action within two days of the event", () => {
  const ready: JourneyInput = {
    ...base,
    state: "READY",
    lead: null,
    hasConsultation: true,
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainerInvoiceStatus: "paid",
    finalInvoiceStatus: "paid",
    questionnaireStatus: "locked",
    questionnaireHasAnswers: true,
    scheduleStatus: "published",
    scheduleHasUsableItems: true,
    crewAccepted: 3,
    coiStatus: "venue_acknowledged",
    today: "2026-10-13",
  };
  const { current } = projectJourney(ready);
  assert.equal(current?.key, "day_before");
  assert.equal(current?.action?.kind, "draft");
  const withDraftWaiting = projectJourney({
    ...ready,
    dayBeforeDraftStatus: "review_required",
  });
  assert.equal(withDraftWaiting.current?.action?.kind, "link");
  assert.ok(
    withDraftWaiting.current?.action?.kind === "link" &&
      withDraftWaiting.current.action.href === "/studio/ai-queue",
  );
});

test("after the event the journey flows to delivery, then album & review", () => {
  const post: JourneyInput = {
    ...base,
    state: "EVENT_COMPLETE",
    lead: null,
    hasConsultation: true,
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainerInvoiceStatus: "paid",
    finalInvoiceStatus: "paid",
    questionnaireStatus: "locked",
    questionnaireHasAnswers: true,
    scheduleStatus: "published",
    scheduleHasUsableItems: true,
    crewAccepted: 3,
    coiStatus: "venue_acknowledged",
    dayBeforeDraftStatus: "executed",
    today: "2026-10-16",
  };
  const delivery = projectJourney(post);
  assert.equal(delivery.current?.key, "delivery");
  const album = projectJourney({ ...post, hasDelivery: true });
  assert.equal(album.current?.key, "album_review");
  assert.equal(album.current?.action?.kind, "draft");
  const closed = projectJourney({
    ...post,
    hasDelivery: true,
    albumOrReviewDone: true,
  });
  assert.equal(closed.current, null);
  assert.ok(
    closed.steps.every((step) => step.status !== "current"),
  );
});

test("projects without a lead skip the first-reply step entirely", () => {
  const { steps } = projectJourney({ ...base, lead: null });
  assert.equal(steps.some((step) => step.key === "first_reply"), false);
});

test("every step is a door: records, owners, and unlock copy are filled", () => {
  const { steps } = projectJourney({
    ...base,
    state: "CONTRACT_PENDING",
    lead: { id: "lead-1", status: "converted" },
    hasConsultation: true,
    proposalStatus: "accepted",
    contractStatus: "sent",
  });
  for (const step of steps) {
    // Every step opens somewhere (the lead-less inquiry step is the only
    // legitimate null, and this journey has a lead).
    assert.ok(step.record, `${step.key} has no record link`);
    assert.match(step.record.href, /^\/studio\//);
    if (step.status === "waiting_client") assert.equal(step.owner, "client");
    if (step.status === "waiting_other") assert.equal(step.owner, "provider");
    if (step.status === "current") assert.equal(step.owner, "studio");
    if (step.status === "complete" || step.status === "upcoming")
      assert.equal(step.owner, null);
    if (step.status === "upcoming")
      assert.ok(step.unlock, `${step.key} upcoming without unlock copy`);
    else assert.equal(step.unlock, null);
  }
});

test("manual advance is offered only for the plain-transition consultation step", () => {
  const scheduled = projectJourney({
    ...base,
    lead: { id: "lead-1", status: "contacted" },
  });
  assert.equal(scheduled.current?.key, "consultation");
  assert.equal(scheduled.current?.advance?.targetState, "CONSULTATION");

  // Evidence-controlled steps never offer a manual advance.
  const proposal = projectJourney({
    ...base,
    state: "CONSULTATION",
    lead: { id: "lead-1", status: "converted" },
    hasConsultation: true,
  });
  assert.equal(proposal.current?.key, "proposal");
  assert.equal(proposal.current?.advance, null);
  for (const step of proposal.steps)
    if (step.key !== "consultation") assert.equal(step.advance, null);
});

test("record links carry the project context", () => {
  const { steps } = projectJourney({
    ...base,
    state: "BOOKED",
    lead: { id: "lead-1", status: "converted" },
    hasConsultation: true,
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainerInvoiceStatus: "paid",
  });
  const proposal = steps.find((step) => step.key === "proposal");
  assert.equal(proposal?.record?.href, "/studio/proposals?project=project-1");
  const contract = steps.find((step) => step.key === "contract");
  assert.equal(contract?.record?.href, "/studio/booking?project=project-1");
});
