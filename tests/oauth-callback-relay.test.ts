import assert from "node:assert/strict";
import test from "node:test";
import {
  GET,
  POST,
} from "../app/api/integrations/oauth/callback/route.ts";

test("OAuth callback relay rejects non-GET requests", async () => {
  const response = POST();

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "METHOD_NOT_ALLOWED" });
});

test("OAuth callback relay requires a bounded state and authorization result", async () => {
  const missing = await GET(
    new Request(
      "https://studiohub.test/api/integrations/oauth/callback?code=code",
    ),
  );
  assert.equal(missing.status, 400);

  const oversized = await GET(
    new Request(
      `https://studiohub.test/api/integrations/oauth/callback?state=${"a".repeat(301)}&code=code`,
    ),
  );
  assert.equal(oversized.status, 400);
});
