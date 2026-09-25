import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A client opened their contract from the email on a phone and sat on
 * "Opening your workspace" with no request reaching the server (production
 * walk, 2026-09-25). Everything that needs an App Check token waited on it
 * without limit. The token, and the sign-in recovery path, now time out into
 * an error the screen can offer "Try again" for.
 */
test("an App Check token cannot be waited on forever", () => {
  const source = readFileSync("lib/firebase/app-check.ts", "utf8");
  const body = source.slice(source.indexOf("export async function getAppCheckToken"));
  assert.match(body, /withTimeout\(\s*getToken\(appCheck\)/);
  assert.match(source, /APP_CHECK_TOKEN_TIMEOUT_MS = \d+/);
});

test("the workspace recovery path cannot hang on the sign-in token either", () => {
  const source = readFileSync("lib/firebase/workspace-bootstrap.ts", "utf8");
  assert.match(source, /withTimeout\(\s*user\.getIdToken\(\)/);
  assert.doesNotMatch(source, /Bearer \$\{await user\.getIdToken\(\)\}/);
});
