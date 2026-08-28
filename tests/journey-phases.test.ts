import assert from "node:assert/strict";
import test from "node:test";
import {
  groupJourneyByPhase,
  journeyPhase,
  journeyPhaseOrder,
} from "@/features/journey/phases";
import type { JourneyStep, JourneyStepKey } from "@/features/journey/steps";

const allKeys: JourneyStepKey[] = [
  "inquiry",
  "first_reply",
  "consultation",
  "proposal",
  "contract",
  "retainer",
  "schedule_form",
  "run_of_show",
  "crew",
  "coi",
  "final_balance",
  "day_before",
  "event_day",
  "delivery",
  "album_review",
];

const step = (
  key: JourneyStepKey,
  status: JourneyStep["status"] = "upcoming",
): JourneyStep => ({
  key,
  title: key,
  detail: "",
  status,
  action: null,
  record: null,
  owner: null,
  unlock: null,
  advance: null,
});

test("every journey step belongs to a phase", () => {
  for (const key of allKeys) {
    assert.ok(
      journeyPhaseOrder.includes(journeyPhase(key)),
      `${key} has no phase — a step with no arc would vanish from the rail`,
    );
  }
});

test("grouping preserves step order and drops empty phases", () => {
  const groups = groupJourneyByPhase([
    step("inquiry"),
    step("proposal"),
    step("contract"),
    step("delivery"),
  ]);
  assert.deepEqual(
    groups.map((group) => group.phase),
    ["enquire", "book", "deliver"],
  );
  assert.deepEqual(
    groups[1].steps.map((entry) => entry.key),
    ["proposal", "contract"],
  );
});

test("a phase counts its own progress and knows when it holds the job", () => {
  const groups = groupJourneyByPhase([
    step("inquiry", "complete"),
    step("consultation", "complete"),
    step("proposal", "current"),
    step("contract"),
  ]);
  const [enquire, book] = groups;
  assert.equal(enquire.complete, 2);
  assert.equal(enquire.active, false);
  assert.equal(book.complete, 0);
  assert.equal(book.active, true);
});

test("a step waiting on the client still marks its phase active", () => {
  // "Active" means the job is here, not that the studio owes something.
  const [, book] = groupJourneyByPhase([
    step("inquiry", "complete"),
    step("contract", "waiting_client"),
  ]);
  assert.equal(book.active, true);
});

test("the balance sits with the week of the wedding, not with planning", () => {
  // It is chased in the run-up, alongside the day-before checklist.
  assert.equal(journeyPhase("final_balance"), "the_day");
  assert.equal(journeyPhase("coi"), "prepare");
});

/**
 * A step the event overtook is neither done nor to-do.
 *
 * Counting it only in the denominator made a wedding that had already been shot
 * read "Preparation 2/4" and "8/14" overall — six things looking outstanding
 * that nobody could ever do again.
 */
test("a phase reports what the event overtook, separately from what is done", () => {
  const groups = groupJourneyByPhase([
    step("schedule_form", "passed"),
    step("run_of_show", "passed"),
    step("crew", "complete"),
    step("coi", "complete"),
  ]);
  const prepare = groups.find((group) => group.phase === "prepare");
  assert.ok(prepare);
  assert.equal(prepare.complete, 2);
  assert.equal(prepare.missed, 2);
  assert.equal(prepare.steps.length, 4);
  // And it is not activity, so the phase does not read as in progress.
  assert.equal(prepare.active, false);
});

test("nothing missed reports zero, not null", () => {
  const groups = groupJourneyByPhase([step("crew", "complete")]);
  assert.equal(groups[0]?.missed, 0);
});
