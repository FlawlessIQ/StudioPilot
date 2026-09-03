import assert from "node:assert/strict";
import { test } from "node:test";
import {
  journeyStepRequires,
  projectJourney,
  type JourneyInput,
  type JourneyStepKey,
} from "@/features/journey/steps";
import { projectStateSchema } from "@/features/projects/schema";

/**
 * The rule this file exists to hold: the next move is always a move the studio
 * can actually make.
 *
 * "YOUR NEXT MOVE · Send contract · Built from the accepted proposal" appeared
 * on a job whose proposal had been sent ninety seconds earlier and never
 * opened. Following it reached a page that answered "The client's accepted
 * proposal is required first." The card named a step, described it as consuming
 * something that had not arrived, and linked to a refusal.
 *
 * One stage later the same thing happened again — "Draft the schedule · Drafted
 * from the form" against a details form at 0% — which is what showed it was
 * structural rather than a slip: `steps.find((step) => step.status ===
 * "current")` skips a step that is `waiting_client` and hands the card to
 * whatever comes next, unasked.
 *
 * Both were found by a person clicking through the product. Neither would have
 * been caught by a test of either step, because each step was individually
 * correct — the defect lived in the relationship between them. So this asserts
 * the relationship, across every combination of records it can construct.
 *
 * Sibling to tests/error-copy-coverage.test.ts and
 * tests/manual-advance.test.ts: a rule, held by comparing what the engine does
 * against what it declared, rather than a list of remembered bugs.
 */

/** Records a job could plausibly hold, including the skewed combinations. */
const PROPOSAL = [null, "draft", "sent", "viewed", "accepted"] as const;
const CONTRACT = [null, "sent", "viewed", "completed"] as const;
const RETAINER = [null, "sent", "overdue", "paid"] as const;
const QUESTIONNAIRE = [null, "assigned", "in_progress", "submitted"] as const;
const SCHEDULE = [null, "draft", "client_review", "approved"] as const;
/** With and without an originating inquiry — `first_reply` exists only with one. */
const LEADS = [null, { id: "l1", status: "new" }] as const;

const STATES = projectStateSchema.options;

/**
 * Every state crossed with every record combination — about 30,000 journeys,
 * and the engine is a pure function, so the whole sweep runs in well under a
 * second.
 *
 * The impossible-looking rows matter most. A job marked BOOKED whose proposal
 * record says nothing, or one at PROPOSAL whose contract is already completed,
 * are exactly the shapes that produce a wrong next move: the engine reads a
 * state rank *and* the records, and in real data the two disagree far more
 * often than anyone expects — a manual stage advance, an import, a provider
 * webhook that arrived out of order. The job that exposed this bug was itself
 * such a case, its acceptance recorded by hand rather than by a provider.
 */
function* journeys(): Generator<JourneyInput> {
  for (const state of STATES) {
    for (const lead of LEADS) {
      for (const proposalStatus of PROPOSAL) {
        for (const contractStatus of CONTRACT) {
          for (const retainerInvoiceStatus of RETAINER) {
            for (const questionnaireStatus of QUESTIONNAIRE) {
              for (const scheduleStatus of SCHEDULE) {
                yield {
                  projectId: "p1",
                  state,
                  eventDate: "2027-06-12",
                  today: "2026-09-02",
                  lead,
                  hasConsultation: state !== "LEAD",
                  proposalStatus,
                  contractStatus,
                  retainerInvoiceStatus,
                  finalInvoiceStatus: null,
                  questionnaireStatus,
                  questionnaireHasAnswers: questionnaireStatus === "submitted",
                  scheduleStatus,
                  scheduleHasUsableItems: scheduleStatus !== null,
                  crewAccepted: 0,
                  crewRequired: 0,
                  crewCascadeActive: false,
                  coiStatus: null,
                  insuranceRequired: "unknown",
                  dayBeforeDraftStatus: null,
                  hasDelivery: false,
                  albumOrReviewDone: false,
                };
              }
            }
          }
        }
      }
    }
  }
}

const describe = (input: JourneyInput) =>
  [
    `state=${input.state}`,
    `lead=${input.lead ? "yes" : "no"}`,
    `proposal=${input.proposalStatus}`,
    `contract=${input.contractStatus}`,
    `retainer=${input.retainerInvoiceStatus}`,
    `form=${input.questionnaireStatus}`,
    `schedule=${input.scheduleStatus}`,
  ].join(" ");

/** The first few offenders, so a failure reads as a diagnosis not a dump. */
const SHOWN = 6;

