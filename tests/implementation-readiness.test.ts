import assert from "node:assert/strict";
import test from "node:test";
import {
  implementationReadinessScorecard,
  implementationWorkflowRegistry,
} from "@/features/operations/implementation-readiness";
import { productEvent } from "../functions/src/operations/product-events";

test("validated photographer workflow design clears every 85 percent target", () => {
  const score = implementationReadinessScorecard();
  assert.ok(score.coverage.score > 85);
  assert.ok(score.automation.score > 85);
  assert.ok(score.approvalLed.score > 85);
  assert.equal(score.approvalLed.manualRoutineTouches, 0);
});

test("every implementation workflow maps to a unique evidence-backed acceptance item", () => {
  assert.equal(
    new Set(implementationWorkflowRegistry.map((item) => item.id)).size,
    implementationWorkflowRegistry.length,
  );
  assert.equal(
    implementationWorkflowRegistry.every(
      (item) => item.capabilityId && item.evidence && item.label,
    ),
    true,
  );
});

test("workflow events carry automatic and approval-touch classifications", () => {
  const automatic = productEvent({
    tenantId: "tenant-1",
    projectId: "project-1",
    actorId: "system",
    name: "planning.package_prepared",
    occurredAt: "2026-08-13T12:00:00.000Z",
    correlationId: "planning-1",
    sourceEntityType: "planningPackage",
    sourceEntityId: "package-1",
  });
  const approval = productEvent({
    tenantId: "tenant-1",
    projectId: "project-1",
    actorId: "owner-1",
    name: "lifecycle.gallery_delivered",
    occurredAt: "2026-08-13T12:05:00.000Z",
    correlationId: "delivery-1",
    sourceEntityType: "deliveryRecord",
    sourceEntityId: "delivery-1",
  });

  assert.equal(automatic.properties.executionMode, "ai_prepared");
  assert.equal(automatic.properties.humanRole, "none");
  assert.equal(approval.properties.executionMode, "ai_prepared");
  assert.equal(approval.properties.humanRole, "approval");
});
