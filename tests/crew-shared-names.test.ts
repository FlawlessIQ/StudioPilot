import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { needsQualifier, sharedNames } from "@/features/crew/shared-names";

test("a name two people share is flagged; a unique one is not", () => {
  const shared = sharedNames([
    { name: "Conor Lawless" },
    { name: "Conor Lawless" },
    { name: "Marco Silva" },
  ]);
  assert.equal(shared.size, 1);
  assert.equal(needsQualifier("Conor Lawless", shared), true);
  assert.equal(needsQualifier("Marco Silva", shared), false);
});

test("the comparison ignores case and surrounding space", () => {
  const shared = sharedNames([{ name: "conor lawless" }, { name: "  Conor Lawless " }]);
  assert.equal(needsQualifier("CONOR LAWLESS", shared), true);
});

test("blank names are not a collision with each other", () => {
  const shared = sharedNames([{ name: "" }, { name: "   " }, { name: "Marco Silva" }]);
  assert.equal(shared.size, 0);
});

test("three of a name is still one flagged name", () => {
  const shared = sharedNames([
    { name: "Sam Lee" },
    { name: "Sam Lee" },
    { name: "Sam Lee" },
  ]);
  assert.deepEqual([...shared], ["sam lee"]);
});

const flow = readFileSync(`${process.cwd()}/components/ai/flow-runner.tsx`, "utf8");

/**
 * C2: two identically named candidates rendered as two identical buttons, and
 * the offer that follows carries a fee.
 */
test("the copilot crew card qualifies a shared name", () => {
  assert.match(flow, /const duplicateNames = sharedNames\(ranked\);/);
  assert.match(flow, /needsQualifier\(candidate\.name, duplicateNames\)/);
});

/** Compact by default — a line of address under every row is noise on a phone. */
test("the qualifier is conditional, not shown on every candidate", () => {
  const row = flow.slice(flow.indexOf("{picked ? \"✓ \" : \"\"}"));
  const upToReason = row.slice(0, row.indexOf("candidate.explanations[0]"));
  assert.match(upToReason, /needsQualifier\([^)]*\) \? \(/);
});