test("every step the engine can produce declares what it needs", () => {
  /**
   * Over the whole sweep, not one input: `first_reply` exists only on a job
   * that came from an inquiry, and `event_day` changes shape once the date has
   * passed. Checking a single journey would let a step slip in undeclared
   * simply by not appearing in the one case chosen.
   */
  const produced = new Set<string>();
  for (const input of journeys()) {
    for (const step of projectJourney(input).steps) produced.add(step.key);
  }
  const declared = Object.keys(journeyStepRequires) as JourneyStepKey[];

  assert.deepEqual(
    [...produced].filter((key) => !declared.includes(key as JourneyStepKey)),
    [],
    "A step the engine produces has no entry in journeyStepRequires. Declare what it needs — an empty list is a real answer, and the reason is worth writing down.",
  );
  assert.deepEqual(
    declared.filter((key) => !produced.has(key)),
    [],
    "journeyStepRequires names a step no journey produces. Either the step is gone and the entry should be deleted, or the sweep above no longer reaches it.",
  );
});

test("a next move never depends on a step that has not happened", () => {
  const failures: string[] = [];
  for (const input of journeys()) {
    const { steps } = projectJourney(input);
    const byKey = new Map(steps.map((step) => [step.key, step]));
    for (const step of steps) {
      if (step.status !== "current") continue;
      for (const required of journeyStepRequires[step.key]) {
        const predecessor = byKey.get(required);
        if (predecessor && predecessor.status !== "complete") {
          failures.push(
            `${step.key} is current while ${required} is ${predecessor.status} — ${describe(input)}`,
          );
        }
      }
    }
  }
  assert.deepEqual(
    failures.slice(0, SHOWN),
    [],
    `A step claimed the next-move card before its own input existed, so the card names work the studio cannot do and links to a page that will refuse them.

Fix in features/journey/steps.ts: gate that step's \`current\` on its requirement, the way \`contract\` and \`retainer\` do, and let the card fall through to the waiting state it already has — "Nothing for you right now" — rather than to the following step.

${failures.length} failing${failures.length > SHOWN ? `, first ${SHOWN}` : ""}:
${failures.slice(0, SHOWN).map((line) => `  ${line}`).join("\n")}`,
  );
});

test("an upcoming step never offers an action", () => {
  const failures: string[] = [];
  for (const input of journeys()) {
    for (const step of projectJourney(input).steps) {
      if (step.status === "upcoming" && step.action) {
        failures.push(
          `${step.key} is upcoming but offers "${step.action.label}" — ${describe(input)}`,
        );
      }
    }
  }
  assert.deepEqual(
    failures.slice(0, SHOWN),
    [],
    `An upcoming step offered a button. Upcoming means the work cannot start yet, so the button leads somewhere that will refuse it — the other half of the same defect, which is how "Send contract" reached a page saying the accepted proposal was required first. Drop the action while a step is upcoming; \`unlock\` already carries the sentence explaining what opens it.

${failures.length} failing${failures.length > SHOWN ? `, first ${SHOWN}` : ""}:
${failures.slice(0, SHOWN).map((line) => `  ${line}`).join("\n")}`,
  );
});

test("a current step always offers something to do", () => {
  const failures: string[] = [];
  for (const input of journeys()) {
    for (const step of projectJourney(input).steps) {
      if (step.status !== "current") continue;
      if (step.action || step.advance) continue;
      failures.push(
        `${step.key} is current with neither an action nor an advance — ${describe(input)}`,
      );
    }
  }
  assert.deepEqual(
    failures.slice(0, SHOWN),
    [],
    `A step is the studio's next move and offers no way to make it, so the card says "do this" with nothing to press. Give it an action, a manual advance, or a status that is honest about waiting.

${failures.length} failing${failures.length > SHOWN ? `, first ${SHOWN}` : ""}:
${failures.slice(0, SHOWN).map((line) => `  ${line}`).join("\n")}`,
  );
});

test("the next move the job page renders obeys its own preconditions", () => {
  /**
   * The card reads `current` off the return value rather than scanning the
   * array, so this asserts the thing a studio actually sees. It follows from
   * the invariant above and is checked separately because this is the field
   * that reaches the screen: if the two ever diverge, this is the one that
   * matters.
   */
  const failures: string[] = [];
  for (const input of journeys()) {
    const { steps, current } = projectJourney(input);
    if (!current) continue;
    const byKey = new Map(steps.map((step) => [step.key, step]));
    for (const required of journeyStepRequires[current.key]) {
      const predecessor = byKey.get(required);
      if (predecessor && predecessor.status !== "complete") {
        failures.push(
          `next move ${current.key} needs ${required}, which is ${predecessor.status} — ${describe(input)}`,
        );
      }
    }
  }
  assert.deepEqual(
    failures.slice(0, SHOWN),
    [],
    `The next move on the job page depends on a step that has not happened.

${failures.length} failing${failures.length > SHOWN ? `, first ${SHOWN}` : ""}:
${failures.slice(0, SHOWN).map((line) => `  ${line}`).join("\n")}`,
  );
});
