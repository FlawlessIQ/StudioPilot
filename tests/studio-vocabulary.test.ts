import test from "node:test";
import assert from "node:assert/strict";
import {
  ALIAS_CONFIRMATIONS_REQUIRED,
  confirmAlias,
  resolveAlias,
  type StudioAlias,
} from "@/features/ai/studio-vocabulary";

/**
 * Remembering how a studio talks, rather than guessing at it.
 *
 * The project matcher was changed three times this month chasing one gap: the
 * reference studio files a job as "Erin Hoffman & Joseph DeMattia" and asks
 * about "erin and joe demattia". Each fix widened a heuristic, and the second
 * one did not even cover the case it was written for.
 *
 * An alias is not a heuristic. It is the operator having already said, once,
 * which record they meant — a fact about this studio's language.
 */

const seed: StudioAlias[] = [];

test("one confirmation is a typo, not a vocabulary", () => {
  const after = confirmAlias("erin and joe", "project", "demattia", seed);
  assert.equal(after[0]?.timesConfirmed, 1);
  assert.equal(
    resolveAlias("erin and joe", "project", after),
    null,
    "below the floor it must not resolve",
  );
});

test("the second confirmation makes it this studio's word for the job", () => {
  let aliases = confirmAlias("erin and joe", "project", "demattia", seed);
  aliases = confirmAlias("erin and joe", "project", "demattia", aliases);
  assert.equal(aliases.length, 1, "confirming again strengthens, never duplicates");
  assert.equal(aliases[0]?.timesConfirmed, ALIAS_CONFIRMATIONS_REQUIRED);
  assert.equal(resolveAlias("erin and joe", "project", aliases), "demattia");
});

test("punctuation and case are not different words", () => {
  let aliases = confirmAlias("Erin & Joe", "project", "demattia", seed);
  aliases = confirmAlias("erin and joe", "project", "demattia", aliases);
  assert.equal(aliases.length, 1, "'&' and 'and' are the same phrase");
  assert.equal(resolveAlias("  ERIN AND JOE ", "project", aliases), "demattia");
});

test("a phrase used for two jobs stays ambiguous", () => {
  // The dangerous case. A studio that has called two weddings "the Johnson
  // job" has told us the phrase is ambiguous — not that the newer one wins.
  let aliases = confirmAlias("the johnson job", "project", "wedding-a", seed);
  aliases = confirmAlias("the johnson job", "project", "wedding-a", aliases);
  aliases = confirmAlias("the johnson job", "project", "wedding-b", aliases);
  aliases = confirmAlias("the johnson job", "project", "wedding-b", aliases);
  assert.equal(resolveAlias("the johnson job", "project", aliases), null);
});

test("a job's alias cannot resolve a person", () => {
  // Kinds are separate so "albert" meaning a crew member never silently
  // becomes a project, which is how a wrong offer gets sent.
  let aliases = confirmAlias("albert", "crew", "albert-g", seed);
  aliases = confirmAlias("albert", "crew", "albert-g", aliases);
  assert.equal(resolveAlias("albert", "crew", aliases), "albert-g");
  assert.equal(resolveAlias("albert", "project", aliases), null);
});

test("nothing is learned from nothing", () => {
  assert.deepEqual(confirmAlias("", "project", "x", seed), []);
  assert.deepEqual(confirmAlias("something", "project", "", seed), []);
  assert.equal(resolveAlias("", "project", seed), null);
  assert.equal(resolveAlias("never said", "project", seed), null);
});
