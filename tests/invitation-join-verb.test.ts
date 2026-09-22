import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The button has to describe what pressing it does.
 *
 * Walked as a crew member on a phone, 2026-09-22. A subcontractor opening
 * their first offer saw "Create account and accept" under the line "Test has
 * an assignment for you" — with no job, no date, no venue, no role and no fee
 * anywhere on the screen.
 *
 * Pressing it does not take the job. The very next screen says "The assignment
 * is now available in your crew workspace" and offers "Review assignment". So
 * the button overstated a commitment, contradicted its own confirmation, and
 * did it at the first moment a subcontractor ever meets the product.
 *
 * The label is shared with invitations where accepting IS what happens, so the
 * verb belongs to the caller.
 */

const join = readFileSync("features/auth/invitation-join.tsx", "utf8");
const crew = readFileSync("features/auth/accept-crew-invitation.tsx", "utf8");

test("the shared join button takes its verb from the caller", () => {
  assert.match(join, /verb = "accept"/, "the default keeps existing callers");
  assert.match(
    join,
    /`Create account and \$\{verb\}`/,
    "the button must compose the caller's verb, not hardcode 'accept'",
  );
  assert.doesNotMatch(
    join,
    /"Create account and accept"/,
    "the hardcoded label is what overstated the commitment",
  );
});

test("a crew assignment invite does not claim to accept the job", () => {
  assert.match(
    crew,
    /verb=\{preview\.kind === "assignment"/,
    "a crew assignment invite must pass its own verb",
  );
  assert.doesNotMatch(
    crew.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
    /verb=\{[^}]*"accept"\s*:\s*"accept"\}/,
    "both branches saying accept defeats the point",
  );
});

test("the invitation form lays its password hint under the field", () => {
  // At 375px the hint sat to the RIGHT of the input and wrapped beneath it,
  // because the label had no layout rule at all — the same missing-rule class
  // as the trade checkboxes in the 09-20 audit.
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(
    css,
    /\.invite-actions label\{display:grid/,
    "the invite form's label needs an explicit layout",
  );
});
