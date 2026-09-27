import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assignmentBucket, crewAccountLabel, paperworkProgress } from "../features/crew/hub";

const now = Date.parse("2026-09-27T12:00:00Z");

test("an assignment sits in one list: upcoming, waiting on a reply, or closed", () => {
  assert.equal(assignmentBucket("accepted", "2026-10-14T15:00:00Z", now), "upcoming");
  assert.equal(assignmentBucket("invited", "2026-10-14T15:00:00Z", now), "waiting");
  assert.equal(assignmentBucket("viewed", "2026-10-14T15:00:00Z", now), "waiting");
  for (const status of ["cancelled", "declined", "expired", "reassigned", "completed"])
    assert.equal(assignmentBucket(status, "2027-01-01T00:00:00Z", now), "closed", status);
  // The day has passed.
  assert.equal(assignmentBucket("accepted", "2026-09-20T15:00:00Z", now), "closed");
  // Still today: not past yet.
  assert.equal(assignmentBucket("accepted", "2026-09-27T09:00:00Z", now), "upcoming");
});

test("a person's account says whether they've joined", () => {
  assert.equal(crewAccountLabel({ active: true, userId: "u1" }).label, "Joined");
  assert.equal(crewAccountLabel({ active: true, inviteStatus: "invited" }).label, "Invite sent");
  assert.equal(crewAccountLabel({ active: true }).label, "Not invited");
  assert.equal(crewAccountLabel({ active: false, userId: "u1" }).label, "Inactive");
});

test("paperwork counts required items that are complete or waived", () => {
  assert.deepEqual(
    paperworkProgress([
      { required: true, status: "complete" },
      { required: true, status: "waived" },
      { required: true, status: "missing" },
      { required: false, status: "missing" },
    ]),
    { done: 2, total: 3 },
  );
  assert.deepEqual(paperworkProgress(undefined), { done: 0, total: 0 });
});

test("the Crew page leads with the hub, not three stacked lists", () => {
  const page = readFileSync("app/studio/crew/page.tsx", "utf8");
  assert.match(page, /<CrewHub/);
  assert.doesNotMatch(page, /<CrewPlanProjectPicker/);
});
