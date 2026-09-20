import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { errorCodeHasCopy, friendlyError } from "@/lib/ai/friendly-error";

/**
 * Fixes from the 2026-09-20 UX audit, pinned.
 *
 * The audit's finding was not a list of bugs but a pattern: a capability ships
 * into the engine and the editor, and the **list screens keep the pre-change
 * shape**. Coverage roles reached the package editor, the proposal and the
 * cascade while the catalogue still read "480" and "Yes"; crew trades reached
 * the ranker and all three forms while the directory still showed a count.
 * These assert the lists, because the lists are what nobody updates.
 */
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const view = read("components/studio/live-domain-view.tsx");
const css = read("app/globals.css");

// --- the lists say what the record actually is ---------------------------

test("the catalogue says who the studio is sending, not a bare minute count", () => {
  // A 2-videographer package and a 2-photographer package rendered
  // identically: "Coverage 480 · Yes".
  assert.match(view, /kind: "coverage"/);
  assert.match(view, /describeCoverage\(resolveCoverage\(record\)\)/);
});

test("the crew directory shows the trade", () => {
  const crew = view.slice(view.indexOf('collection: "crewProfiles"'));
  assert.match(crew.slice(0, 900), /label: "Shoots", fields: \["trades"\]/);
});

test("a boolean status gets words, not Yes", () => {
  // "Yes" is an answer with the question missing; it was the `active` flag.
  assert.match(view, /statusLabels\?: readonly \[string, string\]/);
  assert.match(view, /statusLabels: \["Active", "Inactive"\]/);
  assert.match(view, /config\.statusLabels\[rawStatus \? 0 : 1\]/);
});

/**
 * Insurance became a studio setting defaulting to off (G5). The directory went
 * on reporting it missing for every collaborator — a red flag about a document
 * the studio has said it does not want.
 */
test("the insurance column follows the studio setting", () => {
  assert.match(view, /requireInsuranceOf\(crewSettings\)/);
  assert.match(view, /fact\.label !== "Insurance"/);
});

// --- Cue never shows the studio an exception ------------------------------

test("only coded failures leave the copilot", () => {
  const copilot = read("functions/src/ai/copilot.ts");
  assert.match(copilot, /\/\^\[A-Z\]\[A-Z0-9_\]\{3,\}\$\/\.test\(raw\)/);
  assert.match(copilot, /"AI_COPILOT_UNAVAILABLE"/);
  // The real text still has to reach the logs, or nothing is diagnosable.
  assert.match(copilot, /message: raw/);
});

test("the metadata throw is coded, not only the non-ok response", () => {
  const token = read("functions/src/ai/vertex-token.ts");
  // `fetch` rejects outright when the metadata server is unreachable, and that
  // rejection was a bare TypeError the studio was shown as Cue's answer.
  assert.match(token, /\} catch \{\s*throw new Error\("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE"\);/);
});

test("a studio is never shown the words 'fetch failed'", () => {
  assert.equal(errorCodeHasCopy("AI_COPILOT_UNAVAILABLE"), true);
  // Node's undici says "fetch failed"; the browser says "Failed to fetch".
  // Only the browser's wording was listed, so the server's slipped through.
  for (const raw of ["fetch failed", "Failed to fetch"]) {
    const copy = friendlyError(new Error(raw), "fallback");
    assert.doesNotMatch(copy, /fetch/i, raw);
  }
});

// --- the destructive control is not the first thing on a phone ------------

/**
 * `.job-mobile` orders its children explicitly. Archive and delete arrive from
 * the same fragment as the rail cards but carried no order, so they defaulted
 * to 0 and sorted above the next-move card: on a phone the first things under
 * the job's name were "Archive job" and a red "Delete this job permanently".
 */
test("archive and delete sort last on the mobile job page", () => {
  const rule = css.slice(
    css.indexOf(".ds-root .job-mobile > .record-archive-confirm"),
  );
  assert.match(rule.slice(0, 260), /\.project-danger-zone/);
  assert.match(rule.slice(0, 260), /order: 5;/);
  // 5 has to beat every other order in that block.
  const block = css.slice(
    css.indexOf(".ds-root .job-mobile {"),
    css.indexOf(".ds-root .job-mobile > .record-archive-confirm"),
  );
  for (const order of [...block.matchAll(/order: (\d+);/g)])
    assert.ok(Number(order[1]) < 5, `order ${order[1]} would sit below delete`);
});

// --- icons are not the part that gives way -------------------------------

test("the people tabs keep their icons", () => {
  // Measured in the audit: 2px for Clients and 0px for Vendors against a 14px
  // height, because `.section-nav a` is flex:1 1 0 and the svg inherits shrink.
  assert.match(css, /\.section-nav a > svg \{ flex: none; \}/);
});

test("the trade pills beat the form's own label rule", () => {
  // `.crew-form-preview form label` is 0-1-2 and won over `.crew-trade-options
  // label` at 0-1-1, so display:grid stacked the box above its word.
  assert.match(css, /\.crew-trade-field \.crew-trade-options label \{/);
  assert.match(css, /\.crew-trade-field \.crew-trade-options label:has\(input:checked\)/);
});
