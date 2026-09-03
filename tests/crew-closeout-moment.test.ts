import assert from "node:assert/strict";
import { test } from "node:test";
import {
  crewCloseoutIsSubmitted,
  crewCloseoutMoment,
} from "@/features/crew/closeout-moment";

/**
 * The rule this file holds: a crew member is told when the studio is waiting on
 * their work record, because that record is what stands between them and being
 * paid.
 *
 * The crew home page built its headline from invitations and schedule
 * acknowledgements only, so a second shooter who had shot a wedding nineteen
 * days earlier and was owed $800 — payment cannot be scheduled until the hours
 * are in — read "Nothing needs you right now."
 */

const now = new Date("2026-09-03T12:00:00.000Z");
const past = "2026-08-15T21:30:00.000Z";
const future = "2026-10-03T21:30:00.000Z";

test("an unsubmitted record on a past job is his to send in", () => {
  const moment = crewCloseoutMoment({
    status: "accepted",
    closeoutStatus: "",
    endsAt: past,
    now,
  });
  assert.deepEqual(moment, { due: true, reason: "not_submitted" });
});

test("nothing is due before the day", () => {
  /**
   * The mirror of the defect that had "Readiness blocker · Acknowledge the
   * current schedule" leading the page thirteen days after the wedding was
   * shot: hours and expenses cannot be recorded for work not yet done.
   */
  assert.equal(
    crewCloseoutMoment({
      status: "accepted",
      closeoutStatus: "",
      endsAt: future,
      now,
    }).due,
    false,
  );
});

test("a submitted record is out of his hands", () => {
  for (const closeoutStatus of ["submitted", "approved", "paid"]) {
    assert.equal(
      crewCloseoutMoment({
        status: "accepted",
        closeoutStatus,
        endsAt: past,
        now,
      }).due,
      false,
      closeoutStatus,
    );
  }
});

test("needs_changes is his again, and says so", () => {
  /**
   * The studio asked him for something. The closeout page already says "The
   * studio requested changes"; the home page has to agree rather than treating
   * a returned record as settled.
   */
  assert.deepEqual(
    crewCloseoutMoment({
      status: "accepted",
      closeoutStatus: "needs_changes",
      endsAt: past,
      now,
    }),
    { due: true, reason: "needs_changes" },
  );
  assert.equal(crewCloseoutIsSubmitted("needs_changes"), false);
});

test("completed work still owes a record", () => {
  // The studio marks `completed`; that does not mean the hours arrived.
  assert.equal(
    crewCloseoutMoment({
      status: "completed",
      closeoutStatus: "",
      endsAt: past,
      now,
    }).due,
    true,
  );
});

test("work he never took on is not his to close out", () => {
  for (const status of ["invited", "viewed", "declined", "withdrawn", "expired"]) {
    assert.equal(
      crewCloseoutMoment({
        status,
        closeoutStatus: "",
        endsAt: past,
        now,
      }).due,
      false,
      status,
    );
  }
});

test("an unreadable date is never treated as past", () => {
  // Prompting for hours on a job whose date cannot be read would be worse than
  // staying quiet: he cannot check whether it is even his.
  assert.equal(
    crewCloseoutMoment({
      status: "accepted",
      closeoutStatus: "",
      endsAt: "",
      now,
    }).due,
    false,
  );
});
