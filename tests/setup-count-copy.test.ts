import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SETUP_ORDER, setupOrderFor, setupQuestionCount } from "@/features/today/setup-gaps";
import { explainer } from "@/features/help/explainers";
import { TRADES } from "@/features/trades/trades";

/**
 * One setup count, everywhere.
 *
 * On 2026-10-02 the number of setup questions was stated three ways at once:
 * the setup page asked seven, Today's card said "2 of 5 answered" (a private
 * list of five that predated "what you shoot" and insurance), and the public
 * journey page promised "six questions". The screens now read the count from
 * the studio's own order (setupOrderFor: a photographer's seven, a vendor's
 * four, 2026-10-09); this holds the words that can't, and fails when a screen
 * goes back to a number of its own.
 */
const read = (path: string) => readFileSync(path, "utf8");
/** The source without its comments: history in a comment is not a claim. */
const copy = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const word = setupQuestionCount();
/** Every count a studio's screen may state: one per trade. */
const words = new Set(TRADES.map((trade) => setupQuestionCount(trade)));
const VENDORS = ["dj", "makeup", "hair"] as const;

test("the count in words is setup's own, per trade", () => {
  assert.equal(SETUP_ORDER.length, 7, "setup changed size: check the copy below still reads well");
  assert.equal(word, "seven");
  assert.equal(setupQuestionCount("photographer"), "seven");
  for (const trade of VENDORS) {
    assert.equal(setupOrderFor(trade).length, 4, `${trade} changed size: check the copy below still reads well`);
    assert.equal(setupQuestionCount(trade), "four", trade);
  }
  assert.deepEqual([...words].sort(), ["four", "seven"]);
});

test("Today counts setup's questions, not a list of its own", () => {
  const hook = read("components/today/use-today-inbox.ts");
  assert.match(hook, /answered: setupOrderFor\(workspace\.tenantTrade\)\.filter\(/);
  assert.match(hook, /total: setupOrderFor\(workspace\.tenantTrade\)\.length/);
  assert.doesNotMatch(copy("components/today/use-today-inbox.ts"), /SETUP_ORDER/);
  const card = copy("components/today/today-inbox.tsx");
  assert.match(card, /\$\{setup\.answered\} of \$\{setup\.total\} answered/);
  assert.doesNotMatch(card, /of [0-9]+ answered/);
});

test("copy that says how many questions says the same number", () => {
  // Read from setupQuestionCount() rather than written out: with the
  // studio's trade on its own screens, a photographer's on the public page
  // (it sells to photographers).
  for (const [path, derived] of [
    ["components/setup/setup-conversation.tsx", /setupQuestionCount\(workspace\.tenantTrade\)/],
    ["components/dashboard/setup-checklist.tsx", /setupQuestionCount\(tenantTrade\)/],
    ["app/how-to/wedding-journey/page.tsx", /setupQuestionCount\(\)/],
  ] as const)
    assert.match(read(path), derived, `${path} no longer derives the count`);
  // A studio's screens list and count its own order, never the photographer's.
  for (const path of ["components/setup/setup-conversation.tsx", "components/dashboard/setup-checklist.tsx"])
    assert.doesNotMatch(copy(path), /SETUP_ORDER/, `${path} reads the photographer's order`);

  // The setup guide is data, so it says the word; it must be the right one.
  const guide = explainer("setup");
  assert.ok(guide, "the setup guide moved");
  const claims = JSON.stringify(guide).match(/\b(\w+) questions\b/gi) ?? [];
  assert.ok(claims.length > 0, "the setup guide no longer says how many questions — drop this check");
  for (const claim of claims) assert.equal(claim.split(" ")[0].toLowerCase(), word, `setup guide: "${claim}"`);

  // Nowhere else hard-codes a count no trade has.
  const numbers = ["four", "five", "six", "seven", "eight"].filter((n) => !words.has(n));
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

/**
 * The setup guide's words are data with a trade: a vendor reading Help should
 * be told her four: features/help/explainers.ts (the "setup" guide's summary,
 * purpose and last step) says so per trade.
 */
test(
  "the setup guide states a vendor's own count",
  () => {
    for (const trade of VENDORS) {
      const guide = explainer("setup", trade);
      assert.ok(guide, "the setup guide moved");
      const claims = JSON.stringify(guide).match(/\b(\w+) questions\b/gi) ?? [];
      for (const claim of claims)
        assert.equal(claim.split(" ")[0].toLowerCase(), setupQuestionCount(trade), `${trade} setup guide: "${claim}"`);
    }
  },
);
