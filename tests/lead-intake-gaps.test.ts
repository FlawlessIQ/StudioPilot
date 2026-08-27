import assert from "node:assert/strict";
import { test } from "node:test";
import { leadIntakeGaps } from "@/features/crm/lead-intake";

const facts = (over: Partial<Parameters<typeof leadIntakeGaps>[0]> = {}) => ({
  email: "lena@example.com",
  phone: "917-555-0100",
  eventDate: "2027-10-03",
  declaredMissing: [] as string[],
  ...over,
});

test("a complete inquiry has no gaps", () => {
  assert.deepEqual(leadIntakeGaps(facts()), []);
});

test("no email and no phone is the gap that blocks everything", () => {
  // The case the lead page called complete: both contact routes absent while
  // its own Contact panel said "Not provided" twice.
  const gaps = leadIntakeGaps(facts({ email: null, phone: null }));
  assert.equal(gaps.length, 1);
  assert.match(gaps[0] ?? "", /reach them/);
});

test("a phone number alone is workable; a missing email is still named", () => {
  const gaps = leadIntakeGaps(facts({ email: null }));
  assert.equal(gaps.length, 1);
  assert.match(gaps[0] ?? "", /email address/);
  // Email present, phone absent — nothing is blocked.
  assert.deepEqual(leadIntakeGaps(facts({ phone: null })), []);
});

test("the intake's own declarations are kept, tidied, and not duplicated", () => {
  const gaps = leadIntakeGaps(
    facts({ declaredMissing: ["guest_count", "", "guest_count"] }),
  );
  assert.deepEqual(gaps, ["guest count"]);
});

test("a missing date is named", () => {
  assert.deepEqual(leadIntakeGaps(facts({ eventDate: null })), [
    "the event date",
  ]);
});
