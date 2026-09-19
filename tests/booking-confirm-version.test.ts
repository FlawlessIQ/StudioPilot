import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Confirming a booking must ask against the version the server holds now.
 *
 * Found on production, twice in a row, on the manual-attestation path — the
 * one every studio without a signing provider takes. Record the retainer, hit
 * "Check and confirm", and the command is refused with
 * PROJECT_VERSION_CONFLICT, which reaches the studio as "This action could not
 * be completed." Reload the page and the same click books the job.
 *
 * Recording the retainer does call `load()`; the project's own state moves a
 * beat after that read, so the component is left a version behind. The fix is
 * to read `stateVersion` at the moment of asking rather than trusting what was
 * last rendered — a source guard, because the race needs a live Firestore to
 * reproduce and nothing else would catch a revert.
 */
const source = readFileSync(
  `${process.cwd()}/components/booking/project-booking-workspace.tsx`,
  "utf8",
);

const reviewBooking = () => {
  const start = source.indexOf("async function reviewBooking()");
  assert.ok(start > 0, "reviewBooking must exist");
  return source.slice(start, start + 2200);
};

test("the booking gate reads the project's version before it asks", () => {
  const body = reviewBooking();
  assert.match(
    body,
    /getDoc\(doc\([^)]*"projects", projectId\)\)/,
    "reviewBooking must re-read the project immediately before sending",
  );
});

test("the version sent is the one just read, not component state", () => {
  const body = reviewBooking();
  const read = body.indexOf("getDoc(doc(");
  const sent = body.indexOf("expectedProjectVersion,");
  assert.ok(read > 0 && sent > 0, "both landmarks must exist");
  assert.ok(read < sent, "the fresh read must happen before the command");
  // The stale source is allowed only as the fallback when the doc is gone.
  const staleUses = [...body.matchAll(/project\.stateVersion/g)].length;
  assert.equal(
    staleUses,
    1,
    "component state may only be the fallback for a project that cannot be read",
  );
});
