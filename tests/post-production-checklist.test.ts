import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DELIVERY_GATE_STEPS,
  deliveryGateCleared,
  dependencyOf,
  NOT_STUDIO_DECLARED,
  POST_PRODUCTION_ORDER,
  postProductionRows,
} from "@/features/post-production/checklist";

/**
 * `completePostProductionStep` existed and nothing called it, so the delivery
 * gate it feeds could never be satisfied and a finished wedding could not be
 * delivered. These tests pin what a checklist may offer.
 */

const steps = (...done: string[]) =>
  Object.fromEntries(done.map((key) => [key, { complete: true }]));

test("only the first rung is actionable on an empty record", () => {
  const rows = postProductionRows({});
  const actionable = rows.filter((row) => row.actionable).map((row) => row.key);
  assert.deepEqual(actionable, ["backup_complete"]);
});

test("once the cards are backed up, the rest is progress in any order (Q23)", () => {
  // One ladder held a film's edit behind a gallery's; only the backup gates.
  const rows = postProductionRows(steps("backup_complete"));
  assert.deepEqual(
    rows.filter((row) => row.actionable).map((row) => row.key).sort(),
    ["album_proof_ready", "cull_complete", "editing_complete", "editing_started", "gallery_ready"],
  );
  assert.equal(dependencyOf("album_proof_ready"), "backup_complete");
  assert.equal(dependencyOf("backup_complete"), null);
});

test("what is not the studio's to declare is never actionable", () => {
  // Every step done except the three others own.
  const all = steps(
    ...POST_PRODUCTION_ORDER.filter((key) => !NOT_STUDIO_DECLARED.includes(key)),
  );
  const rows = postProductionRows(all);
  for (const key of NOT_STUDIO_DECLARED) {
    const row = rows.find((item) => item.key === key);
    assert.equal(row?.actionable, false, `${key} must not be tickable here`);
  }
});

test("a blocked rung says what it is waiting on, by name", () => {
  const row = postProductionRows({}).find((item) => item.key === "editing_complete");
  assert.equal(row?.waitingOn, "Cards backed up");
});

test("the delivery gate is the backup, and only that", () => {
  assert.deepEqual([...DELIVERY_GATE_STEPS], ["backup_complete"]);
  assert.equal(deliveryGateCleared({}), false);
  assert.equal(deliveryGateCleared(steps("editing_complete", "gallery_ready")), false);
  assert.equal(deliveryGateCleared(steps("backup_complete")), true);
});
