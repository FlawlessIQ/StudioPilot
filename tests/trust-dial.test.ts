import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultLifecycleMessagingSettings } from "@/features/messaging/schema";
import {
  lifecycleTriggerOf,
  trustDialOffers,
  type LifecycleDecision,
} from "@/features/messaging/trust-dial";

const approval = (day: number, edited = false, approved = true): LifecycleDecision => ({
  trigger: "day_before_checklist",
  decidedAt: `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`,
  approved,
  edited,
});

test("three unedited approvals in a row earn the offer", () => {
  assert.deepEqual(
    trustDialOffers([approval(1), approval(2), approval(3)], defaultLifecycleMessagingSettings),
    ["day_before_checklist"],
  );
});

test("an edit among the latest three means the studio is still shaping it", () => {
  assert.deepEqual(
    trustDialOffers([approval(1), approval(2, true), approval(3)], defaultLifecycleMessagingSettings),
    [],
  );
});

test("an old edit ages out of the window", () => {
  assert.deepEqual(
    trustDialOffers(
      [approval(1, true), approval(2), approval(3), approval(4)],
      defaultLifecycleMessagingSettings,
    ),
    ["day_before_checklist"],
  );
});

test("no offer once auto-send is on, or with too few approvals", () => {
  const on = {
    ...defaultLifecycleMessagingSettings,
    day_before_checklist: { ...defaultLifecycleMessagingSettings.day_before_checklist, autoSend: true },
  };
  assert.deepEqual(trustDialOffers([approval(1), approval(2), approval(3)], on), []);
  assert.deepEqual(trustDialOffers([approval(1), approval(2)], defaultLifecycleMessagingSettings), []);
});

test("older lifecycle actions are recognised by their title", () => {
  assert.equal(
    lifecycleTriggerOf({ instructionVersion: "lifecycle_v1", title: "Review day before checklist" }),
    "day_before_checklist",
  );
  assert.equal(lifecycleTriggerOf({ lifecycleTrigger: "schedule_confirmation" }), "schedule_confirmation");
  assert.equal(lifecycleTriggerOf({ title: "Review day before checklist" }), null);
});
