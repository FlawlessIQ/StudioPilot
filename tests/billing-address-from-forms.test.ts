import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addressFromAnswer, suggestedBillingAddress } from "@/features/contacts/billing-address-signing";

/**
 * Gabe, 2026-10-05: Dionne gave "140 Briarwood Rd, Florham Park, NJ" on the
 * studio's event form, then signing asked for her billing address again.
 */

const DIONNE = {
  fields: [
    { id: "bride-name", label: "Bride Name", type: "text" },
    { id: "bride-email", label: "Bride Email", type: "email" },
    { id: "bride-address", label: "Bride Address", type: "long_text" },
    { id: "ceremony-location", label: "Ceremony Location", type: "address" },
    { id: "venue-address", label: "Venue address", type: "address" },
  ],
  answers: {
    "bride-name": "Dionne Rhodes",
    "bride-email": "dionne@example.com",
    "bride-address": "140 Briarwood Rd\nFlorham Park, NJ 07932",
    "ceremony-location": "Primavera Regency, 1080 Valley Rd, Stirling, NJ 07980",
    "venue-address": "1080 Valley Rd, Stirling, NJ 07980",
  },
};

test("Dionne's form answer becomes the address offered at signing; places on the day never do", () => {
  const offered = suggestedBillingAddress({ forms: [DIONNE], signerEmail: "dionne@example.com" });
  assert.deepEqual(offered, {
    address: { line1: "140 Briarwood Rd", line2: null, city: "Florham Park", region: "NJ", postalCode: "07932", country: "US" },
    question: "Bride Address",
  });
  const venuesOnly = { ...DIONNE, answers: { ...DIONNE.answers, "bride-address": "" } };
  assert.equal(suggestedBillingAddress({ forms: [venuesOnly], signerEmail: "dionne@example.com" }), null);
});

test("two partners: the signer's own address, or nothing rather than a guess", () => {
  const both = {
    fields: [
      ...DIONNE.fields,
      { id: "groom-email", label: "Groom Email", type: "email" },
      { id: "groom-address", label: "Groom Address", type: "long_text" },
    ],
    answers: { ...DIONNE.answers, "groom-email": "sam@example.com", "groom-address": "9 Oak St, Madison, New Jersey 07940" },
  };
  assert.equal(suggestedBillingAddress({ forms: [both], signerEmail: "sam@example.com" })?.address.line1, "9 Oak St");
  assert.equal(suggestedBillingAddress({ forms: [both], signerEmail: "dionne@example.com" })?.address.line1, "140 Briarwood Rd");
  assert.equal(suggestedBillingAddress({ forms: [both], signerEmail: "someone-else@example.com" }), null);
});

test("addresses written the ways couples write them", () => {
  assert.equal(addressFromAnswer("140 Briarwood Rd, Florham Park NJ 07932-2561")?.postalCode, "07932-2561");
  assert.equal(addressFromAnswer("12 Elm St\nApt 4\nNew York, NY 10001")?.line2, "Apt 4");
  assert.equal(addressFromAnswer("12 Elm St, New York, NY 10001, USA")?.city, "New York");
  assert.equal(addressFromAnswer({ line1: "1 Main St", city: "Morristown", region: "New Jersey", postalCode: "07960" })?.region, "NJ");
  for (const junk of ["TBD", "Florham Park", "140 Briarwood Rd", "", null, 42]) {
    assert.equal(addressFromAnswer(junk), null, String(junk));
  }
});

test("wired: offered only when none is on file, and the sheet still asks for the tick", () => {
  const server = readFileSync("server/contracts/signing-billing-address.ts", "utf8");
  assert.match(server, /const suggested = context\.onFile \|\| !context\.contact\s*\? null\s*: await formBillingAddressSuggestion/);
  const sheet = readFileSync("components/client/billing-address-step.tsx", "utf8");
  // An offered address goes through the "on file" path: confirmed → sent, unticked → not.
  assert.match(sheet, /if \(onFile && !editing\) \{\s*if \(confirmed\) return \{ ok: true, address: onFile \};/);
  assert.match(sheet, /const offered = result\.onFile \?\? result\.suggested\?\.address \?\? null;/);
});
