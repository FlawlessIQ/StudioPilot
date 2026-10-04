import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

// ── CI ──

test("every push to main runs the checks CLAUDE.md asks for", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /branches: \[main\]/);
  for (const step of ["npm run typecheck", "npm test", "npm run lint", "npm run test:rules", "npm run test:storage-rules"]) {
    assert.ok(ci.includes(`run: ${step}`), step);
  }
  assert.match(ci, /working-directory: functions/);
  // npm test imports functions/src, so the test job installs functions' packages too.
  const appJob = ci.slice(ci.indexOf("app:"), ci.indexOf("functions:\n"));
  assert.match(appJob, /run: npm ci\n\s+working-directory: functions/);
});
