import assert from "node:assert/strict";
import test from "node:test";
import { crewPublicError } from "../lib/crew/public-error";

test("crew errors never expose Firestore permission details", () => {
  const message = crewPublicError(
    new Error("FirebaseError: Missing or insufficient permissions at crewScheduleViews/secret"),
    "The schedule could not be loaded.",
  );
  assert.match(message, /not available for your current assignment/i);
  assert.doesNotMatch(message, /firebase|crewScheduleViews/i);
});

test("crew network and timeout errors offer useful recovery language", () => {
  assert.match(
    crewPublicError(new Error("Failed to fetch"), "Could not load."),
    /check your connection/i,
  );
  assert.match(
    crewPublicError(new Error("Request timeout"), "Could not load."),
    /taking longer than expected/i,
  );
});

test("unknown crew errors use the safe operation-specific fallback", () => {
  assert.equal(
    crewPublicError(new Error("INTERNAL_PROVIDER_42"), "Your document could not be submitted."),
    "Your document could not be submitted.",
  );
});
