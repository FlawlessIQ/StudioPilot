import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateQuestionnaireChange,
  reconcileFinalInvoice,
  traceScheduleDraft,
  verifiedQuestionnairePrefill,
} from "../features/planning/intelligence";

test("questionnaire prefill carries verified project provenance", () => {
  const result = verifiedQuestionnairePrefill({
    projectId: "project-1",
    project: {
      eventDate: "2027-06-12",
      venueName: "The Garden Conservatory",
      timezone: "America/New_York",
    },
    fields: [
      { id: "date", label: "Wedding date" },
      { id: "venue", label: "Venue name" },
      { id: "meal", label: "Meal preference" },
    ],
  });

  assert.deepEqual(result.answers, {
    date: "2027-06-12",
    venue: "The Garden Conservatory",
  });
  assert.equal(result.provenance.date.verified, true);
  assert.equal(result.provenance.venue.sourceField, "venueName");
});

test("client corrections preserve a visible change trail", () => {
  const result = evaluateQuestionnaireChange({
    priorAnswers: { venue: "Old venue", date: "2027-06-12" },
    nextAnswers: { venue: "New venue", date: "2027-06-12" },
    priorProvenance: {
      venue: { sourceType: "project_fact", verified: true },
    },
    actorType: "client",
    now: "2026-07-29T18:00:00.000Z",
  });

  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0]?.fieldId, "venue");
  assert.equal(
    (result.provenance.venue as Record<string, unknown>).sourceType,
    "client_answer",
  );
});

test("every schedule item receives a fact, rule, or labeled assumption", () => {
  const result = traceScheduleDraft({
    items: [
      {
        id: "ceremony",
        title: "Ceremony",
        sourceReferences: [
          {
            type: "questionnaire_answer",
            sourceId: "response-1:ceremony-time",
            label: "Confirmed ceremony time",
          },
        ],
      },
      { id: "portraits", title: "Wedding party portraits" },
    ],
  });

  assert.equal(result.traceable, true);
  assert.equal(result.assumptionCount, 1);
  assert.equal(result.items[1]?.sourceReferences[0]?.type, "assumption");
});

test("final invoice is provider-ready only when retainer evidence reconciles", () => {
  const ready = reconcileFinalInvoice({
    packageTotalCents: 735600,
    taxCents: 45600,
    retainerExpectedCents: 182650,
    retainerPaidCents: 182650,
    providerBalanceCents: 552950,
  });
  const mismatch = reconcileFinalInvoice({
    packageTotalCents: 735600,
    taxCents: 45600,
    retainerExpectedCents: 182650,
    retainerPaidCents: 100000,
    providerBalanceCents: 552950,
  });

  assert.equal(ready.readyForProviderDraft, true);
  assert.equal(ready.expectedBalanceCents, 552950);
  assert.equal(ready.requiresHumanReview, true);
  assert.deepEqual(mismatch.discrepancies, [
    "RETAINER_EVIDENCE_MISMATCH",
    "QUICKBOOKS_BALANCE_MISMATCH",
  ]);
  assert.equal(mismatch.readyForProviderDraft, false);
});
