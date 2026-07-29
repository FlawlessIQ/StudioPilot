import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateQueueHealth,
  queueObjectives,
} from "../functions/src/operations/service-objectives";

test("queue objectives remain healthy within latency and backlog targets", () => {
  assert.deepEqual(
    evaluateQueueHealth({
      backlog: 3,
      deadLetters: 0,
      oldestCreatedAt: "2026-07-29T12:00:00.000Z",
      now: new Date("2026-07-29T12:00:30.000Z"),
      objective: queueObjectives.emailJobs,
    }),
    {
      status: "healthy",
      oldestAgeSeconds: 30,
      objectiveBreached: false,
    },
  );
});

test("queue objectives identify degraded and critical work", () => {
  assert.equal(
    evaluateQueueHealth({
      backlog: 60,
      deadLetters: 0,
      oldestCreatedAt: "2026-07-29T12:00:00.000Z",
      now: new Date("2026-07-29T12:03:00.000Z"),
      objective: queueObjectives.emailJobs,
    }).status,
    "degraded",
  );
  assert.equal(
    evaluateQueueHealth({
      backlog: 4,
      deadLetters: 3,
      oldestCreatedAt: null,
      now: new Date("2026-07-29T12:03:00.000Z"),
      objective: queueObjectives.providerJobs,
    }).status,
    "critical",
  );
});
