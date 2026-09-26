import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicLeadIntakeSchema } from "@/features/leads/schema";

/**
 * The studio's front door has to work, and has to say when it does not.
 *
 * Walked on 2026-09-22 by submitting a real inquiry to a real studio's public
 * link. "Send inquiry" was pressed four times with every visible field filled
 * and the page did nothing — no request, no message, no movement. The cause was
 * **City**: required by the schema, unmarked on the form, sitting below the
 * fold, and failing with Zod's own words —
 *
 *   "Too small: expected string to have >=2 characters"
 *
 * shown to somebody enquiring about their wedding. A couple reads that, decides
 * the form is broken, and emails a different studio. There is no error report
 * and no lead; the studio never learns it happened.
 */

const form = readFileSync("components/crm/lead-intake-form.tsx", "utf8");

const complete = {
  tenantSlug: "test-studio",
  firstName: "Dana",
  lastName: "Okafor",
  email: "dana@example.com",
  phone: "2125550177",
  eventDate: "2027-09-11",
  eventType: "wedding",
  city: "Brooklyn",
  servicesRequested: ["photography"],
  message: "We are planning a September wedding for about 120 guests.",
  consent: true,
};

test("a complete inquiry is accepted", () => {
  assert.ok(publicLeadIntakeSchema.safeParse(complete).success);
});

test("no refusal reaches a client in the validator's own words", () => {
  // Every field a person can get wrong, checked for machine phrasing.
  const machine = /expected string|too small|too big|invalid literal|invalid_type|received|nan/i;
  const cases: Array<[string, Record<string, unknown>]> = [
    ["city", { ...complete, city: "" }],
    ["firstName", { ...complete, firstName: "" }],
    ["lastName", { ...complete, lastName: "" }],
    ["email", { ...complete, email: "not-an-email" }],
    ["phone", { ...complete, phone: "12" }],
    ["message", { ...complete, message: "hi" }],
    ["consent", { ...complete, consent: false }],
    ["eventDate", { ...complete, eventDate: "sometime" }],
  ];
  for (const [field, value] of cases) {
    const parsed = publicLeadIntakeSchema.safeParse(value);
    assert.ok(!parsed.success, `${field} should have been refused`);
    for (const issue of parsed.error.issues) {
      assert.doesNotMatch(
        issue.message,
        machine,
        `${field} tells a prospective client: "${issue.message}"`,
      );
      assert.match(
        issue.message,
        /[a-z] [a-z]/i,
        `${field} needs a sentence, not a token: "${issue.message}"`,
      );
    }
  }
});

test("a refused submit tells the person, and takes them to the field", () => {
  // react-hook-form's handleSubmit silently does nothing on invalid input
  // unless an onInvalid handler is supplied. That silence was the whole defect.
  assert.match(
    form,
    /\}, onInvalid\);/,
    "handleSubmit needs its onInvalid handler, or a refusal is invisible",
  );
  assert.match(form, /scrollIntoView/, "take them to the first failing field");
  assert.match(form, /role="alert"/, "and announce it");
});

test("every field the schema requires is marked required on the form", () => {
  // City was required and unmarked, which is why nobody could see what was
  // wrong. Keep the visible contract and the schema in step.
  for (const field of ["First name", "Last name", "Email", "Phone", "Event date", "City"]) {
    const pattern = new RegExp(
      `${field} <span className="required-mark">`,
    );
    assert.match(form, pattern, `${field} is required but not marked`);
  }
});

test("a studio previewing its own form creates no inquiry", () => {
  // A preview submit created a real lead, which hid Today's "Get your
  // inquiries in" card for good and ticked setup's capture question.
  const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
  assert.match(read("app/inquiry/page.tsx"), /preview=\{preview === "studio"\}/);
  const form = read("components/crm/lead-intake-form.tsx");
  assert.match(form, /if \(!endpoint \|\| preview\)/, "a preview never reaches publicLeadIntake");
  assert.match(form, /Nothing was saved/);
  // Setup's own Preview link says it's the studio looking.
  assert.match(read("components/setup/setup-conversation.tsx"), /&preview=studio/);
});
