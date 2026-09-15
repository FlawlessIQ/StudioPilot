import assert from "node:assert/strict";
import { test } from "node:test";
import { actionsPerWedding, isStudioAction } from "@/features/reporting/actions-per-wedding";

test("only a studio member's actions count", () => {
  assert.equal(isStudioAction({ actorId: "Xy12ab34Cd56ef78Gh90ij12", actorType: "user" }), true);
  assert.equal(isStudioAction({ actorId: "booking-orchestrator", actorType: "user" }), false);
  assert.equal(isStudioAction({ actorId: "studio_policy:send_on_acceptance" }), false);
  assert.equal(isStudioAction({ actorId: "contact_1", actorType: "client" }), false);
  assert.equal(isStudioAction({ actorId: "sendgrid-gallery-inbound", actorType: "provider" }), false);
});

test("the median is taken over delivered weddings only", () => {
  const studio = (projectId: string) => ({ projectId, actorId: "owner1", actorType: "user" });
  const result = actionsPerWedding({
    projects: [
      { id: "a", name: "A", state: "DELIVERED" },
      { id: "b", name: "B", state: "CLOSED" },
      { id: "c", name: "C", state: "CLOSED" },
      { id: "d", name: "D", state: "PLANNING" },
    ],
    events: [
      ...Array.from({ length: 12 }, () => studio("a")),
      ...Array.from({ length: 30 }, () => studio("b")),
      ...Array.from({ length: 20 }, () => studio("c")),
      ...Array.from({ length: 99 }, () => studio("d")),
      { projectId: "a", actorId: "email-worker" },
    ],
  });
  assert.equal(result.deliveredCount, 3);
  assert.equal(result.deliveredMedian, 20);
  assert.deepEqual(result.most, { projectId: "b", name: "B", actions: 30 });
});

test("no delivered weddings, no number", () => {
  const result = actionsPerWedding({ projects: [{ id: "a", state: "BOOKED" }], events: [] });
  assert.equal(result.deliveredMedian, null);
  assert.equal(result.most, null);
});
