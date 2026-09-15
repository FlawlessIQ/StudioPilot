import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GALLERY_EVIDENCE_ACTOR,
  galleryEvidenceUpdates,
} from "../functions/src/post-event/gallery-evidence.ts";

test("a gallery email marks the editing steps and gallery ready, never backup", () => {
  const result = galleryEvidenceUpdates({ steps: {}, evidenceId: "gallery_draft_x", receivedAt: "2026-09-15T10:00:00.000Z" });
  assert.deepEqual(result.marked, ["cull_complete", "editing_started", "editing_complete", "gallery_ready"]);
  assert.equal(result.updates["steps.backup_complete"], undefined);
  assert.equal((result.updates["steps.gallery_ready"] as { completedBy: string }).completedBy, GALLERY_EVIDENCE_ACTOR);
  // Backup is still the studio's to confirm, so the record points there.
  assert.equal(result.currentStep, "backup_complete");
});

test("steps the studio already ticked keep their own record", () => {
  const result = galleryEvidenceUpdates({
    steps: { backup_complete: { complete: true }, cull_complete: { complete: true } },
    evidenceId: "d",
    receivedAt: "2026-09-15T10:00:00.000Z",
  });
  assert.deepEqual(result.marked, ["editing_started", "editing_complete", "gallery_ready"]);
  assert.equal(result.updates["steps.cull_complete"], undefined);
  assert.equal(result.currentStep, "album_proof_ready");
});

test("nothing to mark when the gallery was already ready", () => {
  const all = Object.fromEntries(
    ["backup_complete", "cull_complete", "editing_started", "editing_complete", "gallery_ready"].map((key) => [key, { complete: true }]),
  );
  assert.deepEqual(galleryEvidenceUpdates({ steps: all, evidenceId: "d", receivedAt: "t" }).marked, []);
});
