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

test("finishing a rung opens the next one, and only that one", () => {
  const rows = postProductionRows(steps("backup_complete"));
  assert.deepEqual(
    rows.filter((row) => row.actionable).map((row) => row.key),
    ["cull_complete"],
  );
});

test("an album proof follows the edit, not the gallery", () => {
  assert.equal(dependencyOf("album_proof_ready"), "editing_complete");
  const rows = postProductionRows(
    steps("backup_complete", "cull_complete", "editing_started", "editing_complete"),
  );
  const open = rows.filter((row) => row.actionable).map((row) => row.key);
  // A studio may upload the gallery or prepare the album proof in either order.
  assert.deepEqual(open.sort(), ["album_proof_ready", "gallery_ready"]);
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
  assert.equal(row?.waitingOn, "Editing started");
});

test("the delivery gate needs backup, editing and the gallery — and says so", () => {
  assert.deepEqual([...DELIVERY_GATE_STEPS], [
    "backup_complete",
    "editing_complete",
    "gallery_ready",
  ]);
  assert.equal(deliveryGateCleared({}), false);
  assert.equal(
    deliveryGateCleared(steps("backup_complete", "editing_complete")),
    false,
  );
  assert.equal(
    deliveryGateCleared(
      steps("backup_complete", "editing_complete", "gallery_ready"),
    ),
    true,
  );
  // The cull is not one of the three, however sensible it is to do.
  assert.equal(
    deliveryGateCleared(
      steps("backup_complete", "editing_complete", "gallery_ready", "cull_complete"),
    ),
    true,
  );
});
