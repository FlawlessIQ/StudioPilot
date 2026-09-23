import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  scoreScenarios,
  type CueFixture,
  type CueScenario,
} from "@/features/ai/cue-eval";

/**
 * The standing eval for the seams Cue actually fails at.
 *
 * Twice this month a Cue defect shipped while every test stayed green, because
 * the tests exercised invented fixtures. This one uses the reference studio's
 * real roster and real job names, read off production on 2026-09-22, and the
 * phrasings its operator really typed.
 *
 * Mechanical only, on purpose — no model, no network. Whether an answer is
 * *worth reading* is judged against docs/cue-scenarios.md with the real model.
 */

const fixture: CueFixture = {
  projects: [
    { id: "demattia", name: "Erin Hoffman & Joseph DeMattia" },
    { id: "lucas", name: "Sydney Lucas & Ryan Conklin wedding" },
    { id: "holtz", name: "Sarah Holtz & Jonathan Gross" },
    { id: "hernon", name: "Kelly Hernon & Daniel Archer" },
    { id: "baumwoll", name: "Heather Baumwoll" },
    { id: "summit", name: "Northstar Annual Summit" },
  ],
  crew: [
    { id: "albert", name: "Albert Gershengoren" },
    { id: "marco", name: "Marco Silva" },
    { id: "jordan", name: "Jordan Reid" },
  ],
};

const scenarios: CueScenario[] = [
  {
    id: "gabe-verbatim",
    said: "add albert gershengoren to 2nd photogrpaher for erin and joe demattia",
    subjectPhrase: "albert gershengoren",
    expectProject: "demattia",
    expectSubject: "albert",
    intent: "action",
    because:
      "the sentence from the transcript: role misspelled, couple shortened, job filed with full names",
  },
  {
    id: "shortened-couple",
    said: "staff the sydney and ryan wedding",
    subjectPhrase: null,
    expectProject: "lucas",
    expectSubject: null,
    intent: "action",
    because: "first names only, against a job filed with surnames and a suffix",
  },
  {
    id: "person-only",
    said: "add marco silva as videographer",
    subjectPhrase: "marco silva",
    expectProject: null,
    expectSubject: "marco",
    intent: "action",
    because: "names a person and no job — the job must not be guessed",
  },
  {
    id: "surname-only-job",
    said: "add a second shooter for baumwoll",
    subjectPhrase: null,
    expectProject: null,
    expectSubject: null,
    intent: "action",
    because:
      "one word is not enough to pick a wedding; a lone surname collides too easily",
  },
  {
    id: "full-name-job",
    said: "staff heather baumwoll",
    subjectPhrase: null,
    expectProject: "baumwoll",
    expectSubject: null,
    intent: "action",
    because: "the name in full still matches by containment",
  },
  {
    id: "unknown-job",
    said: "staff the ellis job",
    subjectPhrase: null,
    expectProject: null,
    expectSubject: null,
    intent: "action",
    because: "a job that does not exist resolves to nothing, never to the nearest",
  },
  {
    id: "misspelled-person",
    said: "add albert gershengoran for kelly and daniel",
    subjectPhrase: "albert gershengoran",
    expectProject: "hernon",
    expectSubject: null,
    intent: "action",
    because:
      "a misspelled surname must not match: a wrong match emails a job offer, at a fee, to the wrong person",
  },
  {
    id: "first-name-only-person",
    said: "add albert for kelly and daniel",
    subjectPhrase: "albert",
    expectProject: "hernon",
    expectSubject: "albert",
    intent: "action",
    because: "one Albert on the roster, so a first name is unambiguous",
  },
  {
    id: "corporate-job",
    said: "who is booked on the northstar annual summit",
    subjectPhrase: null,
    expectProject: "summit",
    expectSubject: null,
    intent: "question",
    because: "not every job is a wedding, and this one carries no generic suffix",
  },
  {
    id: "informational",
    said: "is erin and joe demattia ready?",
    subjectPhrase: null,
    expectProject: "demattia",
    expectSubject: null,
    intent: "question",
    because:
      "resolves the job, but the intent is a question — a flow here hijacks it",
  },
];

test("the mechanical eval passes on every scenario", () => {
  const { failed, passed, results } = scoreScenarios(scenarios, fixture);
  if (failed.length) {
    const detail = failed
      .map(
        (result) =>
          `  ${result.id}: project=${result.actualProject} subject=${result.actualSubject}\n    (${result.because})`,
      )
      .join("\n");
    assert.fail(
      `${failed.length} of ${results.length} Cue scenarios regressed:\n${detail}`,
    );
  }
  assert.equal(passed, scenarios.length);
});

test("the eval covers both kinds of intent", () => {
  // An eval made only of action requests cannot catch a flow hijacking a
  // question, which is one of the four causes the 2026-09-19 batch fixed.
  assert.ok(scenarios.some((scenario) => scenario.intent === "question"));
  assert.ok(scenarios.some((scenario) => scenario.intent === "action"));
});

test("every scenario says why it exists", () => {
  for (const scenario of scenarios)
    assert.ok(
      scenario.because.length > 20,
      `${scenario.id} needs a reason a later reader can act on`,
    );
});

/**
 * The prompt is the least-tested, highest-leverage artifact in Cue. A change to
 * it cannot break a type or fail a build, so nothing currently tells the author
 * that behaviour may have moved. This fails on any edit, and the fix is to
 * re-run the scenarios in docs/cue-scenarios.md and update the fingerprint.
 */
test("a change to Cue's prompt is deliberate and re-evaluated", () => {
  const source = readFileSync("functions/src/ai/copilot.ts", "utf8");
  const start = source.indexOf("const COPILOT_SYSTEM_INSTRUCTION");
  const end = source.indexOf("const COPILOT_MAX_TOOL_ITERATIONS");
  assert.ok(start > 0 && end > start, "could not locate the system instruction");
  const prompt = source.slice(start, end);
  // Length is a coarse but honest proxy: it moves on any real edit, and does
  // not churn on reformatting the way a hash of the whole block would.
  const size = prompt.replace(/\s+/g, " ").length;
  const EXPECTED = 13950;
  const drift = Math.abs(size - EXPECTED);
  assert.ok(
    drift < 40,
    `Cue's system instruction changed (${size} chars, expected ~${EXPECTED}).\n` +
      "That is fine — but re-run docs/cue-scenarios.md against the real model\n" +
      "before shipping, then set EXPECTED to the new size. Nothing else will\n" +
      "tell you the wording moved.",
  );
});
