import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CLIENT_EMAIL_TYPES,
  CREW_EMAIL_TYPES,
  renderEmailTemplate,
} from "../functions/src/communications/email-templates";

/**
 * Conor, 2026-10-06: "review all the client and crew emails and make sure all
 * of them have a link to open Studiocue. I received one … that didn't have it."
 * The inquiry acknowledgement had a "View your inquiry" button that no sender
 * ever filled, and a voided agreement, a cancelled booking, a crew
 * cancellation and a group-event receipt had no link in any case.
 */

const read = (path: string) => readFileSync(path, "utf8");
const brand = {
  studioName: "FlawlessIQ",
  productName: "StudioCue",
  accentColor: "#0f8a5e",
  logoUrl: null,
  contactEmail: "hello@example.com",
  postalAddress: null,
};
const links = (text: string) => (text.match(/https?:\/\/\S+/g) ?? []).filter((url) => !/unsubscribe/i.test(url));

// What the email worker supplies (operations/jobs.ts, emailContext): the app's
// address, and the recipient's home — the portal, or their inquiry page before
// they have an account.
const worker = (home: string) => ({
  appUrl: "https://studio-cue.com",
  portalUrl: home,
  startsAt: "2027-01-01T15:00:00Z",
  amountCents: 75000,
  body: "A note from the studio.",
});

test("every client email opens StudioCue, before and after the couple has an account", () => {
  for (const key of CLIENT_EMAIL_TYPES) {
    for (const home of ["https://studio-cue.com/client", "https://studio-cue.com/i/token"]) {
      const email = renderEmailTemplate({ key, brand, recipientName: "Maya Brooks", projectName: "Maya Brooks Wedding", values: worker(home) });
      assert.ok(links(email.text).length > 0, `${key} has no link (home ${home})`);
    }
  }
});

test("every crew email opens StudioCue", () => {
  for (const key of CREW_EMAIL_TYPES) {
    const email = renderEmailTemplate({ key, brand, recipientName: "Albert", projectName: "Maya Brooks Wedding", values: worker("") });
    assert.ok(links(email.text).some((url) => url.includes("studio-cue.com")), `${key} has no StudioCue link`);
  }
});

test("a new email type has to say who reads it", () => {
  // Studio, platform, auth and billing mail is the studio's or StudioCue's own
  // and opens StudioCue its own way; everything else is a client's or crew's.
  const keys = [...read("functions/src/communications/email-templates.ts").matchAll(/case "([a-z_]+)":/g)].map((match) => match[1]!);
  const ownMail = /^(studio_|platform_|feedback_|billing_|trial_|staff_invitation|email_verification|password_reset|sign_in_link|daily_digest|coi_)/;
  const unclassified = keys.filter((key) => !ownMail.test(key) && !CLIENT_EMAIL_TYPES.has(key) && !CREW_EMAIL_TYPES.has(key));
  assert.deepEqual(unclassified, [], "add the new type to CLIENT_EMAIL_TYPES or CREW_EMAIL_TYPES");
});

test("a couple without an account is sent their inquiry page, not a sign-in they can't pass", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /if \(!recipientContact\?\.get\("portalUserId"\) && homeLeadId\)/);
  assert.match(jobs, /clientHome = `\$\{appUrl\}\/i\/\$\{token\}`/);
  assert.match(jobs, /portalUrl: firstString\(document\.get\("portalUrl"\)\) \?\? clientHome,\s*appUrl,/);
  // The acknowledgement goes before any job exists, so it carries the page itself.
  assert.match(read("functions/src/crm/public-lead.ts"), /\.\.\.\(inquiryPage \? \{ portalUrl: inquiryPage \} : \{\}\),\s*type: "inquiry_acknowledgement"/);
});

test("the consultation email gives the join link once", () => {
  const email = renderEmailTemplate({
    key: "consultation_confirmation",
    brand,
    recipientName: "Maya Brooks",
    values: { ...worker("https://studio-cue.com/i/token"), joinUrl: "https://zoom.us/j/123", rescheduleUrl: "https://studio-cue.com/i/token" },
  });
  assert.equal((email.text.match(/zoom\.us\/j\/123/g) ?? []).length, 1);
});

test("the booking steps never claim an agreement is ready while it has blanks", () => {
  assert.doesNotMatch(read("components/booking/project-booking-workspace.tsx"), /\? "Ready to send"\s*: "Waits for the proposal"/);
});
