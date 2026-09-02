import assert from "node:assert/strict";
import test from "node:test";
import { calculateReadiness } from "@/features/readiness/engine";
import { readinessSummary } from "@/features/projects/readiness-summary";
import { checkpointFixture, workflowTimestamp } from "./fixtures/workflow";

const NOW = new Date(workflowTimestamp);

const assess = (checkpoints: ReturnType<typeof checkpointFixture>[]) =>
  calculateReadiness({
    id: "project-1",
    tenantId: "tenant-a",
    projectId: "project-1",
    workflowRunId: "run-1",
    checkpoints,
    calculatedAt: workflowTimestamp,
  });

test("the display summary scores exactly what the readiness engine scores", () => {
  const checkpoints = [
    checkpointFixture({ id: "complete", status: "complete" }),
    checkpointFixture({
      id: "blocked",
      name: "Final schedule approved",
      status: "ready",
    }),
    checkpointFixture({ id: "nonblocking", blocking: false, status: "not_started" }),
  ];
  const engine = assess(checkpoints);
  const summary = readinessSummary(checkpoints, NOW);

  assert.equal(summary.tracked, true);
  assert.equal(summary.percent, engine.score);
  assert.equal(summary.blocking.length, engine.blockingItems.length);
  assert.deepEqual(summary.blocking, ["Final schedule approved"]);
});

test("an active waiver counts as satisfied in both, an expired one in neither", () => {
  const active = [
    checkpointFixture({
      status: "waived",
      waiverReason: "Owner approved operational exception.",
      waiverExpiresAt: "2026-07-27T12:00:00.000Z",
    }),
  ];
  assert.equal(readinessSummary(active, NOW).percent, assess(active).score);
  assert.equal(readinessSummary(active, NOW).percent, 100);

  const expired = [
    checkpointFixture({
      status: "waived",
      waiverReason: "Owner approved operational exception.",
      waiverExpiresAt: "2026-07-01T12:00:00.000Z",
    }),
  ];
  assert.equal(readinessSummary(expired, NOW).percent, assess(expired).score);
  assert.equal(readinessSummary(expired, NOW).percent, 0);
});

test("no required checkpoint means untracked, not zero per cent", () => {
  // The contradiction this replaces: a header reading "—  readiness tracking
  // starts once planning begins" beside a footer reading "68% ready".
  const summary = readinessSummary(
    [checkpointFixture({ blocking: false, status: "not_started" })],
    NOW,
  );
  assert.equal(summary.tracked, false);
  assert.deepEqual(summary.blocking, []);
  // The engine reports 0 here; the UI must say "not tracked", never "0%".
  assert.equal(assess([checkpointFixture({ blocking: false })]).score, 0);
});

test("an empty checkpoint list is untracked", () => {
  assert.deepEqual(readinessSummary([], NOW), {
    tracked: false,
    percent: 0,
    blocking: [],
  });
});

test("the blocker list leads with what is due soonest", () => {
  /**
   * The caller renders the head of this list as "8 blockers: X +7 more", and
   * it was in template order — so a wedding nine months out headlined with
   * "Final balance paid", a client payment not due until a fortnight before
   * the day and correctly outstanding. The item chosen to stand for the eight
   * was the least actionable of them.
   */
  const summary = readinessSummary(
    [
      {
        id: "cp-balance",
        blocking: true,
        status: "not_started",
        name: "Final balance paid",
        resolvedDueDate: "2027-05-29",
      },
      {
        id: "cp-venue",
        blocking: true,
        status: "not_started",
        name: "Venue confirmed",
        resolvedDueDate: "2027-05-13",
      },
      {
        id: "cp-undated",
        blocking: true,
        status: "not_started",
        name: "Something with no date",
        resolvedDueDate: null,
      },
    ],
    new Date("2026-09-02T12:00:00.000Z"),
  );
  assert.deepEqual(summary.blocking, [
    "Venue confirmed",
    "Final balance paid",
    // Undated last: no date is not more urgent than a date this month.
    "Something with no date",
  ]);
});
