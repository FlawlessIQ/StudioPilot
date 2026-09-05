import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import { buildClientPortalExperience } from "../server/client/portal-experience.ts";

/**
 * Guards for the six issues the second production walk found (audit-2 N1–N6).
 * Most are source assertions for the same reason the originals were invisible:
 * nothing executed the Firebase-heavy handlers or the client-only components.
 * N3 gets a real unit test because its function is pure and exported.
 */

// N3 — an accepted proposal must not tell the couple to "Review your proposal".
test("N3: PROPOSAL + accepted proposal hands the next move to the studio", () => {
  const experience = buildClientPortalExperience({
    state: "PROPOSAL",
    proposalStatus: "accepted",
    availability: { proposal: true },
    checkpoints: [],
  });
  assert.notEqual(
    experience.nextClientAction.name,
    "Review your proposal",
    "an already-accepted proposal must not be re-offered for review",
  );
  assert.equal(
    experience.nextClientAction.ownerType,
    "studio",
    "after acceptance the ball is with the studio (prepare the agreement)",
  );
});

// Control: an un-accepted shared proposal still asks the couple to review it.
test("N3 control: PROPOSAL without acceptance still asks for review", () => {
  const experience = buildClientPortalExperience({
    state: "PROPOSAL",
    proposalStatus: "sent",
    availability: { proposal: true },
    checkpoints: [],
  });
  assert.equal(experience.nextClientAction.name, "Review your proposal");
});

// N4 — publishing must not tell the couple "your schedule is ready" when no
// item is visible to them, and the AI drafter must default the running order
// to shared so the couple normally sees it.
test("N4: publishSchedule gates the client email on client-visible items", () => {
  const src = readFileSync("functions/src/planning/commands.ts", "utf8");
  assert.match(
    src,
    /clientVisibleItemCount/,
    "publishSchedule must count client-visible items",
  );
  const gateIndex = src.indexOf("clientVisibleItemCount > 0");
  const clientEmailIndex = src.indexOf("emailJobs/schedule_client_");
  assert.notEqual(gateIndex, -1, "the client-visible gate must exist");
  assert.ok(
    gateIndex !== -1 && gateIndex < clientEmailIndex,
    "the schedule_client email must sit behind the client-visible gate",
  );
});

test("N4: the AI schedule drafter defaults the running order to shared", () => {
  const src = readFileSync("functions/src/ai/schedule.ts", "utf8");
  assert.match(
    src,
    /couple's portal shows only items marked/i,
    "the prompt must explain the couple only sees client/shared items",
  );
  assert.match(
    src,
    /MUST be \\?"shared\\?"/,
    "the prompt must require the client-facing running order to be shared",
  );
});

// N5 — the run-of-show checkpoint completes on a usable publish, not on a
// couple approval that has no UI. The copy must not claim couple approval.
test("N5: schedule_approved copy no longer claims couple approval", () => {
  const src = readFileSync(
    "features/readiness/checkpoint-resolution.ts",
    "utf8",
  );
  const caseIndex = src.indexOf('case "schedule_approved":');
  assert.notEqual(caseIndex, -1);
  const body = src.slice(caseIndex, caseIndex + 800);
  assert.doesNotMatch(
    body,
    /couple approves the run of show/,
    "schedule_approved must not tell the couple to approve a run of show",
  );
  assert.match(
    body,
    /Completes when you publish/,
    "it completes on the studio publishing a client-visible run of show",
  );
});

// N2 — the invited email must survive the sign-out → login round-trip so the
// login form prefills it (not the studio account the browser just left).
test("N2: invite stashes the invited email and sign-in reads it", () => {
  const invite = readFileSync(
    "features/auth/accept-client-invitation.tsx",
    "utf8",
  );
  assert.match(
    invite,
    /sessionStorage\.setItem\("studiohub\.invitedEmail"/,
    "the invite must stash the invited email before switching accounts",
  );
  const form = readFileSync("features/auth/sign-in-form.tsx", "utf8");
  assert.match(
    form,
    /sessionStorage\.getItem\("studiohub\.invitedEmail"\)/,
    "the sign-in form must prefill from the stashed invited email",
  );
});

// N6 — a required field in the collapsed delivery section must not silently
// block release; the section opens on invalid submit.
test("N6: delivery release opens the collapsed section on invalid submit", () => {
  const src = readFileSync("components/post-event/delivery-form.tsx", "utf8");
  assert.match(
    src,
    /onInvalidCapture=/,
    "the form must react to native validation on a hidden required field",
  );
  assert.match(
    src,
    /open=\{advancedOpen\}/,
    "the follow-ups section must be controlled so it can be opened on failure",
  );
});

// N1 — the AI reply preview must preserve the draft's paragraph breaks.
test("N1: AI queue preview preserves paragraph breaks", () => {
  const src = readFileSync("components/ai/ai-approval-queue.tsx", "utf8");
  assert.match(
    src,
    /whiteSpace: "pre-wrap"/,
    "the draft body preview must not collapse the model's \\n\\n breaks",
  );
});
