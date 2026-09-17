import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Accepting a job has to hand the crew member the day.
 *
 * Found in a live dry run: a second shooter hired with "I know who I want"
 * accepted an hour after the run of show was published, and his prep screen
 * read "Event-day brief — Not published yet — Waiting on the studio" while the
 * studio saw a published schedule and an accepted photographer. Two causes,
 * both here: the direct-invite branch only flipped a status, and the cascade
 * branch trusted an id that publication never stamps on an invited assignment.
 */
const source = readFileSync(
  `${process.cwd()}/functions/src/crew/commands.ts`,
  "utf8",
);

const respondBlock = source.slice(
  source.indexOf('if (parsed.type === "respondAssignment")'),
  source.indexOf('} else if (parsed.type === "acknowledgeSchedule"') > 0
    ? source.indexOf('} else if (parsed.type === "acknowledgeSchedule"')
    : source.length,
);

test("both offer paths run the same acceptance work", () => {
  // The direct invite (no cascade) used to end at a status update.
  assert.match(
    respondBlock,
    /if \(!cascadeId\)[\s\S]{0,900}if \(parsed\.input\.decision === "accepted"\) completeAcceptance\(\);/,
  );
  // And the cascade path calls the same helper rather than its own copy.
  assert.equal((respondBlock.match(/completeAcceptance\(\)/g) ?? []).length, 2);
  assert.equal(
    (respondBlock.match(/crewScheduleViews\//g) ?? []).length,
    1,
    "only the shared helper should write a crew schedule view",
  );
});

test("acceptance falls back to the project's published schedule", () => {
  // Not just the id stamped on the assignment, which is empty when the run of
  // show was published while this offer was still out.
  assert.match(respondBlock, /\.where\("status", "==", "published"\)/);
  assert.match(respondBlock, /const acceptedSchedule = stamped\?\.exists/);
  // And the resolved schedule is stamped back so the prep screen shows it.
  assert.match(respondBlock, /currentScheduleId: acceptedSchedule\.id/);
});

test("a declined offer still writes no schedule view", () => {
  assert.match(
    respondBlock,
    /parsed\.input\.decision !== "accepted"\s*\n?\s*\?\s*null/,
  );
});
