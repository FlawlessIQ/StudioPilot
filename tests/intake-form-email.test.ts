import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  htmlToText,
  labelToField,
  plausiblePersonName,
  readFields,
  readInquiryEmail,
  valuesFromFields,
  withoutLinkTargets,
} from "../functions/src/intake/form-email";

/**
 * Reading an inquiry out of a website's notification email. Each fixture in
 * tests/fixtures/form-emails/ is one email and what reading it must produce.
 */

type Fixture = {
  from: string;
  fromName: string | null;
  replyTo: string | null;
  subject: string;
  text: string;
  html: string | null;
  expect: Record<string, unknown>;
};

const DIR = "tests/fixtures/form-emails";
const fixtures = readdirSync(DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => [file, JSON.parse(readFileSync(`${DIR}/${file}`, "utf8")) as Fixture] as const);

const TODAY = "2026-09-25";

for (const [file, fixture] of fixtures) {
  test(`${file}: read as the form stated it`, () => {
    const read = readInquiryEmail(
      {
        from: fixture.from,
        fromName: fixture.fromName,
        replyTo: fixture.replyTo,
        subject: fixture.subject,
        text: fixture.text,
        html: fixture.html,
        studioAddresses: ["studio@hartlight.example"],
      },
      { today: TODAY },
    );
    const expect = fixture.expect;
    const value = (key: string) => read.values[key as keyof typeof read.values]?.value;
    if ("builder" in expect) assert.equal(read.builder, expect.builder, "builder");
    if ("verdict" in expect) assert.equal(read.verdict, expect.verdict, "verdict");
    if ("contactSource" in expect) assert.equal(read.contactSource, expect.contactSource, "contactSource");
    if ("forwarded" in expect) assert.equal(read.forwarded, expect.forwarded, "forwarded");
    if ("formName" in expect) assert.equal(read.formName, expect.formName, "formName");
    for (const key of ["email", "firstName", "lastName", "partnerName", "phone", "eventDate", "venue", "city", "guestCount", "budget", "referralSource"]) {
      if (key in expect) assert.equal(value(key), expect[key], key);
    }
    if ("services" in expect) assert.deepEqual(value("services"), expect.services, "services");
    if ("messageIncludes" in expect)
      assert.match(String(value("message") ?? read.message), new RegExp(String(expect.messageIncludes), "i"));
    // The couple is never the studio or a platform's no-reply address.
    const email = String(value("email") ?? "");
    assert.doesNotMatch(email, /hartlight\.example|squarespace|wix|showit|theknot|weddingpro|pixieset|no-?reply/i);
  });
}

test("an HTML-only notification is read, not thrown away as empty", () => {
  const text = htmlToText("<table><tr><td>Name</td><td>Emma</td></tr><tr><td>Email:</td><td>e@example.com</td></tr></table><p>Hi &amp; hello</p>");
  assert.match(text, /^Name: Emma$/m);
  assert.match(text, /^Email: e@example\.com$/m);
  assert.match(text, /Hi & hello/);
});

test("labels are read the way studios word them", () => {
  assert.equal(labelToField("Tell us about your wedding day"), "message");
  assert.equal(labelToField("Where did you hear about us?"), "referralSource");
  assert.equal(labelToField("Where is your wedding?"), "venue");
  assert.equal(labelToField("Big day"), "eventDate");
  assert.equal(labelToField("Your fiancé's name"), "partnerName");
  assert.equal(labelToField("Your names"), "fullName");
  assert.equal(labelToField("Email Address"), "email");
  // The studio's own mapping wins.
  assert.equal(labelToField("Where", { where: "city" }), "city");
  assert.equal(labelToField("Venue", { venue: "ignore" }), null);
});

test("a multi-line message stays whole and stops at the next field", () => {
  const fields = readFields("Message: line one\nline two\nPhone: 555 0100");
  assert.deepEqual(
    fields.map((field) => [field.key, field.value]),
    [["message", "line one\nline two"], ["phone", "555 0100"]],
  );
});

// Production, 2026-09-29: a forwarded 123FormBuilder notification. Gmail wrote
// each row as `*Label* value`; the reader took each whole line as a label and
// the next line as its value, so the job was named "*Phone Number* 917…".
test("Gmail's `*Label* value` lines are read as label and value", () => {
  const fields = readFields("*Name* Jordan Ellis\n*Phone Number* 5550142233\n*Event Venue* Home");
  assert.deepEqual(
    fields.map((field) => [field.key, field.label, field.value]),
    [
      ["fullName", "Name", "Jordan Ellis"],
      ["phone", "Phone Number", "5550142233"],
      ["venue", "Event Venue", "Home"],
    ],
  );
});

test("a time is not a label, and 123FormBuilder's footer is not the message", () => {
  const fields = readFields(
    "*Message* Are you available?\nThe message has been sent from 203.0.113.7 (United States) at 2026-09-29\n14:46:22 on Chrome 153.0.0.0\nEntry ID: 707",
  );
  assert.deepEqual(fields.map((field) => [field.key, field.value]), [["message", "Are you available?"]]);
});

test("a link's target is not part of the value", () => {
  assert.equal(withoutLinkTargets("5550142233 <(555)%20014-2233>"), "5550142233");
  assert.equal(withoutLinkTargets("emma@example.com <mailto:emma@example.com>"), "emma@example.com");
  assert.equal(withoutLinkTargets("Emma <emma@example.com>"), "Emma <emma@example.com>");
});

test("a misread field never becomes the couple's name", () => {
  for (const bad of ["*Phone", "Number* 5550142233 <(555)%20014-2233>", "*Phone Number* 5550142233", "14", "e@example.com", ""]) {
    assert.equal(plausiblePersonName(bad), false, bad);
  }
  for (const good of ["Jordan", "Ellis", "Mary-Kate O'Neil", "Zoë", "José García"]) {
    assert.equal(plausiblePersonName(good), true, good);
  }
  const values = valuesFromFields(
    [{ label: "*Name* Albert", value: "*Phone Number* 5550142233", key: "fullName" }],
    "2026-09-29",
  );
  assert.equal(values.firstName, undefined);
  assert.equal(values.lastName, undefined);
});
