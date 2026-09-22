import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCHEDULE_REQUIREMENT_ID } from "@/features/crew/requirements";

/**
 * A crew member cannot declare they have read a run of show that does not exist.
 *
 * Walked as the crew member on production, 2026-09-22. The requirements list
 * offered a plain "Acknowledge" for "Current schedule acknowledged". Pressed on
 * a job whose brief still read "Not published yet — waiting on the studio", it
 * went to Complete and stayed Complete through a reload, while:
 *
 *   requirements[schedule].status = "complete"
 *   scheduleAcknowledgedAt        = null
 *   acknowledgedScheduleVersion   = null
 *   schedules in the tenant       = 0
 *
 * Two sources of truth, permanently disagreeing, and `completeAssignment`
 * reads the one that was wrong. The studio's own copy on that screen is
 * "Every one of these must be in place before the assignment is confirmed."
 *
 * The cause: the requirement is kind "acknowledgement", which crew are allowed
 * to self-complete, so it slipped past the check meant for equipment and
 * read-receipts. `acknowledgeSchedule` — which verifies the version against the
 * assignment — is the only way this may be satisfied.
 */

const commands = readFileSync("functions/src/crew/commands.ts", "utf8");
const view = readFileSync("components/crew/live-crew-views.tsx", "utf8");

test("the schedule requirement has a stable exported id", () => {
  assert.equal(SCHEDULE_REQUIREMENT_ID, "schedule");
});

test("the server refuses to let crew self-complete the schedule requirement", () => {
  assert.match(
    commands,
    /SCHEDULE_REQUIRES_ACKNOWLEDGEMENT/,
    "completeRequirement must refuse the schedule acknowledgement for crew",
  );
  const guard =
    /!internal &&\s*String\(target\.id\) === SCHEDULE_REQUIREMENT_ID/;
  assert.match(
    commands,
    guard,
    "the refusal must key on the requirement id, for crew callers only",
  );
});

test("acknowledgeSchedule still checks the version it is acknowledging", () => {
  // The guard this bypassed. If it ever softens, the fix above is pointless.
  assert.match(commands, /SCHEDULE_VERSION_IS_NOT_CURRENT/);
  assert.match(
    commands,
    /current\.get\("currentScheduleVersion"\) !==\s*parsed\.input\.scheduleVersion/,
  );
});

test("the requirements list no longer offers a bare Acknowledge for it", () => {
  const withoutComments = view
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.match(
    withoutComments,
    /text\(requirement\.id\) === SCHEDULE_REQUIREMENT_ID/,
    "the list must special-case the schedule requirement",
  );
  assert.match(
    withoutComments,
    /has not published the run of show yet/,
    "with no schedule, say so rather than offering a button",
  );
});
