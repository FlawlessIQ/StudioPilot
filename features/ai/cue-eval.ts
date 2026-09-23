import { matchSubject } from "@/features/ai/flow-subject";

/**
 * A scenario Cue is expected to handle, and what "handled" means.
 *
 * Cue's failures this month were not the model being unintelligent. They were
 * our own deterministic seams: a project matcher that wanted the whole stored
 * name, a picker hardcoded to a photography role, a client call missing a
 * required field. Every one of those is checkable without a model — which is
 * the point of this file.
 *
 * So the eval is in two halves, deliberately:
 *
 *  - **Mechanical** — could the system find the job and the person the operator
 *    named, and is the request an action or a question? Pure functions over
 *    fixtures, run in `npm test`, no model and no network.
 *  - **Judgement** — is the answer worth reading? That needs the real model and
 *    a human or a rubric, and it lives in docs/cue-scenarios.md.
 *
 * The mechanical half is the one that regressed twice while tests stayed green,
 * so it is the one that gets automated.
 */

export type CueFixture = {
  /** Jobs as the product actually files them — see `fixtures-must-match-real-names`. */
  projects: { id: string; name: string }[];
  /** The roster, named the way a studio names people. */
  crew: { id: string; name: string }[];
};

export type CueScenario = {
  id: string;
  /** What the operator types. */
  said: string;
  /** Which job it means, or null when it is genuinely ambiguous or absent. */
  expectProject: string | null;
  /**
   * The words the model would copy into `flow.subject` — the operator's own
   * naming phrase, uncorrected. Null when they named nobody.
   */
  subjectPhrase: string | null;
  /** Which record those words should resolve to, or null when none should. */
  expectSubject: string | null;
  /**
   * Whether this is a request to act. An informational question must not
   * launch a flow, however obvious the gap it mentions.
   */
  intent: "action" | "question";
  /** Why this scenario exists — kept with it so a failure explains itself. */
  because: string;
};

export type ScenarioResult = {
  id: string;
  projectOk: boolean;
  subjectOk: boolean;
  actualProject: string | null;
  actualSubject: string | null;
  because: string;
};

/**
 * The job the sentence names.
 *
 * Mirrors `resolveFlowProjectId`'s last-resort matcher in
 * functions/src/ai/copilot.ts — the model rarely supplies an id, so this is
 * what decides in practice. Kept here so the eval can run in the app's test
 * suite without importing the functions package.
 */
export function evalProjectMatch(
  said: string,
  projects: readonly { id: string; name: string }[],
): string | null {
  const flatten = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLocaleLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const generic = new Set([
    "wedding", "weddings", "engagement", "elopement", "shoot", "session",
    "photography", "photo", "photos", "video", "videography", "coverage",
    "event", "job", "project",
  ]);
  const stop = new Set(["and", "the", "of", "for", "with", "a", "an"]);
  const haystack = flatten(said);
  const saidWords = new Set(haystack.split(" ").filter(Boolean));

  const contained = projects.filter((project) => {
    const flat = flatten(project.name);
    const words = flat.split(" ");
    let start = 0;
    let end = words.length;
    while (end > start && generic.has(words[end - 1] ?? "")) end -= 1;
    while (start < end && generic.has(words[start] ?? "")) start += 1;
    const trimmed = words.slice(start, end).join(" ");
    const needles = trimmed && trimmed !== flat && trimmed.length >= 6 ? [flat, trimmed] : [flat];
    return needles.some((needle) => needle.length >= 3 && haystack.includes(needle));
  });
  if (contained.length === 1) return contained[0]?.id ?? null;
  if (contained.length > 1) return null;

  const score = (name: string) => {
    const words = flatten(name)
      .split(" ")
      .filter((word) => word.length >= 3 && !stop.has(word) && !generic.has(word));
    if (!words.length) return 0;
    return words.filter(
      (word) =>
        saidWords.has(word) ||
        [...saidWords].some((token) => token.length >= 3 && word.startsWith(token)),
    ).length;
  };
  const scored = projects
    .map((project) => ({ id: project.id, score: score(project.name) }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  const runnerUp = scored[1];
  return best && best.score >= 2 && (!runnerUp || runnerUp.score < best.score)
    ? best.id
    : null;
}

/**
 * The person those words name, via the real subject matcher.
 *
 * Takes the phrase the MODEL would have copied into `flow.subject`, not the
 * whole sentence. Pulling the naming phrase out of a sentence is the model's
 * job — the prompt tells it to copy the operator's words verbatim — and a
 * deterministic stand-in here would be testing a different system.
 *
 * An earlier version of this file slid a window over the sentence looking for
 * any sub-phrase that matched. It "passed" a deliberately misspelled surname by
 * matching the first name alone, which is precisely the wrong-person offer the
 * strict matcher exists to prevent. The harness was wrong, not the product.
 */
export function evalSubjectMatch(
  subjectPhrase: string | null,
  crew: readonly { id: string; name: string }[],
): string | null {
  if (!subjectPhrase) return null;
  const match = matchSubject(subjectPhrase, crew);
  return match.kind === "matched" ? match.id : null;
}

export function runScenario(
  scenario: CueScenario,
  fixture: CueFixture,
): ScenarioResult {
  const actualProject = evalProjectMatch(scenario.said, fixture.projects);
  const actualSubject = evalSubjectMatch(scenario.subjectPhrase, fixture.crew);
  return {
    id: scenario.id,
    actualProject,
    actualSubject,
    projectOk: actualProject === scenario.expectProject,
    subjectOk: actualSubject === scenario.expectSubject,
    because: scenario.because,
  };
}

export function scoreScenarios(
  scenarios: readonly CueScenario[],
  fixture: CueFixture,
): { results: ScenarioResult[]; passed: number; failed: ScenarioResult[] } {
  const results = scenarios.map((scenario) => runScenario(scenario, fixture));
  const failed = results.filter((result) => !result.projectOk || !result.subjectOk);
  return { results, passed: results.length - failed.length, failed };
}
