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
  const destructive = css.slice(
    css.indexOf(".ds-root .job-mobile > .record-archive-confirm"),
  );
  assert.match(destructive.slice(0, 260), /\.project-danger-zone/);
  assert.match(destructive.slice(0, 260), /order: \d+;/);
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

// --- the job page, after phase 2 -----------------------------------------

const detail = read("components/projects/live-project-detail.tsx");

/**
 * The thread was the whole left column at ~556px against a ~1374px rail, so
 * every job without a long conversation — every new one, every imported one —
 * showed an 818px column of white. The same shape pushed "Your crew" to 2768px
 * of a 3163px page: 87%, for the question the reference studio asked outright.
 */
test("one column holds everything that is not the rail", () => {
  assert.match(detail, /<div className="job-column">/);
  const column = detail.slice(
    detail.indexOf('<div className="job-column">'),
    detail.indexOf('<div className="job-rail">'),
  );
  for (const inside of ["{threadEl}", "<ProjectCrewPanel", "<ProjectLifecycleLanes"])
    assert.ok(column.includes(inside), `${inside} must sit in the column`);
});

test("who is on the job comes before what is outstanding", () => {
  const column = detail.slice(detail.indexOf('<div className="job-column">'));
  assert.ok(
    column.indexOf("<ProjectCrewPanel") < column.indexOf("<ProjectLifecycleLanes"),
    "the lanes in front of the crew panel are what buried it",
  );
});

/** Rendering it in both branches would double it on one of them. */
test("the crew panel is rendered once per layout", () => {
  const mobile = detail.slice(
    detail.indexOf('<div className="job-mobile">'),
    detail.indexOf('<div className="job-page-grid">'),
  );
  assert.equal(mobile.split("<ProjectCrewPanel").length - 1, 1);
  const desktop = detail.slice(detail.indexOf('<div className="job-page-grid">'));
  assert.equal(desktop.split("<ProjectCrewPanel").length - 1, 1);
});

/**
 * `.job-mobile` orders its children explicitly, so a child with no order of
 * its own defaults to 0 and jumps to the top. That is how the delete control
 * ended up above the job's next action, and adding the crew panel to that
 * container without a number would have done it again.
 */
test("every ordered child of the mobile job page has a number", () => {
  const block = css.slice(
    css.indexOf(".ds-root .job-mobile {"),
    css.indexOf(".ds-root .job-mobile > .record-archive-confirm"),
  );
  for (const selector of [".project-job-plan", ".project-crew-panel", ".job-rail-card"])
    assert.ok(block.includes(selector), `${selector} has no order in .job-mobile`);
  const orders = [...block.matchAll(/order: (\d+);/g)].map((m) => Number(m[1]));
  const destructive = css.slice(
    css.indexOf(".ds-root .job-mobile > .record-archive-confirm"),
  );
  const last = Number(/order: (\d+);/.exec(destructive)?.[1]);
  assert.ok(Number.isFinite(last), "archive and delete must carry an order");
  for (const order of orders)
    assert.ok(order < last, `order ${order} would sit below delete (${last})`);
});
