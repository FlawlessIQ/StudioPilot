import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATTESTABLE_CLOSEOUT_KEYS,
  closeoutStatusFrom,
  EVIDENCE_ONLY_CLOSEOUT_KEYS,
  outstandingCloseoutLabels,
  requirementIsAttestable,
  requirementIsSatisfied,
  type CloseoutRequirement,
} from "@/features/post-event/closeout-attestation";

/**
 * A finished wedding could not be closed because the couple had not opened the
 * gallery, the review asks were still scheduled, and the second shooter had not
 * filed their closeout. Every one of those answers was honest; none of them was
 * the studio's to fix.
 */

const req = (over: Partial<CloseoutRequirement>): CloseoutRequirement => ({
  key: "delivery",
  label: "Gallery delivered and accessed",
  complete: false,
  ...over,
});

const vouch = {
  attestedBy: "user-1",
  attestedAt: "2026-08-27T12:00:00.000Z",
  note: "Ada confirmed by text that they have the gallery.",
};

test("a requirement the records prove needs no vouching", () => {
  assert.equal(requirementIsSatisfied(req({ complete: true })), true);
});

test("a studio may vouch for what happened somewhere StudioCue cannot see", () => {
  assert.equal(requirementIsSatisfied(req({ attestation: vouch })), true);
});

test("money and the agreement can never be vouched away", () => {
  for (const key of EVIDENCE_ONLY_CLOSEOUT_KEYS) {
    assert.equal(requirementIsAttestable(key), false, `${key} must need evidence`);
    // Even with an attestation written onto the record, it counts for nothing.
    assert.equal(
      requirementIsSatisfied(req({ key, label: key, attestation: vouch })),
      false,
      `${key} must not be satisfiable by a note`,
    );
  }
  // And they are not quietly also in the attestable list.
  for (const key of EVIDENCE_ONLY_CLOSEOUT_KEYS) {
    assert.equal(ATTESTABLE_CLOSEOUT_KEYS.includes(key), false);
  }
});

test("every attestable key is one a studio could genuinely know about", () => {
  assert.deepEqual([...ATTESTABLE_CLOSEOUT_KEYS].sort(), [
    "album",
    "crew",
    "delivery",
    "insurance",
    "review_request",
    "schedule",
  ]);
});

test("closeout is ready when each requirement is proven or vouched for", () => {
  assert.equal(
    closeoutStatusFrom([
      req({ key: "contract", label: "Signed contract recorded", complete: true }),
      req({ key: "final_balance", label: "Final balance settled", complete: true }),
      req({ key: "delivery", attestation: vouch }),
      req({ key: "crew", label: "Crew assignments closed", attestation: vouch }),
    ]),
    "ready",
  );
});

test("an unvouched, unproven requirement still blocks, and is named", () => {
  const requirements = [
    req({ key: "contract", label: "Signed contract recorded", complete: true }),
    req({ key: "final_balance", label: "Final balance settled", complete: false }),
    req({ key: "delivery", attestation: vouch }),
  ];
  assert.equal(closeoutStatusFrom(requirements), "blocked");
  assert.deepEqual(outstandingCloseoutLabels(requirements), [
    "Final balance settled",
  ]);
});
