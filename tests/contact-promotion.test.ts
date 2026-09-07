import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alreadyClientOnly,
  promoteContactTypesToClient,
} from "../functions/src/contacts/promotion.ts";

// P22: a booked couple must become a client so they appear in the Clients
// directory (which lists contactTypes.includes("client")), exactly once — not
// lingering under Prospects too.
test("booking promotes a prospect to a client and drops the prospect flag", () => {
  assert.deepEqual(promoteContactTypesToClient(["prospect"]), ["client"]);
});

test("promotion preserves other types and de-duplicates", () => {
  assert.deepEqual(
    promoteContactTypesToClient(["prospect", "vendor"]).sort(),
    ["client", "vendor"],
  );
  assert.deepEqual(promoteContactTypesToClient(["client"]), ["client"]);
});

test("promotion never yields an empty list (schema requires >= 1 type)", () => {
  assert.ok(promoteContactTypesToClient([]).length >= 1);
  assert.deepEqual(promoteContactTypesToClient([]), ["client"]);
});

test("alreadyClientOnly skips a no-op write only when client and not prospect", () => {
  assert.equal(alreadyClientOnly(["client"]), true);
  assert.equal(alreadyClientOnly(["client", "prospect"]), false);
  assert.equal(alreadyClientOnly(["prospect"]), false);
  assert.equal(alreadyClientOnly([]), false);
});
