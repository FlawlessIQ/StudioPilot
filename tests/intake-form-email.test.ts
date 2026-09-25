import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  htmlToText,
  labelToField,
  readFields,
  readInquiryEmail,
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
    assert.doesNotMatch(email, /hartlight\.example|squarespace|wix|showit|theknot|no-?reply/i);
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
