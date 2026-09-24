import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  coverageRoleForLabel,
  coverageTradeNamed,
} from "@/features/crew/staffing-plan";

test("the trades a studio staffs are recognised however they are titled", () => {
  for (const label of ["Second photographer", "2nd shooter", "photo lead", "Stills"])
    assert.equal(coverageTradeNamed(label), "photographer", label);
  for (const label of ["Videographer", "video lead", "Cinematographer", "Film"])
    assert.equal(coverageTradeNamed(label), "videographer", label);
});

/**
 * The bug. Asked for a "drone operator", Cue opened the crew flow and called
 * the drone operator role unfilled — and `coverageRoleForLabel`, which is
 * deliberately total, would have ranked photographers against it.
 */
test("a specialism the studio does not staff names no trade", () => {
  for (const label of ["drone operator", "aerial", "DJ", "florist", "planner"])
    assert.equal(coverageTradeNamed(label), null, label);
  // The old function still answers photographer, which is why it cannot be the
  // one asked this question.
  assert.equal(coverageRoleForLabel("drone operator"), "photographer");
});

test("drone is not quietly folded into video by the video pattern", () => {
  // "drone" would match a naive /video|film|drone/ alternation as video.
  assert.equal(coverageTradeNamed("drone videographer"), null);
  assert.equal(coverageTradeNamed("aerial film"), null);
});

test("an empty or meaningless label names no trade", () => {
  for (const label of ["", "   ", "someone", "crew"])
    assert.equal(coverageTradeNamed(label), null, JSON.stringify(label));
});

const copilot = readFileSync(
  `${process.cwd()}/functions/src/ai/copilot.ts`,
  "utf8",
);

/**
 * Dropping the flow alone would leave "opening the crew flow…" on screen with
 * nothing opening — the announce-then-produce-nothing shape this file has been
 * bitten by before. The answer has to be replaced too.
 */
test("an unstaffable role drops the flow AND replaces the answer", () => {
  const block = copilot.slice(
    copilot.indexOf("const unstaffableRole ="),
    copilot.indexOf("const flowDirective ="),
  );
  assert.match(block, /coverageTradeNamed\(result\.flow\.role\) === null/);
  assert.match(block, /result\.flow = null;/);
  assert.match(block, /result\.answer =/);
  assert.match(block, /result\.facts =/);
});

test("the backstop only fires for a crew offer that named a role", () => {
  const block = copilot.slice(
    copilot.indexOf("const unstaffableRole ="),
    copilot.indexOf("const flowDirective ="),
  );
  assert.match(block, /result\.flow\?\.type === "crew_offer"/);
  // A flow with no role at all still opens on its documented default.
  assert.match(block, /result\.flow\.role\.trim\(\) !== ""/);
});

test("the functions copy of the staffing plan still matches features/", () => {
  const body = (path: string) => {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    return source.slice(source.indexOf("export const VIDEO_SPECIALTY"));
  };
  assert.equal(
    body("functions/src/crew/staffing-plan.ts"),
    body("features/crew/staffing-plan.ts"),
  );
});
