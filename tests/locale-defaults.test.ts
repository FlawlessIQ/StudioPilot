import assert from "node:assert/strict";
import test from "node:test";

import { currencyForTimezone } from "../features/auth/locale-defaults";

test("signup pre-selects the currency a studio's timezone implies", () => {
  assert.equal(currencyForTimezone("America/New_York"), "USD");
  assert.equal(currencyForTimezone("America/Los_Angeles"), "USD");
  assert.equal(currencyForTimezone("America/Toronto"), "CAD");
  assert.equal(currencyForTimezone("America/Halifax"), "CAD");
  assert.equal(currencyForTimezone("Europe/London"), "GBP");
  assert.equal(currencyForTimezone("Europe/Dublin"), "EUR");
  assert.equal(currencyForTimezone("Europe/Paris"), "EUR");
  assert.equal(currencyForTimezone("Australia/Sydney"), "AUD");
  assert.equal(currencyForTimezone("Asia/Tokyo"), "USD", "anything else keeps the old default");
});

import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

test("onboarding asks for the studio name, not the same name twice", () => {
  const form = read("features/auth/onboarding-form.tsx");
  assert.doesNotMatch(form, /name="legalName"/);
  assert.match(form, /legalName: String\(data\.get\("businessName"\)\)/);
  // Defaults come from the browser, not a hard-coded New York / USD.
  assert.match(form, /defaultValue=\{zone\}/);
  assert.match(form, /defaultValue=\{currencyForTimezone\(zone\)\}/);
  // And the server refuses a timezone that isn't one.
  assert.match(read("functions/src/saas/onboarding.ts"), /Unknown timezone/);
});

test("a new studio lands in setup, and every page setup opens leads back to it", () => {
  // After checkout (and for a comped studio), setup, not an empty Today.
  assert.match(read("components/saas/live-subscription.tsx"), /assign\("\/studio\/setup"\)/);
  assert.match(read("features/auth/onboarding-form.tsx"), /checkoutRequired === false \? "\/studio\/setup"/);
  // Setup's links say where they came from…
  assert.match(read("components/setup/setup-conversation.tsx"), /href=\{fromSetup\(gap\.href\)\}/);
  // …and each page they reach offers the way back.
  for (const page of [
    "app/studio/import/page.tsx",
    "app/studio/packages/new/page.tsx",
    "app/studio/contracts/agreement/page.tsx",
  ]) {
    assert.match(read(page), /<BackToSetup /, `${page} must lead back to setup`);
  }
  assert.match(read("app/studio/settings/[section]/page.tsx"), /backToSetup=\{from === "setup"\}/);
});

test("the calendar tells a studio that never connected how to, not that sync is down", () => {
  const calendar = read("components/booking/studio-calendar.tsx");
  assert.match(calendar, /calendarStatus === "unavailable" && !calendarConnected/);
  assert.match(calendar, /Connect Google Calendar/);
});

import { questionnaireEventType } from "../functions/src/studio-import/event-type-guess";

test("an imported details form is for the job type its name says", () => {
  assert.equal(questionnaireEventType("Corporate Shoot Brief"), "corporate");
  assert.equal(questionnaireEventType("Headshot questionnaire"), "corporate");
  assert.equal(questionnaireEventType("Team & League Day"), "sports");
  assert.equal(questionnaireEventType("Wedding Planning Questionnaire"), "wedding");
  assert.equal(questionnaireEventType("Our questionnaire"), "wedding", "a name that says nothing keeps the old answer");
  assert.equal(questionnaireEventType(null), "wedding");
});
