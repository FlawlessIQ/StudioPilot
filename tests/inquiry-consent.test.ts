import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { publicLeadIntakeSchema } from "@/features/leads/schema";

/**
 * Consent the person actually gave.
 *
 * The inquiry form arrived with "I agree that <studio> may contact me about
 * this inquiry" already ticked, so the only way to withhold it was to notice it
 * and untick it. Opt-in is the entire point of asking.
 */
const base = {
  tenantSlug: "studio",
  firstName: "Harper",
  lastName: "Lane",
  email: "harper@example.com",
  phone: "518-555-0163",
  eventDate: "2027-05-15",
  eventType: "wedding",
  city: "Hudson, NY",
  message: "We are getting married at Oak Hill Barn and would love two photographers.",
  servicesRequested: ["photography"],
};

test("an inquiry without consent is refused, with words a person can act on", () => {
  const refused = publicLeadIntakeSchema.safeParse({ ...base, consent: false });
  assert.equal(refused.success, false);
  if (!refused.success) {
    const issue = refused.error.issues.find((item) => item.path.includes("consent"));
    assert.equal(issue?.message, "Please tick the box so we know we may reply to you.");
  }
  assert.equal(publicLeadIntakeSchema.safeParse({ ...base, consent: true }).success, true);
});

test("the form starts unticked", () => {
  const form = readFileSync(`${process.cwd()}/components/crm/lead-intake-form.tsx`, "utf8");
  assert.match(form, /consent: false,/);
  assert.doesNotMatch(form, /consent: true,/);
});
