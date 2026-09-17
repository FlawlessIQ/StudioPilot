import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { questionnaireReminderDue } from "../features/questionnaires/reminders";

/**
 * Reminders that actually go, without nagging.
 */

const base = {
  status: "not_started",
  dueDate: "2027-05-22",
  reminderDaysBeforeDue: [14, 3],
  sentOffsets: [] as number[],
  assignedOn: "2027-04-01",
};

test("the fourteen-day reminder goes on its day, then the three-day one", () => {
  assert.equal(questionnaireReminderDue({ ...base, today: "2027-05-07" }), null);
  assert.equal(questionnaireReminderDue({ ...base, today: "2027-05-08" }), 14);
  assert.equal(questionnaireReminderDue({ ...base, sentOffsets: [14], today: "2027-05-09" }), null);
  assert.equal(questionnaireReminderDue({ ...base, sentOffsets: [14], today: "2027-05-19" }), 3);
  assert.equal(questionnaireReminderDue({ ...base, sentOffsets: [14, 3], today: "2027-05-21" }), null);
});

test("days missed send only the latest reminder, once", () => {
  assert.equal(questionnaireReminderDue({ ...base, today: "2027-05-20" }), 3);
  // Having sent that, the older fourteen-day one never follows it.
  assert.equal(questionnaireReminderDue({ ...base, sentOffsets: [3], today: "2027-05-21" }), null);
});

test("a form sent late isn't chased the same day", () => {
  assert.equal(questionnaireReminderDue({ ...base, assignedOn: "2027-05-20", today: "2027-05-20" }), null);
  assert.equal(questionnaireReminderDue({ ...base, assignedOn: "2027-05-10", today: "2027-05-19" }), 3);
});

test("nothing for a submitted form, or after the due date", () => {
  assert.equal(questionnaireReminderDue({ ...base, status: "submitted", today: "2027-05-19" }), null);
  assert.equal(questionnaireReminderDue({ ...base, status: "locked", today: "2027-05-19" }), null);
  assert.equal(questionnaireReminderDue({ ...base, today: "2027-05-23" }), null);
  assert.equal(questionnaireReminderDue({ ...base, dueDate: null, today: "2027-05-19" }), null);
});

test("features/ and functions/ decide reminders identically", () => {
  assert.equal(
    readFileSync("functions/src/planning/questionnaire-reminders.ts", "utf8"),
    readFileSync("features/questionnaires/reminders.ts", "utf8"),
  );
});
