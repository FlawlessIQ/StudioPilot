import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerIsPresent,
  outstandingNotice,
  outstandingRequired,
} from "@/features/questionnaires/outstanding";

/**
 * The rule this file holds: "still missing" is derived from the answers, never
 * from the static `required` attribute — so a couple is never pointed at a
 * question they have already answered.
 */

const FIELDS = [
  { id: "planner", label: "Planner", required: false },
  { id: "ceremonyTime", label: "Ceremony time", required: true },
  { id: "familyPhotoList", label: "Family photo list", required: true },
  { id: "accessibilityNeeds", label: "Accessibility needs", required: false },
];

test("Maya's actual form: ceremony time answered, photo list empty", () => {
  // The walk: both badges read REQUIRED, the notice said both were missing,
  // and 16:30 was sitting in the ceremony time field the whole time.
  const outstanding = outstandingRequired(FIELDS, {
    planner: "Gather & Grace",
    ceremonyTime: "16:30",
    familyPhotoList: "",
    accessibilityNeeds: "",
  });
  assert.deepEqual(outstanding.map((f) => f.id), ["familyPhotoList"]);
  assert.equal(
    outstandingNotice(outstanding.map((f) => f.label)),
    "Submitted — your studio is still missing Family photo list. Message them to reopen the form and add it.",
  );
});

test("a required field that is answered is never outstanding", () => {
  for (const value of ["16:30", ["a"], true, " x "]) {
    assert.deepEqual(
      outstandingRequired([FIELDS[1]!], { ceremonyTime: value }),
      [],
      JSON.stringify(value),
    );
  }
});

test("an optional field is never outstanding, however empty", () => {
  assert.deepEqual(outstandingRequired([FIELDS[3]!], {}), []);
});

test("what counts as answered", () => {
  assert.equal(answerIsPresent(""), false);
  assert.equal(answerIsPresent("   "), false);
  assert.equal(answerIsPresent([]), false);
  assert.equal(answerIsPresent(false), false);
  assert.equal(answerIsPresent(null), false);
  assert.equal(answerIsPresent(undefined), false);
  assert.equal(answerIsPresent("0"), true);
  assert.equal(answerIsPresent(true), true);
  assert.equal(answerIsPresent(["x"]), true);
});

test("the notice names one, two, three, and stops listing at four", () => {
  assert.match(outstandingNotice(["A"]), /missing A\./);
  assert.match(outstandingNotice(["A", "B"]), /missing A and B\./);
  assert.match(outstandingNotice(["A", "B", "C"]), /missing A, B and C\./);
  assert.match(outstandingNotice(["A", "B", "C", "D"]), /marked still needed/);
  assert.match(outstandingNotice([]), /^Submitted\. Message your studio/);
});
