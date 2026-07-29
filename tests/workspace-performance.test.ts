import assert from "node:assert/strict";
import test from "node:test";
import {
  RequestTimeoutError,
  withTimeout,
} from "../lib/async/with-timeout";

test("workspace requests return their result before the deadline", async () => {
  const result = await withTimeout(
    Promise.resolve("workspace-ready"),
    100,
    "timed out",
  );
  assert.equal(result, "workspace-ready");
});

test("stalled workspace requests fail with a recoverable timeout", async () => {
  await assert.rejects(
    withTimeout(
      new Promise<string>(() => undefined),
      10,
      "Workspace request timed out.",
    ),
    (error: unknown) =>
      error instanceof RequestTimeoutError &&
      error.message === "Workspace request timed out.",
  );
});
