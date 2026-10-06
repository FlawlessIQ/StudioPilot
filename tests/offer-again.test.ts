import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  lapsedOnJob,
  offerIsOver,
  spokenForOnJob,
} from "../features/crew/offer-again";

const JOB = "job_1";

test("an expired offer leaves the person offerable again on the job", () => {
  const assignments = [
    { projectId: JOB, crewProfileId: "albert", status: "expired" },
    { projectId: JOB, crewProfileId: "vittor", status: "accepted" },
    { projectId: JOB, crewProfileId: "maya", status: "invited" },
    { projectId: JOB, crewProfileId: "sam", status: "declined" },
    { projectId: "other", crewProfileId: "lee", status: "accepted" },
  ];
  assert.deepEqual([...spokenForOnJob(assignments, JOB)].sort(), ["maya", "vittor"]);
  assert.deepEqual([...lapsedOnJob(assignments, JOB)], ["albert"]);
});

test("a lapsed offer does not count once the person holds a live one", () => {
  const assignments = [
    { projectId: JOB, crewProfileId: "albert", status: "expired" },
    { projectId: JOB, crewProfileId: "albert", status: "invited" },
  ];
  assert.equal(lapsedOnJob(assignments, JOB).size, 0);
  assert.ok(spokenForOnJob(assignments, JOB).has("albert"));
});

test("only finished offers are over", () => {
  for (const status of ["declined", "cancelled", "expired", "reassigned"])
    assert.equal(offerIsOver(status), true, status);
  for (const status of ["draft", "invited", "viewed", "accepted", "completed"])
    assert.equal(offerIsOver(status), false, status);
});

test("both ways back to a lapsed person use the shared rule", () => {
  const direct = readFileSync("components/crew/direct-invite-form.tsx", "utf8");
  assert.match(direct, /spokenForOnJob\(/);
  assert.doesNotMatch(direct, /\["declined", "cancelled"\]\.includes/);
  const workspace = readFileSync("components/crew/crew-cascade-workspace.tsx", "utf8");
  assert.match(workspace, /askedFor\(cascade\)\.filter\(\(id\) => !lapsed\.has\(id\)\)/);
});
