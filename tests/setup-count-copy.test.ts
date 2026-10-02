import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SETUP_ORDER, setupQuestionCount } from "@/features/today/setup-gaps";
import { explainer } from "@/features/help/explainers";

/**
 * One setup count, everywhere.
 *
 * On 2026-10-02 the number of setup questions was stated three ways at once:
 * the setup page asked seven, Today's card said "2 of 5 answered" (a private
 * list of five that predated "what you shoot" and insurance), and the public
 * journey page promised "six questions". The screens now read the count from
 * SETUP_ORDER; this holds the words that can't, and fails when a screen goes
 * back to a number of its own.
 */
const read = (path: string) => readFileSync(path, "utf8");
/** The source without its comments: history in a comment is not a claim. */
const copy = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const word = setupQuestionCount();

test("the count in words is setup's own", () => {
  assert.equal(SETUP_ORDER.length, 7, "setup changed size: check the copy below still reads well");
  assert.equal(word, "seven");
});

test("Today counts setup's questions, not a list of its own", () => {
  const hook = read("components/today/use-today-inbox.ts");
  assert.match(hook, /answered: SETUP_ORDER\.filter\(/);
  assert.match(hook, /total: SETUP_ORDER\.length/);
  const card = copy("components/today/today-inbox.tsx");
  assert.match(card, /\$\{setup\.answered\} of \$\{setup\.total\} answered/);
  assert.doesNotMatch(card, /of [0-9]+ answered/);
});

test("copy that says how many questions says the same number", () => {
  // Read from setupQuestionCount() rather than written out.
  for (const path of [
    "components/setup/setup-conversation.tsx",
    "components/dashboard/setup-checklist.tsx",
    "app/how-to/wedding-journey/page.tsx",
  ])
    assert.match(read(path), /setupQuestionCount\(\)/, `${path} no longer derives the count`);

  // The setup guide is data, so it says the word; it must be the right one.
  const guide = explainer("setup");
  assert.ok(guide, "the setup guide moved");
  const claims = JSON.stringify(guide).match(/\b(\w+) questions\b/gi) ?? [];
  assert.ok(claims.length > 0, "the setup guide no longer says how many questions — drop this check");
  for (const claim of claims) assert.equal(claim.split(" ")[0].toLowerCase(), word, `setup guide: "${claim}"`);

  // Nowhere else hard-codes a different count.
  const numbers = ["four", "five", "six", "eight"].filter((n) => n !== word);
  const stale = new RegExp(`\\b(${numbers.join("|")})(?: short)? questions\\b|\\bof [0-9] answered\\b`, "i");
  for (const path of [
    "components/setup/setup-conversation.tsx",
    "components/dashboard/setup-checklist.tsx",
    "components/today/today-inbox.tsx",
    "app/how-to/wedding-journey/page.tsx",
    "components/help/help-center.tsx",
    "features/help/explainers.ts",
  ])
    assert.doesNotMatch(copy(path), stale, `${path} states a different setup count`);
});
