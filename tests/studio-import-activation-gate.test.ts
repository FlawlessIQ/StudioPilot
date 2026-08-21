import assert from "node:assert/strict";
import test from "node:test";

/**
 * Which sources can block an import activation.
 *
 * Reported from a real workspace: eleven drafts, ten approved, one rejected,
 * one source already imported from an earlier session — and the Activate
 * button refused the whole import while still reading "Activate 10 approved".
 *
 * Both the server gate and the button read the same rule, so it lives here
 * once: a duplicate file only blocks activation when its own content is
 * going live. A file whose drafts were rejected, ignored or excluded as
 * unreadable has nothing to duplicate.
 */

type SourceItem = { id: string; duplicateOfActivatedSession: boolean };
type Draft = { sourceItemIds: string[]; reviewDecision: string };

/** The rule, as both sides apply it. */
export function blockingDuplicateSources(
  sources: readonly SourceItem[],
  drafts: readonly Draft[],
): string[] {
  const approvedSourceItemIds = new Set(
    drafts
      .filter((draft) => draft.reviewDecision === "approved")
      .flatMap((draft) => draft.sourceItemIds),
  );
  return sources
    .filter(
      (source) =>
        source.duplicateOfActivatedSession &&
        approvedSourceItemIds.has(source.id),
    )
    .map((source) => source.id);
}

test("an already-imported file blocks activation when its draft is approved", () => {
  const blocked = blockingDuplicateSources(
    [{ id: "packages.docx", duplicateOfActivatedSession: true }],
    [{ sourceItemIds: ["packages.docx"], reviewDecision: "approved" }],
  );
  assert.deepEqual(blocked, ["packages.docx"]);
});

test("it does not block when its drafts were rejected", () => {
  // The reported case: one duplicate file, its draft rejected, ten unrelated
  // drafts approved — and nothing could be activated at all.
  const sources = [
    { id: "packages.docx", duplicateOfActivatedSession: true },
    { id: "pricing.pdf", duplicateOfActivatedSession: false },
  ];
  const drafts = [
    { sourceItemIds: ["packages.docx"], reviewDecision: "rejected" },
    ...Array.from({ length: 10 }, () => ({
      sourceItemIds: ["pricing.pdf"],
      reviewDecision: "approved",
    })),
  ];
  assert.deepEqual(blockingDuplicateSources(sources, drafts), []);
});

test("it does not block when its drafts were ignored or left pending", () => {
  const sources = [{ id: "dupe.docx", duplicateOfActivatedSession: true }];
  for (const decision of ["ignored", "pending"]) {
    assert.deepEqual(
      blockingDuplicateSources(sources, [
        { sourceItemIds: ["dupe.docx"], reviewDecision: decision },
      ]),
      [],
      `a ${decision} draft should not block activation`,
    );
  }
});

test("a source backing both an approved and a rejected draft still blocks", () => {
  // Approving any part of a duplicate file means that content is going live.
  const blocked = blockingDuplicateSources(
    [{ id: "mixed.docx", duplicateOfActivatedSession: true }],
    [
      { sourceItemIds: ["mixed.docx"], reviewDecision: "rejected" },
      { sourceItemIds: ["mixed.docx"], reviewDecision: "approved" },
    ],
  );
  assert.deepEqual(blocked, ["mixed.docx"]);
});
