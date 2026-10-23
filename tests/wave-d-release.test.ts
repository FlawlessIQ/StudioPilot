import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fallbackModelFor, DEFAULT_FALLBACK_MODEL } from "../functions/src/ai/vertex-fetch.ts";

/**
 * Wave D of the 2026-10-22 reliability review: the release itself can't be the
 * outage — versions pinned, every step in one command, and AI that survives
 * a model being retired.
 */
const read = (path: string) => readFileSync(path, "utf8");
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });

test("a retired model falls back instead of failing the feature", () => {
  assert.equal(fallbackModelFor("gemini-3.1-flash-lite", { VERTEX_AI_FALLBACK_MODEL: "gemini-3.8-flash" }), "gemini-3.8-flash");
  assert.equal(fallbackModelFor("gemini-3.1-flash-lite", { VERTEX_AI_COPILOT_MODEL: "gemini-3.8-flash" }), "gemini-3.8-flash");
  assert.equal(fallbackModelFor("x", {}), DEFAULT_FALLBACK_MODEL);
  // Nowhere else to go: the failure stands.
  assert.equal(fallbackModelFor("gemini-3.8-flash", { VERTEX_AI_FALLBACK_MODEL: "gemini-3.8-flash" }), null);
  const fetcher = read("functions/src/ai/vertex-fetch.ts");
  assert.match(fetcher, /if \(response\.status !== 404\) return response;/);
  assert.match(fetcher, /code: "VERTEX_MODEL_UNAVAILABLE"/);
});

test("every model call goes through the fallback", () => {
  const direct = sources("functions/src").filter(
    (path) => !/vertex-(endpoint|fetch)\.ts$/.test(path) && /fetch\(\s*vertexEndpoint\(|const endpoint = vertexEndpoint\(/.test(read(path)),
  );
  assert.deepEqual(direct, []);
  assert.match(read("functions/src/ai/vertex-transport.ts"), /retryTransient\(\(\) =>\s*vertexFetch\(/);
});

test("the function image is pinned, not whatever was newest that day", () => {
  const deploy = read("scripts/deploy-functions-self-contained.sh");
  assert.match(deploy, /FROM node:22\.22\.0-slim@sha256:[0-9a-f]{64}/);
  assert.doesNotMatch(deploy, /npm install --no-save/);
  assert.equal(JSON.parse(read("functions/package.json")).dependencies["@google-cloud/functions-framework"], "3.5.1");
});

test("one release command runs every step, in order, and stops on failure", () => {
  const release = read("scripts/release.sh");
  assert.match(release, /set -euo pipefail/);
  const order = ["0. Node 22", "1. main, clean, up to date", "2. Gates", "3. Functions", "4. Rules and indexes", "5. Function images", "6. Push and roll out the app", "7. Probes"];
  let at = -1;
  for (const label of order) {
    const next = release.indexOf(`step "${label}`);
    assert.ok(next > at, label);
    at = next;
  }
  assert.match(release, /\[ "\$\{node_major\}" = "22" \] \|\| fail/);
  assert.match(release, /\.startswith\(commit\)/);
});
