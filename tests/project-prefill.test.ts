import assert from "node:assert/strict";
import test from "node:test";
import { prefillFromText } from "@/features/crm/project-prefill";

test("a typical inquiry email prefills date, contact, venue, and names", () => {
  const result = prefillFromText(
    [
      "Hi! I'm Ava Chen — my fiancé Liam and I are getting married on",
      "June 12, 2027 at The Park Savoy in Florham Park, NJ.",
      "You can reach me at ava.chen@example.com or (201) 555-0142.",
    ].join(" "),
  );
  assert.equal(result.eventDate, "2027-06-12");
  assert.equal(result.eventType, "Wedding");
  assert.equal(result.email, "ava.chen@example.com");
  assert.equal(result.phone, "(201) 555-0142");
  assert.equal(result.venueName, "The Park Savoy");
  assert.equal(result.city, "Florham Park, NJ");
  assert.equal(result.firstName, "Ava");
  assert.equal(result.lastName, "Chen");
});

test("date formats: ISO, slashed US, and worded with ordinal", () => {
  assert.equal(prefillFromText("date 2027-06-12 ok").eventDate, "2027-06-12");
  assert.equal(prefillFromText("we picked 6/12/2027").eventDate, "2027-06-12");
  assert.equal(prefillFromText("on 6/12/27 hopefully").eventDate, "2027-06-12");
  assert.equal(
    prefillFromText("ceremony October 3rd, 2026").eventDate,
    "2026-10-03",
  );
  // An impossible date is left alone rather than guessed.
  assert.equal(prefillFromText("on 13/40/2027").eventDate, null);
});

test("the couple pattern fills the partner without duplicating the sender", () => {
  const result = prefillFromText("I'm Ava. Ava and Liam, September 3, 2026.");
  assert.equal(result.firstName, "Ava");
  assert.equal(result.partnerName, "Liam");
});

test("corporate keywords select the corporate event type", () => {
  assert.equal(
    prefillFromText("our annual conference is 3/4/2027").eventType,
    "Corporate",
  );
});

test("empty or unhelpful text extracts nothing and invents nothing", () => {
  const result = prefillFromText("hello there, call me back please");
  assert.equal(result.eventDate, null);
  assert.equal(result.email, null);
  assert.equal(result.venueName, null);
  assert.equal(result.eventType, null);
});
