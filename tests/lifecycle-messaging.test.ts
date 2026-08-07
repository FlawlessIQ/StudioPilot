import assert from "node:assert/strict";
import test from "node:test";
import {
  dueLifecycleMessages,
  resolveLifecycleSettings,
} from "@/features/messaging/lifecycle";
import { renderLifecycleDraft } from "@/features/messaging/render";
import { defaultLifecycleMessagingSettings } from "@/features/messaging/schema";

const project = {
  id: "project-1",
  tenantId: "tenant-a",
  state: "PLANNING",
  eventDate: "2026-10-14",
};

test("no lifecycle messages before the earliest offset", () => {
  const due = dueLifecycleMessages({
    project,
    settings: defaultLifecycleMessagingSettings,
    today: "2026-09-13",
  });
  assert.equal(due.length, 0);
});

test("T-30 raises the schedule confirmation and final invoice notice", () => {
  const due = dueLifecycleMessages({
    project,
    settings: defaultLifecycleMessagingSettings,
    today: "2026-09-14",
  });
  assert.deepEqual(
    due.map((item) => item.trigger).sort(),
    ["final_invoice_notice", "schedule_confirmation"],
  );
  assert.equal(due[0].dueOn, "2026-09-14");
});

test("the day before adds the checklist", () => {
  const due = dueLifecycleMessages({
    project,
    settings: defaultLifecycleMessagingSettings,
    today: "2026-10-13",
  });
  assert.deepEqual(
    due.map((item) => item.trigger).sort(),
    ["day_before_checklist", "final_invoice_notice", "schedule_confirmation"],
  );
});

test("nothing fires on or after the event date", () => {
  for (const today of ["2026-10-14", "2026-10-20"]) {
    const due = dueLifecycleMessages({
      project,
      settings: defaultLifecycleMessagingSettings,
      today,
    });
    assert.equal(due.length, 0);
  }
});

test("disabled triggers are skipped", () => {
  const due = dueLifecycleMessages({
    project,
    settings: {
      ...defaultLifecycleMessagingSettings,
      final_invoice_notice: { enabled: false, offsetDays: -30, autoSend: false },
    },
    today: "2026-09-14",
  });
  assert.deepEqual(
    due.map((item) => item.trigger),
    ["schedule_confirmation"],
  );
});

test("inactive project states and missing event dates produce no work", () => {
  for (const state of ["LEAD", "PROPOSAL", "ARCHIVED", "CLOSED"]) {
    assert.equal(
      dueLifecycleMessages({
        project: { ...project, state },
        settings: defaultLifecycleMessagingSettings,
        today: "2026-09-20",
      }).length,
      0,
      state,
    );
  }
  assert.equal(
    dueLifecycleMessages({
      project: { ...project, eventDate: null },
      settings: defaultLifecycleMessagingSettings,
      today: "2026-09-20",
    }).length,
    0,
  );
});

test("idempotency keys are stable across runs", () => {
  const run = () =>
    dueLifecycleMessages({
      project,
      settings: defaultLifecycleMessagingSettings,
      today: "2026-10-13",
    });
  assert.deepEqual(
    run().map((item) => item.idempotencyKey),
    run().map((item) => item.idempotencyKey),
  );
  assert.match(
    run()[0].idempotencyKey,
    /^lifecycle_tenant-a_project-1_/,
  );
});

test("malformed settings fall back to safe defaults", () => {
  assert.deepEqual(
    resolveLifecycleSettings({ nonsense: true }),
    defaultLifecycleMessagingSettings,
  );
  assert.deepEqual(
    resolveLifecycleSettings(null),
    defaultLifecycleMessagingSettings,
  );
});

const facts = {
  studioName: "GR Productions",
  clientFirstName: "Cindy",
  projectName: "Cindy & Josh Wedding",
  eventDate: "2026-10-11",
  venueName: "Crossed Keys Estate",
  packageTotalCents: 499900,
  retainerPaidCents: 300000,
  balanceDueCents: 199900,
  scheduleUrl: "/client/schedule?project=project-1",
  recipientEmail: "cindy@example.com",
  recipientName: "Cindy Alvarado",
};

test("final invoice notice renders deterministic balance math", () => {
  const draft = renderLifecycleDraft("final_invoice_notice", facts);
  assert.ok(draft.body.includes("$4,999.00"));
  assert.ok(draft.body.includes("$3,000.00"));
  assert.ok(draft.body.includes("$1,999.00"));
  assert.equal(draft.recipientEmail, "cindy@example.com");
  assert.equal(draft.missingInformation.length, 0);
});

test("drafts flag missing recipient email instead of failing", () => {
  const draft = renderLifecycleDraft("day_before_checklist", {
    ...facts,
    recipientEmail: null,
  });
  assert.ok(draft.missingInformation.includes("Client email address"));
  assert.ok(draft.body.includes("Dress on its special hanger"));
});

test("schedule confirmation cites the portal link when published", () => {
  const draft = renderLifecycleDraft("schedule_confirmation", facts);
  assert.ok(draft.body.includes("/client/schedule?project=project-1"));
  const withoutSchedule = renderLifecycleDraft("schedule_confirmation", {
    ...facts,
    scheduleUrl: null,
  });
  assert.ok(
    withoutSchedule.missingInformation.includes("Published schedule link"),
  );
});
