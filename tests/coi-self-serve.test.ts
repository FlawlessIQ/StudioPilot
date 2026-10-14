import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { todayInbox } from "@/features/today/inbox";
import {
  certificateCovers,
  certificateKitFields,
  insurerLink,
  splitUsAddress,
} from "@/features/insurance/certificate-kit";
import { describeDiscrepancy } from "@/features/insurance/certificate-review";
import { coiSettingsInput, waitsForRenewal } from "../functions/src/coi/automation";
import { certificateCovers as serverCovers } from "../functions/src/coi/reuse";

/**
 * Certificates a studio makes itself, on Hiscox, NEXT or Thimble (2026-10-14).
 * None of the three lets a partner make them, so the studio's two minutes are
 * the form: StudioCue brings the details in form order, an address the
 * certificate can be emailed to, a re-send when a venue already has one that
 * covers the date, and a hold until the policy renews.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("the venue's address splits into the boxes every certificate form has", () => {
  assert.deepEqual(splitUsAddress("120 Main St, Suite 4, Springfield, NJ 07081, USA"), {
    street: "120 Main St, Suite 4",
    city: "Springfield",
    state: "NJ",
    zip: "07081",
  });
  assert.deepEqual(splitUsAddress("Park Savoy, 2 Park Savoy Ave, Florham Park, NJ 07932"), {
    street: "Park Savoy, 2 Park Savoy Ave",
    city: "Florham Park",
    state: "NJ",
    zip: "07932",
  });
  assert.deepEqual(splitUsAddress("2 Park Ave, Boston MA 02108"), { street: "2 Park Ave", city: "Boston", state: "MA", zip: "02108" });
  // Not one it can read: whole, in Street, nothing invented.
  assert.deepEqual(splitUsAddress("The barn behind the church"), { street: "The barn behind the church", city: "", state: "", zip: "" });
});

test("the kit is the form's fields in order, and leaves out what the venue didn't ask for", () => {
  const fields = certificateKitFields({
    holder: "Park Savoy Estate LLC",
    venueAddress: "2 Park Savoy Ave, Florham Park, NJ 07932",
    venueName: "Park Savoy",
    eventDateLabel: "Oct 14, 2026",
    service: "photography",
    additionalInsuredWording: null,
  });
  assert.deepEqual(
    fields.map((field) => field.label),
    ["Certificate holder", "Street", "City", "State", "ZIP", "Description of operations"],
  );
  assert.equal(fields.at(-1)?.value, "Photography at Park Savoy on Oct 14, 2026");
});

test("each insurer's button goes to its certificate page; another company uses the studio's link", () => {
  assert.equal(insurerLink({ insurer: "next" }).url, "https://portal.nextinsurance.com/");
  assert.equal(insurerLink({ insurer: "thimble" }).label, "Thimble");
  assert.equal(insurerLink({ insurer: "other", portalUrl: "https://example.com/coi" }).url, "https://example.com/coi");
  assert.equal(insurerLink({ insurer: "other" }).url, null);
  assert.equal(insurerLink(null).url, null);
});

test("a certificate already sent covers a new date only if it isn't dated and the policy runs past it", () => {
  const cases = [
    { extractedEventDate: null, policyExpirationDate: "2027-06-01", eventDate: "2027-05-15", covers: true },
    { extractedEventDate: null, policyExpirationDate: "2027-05-15", eventDate: "2027-05-15", covers: true },
    { extractedEventDate: null, policyExpirationDate: "2027-05-01", eventDate: "2027-05-15", covers: false },
    { extractedEventDate: "2026-10-14", policyExpirationDate: "2027-06-01", eventDate: "2027-05-15", covers: false },
    { extractedEventDate: null, policyExpirationDate: null, eventDate: "2027-05-15", covers: false },
  ];
  for (const { covers, ...input } of cases) {
    assert.equal(certificateCovers(input), covers, JSON.stringify(input));
    assert.equal(serverCovers(input), covers, `server copy: ${JSON.stringify(input)}`);
  }
});

test("a certificate for an event after the policy ends is asked for once it renews", () => {
  assert.equal(waitsForRenewal({ eventDate: "2027-05-15", aiPolicyExpiresOn: "2027-01-03", now: "2026-11-20T10:00:00Z" }), true);
  assert.equal(waitsForRenewal({ eventDate: "2027-05-15", aiPolicyExpiresOn: "2027-01-03", now: "2027-01-04T10:00:00Z" }), false);
  assert.equal(waitsForRenewal({ eventDate: "2026-12-15", aiPolicyExpiresOn: "2027-01-03", now: "2026-11-20T10:00:00Z" }), false);
  assert.equal(waitsForRenewal({ eventDate: "2027-05-15", aiPolicyExpiresOn: null, now: "2026-11-20T10:00:00Z" }), false);
});

test("settings take the insurer, and saving them never overwrites the policy end date read off a certificate", () => {
  const parsed = coiSettingsInput.parse({ source: "self_serve", insurer: "thimble", dial: "prepare" });
  assert.equal(parsed.insurer, "thimble");
  assert.match(read("functions/src/coi/automation.ts"), /aiPolicyExpiresOn: text\(before\.get\("aiPolicyExpiresOn"\)\) \|\| null,/);
});

test("the certificate can arrive by email: a self-serve request takes a PDF, and a logo before it doesn't win", () => {
  const inbound = read("functions/src/planning/inbound.ts");
  assert.match(inbound, /"self_serve",\n\]\);/);
  assert.match(inbound, /limits: \{ files: 10,/);
  assert.match(inbound, /body\.subarray\(0, 4\)\.toString\(\) !== "%PDF"/);
});

test("a policy on the wrong side of the day is said plainly", () => {
  const detail = describeDiscrepancy({ field: "policyExpirationDate", expected: "2027-05-15", extracted: "2027-01-03", severity: "blocking" });
  assert.equal(detail.label, "Policy end date");
  assert.equal(detail.detail, "The policy on it ends Jan 3, 2027, before the event on May 15, 2027.");
});

const job = { id: "p-a", tenantId: "t1", name: "Smith Wedding", state: "PLANNING", eventDate: "2027-09-18", insuranceRequired: "required" };
const selfServe = (extra: Record<string, unknown> = {}) => ({
  id: "r-a",
  tenantId: "t1",
  projectId: "p-a",
  status: "self_serve",
  venueName: "Park Savoy",
  dueDate: "2027-08-28",
  updatedAt: "2027-07-20T00:00:00.000Z",
  ...extra,
});
const cards = (inbox: ReturnType<typeof todayInbox>) =>
  [...inbox.act, ...inbox.approve, ...inbox.fyi].filter((item) => item.id.startsWith("coi-"));

test("Today: the kit is a two-minute card, and five days before it's due it says so", () => {
  const early = cards(todayInbox({ now: "2027-07-21T12:00:00.000Z", projects: [job], insuranceRequests: [selfServe()], coiSettings: [{ id: "t1", tenantId: "t1" }] }));
  assert.equal(early[0]?.id, "coi-self_serve-r-a");
  assert.equal(early[0]?.title, "Make the COI for Park Savoy · about 2 min");

  const late = cards(todayInbox({ now: "2027-08-25T12:00:00.000Z", projects: [job], insuranceRequests: [selfServe()], coiSettings: [{ id: "t1", tenantId: "t1" }] }));
  assert.equal(late[0]?.id, "coi-self-due-r-a");
  assert.equal(late[0]?.lane, "act");
});

test("Today: a venue that already has a certificate covering the date gets a re-send, not a new one", () => {
  const reused = cards(
    todayInbox({
      now: "2027-07-21T12:00:00.000Z",
      projects: [job],
      insuranceRequests: [selfServe({ status: "under_review", reusedFromRequestId: "r-old" })],
      coiSettings: [{ id: "t1", tenantId: "t1" }],
    }),
  );
  assert.equal(reused[0]?.title, "Re-send your Park Savoy certificate — it still covers this date");
});

test("Today: a policy renewing before booked jobs that need a certificate is said a month ahead", () => {
  const renewal = cards(
    todayInbox({
      now: "2027-07-01T12:00:00.000Z",
      projects: [job],
      insuranceRequests: [],
      coiSettings: [{ id: "t1", tenantId: "t1", aiPolicyExpiresOn: "2027-07-20" }],
    }),
  );
  assert.equal(renewal[0]?.id, "coi-renewal-2027-07-20");
  assert.match(renewal[0]?.detail ?? "", /^1 job after it needs a new certificate/);
  const farOff = cards(
    todayInbox({ now: "2027-04-01T12:00:00.000Z", projects: [job], insuranceRequests: [], coiSettings: [{ id: "t1", tenantId: "t1", aiPolicyExpiresOn: "2027-07-20" }] }),
  );
  assert.equal(farOff.length, 0);
});
