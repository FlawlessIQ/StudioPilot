import assert from "node:assert/strict";
import test from "node:test";
import {
  JOB_KINDS,
  JOB_KIND_LABELS,
  honoreeContext,
  honoreeFieldsOf,
  honoreeOf,
  journeyProfile,
  kindVariants,
  mitzvahOf,
  namesHonoree,
  variantFieldFor,
  variantFromLabel,
  vocab,
} from "@/features/job-kinds/job-kinds";
import { EXAMPLE_PACKAGES } from "@/features/job-kinds/example-packages";
import { HONOREE_KINDS } from "@/features/leads/inquiry-form-config";
import { OFFERED_KIND_FORMS, recommendedLibraryFor } from "@/features/questionnaires/recommended-templates";
import { CHECKLIST_KINDS, checklistFor, CHECKLIST_SCOPES } from "@/features/planning/planning-checklist";
import { INQUIRY_FORM_KINDS } from "../functions/src/intake/inquiry-form.ts";
import { TRADES } from "@/features/trades/trades";

/**
 * Adding a job kind is rows in tables (docs/adding-a-job-kind-playbook.md;
 * docs/new-job-kinds-execution-plan-2026-10-15.md, Phase 0). These checks
 * fail when a kind is half-added: a row in one table and not its partner.
 */

test("every kind has a label, words, a profile and example packages", () => {
  for (const kind of JOB_KINDS) {
    assert.ok(JOB_KIND_LABELS[kind], `${kind}: label`);
    assert.ok(vocab(kind).event, `${kind}: vocab`);
    assert.equal(journeyProfile(kind).kind, kind, `${kind}: profile`);
    assert.ok(EXAMPLE_PACKAGES[kind], `${kind}: example packages`);
  }
});

test("the per-kind lists agree with what each kind has", () => {
  const sorted = (values: readonly string[]) => [...values].sort();
  // The inquiry asks who it celebrates for exactly the kinds that have someone.
  assert.deepEqual(
    sorted(HONOREE_KINDS),
    sorted(JOB_KINDS.filter((kind) => journeyProfile(kind).honoree)),
    "HONOREE_KINDS (inquiry-form-config.ts) must list every kind with profile.honoree",
  );
  // A kind whose forms exist is offered them when a studio first adds it.
  const formKinds = new Set(
    TRADES.flatMap((trade) => recommendedLibraryFor(trade).map((form) => form.eventTypeId)).filter((kind) => kind !== "wedding"),
  );
  assert.deepEqual(sorted(OFFERED_KIND_FORMS), sorted([...formKinds]), "OFFERED_KIND_FORMS must list every kind with recommended forms");
  // A kind with its own details form gets its own inquiry-form picker.
  const detailKinds = TRADES.flatMap((trade) => recommendedLibraryFor(trade))
    .filter((form) => form.id === `${form.eventTypeId}-details` && form.eventTypeId !== "wedding")
    .map((form) => form.eventTypeId);
  assert.deepEqual(sorted(INQUIRY_FORM_KINDS), sorted([...new Set(detailKinds)]), "INQUIRY_FORM_KINDS must list every kind with a <kind>-details form");
  // A kind with its own planner checklist gets its own tab in settings.
  const ownChecklist = JOB_KINDS.filter(
    (kind) =>
      kind !== "wedding" &&
      CHECKLIST_SCOPES.some((scope) => JSON.stringify(checklistFor(undefined, scope, kind)) !== JSON.stringify(checklistFor(undefined, scope))),
  );
  assert.deepEqual(sorted(CHECKLIST_KINDS), sorted(ownChecklist), "CHECKLIST_KINDS must list every kind with its own checklist");
});

test("an honoree kind names its person, and its variants are readable both ways", () => {
  for (const kind of JOB_KINDS.filter((each) => journeyProfile(each).honoree)) {
    const variants = kindVariants(kind);
    const field = variantFieldFor(kind);
    assert.equal(Boolean(field), variants.length > 0, `${kind}: a variant field exactly when it has variants`);
    for (const variant of variants) {
      assert.equal(variantFromLabel(kind, variant.label), variant.id, `${kind}: "${variant.label}" reads back as ${variant.id}`);
    }
    if (variants.length > 1) {
      const both = `${variants[0]!.label} or ${variants[1]!.label}`;
      assert.equal(variantFromLabel(kind, both), null, `${kind}: "${both}" names two, so neither`);
    }
    const job = { eventKind: kind, honoreeName: "Sam", ...(field ? { [field]: variants[0]!.id } : {}) };
    assert.match(vocab(kind, job).YourEvent, /^Sam's /, `${kind}: names the person`);
    assert.equal(namesHonoree(job), true);
    assert.deepEqual(honoreeOf(job), { name: "Sam", variant: variants[0]?.id ?? null });
  }
});

test("the mitzvah reads exactly as it did before the honoree went generic", () => {
  const job = { eventKind: "mitzvah", honoreeName: "Sam", mitzvahType: "bar", eventTypeLabel: "Bar or bat mitzvah" };
  assert.deepEqual(mitzvahOf(job), { type: "bar", honoree: "Sam" });
  assert.deepEqual(honoreeContext(job), { honoreeName: "Sam", mitzvahType: "bar" });
  assert.deepEqual(honoreeFieldsOf(job), { honoreeName: "Sam", mitzvahType: "bar" });
  assert.equal(vocab("mitzvah", job).YourEvent, "Sam's bar mitzvah");
  assert.deepEqual(mitzvahOf({ eventKind: "mitzvah", eventTypeLabel: "Bat Mitzvah" }), { type: "bat", honoree: null });
  assert.equal(vocab("mitzvah", { eventKind: "mitzvah", honoreeName: "Sam" }).YourEvent, vocab("mitzvah").YourEvent);
  assert.equal(namesHonoree({ eventKind: "mitzvah", honoreeName: "Sam" }), false);
  // A kind without an honoree has none to copy.
  assert.deepEqual(honoreeContext({ eventKind: "wedding", honoreeName: "Sam" }), {});
});
